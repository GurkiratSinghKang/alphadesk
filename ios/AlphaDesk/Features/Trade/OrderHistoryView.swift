import SwiftUI

// MARK: - View Model

@Observable
final class OrderHistoryViewModel {
    var orders: [Order] = []
    var isLoading = true
    var isRefreshing = false
    var errorMessage: String?

    /// Orders grouped by date string.
    var groupedOrders: [(key: String, orders: [Order])] {
        let grouped = Dictionary(grouping: orders) { order -> String in
            guard let dateStr = order.submittedAt ?? order.createdAt else { return "Unknown" }
            return parseDateLabel(dateStr)
        }
        return grouped.map { (key: $0.key, orders: $0.value) }
            .sorted { $0.key > $1.key }
    }

    @MainActor
    func loadOrders() async {
        isLoading = orders.isEmpty
        errorMessage = nil

        do {
            let fetched: [Order] = try await APIClient.shared.request(.orders)
            orders = fetched
        } catch {
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }

    @MainActor
    func refresh() async {
        isRefreshing = true
        await loadOrders()
        isRefreshing = false
    }

    private func parseDateLabel(_ dateString: String) -> String {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var date = iso.date(from: dateString)

        if date == nil {
            iso.formatOptions = [.withInternetDateTime]
            date = iso.date(from: dateString)
        }

        if date == nil {
            let simple = DateFormatter()
            simple.locale = Locale(identifier: "en_US_POSIX")
            simple.dateFormat = "yyyy-MM-dd HH:mm:ss"
            simple.timeZone = TimeZone(abbreviation: "UTC")
            date = simple.date(from: dateString)
        }

        guard let parsed = date else { return dateString.prefix(10).description }

        let cal = Calendar.current
        if cal.isDateInToday(parsed) { return "Today" }
        if cal.isDateInYesterday(parsed) { return "Yesterday" }

        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d, yyyy"
        return formatter.string(from: parsed)
    }
}

// MARK: - View

struct OrderHistoryView: View {

    @State private var vm = OrderHistoryViewModel()

    var body: some View {
        NavigationStack {
            ZStack {
                AD.background.ignoresSafeArea()

                if vm.isLoading && vm.orders.isEmpty {
                    LoadingView()
                        .transition(.opacity)
                } else if let error = vm.errorMessage, vm.orders.isEmpty {
                    errorView(error)
                        .transition(.opacity)
                } else if vm.orders.isEmpty {
                    ContentUnavailableView(
                        "No Orders",
                        systemImage: "doc.text.magnifyingglass",
                        description: Text("Your order history will appear here")
                    )
                    .transition(.opacity)
                } else {
                    orderList
                        .transition(.opacity)
                }
            }
            .navigationTitle("Order History")
            .navigationBarTitleDisplayMode(.large)
            .toolbarBackground(AD.background, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .animation(.easeInOut, value: vm.isLoading)
            .task { await vm.loadOrders() }
        }
    }

    // MARK: - Order List

    private var orderList: some View {
        ScrollView(.vertical, showsIndicators: false) {
            LazyVStack(spacing: AD.spacingLG) {
                ForEach(vm.groupedOrders, id: \.key) { group in
                    VStack(alignment: .leading, spacing: AD.spacingSM) {
                        // Date header
                        Text(group.key)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(AD.textTertiary)
                            .textCase(.uppercase)
                            .tracking(0.6)

                        ForEach(group.orders) { order in
                            orderRow(order)
                        }
                    }
                }
            }
            .padding(.horizontal, AD.spacingMD)
            .padding(.top, AD.spacingSM)
            .padding(.bottom, 100)
        }
        .refreshable { await vm.refresh() }
    }

    // MARK: - Order Row

    private func orderRow(_ order: Order) -> some View {
        VStack(spacing: AD.spacingSM) {
            // Top row: Symbol + Side + Status
            HStack {
                HStack(spacing: AD.spacingSM) {
                    // Symbol badge
                    ZStack {
                        RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous)
                            .fill(AD.surfaceElevated)
                            .frame(width: 40, height: 40)

                        Text(String(order.symbol.prefix(2)))
                            .font(.system(size: 13, weight: .bold, design: .monospaced))
                            .foregroundStyle(AD.accent)
                    }

                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(order.symbol)
                                .font(.system(size: 15, weight: .bold, design: .monospaced))
                                .foregroundStyle(AD.textPrimary)

                            sideBadge(order.side)
                        }

                        HStack(spacing: 4) {
                            if let qty = order.qty {
                                Text("\(qty) shares")
                                    .font(.system(size: 12, weight: .regular))
                                    .foregroundStyle(AD.textTertiary)
                            }
                            Text("•")
                                .font(.system(size: 12))
                                .foregroundStyle(AD.textTertiary)
                            Text(orderTypeLabel(order.type))
                                .font(.system(size: 12, weight: .regular))
                                .foregroundStyle(AD.textTertiary)
                        }
                    }
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 4) {
                    orderStatusBadge(order.status)

                    if let fillPrice = order.filledAvgPrice, !fillPrice.isEmpty {
                        Text("$\(fillPrice)")
                            .font(.system(size: 13, weight: .semibold, design: .monospaced))
                            .foregroundStyle(AD.textSecondary)
                    }
                }
            }

