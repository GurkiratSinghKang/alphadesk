import SwiftUI

/// The set of states a strategy or pipeline can be in.
enum StatusKind: String, CaseIterable, Identifiable {
    case active   = "Active"
    case paused   = "Paused"
    case running  = "Running"
    case stopped  = "Stopped"
    case error    = "Error"

    var id: String { rawValue }
}

/// A small pill badge that represents a strategy or pipeline status.
///
/// * **Active** -- green with subtle outer glow
/// * **Paused** -- amber, static
/// * **Running** -- electric-blue with a pulsing animation
/// * **Stopped** -- neutral grey
/// * **Error** -- red
struct StatusBadge: View {

    let status: StatusKind

    // Running badge pulses between these opacities.
    @State private var isPulsing = false

    // MARK: - Colour mapping

    private var statusColor: Color {
        switch status {
        case .active:  return AppTheme.profit
        case .paused:  return Color(hex: "F59E0B")   // amber-500
        case .running: return AppTheme.accent
        case .stopped: return AppTheme.neutral
        case .error:   return AppTheme.loss
        }
    }

    // MARK: - Body

    var body: some View {
        Text(status.rawValue.uppercased())
            .font(.system(size: 10, weight: .bold, design: .rounded))
            .tracking(0.6)
            .foregroundStyle(statusColor)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(
                Capsule(style: .continuous)
                    .fill(statusColor.opacity(0.12))
            )
            .overlay(
                Capsule(style: .continuous)
                    .strokeBorder(statusColor.opacity(0.25), lineWidth: 1)
            )
            // Outer glow for active state
            .shadow(
                color: status == .active ? statusColor.opacity(0.35) : .clear,
                radius: 6,
                x: 0,
                y: 0
            )
            // Pulse animation for running state
            .opacity(status == .running && isPulsing ? 0.55 : 1)
            .animation(
                status == .running
                    ? .easeInOut(duration: 1).repeatForever(autoreverses: true)
                    : .default,
                value: isPulsing
            )
            .onAppear {
                if status == .running { isPulsing = true }
            }
    }
}

// MARK: - Preview

#Preview {
    HStack(spacing: 12) {
        ForEach(StatusKind.allCases) { kind in
            StatusBadge(status: kind)
        }
    }
    .padding()
    .background(AppTheme.background)
}
