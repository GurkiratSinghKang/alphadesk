import SwiftUI

// MARK: - Trading Mode (local to Settings)

enum TradingMode: String, CaseIterable {
    case paper = "paper"
    case live = "live"

    var label: String {
        switch self {
        case .paper: return "Paper"
        case .live: return "Live"
        }
    }
}

// MARK: - View

struct SettingsView: View {

    @Environment(AuthManager.self) private var authManager
    @State private var showLogoutConfirmation = false
    @State private var tradingMode: TradingMode
    @State private var biometricLockEnabled: Bool

    init() {
        let savedMode = UserDefaults.standard.string(forKey: "trading_mode") ?? "paper"
        _tradingMode = State(initialValue: TradingMode(rawValue: savedMode) ?? .paper)
        _biometricLockEnabled = State(initialValue: UserDefaults.standard.bool(forKey: "biometric_lock_enabled"))
    }

    var body: some View {
        NavigationStack {
            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: AD.spacingLG) {
                    accountSection
                    serverSection
                    tradingModeSection
                    preferencesSection
                    dangerZone
                    appInfoSection
                }
                .padding(.horizontal, AD.spacingMD)
                .padding(.top, AD.spacingSM)
                .padding(.bottom, 100)
            }
            .background(AD.background)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.large)
            .toolbarBackground(AD.background, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .alert("Sign Out", isPresented: $showLogoutConfirmation) {
                Button("Cancel", role: .cancel) {}
                Button("Sign Out", role: .destructive) {
                    authManager.logout()
                }
            } message: {
                Text("Are you sure you want to sign out? You will need to log in again to access your portfolio.")
            }
        }
    }

    // MARK: - Account

    private var accountSection: some View {
        VStack(alignment: .leading, spacing: AD.spacingSM) {
            sectionHeader("Account", icon: "person.circle.fill")

            HStack(spacing: AD.spacingMD) {
                // Avatar
                ZStack {
                    Circle()
                        .fill(
                            LinearGradient(
                                colors: [AD.accent, Color(hex: "6C5CE7")],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 52, height: 52)

                    Text(String((authManager.username ?? "U").prefix(1)).uppercased())
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(.white)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(authManager.username ?? "User")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(AD.textPrimary)

                    HStack(spacing: 6) {
                        Circle()
                            .fill(AD.profit)
                            .frame(width: 6, height: 6)
                        Text("Connected")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(AD.profit)
                    }
                }

                Spacer()

                Image(systemName: "checkmark.shield.fill")
                    .font(.system(size: 20))
                    .foregroundStyle(AD.profit)
            }
            .cardStyle()
        }
    }

    // MARK: - Server

    private var serverSection: some View {
        @Bindable var auth = authManager
        return VStack(alignment: .leading, spacing: AD.spacingSM) {
            sectionHeader("Server", icon: "server.rack")

            VStack(spacing: AD.spacingMD) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("API Server URL")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(AD.textSecondary)

                    HStack {
                        Image(systemName: "link")
                            .font(.system(size: 14))
                            .foregroundStyle(AD.textTertiary)

                        TextField("", text: $auth.serverURL,
                                  prompt: Text("https://tradingalpha.net").foregroundStyle(AD.textTertiary))
                            .font(.system(size: 14, design: .monospaced))
                            .foregroundStyle(AD.textPrimary)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                    }
                    .padding(.horizontal, AD.spacingMD)
                    .padding(.vertical, 12)
                    .background(AD.surfaceElevated)
                    .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous)
                            .stroke(AD.border, lineWidth: 1)
                    )
                }

                // Connection status
                HStack(spacing: AD.spacingSM) {
                    Circle()
                        .fill(authManager.isAuthenticated ? AD.profit : AD.loss)
                        .frame(width: 6, height: 6)
                    Text(authManager.isAuthenticated ? "Connected" : "Not connected")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(authManager.isAuthenticated ? AD.profit : AD.loss)
                    Spacer()
                    Text(authManager.serverURL)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(AD.textTertiary)
                        .lineLimit(1)
                }
            }
            .cardStyle()
        }
    }

    // MARK: - Trading Mode

    private var tradingModeSection: some View {
        VStack(alignment: .leading, spacing: AD.spacingSM) {
            sectionHeader("Trading", icon: "chart.line.uptrend.xyaxis")

            VStack(spacing: AD.spacingMD) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Trading Mode")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(AD.textPrimary)
                        Text(tradingMode == .paper
                             ? "Simulated trades, no real money"
                             : "Real trades with real capital")
                            .font(.system(size: 12, weight: .regular))
                            .foregroundStyle(AD.textTertiary)
                    }
                    Spacer()
                }

                // Mode toggle
                HStack(spacing: 0) {
                    ForEach(TradingMode.allCases, id: \.self) { mode in
                        Button {
                            withAnimation(.easeInOut(duration: 0.2)) {
                                tradingMode = mode
                                UserDefaults.standard.set(mode.rawValue, forKey: "trading_mode")
                            }
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: mode == .paper ? "doc.text" : "banknote")
                                    .font(.system(size: 13))
                                Text(mode.label)
                                    .font(.system(size: 14, weight: .semibold))
                            }
                            .foregroundStyle(
                                tradingMode == mode
                                    ? (mode == .live ? AD.loss : AD.profit)
                                    : AD.textTertiary
                            )
                            .frame(maxWidth: .infinity)
                            .frame(height: 44)
                            .background(
                                tradingMode == mode
                                    ? (mode == .live ? AD.loss.opacity(0.12) : AD.profit.opacity(0.12))
                                    : .clear
                            )
                            .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous))
                        }
                        .sensoryFeedback(.selection, trigger: tradingMode)
                    }
                }
                .padding(3)
                .background(AD.surfaceElevated)
                .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM + 3, style: .continuous))

                if tradingMode == .live {
                    HStack(spacing: AD.spacingSM) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.system(size: 13))
                            .foregroundStyle(Color(hex: "F59E0B"))
                        Text("Live trading uses real capital. Ensure you understand the risks.")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Color(hex: "F59E0B").opacity(0.9))
                    }
                    .padding(AD.spacingSM)
                    .background(Color(hex: "F59E0B").opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous))
                    .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
            .cardStyle()
        }
    }

    // MARK: - Preferences

    private var preferencesSection: some View {
        VStack(alignment: .leading, spacing: AD.spacingSM) {
            sectionHeader("Preferences", icon: "slider.horizontal.3")

            VStack(spacing: 0) {
                settingsRow(icon: "bell.badge.fill", label: "Notifications", detail: "Enabled", color: AD.accent)
                Divider().background(AD.border).padding(.leading, 56)
                settingsRow(icon: "hand.tap.fill", label: "Haptic Feedback", detail: "On", color: Color(hex: "6C5CE7"))
                Divider().background(AD.border).padding(.leading, 56)
                settingsRow(icon: "moon.fill", label: "Appearance", detail: "Dark", color: Color(hex: "F59E0B"))
                Divider().background(AD.border).padding(.leading, 56)

                // Biometric Lock Toggle
                HStack(spacing: AD.spacingMD) {
                    Image(systemName: "lock.shield.fill")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(AD.profit)
                        .frame(width: 32, height: 32)
                        .background(AD.profit.opacity(0.12))
                        .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))

                    Text("Biometric Lock")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(AD.textPrimary)

                    Spacer()

                    Toggle("", isOn: $biometricLockEnabled)
                        .labelsHidden()
                        .tint(AD.accent)
                        .sensoryFeedback(.impact(weight: .light), trigger: biometricLockEnabled)
                        .onChange(of: biometricLockEnabled) { _, newValue in
                            UserDefaults.standard.set(newValue, forKey: "biometric_lock_enabled")
                        }
                }
                .padding(.horizontal, AD.spacingMD)
                .padding(.vertical, 14)
            }
            .cardStyle(padding: 0)
        }
    }

    private func settingsRow(icon: String, label: String, detail: String, color: Color) -> some View {
        HStack(spacing: AD.spacingMD) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(color)
                .frame(width: 32, height: 32)
                .background(color.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))

            Text(label)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(AD.textPrimary)

            Spacer()

            Text(detail)
                .font(.system(size: 13, weight: .regular))
                .foregroundStyle(AD.textTertiary)

            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(AD.textTertiary.opacity(0.5))
        }
        .padding(.horizontal, AD.spacingMD)
        .padding(.vertical, 14)
    }

    // MARK: - Danger Zone

    private var dangerZone: some View {
        VStack(alignment: .leading, spacing: AD.spacingSM) {
            Button {
                showLogoutConfirmation = true
            } label: {
                HStack(spacing: AD.spacingSM) {
                    Image(systemName: "rectangle.portrait.and.arrow.right")
                        .font(.system(size: 15, weight: .medium))
                    Text("Sign Out")
                        .font(.system(size: 15, weight: .semibold))
                }
                .foregroundStyle(AD.loss)
                .frame(maxWidth: .infinity)
                .frame(height: 50)
                .background(AD.loss.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: AD.radiusMD, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: AD.radiusMD, style: .continuous)
                        .stroke(AD.loss.opacity(0.2), lineWidth: 1)
                )
            }
            .sensoryFeedback(.warning, trigger: showLogoutConfirmation)
        }
    }

    // MARK: - App Info

    private var appInfoSection: some View {
        VStack(spacing: AD.spacingSM) {
            HStack(spacing: AD.spacingSM) {
                Image(systemName: "chart.line.uptrend.xyaxis")
                    .font(.system(size: 14))
                    .foregroundStyle(AD.textTertiary)
                Text("AlphaDesk")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(AD.textTertiary)
            }

            Text("Version \(appVersion) (Build \(buildNumber))")
                .font(.system(size: 12, weight: .regular))
                .foregroundStyle(AD.textTertiary.opacity(0.7))

            Text("Made with Claude")
                .font(.system(size: 11, weight: .regular))
                .foregroundStyle(AD.textTertiary.opacity(0.5))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, AD.spacingLG)
    }

    // MARK: - Helpers

    private func sectionHeader(_ title: String, icon: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(AD.textTertiary)
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(AD.textTertiary)
                .textCase(.uppercase)
                .tracking(0.8)
        }
    }

    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
    }

    private var buildNumber: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
    }
}

#Preview {
    SettingsView()
        .environment(AuthManager.shared)
}
