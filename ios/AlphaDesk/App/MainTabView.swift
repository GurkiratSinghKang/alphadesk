import SwiftUI

// MARK: - Tab Badge Provider

/// Fetches badge counts for pipeline signals and open orders.
@Observable
final class TabBadgeProvider {
    static let shared = TabBadgeProvider()

    var pendingSignals: Int = 0
    var openOrders: Int = 0

    @MainActor
    func refresh() async {
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.fetchPipelineBadge() }
            group.addTask { await self.fetchOrdersBadge() }
        }
    }

    @MainActor
    private func fetchPipelineBadge() async {
        do {
            let response: PipelinePositionsResponse = try await APIClient.shared.request(.pipelinePositions)
            pendingSignals = response.positions.count
        } catch {
            // Non-fatal: badge stays at previous value
        }
    }

    @MainActor
    private func fetchOrdersBadge() async {
        do {
            let orders: [Order] = try await APIClient.shared.request(.orders)
            openOrders = orders.filter {
                let status = $0.status?.lowercased() ?? ""
                return status == "new" || status == "partially_filled" || status == "accepted" || status == "pending_new"
            }.count
        } catch {
            // Non-fatal
        }
    }
}

// MARK: - Scroll-to-top notification

extension Notification.Name {
    static let scrollToTop = Notification.Name("AlphaDeskScrollToTop")
}

struct MainTabView: View {

    @State private var selectedTab: Tab = .portfolio
    @State private var networkMonitor = NetworkMonitor.shared
    @State private var badgeProvider = TabBadgeProvider.shared

    // State preservation keys
    private static let selectedTabKey = "AlphaDesk_selectedTab"

    enum Tab: Int, CaseIterable, Hashable {
        case portfolio, trade, strategies, pipeline, settings

        var title: String {
            switch self {
            case .portfolio: return "Portfolio"
            case .trade: return "Trade"
            case .strategies: return "Strategies"
            case .pipeline: return "Pipeline"
            case .settings: return "Settings"
            }
        }

        var icon: String {
            switch self {
            case .portfolio: return "chart.pie.fill"
            case .trade: return "chart.line.uptrend.xyaxis"
            case .strategies: return "brain.head.profile"
            case .pipeline: return "bolt.fill"
            case .settings: return "gearshape.fill"
            }
        }
    }

    /// Whether the current device is an iPad.
    private var isIPad: Bool {
        UIDevice.current.userInterfaceIdiom == .pad
    }

