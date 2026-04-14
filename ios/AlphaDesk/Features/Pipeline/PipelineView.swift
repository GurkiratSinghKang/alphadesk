import SwiftUI
import Charts

// MARK: - View Model

@Observable
final class PipelineViewModel {
    var pipelineState: PipelineState = .idle
    var lastRunTime: Date? = nil
    var nextScheduledRun: Date? = nil
    var isRunning = false
    var runProgress: String = ""
    var isLoading = true
    var error: String?

    var positions: [PipelineManagedPosition] = []

    var performanceSummary = PipelinePerfSummary(
        totalPnL: 0,
        totalPnLPercent: 0,
        winRate: 0,
        tradesPlaced: 0,
        tradesWon: 0,
        tradesLost: 0,
        avgHoldDays: 0
    )

    var lastRunSummary: PipelineRunSummary?

    enum PipelineState: String {
        case idle, running, error
        var label: String {
            switch self {
            case .idle: return "Idle"
            case .running: return "Running"
            case .error: return "Error"
            }
        }
        var color: Color {
            switch self {
            case .idle: return AD.textTertiary
            case .running: return AD.accent
            case .error: return AD.loss
            }
        }
        var icon: String {
            switch self {
            case .idle: return "moon.fill"
            case .running: return "bolt.fill"
            case .error: return "exclamationmark.triangle.fill"
            }
        }
    }

