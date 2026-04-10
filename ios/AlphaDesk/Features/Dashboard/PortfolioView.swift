import SwiftUI
import Charts

// MARK: - View Model

@Observable
final class PortfolioViewModel {
    var equity: Double = 100_036.31
    var dayPnL: Double = 436.31
    var dayPnLPercent: Double = 0.44
    var cash: Double = 45_210.00
    var buyingPower: Double = 90_420.00
    var positionsCount: Int = 5
    var isRefreshing = false
    var isPipelineRunning = false

    var equityCurve: [PortfolioEquityPoint] = {
        var points: [PortfolioEquityPoint] = []
        var value: Double = 96_000
        let calendar = Calendar.current
        let today = Date()
        for i in 0..<90 {
            guard let date = calendar.date(byAdding: .day, value: -89 + i, to: today) else { continue }
            let weekday = calendar.component(.weekday, from: date)
            if weekday == 1 || weekday == 7 { continue }
            let drift = 45.0
            let noise = Double.random(in: -300...350)
            value += drift + noise
            value = max(value, 92_000)
            points.append(PortfolioEquityPoint(date: date, value: value))
        }
        if let last = points.indices.last {
            points[last].value = 100_036.31
        }
        return points
    }()

    var marketIndices: [PortfolioMarketIndex] = [
        PortfolioMarketIndex(symbol: "SPY", name: "S&P 500", price: 522.18, change: 3.42, changePercent: 0.66),
        PortfolioMarketIndex(symbol: "QQQ", name: "Nasdaq 100", price: 441.56, change: -1.87, changePercent: -0.42),
        PortfolioMarketIndex(symbol: "IWM", name: "Russell 2000", price: 204.33, change: 1.12, changePercent: 0.55),
        PortfolioMarketIndex(symbol: "DIA", name: "Dow Jones", price: 394.21, change: 2.65, changePercent: 0.68),
        PortfolioMarketIndex(symbol: "VIX", name: "Volatility", price: 14.82, change: -0.93, changePercent: -5.91),
    ]

    var positions: [PortfolioPosition] = [
        PortfolioPosition(symbol: "AAPL", name: "Apple Inc.", shares: 50, avgCost: 178.25, currentPrice: 182.40, pnl: 207.50, pnlPercent: 2.33),
        PortfolioPosition(symbol: "NVDA", name: "NVIDIA Corp.", shares: 25, avgCost: 875.00, currentPrice: 912.30, pnl: 932.50, pnlPercent: 4.26),
        PortfolioPosition(symbol: "MSFT", name: "Microsoft Corp.", shares: 30, avgCost: 415.50, currentPrice: 410.20, pnl: -159.00, pnlPercent: -1.28),
        PortfolioPosition(symbol: "AMZN", name: "Amazon.com", shares: 20, avgCost: 185.60, currentPrice: 189.15, pnl: 71.00, pnlPercent: 1.91),
        PortfolioPosition(symbol: "META", name: "Meta Platforms", shares: 15, avgCost: 502.30, currentPrice: 498.10, pnl: -63.00, pnlPercent: -0.84),
    ]

    @MainActor
    func refresh() async {
        isRefreshing = true
        try? await Task.sleep(for: .seconds(1))
        dayPnL += Double.random(in: -50...50)
        dayPnLPercent = dayPnL / (equity - dayPnL) * 100
        isRefreshing = false
    }

    @MainActor
    func runPipeline() async {
        isPipelineRunning = true
        try? await Task.sleep(for: .seconds(3))
        isPipelineRunning = false
    }
}

// MARK: - Local Models (distinct from shared Models.swift)

struct PortfolioEquityPoint: Identifiable {
    let id = UUID()
    let date: Date
    var value: Double
}

struct PortfolioMarketIndex: Identifiable {
    let id = UUID()
    let symbol: String
    let name: String
    let price: Double
    let change: Double
    let changePercent: Double
}

struct PortfolioPosition: Identifiable {
    let id = UUID()
    let symbol: String
    let name: String
    let shares: Int
    let avgCost: Double
    let currentPrice: Double
    let pnl: Double
    let pnlPercent: Double

    var marketValue: Double { Double(shares) * currentPrice }
}

