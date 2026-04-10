import Charts
import SwiftUI

/// A minimal line chart with a gradient fill -- no axes, no labels.
///
/// Colour is determined automatically: green when the last value exceeds
/// the first (upward trend), red otherwise.
///
/// ```swift
/// SparklineView(data: [10, 12, 9, 14, 13, 16])
/// SparklineView(data: prices, height: 60)
/// ```
struct SparklineView: View {

    let data: [Double]
    var height: CGFloat = 40
    var lineWidth: CGFloat = 1.5

    // MARK: - Derived state

    private var trendColor: Color {
        guard let first = data.first, let last = data.last else {
            return AppTheme.neutral
        }
        return last >= first ? AppTheme.profit : AppTheme.loss
    }

    private var indexedData: [(index: Int, value: Double)] {
        data.enumerated().map { (index: $0.offset, value: $0.element) }
    }

    // MARK: - Body

    var body: some View {
        if data.count < 2 {
            Rectangle()
                .fill(Color.clear)
                .frame(height: height)
        } else {
            Chart(indexedData, id: \.index) { point in
                LineMark(
                    x: .value("Index", point.index),
                    y: .value("Value", point.value)
                )
                .interpolationMethod(.catmullRom)
                .foregroundStyle(trendColor)
                .lineStyle(StrokeStyle(lineWidth: lineWidth, lineCap: .round))

                AreaMark(
                    x: .value("Index", point.index),
                    y: .value("Value", point.value)
                )
                .interpolationMethod(.catmullRom)
                .foregroundStyle(
                    LinearGradient(
                        colors: [trendColor.opacity(0.25), trendColor.opacity(0)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
            }
            .chartXAxis(.hidden)
            .chartYAxis(.hidden)
            .chartLegend(.hidden)
            .chartXScale(domain: 0 ... max(data.count - 1, 1))
            .chartYScale(domain: (data.min() ?? 0) ... (data.max() ?? 1))
            .frame(height: height)
        }
    }
}

// MARK: - Preview

#Preview {
    VStack(spacing: 16) {
        SparklineView(data: [10, 12, 9, 14, 11, 16, 15, 18])
        SparklineView(data: [18, 16, 17, 14, 12, 13, 10, 9])
        SparklineView(data: [5, 5, 5, 5], height: 30)
    }
    .padding()
    .background(AppTheme.background)
}