    @MainActor
    func refresh() async {
        if positions.isEmpty { isLoading = true }
        error = nil

        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.fetchStatus() }
            group.addTask { await self.fetchPositions() }
            group.addTask { await self.fetchHistory() }
        }

        isLoading = false
    }

    @MainActor
    private func fetchStatus() async {
        do {
            let status: PipelineStatus = try await APIClient.shared.request(.pipelineStatus)
            pipelineState = status.running ? .running : .idle
            isRunning = status.running

            if let lastRun = status.lastRun {
                let dateFormatter = DateFormatter()
                dateFormatter.locale = Locale(identifier: "en_US_POSIX")
                dateFormatter.timeZone = TimeZone(abbreviation: "UTC")
                // Try multiple formats
                for fmt in ["yyyy-MM-dd'T'HH:mm:ss.SSSZ", "yyyy-MM-dd'T'HH:mm:ssZ", "yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd"] {
                    dateFormatter.dateFormat = fmt
                    if let date = dateFormatter.date(from: lastRun) {
                        lastRunTime = date
                        break
                    }
                }
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    @MainActor
    private func fetchPositions() async {
        do {
            let response: PipelinePositionsResponse = try await APIClient.shared.request(.pipelinePositions)
            positions = response.openPositions.map { p in
                PipelineManagedPosition(
                    symbol: p.symbol,
                    strategy: p.strategy ?? "Unknown",
                    shares: Int(p.shares ?? 0),
                    entryPrice: p.entryPrice ?? 0,
                    currentPrice: p.currentPrice ?? 0,
                    stopLoss: p.stopLoss ?? 0,
                    target: p.targetPrice ?? 0,
                    entryDate: parseDateString(p.entryTime) ?? Date()
                )
            }

            if let perf = response.performance {
                let won = perf.openTrades ?? 0
                let lost = (perf.totalTrades ?? 0) - won
                performanceSummary = PipelinePerfSummary(
                    totalPnL: perf.totalPnl ?? 0,
                    totalPnLPercent: 0,
                    winRate: perf.winRate ?? 0,
                    tradesPlaced: perf.totalTrades ?? 0,
                    tradesWon: won,
                    tradesLost: max(lost, 0),
                    avgHoldDays: 0
                )
            }
        } catch {
            // Positions error is non-fatal if status loaded
        }
    }

    @MainActor
    private func fetchHistory() async {
        do {
            let history: [PipelineHistoryEntry] = try await APIClient.shared.request(.pipelineHistory)
            if let latest = history.first {
                lastRunSummary = PipelineRunSummary(
                    strategiesRun: latest.strategiesRun ?? 0,
                    symbolsScreened: latest.symbolsScreened ?? 0,
                    symbolsAnalyzed: latest.symbolsAnalyzed ?? 0,
                    ordersPlaced: latest.ordersPlaced ?? 0,
                    ordersClosed: latest.ordersClosed ?? 0,
                    errors: latest.errors ?? 0,
                    duration: latest.duration ?? 0
                )
            }
        } catch {
            // History error is non-fatal
        }
    }

    @MainActor
    func runPipeline() async {
        isRunning = true
        pipelineState = .running
        runProgress = "Starting pipeline..."

        do {
            let response: PipelineRunResponse = try await APIClient.shared.request(
                .pipelineRun,
                method: .post,
                body: PipelineRunRequest(force: false)
            )
            runProgress = response.message ?? "Pipeline started"
            lastRunTime = Date()
        } catch {
            self.error = "Pipeline run failed: \(error.localizedDescription)"
            pipelineState = .error
        }

        // Short delay then refresh to get latest state
        try? await Task.sleep(for: .seconds(2))
        await refresh()

        isRunning = false
        pipelineState = .idle
        runProgress = ""
    }

    private func parseDateString(_ str: String?) -> Date? {
        guard let str else { return nil }
        let dateFormatter = DateFormatter()
        dateFormatter.locale = Locale(identifier: "en_US_POSIX")
        dateFormatter.timeZone = TimeZone(abbreviation: "UTC")
        for fmt in ["yyyy-MM-dd'T'HH:mm:ss.SSSZ", "yyyy-MM-dd'T'HH:mm:ssZ", "yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd"] {
            dateFormatter.dateFormat = fmt
            if let date = dateFormatter.date(from: str) { return date }
        }
        return nil
    }
}

// MARK: - Local Models

struct PipelineManagedPosition: Identifiable {
    let id = UUID()
    let symbol: String
    let strategy: String
    let shares: Int
    let entryPrice: Double
    let currentPrice: Double
    let stopLoss: Double
    let target: Double
    let entryDate: Date

    var pnl: Double { (currentPrice - entryPrice) * Double(shares) }
    var pnlPercent: Double { entryPrice > 0 ? (currentPrice - entryPrice) / entryPrice * 100 : 0 }
}

struct PipelinePerfSummary {
    let totalPnL: Double
    let totalPnLPercent: Double
    let winRate: Double
    let tradesPlaced: Int
    let tradesWon: Int
    let tradesLost: Int
    let avgHoldDays: Double
}

struct PipelineRunSummary {
    let strategiesRun: Int
    let symbolsScreened: Int
    let symbolsAnalyzed: Int
    let ordersPlaced: Int
    let ordersClosed: Int
    let errors: Int
    let duration: Double
}

// MARK: - View

struct PipelineView: View {

    @State private var vm = PipelineViewModel()

    var body: some View {
        NavigationStack {
            Group {
                if vm.isLoading {
                    LoadingView()
                        .transition(.opacity)
                } else if let error = vm.error, vm.positions.isEmpty && vm.lastRunSummary == nil {
                    errorView(error)
                        .transition(.opacity)
                } else {
                    ScrollView(.vertical, showsIndicators: false) {
                        VStack(spacing: AD.spacingLG) {
                            statusCard
                            runButton
                            performanceCards
                            if vm.positions.isEmpty {
                                ContentUnavailableView(
                                    "No Managed Positions",
                                    systemImage: "bolt.badge.clock",
                                    description: Text("Run the pipeline to generate AI-managed trades")
                                )
                            } else {
                                positionsTable
                            }
                            if let _ = vm.lastRunSummary {
                                lastRunCard
                            }
                        }
                        .padding(.horizontal, AD.spacingMD)
                        .padding(.top, AD.spacingSM)
                        .padding(.bottom, 100)
                    }
                    .refreshable { await vm.refresh() }
                    .transition(.opacity)
                }
            }
            .animation(.easeInOut, value: vm.isLoading)
            .background(AD.background)
            .navigationTitle("Pipeline")
            .navigationBarTitleDisplayMode(.large)
            .toolbarBackground(AD.background, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .task { await vm.refresh() }
        }
    }

    // MARK: - Error

    private func errorView(_ message: String) -> some View {
        VStack(spacing: AD.spacingMD) {
            Spacer()
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 40))
                .foregroundStyle(AD.loss)
            Text("Failed to load pipeline")
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

    // MARK: - Status Card

    private var statusCard: some View {
        VStack(spacing: AD.spacingMD) {
            HStack {
                HStack(spacing: AD.spacingSM) {
                    ZStack {
                        Circle()
                            .fill(vm.pipelineState.color.opacity(0.15))
                            .frame(width: 40, height: 40)

                        if vm.isRunning {
                            ProgressView()
                                .tint(vm.pipelineState.color)
                                .scaleEffect(0.8)
                        } else {
                            Image(systemName: vm.pipelineState.icon)
                                .font(.system(size: 16, weight: .medium))
                                .foregroundStyle(vm.pipelineState.color)
                        }
                    }

                    VStack(alignment: .leading, spacing: 2) {
                        Text("Pipeline Status")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(AD.textTertiary)

                        HStack(spacing: 6) {
                            Text(vm.pipelineState.label)
                                .font(.system(size: 18, weight: .bold))
                                .foregroundStyle(vm.pipelineState.color)

                            if vm.isRunning {
                                Circle()
                                    .fill(vm.pipelineState.color)
                                    .frame(width: 6, height: 6)
                                    .modifier(PulseModifier())
                            }
                        }
                    }
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 4) {
                    if let lastRun = vm.lastRunTime {
                        VStack(alignment: .trailing, spacing: 1) {
                            Text("Last Run")
                                .font(.system(size: 10, weight: .medium))
                                .foregroundStyle(AD.textTertiary)
                            Text(lastRun, format: .relative(presentation: .named))
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(AD.textSecondary)
                        }
                    }
                    if let nextRun = vm.nextScheduledRun {
                        VStack(alignment: .trailing, spacing: 1) {
                            Text("Next Run")
                                .font(.system(size: 10, weight: .medium))
                                .foregroundStyle(AD.textTertiary)
                            Text(nextRun, format: .dateTime.hour().minute())
                                .font(.system(size: 12, weight: .medium, design: .monospaced))
                                .foregroundStyle(AD.accent)
                        }
                    }
                }
            }

            // Progress message
            if vm.isRunning, !vm.runProgress.isEmpty {
                HStack(spacing: AD.spacingSM) {
                    Image(systemName: "gearshape.2.fill")
                        .font(.system(size: 12))
                        .foregroundStyle(AD.accent)
                        .rotationEffect(.degrees(vm.isRunning ? 360 : 0))
                        .animation(vm.isRunning ? .linear(duration: 2).repeatForever(autoreverses: false) : .default, value: vm.isRunning)

                    Text(vm.runProgress)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(AD.textSecondary)

                    Spacer()
                }
                .padding(AD.spacingSM)
                .background(AD.accentDim)
                .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous))
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .cardStyle()
        .animation(.easeInOut, value: vm.isRunning)
    }

    // MARK: - Run Button

    private var runButton: some View {
        Button {
            Task { await vm.runPipeline() }
        } label: {
            HStack(spacing: AD.spacingSM) {
                if vm.isRunning {
                    ProgressView()
                        .tint(.white)
                        .scaleEffect(0.85)
                    Text("Running Pipeline...")
                        .font(.system(size: 16, weight: .semibold))
                } else {
                    Image(systemName: "bolt.fill")
                        .font(.system(size: 17))
                    Text("Run Pipeline")
                        .font(.system(size: 16, weight: .semibold))
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background(
                vm.isRunning
                    ? AnyShapeStyle(AD.textTertiary.opacity(0.3))
                    : AnyShapeStyle(
                        LinearGradient(
                            colors: [AD.accent, Color(hex: "3D7AE8")],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
            )
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: AD.radiusMD, style: .continuous))
            .shadow(color: vm.isRunning ? .clear : AD.accent.opacity(0.25), radius: 12, y: 6)
        }
        .disabled(vm.isRunning)
        .sensoryFeedback(.impact(weight: .heavy), trigger: vm.isRunning)
    }

    // MARK: - Performance Cards

    private var performanceCards: some View {
        VStack(alignment: .leading, spacing: AD.spacingSM) {
            Text("Performance")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(AD.textPrimary)

            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: AD.spacingSM), count: 2), spacing: AD.spacingSM) {
                performanceMetric(
                    icon: "dollarsign.circle.fill",
                    label: "Total P&L",
                    value: "\(AD.pnlSign(vm.performanceSummary.totalPnL))$\(String(format: "%.2f", abs(vm.performanceSummary.totalPnL)))",
                    subtitle: "\(AD.pnlSign(vm.performanceSummary.totalPnLPercent))\(String(format: "%.2f", vm.performanceSummary.totalPnLPercent))%",
                    color: AD.pnlColor(vm.performanceSummary.totalPnL)
                )
                performanceMetric(
                    icon: "target",
                    label: "Win Rate",
                    value: String(format: "%.1f%%", vm.performanceSummary.winRate),
                    subtitle: "\(vm.performanceSummary.tradesWon)W / \(vm.performanceSummary.tradesLost)L",
                    color: vm.performanceSummary.winRate >= 55 ? AD.profit : AD.textSecondary
                )
                performanceMetric(
                    icon: "arrow.triangle.swap",
                    label: "Trades",
                    value: "\(vm.performanceSummary.tradesPlaced)",
                    subtitle: "Avg hold \(String(format: "%.0f", vm.performanceSummary.avgHoldDays))d",
                    color: AD.accent
                )
                performanceMetric(
                    icon: "chart.bar.fill",
                    label: "Active Positions",
                    value: "\(vm.positions.count)",
                    subtitle: "\(vm.positions.filter { $0.pnl >= 0 }.count) profitable",
                    color: AD.accent
                )
            }
        }
    }

    private func performanceMetric(icon: String, label: String, value: String, subtitle: String, color: Color) -> some View {
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
                Text(subtitle)
                    .font(.system(size: 10, weight: .regular))
                    .foregroundStyle(AD.textTertiary)
            }

            Spacer()
        }
        .cardStyle(padding: 12)
    }

    // MARK: - Positions Table

    private var positionsTable: some View {
        VStack(alignment: .leading, spacing: AD.spacingSM) {
            HStack {
                Text("AI-Managed Positions")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(AD.textPrimary)
                Spacer()
                Text("\(vm.positions.count) open")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(AD.textTertiary)
            }

            ForEach(vm.positions) { position in
                positionCard(position)
            }
        }
    }

    private func positionCard(_ pos: PipelineManagedPosition) -> some View {
        VStack(spacing: AD.spacingSM) {
            // Header
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(pos.symbol)
                            .font(.system(size: 16, weight: .bold, design: .monospaced))
                            .foregroundStyle(AD.textPrimary)
                        Text(pos.strategy)
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(AD.accent)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(AD.accentDim)
                            .clipShape(Capsule())
                    }
                    Text("\(pos.shares) shares @ \(String(format: "$%.2f", pos.entryPrice))")
                        .font(.system(size: 11, weight: .regular, design: .monospaced))
                        .foregroundStyle(AD.textTertiary)
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 2) {
                    Text("\(AD.pnlSign(pos.pnl))$\(String(format: "%.2f", abs(pos.pnl)))")
                        .font(.system(size: 15, weight: .bold, design: .monospaced))
                        .foregroundStyle(AD.pnlColor(pos.pnl))
                    Text("\(AD.pnlSign(pos.pnlPercent))\(String(format: "%.2f", pos.pnlPercent))%")
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundStyle(AD.pnlColor(pos.pnl).opacity(0.7))
                }
            }

            // Price level bar
            if pos.target > pos.stopLoss {
                priceLevelBar(pos)
            }

            // Bottom stats
            HStack(spacing: AD.spacingLG) {
                levelStat("Stop", value: String(format: "%.2f", pos.stopLoss), color: AD.loss)
                levelStat("Entry", value: String(format: "%.2f", pos.entryPrice), color: AD.textSecondary)
                levelStat("Current", value: String(format: "%.2f", pos.currentPrice), color: AD.textPrimary)
                levelStat("Target", value: String(format: "%.2f", pos.target), color: AD.profit)
            }
        }
        .cardStyle()
    }

    private func priceLevelBar(_ pos: PipelineManagedPosition) -> some View {
        let range = pos.target - pos.stopLoss
        let currentNormalized = range > 0 ? (pos.currentPrice - pos.stopLoss) / range : 0.5
        let entryNormalized = range > 0 ? (pos.entryPrice - pos.stopLoss) / range : 0.5

        return GeometryReader { geo in
            ZStack(alignment: .leading) {
                // Background track
                RoundedRectangle(cornerRadius: 3)
                    .fill(AD.surfaceElevated)
                    .frame(height: 6)

                // Loss zone
                RoundedRectangle(cornerRadius: 3)
                    .fill(AD.loss.opacity(0.2))
                    .frame(width: geo.size.width * CGFloat(entryNormalized), height: 6)

                // Profit zone
                RoundedRectangle(cornerRadius: 3)
                    .fill(AD.profit.opacity(0.2))
                    .frame(width: geo.size.width * CGFloat(1 - entryNormalized), height: 6)
                    .offset(x: geo.size.width * CGFloat(entryNormalized))

                // Current price marker
                Circle()
                    .fill(AD.pnlColor(pos.pnl))
                    .frame(width: 10, height: 10)
                    .shadow(color: AD.pnlColor(pos.pnl).opacity(0.5), radius: 3)
                    .offset(x: geo.size.width * CGFloat(min(max(currentNormalized, 0), 1)) - 5)
            }
        }
        .frame(height: 10)
    }

    private func levelStat(_ label: String, value: String, color: Color) -> some View {
        VStack(spacing: 1) {
            Text(label)
                .font(.system(size: 9, weight: .medium))
                .foregroundStyle(AD.textTertiary)
            Text(value)
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .foregroundStyle(color)
        }
    }

    // MARK: - Last Run Card

    private var lastRunCard: some View {
        VStack(alignment: .leading, spacing: AD.spacingSM) {
            HStack(spacing: AD.spacingSM) {
                Image(systemName: "clock.arrow.circlepath")
                    .font(.system(size: 14))
                    .foregroundStyle(AD.textTertiary)
                Text("Last Run Summary")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(AD.textPrimary)
            }

            if let summary = vm.lastRunSummary {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 4), spacing: AD.spacingSM) {
                    runStat("Strategies", value: "\(summary.strategiesRun)")
                    runStat("Screened", value: "\(summary.symbolsScreened)")
                    runStat("Analyzed", value: "\(summary.symbolsAnalyzed)")
                    runStat("Orders", value: "\(summary.ordersPlaced)")
                }

                HStack {
                    HStack(spacing: 4) {
                        Image(systemName: "timer")
                            .font(.system(size: 11))
                            .foregroundStyle(AD.textTertiary)
                        Text(String(format: "%.1fs", summary.duration))
                            .font(.system(size: 12, weight: .medium, design: .monospaced))
                            .foregroundStyle(AD.textSecondary)
                    }

                    Spacer()

                    if summary.errors > 0 {
                        HStack(spacing: 4) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .font(.system(size: 11))
                                .foregroundStyle(AD.loss)
                            Text("\(summary.errors) errors")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(AD.loss)
                        }
                    } else {
                        HStack(spacing: 4) {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 11))
                                .foregroundStyle(AD.profit)
                            Text("Clean run")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(AD.profit)
                        }
                    }
                }
            }
        }
        .cardStyle()
    }

    private func runStat(_ label: String, value: String) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.system(size: 16, weight: .bold, design: .monospaced))
                .foregroundStyle(AD.textPrimary)
            Text(label)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(AD.textTertiary)
        }
    }
}

// MARK: - Pulse Modifier

struct PulseModifier: ViewModifier {
    @State private var isPulsing = false

    func body(content: Content) -> some View {
        content
            .opacity(isPulsing ? 0.3 : 1.0)
            .animation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true), value: isPulsing)
            .onAppear { isPulsing = true }
    }
}

#Preview {
    PipelineView()
        .environment(AuthManager.shared)
}
