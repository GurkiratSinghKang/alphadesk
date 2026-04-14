import SwiftUI

// MARK: - Local Chat Message

struct LocalChatMessage: Identifiable {
    let id = UUID()
    let role: Role
    let content: String
    let suggestions: [String]
    let timestamp: Date

    enum Role { case user, assistant }
}

// MARK: - View Model

@Observable
final class ChatViewModel {
    var messages: [LocalChatMessage] = []
    var inputText = ""
    var isLoading = false

    // Context passed with each request
    var contextSymbol: String?
    var contextPortfolioValue: Double?

    var canSend: Bool {
        !inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isLoading
    }

    @MainActor
    func sendMessage() async {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        // Append user message
        let userMessage = LocalChatMessage(
            role: .user,
            content: text,
            suggestions: [],
            timestamp: Date()
        )
        messages.append(userMessage)
        inputText = ""
        isLoading = true

        do {
            let request = ChatRequest(
                message: text,
                context: ChatContext(
                    symbol: contextSymbol,
                    portfolioValue: contextPortfolioValue
                )
            )

            let response: ChatResponse = try await APIClient.shared.request(
                .agentChat,
                method: .post,
                body: request
            )

            let assistantMessage = LocalChatMessage(
                role: .assistant,
                content: response.message,
                suggestions: response.suggestions ?? [],
                timestamp: Date()
            )
            messages.append(assistantMessage)

        } catch {
            let errorMessage = LocalChatMessage(
                role: .assistant,
                content: "Sorry, I encountered an error: \(error.localizedDescription)",
                suggestions: [],
                timestamp: Date()
            )
            messages.append(errorMessage)
        }

        isLoading = false
    }

    func applySuggestion(_ suggestion: String) {
        inputText = suggestion
    }
}

// MARK: - View

struct ChatView: View {

    @State private var vm = ChatViewModel()
    @FocusState private var isInputFocused: Bool
    @Environment(\.dismiss) private var dismiss

