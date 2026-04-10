import SwiftUI

/// Central design tokens for the AlphaDesk trading interface.
///
/// Every screen and component should reference these constants instead of
/// hard-coding colours, fonts, or spacing values.
enum AppTheme {

    // MARK: - Colors

    /// Primary background -- near-black foundation.
    static let background = Color(hex: "0A0A0F")

    /// Card / surface background.
    static let surface = Color(hex: "13131A")

    /// Elevated cards and popovers.
    static let surfaceElevated = Color(hex: "1C1C28")

    /// Subtle separator / card border.
    static let border = Color.white.opacity(0.06)

    /// Electric-blue accent used for interactive elements.
    static let accent = Color(hex: "4F8FFF")

    /// Positive P&L / upward trend.
    static let profit = Color(hex: "22C55E")

    /// Negative P&L / downward trend.
    static let loss = Color(hex: "EF4444")

    /// Muted / neutral text.
    static let neutral = Color(hex: "94A3B8")

    /// High-emphasis text on dark backgrounds.
    static let textPrimary = Color.white

    /// Medium-emphasis body text.
    static let textSecondary = Color.white.opacity(0.6)

    /// Low-emphasis captions and labels.
    static let textTertiary = Color.white.opacity(0.35)

    // MARK: - Typography

    /// Large hero numbers (portfolio total, strategy return).
    static let heroFont = Font.system(size: 36, weight: .bold, design: .default)

    /// Section titles and card headers.
    static let titleFont = Font.system(size: 20, weight: .semibold)

    /// Standard body text.
    static let bodyFont = Font.system(size: 14, weight: .regular)

    /// Small all-caps labels.
    static let captionFont = Font.system(size: 11, weight: .medium)

    /// Monospaced numbers at body size.
    static let monoFont = Font.system(size: 14, weight: .medium, design: .monospaced)

    /// Monospaced numbers -- compact variant.
    static let monoSmall = Font.system(size: 12, weight: .medium, design: .monospaced)

    // MARK: - Spacing

    /// 8 pt -- tight inner padding.
    static let paddingS: CGFloat = 8

    /// 16 pt -- standard padding.
    static let paddingM: CGFloat = 16

    /// 24 pt -- section-level padding.
    static let paddingL: CGFloat = 24

    /// Default card corner radius.
    static let cornerRadius: CGFloat = 14

    /// Smaller pill / badge radius.
    static let cornerRadiusSmall: CGFloat = 8
}