            // Timestamp
            if let ts = order.submittedAt ?? order.createdAt {
                HStack {
                    Spacer()
                    Text(formatTimestamp(ts))
                        .font(.system(size: 11, weight: .regular))
                        .foregroundStyle(AD.textTertiary)
                }
            }
        }
        .cardStyle()
    }

    // MARK: - Side Badge

    private func sideBadge(_ side: String) -> some View {
        let isBuy = side.lowercased() == "buy"
        let color = isBuy ? AD.profit : AD.loss
        let label = side.uppercased()

        return Text(label)
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.12))
            .clipShape(Capsule())
    }

    // MARK: - Order Status Badge

    private func orderStatusBadge(_ status: String?) -> some View {
        let lower = (status ?? "").lowercased()
        let color: Color = {
            if lower.contains("fill") { return AD.profit }
            if lower.contains("pend") || lower.contains("new") || lower.contains("accept") { return AD.accent }
            if lower.contains("cancel") { return AD.textTertiary }
            if lower.contains("reject") || lower.contains("fail") { return AD.loss }
            return AD.textTertiary
        }()
        let label: String = {
            if lower.contains("fill") { return "Filled" }
            if lower.contains("partial") { return "Partial" }
            if lower.contains("pend") || lower.contains("new") || lower.contains("accept") { return "Pending" }
            if lower.contains("cancel") { return "Cancelled" }
            if lower.contains("reject") { return "Rejected" }
            return status?.capitalized ?? "Unknown"
        }()

        return Text(label.uppercased())
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.12))
            .clipShape(Capsule())
    }

    // MARK: - Helpers

    private func orderTypeLabel(_ type: String?) -> String {
        guard let type else { return "Market" }
        let lower = type.lowercased()
        if lower.contains("limit") { return "Limit" }
        if lower.contains("stop") { return "Stop" }
        return "Market"
    }

    private func formatTimestamp(_ dateString: String) -> String {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var date = iso.date(from: dateString)

        if date == nil {
            iso.formatOptions = [.withInternetDateTime]
            date = iso.date(from: dateString)
        }

        if date == nil {
            let simple = DateFormatter()
            simple.locale = Locale(identifier: "en_US_POSIX")
            simple.dateFormat = "yyyy-MM-dd HH:mm:ss"
            simple.timeZone = TimeZone(abbreviation: "UTC")
            date = simple.date(from: dateString)
        }

        guard let parsed = date else { return dateString }

        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm a"
        return formatter.string(from: parsed)
    }

    // MARK: - Error

    private func errorView(_ message: String) -> some View {
        VStack(spacing: AD.spacingMD) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 40))
                .foregroundStyle(AD.textTertiary)
            Text("Unable to load orders")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(AD.textPrimary)
            Text(message)
                .font(.system(size: 13))
                .foregroundStyle(AD.textTertiary)
                .multilineTextAlignment(.center)
            Button {
                Task { await vm.loadOrders() }
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
    }
}

#Preview {
    OrderHistoryView()
        .environment(AuthManager.shared)
}
