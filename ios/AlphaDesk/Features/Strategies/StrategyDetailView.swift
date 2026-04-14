import SwiftUI
import Charts

// MARK: - View Model

@Observable
final class StrategyDetailViewModel {
    let strategyId: String
    var name = ""
    var description = ""
    var status: StrategyListStatus = .active
    var isLoading = true
    var error: String?
    var isToggling = false

    // Metrics
    var totalReturn: Double = 0
    var annualizedReturn: Double = 0
    var sharpe: Double = 0
    var maxDrawdown: Double = 0
    var winRate: Double = 0
    var profitFactor: Double = 0
    var totalTrades: Int = 0
    var avgHoldDays: Double = 0
    var investedAmount: Double = 0
    var currentValue: Double = 0
    var returnDollars: Double = 0

    // Equity curve
    var equityCurve: [DetailEquityPoint] = []

    // Positions
    var positions: [StrategyPositionItem] = []

    init(strategyId: String) {
        self.strategyId = strategyId
    }

    @MainActor
    func refresh() async {
        if equityCurve.isEmpty { isLoading = true }
        error = nil

        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.fetchPerformance() }
            group.addTask { await self.fetchPositions() }
        }

        isLoading = false
    }

    @MainActor
    private func fetchPerformance() async {
        do {
            let perf: StrategyPerformance = try await APIClient.shared.request(
                .strategyPerformance(id: strategyId)
            )
            name = perf.name
            description = perf.description
            totalReturn = perf.totalReturnPct
            annualizedReturn = perf.annualizedReturnPct ?? 0
            sharpe = perf.sharpeRatio ?? 0
            maxDrawdown = perf.maxDrawdown ?? 0
            winRate = perf.winRate
            totalTrades = perf.activePositionsCount
            investedAmount = perf.investedAmount
            currentValue = perf.currentValue
            returnDollars = perf.returnDollars ?? 0

            switch perf.status {
            case .active: status = .active
            case .paused: status = .paused
            case .backtest: status = .backtest
            }

            // Parse equity curve
            let dateFormatter = DateFormatter()
            dateFormatter.locale = Locale(identifier: "en_US_POSIX")
            dateFormatter.dateFormat = "yyyy-MM-dd"
            dateFormatter.timeZone = TimeZone(abbreviation: "UTC")

            equityCurve = perf.equityCurve.compactMap { point in
                guard let value = point.value ?? point.cumulativePnl else { return nil }
                let date: Date
                if let d = point.date, let parsed = dateFormatter.date(from: d) {
                    date = parsed
                } else if let idx = point.index {
                    date = Calendar.current.date(byAdding: .day, value: -perf.equityCurve.count + idx, to: Date()) ?? Date()
                } else {
                    return nil
                }
                return DetailEquityPoint(date: date, value: value)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    @MainActor
    private func fetchPositions() async {
        do {
            let apiPositions: [StrategyPosition] = try await APIClient.shared.request(
                .strategyPositions(id: strategyId)
            )
            positions = apiPositions.map { p in
                StrategyPositionItem(
                    symbol: p.symbol,
                    side: p.side ?? "Long",
                    shares: Int(p.shares ?? p.quantity ?? 0),
                    entryPrice: p.entryPrice ?? 0,
                    currentPrice: p.currentPrice ?? 0,
                    pnl: p.pnl ?? 0,
                    pnlPercent: p.pnlPct ?? 0
                )
            }
        } catch {
            // Positions are non-fatal
        }
    }

    @MainActor
    func toggleStrategy() async {
        isToggling = true
        do {
            try await APIClient.shared.requestVoid(
                .strategyToggle(id: strategyId),
                method: .post
            )
            status = (status == .active) ? .paused : .active
        } catch {
            self.error = "Toggle failed: \(error.localizedDescription)"
        }
        isToggling = false
    }
}

struct DetailEquityPoint: Identifiable {
    let id = UUID()
    let date: Date
    var value: Double
}

struct StrategyPositionItem: Identifiable {
    let id = UUID()
    let symbol: String
    let side: String
    let shares: Int
    let entryPrice: Double
    let currentPrice: Double
    let pnl: Double
    let pnlPercent: Double
}

// MARK: - View

struct StrategyDetailView: View {

    let strategyId: String
    @State private var vm: StrategyDetailViewModel

    init(strategyId: String) {
        self.strategyId = strategyId
        _vm = State(initialValue: StrategyDetailViewModel(strategyId: strategyId))
    }

    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            if vm.isLoading {
                VStack {
                    Spacer(minLength: 200)
                    ProgressView()
                        .tint(AD.accent)
                    Spacer()
                }
                .transition(.opacity)
            } else if let error = vm.error, vm.equityCurve.isEmpty {
                errorView(error)
            } else {
                VStack(spacing: AD.spacingLG) {
                    headerSection
                    if !vm.equityCurve.isEmpty {
                        equityCurveSection
                    }
                    metricsGrid
                    if !vm.positions.isEmpty {
                        positionsSection
                    }
                    toggleSection
                }
                .padding(.horizontal, AD.spacingMD)
                .padding(.top, AD.spacingSM)
                .padding(.bottom, 100)
                .transition(.opacity)
            }
        }
        .animation(.easeInOut, value: vm.isLoading)
        .background(AD.background)
        .navigationTitle(vm.name)
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(AD.background, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .refreshable { await vm.refresh() }
        .task { await vm.refresh() }
    }

    // MARK: - Error

    private func errorView(_ message: String) -> some View {
        VStack(spacing: AD.spacingMD) {
            Spacer(minLength: 150)
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 40))
                .foregroundStyle(AD.loss)
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

    // MARK: - Header

    private var headerSection: some View {
        VStack(spacing: AD.spacingSM) {
            HStack {
                detailStatusBadge(vm.status)
                Spacer()
                Text("\(vm.totalTrades) positions")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(AD.textTertiary)
            }

            Text(vm.description)
                .font(.system(size: 14, weight: .regular))
                .foregroundStyle(AD.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func detailStatusBadge(_ status: StrategyListStatus) -> some View {
        HStack(spacing: 6) {
            Circle()
                .fill(status.color)
                .frame(width: 6, height: 6)
            Text(status.label)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(status.color)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(status.color.opacity(0.1))
        .clipShape(Capsule())
    }

    // MARK: - Equity Curve

    private var equityCurveSection: some View {
        VStack(alignment: .leading, spacing: AD.spacingSM) {
            HStack {
                Text("Equity Curve")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(AD.textPrimary)
                Spacer()

                VStack(alignment: .trailing, spacing: 2) {
                    Text("\(AD.pnlSign(vm.totalReturn))\(vm.totalReturn, specifier: "%.1f")%")
                        .font(.system(size: 16, weight: .bold, design: .monospaced))
                        .foregroundStyle(AD.pnlColor(vm.totalReturn))
                        .contentTransition(.numericText())
                    Text("Total Return")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(AD.textTertiary)
                }
            }

            Chart(vm.equityCurve) { point in
                AreaMark(
                    x: .value("Date", point.date),
                    yStart: .value("Base", vm.equityCurve.map(\.value).min() ?? 0),
                    yEnd: .value("Value", point.value)
                )
                .foregroundStyle(
                    LinearGradient(
                        colors: [
                            AD.pnlColor(vm.totalReturn).opacity(0.3),
                            AD.pnlColor(vm.totalReturn).opacity(0.02)
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .interpolationMethod(.catmullRom)

                LineMark(
                    x: .value("Date", point.date),
                    y: .value("Value", point.value)
                )
                .foregroundStyle(AD.pnlColor(vm.totalReturn))
                .lineStyle(StrokeStyle(lineWidth: 2.5))
                .interpolationMethod(.catmullRom)
            }
            .chartXAxis {
                AxisMarks(values: .automatic(desiredCount: 4)) { value in
                    AxisValueLabel {
                        if let d = value.as(Date.self) {
                            Text(d, format: .dateTime.month(.abbreviated).day())
                                .font(.system(size: 9))
                                .foregroundStyle(AD.textTertiary)
                        }
                    }
                }
            }
            .chartYAxis {
                AxisMarks(position: .trailing, values: .automatic(desiredCount: 4)) { value in
                    AxisValueLabel {
                        if let v = value.as(Double.self) {
                            Text(v / 1000, format: .number.precision(.fractionLength(1)))
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundStyle(AD.textTertiary)
                            + Text("k")
                                .font(.system(size: 9, design: .monospaced))
                                .foregroundStyle(AD.textTertiary)
                        }
                    }
                    AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5, dash: [3, 3]))
                        .foregroundStyle(AD.border)
                }
            }
            .chartYScale(domain: .automatic(includesZero: false))
            .frame(height: 220)
        }
        .cardStyle()
    }

    // MARK: - Metrics Grid

    private var metricsGrid: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: AD.spacingSM), count: 2), spacing: AD.spacingSM) {
            detailMetricCard("Return", value: "\(AD.pnlSign(vm.totalReturn))\(String(format: "%.1f", vm.totalReturn))%",
                       subtitle: "Ann. \(AD.pnlSign(vm.annualizedReturn))\(String(format: "%.1f", vm.annualizedReturn))%",
                       color: AD.pnlColor(vm.totalReturn),
                       icon: "chart.line.uptrend.xyaxis")
            detailMetricCard("Sharpe Ratio", value: String(format: "%.2f", vm.sharpe),
                       subtitle: vm.sharpe >= 1.5 ? "Excellent" : vm.sharpe >= 1.0 ? "Good" : "Fair",
                       color: vm.sharpe >= 1.5 ? AD.profit : vm.sharpe >= 1.0 ? AD.accent : AD.loss,
                       icon: "gauge.with.dots.needle.33percent")
            detailMetricCard("Max Drawdown", value: String(format: "%.1f%%", vm.maxDrawdown),
                       subtitle: "Peak to trough",
                       color: AD.loss,
                       icon: "arrow.down.right")
            detailMetricCard("Win Rate", value: String(format: "%.1f%%", vm.winRate),
                       subtitle: "Active positions: \(vm.totalTrades)",
                       color: vm.winRate >= 55 ? AD.profit : AD.textSecondary,
                       icon: "target")
        }
    }

    private func detailMetricCard(_ label: String, value: String, subtitle: String, color: Color, icon: String) -> some View {
        VStack(alignment: .leading, spacing: AD.spacingSM) {
            HStack {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(color.opacity(0.7))
                Spacer()
            }

            Text(value)
                .font(.system(size: 22, weight: .bold, design: .monospaced))
                .foregroundStyle(color)

            VStack(alignment: .leading, spacing: 1) {
                Text(label)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(AD.textSecondary)
                Text(subtitle)
                    .font(.system(size: 11, weight: .regular))
                    .foregroundStyle(AD.textTertiary)
            }
        }
        .cardStyle()
    }

    // MARK: - Positions

    private var positionsSection: some View {
        VStack(alignment: .leading, spacing: AD.spacingSM) {
            HStack {
                Text("Positions")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(AD.textPrimary)
                Spacer()
                Text("\(vm.positions.count) open")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(AD.textTertiary)
            }

            ForEach(vm.positions) { pos in
                positionRow(pos)
            }
        }
    }

    private func positionRow(_ pos: StrategyPositionItem) -> some View {
        HStack(spacing: AD.spacingSM) {
            Circle()
                .fill(pos.pnl >= 0 ? AD.profit : AD.loss)
                .frame(width: 8, height: 8)

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(pos.symbol)
                        .font(.system(size: 15, weight: .semibold, design: .monospaced))
                        .foregroundStyle(AD.textPrimary)
                    Text(pos.side)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(AD.accent)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(AD.accentDim)
                        .clipShape(Capsule())
                }
                Text("\(pos.shares) shares @ \(String(format: "$%.2f", pos.entryPrice))")
                    .font(.system(size: 11, weight: .regular))
                    .foregroundStyle(AD.textTertiary)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 2) {
                Text("\(AD.pnlSign(pos.pnl))\(pos.pnl, specifier: "%.2f")")
                    .font(.system(size: 14, weight: .semibold, design: .monospaced))
                    .foregroundStyle(AD.pnlColor(pos.pnl))
                Text("\(AD.pnlSign(pos.pnlPercent))\(pos.pnlPercent, specifier: "%.1f")%")
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(AD.pnlColor(pos.pnlPercent).opacity(0.7))
            }
        }
        .padding(.vertical, AD.spacingSM)
        .padding(.horizontal, AD.spacingMD)
        .background(AD.surface)
        .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous)
                .stroke(AD.border, lineWidth: 1)
        )
    }

    // MARK: - Toggle

    private var toggleSection: some View {
        Button {
            Task { await vm.toggleStrategy() }
        } label: {
            HStack(spacing: AD.spacingSM) {
                if vm.isToggling {
                    ProgressView()
                        .tint(.white)
                        .scaleEffect(0.85)
                } else {
                    Image(systemName: vm.status == .active ? "pause.circle.fill" : "play.circle.fill")
                        .font(.system(size: 18))
                    Text(vm.status == .active ? "Pause Strategy" : "Resume Strategy")
                        .font(.system(size: 16, weight: .semibold))
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 50)
            .background(vm.status == .active ? Color(hex: "F59E0B") : AD.profit)
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: AD.radiusMD, style: .continuous))
        }
        .disabled(vm.isToggling)
        .sensoryFeedback(.impact(weight: .medium), trigger: vm.status)
    }
}

#Preview {
    NavigationStack {
        StrategyDetailView(strategyId: "claude-alpha")
    }
    .environment(AuthManager.shared)
}
