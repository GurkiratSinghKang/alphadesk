import SwiftUI

// MARK: - View Model

@Observable
final class PositionSizerViewModel {
    var equity: Double = 0
    var riskPercent: Double = 2.0
    var entryPrice: String = ""
    var stopLossPrice: String = ""
    var isLoadingEquity = true

    var entry: Double { Double(entryPrice) ?? 0 }
    var stop: Double { Double(stopLossPrice) ?? 0 }

    var riskPerShare: Double {
        let diff = entry - stop
        return abs(diff)
    }

    var isValid: Bool {
        entry > 0 && stop > 0 && entry != stop && equity > 0
    }

    var sharesToBuy: Int {
        guard isValid, riskPerShare > 0 else { return 0 }
        let dollarRisk = equity * (riskPercent / 100.0)
        return Int(dollarRisk / riskPerShare)
    }

    var dollarRisk: Double {
        Double(sharesToBuy) * riskPerShare
    }

    var positionValue: Double {
        Double(sharesToBuy) * entry
    }

    var portfolioWeight: Double {
        guard equity > 0 else { return 0 }
        return (positionValue / equity) * 100
    }

    var isOverweight: Bool {
        portfolioWeight > 10
    }

    var isLongTrade: Bool {
        entry > stop
    }

    @MainActor
    func loadEquity() async {
        isLoadingEquity = true
        do {
            let summary: PortfolioSummary = try await APIClient.shared.request(.portfolioSummary)
            equity = summary.equity
        } catch {
            // Use default or zero
        }
        isLoadingEquity = false
    }
}

// MARK: - View

struct PositionSizerView: View {

    @State private var vm = PositionSizerViewModel()
    @Environment(\.dismiss) private var dismiss

