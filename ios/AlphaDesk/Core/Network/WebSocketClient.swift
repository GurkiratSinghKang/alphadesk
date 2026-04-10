// WebSocketClient.swift
// AlphaDesk
//
// WebSocket client for real-time data streaming from the AlphaDesk backend.
// Features:
// - JWT authentication handshake on connect
// - Channel-based subscriptions (quotes, portfolio, alerts, agents)
// - Auto-reconnect with exponential backoff
// - Messages delivered via AsyncStream

import Foundation
import os

private let logger = Logger(subsystem: "net.tradingalpha.AlphaDesk", category: "WebSocket")

// MARK: - Connection State

enum WebSocketState: Sendable, Equatable {
    case disconnected
    case connecting
    case authenticating
    case connected
    case reconnecting(attempt: Int)
}

// MARK: - WebSocket Event

/// Events emitted by the WebSocket client for consumers.
enum WebSocketEvent: Sendable {
    case stateChanged(WebSocketState)
    case message(WSIncomingMessage)
    case error(String)
}

// MARK: - WebSocketClient

@Observable
final class WebSocketClient: @unchecked Sendable {

    static let shared = WebSocketClient()

    // MARK: - Observable State

    private(set) var state: WebSocketState = .disconnected
    private(set) var subscribedChannels: Set<String> = []

    // MARK: - Configuration

    private let baseURL: URL
    private let maxReconnectAttempts = 10
    private let baseReconnectDelay: TimeInterval = 1.0
    private let maxReconnectDelay: TimeInterval = 60.0
    private let pingInterval: TimeInterval = 30.0

    // MARK: - Internals

    private var webSocketTask: URLSessionWebSocketTask?
    private let session: URLSession
    private var reconnectAttempt = 0
    private var receiveTask: Task<Void, Never>?
    private var pingTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?

    // MARK: - Event Stream

    private var eventContinuation: AsyncStream<WebSocketEvent>.Continuation?

    /// An `AsyncStream` of WebSocket events. Subscribe to this to receive
    /// real-time data updates, state changes, and errors.
    lazy var events: AsyncStream<WebSocketEvent> = {
        AsyncStream { [weak self] continuation in
            self?.eventContinuation = continuation
            continuation.onTermination = { _ in
                self?.eventContinuation = nil
            }
        }
    }()

