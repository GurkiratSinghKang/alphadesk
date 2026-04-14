import SwiftUI
import Charts

// MARK: - View Model

@Observable
final class SymbolDetailViewModel {
    let symbol: String

    var companyName: String = ""
    var price: Double = 0
    var change: Double = 0
    var changePct: Double = 0
    var open: Double = 0
    var high: Double = 0
    var low: Double = 0
    var volume: Int = 0
    var prevClose: Double = 0
    var high52w: Double = 0
    var low52w: Double = 0

    var bars: [OHLCVBar] = []
    var selectedTimeframe: Timeframe = .oneDay
    var isLoadingQuote = true
    var isLoadingBars = true

    var news: [NewsArticle] = []

    // Position (if held)
    var position: Position?
    var hasPosition: Bool { position != nil }

    enum Timeframe: String, CaseIterable {
        case oneDay = "1D"
        case oneWeek = "1W"
        case oneMonth = "1M"
        case threeMonth = "3M"
        case oneYear = "1Y"

        var apiTimeframe: String {
            switch self {
            case .oneDay:    return "5Min"
            case .oneWeek:   return "15Min"
            case .oneMonth:  return "1Day"
            case .threeMonth: return "1Day"
            case .oneYear:   return "1Day"
            }
        }

        var barLimit: Int {
            switch self {
            case .oneDay:    return 78   // 6.5h * 12
            case .oneWeek:   return 130  // 5d * 26
            case .oneMonth:  return 22
            case .threeMonth: return 66
            case .oneYear:   return 252
            }
        }
    }

    init(symbol: String) {
        self.symbol = symbol
    }

    @MainActor
    func load() async {
        async let quoteTask: () = loadQuote()
        async let barsTask: () = loadBars()
        async let posTask: () = loadPosition()
        async let newsTask: () = loadNews()
        _ = await (quoteTask, barsTask, posTask, newsTask)
    }

    @MainActor
    func loadQuote() async {
        isLoadingQuote = true
        do {
            let quote: Quote = try await APIClient.shared.request(.quote(symbol: symbol))
            price = quote.last
            change = quote.change ?? 0
            changePct = quote.changePct ?? 0
            open = quote.open ?? 0
            high = quote.high ?? 0
            low = quote.low ?? 0
            volume = quote.volume
            prevClose = quote.close ?? 0
        } catch {
            // Use fallback values
        }
        isLoadingQuote = false
    }

    @MainActor
    func loadBars() async {
        isLoadingBars = true
        do {
            let fetched: [OHLCVBar] = try await APIClient.shared.request(
                .bars(
                    symbol: symbol,
                    timeframe: selectedTimeframe.apiTimeframe,
                    limit: selectedTimeframe.barLimit
                )
            )
            bars = fetched
        } catch {
            // Keep existing bars
        }
        isLoadingBars = false
    }

    @MainActor
    func loadPosition() async {
        do {
            let positions: [Position] = try await APIClient.shared.request(.positions)
            position = positions.first { $0.symbol == symbol }
        } catch {
            // No position data
        }
    }

    @MainActor
    func loadNews() async {
        do {
            let response: NewsResponse = try await APIClient.shared.request(.symbolNews(symbol: symbol))
            news = Array(response.articles.prefix(5))
        } catch {
            // No news
        }
    }

    @MainActor
    func changeTimeframe(_ tf: Timeframe) async {
        selectedTimeframe = tf
        await loadBars()
    }
}

// MARK: - View

struct SymbolDetailView: View {

    let symbol: String
    @State private var vm: SymbolDetailViewModel
    @State private var showBuySheet = false
    @State private var showSellSheet = false