    /// Optional pre-filled entry price from a symbol detail page.
    var prefillPrice: Double?

    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(spacing: AD.spacingLG) {
                headerSection
                inputsSection
                if vm.isValid {
                    resultsSection
                }
            }
            .padding(.horizontal, AD.spacingMD)
            .padding(.top, AD.spacingSM)
            .padding(.bottom, 40)
        }
        .background(AD.background)
        .navigationTitle("Position Sizer")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(AD.background, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button { dismiss() } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 22))
                        .foregroundStyle(AD.textTertiary)
                }
            }
        }
        .task {
            await vm.loadEquity()
            if let price = prefillPrice, price > 0 {
                vm.entryPrice = String(format: "%.2f", price)
            }
        }
    }

    // MARK: - Header

    private var headerSection: some View {
        VStack(spacing: AD.spacingSM) {
            ZStack {
                Circle()
                    .fill(AD.accent.opacity(0.12))
                    .frame(width: 56, height: 56)

                Image(systemName: "function")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(AD.accent)
            }

            Text("Calculate Optimal Size")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(AD.textPrimary)

            Text("Risk-based position sizing")
                .font(.system(size: 13, weight: .regular))
                .foregroundStyle(AD.textTertiary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, AD.spacingSM)
    }

    // MARK: - Inputs

    private var inputsSection: some View {
        VStack(alignment: .leading, spacing: AD.spacingMD) {
            // Equity
            VStack(alignment: .leading, spacing: 6) {
                Text("ACCOUNT EQUITY")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(AD.textTertiary)

                if vm.isLoadingEquity {
                    HStack {
                        ProgressView().tint(AD.accent).scaleEffect(0.8)
                        Text("Loading...")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(AD.textTertiary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .frame(height: 48)
                    .padding(.horizontal, AD.spacingMD)
                    .background(AD.surfaceElevated)
                    .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous))
                } else {
                    HStack {
                        Image(systemName: "dollarsign.circle")
                            .font(.system(size: 16))
                            .foregroundStyle(AD.accent)

                        Text(vm.equity, format: .currency(code: "USD"))
                            .font(.system(size: 16, weight: .semibold, design: .monospaced))
                            .foregroundStyle(AD.textPrimary)

                        Spacer()

                        Text("Auto")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(AD.accent)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(AD.accentDim)
                            .clipShape(Capsule())
                    }
                    .frame(height: 48)
                    .padding(.horizontal, AD.spacingMD)
                    .background(AD.surfaceElevated)
                    .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous))
                }
            }

            // Risk % slider
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("RISK PER TRADE")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(AD.textTertiary)

                    Spacer()

                    Text(String(format: "%.1f%%", vm.riskPercent))
                        .font(.system(size: 15, weight: .bold, design: .monospaced))
                        .foregroundStyle(riskColor)
                        .contentTransition(.numericText(value: vm.riskPercent))
                        .animation(.spring(duration: 0.2), value: vm.riskPercent)
                }

                Slider(value: $vm.riskPercent, in: 0.5...5.0, step: 0.25)
                    .tint(riskColor)

                HStack {
                    Text("0.5%")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundStyle(AD.textTertiary)
                    Spacer()
                    Text("Conservative")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(AD.textTertiary)
                    Spacer()
                    Text("5.0%")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundStyle(AD.textTertiary)
                }
            }
            .padding(AD.spacingMD)
            .background(AD.surfaceElevated)
            .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous))

            // Entry & Stop Loss
            HStack(spacing: AD.spacingSM) {
                priceField("ENTRY PRICE", text: $vm.entryPrice, icon: "arrow.up.right", color: AD.profit)
                priceField("STOP LOSS", text: $vm.stopLossPrice, icon: "arrow.down.right", color: AD.loss)
            }
        }
        .cardStyle()
    }

    private func priceField(_ label: String, text: Binding<String>, icon: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(AD.textTertiary)

            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(color)

                Text("$")
                    .font(.system(size: 15, weight: .medium, design: .monospaced))
                    .foregroundStyle(AD.textTertiary)

                TextField("0.00", text: text)
                    .font(.system(size: 16, weight: .semibold, design: .monospaced))
                    .foregroundStyle(AD.textPrimary)
                    .keyboardType(.decimalPad)
            }
            .frame(height: 44)
            .padding(.horizontal, AD.spacingSM)
            .background(AD.surfaceElevated)
            .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous))
        }
    }

    private var riskColor: Color {
        if vm.riskPercent <= 1.5 { return AD.profit }
        if vm.riskPercent <= 3.0 { return AD.accent }
        return AD.loss
    }

    // MARK: - Results

    private var resultsSection: some View {
        VStack(alignment: .leading, spacing: AD.spacingMD) {
            HStack(spacing: AD.spacingSM) {
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 16))
                    .foregroundStyle(AD.accent)
                Text("Calculation Results")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(AD.textPrimary)
            }

            // Direction badge
            HStack(spacing: 6) {
                Image(systemName: vm.isLongTrade ? "arrow.up.circle.fill" : "arrow.down.circle.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(vm.isLongTrade ? AD.profit : AD.loss)
                Text(vm.isLongTrade ? "Long Trade" : "Short Trade")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(vm.isLongTrade ? AD.profit : AD.loss)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background((vm.isLongTrade ? AD.profit : AD.loss).opacity(0.12))
            .clipShape(Capsule())

            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: AD.spacingSM), count: 2), spacing: AD.spacingSM) {
                resultMetric(
                    icon: "number.circle.fill",
                    label: "Shares to Buy",
                    value: "\(vm.sharesToBuy)",
                    color: AD.accent
                )
                resultMetric(
                    icon: "exclamationmark.triangle.fill",
                    label: "Dollar Risk",
                    value: vm.dollarRisk.formatCurrency(),
                    color: AD.loss
                )
                resultMetric(
                    icon: "banknote.fill",
                    label: "Position Value",
                    value: vm.positionValue.formatCurrency(),
                    color: AD.textSecondary
                )
                resultMetric(
                    icon: "chart.pie.fill",
                    label: "Portfolio Weight",
                    value: String(format: "%.1f%%", vm.portfolioWeight),
                    color: vm.isOverweight ? AD.loss : AD.profit
                )
            }

            // Overweight warning
            if vm.isOverweight {
                HStack(spacing: AD.spacingSM) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(AD.loss)

                    Text("Position exceeds 10% of portfolio. Consider reducing size for better diversification.")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(AD.loss)
                }
                .padding(AD.spacingSM)
                .background(AD.loss.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous)
                        .stroke(AD.loss.opacity(0.2), lineWidth: 1)
                )
            }

            // Risk per share
            HStack {
                Text("Risk per share:")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(AD.textTertiary)
                Text(String(format: "$%.2f", vm.riskPerShare))
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    .foregroundStyle(AD.textSecondary)
            }
        }
        .cardStyle()
        .transition(.opacity.combined(with: .move(edge: .bottom)))
        .animation(.easeInOut(duration: 0.3), value: vm.isValid)
    }

    private func resultMetric(icon: String, label: String, value: String, color: Color) -> some View {
        HStack(spacing: AD.spacingSM) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(color.opacity(0.7))
                .frame(width: 32, height: 32)
                .background(color.opacity(0.1))
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(AD.textTertiary)
                Text(value)
                    .font(.system(size: 16, weight: .bold, design: .monospaced))
                    .foregroundStyle(color)
            }

            Spacer()
        }
        .cardStyle(padding: 12)
    }
}

#Preview {
    NavigationStack {
        PositionSizerView(prefillPrice: 185.50)
    }
    .environment(AuthManager.shared)
}