    var contextSymbol: String?
    var contextPortfolioValue: Double?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                chatMessages
                inputBar
            }
            .background(AD.background)
            .navigationTitle("AI Assistant")
            .navigationBarTitleDisplayMode(.inline)
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
            .onAppear {
                vm.contextSymbol = contextSymbol
                vm.contextPortfolioValue = contextPortfolioValue
            }
        }
    }

    // MARK: - Chat Messages

    private var chatMessages: some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical, showsIndicators: false) {
                LazyVStack(spacing: AD.spacingMD) {
                    // Welcome message if empty
                    if vm.messages.isEmpty {
                        welcomeSection
                    }

                    ForEach(vm.messages) { message in
                        messageBubble(message)
                            .id(message.id)
                    }

                    if vm.isLoading {
                        typingIndicator
                            .id("typing")
                    }
                }
                .padding(.horizontal, AD.spacingMD)
                .padding(.top, AD.spacingSM)
                .padding(.bottom, AD.spacingSM)
            }
            .onChange(of: vm.messages.count) { _, _ in
                withAnimation(.easeOut(duration: 0.3)) {
                    if let lastId = vm.messages.last?.id {
                        proxy.scrollTo(lastId, anchor: .bottom)
                    } else if vm.isLoading {
                        proxy.scrollTo("typing", anchor: .bottom)
                    }
                }
            }
            .onChange(of: vm.isLoading) { _, loading in
                if loading {
                    withAnimation(.easeOut(duration: 0.3)) {
                        proxy.scrollTo("typing", anchor: .bottom)
                    }
                }
            }
        }
    }

    // MARK: - Welcome

    private var welcomeSection: some View {
        VStack(spacing: AD.spacingMD) {
            Spacer(minLength: 40)

            ZStack {
                Circle()
                    .fill(Color(hex: "6C5CE7").opacity(0.15))
                    .frame(width: 72, height: 72)
                Image(systemName: "brain.head.profile")
                    .font(.system(size: 30))
                    .foregroundStyle(Color(hex: "6C5CE7"))
            }

            Text("AlphaDesk AI")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(AD.textPrimary)

            Text("Ask about your portfolio, market analysis,\ntrading strategies, or any financial question.")
                .font(.system(size: 14))
                .foregroundStyle(AD.textTertiary)
                .multilineTextAlignment(.center)

            // Quick prompts
            VStack(spacing: AD.spacingSM) {
                quickPrompt("What's the market outlook today?")
                quickPrompt("Analyze my portfolio risk exposure")
                if let symbol = contextSymbol {
                    quickPrompt("What should I do with \(symbol)?")
                }
                quickPrompt("Which sectors are outperforming?")
            }
            .padding(.top, AD.spacingSM)
        }
    }

    private func quickPrompt(_ text: String) -> some View {
        Button {
            vm.inputText = text
            Task { await vm.sendMessage() }
        } label: {
            HStack(spacing: AD.spacingSM) {
                Image(systemName: "sparkles")
                    .font(.system(size: 12))
                    .foregroundStyle(AD.accent)
                Text(text)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(AD.textSecondary)
                Spacer()
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 16))
                    .foregroundStyle(AD.accent.opacity(0.5))
            }
            .padding(.horizontal, AD.spacingMD)
            .padding(.vertical, 12)
            .background(AD.surface)
            .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous)
                    .stroke(AD.border, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Message Bubble

    private func messageBubble(_ message: LocalChatMessage) -> some View {
        HStack(alignment: .top, spacing: AD.spacingSM) {
            if message.role == .user { Spacer(minLength: 48) }

            VStack(alignment: message.role == .user ? .trailing : .leading, spacing: AD.spacingSM) {
                Text(message.content)
                    .font(.system(size: 14, weight: .regular))
                    .foregroundStyle(
                        message.role == .user ? .white : AD.textPrimary
                    )
                    .textSelection(.enabled)

                // Suggestions (assistant only)
                if !message.suggestions.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("SUGGESTIONS")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(AD.textTertiary)
                            .tracking(0.8)

                        ForEach(message.suggestions, id: \.self) { suggestion in
                            Button {
                                vm.applySuggestion(suggestion)
                            } label: {
                                HStack(spacing: 6) {
                                    Image(systemName: "lightbulb.fill")
                                        .font(.system(size: 10))
                                        .foregroundStyle(Color(hex: "F59E0B"))
                                    Text(suggestion)
                                        .font(.system(size: 12, weight: .medium))
                                        .foregroundStyle(AD.textSecondary)
                                        .multilineTextAlignment(.leading)
                                }
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .background(AD.surfaceElevated)
                                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                // Timestamp
                Text(message.timestamp, format: .dateTime.hour().minute())
                    .font(.system(size: 10, weight: .regular))
                    .foregroundStyle(
                        message.role == .user
                            ? Color.white.opacity(0.5)
                            : AD.textTertiary
                    )
            }
            .padding(.horizontal, AD.spacingMD)
            .padding(.vertical, 12)
            .background(
                message.role == .user
                    ? Color(hex: "6C5CE7")
                    : AD.surface
            )
            .clipShape(
                RoundedRectangle(cornerRadius: AD.radiusMD, style: .continuous)
            )
            .overlay(
                message.role == .assistant
                    ? RoundedRectangle(cornerRadius: AD.radiusMD, style: .continuous)
                        .stroke(AD.border, lineWidth: 1)
                    : nil
            )

            if message.role == .assistant { Spacer(minLength: 48) }
        }
    }

    // MARK: - Typing Indicator

    private var typingIndicator: some View {
        HStack {
            HStack(spacing: 4) {
                ForEach(0..<3, id: \.self) { i in
                    Circle()
                        .fill(AD.textTertiary)
                        .frame(width: 6, height: 6)
                        .opacity(0.6)
                        .animation(
                            .easeInOut(duration: 0.6)
                                .repeatForever()
                                .delay(Double(i) * 0.2),
                            value: vm.isLoading
                        )
                }
            }
            .padding(.horizontal, AD.spacingMD)
            .padding(.vertical, 14)
            .background(AD.surface)
            .clipShape(RoundedRectangle(cornerRadius: AD.radiusMD, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: AD.radiusMD, style: .continuous)
                    .stroke(AD.border, lineWidth: 1)
            )

            Spacer()
        }
    }

    // MARK: - Input Bar

    private var inputBar: some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(AD.border)
                .frame(height: 0.5)

            HStack(spacing: AD.spacingSM) {
                TextField(
                    "",
                    text: $vm.inputText,
                    prompt: Text("Ask AlphaDesk AI...")
                        .foregroundStyle(AD.textTertiary),
                    axis: .vertical
                )
                .font(.system(size: 15))
                .foregroundStyle(AD.textPrimary)
                .lineLimit(1...5)
                .focused($isInputFocused)
                .onSubmit {
                    if vm.canSend {
                        Task { await vm.sendMessage() }
                    }
                }

                Button {
                    Task { await vm.sendMessage() }
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 30))
                        .foregroundStyle(
                            vm.canSend ? Color(hex: "6C5CE7") : AD.textTertiary.opacity(0.4)
                        )
                }
                .disabled(!vm.canSend)
                .sensoryFeedback(.impact(weight: .light), trigger: vm.messages.count)
            }
            .padding(.horizontal, AD.spacingMD)
            .padding(.vertical, 10)
            .background(AD.surface.opacity(0.95))
        }
    }
}

#Preview {
    ChatView()
        .environment(AuthManager.shared)
}
