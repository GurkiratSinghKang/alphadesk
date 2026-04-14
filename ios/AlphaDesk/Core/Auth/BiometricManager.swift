import Foundation
import LocalAuthentication
import Observation

@Observable
final class BiometricManager {
    static let shared = BiometricManager()

    var isAvailable: Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
    }

    var isEnabled: Bool {
        UserDefaults.standard.bool(forKey: "biometric_lock_enabled")
    }

    func authenticate() async -> Bool {
        let context = LAContext()
        context.localizedReason = "Unlock AlphaDesk"
        do {
            return try await context.evaluatePolicy(
                .deviceOwnerAuthenticationWithBiometrics,
                localizedReason: "Authenticate to access AlphaDesk"
            )
        } catch {
            return false
        }
    }
}
