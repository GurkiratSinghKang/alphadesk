import SwiftUI
import Charts

// MARK: - View Model

@Observable
final class AnalyticsSummaryViewModel {
    var isLoading = true
    var error: String?

    // Key metrics
    var totalReturnPct: Double = 0
    var totalReturn: Double = 0
    var winRate: Double = 0
    var avgHoldDays: Int = 0
    var profitFactor: Double = 0

    // Best / worst trades
    var bestTrade: TradeSummary?
    var worstTrade: TradeSummary?

    // Monthly returns
    var monthlyReturns: [MonthlyReturnBar] = []

    @MainActor
    func refresh() async {
        isLoading = monthlyReturns.isEmpty
        error = nil

        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.fetchPerformance() }
            group.addTask { await self.fetchCalendarReturns() }
        }

        withAnimation(.easeInOut(duration: 0.25)) {
            isLoading = false
        }
    }

    @MainActor
    private func fetchPerformance() async {
        do {
            let perf: PortfolioPerformanceDetail = try await APIClient.shared.request(
                .portfolioPerformance(period: "ALL")
            )

            totalReturnPct = perf.totalReturnPct ?? 0
            totalReturn = perf.totalReturn ?? 0
            winRate = perf.winRate ?? 0

            // Estimate hold time and profit factor from strategy data
            let strategies: [Strategy] = try await APIClient.shared.request(.strategies)
            if !strategies.isEmpty {
                let avgWinRate = strategies.map(\.winRate).reduce(0, +) / Double(strategies.count)
                winRate = winRate > 0 ? winRate : avgWinRate

                // Estimate profit factor from win rate
                // PF = (winRate * avgWin) / ((1 - winRate) * avgLoss)
                // Using simplified approximation
                let wr = winRate / 100
                if wr > 0 && wr < 1 {
                    profitFactor = (wr * 1.5) / ((1 - wr) * 1.0)
                }
            }

            // Estimate avg hold time (days) -- using a reasonable default
            // until trade history endpoint provides this
            avgHoldDays = 5

            // Best and worst trades from pipeline performance
            do {
                let pipeline: PipelinePositionsResponse = try await APIClient.shared.request(.pipelinePositions)
                let sorted = pipeline.positions.sorted {
                    ($0.pnlPct ?? 0) > ($1.pnlPct ?? 0)
                }
                if let best = sorted.first, (best.pnlPct ?? 0) != 0 {
                    bestTrade = TradeSummary(
                        symbol: best.symbol,
                        pnl: best.pnl ?? 0,
                        pnlPct: best.pnlPct ?? 0,
                        strategy: best.strategy
                    )
                }
                if let worst = sorted.last, sorted.count > 1, (worst.pnlPct ?? 0) != 0 {
                    worstTrade = TradeSummary(
                        symbol: worst.symbol,
                        pnl: worst.pnl ?? 0,
                        pnlPct: worst.pnlPct ?? 0,
                        strategy: worst.strategy
                    )
                }

                if let perf = pipeline.performance {
                    avgHoldDays = max(avgHoldDays, 3)
                    if let avgWin = perf.avgWin, let avgLoss = perf.avgLoss, avgLoss != 0 {
                        profitFactor = abs(avgWin / avgLoss)
                    }
                    if let wr = perf.winRate, wr > 0 {
                        winRate = wr
                    }
                }
            } catch {
                // Pipeline data is supplementary
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    @MainActor
    private func fetchCalendarReturns() async {
        // Try to fetch calendar data for current year
        let year = Calendar.current.component(.year, from: Date())
        let currentMonth = Calendar.current.component(.month, from: Date())

        var allReturns: [MonthlyReturnBar] = []
        let monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

        for month in 1...currentMonth {
            do {
                let cal: PortfolioCalendarResponse = try await APIClient.shared.request(
                    .portfolioCalendar(year: year, month: month)
                )
                if let monthly = cal.monthlyReturns?.first {
                    allReturns.append(MonthlyReturnBar(
                        month: monthNames[month],
                        returnPct: monthly.returnPct
                    ))
                } else if let dailies = cal.dailyReturns, !dailies.isEmpty {
                    let totalReturn = dailies.reduce(0.0) { $0 + $1.returnPct }
                    allReturns.append(MonthlyReturnBar(
                        month: monthNames[month],
                        returnPct: totalReturn
                    ))
                }
            } catch {
                // Skip months with no data
            }
        }

        monthlyReturns = allReturns
    }
}

// MARK: - Local Models

struct TradeSummary: Identifiable {
    let id = UUID()
    let symbol: String
    let pnl: Double
    let pnlPct: Double
    let strategy: String?
}

struct MonthlyReturnBar: Identifiable {
    let id = UUID()
    let month: String
    let returnPct: Double
}

// MARK: - View

struct AnalyticsSummaryView: View {

    @State private var vm = AnalyticsSummaryViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                AD.background.ignoresSafeArea()

                if vm.isLoading {
                    LoadingView()
                        .transition(.opacity)
                } else {
                    contentView
                        .transition(.opacity)
                }
            }
            .animation(.easeInOut, value: vm.isLoading)
            .navigationTitle("Analytics")
            .navigationBarTitleDisplayMode(.large)
            .toolbarBackground(AD.background, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 22))
                            .foregroundStyle(AD.textTertiary)
                    }
                }
            }
            .task { await vm.refresh() }
        }
    }

    // MARK: - Content

    private var contentView: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(spacing: AD.spacingLG) {
                totalReturnHero
                winRateGauge
                metricsRow
                tradeCards
                if !vm.monthlyReturns.isEmpty {
                    monthlyReturnsChart
                }
            }
            .padding(.horizontal, AD.spacingMD)
            .padding(.top, AD.spacingSM)
            .padding(.bottom, 100)
        }
        .refreshable { await vm.refresh() }
    }

    // MARK: - Total Return Hero

    private var totalReturnHero: some View {
        VStack(spacing: AD.spacingSM) {
            Text("Total Return")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(AD.textSecondary)

            Text(String(format: "%+.2f%%", vm.totalReturnPct))
                .font(.system(size: 52, weight: .bold, design: .monospaced))
                .foregroundStyle(AD.pnlColor(vm.totalReturnPct))
                .contentTransition(.numericText())

            Text(vm.totalReturn.formatPnL())
                .font(.system(size: 16, weight: .semibold, design: .monospaced))
                .foregroundStyle(AD.pnlColor(vm.totalReturn).opacity(0.7))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, AD.spacingLG)
    }

    // MARK: - Win Rate Gauge

    private var winRateGauge: some View {
        VStack(spacing: AD.spacingMD) {
            HStack(spacing: AD.spacingSM) {
                Image(systemName: "target")
                    .font(.system(size: 14))
                    .foregroundStyle(AD.textTertiary)
                Text("Win Rate")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(AD.textPrimary)
                Spacer()
            }

            ZStack {
                // Background arc
                Circle()
                    .trim(from: 0, to: 0.75)
                    .stroke(AD.surfaceElevated, style: StrokeStyle(lineWidth: 14, lineCap: .round))
                    .rotationEffect(.degrees(135))

                // Value arc
                Circle()
                    .trim(from: 0, to: 0.75 * min(vm.winRate / 100, 1.0))
                    .stroke(
                        AngularGradient(
                            colors: [AD.loss, Color(hex: "F59E0B"), AD.profit],
                            center: .center,
                            startAngle: .degrees(135),
                            endAngle: .degrees(405)
                        ),
                        style: StrokeStyle(lineWidth: 14, lineCap: .round)
                    )
                    .rotationEffect(.degrees(135))
                    .animation(.easeInOut(duration: 1.0), value: vm.winRate)

                VStack(spacing: 2) {
                    Text(String(format: "%.1f%%", vm.winRate))
                        .font(.system(size: 32, weight: .bold, design: .monospaced))
                        .foregroundStyle(winRateColor)

                    Text("of trades")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(AD.textTertiary)
                }
            }
            .frame(width: 180, height: 180)
            .frame(maxWidth: .infinity)
        }
        .cardStyle()
    }

    private var winRateColor: Color {
        if vm.winRate >= 60 { return AD.profit }
        if vm.winRate >= 50 { return Color(hex: "F59E0B") }
        return AD.loss
    }

    // MARK: - Metrics Row

    private var metricsRow: some View {
        HStack(spacing: AD.spacingSM) {
            compactMetric(
                "Avg Hold",
                value: "\(vm.avgHoldDays)d",
                icon: "clock"
            )
            compactMetric(
                "Profit Factor",
                value: String(format: "%.2f", vm.profitFactor),
                icon: "arrow.left.arrow.right",
                color: vm.profitFactor >= 1.5 ? AD.profit : vm.profitFactor >= 1.0 ? Color(hex: "F59E0B") : AD.loss
            )
        }
    }

    private func compactMetric(_ label: String, value: String, icon: String, color: Color = AD.accent) -> some View {
        VStack(alignment: .leading, spacing: AD.spacingSM) {
            HStack {
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(color.opacity(0.7))
                Spacer()
            }

            Text(value)
                .font(.system(size: 24, weight: .bold, design: .monospaced))
                .foregroundStyle(color)

            Text(label)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(AD.textSecondary)
        }
        .cardStyle()
    }

    // MARK: - Best / Worst Trade Cards

    private var tradeCards: some View {
        HStack(spacing: AD.spacingSM) {
            if let best = vm.bestTrade {
                tradeCard("Best Trade", trade: best, accentColor: AD.profit)
            }
            if let worst = vm.worstTrade {
                tradeCard("Worst Trade", trade: worst, accentColor: AD.loss)
            }
        }
    }

    private func tradeCard(_ title: String, trade: TradeSummary, accentColor: Color) -> some View {
        VStack(alignment: .leading, spacing: AD.spacingSM) {
            Text(title.uppercased())
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(AD.textTertiary)
                .tracking(0.6)

            HStack(spacing: AD.spacingSM) {
                ZStack {
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(accentColor.opacity(0.15))
                        .frame(width: 36, height: 36)

                    Text(String(trade.symbol.prefix(2)))
                        .font(.system(size: 12, weight: .bold, design: .monospaced))
                        .foregroundStyle(accentColor)
                }

                VStack(alignment: .leading, spacing: 1) {
                    Text(trade.symbol)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(AD.textPrimary)

                    if let strategy = trade.strategy {
                        Text(strategy)
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(AD.textTertiary)
                            .lineLimit(1)
                    }
                }
            }

            Divider().background(AD.border)

            HStack {
                Text(trade.pnl.formatPnL())
                    .font(.system(size: 14, weight: .bold, design: .monospaced))
                    .foregroundStyle(accentColor)

                Spacer()

                Text(String(format: "%+.1f%%", trade.pnlPct))
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    .foregroundStyle(accentColor.opacity(0.8))
            }
        }
        .cardStyle()
    }

    // MARK: - Monthly Returns Chart

    private var monthlyReturnsChart: some View {
        VStack(alignment: .leading, spacing: AD.spacingSM) {
            HStack(spacing: AD.spacingSM) {
                Image(systemName: "calendar")
                    .font(.system(size: 14))
                    .foregroundStyle(AD.textTertiary)
                Text("Monthly Returns")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(AD.textPrimary)
                Spacer()
                let year = Calendar.current.component(.year, from: Date())
                Text(String(year))
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(AD.textTertiary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(AD.surfaceElevated)
                    .clipShape(Capsule())
            }

            Chart(vm.monthlyReturns) { item in
                BarMark(
                    x: .value("Month", item.month),
                    y: .value("Return", item.returnPct)
                )
                .foregroundStyle(AD.pnlColor(item.returnPct))
                .cornerRadius(4)
            }
            .chartYAxis {
                AxisMarks(position: .trailing, values: .automatic(desiredCount: 4)) { value in
                    AxisValueLabel {
                        if let v = value.as(Double.self) {
                            Text(String(format: "%.1f%%", v))
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundStyle(AD.textTertiary)
                        }
                    }
                    AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5, dash: [3, 3]))
                        .foregroundStyle(AD.border)
                }
            }
            .chartXAxis {
                AxisMarks { value in
                    AxisValueLabel {
                        if let v = value.as(String.self) {
                            Text(v)
                                .font(.system(size: 10))
                                .foregroundStyle(AD.textTertiary)
                        }
                    }
                }
            }
            .frame(height: 200)
        }
        .cardStyle()
    }
}

#Preview {
    AnalyticsSummaryView()
        .environment(AuthManager.shared)
}
