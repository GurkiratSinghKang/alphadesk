import SwiftUI

// MARK: - View Model

@Observable
final class AlertsViewModel {
    var isLoading = true
    var error: String?
    var alerts: [PriceAlert] = []
    var showAddSheet = false

    // Add alert form
    var newSymbol = ""
    var newCondition = "above"
    var newPrice = ""
    var searchResults: [SymbolSearchResult] = []
    var isSearching = false
    var isSubmitting = false

    var activeAlerts: [PriceAlert] {
        alerts.filter { !$0.triggered }
    }

    var triggeredAlerts: [PriceAlert] {
        alerts.filter { $0.triggered }
    }

    /// Symbols that have at least one alert, sorted.
    var groupedSymbols: [String] {
        Array(Set(alerts.map(\.symbol))).sorted()
    }

    func alerts(for symbol: String) -> [PriceAlert] {
        alerts.filter { $0.symbol == symbol }
    }

    var activeCount: Int {
        activeAlerts.count
    }

    @MainActor
    func refresh() async {
        isLoading = alerts.isEmpty
        error = nil

        do {
            alerts = try await APIClient.shared.request(.alerts)
        } catch {
            self.error = error.localizedDescription
        }

        withAnimation(.easeInOut(duration: 0.25)) {
            isLoading = false
        }
    }

