import SwiftUI

struct LoginView: View {

    @Environment(AuthManager.self) private var authManager
    @State private var username = ""
    @State private var password = ""
    @State private var showPassword = false
    @FocusState private var focusedField: Field?

    private enum Field {
        case username, password
    }

    var body: some View {
        ZStack {
            // Background gradient
            backgroundGradient

            ScrollView {
                VStack(spacing: AD.spacingXL) {
                    Spacer(minLength: 80)

                    // Logo
                    logoSection

                    // Form
                    formSection

                    // Error
                    if let error = authManager.errorMessage {
                        errorBanner(error)
                    }

                    // Sign In Button
                    signInButton

                    // Server URL
                    serverURLSection

                    Spacer(minLength: 40)
                }
                .padding(.horizontal, AD.spacingLG)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .ignoresSafeArea()
    }

    // MARK: - Background

    private var backgroundGradient: some View {
        ZStack {
            AD.background

            // Top-left accent glow
            RadialGradient(
                colors: [AD.accent.opacity(0.08), .clear],
                center: .topLeading,
                startRadius: 0,
                endRadius: 400
            )

            // Bottom-right secondary glow
            RadialGradient(
                colors: [Color(hex: "6C5CE7").opacity(0.05), .clear],
                center: .bottomTrailing,
                startRadius: 0,
                endRadius: 350
            )
        }
    }

    // MARK: - Logo

    private var logoSection: some View {
        VStack(spacing: AD.spacingSM) {
            ZStack {
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [AD.accent, Color(hex: "6C5CE7")],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 72, height: 72)
                    .shadow(color: AD.accent.opacity(0.3), radius: 20, y: 8)

                Image(systemName: "chart.line.uptrend.xyaxis")
                    .font(.system(size: 30, weight: .semibold))
                    .foregroundStyle(.white)
            }

            Text("AlphaDesk")
                .font(.system(size: 32, weight: .bold, design: .default))
                .foregroundStyle(AD.textPrimary)

            Text("Intelligent Trading Terminal")
                .font(.system(size: 15, weight: .regular))
                .foregroundStyle(AD.textSecondary)
        }
        .padding(.bottom, AD.spacingMD)
    }

    // MARK: - Form

    private var formSection: some View {
        VStack(spacing: AD.spacingMD) {
            // Username
            VStack(alignment: .leading, spacing: 6) {
                Text("Username")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(AD.textSecondary)

                HStack(spacing: 12) {
                    Image(systemName: "person.fill")
                        .font(.system(size: 15))
                        .foregroundStyle(AD.textTertiary)
                        .frame(width: 20)

                    TextField("", text: $username, prompt: Text("Enter username").foregroundStyle(AD.textTertiary))
                        .textContentType(.username)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .focused($focusedField, equals: .username)
                        .foregroundStyle(AD.textPrimary)
                        .font(.system(size: 16))
                        .onSubmit { focusedField = .password }
                        .submitLabel(.next)
                }
                .padding(.horizontal, AD.spacingMD)
                .padding(.vertical, 14)
                .background(AD.surfaceElevated)
                .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous)
                        .stroke(focusedField == .username ? AD.accent.opacity(0.5) : AD.border, lineWidth: 1)
                )
            }

            // Password
            VStack(alignment: .leading, spacing: 6) {
                Text("Password")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(AD.textSecondary)

                HStack(spacing: 12) {
                    Image(systemName: "lock.fill")
                        .font(.system(size: 15))
                        .foregroundStyle(AD.textTertiary)
                        .frame(width: 20)

                    Group {
                        if showPassword {
                            TextField("", text: $password, prompt: Text("Enter password").foregroundStyle(AD.textTertiary))
                        } else {
                            SecureField("", text: $password, prompt: Text("Enter password").foregroundStyle(AD.textTertiary))
                        }
                    }
                    .textContentType(.password)
                    .focused($focusedField, equals: .password)
                    .foregroundStyle(AD.textPrimary)
                    .font(.system(size: 16))
                    .onSubmit { signIn() }
                    .submitLabel(.go)

                    Button {
                        showPassword.toggle()
                    } label: {
                        Image(systemName: showPassword ? "eye.slash.fill" : "eye.fill")
                            .font(.system(size: 14))
                            .foregroundStyle(AD.textTertiary)
                    }
                }
                .padding(.horizontal, AD.spacingMD)
                .padding(.vertical, 14)
                .background(AD.surfaceElevated)
                .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous)
                        .stroke(focusedField == .password ? AD.accent.opacity(0.5) : AD.border, lineWidth: 1)
                )
            }
        }
    }

    // MARK: - Error

    private func errorBanner(_ message: String) -> some View {
        HStack(spacing: AD.spacingSM) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 14))
                .foregroundStyle(AD.loss)

            Text(message)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(AD.loss)
        }
        .padding(AD.spacingMD)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AD.loss.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous)
                .stroke(AD.loss.opacity(0.2), lineWidth: 1)
        )
        .transition(.move(edge: .top).combined(with: .opacity))
    }

    // MARK: - Sign In Button

    private var signInButton: some View {
        Button(action: signIn) {
            HStack(spacing: AD.spacingSM) {
                if authManager.isLoading {
                    ProgressView()
                        .tint(.white)
                        .scaleEffect(0.85)
                } else {
                    Text("Sign In")
                        .font(.system(size: 17, weight: .semibold))
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background(
                LinearGradient(
                    colors: canSubmit
                        ? [AD.accent, Color(hex: "3D7AE8")]
                        : [AD.textTertiary.opacity(0.3), AD.textTertiary.opacity(0.2)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: AD.radiusMD, style: .continuous))
            .shadow(color: canSubmit ? AD.accent.opacity(0.25) : .clear, radius: 12, y: 6)
        }
        .disabled(!canSubmit || authManager.isLoading)
        .sensoryFeedback(.impact(weight: .medium), trigger: authManager.isLoading)
    }

    // MARK: - Server URL

    private var serverURLSection: some View {
        @Bindable var auth = authManager
        return VStack(spacing: 6) {
            Text("Server")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(AD.textTertiary)

            TextField("", text: $auth.serverURL, prompt: Text("https://tradingalpha.net").foregroundStyle(AD.textTertiary))
                .font(.system(size: 13, design: .monospaced))
                .foregroundStyle(AD.textSecondary)
                .multilineTextAlignment(.center)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .padding(.horizontal, AD.spacingMD)
                .padding(.vertical, 10)
                .background(AD.surface)
                .clipShape(RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: AD.radiusSM, style: .continuous)
                        .stroke(AD.borderSubtle, lineWidth: 1)
                )
        }
    }

    // MARK: - Helpers

    private var canSubmit: Bool {
        !username.trimmingCharacters(in: .whitespaces).isEmpty &&
        !password.isEmpty
    }

    private func signIn() {
        guard canSubmit else { return }
        focusedField = nil
        Task {
            await authManager.login(username: username, password: password)
        }
    }
}

#Preview {
    LoginView()
        .environment(AuthManager.shared)
}
