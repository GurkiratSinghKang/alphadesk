import SwiftUI
import Charts

// MARK: - View Model

@Observable
final class StrategiesListViewModel {
    var strategies: [StrategySummaryItem] = [
        StrategySummaryItem(
            id: "momentum-quality",
            name: "Momentum + Quality",
            description: "Relative strength with quality factor screens",
            status: .active,
            returnPercent: 12.4,
            winRate: 64.2,
            sharpe: 1.82,
            positionsCount: 3,
            sparkline: generateSparkline(seed: 1, trend: 0.4)
        ),
        StrategySummaryItem(
            id: "pead",
            name: "PEAD",
            description: "Post-earnings announcement drift",
            status: .active,
            returnPercent: 8.7,
            winRate: 58.3,
            sharpe: 1.45,
            positionsCount: 2,
            sparkline: generateSparkline(seed: 2, trend: 0.3)
        ),
        StrategySummaryItem(
            id: "vrp-harvesting",
            name: "VRP Harvesting",
            description: "Systematic short options vol premium",
            status: .active,
            returnPercent: 15.1,
            winRate: 72.0,
            sharpe: 2.10,
            positionsCount: 4,
            sparkline: generateSparkline(seed: 3, trend: 0.5)
        ),
        StrategySummaryItem(
            id: "earnings-vol-premium",
            name: "Earnings Vol Premium",
            description: "IV vs RV spread around earnings events",
            status: .paused,
            returnPercent: -2.3,
            winRate: 45.0,
            sharpe: 0.42,
            positionsCount: 0,
            sparkline: generateSparkline(seed: 4, trend: -0.15)
        ),
        StrategySummaryItem(
            id: "regime-adaptive",
            name: "Regime Adaptive",
            description: "ML regime detection with strategy rotation",
            status: .active,
            returnPercent: 6.9,
            winRate: 55.8,
            sharpe: 1.21,
            positionsCount: 2,
            sparkline: generateSparkline(seed: 5, trend: 0.2)
        ),
        StrategySummaryItem(
            id: "claude-alpha",
            name: "Claude Alpha",
            description: "AI-driven opportunistic stock picking",
            status: .active,
            returnPercent: 18.6,
            winRate: 61.5,
            sharpe: 1.95,
            positionsCount: 5,
            sparkline: generateSparkline(seed: 6, trend: 0.6)
        ),
        StrategySummaryItem(
            id: "mean-reversion",
            name: "Mean Reversion",
            description: "Buy oversold quality stocks on reversion",
            status: .active,
            returnPercent: 4.2,
            winRate: 52.1,
            sharpe: 0.88,
            positionsCount: 1,
            sparkline: generateSparkline(seed: 7, trend: 0.1)
        ),
        StrategySummaryItem(
            id: "vcp-breakout",
            name: "VCP Breakout",
            description: "Volatility contraction pattern breakouts",
            status: .active,
            returnPercent: 9.8,
            winRate: 48.6,
            sharpe: 1.32,
            positionsCount: 3,
            sparkline: generateSparkline(seed: 8, trend: 0.35)
        ),
    ]

    var totalReturn: Double {
        guard !strategies.isEmpty else { return 0 }
        return strategies.reduce(0) { $0 + $1.returnPercent } / Double(strategies.count)
    }

    var activeCount: Int {
        strategies.filter { $0.status == .active }.count
    }

    var totalPositions: Int {
        strategies.reduce(0) { $0 + $1.positionsCount }
    }
}

// MARK: - Local Models

struct StrategySummaryItem: Identifiable {
    let id: String
    let name: String
    let description: String
    let status: StrategyListStatus
    let returnPercent: Double
    let winRate: Double
    let sharpe: Double
    let positionsCount: Int
    let sparkline: [Double]
}

enum StrategyListStatus: String {
    case active, paused, backtest

    var label: String { rawValue.capitalized }

    var color: Color {
        switch self {
        case .active: return AD.profit
        case .paused: return Color(hex: "F59E0B")
        case .backtest: return AD.accent
        }
    }
}

private func generateSparkline(seed: Int, trend: Double) -> [Double] {
    var rng = SparklineRNG(seed: UInt64(seed * 12345))
    var values: [Double] = []
    var current: Double = 100
    for _ in 0..<20 {
        let noise = (rng.nextDouble() - 0.5) * 6
        current += trend + noise
        current = max(current, 80)
        values.append(current)
    }
    return values
}

private struct SparklineRNG: RandomNumberGenerator {
    var state: UInt64

    init(seed: UInt64) { state = seed }

