import Foundation
import SwiftUI

// MARK: - Financial number formatting utilities

extension Double {

    // MARK: Currency

    /// Formats as US-dollar currency: `$1,234.56`.
    func formatCurrency() -> String {
        let formatter = NumberFormatter.currencyFormatter
        return formatter.string(from: NSNumber(value: self)) ?? "$0.00"
    }

    // MARK: Percent

    /// Formats as a signed percentage: `+1.23%` or `-0.45%`.
    func formatPercent() -> String {
        let sign = self >= 0 ? "+" : ""
        let formatter = NumberFormatter.percentValueFormatter
        let formatted = formatter.string(from: NSNumber(value: self)) ?? "0.00"
        return "\(sign)\(formatted)%"
    }

    // MARK: Compact

    /// Human-friendly compact notation: `1.2M`, `3.4K`, `890`.
    func formatCompact() -> String {
        let abs = abs(self)
        let sign = self < 0 ? "-" : ""

        switch abs {
        case 1_000_000_000...:
            return "\(sign)\(String(format: "%.1f", abs / 1_000_000_000))B"
        case 1_000_000...:
            return "\(sign)\(String(format: "%.1f", abs / 1_000_000))M"
        case 1_000...:
            return "\(sign)\(String(format: "%.1f", abs / 1_000))K"
        default:
            return "\(sign)\(String(format: "%.0f", abs))"
        }
    }

    // MARK: P&L

    /// Formats as a signed dollar P&L string: `+$1,234.56` or `-$567.89`.
    func formatPnL() -> String {
        let sign = self >= 0 ? "+" : "-"
        let formatter = NumberFormatter.currencyFormatter
        let formatted = formatter.string(from: NSNumber(value: abs(self))) ?? "$0.00"
        return "\(sign)\(formatted)"
    }

    /// Returns `AppTheme.profit` for non-negative values and `AppTheme.loss` for negative.
    var pnlColor: Color {
        self >= 0 ? AppTheme.profit : AppTheme.loss
    }
}

// MARK: - Cached formatters (thread-safe singletons)

private extension NumberFormatter {

    static let currencyFormatter: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = "USD"
        f.locale = Locale(identifier: "en_US")
        f.minimumFractionDigits = 2
        f.maximumFractionDigits = 2
        return f
    }()

    static let percentValueFormatter: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.minimumFractionDigits = 2
        f.maximumFractionDigits = 2
        return f
    }()
}
