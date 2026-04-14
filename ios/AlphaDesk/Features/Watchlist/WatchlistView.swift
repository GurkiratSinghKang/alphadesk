import SwiftUI

// MARK: - Sector Data

private let sectorMap: [String: String] = [
    "AAPL": "Technology", "NVDA": "Technology", "MSFT": "Technology",
    "AMZN": "Consumer", "TSLA": "Consumer", "META": "Technology",
    "GOOGL": "Technology", "AMD": "Technology", "NFLX": "Consumer",
    "CRM": "Technology", "ADBE": "Technology", "INTC": "Technology",
    "PYPL": "Financials", "SQ": "Financials", "SHOP": "Technology",
    "MRK": "Healthcare", "JNJ": "Healthcare", "PFE": "Healthcare",
    "UNH": "Healthcare", "V": "Financials", "MA": "Financials",
    "JPM": "Financials", "BAC": "Financials", "GS": "Financials",
    "XOM": "Energy", "CVX": "Energy", "DIS": "Consumer",
    "KO": "Consumer Staples", "PEP": "Consumer Staples",
    "WMT": "Consumer Staples", "HD": "Consumer",
]

// MARK: - View Model

@Observable
final class WatchlistViewModel {
    var symbols: [String] = []
    var quotes: [String: Quote] = [:]
    var sparklines: [String: [Double]] = [:]
    var isLoading = false
    var searchText = ""
    var searchResults: [SymbolSearchResult] = []
    var isSearching = false
    var showAddSheet = false
    var groupBySector = false

    private let storageKey = "watchlist_symbols"
    private let groupByKey = "watchlist_group_by_sector"

    init() {
        loadWatchlist()
        groupBySector = UserDefaults.standard.bool(forKey: groupByKey)
    }

    // MARK: - Sector Grouping

    struct SectorGroup: Identifiable {
        let id: String
        let sector: String
        let symbols: [String]
    }

    var sectorGroups: [SectorGroup] {
        var grouped: [String: [String]] = [:]
        for symbol in symbols {
            let sector = sectorMap[symbol] ?? "Other"
            grouped[sector, default: []].append(symbol)
        }
        return grouped.map { SectorGroup(id: $0.key, sector: $0.key, symbols: $0.value) }
            .sorted { $0.sector < $1.sector }
    }

    // MARK: - Persistence

    func loadWatchlist() {
        if let saved = UserDefaults.standard.stringArray(forKey: storageKey) {
            symbols = saved
        } else {
            symbols = ["AAPL", "NVDA", "MSFT", "AMZN", "TSLA"]
            saveWatchlist()
        }
    }

    func saveWatchlist() {
        UserDefaults.standard.set(symbols, forKey: storageKey)
    }

    func toggleGroupBySector() {
        groupBySector.toggle()
        UserDefaults.standard.set(groupBySector, forKey: groupByKey)
    }

    func addSymbol(_ symbol: String) {
        let upper = symbol.uppercased()
        guard !symbols.contains(upper) else { return }
        symbols.append(upper)
        saveWatchlist()
        Task { await fetchQuote(for: upper) }
    }

    func removeSymbol(_ symbol: String) {
        symbols.removeAll { $0 == symbol }
        quotes.removeValue(forKey: symbol)
        sparklines.removeValue(forKey: symbol)
        saveWatchlist()
    }

    func removeSymbols(at offsets: IndexSet) {
        let toRemove = offsets.map { symbols[$0] }
        symbols.remove(atOffsets: offsets)
        for sym in toRemove {
            quotes.removeValue(forKey: sym)
            sparklines.removeValue(forKey: sym)
        }
        saveWatchlist()
    }

    func moveSymbols(from source: IndexSet, to destination: Int) {
        symbols.move(fromOffsets: source, toOffset: destination)
        saveWatchlist()
    }

    // MARK: - Fetch Quotes

    @MainActor
    func fetchAllQuotes() async {
        isLoading = quotes.isEmpty
        for symbol in symbols {
            await fetchQuote(for: symbol)
        }
        isLoading = false
    }

    @MainActor
    func fetchQuote(for symbol: String) async {
        do {
            let quote: Quote = try await APIClient.shared.request(.quote(symbol: symbol))
            quotes[symbol] = quote
            generateSparkline(for: symbol, quote: quote)
        } catch {
            // Silently fail for individual quotes
        }
    }

