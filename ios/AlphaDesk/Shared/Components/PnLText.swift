import SwiftUI

/// Displays a profit / loss value with automatic colour coding.
///
/// Text is rendered in monospaced tabular figures so columns of numbers
/// align perfectly in lists and tables.
///
/// ```swift
/// PnLText(value: 1234.56)                      // +$1,234.56  (green)
/// PnLText(value: -567.89, showPercent: true,
///         percent: -2.34)                       // -$567.89  -2.34%
/// ```
struct PnLText: View {

    let value: Double
    var showPercent: Bool = false
    var percent: Double = 0
    var font: Font = AppTheme.monoFont

    var body: some View {
        HStack(spacing: 6) {
            Text(value.formatPnL())
                .font(font)
                .foregroundStyle(value.pnlColor)
                .monospacedDigit()

            if showPercent {
                Text(percent.formatPercent())
                    .font(AppTheme.monoSmall)
                    .foregroundStyle(percent.pnlColor.opacity(0.85))
                    .monospacedDigit()
            }
        }
    }
}

// MARK: - Preview

#Preview("Positive") {
    VStack(alignment: .trailing, spacing: 12) {
        PnLText(value: 12_345.67)
        PnLText(value: 12_345.67, showPercent: true, percent: 3.42)
        PnLText(value: -890.12, showPercent: true, percent: -1.05)
        PnLText(value: 0)
    }
    .padding()
    .background(AppTheme.background)
}
