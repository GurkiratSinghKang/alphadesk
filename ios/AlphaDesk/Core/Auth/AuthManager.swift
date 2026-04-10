// AuthManager.swift
// AlphaDesk
//
// Central authentication state manager using the iOS 17+ Observation framework.
// Persists JWT tokens in the Keychain and handles login, logout, and
// transparent token refresh before expiry.

import Foundation
import os

private let logger = Logger(subsystem: "net.tradingalpha.AlphaDesk", category: "Auth")

// MARK: - Keychain Keys

private enum AuthKeys {
    static let accessToken = "auth_access_token"
    static let refreshToken = "auth_refresh_token"
    static let tokenExpiry = "auth_token_expiry"
}

// MARK: - Errors

enum AuthError: LocalizedError {
    case invalidCredentials
    case tokenRefreshFailed
    case noRefreshToken
    case sessionExpired

    var errorDescription: String? {
        switch self {
        case .invalidCredentials: "Invalid username or password."
        case .tokenRefreshFailed: "Failed to refresh session. Please log in again."
        case .noRefreshToken: "No refresh token available."
        case .sessionExpired: "Your session has expired. Please log in again."
        }
    }
}

// MARK: - AuthManager

@Observable
final class AuthManager: @unchecked Sendable {

    static let shared = AuthManager()

    // MARK: - Published State

    /// Whether the user has a valid (or recently-valid) access token.
    var isAuthenticated: Bool {
        accessToken != nil
    }

    /// Current username, if known.
    private(set) var username: String?

    /// Set while a login or refresh call is in flight.
    private(set) var isLoading: Bool = false

    /// Last authentication error for UI display.
    private(set) var error: AuthError?

    /// User-facing error message string (consumed by LoginView).
    var errorMessage: String? {
        error?.errorDescription
    }

    /// Configurable server URL. The default points to the production backend.
    /// LoginView exposes this so the user can override it during development.
    var serverURL: String = "https://tradingalpha.net" {
        didSet {
            // Rebuild the APIClient when the server URL changes.
            if let url = URL(string: serverURL), url != apiClient.baseURL {
                apiClient = APIClient(baseURL: url)
            }
        }
    }

    // MARK: - Token Storage (in-memory cache)

    private(set) var accessToken: String?
    private var refreshTokenValue: String?
    private var tokenExpiryDate: Date?

    // MARK: - Internals

    private let keychain = KeychainHelper.shared
    private let lock = NSLock()
    private(set) var apiClient: APIClient = .shared

    /// Background task that refreshes the token before it expires.
    private var refreshTask: Task<Void, Never>?

    // MARK: - Init

    init() {
        restoreSession()
    }

    // MARK: - Restore Persisted Session

    /// Load tokens from the Keychain on launch.
    private func restoreSession() {
        lock.lock()
        defer { lock.unlock() }

        accessToken = keychain.readString(key: AuthKeys.accessToken)
        refreshTokenValue = keychain.readString(key: AuthKeys.refreshToken)

        if let expiryData = keychain.read(key: AuthKeys.tokenExpiry),
           let expiryString = String(data: expiryData, encoding: .utf8),
           let interval = TimeInterval(expiryString) {
            tokenExpiryDate = Date(timeIntervalSince1970: interval)
        }

        if accessToken != nil {
            logger.info("Session restored from Keychain")
            scheduleTokenRefresh()
        }
    }

    // MARK: - Login