    var body: some View {
        Group {
            if isIPad {
                iPadLayout
            } else {
                iPhoneLayout
            }
        }
        .background(AD.background)
        .animation(.easeInOut(duration: 0.3), value: networkMonitor.isConnected)
        .task {
            // Restore saved tab
            if let saved = UserDefaults.standard.object(forKey: Self.selectedTabKey) as? Int,
               let tab = Tab(rawValue: saved) {
                selectedTab = tab
            }
            // Fetch badge counts
            await badgeProvider.refresh()
        }
        .onChange(of: selectedTab) { _, newTab in
            // Persist selected tab
            UserDefaults.standard.set(newTab.rawValue, forKey: Self.selectedTabKey)
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willResignActiveNotification)) { _ in
            UserDefaults.standard.set(selectedTab.rawValue, forKey: Self.selectedTabKey)
        }
    }

    // MARK: - iPad Layout (NavigationSplitView)

    private var iPadLayout: some View {
        NavigationSplitView {
            sidebarContent
        } detail: {
            selectedView
        }
    }

    // MARK: - iPad Sidebar

    private var sidebarContent: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(spacing: 0) {
                // Header
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Image(systemName: "chart.line.uptrend.xyaxis")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(AD.accent)
                        Text("AlphaDesk")
                            .font(.system(size: 20, weight: .bold))
                            .foregroundStyle(AD.textPrimary)
                    }

                    // Offline indicator
                    if !networkMonitor.isConnected {
                        HStack(spacing: 4) {
                            Image(systemName: "wifi.slash")
                                .font(.system(size: 11, weight: .semibold))
                            Text("Offline")
                                .font(.system(size: 11, weight: .semibold))
                        }
                        .foregroundStyle(AD.loss)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, AD.spacingMD)
                .padding(.vertical, AD.spacingMD)

                Divider().background(AD.border)

                // Tab items
                VStack(spacing: 4) {
                    ForEach(Tab.allCases, id: \.self) { tab in
                        Button {
                            withAnimation(.easeInOut(duration: 0.2)) {
                                selectedTab = tab
                            }
                        } label: {
                            sidebarItem(tab)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, AD.spacingSM)
                .padding(.vertical, AD.spacingSM)
            }
        }
        .background(AD.surface)
        .navigationTitle("")
    }

    private func sidebarItem(_ tab: Tab) -> some View {
        HStack(spacing: 12) {
            Image(systemName: tab.icon)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(selectedTab == tab ? AD.accent : AD.textTertiary)
                .frame(width: 24)

            Text(tab.title)
                .font(.system(size: 15, weight: selectedTab == tab ? .semibold : .regular))
                .foregroundStyle(selectedTab == tab ? AD.textPrimary : AD.textSecondary)

            Spacer()

            // Badge
            let count = badgeCount(for: tab)
            if count > 0 {
                Text(count > 99 ? "99+" : "\(count)")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .frame(minWidth: 20)
                    .background(AD.loss)
                    .clipShape(Capsule())
            }
        }
        .padding(.vertical, 4)
        .listRowBackground(
            selectedTab == tab
                ? AD.accentDim.clipShape(RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous))
                : nil
        )
    }

    // MARK: - iPad Detail View

    @ViewBuilder
    private var selectedView: some View {
        switch selectedTab {
        case .portfolio:
            PortfolioView()
        case .trade:
            iPadTradeLayout
        case .strategies:
            StrategiesListView()
        case .pipeline:
            PipelineView()
        case .settings:
            SettingsView()
        }
    }

    /// iPad-optimized trade layout: chart and order panel side by side.
    private var iPadTradeLayout: some View {
        GeometryReader { geo in
            HStack(spacing: 0) {
                // Left: chart / symbol detail
                TradeView()
                    .frame(width: geo.size.width * 0.6)

                // Divider
                Rectangle()
                    .fill(AD.border)
                    .frame(width: 1)

                // Right: Order panel / history
                NavigationStack {
                    VStack(spacing: 0) {
                        OrderHistoryView()
                    }
                }
                .frame(width: geo.size.width * 0.4 - 1)
            }
        }
    }

    // MARK: - iPhone Layout (Custom Tab Bar)

    private var iPhoneLayout: some View {
        ZStack(alignment: .bottom) {
            VStack(spacing: 0) {
                // Offline banner
                if !networkMonitor.isConnected {
                    offlineBanner
                        .transition(.move(edge: .top).combined(with: .opacity))
                }

                // Content
                Group {
                    switch selectedTab {
                    case .portfolio:
                        PortfolioView()
                    case .trade:
                        TradeView()
                    case .strategies:
                        StrategiesListView()
                    case .pipeline:
                        PipelineView()
                    case .settings:
                        SettingsView()
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .padding(.bottom, 80)

            // Custom Tab Bar
            customTabBar
        }
        .ignoresSafeArea(.keyboard)
    }

    // MARK: - Offline Banner

    private var offlineBanner: some View {
        HStack(spacing: AD.spacingSM) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 14, weight: .semibold))
            Text("No Internet Connection")
                .font(.system(size: 13, weight: .semibold))
            Spacer()
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 12, weight: .semibold))
        }
        .foregroundStyle(.white)
        .padding(.horizontal, AD.spacingMD)
        .padding(.vertical, 10)
        .background(AD.loss.opacity(0.9))
    }

    // MARK: - Custom Tab Bar

    private var customTabBar: some View {
        HStack(spacing: 0) {
            ForEach(Tab.allCases, id: \.rawValue) { tab in
                tabItem(tab)
            }
        }
        .padding(.horizontal, AD.spacingSM)
        .padding(.top, 12)
        .padding(.bottom, 4)
        .background(
            ZStack {
                AD.surface
                    .opacity(0.95)
                LinearGradient(
                    colors: [AD.background.opacity(0), AD.surface.opacity(0.6)],
                    startPoint: .top,
                    endPoint: .bottom
                )
            }
            .background(.ultraThinMaterial.opacity(0.4))
        )
        .overlay(alignment: .top) {
            Rectangle()
                .fill(AD.border)
                .frame(height: 0.5)
        }
    }

    /// Badge count for a given tab. Returns 0 if no badge should be shown.
    private func badgeCount(for tab: Tab) -> Int {
        switch tab {
        case .pipeline: return badgeProvider.pendingSignals
        case .trade: return badgeProvider.openOrders
        default: return 0
        }
    }

    private func tabItem(_ tab: Tab) -> some View {
        Button {
            if selectedTab == tab {
                // Re-tap: post scroll-to-top notification
                NotificationCenter.default.post(name: .scrollToTop, object: tab)
            }
            withAnimation(.easeInOut(duration: 0.2)) {
                selectedTab = tab
            }
        } label: {
            VStack(spacing: 4) {
                ZStack(alignment: .topTrailing) {
                    ZStack {
                        if selectedTab == tab {
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(AD.accentDim)
                                .frame(width: 48, height: 30)
                                .transition(.scale.combined(with: .opacity))
                        }
                        Image(systemName: tab.icon)
                            .font(.system(size: 18, weight: .medium))
                            .foregroundStyle(
                                selectedTab == tab ? AD.accent : AD.textTertiary
                            )
                            .symbolEffect(.bounce, value: selectedTab == tab)
                    }
                    .frame(width: 48, height: 30)

                    // Badge
                    let count = badgeCount(for: tab)
                    if count > 0 {
                        Text(count > 99 ? "99+" : "\(count)")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 4)
                            .padding(.vertical, 1)
                            .frame(minWidth: 16)
                            .background(AD.loss)
                            .clipShape(Capsule())
                            .offset(x: 4, y: -4)
                            .transition(.scale.combined(with: .opacity))
                    }
                }

                Text(tab.title)
                    .font(.system(size: 10, weight: selectedTab == tab ? .semibold : .regular))
                    .foregroundStyle(
                        selectedTab == tab ? AD.accent : AD.textTertiary
                    )
            }
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.selection, trigger: selectedTab)
    }
}

#Preview {
    MainTabView()
        .environment(AuthManager.shared)
}
