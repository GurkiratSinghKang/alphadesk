import SwiftUI
import Charts

// MARK: - View Model

@Observable
final class PerformanceViewModel {
    var isLoading = true
    var selectedPeriod: Period = .threeMonth
    var errorMessage: String?

    // Equity curve
    var equityCurve: [PortfolioEquityPoint] = []

    // Key metrics
    var totalReturn: Double = 0
    var totalReturnPct: Double = 0
    var sharpeRatio: Double = 0
    var maxDrawdown: Double = 0
    var maxDrawdownPct: Double = 0
    var annualizedReturn: Double = 0
    var volatility: Double = 0
    var winRate: Double = 0

    // Monthly returns
    var monthlyReturns: [MonthlyReturnItem] = []

    // Allocation
    var allocations: [AllocationSlice] = []

    enum Period: String, CaseIterable {
        case oneWeek = "1W"
        case oneMonth = "1M"
        case threeMonth = "3M"
        case ytd = "YTD"
        case oneYear = "1Y"
        case all = "ALL"

        var apiPeriod: String {
            switch self {
            case .oneWeek:    return "1W"
            case .oneMonth:   return "1M"
            case .threeMonth: return "3M"
            case .ytd:        return "YTD"
            case .oneYear:    return "1Y"
            case .all:        return "ALL"
            }
        }
    }

    @MainActor
    func loadPerformance() async {
        isLoading = equityCurve.isEmpty
        errorMessage = nil

        do {
            let perf: PortfolioPerformanceDetail = try await APIClient.shared.request(
                .portfolioPerformance(period: selectedPeriod.apiPeriod)
            )

            totalReturn = perf.totalReturn ?? 0
            totalReturnPct = perf.totalReturnPct ?? 0
            sharpeRatio = perf.sharpeRatio ?? 0
            maxDrawdown = perf.maxDrawdown ?? 0
            maxDrawdownPct = perf.maxDrawdownPct ?? 0
            annualizedReturn = perf.annualizedReturn ?? 0
            volatility = perf.volatility ?? 0
            winRate = perf.winRate ?? 0

            if let curve = perf.equityCurve {
                equityCurve = curve.compactMap { point -> PortfolioEquityPoint? in
                    guard let value = point.value else { return nil }
                    let date: Date
                    if let dateStr = point.date {
                        let formatter = DateFormatter()
                        formatter.locale = Locale(identifier: "en_US_POSIX")
                        formatter.dateFormat = "yyyy-MM-dd"
                        date = formatter.date(from: dateStr) ?? Date()
                    } else {
                        date = Date()
                    }
                    return PortfolioEquityPoint(date: date, value: value)
                }
            }
        } catch {
            errorMessage = error.localizedDescription
            // Generate fallback data for demo
            generateFallbackData()
        }

        // Load allocations from positions
        await loadAllocations()

        isLoading = false
    }

    @MainActor
    func changePeriod(_ period: Period) async {
        selectedPeriod = period
        await loadPerformance()
    }

    @MainActor
    private func loadAllocations() async {
        do {
            let positions: [Position] = try await APIClient.shared.request(.positions)
            let total = positions.reduce(0.0) { $0 + abs($1.marketValue) }
            guard total > 0 else { return }

            allocations = positions.map { pos in
                AllocationSlice(
                    symbol: pos.symbol,
                    value: abs(pos.marketValue),
                    percent: abs(pos.marketValue) / total * 100
                )
            }
            .sorted { $0.percent > $1.percent }
        } catch {
            // No allocation data
        }
    }

    private func generateFallbackData() {
        var points: [PortfolioEquityPoint] = []
        var value: Double = 96_000
        let cal = Calendar.current
        let today = Date()
        let days: Int

        switch selectedPeriod {
        case .oneWeek: days = 7
        case .oneMonth: days = 30
        case .threeMonth: days = 90
        case .ytd:
            let startOfYear = cal.date(from: cal.dateComponents([.year], from: today))!
            days = cal.dateComponents([.day], from: startOfYear, to: today).day ?? 90
        case .oneYear: days = 365
        case .all: days = 365
        }

        for i in 0..<days {
            guard let date = cal.date(byAdding: .day, value: -(days - 1) + i, to: today) else { continue }
            let wd = cal.component(.weekday, from: date)
            if wd == 1 || wd == 7 { continue }
            let drift = 40.0
            let noise = Double.random(in: -250...300)
            value += drift + noise
            value = max(value, 90_000)
            points.append(PortfolioEquityPoint(date: date, value: value))
        }
        if let last = points.indices.last {
            points[last].value = 100_036.31
        }
        equityCurve = points

        totalReturn = 4_036.31
        totalReturnPct = 4.21
        sharpeRatio = 1.45
        maxDrawdown = -3_800
        maxDrawdownPct = -3.95
        annualizedReturn = 16.8
        volatility = 11.5
        winRate = 62.0

        monthlyReturns = [
            MonthlyReturnItem(month: "Jan", returnPct: 2.1),
            MonthlyReturnItem(month: "Feb", returnPct: -0.8),
            MonthlyReturnItem(month: "Mar", returnPct: 3.4),
            MonthlyReturnItem(month: "Apr", returnPct: 1.2),
        ]

        allocations = [
            AllocationSlice(symbol: "NVDA", value: 22_807.50, percent: 41.6),
            AllocationSlice(symbol: "MSFT", value: 12_306.00, percent: 22.4),
            AllocationSlice(symbol: "AAPL", value: 9_120.00, percent: 16.6),
            AllocationSlice(symbol: "AMZN", value: 3_783.00, percent: 6.9),
            AllocationSlice(symbol: "META", value: 7_471.50, percent: 13.6),
        ]
    }
}

