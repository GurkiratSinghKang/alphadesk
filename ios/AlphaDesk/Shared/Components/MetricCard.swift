import SwiftUI

/// A compact dark-surface card that displays a single KPI.
///
/// Used across Dashboard, Strategy Detail, and Pipeline views
/// to surface key numbers at a glance.
///
/// ```swift
/// MetricCard(label: "TOTAL P&L", value: "$12,345")
/// MetricCard(label: "WIN RATE", value: "68.2%", subtext: "+2.1% vs avg")
/// ```
struct MetricCard: View {

    let label: String
    let value: String
    var subtext: String? = nil
    var valueColor: Color = AppTheme.textPrimary

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased())
                .font(AppTheme.captionFont)
                .foregroundStyle(AppTheme.textTertiary)
                .tracking(0.8)

            Text(value)
                .font(.system(size: 22, weight: .bold, design: .monospaced))
                .foregroundStyle(valueColor)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.7)

            if let subtext {
                Text(subtext)
                    .font(AppTheme.monoSmall)
                    .foregroundStyle(AppTheme.textSecondary)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(AppTheme.paddingM)
        .background(
            RoundedRectangle(cornerRadius: AppTheme.cornerRadius, style: .continuous)
                .fill(AppTheme.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: AppTheme.cornerRadius, style: .continuous)
                .strokeBorder(AppTheme.border, lineWidth: 1)
        )
    }
}

// MARK: - Preview

#Preview {
    HStack(spacing: 12) {
        MetricCard(label: "Total P&L", value: "$12,345", subtext: "+3.2% today", valueColor: AppTheme.profit)
        MetricCard(label: "Win Rate", value: "68.2%", subtext: "Last 30 days")
    }
    .padding()
    .background(AppTheme.background)
}
