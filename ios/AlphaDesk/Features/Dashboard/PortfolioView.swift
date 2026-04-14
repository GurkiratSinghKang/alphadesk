import SwiftUI
import Charts

// MARK: - View Model

@Observable
final class PortfolioViewModel {
    var equity: Double = 0
    var dayPnL: Double = 0
    var dayPnLPercent: Double = 0
    var unrealizedPnl: Double = 0
    var unrealizedPnlPct: Double = 0
    var cash: Double = 0
    var buyingPower: Double = 0
    var positionsCount: Int = 0
    var isLoading = true
    var isRefreshing = false
    var isPipelineRunning = false
    var error: String?

    var equityCurve: [PortfolioEquityPoint] = []

    var marketIndices: [PortfolioMarketIndex] = []

    var positions: [PortfolioPosition] = []

    @MainActor
    func refresh() async {
        if !isRefreshing { isLoading = equityCurve.isEmpty }
        isRefreshing = true
        error = nil

        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.fetchSummary() }
            group.addTask { await self.fetchPositions() }
            group.addTask { await self.fetchPerformance() }
            group.addTask { await self.fetchIndices() }
        }

        withAnimation(.easeInOut(duration: 0.25)) {
            isLoading = false
            isRefreshing = false
        }
    }

    @MainActor
    private func fetchSummary() async {
        do {
            let summary: PortfolioSummary = try await APIClient.shared.request(.portfolioSummary)
            equity = summary.equity
            cash = summary.cash
            buyingPower = summary.buyingPower
            dayPnL = summary.realizedPnlToday
            dayPnLPercent = equity > 0 ? (summary.realizedPnlToday / equity) * 100 : 0
            unrealizedPnl = summary.unrealizedPnl
            unrealizedPnlPct = summary.unrealizedPnlPct
            positionsCount = summary.positionsCount
        } catch {
            self.error = error.localizedDescription
        }
    }

    @MainActor
    private func fetchPositions() async {
        do {
            let apiPositions: [Position] = try await APIClient.shared.request(.positions)
            positions = apiPositions.map { p in
                PortfolioPosition(
                    symbol: p.symbol,
                    name: p.symbol,
                    shares: Int(p.quantity),
                    avgCost: p.avgCost,
                    currentPrice: p.currentPrice,
                    pnl: p.unrealizedPnl,
                    pnlPercent: p.unrealizedPnlPct,
                    sparklineData: generatePositionSparkline(symbol: p.symbol, pnlPercent: p.unrealizedPnlPct)
                )
            }
        } catch {
            // Positions error is non-fatal; summary already shown
        }
    }

    @MainActor
    private func fetchPerformance() async {
        do {
            let perf: PerformanceData = try await APIClient.shared.request(.portfolioPerformance(period: "90d"))
            if let curve = perf.equityCurve {
                let dateFormatter = DateFormatter()
                dateFormatter.locale = Locale(identifier: "en_US_POSIX")
                dateFormatter.dateFormat = "yyyy-MM-dd"
                dateFormatter.timeZone = TimeZone(abbreviation: "UTC")

                equityCurve = curve.compactMap { point in
                    guard let value = point.value ?? point.cumulativePnl else { return nil }
                    let date: Date
                    if let d = point.date, let parsed = dateFormatter.date(from: d) {
                        date = parsed
                    } else if let idx = point.index {
                        date = Calendar.current.date(byAdding: .day, value: -90 + idx, to: Date()) ?? Date()
                    } else {
                        return nil
                    }
                    return PortfolioEquityPoint(date: date, value: value)
                }
            } else if let values = perf.values {
                equityCurve = values.enumerated().map { i, v in
                    let date = Calendar.current.date(byAdding: .day, value: -values.count + i, to: Date()) ?? Date()
                    return PortfolioEquityPoint(date: date, value: v)
                }
            }
        } catch {
            // Performance chart error is non-fatal
        }
    }

    @MainActor
    private func fetchIndices() async {
        do {
            let response: IndicesResponse = try await APIClient.shared.request(.indices)
            marketIndices = response.indices.map { idx in
                PortfolioMarketIndex(
                    symbol: idx.symbol,
                    name: idx.name,
                    price: idx.price,
                    change: idx.change,
                    changePercent: idx.changePct
                )
            }
        } catch {
            // Indices error is non-fatal
        }
    }

    @MainActor
    func runPipeline() async {
        isPipelineRunning = true
        do {
            let _: PipelineRunResponse = try await APIClient.shared.request(
                .pipelineRun,
                method: .post,
                body: PipelineRunRequest(force: false)
            )
        } catch {
            // Pipeline run error is non-fatal for dashboard
        }
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
    var sparklineData: [Double]

    var marketValue: Double { Double(shares) * currentPrice }

    /// Position weight as a percentage of total equity.
    func weight(totalEquity: Double) -> Double {
        guard totalEquity > 0 else { return 0 }
        return (marketValue / totalEquity) * 100
    }
}