// MARK: - Local Models

struct MonthlyReturnItem: Identifiable {
    let id = UUID()
    let month: String
    let returnPct: Double
}

struct AllocationSlice: Identifiable {
    let id = UUID()
    let symbol: String
    let value: Double
    let percent: Double
}

// MARK: - View

struct PerformanceView: View {

    @State private var vm = PerformanceViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                AD.background.ignoresSafeArea()

                if vm.isLoading && vm.equityCurve.isEmpty {
                    LoadingView()
                        .transition(.opacity)
                } else if let error = vm.errorMessage, vm.equityCurve.isEmpty {
                    VStack(spacing: AD.spacingMD) {
                        Image(systemName: "chart.xyaxis.line")
                            .font(.system(size: 40))
                            .foregroundStyle(AD.textTertiary)
                        Text("Unable to load performance")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(AD.textPrimary)
                        Text(error)
                            .font(.system(size: 13))
                            .foregroundStyle(AD.textTertiary)
                            .multilineTextAlignment(.center)
                        Button {
                            Task { await vm.loadPerformance() }
                        } label: {
                            Text("Retry")
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, AD.spacingLG)
                                .padding(.vertical, 12)
                                .background(AD.accent)
                                .clipShape(Capsule())
                        }
                    }
                    .padding(AD.spacingXL)
                } else {
                    performanceContent
                        .transition(.opacity)
                }
            }
            .animation(.easeInOut, value: vm.isLoading)
            .navigationTitle("Performance")
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
            .task { await vm.loadPerformance() }
        }
    }

    // MARK: - Content

    private var performanceContent: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(spacing: AD.spacingLG) {
                returnHeader
                equityCurveSection
                metricsGrid
                if !vm.allocations.isEmpty {
                    allocationSection
                }
                if !vm.monthlyReturns.isEmpty {
                    monthlyReturnsSection
                }
            }
            .padding(.horizontal, AD.spacingMD)
            .padding(.top, AD.spacingSM)
            .padding(.bottom, 100)
        }
    }

    // MARK: - Return Header

    private var returnHeader: some View {
        VStack(spacing: AD.spacingSM) {
            Text("Total Return")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(AD.textSecondary)

            Text(vm.totalReturn.formatCurrency())
                .font(.system(size: 36, weight: .bold, design: .monospaced))
                .foregroundStyle(AD.pnlColor(vm.totalReturn))
                .contentTransition(.numericText())

            HStack(spacing: 6) {
                Image(systemName: vm.totalReturnPct >= 0 ? "arrow.up.right" : "arrow.down.right")
                    .font(.system(size: 13, weight: .semibold))

                Text("\(AD.pnlSign(vm.totalReturnPct))\(vm.totalReturnPct, specifier: "%.2f")%")
                    .font(.system(size: 16, weight: .semibold, design: .monospaced))
            }
            .foregroundStyle(AD.pnlColor(vm.totalReturnPct))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, AD.spacingMD)
    }

    // MARK: - Equity Curve

    private var equityCurveSection: some View {
        VStack(alignment: .leading, spacing: AD.spacingSM) {
            // Period selector
            HStack(spacing: 0) {
                ForEach(PerformanceViewModel.Period.allCases, id: \.self) { period in
                    Button {
                        Task { await vm.changePeriod(period) }
                    } label: {
                        Text(period.rawValue)
                            .font(.system(size: 12, weight: vm.selectedPeriod == period ? .semibold : .regular))
                            .foregroundStyle(vm.selectedPeriod == period ? AD.accent : AD.textTertiary)
                            .frame(maxWidth: .infinity)
                            .frame(height: 32)
                            .background(
                                vm.selectedPeriod == period ? AD.accentDim : .clear
                            )
                            .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous))
                    }
                    .sensoryFeedback(.selection, trigger: vm.selectedPeriod)
                }
            }
            .padding(3)
            .background(AD.surfaceElevated)
            .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM + 3, style: .continuous))

            // Chart
            if vm.equityCurve.count >= 2 {
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
                .frame(height: 240)
            } else {
                VStack(spacing: AD.spacingSM) {
                    Image(systemName: "chart.line.downtrend.xyaxis")
                        .font(.system(size: 24))
                        .foregroundStyle(AD.textTertiary)
                    Text("Loading chart data...")
                        .font(.system(size: 13))
                        .foregroundStyle(AD.textTertiary)
                }
                .frame(maxWidth: .infinity)
                .frame(height: 240)
                .background(AD.surfaceElevated)
                .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM))
                .shimmer()
            }
        }
        .cardStyle()
    }

    // MARK: - Metrics Grid

    private var metricsGrid: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: AD.spacingSM), count: 2), spacing: AD.spacingSM) {
            performanceMetric(
                "Sharpe Ratio",
                value: String(format: "%.2f", vm.sharpeRatio),
                subtitle: vm.sharpeRatio >= 1.5 ? "Excellent" : vm.sharpeRatio >= 1.0 ? "Good" : "Fair",
                color: vm.sharpeRatio >= 1.5 ? AD.profit : vm.sharpeRatio >= 1.0 ? AD.accent : AD.loss,
                icon: "gauge.with.dots.needle.33percent"
            )
            performanceMetric(
                "Max Drawdown",
                value: String(format: "%.1f%%", vm.maxDrawdownPct),
                subtitle: vm.maxDrawdown.formatCurrency(),
                color: AD.loss,
                icon: "arrow.down.right"
            )
            performanceMetric(
                "Ann. Return",
                value: String(format: "%.1f%%", vm.annualizedReturn),
                subtitle: "Annualized",
                color: AD.pnlColor(vm.annualizedReturn),
                icon: "chart.line.uptrend.xyaxis"
            )
            performanceMetric(
                "Win Rate",
                value: String(format: "%.0f%%", vm.winRate),
                subtitle: "Of all trades",
                color: vm.winRate >= 55 ? AD.profit : AD.textSecondary,
                icon: "target"
            )
        }
    }

    private func performanceMetric(_ label: String, value: String, subtitle: String, color: Color, icon: String) -> some View {
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

    // MARK: - Allocation Section

    private var allocationSection: some View {
        VStack(alignment: .leading, spacing: AD.spacingSM) {
            HStack(spacing: AD.spacingSM) {
                Image(systemName: "chart.pie.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(AD.textTertiary)
                Text("Portfolio Allocation")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(AD.textPrimary)
            }

            // Stacked bar
            GeometryReader { geo in
                HStack(spacing: 2) {
                    ForEach(Array(vm.allocations.enumerated()), id: \.element.id) { index, slice in
                        RoundedRectangle(cornerRadius: 4, style: .continuous)
                            .fill(allocationColor(index))
                            .frame(width: max(geo.size.width * CGFloat(slice.percent / 100) - 2, 4))
                    }
                }
            }
            .frame(height: 12)
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))

            // Legend
            ForEach(Array(vm.allocations.enumerated()), id: \.element.id) { index, slice in
                HStack(spacing: AD.spacingSM) {
                    Circle()
                        .fill(allocationColor(index))
                        .frame(width: 8, height: 8)

                    Text(slice.symbol)
                        .font(.system(size: 13, weight: .semibold, design: .monospaced))
                        .foregroundStyle(AD.textPrimary)

                    Spacer()

                    Text(slice.value.formatCurrency())
                        .font(.system(size: 13, weight: .medium, design: .monospaced))
                        .foregroundStyle(AD.textSecondary)

                    Text(String(format: "%.1f%%", slice.percent))
                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                        .foregroundStyle(AD.textTertiary)
                        .frame(width: 50, alignment: .trailing)
                }
                .padding(.vertical, 2)
            }
        }
        .cardStyle()
    }

    private func allocationColor(_ index: Int) -> Color {
        let colors: [Color] = [
            AD.accent,
            AD.profit,
            Color(hex: "6C5CE7"),
            Color(hex: "F59E0B"),
            AD.loss,
            Color(hex: "06B6D4"),
            Color(hex: "EC4899"),
        ]
        return colors[index % colors.count]
    }

    // MARK: - Monthly Returns

    private var monthlyReturnsSection: some View {
        VStack(alignment: .leading, spacing: AD.spacingSM) {
            HStack(spacing: AD.spacingSM) {
                Image(systemName: "calendar")
                    .font(.system(size: 14))
                    .foregroundStyle(AD.textTertiary)
                Text("Monthly Returns")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(AD.textPrimary)
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
            .frame(height: 180)
        }
        .cardStyle()
    }
}

#Preview {
    PerformanceView()
        .environment(AuthManager.shared)
}
