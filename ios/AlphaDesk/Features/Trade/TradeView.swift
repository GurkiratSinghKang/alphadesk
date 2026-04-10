import SwiftUI
import Charts

// MARK: - View Model

@Observable
final class TradeViewModel {
    var searchText = ""
    var isSearching = false
    var searchResults: [String] = []

    // Current quote
    var symbol = "AAPL"
    var companyName = "Apple Inc."
    var price: Double = 182.40
    var change: Double = 3.15
    var changePercent: Double = 1.76
    var volume: Double = 54_230_000
    var quoteOpen: Double = 179.80
    var quoteHigh: Double = 183.10
    var quoteLow: Double = 179.25
    var prevClose: Double = 179.25
    var marketCap: String = "2.84T"
    var support: Double = 176.50
    var resistance: Double = 185.00

    // Price history (30 days)
    var priceHistory: [TradePricePoint] = {
        var pts: [TradePricePoint] = []
        var px: Double = 172.00
        let cal = Calendar.current
        let now = Date()
        for i in 0..<30 {
            guard let date = cal.date(byAdding: .day, value: -29 + i, to: now) else { continue }
            let wd = cal.component(.weekday, from: date)
            if wd == 1 || wd == 7 { continue }
            let drift = 0.35
            let noise = Double.random(in: -2.5...3.0)
            px += drift + noise
            px = max(px, 165)
            pts.append(TradePricePoint(date: date, price: px))
        }
        if let last = pts.indices.last { pts[last].price = 182.40 }
        return pts
    }()

    // Order entry
    var orderSide: OrderSide = .buy
    var quantity: String = ""
    var orderType: OrderType = .market
    var limitPrice: String = ""
    var isSubmitting = false
    var showConfirmation = false

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
        return true
    }

    func search() {
        guard !searchText.isEmpty else { searchResults = []; return }
        isSearching = true
        let allSymbols = ["AAPL", "AMZN", "GOOGL", "GOOG", "META", "MSFT", "NVDA", "TSLA",
                          "AMD", "NFLX", "CRM", "ADBE", "INTC", "PYPL", "SQ", "SHOP"]
        let query = searchText.uppercased()
        searchResults = allSymbols.filter { $0.contains(query) }
        isSearching = false
    }

    func selectSymbol(_ sym: String) {
        symbol = sym
        searchText = ""
        searchResults = []
    }

    @MainActor
    func submitOrder() async {
        guard canSubmit else { return }
        isSubmitting = true
        try? await Task.sleep(for: .seconds(1.5))
        isSubmitting = false
        showConfirmation = true
        quantity = ""
        limitPrice = ""
    }
}

struct TradePricePoint: Identifiable {
    let id = UUID()
    let date: Date
    var price: Double
}

// MARK: - Trade View

struct TradeView: View {

    @State private var vm = TradeViewModel()
    @FocusState private var isSearchFocused: Bool

    var body: some View {
        NavigationStack {
            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: AD.spacingLG) {
                    searchSection
                    quoteSection
                    chartSection
                    keyLevelsSection
                    orderEntrySection
                }
                .padding(.horizontal, AD.spacingMD)
                .padding(.top, AD.spacingSM)
                .padding(.bottom, 100)
            }
            .background(AD.background)
            .navigationTitle("Trade")
            .navigationBarTitleDisplayMode(.large)
            .toolbarBackground(AD.background, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .overlay {
                if vm.showConfirmation {
                    confirmationOverlay
                }
            }
        }
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
                    ForEach(vm.searchResults, id: \.self) { result in
                        Button {
                            vm.selectSymbol(result)
                            isSearchFocused = false
                        } label: {
                            HStack {
                                Image(systemName: "magnifyingglass")
                                    .font(.system(size: 12))
                                    .foregroundStyle(AD.textTertiary)
                                Text(result)
                                    .font(.system(size: 15, weight: .medium, design: .monospaced))
                                    .foregroundStyle(AD.textPrimary)
                                Spacer()
                                Image(systemName: "arrow.up.left")
                                    .font(.system(size: 12))
                                    .foregroundStyle(AD.textTertiary)
                            }
                            .padding(.horizontal, AD.spacingMD)
                            .padding(.vertical, 10)
                        }

                        if result != vm.searchResults.last {
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
                    yStart: .value("Base", vm.priceHistory.map(\.price).min() ?? 165),
                    y: .value("Price", point.price)
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