/// Generate a synthetic mini sparkline from symbol hash for display
/// until real intraday data is available from the API.
private func generatePositionSparkline(symbol: String, pnlPercent: Double) -> [Double] {
    var rng = PositionSparkRNG(seed: UInt64(abs(symbol.hashValue) &* 54321))
    var values: [Double] = []
    var current: Double = 100
    let trend = pnlPercent / 40.0
    for _ in 0..<12 {
        let noise = (rng.nextDouble() - 0.5) * 3
        current += trend + noise
        current = max(current, 85)
        values.append(current)
    }
    return values
}

private struct PositionSparkRNG: RandomNumberGenerator {
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

// MARK: - Portfolio View

struct PortfolioView: View {

    @State private var vm = PortfolioViewModel()
    @State private var showChat = false
    @State private var showPerformance = false
    @State private var showNews = false
    @State private var tradeSymbol: String?
    @State private var tradeSide: TradeViewModel.OrderSide = .buy
    @State private var showTradeSheet = false
    @Environment(AuthManager.self) private var authManager

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottomTrailing) {
                Group {
                    if vm.isLoading {
                        LoadingView()
                            .transition(.opacity)
                    } else if let error = vm.error, vm.positions.isEmpty {
                        errorView(error)
                            .transition(.opacity)
                    } else {
                        ScrollViewReader { proxy in
                        ScrollView(.vertical, showsIndicators: false) {
                            VStack(spacing: AD.spacingLG) {
                                heroSection
                                if !vm.equityCurve.isEmpty {
                                    equityChartSection
                                }
                                if !vm.marketIndices.isEmpty {
                                    marketOverviewSection
                                }
                                positionsSection
                            }
                            .id("portfolioScrollTop")
                            .padding(.horizontal, AD.spacingMD)
                            .padding(.top, AD.spacingSM)
                            .padding(.bottom, 100)
                        }
                        .refreshable { await vm.refresh() }
                        .transition(.opacity)
                        .onReceive(NotificationCenter.default.publisher(for: .scrollToTop)) { notification in
                            if let tab = notification.object as? MainTabView.Tab, tab == .portfolio {
                                withAnimation(.easeInOut(duration: 0.3)) {
                                    proxy.scrollTo("portfolioScrollTop", anchor: .top)
                                }
                            }
                        }
                    }
                    }
                }
                .animation(.easeInOut, value: vm.isLoading)
                .background(AD.background)

                if !vm.isLoading {
                    floatingActions
                }
            }
            .navigationTitle("Portfolio")
            .navigationBarTitleDisplayMode(.large)
            .toolbarBackground(AD.background, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button {
                        showNews = true
                    } label: {
                        Image(systemName: "newspaper")
                            .font(.system(size: 16))
                            .foregroundStyle(AD.textSecondary)
                    }

                    Button {
                        showPerformance = true
                    } label: {
                        Image(systemName: "chart.xyaxis.line")
                            .font(.system(size: 16))
                            .foregroundStyle(AD.textSecondary)
                    }
                }
            }
            .task { await vm.refresh() }
            .sheet(isPresented: $showChat) {
                ChatView(
                    contextPortfolioValue: vm.equity
                )
            }
            .sheet(isPresented: $showPerformance) {
                PerformanceView()
            }
            .sheet(isPresented: $showNews) {
                NewsView()
            }
            .sheet(isPresented: $showTradeSheet) {
                if let symbol = tradeSymbol {
                    NavigationStack {
                        TradeView(initialSymbol: symbol, initialSide: tradeSide)
                            .toolbar {
                                ToolbarItem(placement: .topBarLeading) {
                                    Button { showTradeSheet = false } label: {
                                        Image(systemName: "xmark.circle.fill")
                                            .font(.system(size: 22))
                                            .foregroundStyle(AD.textTertiary)
                                    }
                                }
                            }
                    }
                }
            }
            .navigationDestination(for: String.self) { symbol in
                SymbolDetailView(symbol: symbol)
            }
        }
    }

    // MARK: - Error View

    private func errorView(_ message: String) -> some View {
        VStack(spacing: AD.spacingMD) {
            Spacer()
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 40))
                .foregroundStyle(AD.loss)
            Text("Failed to load portfolio")
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

    // MARK: - Hero

    private var heroSection: some View {
        VStack(spacing: AD.spacingSM) {
            Text("Total Equity")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(AD.textSecondary)

            Text(vm.equity, format: .currency(code: "USD"))
                .font(.system(size: 42, weight: .bold, design: .default))
                .foregroundStyle(AD.textPrimary)
                .contentTransition(.numericText(value: vm.equity))
                .animation(.spring(duration: 0.3), value: vm.equity)

            HStack(spacing: 6) {
                Image(systemName: vm.dayPnL >= 0 ? "arrow.up.right" : "arrow.down.right")
                    .font(.system(size: 13, weight: .semibold))

                Text("\(AD.pnlSign(vm.dayPnL))\(vm.dayPnL, specifier: "%.2f")")
                    .font(.system(size: 16, weight: .semibold, design: .monospaced))
                    .contentTransition(.numericText(value: vm.dayPnL))
                    .animation(.spring(duration: 0.3), value: vm.dayPnL)

                Text("(\(AD.pnlSign(vm.dayPnLPercent))\(vm.dayPnLPercent, specifier: "%.2f")%)")
                    .font(.system(size: 14, weight: .medium, design: .monospaced))
                    .foregroundStyle(AD.pnlColor(vm.dayPnL).opacity(0.8))

                Text("today")
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(AD.textTertiary)
            }
            .foregroundStyle(AD.pnlColor(vm.dayPnL))

            HStack(spacing: 6) {
                Image(systemName: vm.unrealizedPnl >= 0 ? "arrow.up.right" : "arrow.down.right")
                    .font(.system(size: 11, weight: .medium))

                Text("\(AD.pnlSign(vm.unrealizedPnl))\(vm.unrealizedPnl, specifier: "%.2f")")
                    .font(.system(size: 13, weight: .medium, design: .monospaced))
                    .contentTransition(.numericText(value: vm.unrealizedPnl))
                    .animation(.spring(duration: 0.3), value: vm.unrealizedPnl)

                Text("(\(AD.pnlSign(vm.unrealizedPnlPct))\(vm.unrealizedPnlPct, specifier: "%.2f")%)")
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .foregroundStyle(AD.pnlColor(vm.unrealizedPnl).opacity(0.8))

                Text("unrealized")
                    .font(.system(size: 12, weight: .regular))
                    .foregroundStyle(AD.textTertiary)
            }
            .foregroundStyle(AD.pnlColor(vm.unrealizedPnl))

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
                    yStart: .value("Base", vm.equityCurve.map(\.value).min() ?? 0),
                    yEnd: .value("Equity", point.value)
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

            if vm.positions.isEmpty {
                ContentUnavailableView(
                    "No Positions",
                    systemImage: "chart.bar.xaxis",
                    description: Text("Your open positions will appear here")
                )
                .frame(maxWidth: .infinity)
                .padding(.vertical, AD.spacingSM)
            } else {
                List {
                    ForEach(vm.positions) { position in
                        NavigationLink(value: position.symbol) {
                            positionRow(position)
                        }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 2, leading: 0, bottom: 2, trailing: 0))
                        .listRowSeparator(.hidden)
                        .swipeActions(edge: .trailing) {
                            Button {
                                tradeSymbol = position.symbol
                                tradeSide = .sell
                                showTradeSheet = true
                            } label: {
                                Label("Sell", systemImage: "arrow.down.circle.fill")
                            }
                            .tint(AD.loss)
                        }
                        .swipeActions(edge: .leading) {
                            Button {
                                tradeSymbol = position.symbol
                                tradeSide = .buy
                                showTradeSheet = true
                            } label: {
                                Label("Buy", systemImage: "arrow.up.circle.fill")
                            }
                            .tint(AD.profit)
                        }
                    }
                }
                .listStyle(.plain)
                .scrollDisabled(true)
                .frame(minHeight: CGFloat(vm.positions.count) * 76)
            }
        }
    }

    private func positionRow(_ position: PortfolioPosition) -> some View {
        HStack(spacing: AD.spacingSM) {
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
                HStack(spacing: 4) {
                    Text("\(position.shares) shares")
                        .font(.system(size: 12, weight: .regular))
                        .foregroundStyle(AD.textTertiary)

                    let weight = position.weight(totalEquity: vm.equity)
                    if weight > 0 {
                        Text("\(String(format: "%.1f", weight))%")
                            .font(.system(size: 10, weight: .semibold, design: .monospaced))
                            .foregroundStyle(AD.accent)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(AD.accentDim)
                            .clipShape(Capsule())
                    }
                }
            }

            Spacer()

            // Mini sparkline
            if position.sparklineData.count >= 2 {
                SparklineView(data: position.sparklineData, height: 24, lineWidth: 1.2)
                    .frame(width: 44, height: 24)
            }

            VStack(alignment: .trailing, spacing: 2) {
                Text(position.currentPrice, format: .currency(code: "USD"))
                    .font(.system(size: 15, weight: .semibold, design: .monospaced))
                    .foregroundStyle(AD.textPrimary)
                    .contentTransition(.numericText(value: position.currentPrice))
                    .animation(.spring(duration: 0.3), value: position.currentPrice)

                Text("\(AD.pnlSign(position.pnl))\(position.pnl, specifier: "%.2f")")
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .foregroundStyle(AD.pnlColor(position.pnl))
                    .contentTransition(.numericText(value: position.pnl))
                    .animation(.spring(duration: 0.3), value: position.pnl)
            }

            Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(AD.textTertiary.opacity(0.5))
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
                showChat = true
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