    /// Generate a sparkline from available quote data for display.
    private func generateSparkline(for symbol: String, quote: Quote) {
        // Build a synthetic mini sparkline from the day's OHLC
        var points: [Double] = []
        let open = quote.open ?? quote.last
        let high = quote.high ?? quote.last
        let low = quote.low ?? quote.last
        let current = quote.last

        // Create a plausible intraday path
        var rng = WatchlistSparkRNG(seed: UInt64(abs(symbol.hashValue) &* 12345))
        let steps = 12
        points.append(open)
        for i in 1..<steps {
            let progress = Double(i) / Double(steps)
            let target = open + (current - open) * progress
            let noise = (rng.nextDouble() - 0.5) * (high - low) * 0.3
            let value = max(low, min(high, target + noise))
            points.append(value)
        }
        points.append(current)
        sparklines[symbol] = points
    }

    // MARK: - Search

    @MainActor
    func search() async {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else {
            searchResults = []
            return
        }

        isSearching = true
        do {
            let results: [SymbolSearchResult] = try await APIClient.shared.request(
                .searchSymbols(query: query)
            )
            searchResults = results
        } catch {
            // Fallback: local filter
            let upper = query.uppercased()
            let common = ["AAPL", "AMZN", "GOOGL", "GOOG", "META", "MSFT", "NVDA", "TSLA",
                          "AMD", "NFLX", "CRM", "ADBE", "INTC", "PYPL", "SQ", "SHOP",
                          "MRK", "JNJ", "PFE", "UNH", "V", "MA", "JPM", "BAC"]
            searchResults = common.filter { $0.contains(upper) }
                .map { SymbolSearchResult(symbol: $0, name: nil, type: nil) }
        }
        isSearching = false
    }
}

/// Deterministic RNG for consistent sparkline shapes per symbol.
private struct WatchlistSparkRNG: RandomNumberGenerator {
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

struct WatchlistView: View {

    @State private var vm = WatchlistViewModel()
    @State private var editMode: EditMode = .inactive
    @State private var alertSymbol: String?
    @State private var showAlertSheet = false
    @State private var tradeSymbol: String?
    @State private var tradeSide: String?
    @State private var showTradeSheet = false

