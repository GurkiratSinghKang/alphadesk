import SwiftUI
import Charts

// MARK: - View Model

@Observable
final class RiskDashboardViewModel {
    var isLoading = true
    var error: String?

    // Exposure
    var longExposurePct: Double = 0
    var cashPct: Double = 0

    // Key metrics
    var beta: Double = 0
    var valueAtRisk: Double = 0
    var maxPositionPct: Double = 0
    var sectorConcentrationPct: Double = 0

    // Regime
    var regime: String = "Unknown"
    var regimeConfidence: Double = 0

    // Positions for heatmap
    var heatmapItems: [HeatmapItem] = []

    @MainActor
    func refresh() async {
        isLoading = heatmapItems.isEmpty
        error = nil

        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.fetchPortfolioRisk() }
            group.addTask { await self.fetchRegime() }
        }

        withAnimation(.easeInOut(duration: 0.25)) {
            isLoading = false
        }
    }

    @MainActor
    private func fetchPortfolioRisk() async {
        do {
            let summary: PortfolioSummary = try await APIClient.shared.request(.portfolioSummary)
            let positions: [Position] = try await APIClient.shared.request(.positions)

            let totalEquity = summary.equity
            guard totalEquity > 0 else { return }

            let totalMarketValue = positions.reduce(0.0) { $0 + abs($1.marketValue) }
            longExposurePct = (totalMarketValue / totalEquity) * 100
            cashPct = (summary.cash / totalEquity) * 100

            // Max position weight
            let weights = positions.map { abs($0.marketValue) / totalEquity * 100 }
            maxPositionPct = weights.max() ?? 0

            // Sector concentration: largest group by first letter as proxy
            // (real implementation would use sector data from API)
            var sectorGroups: [String: Double] = [:]
            for pos in positions {
                let key = String(pos.symbol.prefix(1))
                sectorGroups[key, default: 0] += abs(pos.marketValue)
            }
            let largestSector = sectorGroups.values.max() ?? 0
            sectorConcentrationPct = totalMarketValue > 0 ? (largestSector / totalMarketValue) * 100 : 0

            // Estimated beta (weighted average, using 1.0 as default per-stock beta)
            beta = 1.0 + (longExposurePct - 100) * 0.005

            // Simplified VaR: 1-day 95% VaR estimate
            // ~1.65 * daily vol * portfolio value
            let dailyVolEstimate = 0.012 // ~1.2% daily vol estimate
            valueAtRisk = totalEquity * dailyVolEstimate * 1.65

            // Build heatmap items
            heatmapItems = positions.map { pos in
                HeatmapItem(
                    symbol: pos.symbol,
                    pnl: pos.unrealizedPnl,
                    pnlPct: pos.unrealizedPnlPct,
                    weight: abs(pos.marketValue) / totalEquity * 100
                )
            }
            .sorted { $0.weight > $1.weight }
        } catch {
            self.error = error.localizedDescription
        }
    }

    @MainActor
    private func fetchRegime() async {
        do {
            let data: RegimeData = try await APIClient.shared.request(.regime)
            regime = data.regime
            regimeConfidence = data.confidence ?? 0
        } catch {
            regime = "Unknown"
        }
    }
}

// MARK: - Local Models

struct HeatmapItem: Identifiable {
    let id = UUID()
    let symbol: String
    let pnl: Double
    let pnlPct: Double
    let weight: Double
}

// MARK: - View

struct RiskDashboardView: View {

    @State private var vm = RiskDashboardViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                AD.background.ignoresSafeArea()

