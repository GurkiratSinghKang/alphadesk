import SwiftUI
import Charts

// MARK: - View Model

@Observable
final class TradeViewModel {
    var searchText = ""
    var isSearching = false
    var searchResults: [SymbolSearchResult] = []

    // Recent searches (persisted)
    private static let recentSearchesKey = "AlphaDesk_recentSearches"
    private static let maxRecentSearches = 8
    var recentSearches: [SymbolSearchResult] = []

    // Current quote
    var symbol = "AAPL"
    var companyName = "AAPL"
    var price: Double = 0
    var change: Double = 0
    var changePercent: Double = 0
    var volume: Double = 0
    var quoteOpen: Double = 0
    var quoteHigh: Double = 0
    var quoteLow: Double = 0
    var prevClose: Double = 0
    var marketCap: String = "--"
    var support: Double = 0
    var resistance: Double = 0

    // Price history
    var priceHistory: [TradePricePoint] = []

    // Order entry
    var orderSide: OrderSide = .buy
    var quantity: String = ""
    var orderType: OrderType = .market
    var limitPrice: String = ""
    var isSubmitting = false
    var showConfirmation = false
    var orderError: String?

    // Loading states
    var isLoading = true
    var error: String?

    // WebSocket listener task
    private var wsTask: Task<Void, Never>?

    enum OrderSide: String, CaseIterable {
        case buy, sell
        var label: String { rawValue.capitalized }
        var color: Color { self == .buy ? AD.profit : AD.loss }
    }

    enum OrderType: String, CaseIterable {
        case market, limit, stop
        var label: String { rawValue.capitalized }
    }

    var estimatedCost: Double {
        let qty = Double(quantity) ?? 0
        let px = orderType == .limit ? (Double(limitPrice) ?? price) : price
        return qty * px
    }

    var canSubmit: Bool {
        guard let qty = Int(quantity), qty > 0 else { return false }
        if orderType == .limit || orderType == .stop {
            guard let lp = Double(limitPrice), lp > 0 else { return false }
        }
        return price > 0
    }

    @MainActor
    func refresh() async {
        isLoading = priceHistory.isEmpty
        error = nil
        await fetchQuote()
        await fetchBars()
        isLoading = false
    }

