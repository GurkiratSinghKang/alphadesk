import SwiftUI
import Charts

// MARK: - View Model

@Observable
final class BacktestResultViewModel {
    var symbol: String = ""
    var strategy: BacktestStrategy = .smaCrossover
    var shortPeriod: String = "10"
    var longPeriod: String = "30"

    var isRunning = false
    var hasResults = false
    var error: String?

    // Results
    var equityCurve: [BacktestEquityPoint] = []
    var totalReturn: Double = 0
    var totalReturnPct: Double = 0
    var sharpeRatio: Double = 0
    var maxDrawdown: Double = 0
    var maxDrawdownPct: Double = 0
    var winRate: Double = 0
    var tradeCount: Int = 0
    var winCount: Int = 0
    var lossCount: Int = 0

    enum BacktestStrategy: String, CaseIterable {
        case smaCrossover = "SMA Crossover"
        case rsiMeanReversion = "RSI Mean Reversion"

        var icon: String {
            switch self {
            case .smaCrossover: return "arrow.left.arrow.right"
            case .rsiMeanReversion: return "arrow.up.arrow.down"
            }
        }
    }

    var canRun: Bool {
        !symbol.isEmpty &&
        (Int(shortPeriod) ?? 0) > 0 &&
        (Int(longPeriod) ?? 0) > 0 &&
        (Int(shortPeriod) ?? 0) < (Int(longPeriod) ?? 0)
    }

    @MainActor
    func runBacktest() async {
        guard canRun else { return }
        isRunning = true
        error = nil
        hasResults = false

        do {
            let bars: [OHLCVBar] = try await APIClient.shared.request(
                .bars(symbol: symbol.uppercased(), timeframe: "1Day", limit: 252)
            )

            guard bars.count >= 30 else {
                error = "Not enough data. Need at least 30 bars."
                isRunning = false
                return
            }

            let closes = bars.map(\.close)
            let dates = bars.map(\.timestamp)

            switch strategy {
            case .smaCrossover:
                runSMACrossover(closes: closes, dates: dates)
            case .rsiMeanReversion:
                runRSIMeanReversion(closes: closes, dates: dates)
            }

            hasResults = true
        } catch {
            self.error = "Failed to fetch data: \(error.localizedDescription)"
        }

        isRunning = false
    }

    // MARK: - SMA Crossover Strategy

    private func runSMACrossover(closes: [Double], dates: [Date]) {
        let short = Int(shortPeriod) ?? 10
        let long = Int(longPeriod) ?? 30

        guard closes.count >= long else { return }

        let shortSMA = sma(closes, period: short)
        let longSMA = sma(closes, period: long)

        var equity: Double = 10000
        let initialEquity = equity
        var position: Double = 0
        var entryPrice: Double = 0
        var trades: [(entry: Double, exit: Double)] = []
        var curve: [BacktestEquityPoint] = []
        var peak = equity

        // Start from where both SMAs are available
        let startIdx = long - 1

        for i in startIdx..<closes.count {
            let shortIdx = i - (short - 1)
            let longIdx = i - (long - 1)

            guard shortIdx >= 0, longIdx >= 0,
                  shortIdx < shortSMA.count, longIdx < longSMA.count else { continue }

            let shortVal = shortSMA[shortIdx]
            let longVal = longSMA[longIdx]
            let price = closes[i]

            // Buy signal: short crosses above long
            if shortVal > longVal && position == 0 {
                position = equity / price
                entryPrice = price
            }
            // Sell signal: short crosses below long
            else if shortVal <= longVal && position > 0 {
                equity = position * price
                trades.append((entry: entryPrice, exit: price))
                position = 0
            }

            let currentEquity = position > 0 ? position * price : equity
            curve.append(BacktestEquityPoint(date: dates[i], value: currentEquity))

            if currentEquity > peak { peak = currentEquity }
        }

        // Close any remaining position
        if position > 0 {
            let lastPrice = closes.last ?? 0
            equity = position * lastPrice
            trades.append((entry: entryPrice, exit: lastPrice))
        }

        computeResults(
            initialEquity: initialEquity,
            finalEquity: equity,
            trades: trades,
            curve: curve,
            peak: peak,
            closes: closes
        )
    }

    // MARK: - RSI Mean Reversion Strategy