    var body: some View {
        NavigationStack {
            ZStack {
                AD.background.ignoresSafeArea()

                if vm.isLoading && vm.quotes.isEmpty {
                    LoadingView()
                        .transition(.opacity)
                } else if vm.symbols.isEmpty {
                    ContentUnavailableView(
                        "No Watchlist",
                        systemImage: "star",
                        description: Text("Add symbols to track their prices")
                    )
                    .transition(.opacity)
                } else {
                    watchlistContent
                        .transition(.opacity)
                }
            }
            .navigationTitle("Watchlist")
            .navigationBarTitleDisplayMode(.large)
            .toolbarBackground(AD.background, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        vm.toggleGroupBySector()
                    } label: {
                        Image(systemName: vm.groupBySector ? "rectangle.3.group.fill" : "rectangle.3.group")
                            .font(.system(size: 16))
                            .foregroundStyle(vm.groupBySector ? AD.accent : AD.textSecondary)
                    }
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    EditButton()
                        .foregroundStyle(AD.accent)

                    Button {
                        vm.showAddSheet = true
                    } label: {
                        Image(systemName: "plus.circle.fill")
                            .font(.system(size: 22))
                            .foregroundStyle(AD.accent)
                    }
                }
            }
            .environment(\.editMode, $editMode)
            .animation(.easeInOut, value: vm.isLoading)
            .animation(.easeInOut, value: vm.groupBySector)
            .task { await vm.fetchAllQuotes() }
            .sheet(isPresented: $vm.showAddSheet) {
                addSymbolSheet
            }
            .sheet(isPresented: $showTradeSheet) {
                if let symbol = tradeSymbol {
                    NavigationStack {
                        TradeView(
                            initialSymbol: symbol,
                            initialSide: tradeSide == "sell" ? .sell : .buy
                        )
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
        }
    }

    // MARK: - Watchlist Content

    private var watchlistContent: some View {
        Group {
            if vm.groupBySector {
                sectorGroupedList
            } else {
                flatList
            }
        }
    }

    // MARK: - Flat List (with drag to reorder)

    private var flatList: some View {
        List {
            ForEach(vm.symbols, id: \.self) { symbol in
                NavigationLink(value: symbol) {
                    watchlistRow(symbol)
                }
                .listRowBackground(AD.background)
                .listRowSeparatorTint(AD.border)
                .listRowInsets(EdgeInsets())
                .contextMenu {
                    symbolContextMenu(symbol)
                }
            }
            .onDelete { offsets in
                withAnimation { vm.removeSymbols(at: offsets) }
            }
            .onMove { source, destination in
                withAnimation { vm.moveSymbols(from: source, to: destination) }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(AD.background)
        .refreshable { await vm.fetchAllQuotes() }
        .navigationDestination(for: String.self) { symbol in
            SymbolDetailView(symbol: symbol)
        }
    }

    // MARK: - Sector Grouped List

    private var sectorGroupedList: some View {
        List {
            ForEach(vm.sectorGroups) { group in
                Section {
                    ForEach(group.symbols, id: \.self) { symbol in
                        NavigationLink(value: symbol) {
                            watchlistRow(symbol)
                        }
                        .listRowBackground(AD.background)
                        .listRowSeparatorTint(AD.border)
                        .listRowInsets(EdgeInsets())
                        .contextMenu {
                            symbolContextMenu(symbol)
                        }
                    }
                } header: {
                    HStack(spacing: 6) {
                        Image(systemName: sectorIcon(group.sector))
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(AD.accent)
                        Text(group.sector)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(AD.textTertiary)
                            .textCase(.uppercase)
                            .tracking(0.6)
                        Spacer()
                        Text("\(group.symbols.count)")
                            .font(.system(size: 11, weight: .medium, design: .monospaced))
                            .foregroundStyle(AD.textTertiary)
                    }
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 4, trailing: 16))
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(AD.background)
        .refreshable { await vm.fetchAllQuotes() }
        .navigationDestination(for: String.self) { symbol in
            SymbolDetailView(symbol: symbol)
        }
    }

    // MARK: - Context Menu

    @ViewBuilder
    private func symbolContextMenu(_ symbol: String) -> some View {
        Button {
            tradeSymbol = symbol
            tradeSide = "buy"
            showTradeSheet = true
        } label: {
            Label("Buy \(symbol)", systemImage: "arrow.up.circle.fill")
        }

        Button {
            tradeSymbol = symbol
            tradeSide = "sell"
            showTradeSheet = true
        } label: {
            Label("Sell \(symbol)", systemImage: "arrow.down.circle.fill")
        }

        Divider()

        Button {
            alertSymbol = symbol
            showAlertSheet = true
        } label: {
            Label("Set Alert", systemImage: "bell.badge")
        }

        Divider()

        Button(role: .destructive) {
            withAnimation {
                vm.removeSymbol(symbol)
            }
        } label: {
            Label("Remove from Watchlist", systemImage: "trash")
        }
    }

    // MARK: - Watchlist Row

    private func watchlistRow(_ symbol: String) -> some View {
        HStack(spacing: 12) {
            // Symbol badge
            ZStack {
                RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous)
                    .fill(AD.surfaceElevated)
                    .frame(width: 40, height: 40)

                Text(String(symbol.prefix(2)))
                    .font(.system(size: 13, weight: .bold, design: .monospaced))
                    .foregroundStyle(AD.accent)
            }

            // Left: symbol + name
            VStack(alignment: .leading, spacing: 3) {
                Text(symbol)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(AD.textPrimary)

                if let name = symbolName(symbol) {
                    Text(name)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(AD.textTertiary)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 4)

            // Mini sparkline chart
            if let sparkData = vm.sparklines[symbol], sparkData.count >= 2 {
                SparklineView(data: sparkData, height: 24, lineWidth: 1.2)
                    .frame(width: 48, height: 24)
            }

            // Right: price + change
            if let quote = vm.quotes[symbol] {
                VStack(alignment: .trailing, spacing: 3) {
                    Text(quote.last, format: .currency(code: "USD"))
                        .font(.system(size: 14, weight: .medium, design: .monospaced))
                        .foregroundStyle(AD.textPrimary)
                        .monospacedDigit()

                    if let pct = quote.changePct {
                        Text("\(AD.pnlSign(pct))\(pct, specifier: "%.2f")%")
                            .font(.system(size: 12, weight: .medium, design: .monospaced))
                            .foregroundStyle(AD.pnlColor(pct))
                            .monospacedDigit()
                    }
                }
            } else {
                ProgressView()
                    .tint(AD.textTertiary)
                    .scaleEffect(0.7)
            }
        }
        .padding(.vertical, 10)
        .padding(.horizontal, AD.spacingMD)
        .contentShape(Rectangle())
    }

    // MARK: - Add Symbol Sheet

    private var addSymbolSheet: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Search bar
                HStack(spacing: AD.spacingSM) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 15))
                        .foregroundStyle(AD.textTertiary)

                    TextField(
                        "",
                        text: $vm.searchText,
                        prompt: Text("Search symbols...").foregroundStyle(AD.textTertiary)
                    )
                    .font(.system(size: 16))
                    .foregroundStyle(AD.textPrimary)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.characters)
                    .onChange(of: vm.searchText) { _, _ in
                        Task { await vm.search() }
                    }
                }
                .padding(.horizontal, AD.spacingMD)
                .padding(.vertical, 12)
                .background(AD.surfaceElevated)
                .clipShape(RoundedRectangle(cornerRadius: AD.radiusMD, style: .continuous))
                .padding(.horizontal, AD.spacingMD)
                .padding(.top, AD.spacingSM)

