import SwiftUI

// MARK: - App Entry Point

@main
struct AlphaDeskApp: App {

    @State private var authManager = AuthManager.shared

    var body: some Scene {
        WindowGroup {
            Group {
                if authManager.isAuthenticated {
                    MainTabView()
                        .transition(.opacity.combined(with: .scale(scale: 0.98)))
                } else {
                    LoginView()
                        .transition(.opacity.combined(with: .scale(scale: 1.02)))
                }
            }
            .animation(.easeInOut(duration: 0.4), value: authManager.isAuthenticated)
            .environment(authManager)
            .preferredColorScheme(.dark)
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