    init(symbol: String) {
        self.symbol = symbol
        _vm = State(initialValue: SymbolDetailViewModel(symbol: symbol))
    }

    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(spacing: AD.spacingLG) {
                priceHeader
                chartSection
                statsSection
                orderButtons
                if vm.hasPosition {
                    positionSection
                }
                if !vm.news.isEmpty {
                    newsSection
                }
            }
            .padding(.horizontal, AD.spacingMD)
            .padding(.top, AD.spacingSM)
            .padding(.bottom, 100)
        }
        .background(AD.background)
        .navigationTitle(symbol)
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(AD.background, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .task { await vm.load() }
    }

    // MARK: - Price Header

    private var priceHeader: some View {
        VStack(spacing: AD.spacingSM) {
            if !vm.companyName.isEmpty {
                Text(vm.companyName)
                    .font(.system(size: 14, weight: .regular))
                    .foregroundStyle(AD.textSecondary)
            }

            if vm.isLoadingQuote && vm.price == 0 {
                ProgressView()
                    .tint(AD.accent)
                    .padding(.vertical, AD.spacingLG)
            } else {
                Text(vm.price, format: .currency(code: "USD"))
                    .font(.system(size: 42, weight: .bold, design: .monospaced))
                    .foregroundStyle(AD.textPrimary)
                    .contentTransition(.numericText())

                HStack(spacing: 6) {
                    Image(systemName: vm.change >= 0 ? "arrow.up.right" : "arrow.down.right")
                        .font(.system(size: 13, weight: .semibold))

                    Text("\(AD.pnlSign(vm.change))\(vm.change, specifier: "%.2f")")
                        .font(.system(size: 16, weight: .semibold, design: .monospaced))
                        .contentTransition(.numericText())

                    Text("(\(AD.pnlSign(vm.changePct))\(vm.changePct, specifier: "%.2f")%)")
                        .font(.system(size: 14, weight: .medium, design: .monospaced))
                        .foregroundStyle(AD.pnlColor(vm.change).opacity(0.8))
                }
                .foregroundStyle(AD.pnlColor(vm.change))
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, AD.spacingMD)
    }

    // MARK: - Chart Section

    private var chartSection: some View {
        VStack(alignment: .leading, spacing: AD.spacingSM) {
            // Timeframe selector
            HStack(spacing: 0) {
                ForEach(SymbolDetailViewModel.Timeframe.allCases, id: \.self) { tf in
                    Button {
                        Task { await vm.changeTimeframe(tf) }
                    } label: {
                        Text(tf.rawValue)
                            .font(.system(size: 13, weight: vm.selectedTimeframe == tf ? .semibold : .regular))
                            .foregroundStyle(vm.selectedTimeframe == tf ? AD.accent : AD.textTertiary)
                            .frame(maxWidth: .infinity)
                            .frame(height: 34)
                            .background(
                                vm.selectedTimeframe == tf ? AD.accentDim : .clear
                            )
                            .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous))
                    }
                    .sensoryFeedback(.selection, trigger: vm.selectedTimeframe)
                }
            }
            .padding(3)
            .background(AD.surfaceElevated)
            .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM + 3, style: .continuous))

            // Chart
            if vm.isLoadingBars && vm.bars.isEmpty {
                RoundedRectangle(cornerRadius: AD.radiusSM)
                    .fill(AD.surfaceElevated)
                    .frame(height: 200)
                    .shimmer()
            } else if vm.bars.count >= 2 {
                Chart(vm.bars) { bar in
                    AreaMark(
                        x: .value("Time", bar.timestamp),
                        yStart: .value("Base", vm.bars.map(\.close).min() ?? 0),
                        y: .value("Close", bar.close)
                    )
                    .foregroundStyle(
                        LinearGradient(
                            colors: [
                                AD.pnlColor(vm.change).opacity(0.25),
                                AD.pnlColor(vm.change).opacity(0.02)
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .interpolationMethod(.catmullRom)

                    LineMark(
                        x: .value("Time", bar.timestamp),
                        y: .value("Close", bar.close)
                    )
                    .foregroundStyle(AD.pnlColor(vm.change))
                    .lineStyle(StrokeStyle(lineWidth: 2))
                    .interpolationMethod(.catmullRom)
                }
                .chartXAxis(.hidden)
                .chartYAxis {
                    AxisMarks(position: .trailing, values: .automatic(desiredCount: 4)) { value in
                        AxisValueLabel {
                            if let v = value.as(Double.self) {
                                Text(String(format: "%.2f", v))
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundStyle(AD.textTertiary)
                            }
                        }
                        AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5, dash: [3, 3]))
                            .foregroundStyle(AD.border)
                    }
                }
                .chartYScale(domain: .automatic(includesZero: false))
                .frame(height: 200)
            } else {
                VStack {
                    Image(systemName: "chart.line.downtrend.xyaxis")
                        .font(.system(size: 30))
                        .foregroundStyle(AD.textTertiary)
                    Text("No chart data available")
                        .font(.system(size: 13))
                        .foregroundStyle(AD.textTertiary)
                }
                .frame(maxWidth: .infinity)
                .frame(height: 200)
            }
        }
        .cardStyle()
    }

    // MARK: - Stats Section

    private var statsSection: some View {
        VStack(alignment: .leading, spacing: AD.spacingSM) {
            Text("Key Statistics")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(AD.textPrimary)

            LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 3), spacing: AD.spacingSM) {
                statItem("Open", value: formatPrice(vm.open))
                statItem("High", value: formatPrice(vm.high))
                statItem("Low", value: formatPrice(vm.low))
                statItem("Volume", value: Double(vm.volume).formatCompact())
                statItem("52W High", value: vm.high52w > 0 ? formatPrice(vm.high52w) : "--")
                statItem("52W Low", value: vm.low52w > 0 ? formatPrice(vm.low52w) : "--")
            }
        }
        .cardStyle()
    }

    private func statItem(_ label: String, value: String) -> some View {
        VStack(spacing: 4) {
            Text(label)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(AD.textTertiary)
            Text(value)
                .font(.system(size: 14, weight: .semibold, design: .monospaced))
                .foregroundStyle(AD.textSecondary)
        }
    }

    private func formatPrice(_ value: Double) -> String {
        guard value > 0 else { return "--" }
        return String(format: "$%.2f", value)
    }

    // MARK: - Order Buttons

    private var orderButtons: some View {
        HStack(spacing: AD.spacingSM) {
            NavigationLink {
                TradeView()
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 16))
                    Text("Buy")
                        .font(.system(size: 16, weight: .semibold))
                }
                .frame(maxWidth: .infinity)
                .frame(height: 50)
                .background(AD.profit)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: AD.radiusMD, style: .continuous))
                .shadow(color: AD.profit.opacity(0.25), radius: 8, y: 4)
            }

            NavigationLink {
                TradeView()
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.down.circle.fill")
                        .font(.system(size: 16))
                    Text("Sell")
                        .font(.system(size: 16, weight: .semibold))
                }
                .frame(maxWidth: .infinity)
                .frame(height: 50)
                .background(AD.loss)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: AD.radiusMD, style: .continuous))
                .shadow(color: AD.loss.opacity(0.25), radius: 8, y: 4)
            }
        }
    }

    // MARK: - Position Section

    private var positionSection: some View {
        VStack(alignment: .leading, spacing: AD.spacingSM) {
            HStack(spacing: AD.spacingSM) {
                Image(systemName: "briefcase.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(AD.accent)
                Text("Your Position")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(AD.textPrimary)
            }

            if let pos = vm.position {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 2), spacing: AD.spacingSM) {
                    positionMetric("Quantity", value: String(format: "%.0f", pos.quantity))
                    positionMetric("Avg Cost", value: String(format: "$%.2f", pos.avgCost))
                    positionMetric("Mkt Value", value: pos.marketValue.formatCurrency())
                    positionMetric("P&L",
                                   value: "\(AD.pnlSign(pos.unrealizedPnl))\(pos.unrealizedPnl.formatCurrency())",
                                   color: AD.pnlColor(pos.unrealizedPnl))
                }
            }
        }
        .cardStyle()
    }

    private func positionMetric(_ label: String, value: String, color: Color = AD.textPrimary) -> some View {
        VStack(spacing: 4) {
            Text(label)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(AD.textTertiary)
            Text(value)
                .font(.system(size: 15, weight: .semibold, design: .monospaced))
                .foregroundStyle(color)
        }
    }

    // MARK: - News Section

    private var newsSection: some View {
        VStack(alignment: .leading, spacing: AD.spacingSM) {
            HStack(spacing: AD.spacingSM) {
                Image(systemName: "newspaper.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(AD.textTertiary)
                Text("Recent News")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(AD.textPrimary)
            }

            ForEach(vm.news) { article in
                VStack(alignment: .leading, spacing: 4) {
                    Text(article.title)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(AD.textPrimary)
                        .lineLimit(2)

                    HStack(spacing: 4) {
                        if let source = article.source {
                            Text(source)
                                .font(.system(size: 11, weight: .regular))
                                .foregroundStyle(AD.textTertiary)
                        }
                    }
                }
                .padding(.vertical, 6)

                if article.id != vm.news.last?.id {
                    Divider().background(AD.border)
                }
            }
        }
        .cardStyle()
    }
}

#Preview {
    NavigationStack {
        SymbolDetailView(symbol: "AAPL")
    }
    .environment(AuthManager.shared)
}
