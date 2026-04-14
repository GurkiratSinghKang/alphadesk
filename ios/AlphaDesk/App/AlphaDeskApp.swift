import SwiftUI

// MARK: - App Entry Point

@main
struct AlphaDeskApp: App {

    @State private var authManager = AuthManager.shared
    @State private var biometricManager = BiometricManager.shared
    @State private var isUnlocked = false
    @State private var biometricFailed = false

    var body: some Scene {
        WindowGroup {
            Group {
                if authManager.isAuthenticated {
                    if biometricManager.isEnabled && !isUnlocked {
                        LockScreenView(
                            isUnlocked: $isUnlocked,
                            biometricFailed: $biometricFailed
                        )
                        .transition(.opacity)
                    } else {
                        MainTabView()
                            .transition(.opacity.combined(with: .scale(scale: 0.98)))
                    }
                } else {
                    LoginView()
                        .transition(.opacity.combined(with: .scale(scale: 1.02)))
                }
            }
            .animation(.easeInOut(duration: 0.4), value: authManager.isAuthenticated)
            .animation(.easeInOut(duration: 0.3), value: isUnlocked)
            .environment(authManager)
            .preferredColorScheme(.dark)
            .onChange(of: authManager.isAuthenticated) { _, authenticated in
                if !authenticated {
                    isUnlocked = false
                    biometricFailed = false
                }
            }
        }
    }
}

// MARK: - Lock Screen

struct LockScreenView: View {
    @Binding var isUnlocked: Bool
    @Binding var biometricFailed: Bool
    @State private var isAuthenticating = false

    var body: some View {
        ZStack {
            AD.background.ignoresSafeArea()

            VStack(spacing: AD.spacingXL) {
                Spacer()

                // Logo
                ZStack {
                    Circle()
                        .fill(AD.accent.opacity(0.1))
                        .frame(width: 100, height: 100)

                    Image(systemName: "chart.line.uptrend.xyaxis")
                        .font(.system(size: 40, weight: .semibold))
                        .foregroundStyle(AD.accent)
                }

                VStack(spacing: AD.spacingSM) {
                    Text("AlphaDesk")
                        .font(.system(size: 28, weight: .bold))
                        .foregroundStyle(AD.textPrimary)

                    Text("Locked")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(AD.textTertiary)
                }

                if biometricFailed {
                    Text("Authentication failed. Try again.")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(AD.loss)
                        .transition(.opacity)
                }

                Spacer()

                Button {
                    Task { await authenticate() }
                } label: {
                    HStack(spacing: AD.spacingSM) {
                        if isAuthenticating {
                            ProgressView()
                                .tint(.white)
                                .scaleEffect(0.85)
                        } else {
                            Image(systemName: "faceid")
                                .font(.system(size: 20))
                            Text("Unlock with Face ID")
                                .font(.system(size: 17, weight: .semibold))
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(AD.accent)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: AD.radiusMD, style: .continuous))
                    .shadow(color: AD.accent.opacity(0.25), radius: 12, y: 6)
                }
                .disabled(isAuthenticating)
                .padding(.horizontal, AD.spacingXL)
                .padding(.bottom, AD.spacingXL)
            }
        }
        .task {
            await authenticate()
        }
    }

    private func authenticate() async {
        isAuthenticating = true
        biometricFailed = false
        let success = await BiometricManager.shared.authenticate()
        isAuthenticating = false
        if success {
            isUnlocked = true
        } else {
            biometricFailed = true
        }
    }
}

// MARK: - Design Tokens

/// Screen-level design tokens that complement the shared AppTheme.
/// `AD` provides convenience accessors with short names for inline use
/// throughout the feature screens.
enum AD {
    // Colors -- mirrors AppTheme but with additional granularity
    static let background = AppTheme.background
    static let surface = AppTheme.surface
    static let surfaceElevated = AppTheme.surfaceElevated
    static let border = AppTheme.border
    static let borderSubtle = Color.white.opacity(0.03)
    static let accent = AppTheme.accent
    static let accentDim = AppTheme.accent.opacity(0.15)
    static let profit = AppTheme.profit
    static let loss = AppTheme.loss
    static let textPrimary = AppTheme.textPrimary
    static let textSecondary = AppTheme.textSecondary
    static let textTertiary = AppTheme.textTertiary

    // Spacing
    static let spacingXS: CGFloat = 4
    static let spacingSM: CGFloat = 8
    static let spacingMD: CGFloat = 16
    static let spacingLG: CGFloat = 24
    static let spacingXL: CGFloat = 32
    static let spacingXXL: CGFloat = 48

    // Radii
    static let radiusSM: CGFloat = 8
    static let radiusMD: CGFloat = 12
    static let radiusLG: CGFloat = 16
    static let radiusXL: CGFloat = 20

    // Helpers
    static func pnlColor(_ value: Double) -> Color {
        value >= 0 ? profit : loss
    }

    static func pnlSign(_ value: Double) -> String {
        value >= 0 ? "+" : ""
    }
}

// MARK: - Card Modifier

struct CardStyle: ViewModifier {
    var padding: CGFloat = AD.spacingMD

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(AD.surface)
            .clipShape(RoundedRectangle(cornerRadius: AD.radiusMD, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: AD.radiusMD, style: .continuous)
                    .stroke(AD.border, lineWidth: 1)
            )
    }
}

extension View {
    func cardStyle(padding: CGFloat = AD.spacingMD) -> some View {
        modifier(CardStyle(padding: padding))
    }
}