    mutating func next() -> UInt64 {
        state &+= 0x9E3779B97F4A7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9
        z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
        return z ^ (z >> 31)
    }

    mutating func nextDouble() -> Double {
        Double(next() >> 11) / Double(1 << 53)
    }
}

// MARK: - View

struct StrategiesListView: View {

    @State private var vm = StrategiesListViewModel()

    var body: some View {
        NavigationStack {
            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: AD.spacingLG) {
                    summaryBar
                    strategyCards
                }
                .padding(.horizontal, AD.spacingMD)
                .padding(.top, AD.spacingSM)
                .padding(.bottom, 100)
            }
            .background(AD.background)
            .navigationTitle("Strategies")
            .navigationBarTitleDisplayMode(.large)
            .toolbarBackground(AD.background, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }

    // MARK: - Summary

    private var summaryBar: some View {
        HStack(spacing: 0) {
            summaryMetric("Avg Return", value: "\(AD.pnlSign(vm.totalReturn))\(String(format: "%.1f", vm.totalReturn))%",
                          color: AD.pnlColor(vm.totalReturn))
            Divider().frame(height: 32).background(AD.border)
            summaryMetric("Active", value: "\(vm.activeCount)/\(vm.strategies.count)", color: AD.profit)
            Divider().frame(height: 32).background(AD.border)
            summaryMetric("Positions", value: "\(vm.totalPositions)", color: AD.accent)
        }
        .cardStyle(padding: AD.spacingMD)
    }

    private func summaryMetric(_ label: String, value: String, color: Color) -> some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.system(size: 17, weight: .bold, design: .monospaced))
                .foregroundStyle(color)
            Text(label)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(AD.textTertiary)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Cards

    private var strategyCards: some View {
        LazyVStack(spacing: AD.spacingSM) {
            ForEach(vm.strategies) { strategy in
                NavigationLink(value: strategy.id) {
                    strategyCard(strategy)
                }
                .buttonStyle(.plain)
            }
        }
        .navigationDestination(for: String.self) { id in
            StrategyDetailView(strategyId: id)
        }
    }

    private func strategyCard(_ strategy: StrategySummaryItem) -> some View {
        VStack(spacing: AD.spacingMD) {
            // Header
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: AD.spacingSM) {
                        Text(strategy.name)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(AD.textPrimary)

                        listStatusBadge(strategy.status)
                    }

                    Text(strategy.description)
                        .font(.system(size: 12, weight: .regular))
                        .foregroundStyle(AD.textTertiary)
                        .lineLimit(1)
                }

                Spacer()

                // Mini sparkline
                miniSparkline(strategy.sparkline, positive: strategy.returnPercent >= 0)
                    .frame(width: 60, height: 30)
            }

            // Metrics row
            HStack(spacing: 0) {
                metricPill("Return", value: "\(AD.pnlSign(strategy.returnPercent))\(String(format: "%.1f", strategy.returnPercent))%",
                           color: AD.pnlColor(strategy.returnPercent))
                metricPill("Win Rate", value: "\(String(format: "%.0f", strategy.winRate))%", color: AD.textPrimary)
                metricPill("Sharpe", value: String(format: "%.2f", strategy.sharpe), color: AD.textPrimary)
                metricPill("Pos.", value: "\(strategy.positionsCount)", color: AD.accent)
            }

            // Bottom row
            HStack {
                Spacer()
                HStack(spacing: 4) {
                    Text("View Details")
                        .font(.system(size: 12, weight: .medium))
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                }
                .foregroundStyle(AD.textTertiary)
            }
        }
        .cardStyle()
    }

    private func listStatusBadge(_ status: StrategyListStatus) -> some View {
        Text(status.label)
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(status.color)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(status.color.opacity(0.12))
            .clipShape(Capsule())
    }

    private func metricPill(_ label: String, value: String, color: Color) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.system(size: 14, weight: .semibold, design: .monospaced))
                .foregroundStyle(color)
            Text(label)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(AD.textTertiary)
        }
        .frame(maxWidth: .infinity)
    }

    private func miniSparkline(_ data: [Double], positive: Bool) -> some View {
        Chart(Array(data.enumerated()), id: \.offset) { index, value in
            LineMark(
                x: .value("X", index),
                y: .value("Y", value)
            )
            .foregroundStyle(positive ? AD.profit : AD.loss)
            .lineStyle(StrokeStyle(lineWidth: 1.5))
            .interpolationMethod(.catmullRom)
        }
        .chartXAxis(.hidden)
        .chartYAxis(.hidden)
        .chartYScale(domain: .automatic(includesZero: false))
    }
}

#Preview {
    StrategiesListView()
        .environment(AuthManager.shared)
}
