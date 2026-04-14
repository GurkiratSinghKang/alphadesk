import SwiftUI

// MARK: - View Model

@Observable
final class WatchlistViewModel {
    var symbols: [String] = []
    var quotes: [String: Quote] = [:]
    var isLoading = false
    var searchText = ""
    var searchResults: [SymbolSearchResult] = []
    var isSearching = false
    var showAddSheet = false

    private let storageKey = "watchlist_symbols"

    init() {
        loadWatchlist()
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
        saveWatchlist()
    }

    func removeSymbols(at offsets: IndexSet) {
        let toRemove = offsets.map { symbols[$0] }
        symbols.remove(atOffsets: offsets)
        for sym in toRemove {
            quotes.removeValue(forKey: sym)
        }
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
        } catch {
            // Silently fail for individual quotes
        }
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

// MARK: - View

struct WatchlistView: View {

    @State private var vm = WatchlistViewModel()

    var body: some View {
        NavigationStack {
            ZStack {
                AD.background.ignoresSafeArea()

                if vm.isLoading && vm.quotes.isEmpty {
                    LoadingView()
                } else {
                    watchlistContent
                }
            }
            .navigationTitle("Watchlist")
            .navigationBarTitleDisplayMode(.large)
            .toolbarBackground(AD.background, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        vm.showAddSheet = true
                    } label: {
                        Image(systemName: "plus.circle.fill")
                            .font(.system(size: 22))
                            .foregroundStyle(AD.accent)
                    }
                }
            }
            .task { await vm.fetchAllQuotes() }
            .sheet(isPresented: $vm.showAddSheet) {
                addSymbolSheet
            }
        }
    }

    // MARK: - Watchlist Content

    private var watchlistContent: some View {
        List {
            ForEach(vm.symbols, id: \.self) { symbol in
                NavigationLink(value: symbol) {
                    watchlistRow(symbol)
                }
                .listRowBackground(AD.background)
                .listRowSeparatorTint(AD.border)
                .listRowInsets(EdgeInsets())
            }
            .onDelete { offsets in
                withAnimation { vm.removeSymbols(at: offsets) }
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
}

#Preview {
    WatchlistView()
        .environment(AuthManager.shared)
}