    private func runRSIMeanReversion(closes: [Double], dates: [Date]) {
        let period = Int(shortPeriod) ?? 14

        guard closes.count > period else { return }

        let rsiValues = computeRSI(closes, period: period)

        var equity: Double = 10000
        let initialEquity = equity
        var position: Double = 0
        var entryPrice: Double = 0
        var trades: [(entry: Double, exit: Double)] = []
        var curve: [BacktestEquityPoint] = []
        var peak = equity

        let startIdx = period

        for i in startIdx..<closes.count {
            let rsiIdx = i - period
            guard rsiIdx >= 0, rsiIdx < rsiValues.count else { continue }

            let rsi = rsiValues[rsiIdx]
            let price = closes[i]

            // Buy when RSI < 30 (oversold)
            if rsi < 30 && position == 0 {
                position = equity / price
                entryPrice = price
            }
            // Sell when RSI > 70 (overbought)
            else if rsi > 70 && position > 0 {
                equity = position * price
                trades.append((entry: entryPrice, exit: price))
                position = 0
            }

            let currentEquity = position > 0 ? position * price : equity
            curve.append(BacktestEquityPoint(date: dates[i], value: currentEquity))

            if currentEquity > peak { peak = currentEquity }
        }

        if position > 0 {
            let lastPrice = closes.last ?? 0
            equity = position * lastPrice
            trades.append((entry: entryPrice, exit: lastPrice))
        }

        computeResults(
            initialEquity: initialEquity,
            finalEquity: equity,
            trades: trades,
            curve: curve,
            peak: peak,
            closes: closes
        )
    }

    // MARK: - Helpers

    private func computeResults(
        initialEquity: Double,
        finalEquity: Double,
        trades: [(entry: Double, exit: Double)],
        curve: [BacktestEquityPoint],
        peak: Double,
        closes: [Double]
    ) {
        equityCurve = curve
        totalReturn = finalEquity - initialEquity
        totalReturnPct = ((finalEquity / initialEquity) - 1) * 100
        tradeCount = trades.count

        let wins = trades.filter { $0.exit > $0.entry }
        let losses = trades.filter { $0.exit <= $0.entry }
        winCount = wins.count
        lossCount = losses.count
        winRate = tradeCount > 0 ? (Double(winCount) / Double(tradeCount)) * 100 : 0

        // Max drawdown
        var runningPeak = curve.first?.value ?? initialEquity
        var worstDrawdown: Double = 0
        for point in curve {
            if point.value > runningPeak { runningPeak = point.value }
            let dd = (runningPeak - point.value) / runningPeak
            if dd > worstDrawdown { worstDrawdown = dd }
        }
        maxDrawdownPct = worstDrawdown * 100
        maxDrawdown = worstDrawdown * runningPeak

        // Sharpe (annualized, approximate)
        if curve.count > 1 {
            var dailyReturns: [Double] = []
            for i in 1..<curve.count {
                let r = (curve[i].value - curve[i - 1].value) / curve[i - 1].value
                dailyReturns.append(r)
            }
            let avgReturn = dailyReturns.reduce(0, +) / Double(dailyReturns.count)
            let variance = dailyReturns.reduce(0) { $0 + pow($1 - avgReturn, 2) } / Double(dailyReturns.count)
            let stdDev = sqrt(variance)
            sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * sqrt(252) : 0
        }
    }

    private func sma(_ data: [Double], period: Int) -> [Double] {
        guard data.count >= period else { return [] }
        var result: [Double] = []
        for i in (period - 1)..<data.count {
            let slice = data[(i - period + 1)...i]
            result.append(slice.reduce(0, +) / Double(period))
        }
        return result
    }

    private func computeRSI(_ closes: [Double], period: Int) -> [Double] {
        guard closes.count > period else { return [] }
        var gains: [Double] = []
        var losses: [Double] = []

        for i in 1..<closes.count {
            let change = closes[i] - closes[i - 1]
            gains.append(max(change, 0))
            losses.append(max(-change, 0))
        }

        var rsiValues: [Double] = []
        var avgGain = gains.prefix(period).reduce(0, +) / Double(period)
        var avgLoss = losses.prefix(period).reduce(0, +) / Double(period)

        let rs = avgLoss > 0 ? avgGain / avgLoss : 100
        rsiValues.append(100 - (100 / (1 + rs)))

        for i in period..<gains.count {
            avgGain = (avgGain * Double(period - 1) + gains[i]) / Double(period)
            avgLoss = (avgLoss * Double(period - 1) + losses[i]) / Double(period)
            let rs = avgLoss > 0 ? avgGain / avgLoss : 100
            rsiValues.append(100 - (100 / (1 + rs)))
        }

        return rsiValues
    }
}

// MARK: - Local Models

struct BacktestEquityPoint: Identifiable {
    let id = UUID()
    let date: Date
    let value: Double
}

// MARK: - View

struct BacktestResultView: View {