    @MainActor
    func fetchQuote() async {
        do {
            let quote: Quote = try await APIClient.shared.request(.quote(symbol: symbol))
            price = quote.last
            change = quote.change ?? 0
            changePercent = quote.changePct ?? 0
            volume = Double(quote.volume)
            quoteOpen = quote.open ?? 0
            quoteHigh = quote.high ?? 0
            quoteLow = quote.low ?? 0
            prevClose = quote.close ?? 0

            // Derive support/resistance from quote data
            if quoteHigh > 0 && quoteLow > 0 {
                support = quoteLow
                resistance = quoteHigh
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    @MainActor
    func fetchBars() async {
        do {
            let bars: [OHLCVBar] = try await APIClient.shared.request(
                .bars(symbol: symbol, timeframe: "1D", limit: 30)
            )
            priceHistory = bars.map { bar in
                TradePricePoint(date: bar.timestamp, price: bar.close)
            }
        } catch {
            // Chart data is non-fatal
        }
    }

    func search() {
        guard !searchText.isEmpty else { searchResults = []; return }
        isSearching = true

        Task { @MainActor in
            do {
                let results: [SymbolSearchResult] = try await APIClient.shared.request(
                    .searchSymbols(query: searchText)
                )
                searchResults = results
            } catch {
                // Fallback: local filter
                let allSymbols = ["AAPL", "AMZN", "GOOGL", "GOOG", "META", "MSFT", "NVDA", "TSLA",
                                  "AMD", "NFLX", "CRM", "ADBE", "INTC", "PYPL", "SQ", "SHOP"]
                let query = searchText.uppercased()
                searchResults = allSymbols.filter { $0.contains(query) }.map {
                    SymbolSearchResult(symbol: $0, name: nil, type: nil)
                }
            }
            isSearching = false
        }
    }

    func loadRecentSearches() {
        guard let data = UserDefaults.standard.data(forKey: Self.recentSearchesKey),
              let decoded = try? JSONDecoder().decode([SymbolSearchResult].self, from: data) else {
            return
        }
        recentSearches = decoded
    }

    private func saveRecentSearch(_ result: SymbolSearchResult) {
        // Remove duplicates, prepend new result, trim to max
        recentSearches.removeAll { $0.symbol == result.symbol }
        recentSearches.insert(result, at: 0)
        if recentSearches.count > Self.maxRecentSearches {
            recentSearches = Array(recentSearches.prefix(Self.maxRecentSearches))
        }
        if let data = try? JSONEncoder().encode(recentSearches) {
            UserDefaults.standard.set(data, forKey: Self.recentSearchesKey)
        }
    }

    func clearRecentSearches() {
        recentSearches = []
        UserDefaults.standard.removeObject(forKey: Self.recentSearchesKey)
    }

    @MainActor
    func selectSymbol(_ result: SymbolSearchResult) {
        symbol = result.symbol
        companyName = result.name ?? result.symbol
        searchText = ""
        searchResults = []
        saveRecentSearch(result)
        Task { await refresh() }
    }

    @MainActor
    func submitOrder() async {
        guard canSubmit else { return }
        isSubmitting = true
        orderError = nil

        do {
            let order = OrderRequest(
                symbol: symbol,
                qty: Int(quantity) ?? 0,
                side: orderSide.rawValue,
                type: orderType.rawValue,
                limitPrice: orderType == .limit ? Double(limitPrice) : nil,
                stopPrice: orderType == .stop ? Double(limitPrice) : nil,
                timeInForce: "day"
            )
            let _: OrderResponse = try await APIClient.shared.request(
                .submitOrder,
                method: .post,
                body: order
            )
            showConfirmation = true
            quantity = ""
            limitPrice = ""
        } catch {
            orderError = error.localizedDescription
        }

        isSubmitting = false
    }

    func startWebSocketUpdates() {
        wsTask?.cancel()
        wsTask = Task { [weak self] in
            guard let self else { return }
            for await event in WebSocketClient.shared.events {
                if Task.isCancelled { break }
                if case .message(let msg) = event {
                    if case .channelData(_, let data) = msg {
                        await MainActor.run {
                            if let last = data["last"] as? Double {
                                self.price = last
                            }
                            if let ch = data["change"] as? Double {
                                self.change = ch
                            }
                            if let chPct = data["change_pct"] as? Double {
                                self.changePercent = chPct
                            }
                        }
                    }
                }
            }
        }
    }

    func stopWebSocketUpdates() {
        wsTask?.cancel()
        wsTask = nil
    }
}

struct TradePricePoint: Identifiable {
    let id = UUID()
    let date: Date
    var price: Double
}

// MARK: - Trade View

struct TradeView: View {

    var initialSymbol: String?
    var initialSide: TradeViewModel.OrderSide?

    @State private var vm = TradeViewModel()
    @State private var scrollProxy: ScrollViewProxy?
    @FocusState private var isSearchFocused: Bool

    // State preservation
    private static let selectedSymbolKey = "AlphaDesk_selectedSymbol"

    var body: some View {
        NavigationStack {
            Group {
                if vm.isLoading {
                    LoadingView()
                        .transition(.opacity)
                } else {
                    ScrollViewReader { proxy in
                        ScrollView(.vertical, showsIndicators: false) {
                            VStack(spacing: AD.spacingLG) {
                                searchSection
                                if let error = vm.error {
                                    errorBanner(error)
                                }
                                quoteSection
                                if !vm.priceHistory.isEmpty {
                                    chartSection
                                }
                                if vm.support > 0 && vm.resistance > 0 {
                                    keyLevelsSection
                                }
                                if let orderError = vm.orderError {
                                    orderErrorBanner(orderError)
                                }
                                orderEntrySection
                            }
                            .id("tradeScrollTop")
                            .padding(.horizontal, AD.spacingMD)
                            .padding(.top, AD.spacingSM)
                            .padding(.bottom, 100)
                        }
                        .refreshable { await vm.refresh() }
                        .transition(.opacity)
                        .onReceive(NotificationCenter.default.publisher(for: .scrollToTop)) { notification in
                            if let tab = notification.object as? MainTabView.Tab, tab == .trade {
                                withAnimation(.easeInOut(duration: 0.3)) {
                                    proxy.scrollTo("tradeScrollTop", anchor: .top)
                                }
                            }
                        }
                    }
                }
            }
            .animation(.easeInOut, value: vm.isLoading)
            .background(AD.background)
            .navigationTitle("Trade")
            .navigationBarTitleDisplayMode(.large)
            .toolbarBackground(AD.background, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    NavigationLink {
                        WatchlistView()
                    } label: {
                        Image(systemName: "star.fill")
                            .font(.system(size: 16))
                            .foregroundStyle(AD.textSecondary)
                    }

                    NavigationLink {
                        OrderHistoryView()
                    } label: {
                        Image(systemName: "clock.arrow.circlepath")
                            .font(.system(size: 16))
                            .foregroundStyle(AD.textSecondary)
                    }
                }
            }
            .overlay {
                if vm.showConfirmation {
                    confirmationOverlay
                }
            }
            .sensoryFeedback(.success, trigger: vm.showConfirmation)
            .task {
                vm.loadRecentSearches()

                if let sym = initialSymbol {
                    vm.symbol = sym
                    vm.companyName = sym
                } else if let saved = UserDefaults.standard.string(forKey: Self.selectedSymbolKey),
                          !saved.isEmpty {
                    vm.symbol = saved
                    vm.companyName = saved
                }
                if let side = initialSide {
                    vm.orderSide = side
                }
                await vm.refresh()
                vm.startWebSocketUpdates()
            }
            .onChange(of: vm.symbol) { _, newSymbol in
                UserDefaults.standard.set(newSymbol, forKey: Self.selectedSymbolKey)
            }
            .onDisappear {
                vm.stopWebSocketUpdates()
            }
        }
    }

    // MARK: - Error Banners

    private func errorBanner(_ message: String) -> some View {
        HStack(spacing: AD.spacingSM) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 14))
                .foregroundStyle(AD.loss)
            Text(message)
                .font(.system(size: 13))
                .foregroundStyle(AD.textSecondary)
                .lineLimit(2)
            Spacer()
            Button {
                Task { await vm.refresh() }
            } label: {
                Text("Retry")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(AD.accent)
            }
        }
        .padding(AD.spacingSM)
        .background(AD.loss.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous))
    }

    private func orderErrorBanner(_ message: String) -> some View {
        HStack(spacing: AD.spacingSM) {
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 14))
                .foregroundStyle(AD.loss)
            Text("Order failed: \(message)")
                .font(.system(size: 13))
                .foregroundStyle(AD.textSecondary)
                .lineLimit(2)
            Spacer()
        }
        .padding(AD.spacingSM)
        .background(AD.loss.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous))
    }

    // MARK: - Search

    private var searchSection: some View {
        VStack(spacing: 0) {
            HStack(spacing: AD.spacingSM) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 15))
                    .foregroundStyle(AD.textTertiary)

                TextField("", text: $vm.searchText, prompt: Text("Search symbol...").foregroundStyle(AD.textTertiary))
                    .font(.system(size: 16))
                    .foregroundStyle(AD.textPrimary)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.characters)
                    .focused($isSearchFocused)
                    .onChange(of: vm.searchText) { _, _ in vm.search() }
                    .onSubmit { vm.search() }

                if !vm.searchText.isEmpty {
                    Button {
                        vm.searchText = ""
                        vm.searchResults = []
                        isSearchFocused = false
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 16))
                            .foregroundStyle(AD.textTertiary)
                    }
                }
            }
            .padding(.horizontal, AD.spacingMD)
            .padding(.vertical, 12)
            .background(AD.surface)
            .clipShape(RoundedRectangle(cornerRadius: AD.radiusMD, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: AD.radiusMD, style: .continuous)
                    .stroke(isSearchFocused ? AD.accent.opacity(0.4) : AD.border, lineWidth: 1)
            )

            // Search Results Dropdown
            if !vm.searchResults.isEmpty {
                VStack(spacing: 0) {
                    ForEach(vm.searchResults) { result in
                        Button {
                            vm.selectSymbol(result)
                            isSearchFocused = false
                        } label: {
                            HStack {
                                Image(systemName: "magnifyingglass")
                                    .font(.system(size: 12))
                                    .foregroundStyle(AD.textTertiary)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(result.symbol)
                                        .font(.system(size: 15, weight: .medium, design: .monospaced))
                                        .foregroundStyle(AD.textPrimary)
                                    if let name = result.name {
                                        Text(name)
                                            .font(.system(size: 12))
                                            .foregroundStyle(AD.textTertiary)
                                            .lineLimit(1)
                                    }
                                }
                                Spacer()
                                Image(systemName: "arrow.up.left")
                                    .font(.system(size: 12))
                                    .foregroundStyle(AD.textTertiary)
                            }
                            .padding(.horizontal, AD.spacingMD)
                            .padding(.vertical, 10)
                        }

                        if result.id != vm.searchResults.last?.id {
                            Divider()
                                .background(AD.border)
                        }
                    }
                }
                .background(AD.surfaceElevated)
                .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous)
                        .stroke(AD.border, lineWidth: 1)
                )
                .padding(.top, 4)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }

            // Recent Searches (shown when focused with empty search text)
            if isSearchFocused && vm.searchText.isEmpty && !vm.recentSearches.isEmpty {
                VStack(spacing: 0) {
                    HStack {
                        Text("Recent")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(AD.textTertiary)
                        Spacer()
                        Button {
                            vm.clearRecentSearches()
                        } label: {
                            Text("Clear")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(AD.accent)
                        }
                    }
                    .padding(.horizontal, AD.spacingMD)
                    .padding(.vertical, 8)

                    Divider().background(AD.border)

                    ForEach(vm.recentSearches) { result in
                        Button {
                            vm.selectSymbol(result)
                            isSearchFocused = false
                        } label: {
                            HStack {
                                Image(systemName: "clock.arrow.circlepath")
                                    .font(.system(size: 12))
                                    .foregroundStyle(AD.textTertiary)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(result.symbol)
                                        .font(.system(size: 15, weight: .medium, design: .monospaced))
                                        .foregroundStyle(AD.textPrimary)
                                    if let name = result.name {
                                        Text(name)
                                            .font(.system(size: 12))
                                            .foregroundStyle(AD.textTertiary)
                                            .lineLimit(1)
                                    }
                                }
                                Spacer()
                                Image(systemName: "arrow.up.left")
                                    .font(.system(size: 12))
                                    .foregroundStyle(AD.textTertiary)
                            }
                            .padding(.horizontal, AD.spacingMD)
                            .padding(.vertical, 10)
                        }

                        if result.id != vm.recentSearches.last?.id {
                            Divider()
                                .background(AD.border)
                        }
                    }
                }
                .background(AD.surfaceElevated)
                .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous)
                        .stroke(AD.border, lineWidth: 1)
                )
                .padding(.top, 4)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }

    // MARK: - Quote

    private var quoteSection: some View {
        VStack(spacing: AD.spacingMD) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(vm.symbol)
                        .font(.system(size: 28, weight: .bold, design: .monospaced))
                        .foregroundStyle(AD.textPrimary)
                    Text(vm.companyName)
                        .font(.system(size: 14, weight: .regular))
                        .foregroundStyle(AD.textSecondary)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    Text(vm.price, format: .currency(code: "USD"))
                        .font(.system(size: 28, weight: .bold, design: .monospaced))
                        .foregroundStyle(AD.textPrimary)
                        .contentTransition(.numericText())

                    HStack(spacing: 4) {
                        Image(systemName: vm.change >= 0 ? "arrow.up.right" : "arrow.down.right")
                            .font(.system(size: 11, weight: .semibold))
                        Text("\(AD.pnlSign(vm.change))\(vm.change, specifier: "%.2f") (\(AD.pnlSign(vm.changePercent))\(vm.changePercent, specifier: "%.2f")%)")
                            .font(.system(size: 13, weight: .semibold, design: .monospaced))
                    }
                    .foregroundStyle(AD.pnlColor(vm.change))
                }
            }

            // Stat grid
            LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 4), spacing: AD.spacingSM) {
                quoteStat("Open", value: String(format: "%.2f", vm.quoteOpen))
                quoteStat("High", value: String(format: "%.2f", vm.quoteHigh))
                quoteStat("Low", value: String(format: "%.2f", vm.quoteLow))
                quoteStat("Vol", value: formatVolume(vm.volume))
            }
        }
        .cardStyle()
    }

    private func quoteStat(_ label: String, value: String) -> some View {
        VStack(spacing: 2) {
            Text(label)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(AD.textTertiary)
            Text(value)
                .font(.system(size: 13, weight: .semibold, design: .monospaced))
                .foregroundStyle(AD.textSecondary)
        }
    }

    private func formatVolume(_ vol: Double) -> String {
        if vol >= 1_000_000 { return String(format: "%.1fM", vol / 1_000_000) }
        if vol >= 1_000 { return String(format: "%.1fK", vol / 1_000) }
        return String(format: "%.0f", vol)
    }

    // MARK: - Chart

    private var chartSection: some View {
        VStack(alignment: .leading, spacing: AD.spacingSM) {
            HStack {
                Text("Price")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(AD.textPrimary)
                Spacer()
                Text("30D")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(AD.textTertiary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(AD.surfaceElevated)
                    .clipShape(Capsule())
            }

            Chart(vm.priceHistory) { point in
                AreaMark(
                    x: .value("Date", point.date),
                    yStart: .value("Base", vm.priceHistory.map(\.price).min() ?? 0),
                    yEnd: .value("Price", point.price)
                )
                .foregroundStyle(
                    LinearGradient(
                        colors: [
                            AD.pnlColor(vm.change).opacity(0.2),
                            AD.pnlColor(vm.change).opacity(0.02)
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .interpolationMethod(.catmullRom)

                LineMark(
                    x: .value("Date", point.date),
                    y: .value("Price", point.price)
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
                            Text(String(format: "%.0f", v))
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundStyle(AD.textTertiary)
                        }
                    }
                    AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5, dash: [3, 3]))
                        .foregroundStyle(AD.border)
                }
            }
            .chartYScale(domain: .automatic(includesZero: false))
            .frame(height: 160)
        }
        .cardStyle()
    }

    // MARK: - Key Levels

    private var keyLevelsSection: some View {
        HStack(spacing: AD.spacingSM) {
            levelCard("Support", price: vm.support, icon: "arrow.down.to.line", color: AD.profit)
            levelCard("Resistance", price: vm.resistance, icon: "arrow.up.to.line", color: AD.loss)
        }
    }

    private func levelCard(_ label: String, price: Double, icon: String, color: Color) -> some View {
        HStack(spacing: AD.spacingSM) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(color)
                .frame(width: 32, height: 32)
                .background(color.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(AD.textTertiary)
                Text(price, format: .currency(code: "USD"))
                    .font(.system(size: 15, weight: .semibold, design: .monospaced))
                    .foregroundStyle(AD.textPrimary)
            }
            Spacer()
        }
        .cardStyle()
    }

    // MARK: - Order Entry

    private var orderEntrySection: some View {
        VStack(spacing: AD.spacingMD) {
            HStack {
                Text("Order Entry")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(AD.textPrimary)
                Spacer()
                Text("Mkt Cap: \(vm.marketCap)")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(AD.textTertiary)
            }

            // Side Toggle
            HStack(spacing: 0) {
                ForEach(TradeViewModel.OrderSide.allCases, id: \.self) { side in
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) { vm.orderSide = side }
                    } label: {
                        Text(side.label)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(vm.orderSide == side ? .white : AD.textTertiary)
                            .frame(maxWidth: .infinity)
                            .frame(height: 40)
                            .background(vm.orderSide == side ? side.color.opacity(0.85) : .clear)
                            .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous))
                    }
                    .sensoryFeedback(.selection, trigger: vm.orderSide)
                }
            }
            .padding(3)
            .background(AD.surfaceElevated)
            .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM + 3, style: .continuous))

            // Quantity
            VStack(alignment: .leading, spacing: 6) {
                Text("Quantity")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(AD.textSecondary)

                TextField("", text: $vm.quantity, prompt: Text("0").foregroundStyle(AD.textTertiary))
                    .font(.system(size: 18, weight: .semibold, design: .monospaced))
                    .foregroundStyle(AD.textPrimary)
                    .keyboardType(.numberPad)
                    .padding(.horizontal, AD.spacingMD)
                    .padding(.vertical, 12)
                    .background(AD.surfaceElevated)
                    .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous)
                            .stroke(AD.border, lineWidth: 1)
                    )
            }

            // Order Type
            VStack(alignment: .leading, spacing: 6) {
                Text("Order Type")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(AD.textSecondary)

                HStack(spacing: AD.spacingSM) {
                    ForEach(TradeViewModel.OrderType.allCases, id: \.self) { type in
                        Button {
                            withAnimation(.easeInOut(duration: 0.2)) { vm.orderType = type }
                        } label: {
                            Text(type.label)
                                .font(.system(size: 13, weight: vm.orderType == type ? .semibold : .regular))
                                .foregroundStyle(vm.orderType == type ? AD.accent : AD.textTertiary)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 8)
                                .background(vm.orderType == type ? AD.accentDim : AD.surfaceElevated)
                                .clipShape(Capsule())
                                .overlay(
                                    Capsule()
                                        .stroke(vm.orderType == type ? AD.accent.opacity(0.3) : AD.border, lineWidth: 1)
                                )
                        }
                    }
                    Spacer()
                }
            }

            // Limit Price (shown for limit and stop orders)
            if vm.orderType != .market {
                VStack(alignment: .leading, spacing: 6) {
                    Text(vm.orderType == .limit ? "Limit Price" : "Stop Price")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(AD.textSecondary)

                    HStack {
                        Text("$")
                            .font(.system(size: 16, weight: .semibold, design: .monospaced))
                            .foregroundStyle(AD.textTertiary)

                        TextField("", text: $vm.limitPrice, prompt: Text(String(format: "%.2f", vm.price)).foregroundStyle(AD.textTertiary))
                            .font(.system(size: 18, weight: .semibold, design: .monospaced))
                            .foregroundStyle(AD.textPrimary)
                            .keyboardType(.decimalPad)
                    }
                    .padding(.horizontal, AD.spacingMD)
                    .padding(.vertical, 12)
                    .background(AD.surfaceElevated)
                    .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous)
                            .stroke(AD.border, lineWidth: 1)
                    )
                }
                .transition(.opacity.combined(with: .move(edge: .top)))
            }

            // Estimated Cost
            if let qty = Int(vm.quantity), qty > 0 {
                HStack {
                    Text("Est. \(vm.orderSide == .buy ? "Cost" : "Proceeds")")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(AD.textSecondary)
                    Spacer()
                    Text(vm.estimatedCost, format: .currency(code: "USD"))
                        .font(.system(size: 15, weight: .semibold, design: .monospaced))
                        .foregroundStyle(AD.textPrimary)
                        .contentTransition(.numericText())
                }
                .transition(.opacity)
            }

            // Submit Button
            Button {
                Task { await vm.submitOrder() }
            } label: {
                HStack(spacing: AD.spacingSM) {
                    if vm.isSubmitting {
                        ProgressView()
                            .tint(.white)
                            .scaleEffect(0.85)
                    } else {
                        Image(systemName: vm.orderSide == .buy ? "arrow.up.circle.fill" : "arrow.down.circle.fill")
                            .font(.system(size: 18))
                        Text("\(vm.orderSide.label) \(vm.symbol)")
                            .font(.system(size: 17, weight: .semibold))
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: 52)
                .background(
                    vm.canSubmit
                        ? vm.orderSide.color
                        : AD.textTertiary.opacity(0.2)
                )
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: AD.radiusMD, style: .continuous))
                .shadow(color: vm.canSubmit ? vm.orderSide.color.opacity(0.25) : .clear, radius: 12, y: 6)
            }
            .disabled(!vm.canSubmit || vm.isSubmitting)
            .sensoryFeedback(.impact(weight: .heavy, intensity: 0.9), trigger: vm.isSubmitting)
        }
        .cardStyle()
    }

    // MARK: - Confirmation Overlay

    private var confirmationOverlay: some View {
        ZStack {
            Color.black.opacity(0.6)
                .ignoresSafeArea()
                .onTapGesture { vm.showConfirmation = false }

            VStack(spacing: AD.spacingLG) {
                ZStack {
                    Circle()
                        .fill(AD.profit.opacity(0.15))
                        .frame(width: 72, height: 72)
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 40))
                        .foregroundStyle(AD.profit)
                }

                Text("Order Submitted")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(AD.textPrimary)

                Text("\(vm.orderSide.label) order for \(vm.symbol) has been placed successfully.")
                    .font(.system(size: 15))
                    .foregroundStyle(AD.textSecondary)
                    .multilineTextAlignment(.center)

                Button {
                    vm.showConfirmation = false
                } label: {
                    Text("Done")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 48)
                        .background(AD.accent)
                        .clipShape(RoundedRectangle(cornerRadius: AD.radiusMD, style: .continuous))
                }
            }
            .padding(AD.spacingLG)
            .background(AD.surface)
            .clipShape(RoundedRectangle(cornerRadius: AD.radiusXL, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: AD.radiusXL, style: .continuous)
                    .stroke(AD.border, lineWidth: 1)
            )
            .padding(.horizontal, AD.spacingXL)
            .transition(.scale(scale: 0.9).combined(with: .opacity))
        }
        .animation(.spring(response: 0.3), value: vm.showConfirmation)
    }
}

#Preview {
    TradeView()
        .environment(AuthManager.shared)
}
