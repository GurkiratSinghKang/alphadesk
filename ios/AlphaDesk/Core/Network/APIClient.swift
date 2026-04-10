// APIClient.swift
// AlphaDesk
//
// Async/await API client for the AlphaDesk backend.
// Features:
// - Automatic JWT injection via Authorization header
// - Transparent 401 retry after token refresh
// - Configurable base URL
// - Generic Codable request/response

import Foundation
import os

private let logger = Logger(subsystem: "net.tradingalpha.AlphaDesk", category: "API")

// MARK: - HTTP Method

enum HTTPMethod: String, Sendable {
    case get = "GET"
    case post = "POST"
    case put = "PUT"
    case patch = "PATCH"
    case delete = "DELETE"
}

// MARK: - Endpoint

/// All API endpoints. Path components are computed relative to the base URL.
enum Endpoint: Sendable {
    // Auth
    case login
    case refreshToken

    // Portfolio
    case portfolioSummary
    case portfolioPerformance(period: String)

    // Trades / Positions
    case positions

    // Market data
    case quote(symbol: String)
    case bars(symbol: String, timeframe: String, limit: Int)
    case snapshot(symbol: String)

    // Strategies
    case strategies
    case strategyPerformance(id: String)
    case strategyAnalytics(id: String)

    // Market overview
    case indices
    case sectors
    case regime

    // News
    case marketNews
    case symbolNews(symbol: String)

    // Pipeline
    case pipelineStatus
    case pipelinePositions
    case pipelineHistory

    var path: String {
        switch self {
        // Auth
        case .login:                            "/api/v1/auth/login"
        case .refreshToken:                     "/api/v1/auth/refresh"

        // Portfolio
        case .portfolioSummary:                 "/api/v1/portfolio/summary"
        case .portfolioPerformance(let period): "/api/v1/portfolio/performance?period=\(period)"

        // Trades
        case .positions:                        "/api/v1/trades/positions"

        // Market data
        case .quote(let s):                     "/api/v1/market/quotes/\(s)"
        case .bars(let s, let tf, let limit):   "/api/v1/market/bars/\(s)?timeframe=\(tf)&limit=\(limit)"
        case .snapshot(let s):                  "/api/v1/market/snapshot/\(s)"

        // Strategies
        case .strategies:                       "/api/v1/strategies/"
        case .strategyPerformance(let id):      "/api/v1/strategies/\(id)/performance"
        case .strategyAnalytics(let id):        "/api/v1/strategies/\(id)/analytics"

        // Market overview
        case .indices:                          "/api/v1/market-overview/indices"
        case .sectors:                          "/api/v1/market-overview/sectors"
        case .regime:                           "/api/v1/market-overview/regime"

        // News
        case .marketNews:                       "/api/v1/news/market"
        case .symbolNews(let s):                "/api/v1/news/symbol/\(s)"

        // Pipeline
        case .pipelineStatus:                   "/api/v1/pipeline/status"
        case .pipelinePositions:                "/api/v1/pipeline/positions"
        case .pipelineHistory:                  "/api/v1/pipeline/history"
        }
    }

    /// Endpoints that do not require an Authorization header.
    var isPublic: Bool {
        switch self {
        case .login, .refreshToken: true
        default: false
        }
    }
}

// MARK: - API Errors

enum APIError: LocalizedError, Sendable {
    case invalidURL
    case unauthorized
    case forbidden
    case notFound
    case serverError(statusCode: Int, body: String)
    case decodingFailed(Error)
    case networkError(Error)
    case unknown(statusCode: Int)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            "Invalid URL."
        case .unauthorized:
            "Authentication required."
        case .forbidden:
            "Access denied."
        case .notFound:
            "Resource not found."
        case .serverError(let code, let body):
            "Server error (\(code)): \(body.prefix(200))"
        case .decodingFailed(let err):
            "Failed to decode response: \(err.localizedDescription)"
        case .networkError(let err):
            "Network error: \(err.localizedDescription)"
        case .unknown(let code):
            "Unexpected HTTP status \(code)."
        }
    }
}

// MARK: - API Client

final class APIClient: @unchecked Sendable {

    static let shared = APIClient()

    // MARK: - Configuration

    let baseURL: URL

    // MARK: - Session

    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    /// Guards against multiple simultaneous token refreshes.
    private let refreshLock = NSLock()
    private var activeRefreshTask: Task<Void, Error>?

    // MARK: - Init

