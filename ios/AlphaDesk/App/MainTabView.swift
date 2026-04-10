import SwiftUI

struct MainTabView: View {

    @State private var selectedTab: Tab = .portfolio

    enum Tab: Int, CaseIterable {
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

    var body: some View {
        ZStack(alignment: .bottom) {
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
            .padding(.bottom, 80)

            // Custom Tab Bar
            customTabBar
        }
        .background(AD.background)
        .ignoresSafeArea(.keyboard)
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

    private func tabItem(_ tab: Tab) -> some View {
        Button {
            withAnimation(.easeInOut(duration: 0.2)) {
                selectedTab = tab
            }
        } label: {
            VStack(spacing: 4) {
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
                .frame(height: 30)

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