    @State private var vm = BacktestResultViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(spacing: AD.spacingLG) {
                headerSection
                inputsSection
                runButton
                if vm.hasResults {
                    resultsSection
                }
                if let error = vm.error {
                    errorBanner(error)
                }
            }
            .padding(.horizontal, AD.spacingMD)
            .padding(.top, AD.spacingSM)
            .padding(.bottom, 40)
        }
        .background(AD.background)
        .navigationTitle("Backtest")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(AD.background, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button { dismiss() } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 22))
                        .foregroundStyle(AD.textTertiary)
                }
            }
        }
    }

    // MARK: - Header

    private var headerSection: some View {
        VStack(spacing: AD.spacingSM) {
            ZStack {
                Circle()
                    .fill(Color(hex: "6C5CE7").opacity(0.12))
                    .frame(width: 56, height: 56)

                Image(systemName: "clock.arrow.2.circlepath")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(Color(hex: "6C5CE7"))
            }

            Text("Strategy Backtest")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(AD.textPrimary)

            Text("Test strategies on historical data")
                .font(.system(size: 13, weight: .regular))
                .foregroundStyle(AD.textTertiary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, AD.spacingSM)
    }

    // MARK: - Inputs

    private var inputsSection: some View {
        VStack(alignment: .leading, spacing: AD.spacingMD) {
            // Symbol
            VStack(alignment: .leading, spacing: 6) {
                Text("SYMBOL")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(AD.textTertiary)

                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 14))
                        .foregroundStyle(AD.textTertiary)

                    TextField("e.g. AAPL", text: $vm.symbol)
                        .font(.system(size: 16, weight: .semibold, design: .monospaced))
                        .foregroundStyle(AD.textPrimary)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                }
                .frame(height: 48)
                .padding(.horizontal, AD.spacingMD)
                .background(AD.surfaceElevated)
                .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous))
            }

            // Strategy selector
            VStack(alignment: .leading, spacing: 6) {
                Text("STRATEGY")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(AD.textTertiary)

                HStack(spacing: 0) {
                    ForEach(BacktestResultViewModel.BacktestStrategy.allCases, id: \.self) { strat in
                        Button {
                            withAnimation(.easeInOut(duration: 0.2)) {
                                vm.strategy = strat
                            }
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: strat.icon)
                                    .font(.system(size: 11))
                                Text(strat.rawValue)
                                    .font(.system(size: 12, weight: vm.strategy == strat ? .semibold : .regular))
                            }
                            .foregroundStyle(vm.strategy == strat ? AD.accent : AD.textTertiary)
                            .frame(maxWidth: .infinity)
                            .frame(height: 38)
                            .background(vm.strategy == strat ? AD.accentDim : .clear)
                            .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous))
                        }
                    }
                }
                .padding(3)
                .background(AD.surfaceElevated)
                .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM + 3, style: .continuous))
            }

            // Parameters
            HStack(spacing: AD.spacingSM) {
                paramField(
                    vm.strategy == .rsiMeanReversion ? "RSI PERIOD" : "SHORT PERIOD",
                    text: $vm.shortPeriod
                )
                paramField(
                    vm.strategy == .rsiMeanReversion ? "LOOKBACK" : "LONG PERIOD",
                    text: $vm.longPeriod
                )
            }
        }
        .cardStyle()
    }

    private func paramField(_ label: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(AD.textTertiary)

            TextField("0", text: text)
                .font(.system(size: 16, weight: .semibold, design: .monospaced))
                .foregroundStyle(AD.textPrimary)
                .keyboardType(.numberPad)
                .frame(height: 44)
                .padding(.horizontal, AD.spacingSM)
                .background(AD.surfaceElevated)
                .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous))
        }
    }

    // MARK: - Run Button

    private var runButton: some View {
        Button {
            Task { await vm.runBacktest() }
        } label: {
            HStack(spacing: AD.spacingSM) {
                if vm.isRunning {
                    ProgressView()
                        .tint(.white)
                        .scaleEffect(0.85)
                    Text("Running Backtest...")
                        .font(.system(size: 16, weight: .semibold))
                } else {
                    Image(systemName: "play.fill")
                        .font(.system(size: 15))
                    Text("Run Backtest")
                        .font(.system(size: 16, weight: .semibold))
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background(
                vm.isRunning || !vm.canRun
                    ? AnyShapeStyle(AD.textTertiary.opacity(0.3))
                    : AnyShapeStyle(
                        LinearGradient(
                            colors: [Color(hex: "6C5CE7"), Color(hex: "A855F7")],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
            )
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: AD.radiusMD, style: .continuous))
            .shadow(color: vm.canRun ? Color(hex: "6C5CE7").opacity(0.25) : .clear, radius: 12, y: 6)
        }
        .disabled(vm.isRunning || !vm.canRun)
    }

    // MARK: - Results

    private var resultsSection: some View {
        VStack(spacing: AD.spacingLG) {
            // Equity Curve
            VStack(alignment: .leading, spacing: AD.spacingSM) {
                HStack(spacing: AD.spacingSM) {
                    Image(systemName: "chart.xyaxis.line")
                        .font(.system(size: 14))
                        .foregroundStyle(AD.accent)
                    Text("Equity Curve")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(AD.textPrimary)
                    Spacer()
                    Text(vm.symbol.uppercased())
                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                        .foregroundStyle(AD.accent)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(AD.accentDim)
                        .clipShape(Capsule())
                }

                if vm.equityCurve.count >= 2 {
                    Chart(vm.equityCurve) { point in
                        AreaMark(
                            x: .value("Date", point.date),
                            yStart: .value("Base", vm.equityCurve.map(\.value).min() ?? 0),
                            yEnd: .value("Equity", point.value)
                        )
                        .foregroundStyle(
                            LinearGradient(
                                colors: [
                                    AD.pnlColor(vm.totalReturn).opacity(0.25),
                                    AD.pnlColor(vm.totalReturn).opacity(0.02)
                                ],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                        .interpolationMethod(.catmullRom)

                        LineMark(
                            x: .value("Date", point.date),
                            y: .value("Equity", point.value)
                        )
                        .foregroundStyle(AD.pnlColor(vm.totalReturn))
                        .lineStyle(StrokeStyle(lineWidth: 2))
                        .interpolationMethod(.catmullRom)
                    }
                    .chartXAxis(.hidden)
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
                    .frame(height: 200)
                }
            }
            .cardStyle()

            // Performance metrics
            VStack(alignment: .leading, spacing: AD.spacingSM) {
                HStack(spacing: AD.spacingSM) {
                    Image(systemName: "chart.bar.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(AD.textTertiary)
                    Text("Performance Metrics")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(AD.textPrimary)
                }

                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: AD.spacingSM), count: 2), spacing: AD.spacingSM) {
                    metricCard(
                        icon: "dollarsign.circle.fill",
                        label: "Total Return",
                        value: "\(AD.pnlSign(vm.totalReturn))\(vm.totalReturn.formatCurrency())",
                        subtitle: "\(AD.pnlSign(vm.totalReturnPct))\(String(format: "%.2f", vm.totalReturnPct))%",
                        color: AD.pnlColor(vm.totalReturn)
                    )
                    metricCard(
                        icon: "waveform.path.ecg",
                        label: "Sharpe Ratio",
                        value: String(format: "%.2f", vm.sharpeRatio),
                        subtitle: vm.sharpeRatio > 1 ? "Good" : "Below average",
                        color: vm.sharpeRatio > 1 ? AD.profit : AD.textSecondary
                    )
                    metricCard(
                        icon: "arrow.down.right.circle.fill",
                        label: "Max Drawdown",
                        value: String(format: "-%.2f%%", vm.maxDrawdownPct),
                        subtitle: String(format: "-$%.0f", vm.maxDrawdown),
                        color: AD.loss
                    )
                    metricCard(
                        icon: "target",
                        label: "Win Rate",
                        value: String(format: "%.1f%%", vm.winRate),
                        subtitle: "\(vm.winCount)W / \(vm.lossCount)L of \(vm.tradeCount)",
                        color: vm.winRate >= 50 ? AD.profit : AD.loss
                    )
                }
            }
        }
        .transition(.opacity.combined(with: .move(edge: .bottom)))
    }

    private func metricCard(icon: String, label: String, value: String, subtitle: String, color: Color) -> some View {
        HStack(spacing: AD.spacingSM) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(color.opacity(0.7))
                .frame(width: 32, height: 32)
                .background(color.opacity(0.1))
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(AD.textTertiary)
                Text(value)
                    .font(.system(size: 16, weight: .bold, design: .monospaced))
                    .foregroundStyle(color)
                Text(subtitle)
                    .font(.system(size: 10, weight: .regular))
                    .foregroundStyle(AD.textTertiary)
            }

            Spacer()
        }
        .cardStyle(padding: 12)
    }

    // MARK: - Error Banner

    private func errorBanner(_ message: String) -> some View {
        HStack(spacing: AD.spacingSM) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 14))
                .foregroundStyle(AD.loss)
            Text(message)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(AD.loss)
        }
        .padding(AD.spacingSM)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AD.loss.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous)
                .stroke(AD.loss.opacity(0.2), lineWidth: 1)
        )
    }
}

#Preview {
    NavigationStack {
        BacktestResultView()
    }
    .environment(AuthManager.shared)
}