    init(baseURL: URL = URL(string: "https://tradingalpha.net")!) {
        self.baseURL = baseURL

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        config.waitsForConnectivity = true
        self.session = URLSession(configuration: config)

        let dec = JSONDecoder()
        dec.keyDecodingStrategy = .convertFromSnakeCase
        dec.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let string = try container.decode(String.self)

            // Try ISO 8601 with fractional seconds and timezone
            let iso = ISO8601DateFormatter()
            iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = iso.date(from: string) { return date }

            // Try without fractional seconds
            iso.formatOptions = [.withInternetDateTime]
            if let date = iso.date(from: string) { return date }

            // Try simple datetime format: "2026-04-10 14:30:00"
            let simple = DateFormatter()
            simple.locale = Locale(identifier: "en_US_POSIX")
            simple.dateFormat = "yyyy-MM-dd HH:mm:ss"
            simple.timeZone = TimeZone(abbreviation: "UTC")
            if let date = simple.date(from: string) { return date }

            // Try date-only
            simple.dateFormat = "yyyy-MM-dd"
            if let date = simple.date(from: string) { return date }

            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Cannot decode date from: \(string)"
            )
        }
        self.decoder = dec

        let enc = JSONEncoder()
        enc.keyEncodingStrategy = .convertToSnakeCase
        self.encoder = enc
    }

    // MARK: - Generic Request

    /// Perform a typed API request.
    ///
    /// - Parameters:
    ///   - endpoint: The API endpoint to call.
    ///   - method: HTTP method (defaults to GET).
    ///   - body: Optional Encodable body (for POST/PUT/PATCH).
    ///   - skipAuth: If true, no Authorization header is added (used for refresh).
    /// - Returns: Decoded response of type `T`.
    func request<T: Decodable>(
        _ endpoint: Endpoint,
        method: HTTPMethod = .get,
        body: (any Encodable & Sendable)? = nil,
        skipAuth: Bool = false
    ) async throws -> T {
        let urlRequest = try await buildRequest(
            endpoint: endpoint,
            method: method,
            body: body,
            skipAuth: skipAuth
        )

        do {
            let (data, response) = try await session.data(for: urlRequest)

            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.unknown(statusCode: -1)
            }

            // Handle 401: attempt one token refresh then retry.
            if httpResponse.statusCode == 401 && !endpoint.isPublic && !skipAuth {
                try await refreshTokenOnce()

                let retryRequest = try await buildRequest(
                    endpoint: endpoint,
                    method: method,
                    body: body,
                    skipAuth: false
                )
                let (retryData, retryResponse) = try await session.data(for: retryRequest)
                guard let retryHTTP = retryResponse as? HTTPURLResponse else {
                    throw APIError.unknown(statusCode: -1)
                }
                return try handleResponse(data: retryData, httpResponse: retryHTTP)
            }

            return try handleResponse(data: data, httpResponse: httpResponse)

        } catch let error as APIError {
            throw error
        } catch let error as URLError {
            logger.error("Network error: \(error.localizedDescription, privacy: .public)")
            throw APIError.networkError(error)
        } catch {
            throw error
        }
    }

    // MARK: - Request Without Decoding

    /// Perform a request that does not return a meaningful body (e.g. DELETE 204).
    func requestVoid(
        _ endpoint: Endpoint,
        method: HTTPMethod = .get,
        body: (any Encodable & Sendable)? = nil
    ) async throws {
        let urlRequest = try await buildRequest(
            endpoint: endpoint,
            method: method,
            body: body,
            skipAuth: false
        )

        let (_, response) = try await session.data(for: urlRequest)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.unknown(statusCode: -1)
        }

        switch httpResponse.statusCode {
        case 200...299:
            return
        case 401:
            try await refreshTokenOnce()
            let retryRequest = try await buildRequest(
                endpoint: endpoint,
                method: method,
                body: body,
                skipAuth: false
            )
            let (_, retryResp) = try await session.data(for: retryRequest)
            guard let retryHTTP = retryResp as? HTTPURLResponse,
                  (200...299).contains(retryHTTP.statusCode) else {
                throw APIError.unauthorized
            }
        default:
            try throwForStatus(httpResponse.statusCode, data: Data())
        }
    }

    // MARK: - Raw Data Request

    /// Perform a request and return raw `Data` (useful for binary payloads).
    func requestData(
        _ endpoint: Endpoint,
        method: HTTPMethod = .get
    ) async throws -> Data {
        let urlRequest = try await buildRequest(
            endpoint: endpoint,
            method: method,
            body: nil as String?,
            skipAuth: false
        )
        let (data, response) = try await session.data(for: urlRequest)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.unknown(statusCode: -1)
        }
        try throwForStatus(httpResponse.statusCode, data: data)
        return data
    }

    // MARK: - Private Helpers

    private func buildRequest(
        endpoint: Endpoint,
        method: HTTPMethod,
        body: (any Encodable)?,
        skipAuth: Bool
    ) async throws -> URLRequest {
        guard let url = URL(string: endpoint.path, relativeTo: baseURL) else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method.rawValue
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        // Attach JWT unless skipped or public endpoint.
        if !skipAuth && !endpoint.isPublic {
            let token = try await AuthManager.shared.validAccessToken()
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        // Encode body.
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try encoder.encode(AnyEncodable(body))
        }

        return request
    }

    private func handleResponse<T: Decodable>(
        data: Data,
        httpResponse: HTTPURLResponse
    ) throws -> T {
        try throwForStatus(httpResponse.statusCode, data: data)

        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            logger.error("Decoding failed for \(T.self): \(error.localizedDescription, privacy: .public)")
            throw APIError.decodingFailed(error)
        }
    }

    private func throwForStatus(_ statusCode: Int, data: Data) throws {
        switch statusCode {
        case 200...299:
            return
        case 401:
            throw APIError.unauthorized
        case 403:
            throw APIError.forbidden
        case 404:
            throw APIError.notFound
        case 500...599:
            let body = String(data: data, encoding: .utf8) ?? ""
            throw APIError.serverError(statusCode: statusCode, body: body)
        default:
            throw APIError.unknown(statusCode: statusCode)
        }
    }

    /// Ensure only one token refresh happens at a time. Multiple concurrent 401s
    /// will all wait on the same refresh task.
    private func refreshTokenOnce() async throws {
        refreshLock.lock()
        if let existing = activeRefreshTask {
            refreshLock.unlock()
            try await existing.value
            return
        }

        let task = Task {
            try await AuthManager.shared.refreshToken()
        }
        activeRefreshTask = task
        refreshLock.unlock()

        defer {
            refreshLock.lock()
            activeRefreshTask = nil
            refreshLock.unlock()
        }

        try await task.value
    }
}

// MARK: - AnyEncodable (type erasure for body encoding)

private struct AnyEncodable: Encodable {
    private let _encode: (Encoder) throws -> Void

    init(_ value: any Encodable) {
        _encode = { encoder in
            try value.encode(to: encoder)
        }
    }

    func encode(to encoder: Encoder) throws {
        try _encode(encoder)
    }
}
