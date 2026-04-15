// CopilotSheet.swift
// AlphaDesk
//
// A compact AI copilot chat sheet accessible from any tab via a
// floating brain icon. Reuses the shared ChatRequest/ChatResponse
// models and the /api/v1/agents/chat endpoint.

import SwiftUI

// MARK: - View Model

@Observable
final class CopilotViewModel {
    var messages: [CopilotMessage] = []
    var inputText = ""
    var isLoading = false

    var canSend: Bool {
        !inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isLoading
    }

    static let quickPrompts: [(icon: String, text: String)] = [
        ("chart.pie.fill", "How is my portfolio doing?"),
        ("exclamationmark.triangle.fill", "What are my biggest risks?"),
        ("chart.line.uptrend.xyaxis", "What's the market outlook today?"),
        ("lightbulb.fill", "Suggest trades based on my strategy"),
    ]

    @MainActor
    func send() async {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        messages.append(CopilotMessage(role: .user, content: text, suggestions: []))
        inputText = ""
        isLoading = true

        do {
            let request = ChatRequest(
                message: text,
                context: ChatContext(symbol: nil, portfolioValue: nil)
            )

            let response: ChatResponse = try await APIClient.shared.request(
                .agentChat,
                method: .post,
                body: request
            )

            messages.append(CopilotMessage(
                role: .assistant,
                content: response.message,
                suggestions: response.suggestions ?? []
            ))
        } catch {
            messages.append(CopilotMessage(
                role: .assistant,
                content: "Sorry, I encountered an error: \(error.localizedDescription)",
                suggestions: []
            ))
        }

        isLoading = false
    }

    func applySuggestion(_ text: String) {
        inputText = text
    }
}

struct CopilotMessage: Identifiable {
    let id = UUID()
    let role: Role
    let content: String
    let suggestions: [String]
    let timestamp = Date()

    enum Role { case user, assistant }
}

// MARK: - View

struct CopilotSheet: View {

    @State private var vm = CopilotViewModel()
    @FocusState private var isInputFocused: Bool
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                messagesArea
                inputBar
            }
            .background(AD.background)
            .navigationTitle("AI Copilot")
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

                ToolbarItem(placement: .topBarTrailing) {
                    Image(systemName: "brain.head.profile")
                        .font(.system(size: 16))
                        .foregroundStyle(AD.accent)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(AD.background)
    }

    // MARK: - Messages Area

    private var messagesArea: some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical, showsIndicators: false) {
                LazyVStack(spacing: AD.spacingSM) {
                    if vm.messages.isEmpty {
                        emptyState
                    }

                    ForEach(vm.messages) { message in
                        messageBubble(message)
                            .id(message.id)
                    }

                    if vm.isLoading {
                        typingDots
                            .id("copilot-typing")
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
                    }
                }
            }
            .onChange(of: vm.isLoading) { _, loading in
                if loading {
                    withAnimation(.easeOut(duration: 0.3)) {
                        proxy.scrollTo("copilot-typing", anchor: .bottom)
                    }
                }
            }
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: AD.spacingMD) {
            Spacer(minLength: 20)

            ZStack {
                Circle()
                    .fill(AD.accent.opacity(0.1))
                    .frame(width: 56, height: 56)
                Image(systemName: "brain.head.profile")
                    .font(.system(size: 24))
                    .foregroundStyle(AD.accent)
            }

            Text("How can I help?")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(AD.textPrimary)

            // Quick prompt grid
            VStack(spacing: AD.spacingSM) {
                ForEach(CopilotViewModel.quickPrompts, id: \.text) { prompt in
                    Button {
                        vm.inputText = prompt.text
                        Task { await vm.send() }
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: prompt.icon)
                                .font(.system(size: 13))
                                .foregroundStyle(AD.accent)
                                .frame(width: 20)

                            Text(prompt.text)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(AD.textSecondary)
                                .frame(maxWidth: .infinity, alignment: .leading)

                            Image(systemName: "arrow.up.circle.fill")
                                .font(.system(size: 14))
                                .foregroundStyle(AD.accent.opacity(0.4))
                        }
                        .padding(.horizontal, AD.spacingMD)
                        .padding(.vertical, 10)
                        .background(AD.surface)
                        .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous)
                                .stroke(AD.border, lineWidth: 1)
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.top, AD.spacingSM)
        }
    }

    // MARK: - Message Bubble

    private func messageBubble(_ message: CopilotMessage) -> some View {
        HStack(alignment: .top, spacing: AD.spacingSM) {
            if message.role == .user { Spacer(minLength: 40) }

            VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 6) {
                Text(message.content)
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(
                        message.role == .user ? .white : AD.textPrimary
                    )
                    .textSelection(.enabled)

                // Suggestion pills
                if !message.suggestions.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(message.suggestions, id: \.self) { suggestion in
                                Button {
                                    vm.applySuggestion(suggestion)
                                } label: {
                                    Text(suggestion)
                                        .font(.system(size: 11, weight: .medium))
                                        .foregroundStyle(AD.accent)
                                        .padding(.horizontal, 10)
                                        .padding(.vertical, 5)
                                        .background(AD.accentDim)
                                        .clipShape(Capsule())
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }

                // Compact timestamp
                Text(message.timestamp, format: .dateTime.hour().minute())
                    .font(.system(size: 9, weight: .regular))
                    .foregroundStyle(
                        message.role == .user
                            ? Color.white.opacity(0.45)
                            : AD.textTertiary
                    )
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(
                message.role == .user
                    ? Color(hex: "6C5CE7")
                    : AD.surface
            )
            .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous))
            .overlay(
                message.role == .assistant
                    ? RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous)
                        .stroke(AD.border, lineWidth: 1)
                    : nil
            )

            if message.role == .assistant { Spacer(minLength: 40) }
        }
    }

    // MARK: - Typing Indicator

    private var typingDots: some View {
        HStack {
            HStack(spacing: 3) {
                ForEach(0..<3, id: \.self) { i in
                    Circle()
                        .fill(AD.textTertiary)
                        .frame(width: 5, height: 5)
                        .opacity(0.6)
                        .animation(
                            .easeInOut(duration: 0.6)
                                .repeatForever()
                                .delay(Double(i) * 0.2),
                            value: vm.isLoading
                        )
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 12)
            .background(AD.surface)
            .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous)
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
                    prompt: Text("Ask the copilot...")
                        .foregroundStyle(AD.textTertiary),
                    axis: .vertical
                )
                .font(.system(size: 14))
                .foregroundStyle(AD.textPrimary)
                .lineLimit(1...4)
                .focused($isInputFocused)
                .onSubmit {
                    if vm.canSend {
                        Task { await vm.send() }
                    }
                }

                Button {
                    Task { await vm.send() }
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 28))
                        .foregroundStyle(
                            vm.canSend ? Color(hex: "6C5CE7") : AD.textTertiary.opacity(0.4)
                        )
                }
                .disabled(!vm.canSend)
                .sensoryFeedback(.impact(weight: .light), trigger: vm.messages.count)
            }
            .padding(.horizontal, AD.spacingMD)
            .padding(.top, 8)
            .padding(.bottom, 8)
            .background(AD.surface.opacity(0.95))
            .background(.ultraThinMaterial.opacity(0.3))
        }
    }
}

#Preview {
    CopilotSheet()
        .preferredColorScheme(.dark)
}
