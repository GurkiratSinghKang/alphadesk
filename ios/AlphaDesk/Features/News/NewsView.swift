import SwiftUI
import SafariServices

// MARK: - View Model

@Observable
final class NewsViewModel {
    var articles: [NewsArticle] = []
    var isLoading = true
    var isRefreshing = false
    var errorMessage: String?
    var selectedURL: URL?

    @MainActor
    func loadNews() async {
        isLoading = articles.isEmpty
        errorMessage = nil

        do {
            let response: NewsResponse = try await APIClient.shared.request(.marketNews)
            articles = response.articles
        } catch {
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }

    @MainActor
    func refresh() async {
        isRefreshing = true
        await loadNews()
        isRefreshing = false
    }
}

// MARK: - View

struct NewsView: View {

    @State private var vm = NewsViewModel()

    var body: some View {
        NavigationStack {
            ZStack {
                AD.background.ignoresSafeArea()

                if vm.isLoading && vm.articles.isEmpty {
                    LoadingView()
                        .transition(.opacity)
                } else if let error = vm.errorMessage, vm.articles.isEmpty {
                    errorView(error)
                        .transition(.opacity)
                } else if vm.articles.isEmpty {
                    ContentUnavailableView(
                        "No News",
                        systemImage: "newspaper",
                        description: Text("Market news will appear here when available")
                    )
                    .transition(.opacity)
                } else {
                    articleList
                        .transition(.opacity)
                }
            }
            .navigationTitle("Market News")
            .navigationBarTitleDisplayMode(.large)
            .toolbarBackground(AD.background, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .animation(.easeInOut, value: vm.isLoading)
            .task { await vm.loadNews() }
            .sheet(item: $vm.selectedURL) { url in
                SafariView(url: url)
                    .ignoresSafeArea()
            }
        }
    }

    // MARK: - Article List

    private var articleList: some View {
        ScrollView(.vertical, showsIndicators: false) {
            LazyVStack(spacing: AD.spacingSM) {
                ForEach(vm.articles) { article in
                    articleRow(article)
                }
            }
            .padding(.horizontal, AD.spacingMD)
            .padding(.top, AD.spacingSM)
            .padding(.bottom, 100)
        }
        .refreshable { await vm.refresh() }
    }

    // MARK: - Article Row

    private func articleRow(_ article: NewsArticle) -> some View {
        Button {
            if let url = URL(string: article.url) {
                vm.selectedURL = url
            }
        } label: {
            VStack(alignment: .leading, spacing: AD.spacingSM) {
                // Headline
                Text(article.title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(AD.textPrimary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)

                // Source + time + sentiment
                HStack(spacing: AD.spacingSM) {
                    // Source + time
                    HStack(spacing: 4) {
                        if let source = article.source {
                            Text(source)
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(AD.textSecondary)
                        }
                        Text("•")
                            .font(.system(size: 12))
                            .foregroundStyle(AD.textTertiary)
                        Text(relativeTime(article.publishedAt))
                            .font(.system(size: 12, weight: .regular))
                            .foregroundStyle(AD.textTertiary)
                    }

                    Spacer()

                    // Sentiment badge
                    if let sentiment = article.sentiment, !sentiment.isEmpty {
                        sentimentBadge(sentiment)
                    }

                    // Symbol tags
                    if let symbols = article.symbols, !symbols.isEmpty {
                        HStack(spacing: 4) {
                            ForEach(symbols.prefix(3), id: \.self) { sym in
                                Text(sym)
                                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                                    .foregroundStyle(AD.accent)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(AD.accentDim)
                                    .clipShape(Capsule())
                            }
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .cardStyle()
        }
        .buttonStyle(.plain)
    }

    // MARK: - Sentiment Badge

    private func sentimentBadge(_ sentiment: String) -> some View {
        let lower = sentiment.lowercased()
        let color: Color = {
            if lower.contains("bull") || lower.contains("positive") { return AD.profit }
            if lower.contains("bear") || lower.contains("negative") { return AD.loss }
            return AD.textTertiary
        }()
        let label: String = {
            if lower.contains("bull") || lower.contains("positive") { return "Bullish" }
            if lower.contains("bear") || lower.contains("negative") { return "Bearish" }
            return "Neutral"
        }()

        return Text(label)
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.12))
            .clipShape(Capsule())
    }

    // MARK: - Error View

    private func errorView(_ message: String) -> some View {
        VStack(spacing: AD.spacingMD) {
            Image(systemName: "newspaper")
                .font(.system(size: 40))
                .foregroundStyle(AD.textTertiary)
            Text("Unable to load news")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(AD.textPrimary)
            Text(message)
                .font(.system(size: 13))
                .foregroundStyle(AD.textTertiary)
                .multilineTextAlignment(.center)
            Button {
                Task { await vm.loadNews() }
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

    // MARK: - Relative Time

    private func relativeTime(_ dateString: String) -> String {
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

        let interval = Date().timeIntervalSince(parsed)

        if interval < 60 { return "Just now" }
        if interval < 3600 { return "\(Int(interval / 60))m ago" }
        if interval < 86400 { return "\(Int(interval / 3600))h ago" }
        if interval < 604800 { return "\(Int(interval / 86400))d ago" }
        return "\(Int(interval / 604800))w ago"
    }
}

// MARK: - URL+Identifiable

extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}

// MARK: - SafariView

struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let config = SFSafariViewController.Configuration()
        config.entersReaderIfAvailable = false
        let safari = SFSafariViewController(url: url, configuration: config)
        safari.preferredBarTintColor = UIColor(AD.background)
        safari.preferredControlTintColor = UIColor(AD.accent)
        return safari
    }

    func updateUIViewController(_ uiViewController: SFSafariViewController, context: Context) {}
}

#Preview {
    NewsView()
        .environment(AuthManager.shared)
}