    /// Authenticate with the backend. On success, tokens are persisted and a
    /// background refresh is scheduled.
    ///
    /// This method catches errors internally and sets `self.error` / `errorMessage`
    /// so that callers (like LoginView) can use it without `try`.
    func login(username: String, password: String) async {
        isLoading = true
        error = nil

        defer { isLoading = false }

        do {
            let body: [String: String] = [
                "username": username,
                "password": password,
            ]
            let response: TokenResponse = try await apiClient.request(
                .login,
                method: .post,
                body: body
            )

            persistTokens(response)
            self.username = username
            logger.info("Login succeeded for user \(username, privacy: .public)")

        } catch let apiError as APIError {
            switch apiError {
            case .unauthorized:
                error = .invalidCredentials
            default:
                error = .invalidCredentials
            }
            logger.error("Login failed: \(apiError.localizedDescription, privacy: .public)")
        } catch {
            self.error = .invalidCredentials
            logger.error("Login failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    // MARK: - Logout

    /// Clear all tokens and reset authentication state.
    func logout() {
        lock.lock()
        defer { lock.unlock() }

        refreshTask?.cancel()
        refreshTask = nil

        accessToken = nil
        refreshTokenValue = nil
        tokenExpiryDate = nil
        username = nil
        error = nil

        keychain.delete(key: AuthKeys.accessToken)
        keychain.delete(key: AuthKeys.refreshToken)
        keychain.delete(key: AuthKeys.tokenExpiry)

        logger.info("User logged out, tokens cleared")
    }

    // MARK: - Token Refresh

    /// Attempt to refresh the access token using the stored refresh token.
    /// Called automatically before expiry and on 401 responses.
    func refreshToken() async throws {
        lock.lock()
        guard let refresh = refreshTokenValue else {
            lock.unlock()
            throw AuthError.noRefreshToken
        }
        lock.unlock()

        let body: [String: String] = ["refresh_token": refresh]

        do {
            let response: TokenResponse = try await apiClient.request(
                .refreshToken,
                method: .post,
                body: body,
                skipAuth: true
            )
            persistTokens(response)
            logger.info("Token refreshed successfully")

        } catch {
            logger.error("Token refresh failed: \(error.localizedDescription, privacy: .public)")
            logout()
            throw AuthError.tokenRefreshFailed
        }
    }

    // MARK: - Ensure Valid Token

    /// Returns a valid access token, refreshing if it is about to expire
    /// (within 60 seconds). Used by APIClient before each authenticated request.
    func validAccessToken() async throws -> String {
        lock.lock()
        let token = accessToken
        let expiry = tokenExpiryDate
        lock.unlock()

        guard let token else {
            throw AuthError.sessionExpired
        }

        // If the token expires within 60 seconds, refresh proactively.
        if let expiry, expiry.timeIntervalSinceNow < 60 {
            try await refreshToken()
            lock.lock()
            let refreshed = accessToken
            lock.unlock()
            guard let refreshed else { throw AuthError.sessionExpired }
            return refreshed
        }

        return token
    }

    // MARK: - Private Helpers

    private func persistTokens(_ response: TokenResponse) {
        lock.lock()
        defer { lock.unlock() }

        accessToken = response.accessToken
        refreshTokenValue = response.refreshToken

        let expiry = Date().addingTimeInterval(TimeInterval(response.expiresIn))
        tokenExpiryDate = expiry

        try? keychain.save(key: AuthKeys.accessToken, string: response.accessToken)
        try? keychain.save(key: AuthKeys.refreshToken, string: response.refreshToken)

        let expiryString = String(expiry.timeIntervalSince1970)
        if let expiryData = expiryString.data(using: .utf8) {
            try? keychain.save(key: AuthKeys.tokenExpiry, data: expiryData)
        }

        error = nil
        scheduleTokenRefresh()
    }

    /// Schedule a background task to refresh the token 60 seconds before expiry.
    private func scheduleTokenRefresh() {
        refreshTask?.cancel()

        guard let expiry = tokenExpiryDate else { return }

        // Refresh 60 seconds before expiry, minimum 10 seconds from now.
        let delay = max(expiry.timeIntervalSinceNow - 60, 10)

        refreshTask = Task { [weak self] in
            do {
                try await Task.sleep(for: .seconds(delay))
                try await self?.refreshToken()
            } catch {
                if !Task.isCancelled {
                    logger.warning("Scheduled token refresh failed: \(error.localizedDescription, privacy: .public)")
                }
            }
        }
    }
}