// MARK: - Portfolio View

struct PortfolioView: View {

    @State private var vm = PortfolioViewModel()
    @Environment(AuthManager.self) private var authManager

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottomTrailing) {
                ScrollView(.vertical, showsIndicators: false) {
                    VStack(spacing: AD.spacingLG) {
                        heroSection
                        equityChartSection
                        marketOverviewSection
                        positionsSection
                    }
                    .padding(.horizontal, AD.spacingMD)
                    .padding(.top, AD.spacingSM)
                    .padding(.bottom, 100)
                }
                .refreshable { await vm.refresh() }
                .background(AD.background)

                floatingActions
            }
            .navigationTitle("Portfolio")
            .navigationBarTitleDisplayMode(.large)
            .toolbarBackground(AD.background, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }

    // MARK: - Hero

    private var heroSection: some View {
        VStack(spacing: AD.spacingSM) {
            Text("Total Equity")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(AD.textSecondary)

            Text(vm.equity, format: .currency(code: "USD"))
                .font(.system(size: 42, weight: .bold, design: .default))
                .foregroundStyle(AD.textPrimary)
                .contentTransition(.numericText())

            HStack(spacing: 6) {
                Image(systemName: vm.dayPnL >= 0 ? "arrow.up.right" : "arrow.down.right")
                    .font(.system(size: 13, weight: .semibold))

                Text("\(AD.pnlSign(vm.dayPnL))\(vm.dayPnL, specifier: "%.2f")")
                    .font(.system(size: 16, weight: .semibold, design: .monospaced))
                    .contentTransition(.numericText())

                Text("(\(AD.pnlSign(vm.dayPnLPercent))\(vm.dayPnLPercent, specifier: "%.2f")%)")
                    .font(.system(size: 14, weight: .medium, design: .monospaced))
                    .foregroundStyle(AD.pnlColor(vm.dayPnL).opacity(0.8))

                Text("today")
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(AD.textTertiary)
            }
            .foregroundStyle(AD.pnlColor(vm.dayPnL))

            // Quick stats
            HStack(spacing: AD.spacingXL) {
                statPill("Cash", value: vm.cash)
                statPill("Buying Power", value: vm.buyingPower)
            }
            .padding(.top, AD.spacingSM)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, AD.spacingLG)
    }

    private func statPill(_ label: String, value: Double) -> some View {
        VStack(spacing: 2) {
            Text(label)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(AD.textTertiary)
            Text(value, format: .currency(code: "USD").precision(.fractionLength(0)))
                .font(.system(size: 15, weight: .semibold, design: .monospaced))
                .foregroundStyle(AD.textSecondary)
        }
    }

    // MARK: - Equity Chart

    private var equityChartSection: some View {
        VStack(alignment: .leading, spacing: AD.spacingSM) {
            HStack {
                Text("Equity Curve")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(AD.textPrimary)
                Spacer()
                Text("90D")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(AD.textTertiary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(AD.surfaceElevated)
                    .clipShape(Capsule())
            }

            Chart(vm.equityCurve) { point in
                AreaMark(
                    x: .value("Date", point.date),
                    yStart: .value("Base", vm.equityCurve.map(\.value).min() ?? 92_000),
                    y: .value("Equity", point.value)
                )
                .foregroundStyle(
                    LinearGradient(
                        colors: [AD.accent.opacity(0.25), AD.accent.opacity(0.02)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .interpolationMethod(.catmullRom)

                LineMark(
                    x: .value("Date", point.date),
                    y: .value("Equity", point.value)
                )
                .foregroundStyle(AD.accent)
                .lineStyle(StrokeStyle(lineWidth: 2))
                .interpolationMethod(.catmullRom)
            }
            .chartXAxis(.hidden)
            .chartYAxis {
                AxisMarks(position: .trailing, values: .automatic(desiredCount: 4)) { value in
                    AxisValueLabel {
                        if let v = value.as(Double.self) {
                            Text(v / 1000, format: .number.precision(.fractionLength(0)))
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
            .frame(height: 180)
        }
        .cardStyle()
    }

    // MARK: - Market Overview

    private var marketOverviewSection: some View {
        VStack(alignment: .leading, spacing: AD.spacingSM) {
            Text("Markets")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(AD.textPrimary)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: AD.spacingSM) {
                    ForEach(vm.marketIndices) { index in
                        marketCard(index)
                    }
                }
            }
        }
    }

    private func marketCard(_ index: PortfolioMarketIndex) -> some View {
        VStack(alignment: .leading, spacing: AD.spacingSM) {
            HStack {
                Text(index.symbol)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(AD.textPrimary)
                Spacer()
                Circle()
                    .fill(AD.pnlColor(index.change))
                    .frame(width: 6, height: 6)
            }

            Text(index.name)
                .font(.system(size: 11, weight: .regular))
                .foregroundStyle(AD.textTertiary)
                .lineLimit(1)

            Spacer(minLength: 2)

            Text(index.price, format: .number.precision(.fractionLength(2)))
                .font(.system(size: 16, weight: .semibold, design: .monospaced))
                .foregroundStyle(AD.textPrimary)

            Text("\(AD.pnlSign(index.changePercent))\(index.changePercent, specifier: "%.2f")%")
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .foregroundStyle(AD.pnlColor(index.change))
        }
        .frame(width: 120, height: 115)
        .cardStyle(padding: 12)
    }

    // MARK: - Positions

    private var positionsSection: some View {
        VStack(alignment: .leading, spacing: AD.spacingSM) {
            HStack {
                Text("Positions")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(AD.textPrimary)
                Spacer()
                Text("\(vm.positions.count)")
                    .font(.system(size: 13, weight: .medium, design: .monospaced))
                    .foregroundStyle(AD.textTertiary)
            }

            ForEach(vm.positions) { position in
                positionRow(position)
            }
        }
    }

    private func positionRow(_ position: PortfolioPosition) -> some View {
        HStack(spacing: AD.spacingMD) {
            // Symbol badge
            ZStack {
                RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous)
                    .fill(AD.surfaceElevated)
                    .frame(width: 44, height: 44)

                Text(String(position.symbol.prefix(2)))
                    .font(.system(size: 14, weight: .bold, design: .monospaced))
                    .foregroundStyle(AD.accent)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(position.symbol)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(AD.textPrimary)
                Text("\(position.shares) shares")
                    .font(.system(size: 12, weight: .regular))
                    .foregroundStyle(AD.textTertiary)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 2) {
                Text(position.currentPrice, format: .currency(code: "USD"))
                    .font(.system(size: 15, weight: .semibold, design: .monospaced))
                    .foregroundStyle(AD.textPrimary)

                Text("\(AD.pnlSign(position.pnl))\(position.pnl, specifier: "%.2f")")
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .foregroundStyle(AD.pnlColor(position.pnl))
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

    // MARK: - Floating Actions

    private var floatingActions: some View {
        VStack(spacing: AD.spacingSM) {
            // AI Chat
            Button {
                // AI Chat action placeholder
            } label: {
                Image(systemName: "bubble.left.and.text.bubble.right.fill")
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(.white)
                    .frame(width: 48, height: 48)
                    .background(Color(hex: "6C5CE7"))
                    .clipShape(Circle())
                    .shadow(color: Color(hex: "6C5CE7").opacity(0.3), radius: 10, y: 4)
            }

            // Run Pipeline
            Button {
                Task { await vm.runPipeline() }
            } label: {
                Group {
                    if vm.isPipelineRunning {
                        ProgressView()
                            .tint(.white)
                            .scaleEffect(0.85)
                    } else {
                        Image(systemName: "bolt.fill")
                            .font(.system(size: 19, weight: .medium))
                    }
                }
                .foregroundStyle(.white)
                .frame(width: 56, height: 56)
                .background(
                    LinearGradient(
                        colors: [AD.accent, Color(hex: "3D7AE8")],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .clipShape(Circle())
                .shadow(color: AD.accent.opacity(0.35), radius: 12, y: 6)
            }
            .disabled(vm.isPipelineRunning)
            .sensoryFeedback(.impact(weight: .heavy), trigger: vm.isPipelineRunning)
        }
        .padding(.trailing, AD.spacingMD)
        .padding(.bottom, AD.spacingLG)
    }
}

#Preview {
    PortfolioView()
        .environment(AuthManager.shared)
}