    // MARK: - JSON Handling

    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }()

    private let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.keyEncodingStrategy = .convertToSnakeCase
        return e
    }()

    // MARK: - Init

    private init(baseURL: URL = URL(string: "wss://tradingalpha.net/ws")!) {
        self.baseURL = baseURL
        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = true
        self.session = URLSession(configuration: config)
    }

    // MARK: - Connect

    /// Open the WebSocket connection and authenticate with the current JWT.
    func connect() async {
        guard state == .disconnected || state.isReconnecting else {
            logger.debug("Already connected or connecting, skipping")
            return
        }

        updateState(.connecting)
        reconnectAttempt = 0

        await performConnect()
    }

    /// Disconnect and stop all reconnection attempts.
    func disconnect() {
        reconnectTask?.cancel()
        reconnectTask = nil
        receiveTask?.cancel()
        receiveTask = nil
        pingTask?.cancel()
        pingTask = nil

        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil

        subscribedChannels.removeAll()
        updateState(.disconnected)
        logger.info("WebSocket disconnected by user")
    }

    // MARK: - Subscriptions

    /// Subscribe to a channel. The server will push relevant data on this channel.
    func subscribe(to channel: String) async {
        guard state == .connected else {
            logger.warning("Cannot subscribe while not connected (state: \(String(describing: self.state)))")
            return
        }

        await sendMessage(.subscribe(channel: channel))
        subscribedChannels.insert(channel)
    }

    /// Unsubscribe from a channel.
    func unsubscribe(from channel: String) async {
        guard state == .connected else { return }

        await sendMessage(.unsubscribe(channel: channel))
        subscribedChannels.remove(channel)
    }

    // MARK: - Private: Connection Lifecycle

    private func performConnect() async {
        // Get a valid token for the auth handshake.
        guard let token = try? await AuthManager.shared.validAccessToken() else {
            logger.error("No valid token for WebSocket auth")
            emitEvent(.error("Authentication required"))
            updateState(.disconnected)
            return
        }

        let task = session.webSocketTask(with: baseURL)
        self.webSocketTask = task
        task.resume()

        // Authenticate.
        updateState(.authenticating)
        await sendMessage(.auth(token: token))

        do {
            // Wait for the auth response.
            let authResponse = try await receiveNext()
            guard case .authenticated = authResponse else {
                logger.error("WebSocket auth failed: unexpected response")
                emitEvent(.error("Authentication handshake failed"))
                task.cancel(with: .policyViolation, reason: nil)
                updateState(.disconnected)
                return
            }

            updateState(.connected)
            reconnectAttempt = 0
            logger.info("WebSocket connected and authenticated")

            // Resubscribe to channels that were active before a reconnect.
            let channels = subscribedChannels
            for channel in channels {
                await sendMessage(.subscribe(channel: channel))
            }

            // Start receive loop and ping timer.
            startReceiveLoop()
            startPingLoop()

        } catch {
            logger.error("WebSocket auth error: \(error.localizedDescription, privacy: .public)")
            emitEvent(.error("Connection failed: \(error.localizedDescription)"))
            task.cancel()
            scheduleReconnect()
        }
    }

    // MARK: - Receive Loop

    private func startReceiveLoop() {
        receiveTask?.cancel()
        receiveTask = Task { [weak self] in
            guard let self else { return }

            while !Task.isCancelled {
                do {
                    let message = try await self.receiveNext()
                    self.emitEvent(.message(message))
                } catch {
                    if !Task.isCancelled {
                        logger.error("Receive error: \(error.localizedDescription, privacy: .public)")
                        self.handleDisconnect()
                    }
                    return
                }
            }
        }
    }

    private func receiveNext() async throws -> WSIncomingMessage {
        guard let task = webSocketTask else {
            throw URLError(.badServerResponse)
        }

        let wsMessage = try await task.receive()

        let data: Data
        switch wsMessage {
        case .data(let d):
            data = d
        case .string(let s):
            guard let d = s.data(using: .utf8) else {
                throw URLError(.cannotDecodeRawData)
            }
            data = d
        @unknown default:
            throw URLError(.cannotDecodeRawData)
        }

        return parseIncomingMessage(data)
    }

    private func parseIncomingMessage(_ data: Data) -> WSIncomingMessage {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return .unknown([:])
        }

        // Check message type.
        if let type = json["type"] as? String {
            switch type {
            case "authenticated":
                return .authenticated
            case "subscribed":
                let channel = json["channel"] as? String ?? ""
                return .subscribed(channel: channel)
            case "unsubscribed":
                let channel = json["channel"] as? String ?? ""
                return .unsubscribed(channel: channel)
            case "pong":
                return .pong
            default:
                break
            }
        }

        // Check for error.
        if let error = json["error"] as? String {
            return .error(error)
        }

        // Channel data.
        if let channel = json["channel"] as? String,
           let payload = json["data"] as? [String: Any] {
            return .channelData(channel: channel, data: payload)
        }

        return .unknown(json)
    }

    // MARK: - Send

    private func sendMessage(_ message: WSOutgoingMessage) async {
        guard let task = webSocketTask else { return }

        do {
            let data = try encoder.encode(message)
            try await task.send(.data(data))
        } catch {
            logger.error("Send error: \(error.localizedDescription, privacy: .public)")
        }
    }

    // MARK: - Ping

    private func startPingLoop() {
        pingTask?.cancel()
        pingTask = Task { [weak self] in
            guard let self else { return }

            while !Task.isCancelled {
                do {
                    try await Task.sleep(for: .seconds(self.pingInterval))
                    await self.sendMessage(.ping)
                } catch {
                    return
                }
            }
        }
    }

    // MARK: - Reconnect

    private func handleDisconnect() {
        receiveTask?.cancel()
        pingTask?.cancel()
        webSocketTask = nil
        scheduleReconnect()
    }

    private func scheduleReconnect() {
        guard reconnectAttempt < maxReconnectAttempts else {
            logger.error("Max reconnect attempts (\(self.maxReconnectAttempts)) reached, giving up")
            updateState(.disconnected)
            emitEvent(.error("Connection lost. Please reconnect manually."))
            return
        }

        reconnectAttempt += 1
        updateState(.reconnecting(attempt: reconnectAttempt))

        // Exponential backoff with jitter.
        let delay = min(
            baseReconnectDelay * pow(2.0, Double(reconnectAttempt - 1)),
            maxReconnectDelay
        )
        let jitter = Double.random(in: 0...(delay * 0.2))
        let totalDelay = delay + jitter

        logger.info("Reconnecting in \(totalDelay, format: .fixed(precision: 1))s (attempt \(self.reconnectAttempt))")

        reconnectTask?.cancel()
        reconnectTask = Task { [weak self] in
            do {
                try await Task.sleep(for: .seconds(totalDelay))
                await self?.performConnect()
            } catch {
                // Task was cancelled (e.g., user called disconnect).
            }
        }
    }

    // MARK: - State & Events

    private func updateState(_ newState: WebSocketState) {
        state = newState
        emitEvent(.stateChanged(newState))
    }

    private func emitEvent(_ event: WebSocketEvent) {
        eventContinuation?.yield(event)
    }
}

// MARK: - WebSocketState Helpers

extension WebSocketState {
    var isReconnecting: Bool {
        if case .reconnecting = self { return true }
        return false
    }
}
