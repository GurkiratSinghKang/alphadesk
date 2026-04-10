import SwiftUI

/// A premium full-screen loading state with a pulsing logo and shimmer.
///
/// Drop this into any view while data is being fetched:
///
/// ```swift
/// if isLoading { LoadingView() } else { content }
/// ```
struct LoadingView: View {

    @State private var pulse = false
    @State private var shimmerOffset: CGFloat = -200

    var body: some View {
        ZStack {
            AppTheme.background
                .ignoresSafeArea()

            VStack(spacing: 24) {
                // Pulsing logo ring
                ZStack {
                    Circle()
                        .strokeBorder(
                            AppTheme.accent.opacity(0.15),
                            lineWidth: 3
                        )
                        .frame(width: 64, height: 64)

                    Circle()
                        .strokeBorder(
                            AppTheme.accent.opacity(pulse ? 0.6 : 0.2),
                            lineWidth: 2
                        )
                        .frame(width: 48, height: 48)
                        .scaleEffect(pulse ? 1.12 : 0.92)

                    Image(systemName: "chart.line.uptrend.xyaxis")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(AppTheme.accent)
                        .opacity(pulse ? 1 : 0.6)
                }

                Text("Loading...")
                    .font(AppTheme.captionFont)
                    .foregroundStyle(AppTheme.textTertiary)
                    .tracking(1.2)
            }
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 1.2).repeatForever(autoreverses: true)) {
                pulse = true
            }
            withAnimation(.linear(duration: 1.8).repeatForever(autoreverses: false)) {
                shimmerOffset = 200
            }
        }
    }
}

// MARK: - Skeleton shimmer modifier

/// Applies a shimmering gradient overlay to any view, useful for
/// skeleton-loading placeholders.
///
/// ```swift
/// RoundedRectangle(cornerRadius: 8)
///     .fill(AppTheme.surface)
///     .frame(height: 20)
///     .shimmer()
/// ```
struct ShimmerModifier: ViewModifier {

    @State private var phase: CGFloat = -1

    func body(content: Content) -> some View {
        content
            .overlay(
                GeometryReader { geo in
                    let width = geo.size.width

                    LinearGradient(
                        colors: [
                            Color.white.opacity(0),
                            Color.white.opacity(0.06),
                            Color.white.opacity(0.1),
                            Color.white.opacity(0.06),
                            Color.white.opacity(0),
                        ],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                    .frame(width: width * 0.6)
                    .offset(x: phase * width)
                    .onAppear {
                        withAnimation(
                            .linear(duration: 1.5)
                            .repeatForever(autoreverses: false)
                        ) {
                            phase = 1.4
                        }
                    }
                }
            )
            .clipped()
    }
}

extension View {
    /// Adds a subtle shimmer animation, ideal for skeleton placeholders.
    func shimmer() -> some View {
        modifier(ShimmerModifier())
    }
}

// MARK: - Skeleton row helper

/// A pre-built skeleton row that mimics `QuoteRow` dimensions while loading.
struct SkeletonRow: View {

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(AppTheme.surfaceElevated)
                    .frame(width: 60, height: 14)

                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(AppTheme.surfaceElevated)
                    .frame(width: 90, height: 10)
            }

            Spacer()

            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .fill(AppTheme.surfaceElevated)
                .frame(width: 72, height: 14)
        }
        .padding(.vertical, 10)
        .padding(.horizontal, AppTheme.paddingM)
        .shimmer()
    }
}

// MARK: - Preview

#Preview("Loading") {
    LoadingView()
}

#Preview("Skeleton rows") {
    VStack(spacing: 0) {
        ForEach(0..<5, id: \.self) { _ in
            SkeletonRow()
        }
    }
    .background(AppTheme.background)
}
