import SwiftUI
import Charts

// MARK: - View Model

@Observable
final class StrategyDetailViewModel {
    let strategyId: String
    var name = ""
    var description = ""
    var thesis = ""
    var status: StrategyListStatus = .active
    var isLoading = true

    // Metrics
    var totalReturn: Double = 0
    var annualizedReturn: Double = 0
    var sharpe: Double = 0
    var maxDrawdown: Double = 0
    var winRate: Double = 0
    var profitFactor: Double = 0
    var totalTrades: Int = 0
    var avgHoldDays: Double = 0

    // Equity curve
    var equityCurve: [DetailEquityPoint] = []

    // Trade history
    var trades: [StrategyTradeItem] = []

    init(strategyId: String) {
        self.strategyId = strategyId
        loadData()
    }

    func loadData() {
        isLoading = true

        let strategyData: [String: (String, String, String, Double, Double, Double, Double, Double, Double, Int, Double)] = [
            "momentum-quality": (
                "Momentum + Quality",
                "Combines relative strength momentum with quality factor screens (high ROE, low debt, earnings stability). Rebalances monthly.",
                "Academic research shows persistent alpha in the intersection of momentum and quality factors. By selecting stocks with strong relative strength AND high quality metrics, we avoid momentum crashes that plague pure momentum strategies. Monthly rebalancing captures medium-term trends while filtering noise.",
                12.4, 24.8, 1.82, -8.5, 64.2, 1.95, 42, 18.5
            ),
            "pead": (
                "PEAD",
                "Post-Earnings Announcement Drift -- exploits under-reaction to earnings surprises.",
                "Markets systematically under-react to earnings surprises. This strategy enters positions after strong earnings beats (>10% surprise) and holds for 30-60 days to capture the drift. Entry timing is refined using volume confirmation and analyst revision momentum.",
                8.7, 17.4, 1.45, -6.2, 58.3, 1.62, 38, 35.0
            ),
            "vrp-harvesting": (
                "VRP Harvesting",
                "Volatility Risk Premium through systematic short options strategies.",
                "Implied volatility consistently exceeds realized volatility, creating a persistent risk premium. We harvest this by selling put spreads on liquid large-caps when IV rank exceeds 40. Position sizing is dynamic based on portfolio VaR constraints. The strategy benefits from the structural demand for portfolio insurance.",
                15.1, 30.2, 2.10, -11.3, 72.0, 2.45, 65, 22.0
            ),
            "earnings-vol-premium": (
                "Earnings Vol Premium",
                "Captures IV vs RV spread around earnings events.",
                "Earnings events are associated with a predictable spike in implied volatility that frequently exceeds the actual realized move. By systematically selling straddles/strangles 1-2 days before earnings on names with historically overstated IV, we capture this premium. Risk is managed through strict position limits and spread structures.",
                -2.3, -4.6, 0.42, -15.8, 45.0, 0.78, 28, 3.0
            ),
            "regime-adaptive": (
                "Regime Adaptive",
                "ML-based regime detection with dynamic strategy rotation.",
                "Uses a hidden Markov model trained on volatility, breadth, and credit spreads to classify market regimes (bull, bear, sideways). In bull regimes, we tilt toward momentum; in bear regimes, toward defensive/short strategies; in sideways markets, we favor mean-reversion. Transitions are smoothed to avoid whipsaws.",
                6.9, 13.8, 1.21, -9.1, 55.8, 1.38, 52, 15.0
            ),
            "claude-alpha": (
                "Claude Alpha",
                "AI-driven opportunistic stock picking powered by Claude.",
                "Leverages Claude's ability to synthesize technical analysis, fundamental data, news sentiment, and market context into high-conviction trade ideas. Each pick is scored on a multi-factor basis with explicit entry, stop, and target levels. The AI adapts its approach based on current market conditions and recent performance feedback.",
                18.6, 37.2, 1.95, -7.8, 61.5, 2.15, 48, 12.0
            ),
            "mean-reversion": (
                "Mean Reversion",
                "Buy oversold quality stocks with strong fundamentals.",
                "Identifies quality stocks (F-Score >= 5) that have experienced significant pullbacks (>2 sigma moves). Entry occurs on the first sign of stabilization with wider stops (10-15%) and targets (20-30%). Works best in range-bound or mildly bullish markets. Pairs naturally with the momentum strategy.",
                4.2, 8.4, 0.88, -12.5, 52.1, 1.15, 31, 28.0
            ),
            "vcp-breakout": (
                "VCP Breakout",
                "Volatility contraction pattern breakouts (Minervini SEPA).",
                "Scans for Stage 2 uptrend stocks forming tight VCP bases with successively lower volume on each contraction. Entry is on the pivot breakout with tight 3% stops and 10% initial targets. The strategy thrives in strong bull markets and is systematically paused when market breadth deteriorates.",
                9.8, 19.6, 1.32, -5.4, 48.6, 1.55, 56, 8.0
            ),
        ]

        guard let data = strategyData[strategyId] else {
            isLoading = false
            return
        }

        name = data.0
        description = data.1
        thesis = data.2
        totalReturn = data.3
        annualizedReturn = data.4
        sharpe = data.5
        maxDrawdown = data.6
        winRate = data.7
        profitFactor = data.8
        totalTrades = data.9
        avgHoldDays = data.10

        status = strategyId == "earnings-vol-premium" ? .paused : .active

        // Generate equity curve
        var pts: [DetailEquityPoint] = []
        var value: Double = 10_000
        let endValue = 10_000 * (1 + totalReturn / 100)
        let days = 90
        let dailyDrift = pow(endValue / value, 1.0 / Double(days)) - 1.0
        let cal = Calendar.current
        let today = Date()

        for i in 0..<days {
            guard let date = cal.date(byAdding: .day, value: -days + i, to: today) else { continue }
            let wd = cal.component(.weekday, from: date)
            if wd == 1 || wd == 7 { continue }
            let noise = Double.random(in: -0.012...0.015)
            value *= (1 + dailyDrift + noise)
            value = max(value, 8_000)
            pts.append(DetailEquityPoint(date: date, value: value))
        }
        if let last = pts.indices.last {
            pts[last].value = endValue
        }
        equityCurve = pts

        // Generate trade history
        trades = generateTrades()

        isLoading = false
    }