    @MainActor
    func deleteAlert(_ alert: PriceAlert) async {
        do {
            try await APIClient.shared.requestVoid(
                .deleteAlert(id: alert.id),
                method: .delete
            )
            withAnimation {
                alerts.removeAll { $0.id == alert.id }
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    @MainActor
    func createAlert() async {
        guard !newSymbol.isEmpty, let price = Double(newPrice), price > 0 else { return }
        isSubmitting = true

        do {
            let request = CreateAlertRequest(
                symbol: newSymbol.uppercased(),
                condition: newCondition,
                price: price
            )
            let created: PriceAlert = try await APIClient.shared.request(
                .alerts,
                method: .post,
                body: request
            )
            withAnimation {
                alerts.append(created)
            }
            resetForm()
            showAddSheet = false
        } catch {
            self.error = error.localizedDescription
        }

        isSubmitting = false
    }

    @MainActor
    func searchSymbols(_ query: String) async {
        guard query.count >= 1 else {
            searchResults = []
            return
        }
        isSearching = true
        do {
            searchResults = try await APIClient.shared.request(.searchSymbols(query: query))
        } catch {
            searchResults = []
        }
        isSearching = false
    }

    func resetForm() {
        newSymbol = ""
        newCondition = "above"
        newPrice = ""
        searchResults = []
    }
}

// MARK: - Request Model

struct CreateAlertRequest: Codable, Sendable {
    let symbol: String
    let condition: String
    let price: Double
}

// MARK: - View

struct AlertsView: View {

    @State private var vm = AlertsViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                AD.background.ignoresSafeArea()

                if vm.isLoading {
                    LoadingView()
                        .transition(.opacity)
                } else if vm.alerts.isEmpty && vm.error == nil {
                    emptyState
                } else {
                    alertsList
                        .transition(.opacity)
                }
            }
            .animation(.easeInOut, value: vm.isLoading)
            .navigationTitle("Price Alerts")
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
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        vm.resetForm()
                        vm.showAddSheet = true
                    } label: {
                        Image(systemName: "plus.circle.fill")
                            .font(.system(size: 22))
                            .foregroundStyle(AD.accent)
                    }
                }
            }
            .task { await vm.refresh() }
            .sheet(isPresented: $vm.showAddSheet) {
                addAlertSheet
            }
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: AD.spacingMD) {
            Spacer()
            Image(systemName: "bell.slash")
                .font(.system(size: 44))
                .foregroundStyle(AD.textTertiary)

            Text("No Price Alerts")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(AD.textPrimary)

            Text("Set alerts to get notified when a stock reaches your target price.")
                .font(.system(size: 14))
                .foregroundStyle(AD.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, AD.spacingXL)

            Button {
                vm.resetForm()
                vm.showAddSheet = true
            } label: {
                HStack(spacing: AD.spacingSM) {
                    Image(systemName: "plus")
                    Text("Add Alert")
                }
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

    // MARK: - Alerts List

    private var alertsList: some View {
        List {
            if !vm.activeAlerts.isEmpty {
                Section {
                    ForEach(vm.groupedSymbols, id: \.self) { symbol in
                        let symbolAlerts = vm.alerts(for: symbol).filter { !$0.triggered }
                        if !symbolAlerts.isEmpty {
                            ForEach(symbolAlerts) { alert in
                                alertRow(alert)
                                    .listRowBackground(AD.surface)
                                    .listRowSeparatorTint(AD.border)
                                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                        Button(role: .destructive) {
                                            Task { await vm.deleteAlert(alert) }
                                        } label: {
                                            Label("Delete", systemImage: "trash")
                                        }
                                    }
                            }
                        }
                    }
                } header: {
                    Text("Active")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(AD.textTertiary)
                }
            }

            if !vm.triggeredAlerts.isEmpty {
                Section {
                    ForEach(vm.triggeredAlerts) { alert in
                        alertRow(alert)
                            .listRowBackground(AD.surface)
                            .listRowSeparatorTint(AD.border)
                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                Button(role: .destructive) {
                                    Task { await vm.deleteAlert(alert) }
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                    }
                } header: {
                    Text("Triggered")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(AD.textTertiary)
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .refreshable { await vm.refresh() }
    }

    private func alertRow(_ alert: PriceAlert) -> some View {
        HStack(spacing: AD.spacingSM) {
            // Symbol badge
            ZStack {
                RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous)
                    .fill(AD.surfaceElevated)
                    .frame(width: 44, height: 44)

                Text(String(alert.symbol.prefix(2)))
                    .font(.system(size: 14, weight: .bold, design: .monospaced))
                    .foregroundStyle(AD.accent)
            }

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 4) {
                    Text(alert.symbol)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(AD.textPrimary)

                    if alert.triggered {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 13))
                            .foregroundStyle(AD.profit)
                    }
                }

                HStack(spacing: 4) {
                    Image(systemName: alert.condition == "above" ? "arrow.up" : "arrow.down")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(alert.condition == "above" ? AD.profit : AD.loss)

                    Text(alert.condition == "above" ? "Above" : "Below")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(AD.textSecondary)
                }
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 3) {
                Text(alert.price, format: .currency(code: "USD"))
                    .font(.system(size: 15, weight: .semibold, design: .monospaced))
                    .foregroundStyle(AD.textPrimary)

                if alert.triggered, let triggeredAt = alert.triggeredAt {
                    Text(triggeredAt.prefix(10))
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(AD.profit)
                } else {
                    Text("Active")
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .tracking(0.5)
                        .foregroundStyle(AD.accent)
                }
            }
        }
        .padding(.vertical, 4)
    }

    // MARK: - Add Alert Sheet

    private var addAlertSheet: some View {
        NavigationStack {
            ZStack {
                AD.background.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: AD.spacingLG) {
                        // Symbol search
                        VStack(alignment: .leading, spacing: AD.spacingSM) {
                            Text("SYMBOL")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(AD.textTertiary)
                                .tracking(0.8)

                            TextField("Search symbol...", text: $vm.newSymbol)
                                .font(.system(size: 16, weight: .medium))
                                .foregroundStyle(AD.textPrimary)
                                .padding(AD.spacingSM + 4)
                                .background(AD.surfaceElevated)
                                .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM))
                                .overlay(
                                    RoundedRectangle(cornerRadius: AD.radiusSM)
                                        .stroke(AD.border, lineWidth: 1)
                                )
                                .autocorrectionDisabled()
                                .textInputAutocapitalization(.characters)
                                .onChange(of: vm.newSymbol) { _, newValue in
                                    Task { await vm.searchSymbols(newValue) }
                                }

                            if !vm.searchResults.isEmpty {
                                VStack(spacing: 0) {
                                    ForEach(vm.searchResults.prefix(5)) { result in
                                        Button {
                                            vm.newSymbol = result.symbol
                                            vm.searchResults = []
                                        } label: {
                                            HStack {
                                                Text(result.symbol)
                                                    .font(.system(size: 14, weight: .bold, design: .monospaced))
                                                    .foregroundStyle(AD.accent)
                                                if let name = result.name {
                                                    Text(name)
                                                        .font(.system(size: 12))
                                                        .foregroundStyle(AD.textSecondary)
                                                        .lineLimit(1)
                                                }
                                                Spacer()
                                            }
                                            .padding(.horizontal, AD.spacingSM + 4)
                                            .padding(.vertical, AD.spacingSM)
                                        }

                                        if result.id != vm.searchResults.prefix(5).last?.id {
                                            Divider().background(AD.border)
                                        }
                                    }
                                }
                                .background(AD.surfaceElevated)
                                .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM))
                                .overlay(
                                    RoundedRectangle(cornerRadius: AD.radiusSM)
                                        .stroke(AD.border, lineWidth: 1)
                                )
                            }
                        }

                        // Condition picker
                        VStack(alignment: .leading, spacing: AD.spacingSM) {
                            Text("CONDITION")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(AD.textTertiary)
                                .tracking(0.8)

                            HStack(spacing: 0) {
                                conditionButton("above", label: "Above", icon: "arrow.up")
                                conditionButton("below", label: "Below", icon: "arrow.down")
                            }
                            .padding(3)
                            .background(AD.surfaceElevated)
                            .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM + 3, style: .continuous))
                        }

                        // Price input
                        VStack(alignment: .leading, spacing: AD.spacingSM) {
                            Text("TARGET PRICE")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(AD.textTertiary)
                                .tracking(0.8)

                            HStack {
                                Text("$")
                                    .font(.system(size: 18, weight: .semibold))
                                    .foregroundStyle(AD.textTertiary)

                                TextField("0.00", text: $vm.newPrice)
                                    .font(.system(size: 24, weight: .bold, design: .monospaced))
                                    .foregroundStyle(AD.textPrimary)
                                    .keyboardType(.decimalPad)
                            }
                            .padding(AD.spacingSM + 4)
                            .background(AD.surfaceElevated)
                            .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM))
                            .overlay(
                                RoundedRectangle(cornerRadius: AD.radiusSM)
                                    .stroke(AD.border, lineWidth: 1)
                            )
                        }

                        // Submit button
                        Button {
                            Task { await vm.createAlert() }
                        } label: {
                            HStack(spacing: AD.spacingSM) {
                                if vm.isSubmitting {
                                    ProgressView()
                                        .tint(.white)
                                        .scaleEffect(0.85)
                                } else {
                                    Image(systemName: "bell.badge")
                                    Text("Create Alert")
                                }
                            }
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .frame(height: 52)
                            .background(
                                canSubmit ? AD.accent : AD.surfaceElevated
                            )
                            .clipShape(RoundedRectangle(cornerRadius: AD.radiusMD, style: .continuous))
                        }
                        .disabled(!canSubmit || vm.isSubmitting)
                    }
                    .padding(.horizontal, AD.spacingMD)
                    .padding(.top, AD.spacingMD)
                }
            }
            .navigationTitle("New Alert")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(AD.background, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") {
                        vm.showAddSheet = false
                    }
                    .foregroundStyle(AD.textSecondary)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private var canSubmit: Bool {
        !vm.newSymbol.isEmpty && !vm.newPrice.isEmpty && Double(vm.newPrice) != nil && Double(vm.newPrice)! > 0
    }

    private func conditionButton(_ condition: String, label: String, icon: String) -> some View {
        Button {
            withAnimation(.easeInOut(duration: 0.2)) {
                vm.newCondition = condition
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 12, weight: .semibold))
                Text(label)
                    .font(.system(size: 14, weight: vm.newCondition == condition ? .semibold : .regular))
            }
            .foregroundStyle(vm.newCondition == condition ? AD.accent : AD.textTertiary)
            .frame(maxWidth: .infinity)
            .frame(height: 36)
            .background(
                vm.newCondition == condition ? AD.accentDim : .clear
            )
            .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous))
        }
        .sensoryFeedback(.selection, trigger: vm.newCondition)
    }
}

#Preview {
    AlertsView()
        .environment(AuthManager.shared)
}
