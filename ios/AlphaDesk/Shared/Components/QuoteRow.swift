import SwiftUI

/// A single row for a position or watchlist item.
///
/// Displays the ticker symbol, quantity, current price, P&L, and an
/// optional mini sparkline. Designed to be placed inside a `List` or
/// `LazyVStack` with dark styling.
///
/// ```swift
/// QuoteRow(
///     symbol: "AAPL",
///     shares: 150,
///     price: 189.34,
///     pnl: 2345.00,
///     pnlPercent: 4.12,
///     sparklineData: [180, 183, 181, 186, 189]
/// )
/// ```
struct QuoteRow: View {

    let symbol: String
    var companyName: String? = nil
    var shares: Double = 0
    var price: Double = 0
    var pnl: Double = 0
    var pnlPercent: Double = 0
    var sparklineData: [Double] = []
    var onTap: (() -> Void)? = nil

    var body: some View {
        Button {
            onTap?()
        } label: {
            HStack(spacing: 12) {
                // Left: symbol + meta
                VStack(alignment: .leading, spacing: 3) {
                    Text(symbol)
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(AppTheme.textPrimary)

                    if let companyName {
                        Text(companyName)
                            .font(AppTheme.captionFont)
                            .foregroundStyle(AppTheme.textTertiary)
                            .lineLimit(1)
                    } else if shares != 0 {
                        Text("\(Int(shares)) shares @ \(price.formatCurrency())")
                            .font(AppTheme.captionFont)
                            .foregroundStyle(AppTheme.textTertiary)
                            .lineLimit(1)
                    }
                }

                Spacer(minLength: 4)

                // Center: sparkline
                if sparklineData.count >= 2 {
                    SparklineView(data: sparklineData, height: 28, lineWidth: 1.2)
                        .frame(width: 56)
                }

                // Right: P&L
                VStack(alignment: .trailing, spacing: 3) {
                    Text(price.formatCurrency())
                        .font(AppTheme.monoFont)
                        .foregroundStyle(AppTheme.textPrimary)
                        .monospacedDigit()

                    PnLText(
                        value: pnl,
                        showPercent: true,
                        percent: pnlPercent,
                        font: AppTheme.monoSmall
                    )
                }
            }
            .padding(.vertical, 10)
            .padding(.horizontal, AppTheme.paddingM)
            .contentShape(Rectangle()) // entire row tappable
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Convenience: list divider

/// A thin separator styled for dark lists (same look as Apple Stocks app).
struct QuoteDivider: View {
    var body: some View {
        Rectangle()
            .fill(AppTheme.border)
            .frame(height: 1)
            .padding(.leading, AppTheme.paddingM)
    }
}

// MARK: - Preview

#Preview {
    VStack(spacing: 0) {
        QuoteRow(
            symbol: "AAPL",
            companyName: "Apple Inc.",
            shares: 150,
            price: 189.34,
            pnl: 2345.00,
            pnlPercent: 4.12,
            sparklineData: [180, 183, 179, 185, 188, 186, 189]
        )
        QuoteDivider()
        QuoteRow(
            symbol: "TSLA",
            shares: 50,
            price: 245.12,
            pnl: -1230.50,
            pnlPercent: -2.87,
            sparklineData: [260, 255, 250, 248, 246, 245]
        )
        QuoteDivider()
        QuoteRow(
            symbol: "NVDA",
            shares: 200,
            price: 875.60,
            pnl: 14500.00,
            pnlPercent: 12.34,
            sparklineData: [780, 800, 830, 845, 860, 870, 875]
        )
    }
    .background(AppTheme.background)
}