                // Results
                ScrollView(.vertical, showsIndicators: false) {
                    LazyVStack(spacing: 0) {
                        ForEach(vm.searchResults) { result in
                            Button {
                                vm.addSymbol(result.symbol)
                                vm.searchText = ""
                                vm.searchResults = []
                                vm.showAddSheet = false
                            } label: {
                                HStack(spacing: AD.spacingMD) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(result.symbol)
                                            .font(.system(size: 15, weight: .bold, design: .monospaced))
                                            .foregroundStyle(AD.textPrimary)
                                        if let name = result.name {
                                            Text(name)
                                                .font(.system(size: 12))
                                                .foregroundStyle(AD.textTertiary)
                                                .lineLimit(1)
                                        }
                                    }

                                    Spacer()

                                    if vm.symbols.contains(result.symbol) {
                                        Image(systemName: "checkmark.circle.fill")
                                            .font(.system(size: 18))
                                            .foregroundStyle(AD.profit)
                                    } else {
                                        Image(systemName: "plus.circle")
                                            .font(.system(size: 18))
                                            .foregroundStyle(AD.accent)
                                    }
                                }
                                .padding(.horizontal, AD.spacingMD)
                                .padding(.vertical, 12)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .disabled(vm.symbols.contains(result.symbol))

                            Divider().background(AD.border).padding(.leading, AD.spacingMD)
                        }
                    }
                    .padding(.top, AD.spacingSM)
                }
            }
            .background(AD.background)
            .navigationTitle("Add Symbol")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(AD.background, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        vm.showAddSheet = false
                    }
                    .foregroundStyle(AD.accent)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationBackground(AD.background)
    }

    // MARK: - Helpers

    private func symbolName(_ symbol: String) -> String? {
        let names: [String: String] = [
            "AAPL": "Apple Inc.",
            "NVDA": "NVIDIA Corp.",
            "MSFT": "Microsoft Corp.",
            "AMZN": "Amazon.com",
            "TSLA": "Tesla Inc.",
            "META": "Meta Platforms",
            "GOOGL": "Alphabet Inc.",
            "AMD": "AMD Inc.",
            "NFLX": "Netflix Inc.",
            "CRM": "Salesforce Inc.",
        ]
        return names[symbol]
    }

    private func sectorIcon(_ sector: String) -> String {
        switch sector {
        case "Technology": return "cpu"
        case "Consumer": return "cart"
        case "Financials": return "building.columns"
        case "Healthcare": return "heart.text.square"
        case "Energy": return "bolt.fill"
        case "Consumer Staples": return "basket"
        default: return "square.grid.2x2"
        }
    }
}

#Preview {
    WatchlistView()
        .environment(AuthManager.shared)
}
