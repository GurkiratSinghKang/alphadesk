import SwiftUI
import Charts

// MARK: - View Model

@Observable
final class StrategiesListViewModel {
    var strategies: [StrategySummaryItem] = []
    var isLoading = true
    var error: String?

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

    @MainActor
    func refresh() async {
        if strategies.isEmpty { isLoading = true }
        error = nil

        do {
            let apiStrategies: [Strategy] = try await APIClient.shared.request(.strategies)
            strategies = apiStrategies.map { s in
                let status: StrategyListStatus
                switch s.status {
                case .active: status = .active
                case .paused: status = .paused
                case .backtest: status = .backtest
                }

                return StrategySummaryItem(
                    id: s.id,
                    name: s.name,
                    description: s.description,
                    status: status,
                    returnPercent: s.totalReturnPct,
                    winRate: s.winRate,
                    sharpe: s.sharpeRatio,
                    positionsCount: s.activePositionsCount,
                    sparkline: generateSparkline(seed: s.id.hashValue, trend: s.totalReturnPct / 50.0)
                )
            }
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
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
    var rng = SparklineRNG(seed: UInt64(abs(seed) &* 12345))
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
            Group {
                if vm.isLoading {
                    LoadingView()
                        .transition(.opacity)
                } else if let error = vm.error, vm.strategies.isEmpty {
                    errorView(error)
                        .transition(.opacity)
                } else if vm.strategies.isEmpty {
                    ContentUnavailableView(
                        "No Strategies",
                        systemImage: "brain.head.profile",
                        description: Text("Your trading strategies will appear here")
                    )
                    .transition(.opacity)
                } else {
                    ScrollView(.vertical, showsIndicators: false) {
                        VStack(spacing: AD.spacingLG) {
                            summaryBar
                            strategyCards
                        }
                        .padding(.horizontal, AD.spacingMD)
                        .padding(.top, AD.spacingSM)
                        .padding(.bottom, 100)
                    }
                    .refreshable { await vm.refresh() }
                    .transition(.opacity)
                }
            }
            .animation(.easeInOut, value: vm.isLoading)
            .background(AD.background)
            .navigationTitle("Strategies")
            .navigationBarTitleDisplayMode(.large)
            .toolbarBackground(AD.background, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .task { await vm.refresh() }
        }
    }

    // MARK: - Error

    private func errorView(_ message: String) -> some View {
        VStack(spacing: AD.spacingMD) {
            Spacer()
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 40))
                .foregroundStyle(AD.loss)
            Text("Failed to load strategies")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(AD.textPrimary)
            Text(message)
                .font(.system(size: 14))
                .foregroundStyle(AD.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, AD.spacingXL)
            Button {
                Task { await vm.refresh() }
            } label: {
                Text("Retry")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, AD.spacingXL)
                    .padding(.vertical, 12)
                    .background(AD.accent)
                    .clipShape(Capsule())
            }
            Spacer()
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