    private func generateTrades() -> [StrategyTradeItem] {
        let symbols = ["AAPL", "NVDA", "MSFT", "AMZN", "META", "GOOGL", "TSLA", "AMD", "CRM", "NFLX"]
        let cal = Calendar.current
        let today = Date()

        return (0..<min(totalTrades, 15)).map { i in
            let daysBack = Int.random(in: 1...60)
            let entryDate = cal.date(byAdding: .day, value: -daysBack, to: today) ?? today
            let holdDays = Int.random(in: 1...Int(avgHoldDays * 2))
            let exitDate = cal.date(byAdding: .day, value: holdDays, to: entryDate) ?? today
            let symbol = symbols[i % symbols.count]
            let entryPrice = Double.random(in: 100...500)
            let pnlPercent = Double.random(in: -8...15)
            let exitPrice = entryPrice * (1 + pnlPercent / 100)
            let shares = Int.random(in: 5...50)
            let pnl = (exitPrice - entryPrice) * Double(shares)
            let isClosed = daysBack > holdDays

            return StrategyTradeItem(
                symbol: symbol,
                side: "Long",
                entryDate: entryDate,
                exitDate: isClosed ? exitDate : nil,
                entryPrice: entryPrice,
                exitPrice: isClosed ? exitPrice : nil,
                shares: shares,
                pnl: isClosed ? pnl : nil,
                pnlPercent: isClosed ? pnlPercent : nil,
                isClosed: isClosed
            )
        }
        .sorted { ($0.entryDate) > ($1.entryDate) }
    }
}

struct DetailEquityPoint: Identifiable {
    let id = UUID()
    let date: Date
    var value: Double
}

struct StrategyTradeItem: Identifiable {
    let id = UUID()
    let symbol: String
    let side: String
    let entryDate: Date
    let exitDate: Date?
    let entryPrice: Double
    let exitPrice: Double?
    let shares: Int
    let pnl: Double?
    let pnlPercent: Double?
    let isClosed: Bool
}

// MARK: - View

struct StrategyDetailView: View {