                if vm.isLoading {
                    LoadingView()
                        .transition(.opacity)
                } else if let error = vm.error, vm.heatmapItems.isEmpty {
                    errorView(error)
                } else {
                    contentView
                        .transition(.opacity)
                }
            }
            .animation(.easeInOut, value: vm.isLoading)
            .navigationTitle("Risk")
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
            }
            .task { await vm.refresh() }
        }
    }

    // MARK: - Error

    private func errorView(_ message: String) -> some View {
        VStack(spacing: AD.spacingMD) {
            Spacer()
            Image(systemName: "exclamationmark.shield")
                .font(.system(size: 40))
                .foregroundStyle(AD.loss)
            Text("Failed to load risk data")
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

    // MARK: - Content

    private var contentView: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(spacing: AD.spacingLG) {
                exposureSection
                regimeSection
                metricsGrid
                if !vm.heatmapItems.isEmpty {
                    heatmapSection
                }
            }
            .padding(.horizontal, AD.spacingMD)
            .padding(.top, AD.spacingSM)
            .padding(.bottom, 100)
        }
        .refreshable { await vm.refresh() }
    }

    // MARK: - Exposure

    private var exposureSection: some View {
        VStack(alignment: .leading, spacing: AD.spacingMD) {
            HStack(spacing: AD.spacingSM) {
                Image(systemName: "chart.bar.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(AD.textTertiary)
                Text("Portfolio Exposure")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(AD.textPrimary)
            }

            // Stacked exposure bar
            GeometryReader { geo in
                HStack(spacing: 2) {
                    let longWidth = max(geo.size.width * CGFloat(vm.longExposurePct / 100) - 1, 4)
                    let cashWidth = max(geo.size.width * CGFloat(vm.cashPct / 100) - 1, 4)

                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .fill(AD.accent)
                        .frame(width: longWidth)

                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .fill(AD.textTertiary.opacity(0.5))
                        .frame(width: cashWidth)
                }
            }
            .frame(height: 14)
            .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))

            HStack(spacing: AD.spacingLG) {
                HStack(spacing: AD.spacingSM) {
                    Circle()
                        .fill(AD.accent)
                        .frame(width: 8, height: 8)
                    Text("Long")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(AD.textSecondary)
                    Text(String(format: "%.1f%%", vm.longExposurePct))
                        .font(.system(size: 13, weight: .semibold, design: .monospaced))
                        .foregroundStyle(AD.textPrimary)
                }

                HStack(spacing: AD.spacingSM) {
                    Circle()
                        .fill(AD.textTertiary.opacity(0.5))
                        .frame(width: 8, height: 8)
                    Text("Cash")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(AD.textSecondary)
                    Text(String(format: "%.1f%%", vm.cashPct))
                        .font(.system(size: 13, weight: .semibold, design: .monospaced))
                        .foregroundStyle(AD.textPrimary)
                }
            }
        }
        .cardStyle()
    }

    // MARK: - Regime

    private var regimeSection: some View {
        HStack(spacing: AD.spacingMD) {
            VStack(alignment: .leading, spacing: AD.spacingSM) {
                Text("MARKET REGIME")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(AD.textTertiary)
                    .tracking(0.8)

                Text(vm.regime.capitalized)
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(regimeColor)
            }

            Spacer()

            // Regime badge
            Text(vm.regime.uppercased())
                .font(.system(size: 11, weight: .bold, design: .rounded))
                .tracking(0.6)
                .foregroundStyle(regimeColor)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(
                    Capsule(style: .continuous)
                        .fill(regimeColor.opacity(0.12))
                )
                .overlay(
                    Capsule(style: .continuous)
                        .strokeBorder(regimeColor.opacity(0.25), lineWidth: 1)
                )

            if vm.regimeConfidence > 0 {
                VStack(alignment: .trailing, spacing: 2) {
                    Text("Confidence")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(AD.textTertiary)
                    Text(String(format: "%.0f%%", vm.regimeConfidence * 100))
                        .font(.system(size: 15, weight: .semibold, design: .monospaced))
                        .foregroundStyle(AD.textPrimary)
                }
            }
        }
        .cardStyle()
    }

    private var regimeColor: Color {
        switch vm.regime.lowercased() {
        case "bullish", "bull", "risk_on", "risk-on":
            return AD.profit
        case "bearish", "bear", "risk_off", "risk-off":
            return AD.loss
        case "volatile", "high_vol", "high-vol":
            return Color(hex: "F59E0B")
        default:
            return AD.accent
        }
    }

    // MARK: - Metrics Grid

    private var metricsGrid: some View {
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: AD.spacingSM), count: 2),
            spacing: AD.spacingSM
        ) {
            riskMetric(
                "Portfolio Beta",
                value: String(format: "%.2f", vm.beta),
                subtitle: vm.beta > 1.2 ? "High" : vm.beta > 0.8 ? "Moderate" : "Low",
                color: vm.beta > 1.2 ? AD.loss : vm.beta > 0.8 ? Color(hex: "F59E0B") : AD.profit,
                icon: "waveform.path.ecg"
            )
            riskMetric(
                "Value at Risk",
                value: vm.valueAtRisk.formatCurrency(),
                subtitle: "1-day 95% VaR",
                color: AD.loss,
                icon: "exclamationmark.triangle"
            )
            riskMetric(
                "Max Position",
                value: String(format: "%.1f%%", vm.maxPositionPct),
                subtitle: vm.maxPositionPct > 25 ? "Concentrated" : "Diversified",
                color: vm.maxPositionPct > 25 ? Color(hex: "F59E0B") : AD.profit,
                icon: "chart.bar"
            )
            riskMetric(
                "Sector Conc.",
                value: String(format: "%.1f%%", vm.sectorConcentrationPct),
                subtitle: "Largest sector",
                color: vm.sectorConcentrationPct > 40 ? Color(hex: "F59E0B") : AD.accent,
                icon: "square.grid.2x2"
            )
        }
    }

    private func riskMetric(_ label: String, value: String, subtitle: String, color: Color, icon: String) -> some View {
        VStack(alignment: .leading, spacing: AD.spacingSM) {
            HStack {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(color.opacity(0.7))
                Spacer()
            }

            Text(value)
                .font(.system(size: 22, weight: .bold, design: .monospaced))
                .foregroundStyle(color)

            VStack(alignment: .leading, spacing: 1) {
                Text(label)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(AD.textSecondary)
                Text(subtitle)
                    .font(.system(size: 11, weight: .regular))
                    .foregroundStyle(AD.textTertiary)
            }
        }
        .cardStyle()
    }

    // MARK: - Position Heatmap

    private var heatmapSection: some View {
        VStack(alignment: .leading, spacing: AD.spacingSM) {
            HStack(spacing: AD.spacingSM) {
                Image(systemName: "square.grid.3x3.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(AD.textTertiary)
                Text("Position Heatmap")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(AD.textPrimary)
                Spacer()
                Text("Size = Weight")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(AD.textTertiary)
            }

            heatmapGrid
        }
        .cardStyle()
    }

    private var heatmapGrid: some View {
        let columns = adaptiveColumns(for: vm.heatmapItems.count)
        return LazyVGrid(columns: columns, spacing: 4) {
            ForEach(vm.heatmapItems) { item in
                heatmapTile(item)
            }
        }
    }

    private func adaptiveColumns(for count: Int) -> [GridItem] {
        let cols = count <= 4 ? 2 : count <= 9 ? 3 : 4
        return Array(repeating: GridItem(.flexible(), spacing: 4), count: cols)
    }

    private func heatmapTile(_ item: HeatmapItem) -> some View {
        let tileColor = item.pnl >= 0
            ? AD.profit.opacity(min(0.2 + abs(item.pnlPct) * 0.08, 0.9))
            : AD.loss.opacity(min(0.2 + abs(item.pnlPct) * 0.08, 0.9))

        // Height scales with weight
        let minHeight: CGFloat = 50
        let maxHeight: CGFloat = 100
        let height = minHeight + CGFloat(item.weight / 100) * (maxHeight - minHeight)

        return VStack(spacing: 2) {
            Text(item.symbol)
                .font(.system(size: 12, weight: .bold, design: .monospaced))
                .foregroundStyle(.white)

            Text(String(format: "%+.1f%%", item.pnlPct))
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                .foregroundStyle(.white.opacity(0.85))

            Text(String(format: "%.1f%%", item.weight))
                .font(.system(size: 9, weight: .medium))
                .foregroundStyle(.white.opacity(0.6))
        }
        .frame(maxWidth: .infinity)
        .frame(height: height)
        .background(
            RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous)
                .fill(tileColor)
        )
        .overlay(
            RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous)
                .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
        )
    }
}

#Preview {
    RiskDashboardView()
        .environment(AuthManager.shared)
}
