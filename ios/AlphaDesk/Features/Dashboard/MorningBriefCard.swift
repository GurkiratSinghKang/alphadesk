// MorningBriefCard.swift
// AlphaDesk
//
// A dismissable morning brief card shown at the top of PortfolioView.
// Fetches data from /api/v1/portfolio/morning-brief and displays
// overnight changes, top movers, and an AI summary.

import SwiftUI

// MARK: - View Model

@Observable
final class MorningBriefViewModel {
    var brief: MorningBriefResponse?
    var isLoading = false
    var isDismissed = false
    var error: String?

    /// UserDefaults key includes today's date so dismissal resets daily.
    private var dismissKey: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return "MorningBrief_dismissed_\(formatter.string(from: Date()))"
    }

    var shouldShow: Bool {
        !isDismissed && brief != nil
    }

    @MainActor
    func load() async {
        // Check if already dismissed today
        if UserDefaults.standard.bool(forKey: dismissKey) {
            isDismissed = true
            return
        }

        isLoading = true
        error = nil

        do {
            let response: MorningBriefResponse = try await APIClient.shared.request(.morningBrief)
            brief = response
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    func dismiss() {
        withAnimation(.easeOut(duration: 0.3)) {
            isDismissed = true
        }
        UserDefaults.standard.set(true, forKey: dismissKey)
    }
}

// MARK: - View

struct MorningBriefCard: View {

    @State private var vm = MorningBriefViewModel()

    var body: some View {
        Group {
            if vm.isLoading {
                briefSkeleton
            } else if vm.shouldShow, let brief = vm.brief {
                briefContent(brief)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .task {
            await vm.load()
        }
    }

    // MARK: - Skeleton

    private var briefSkeleton: some View {
        VStack(alignment: .leading, spacing: AD.spacingSM) {
            HStack {
                RoundedRectangle(cornerRadius: 4)
                    .fill(AD.surfaceElevated)
                    .frame(width: 160, height: 16)
                Spacer()
                RoundedRectangle(cornerRadius: 4)
                    .fill(AD.surfaceElevated)
                    .frame(width: 24, height: 24)
            }
            RoundedRectangle(cornerRadius: 4)
                .fill(AD.surfaceElevated)
                .frame(height: 12)
            RoundedRectangle(cornerRadius: 4)
                .fill(AD.surfaceElevated)
                .frame(width: 200, height: 12)
        }
        .cardStyle()
        .shimmer()
    }

    // MARK: - Content

    private func briefContent(_ brief: MorningBriefResponse) -> some View {
        VStack(alignment: .leading, spacing: AD.spacingSM) {
            // Header with greeting and dismiss
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(greeting)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(AD.textPrimary)

                    Text("Morning Brief")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(AD.textTertiary)
                }

                Spacer()

                Button {
                    vm.dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(AD.textTertiary)
                        .frame(width: 28, height: 28)
                        .background(AD.surfaceElevated)
                        .clipShape(Circle())
                }
            }

            // Overnight change
            HStack(spacing: AD.spacingSM) {
                Image(systemName: brief.portfolio.overnightChange >= 0
                      ? "arrow.up.right.circle.fill"
                      : "arrow.down.right.circle.fill")
                    .font(.system(size: 20))
                    .foregroundStyle(AD.pnlColor(brief.portfolio.overnightChange))

                VStack(alignment: .leading, spacing: 1) {
                    Text("Overnight")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(AD.textTertiary)

                    HStack(spacing: 4) {
                        Text(brief.portfolio.overnightChange.formatPnL())
                            .font(.system(size: 15, weight: .bold, design: .monospaced))
                            .foregroundStyle(AD.pnlColor(brief.portfolio.overnightChange))

                        Text("(\(brief.portfolio.overnightChangePct.formatPercent()))")
                            .font(.system(size: 12, weight: .medium, design: .monospaced))
                            .foregroundStyle(AD.pnlColor(brief.portfolio.overnightChangePct).opacity(0.8))
                    }
                }

                Spacer()

                // Market regime pill
                Text(brief.market.regime.capitalized)
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(regimeColor(brief.market.regime))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(regimeColor(brief.market.regime).opacity(0.15))
                    .clipShape(Capsule())
            }
            .padding(.vertical, AD.spacingXS)

            // Top movers
            if !brief.topMovers.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("TOP MOVERS")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(AD.textTertiary)
                        .tracking(0.8)

                    ForEach(brief.topMovers.prefix(3), id: \.symbol) { mover in
                        moverRow(mover)
                    }
                }
            }

            // AI Summary
            if !brief.aiSummary.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 4) {
                        Image(systemName: "sparkles")
                            .font(.system(size: 10))
                            .foregroundStyle(Color(hex: "6C5CE7"))
                        Text("AI SUMMARY")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(AD.textTertiary)
                            .tracking(0.8)
                    }

                    Text(brief.aiSummary)
                        .font(.system(size: 13, weight: .regular))
                        .foregroundStyle(AD.textSecondary)
                        .lineLimit(3)
                }
                .padding(.top, AD.spacingXS)
            }

            // Market bar: VIX + SPY
            HStack(spacing: AD.spacingMD) {
                marketStat(
                    label: "VIX",
                    value: String(format: "%.1f", brief.market.vix),
                    change: brief.market.vixChange
                )
                marketStat(
                    label: "SPY",
                    value: brief.market.spyChangePct.formatPercent(),
                    change: brief.market.spyChangePct
                )
            }
            .padding(.top, AD.spacingXS)
        }
        .cardStyle()
        .overlay(
            RoundedRectangle(cornerRadius: AD.radiusMD, style: .continuous)
                .stroke(
                    LinearGradient(
                        colors: [AD.accent.opacity(0.3), AD.accent.opacity(0.05)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 1
                )
        )
    }

    // MARK: - Mover Row

    private func moverRow(_ mover: BriefMover) -> some View {
        HStack(spacing: AD.spacingSM) {
            Text(mover.symbol)
                .font(.system(size: 13, weight: .bold, design: .monospaced))
                .foregroundStyle(AD.textPrimary)
                .frame(width: 50, alignment: .leading)

            Text(mover.changePct.formatPercent())
                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                .foregroundStyle(AD.pnlColor(mover.changePct))

            Spacer()

            Text("Impact: \(mover.impact.formatPnL())")
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundStyle(AD.pnlColor(mover.impact))
        }
        .padding(.vertical, 4)
        .padding(.horizontal, AD.spacingSM)
        .background(AD.surfaceElevated.opacity(0.5))
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
    }

    // MARK: - Market Stat

    private func marketStat(label: String, value: String, change: Double) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(AD.textTertiary)
            Text(value)
                .font(.system(size: 13, weight: .semibold, design: .monospaced))
                .foregroundStyle(AD.pnlColor(change))
        }
    }

    // MARK: - Helpers

    private var greeting: String {
        let hour = Calendar.current.component(.hour, from: Date())
        switch hour {
        case 0..<12: return "Good Morning"
        case 12..<17: return "Good Afternoon"
        default: return "Good Evening"
        }
    }

    private func regimeColor(_ regime: String) -> Color {
        switch regime.lowercased() {
        case "bullish", "risk-on": return AD.profit
        case "bearish", "risk-off": return AD.loss
        default: return AD.textTertiary
        }
    }
}

#Preview {
    VStack {
        MorningBriefCard()
    }
    .padding()
    .background(AD.background)
    .preferredColorScheme(.dark)
}