    let strategyId: String
    @State private var vm: StrategyDetailViewModel
    @State private var expandedTradeId: UUID?

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
            } else {
                VStack(spacing: AD.spacingLG) {
                    headerSection
                    equityCurveSection
                    metricsGrid
                    tradeHistorySection
                    aboutSection
                }
                .padding(.horizontal, AD.spacingMD)
                .padding(.top, AD.spacingSM)
                .padding(.bottom, 100)
            }
        }
        .background(AD.background)
        .navigationTitle(vm.name)
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(AD.background, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
    }

    // MARK: - Header

    private var headerSection: some View {
        VStack(spacing: AD.spacingSM) {
            HStack {
                detailStatusBadge(vm.status)
                Spacer()
                Text("\(vm.totalTrades) trades")
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
                    yStart: .value("Base", vm.equityCurve.map(\.value).min() ?? 8_000),
                    y: .value("Value", point.value)
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
                       subtitle: "PF \(String(format: "%.2f", vm.profitFactor))",
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

    // MARK: - Trade History

    private var tradeHistorySection: some View {
        VStack(alignment: .leading, spacing: AD.spacingSM) {
            HStack {
                Text("Trade History")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(AD.textPrimary)
                Spacer()
                Text("\(vm.trades.count) trades")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(AD.textTertiary)
            }

            ForEach(vm.trades) { trade in
                tradeRow(trade)
            }
        }
    }

    private func tradeRow(_ trade: StrategyTradeItem) -> some View {
        let isExpanded = expandedTradeId == trade.id

        return VStack(spacing: 0) {
            // Main row
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    expandedTradeId = isExpanded ? nil : trade.id
                }
            } label: {
                HStack(spacing: AD.spacingSM) {
                    // Status indicator
                    Circle()
                        .fill(!trade.isClosed ? AD.accent : (trade.pnl ?? 0) >= 0 ? AD.profit : AD.loss)
                        .frame(width: 8, height: 8)

                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(trade.symbol)
                                .font(.system(size: 15, weight: .semibold, design: .monospaced))
                                .foregroundStyle(AD.textPrimary)
                            Text(trade.side)
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(AD.accent)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(AD.accentDim)
                                .clipShape(Capsule())
                        }
                        Text(trade.entryDate, format: .dateTime.month(.abbreviated).day())
                            .font(.system(size: 11, weight: .regular))
                            .foregroundStyle(AD.textTertiary)
                    }

                    Spacer()

                    VStack(alignment: .trailing, spacing: 2) {
                        if let pnl = trade.pnl {
                            Text("\(AD.pnlSign(pnl))\(pnl, specifier: "%.2f")")
                                .font(.system(size: 14, weight: .semibold, design: .monospaced))
                                .foregroundStyle(AD.pnlColor(pnl))
                        } else {
                            Text("Open")
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(AD.accent)
                        }

                        if let pct = trade.pnlPercent {
                            Text("\(AD.pnlSign(pct))\(pct, specifier: "%.1f")%")
                                .font(.system(size: 11, weight: .medium, design: .monospaced))
                                .foregroundStyle(AD.pnlColor(pct).opacity(0.7))
                        }
                    }

                    Image(systemName: "chevron.down")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(AD.textTertiary)
                        .rotationEffect(.degrees(isExpanded ? 180 : 0))
                }
                .padding(.vertical, AD.spacingSM)
                .padding(.horizontal, AD.spacingMD)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .sensoryFeedback(.selection, trigger: expandedTradeId)

            // Expanded details
            if isExpanded {
                VStack(spacing: AD.spacingSM) {
                    Divider().background(AD.border)

                    HStack(spacing: AD.spacingLG) {
                        detailColumn("Entry", value: String(format: "$%.2f", trade.entryPrice))
                        if let exit = trade.exitPrice {
                            detailColumn("Exit", value: String(format: "$%.2f", exit))
                        }
                        detailColumn("Shares", value: "\(trade.shares)")
                        detailColumn("Status", value: trade.isClosed ? "Closed" : "Open")
                    }
                }
                .padding(.horizontal, AD.spacingMD)
                .padding(.bottom, AD.spacingSM)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .background(AD.surface)
        .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous)
                .stroke(AD.border, lineWidth: 1)
        )
    }

    private func detailColumn(_ label: String, value: String) -> some View {
        VStack(spacing: 2) {
            Text(label)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(AD.textTertiary)
            Text(value)
                .font(.system(size: 13, weight: .semibold, design: .monospaced))
                .foregroundStyle(AD.textSecondary)
        }
    }

    // MARK: - About

    private var aboutSection: some View {
        VStack(alignment: .leading, spacing: AD.spacingSM) {
            HStack(spacing: AD.spacingSM) {
                Image(systemName: "lightbulb.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(Color(hex: "F59E0B"))
                Text("Strategy Thesis")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(AD.textPrimary)
            }

            Text(vm.thesis)
                .font(.system(size: 14, weight: .regular))
                .foregroundStyle(AD.textSecondary)
                .lineSpacing(4)
        }
        .cardStyle()
    }
}

#Preview {
    NavigationStack {
        StrategyDetailView(strategyId: "claude-alpha")
    }
    .environment(AuthManager.shared)
}
