import SwiftUI
import Shared

/// Worker auth — the iOS login screen (worker-app.html `LoginScreen`).
///
/// The reskin over the shared auth logic: validation uses the pure
/// `LoginFormValidator`; sign-in uses the `SupabaseAuthGateway` (via `WorkerBackend`).
/// This is the SwiftUI analogue of the Android `LoginHost` + `LoginScreen` — the host
/// orchestration is reimplemented in Swift, but the field validation (the tested pure
/// logic) is shared. Selector `accessibilityIdentifier`s match the Maestro contract.
///
/// Like Android, login is the LIVE path only (the demo bypasses it). A true PennKey
/// SSO redirect is not wired (the gateway is email+password); "keep me signed in" is
/// informational (the Supabase session persists via storage regardless).
@MainActor
final class LoginObservable: ObservableObject {
    @Published var email = ""
    @Published var password = ""
    @Published var submitting = false
    @Published var emailError: String?
    @Published var passwordError: String?
    @Published var formError: String?
    @Published var showPassword = false
    @Published var keepSignedIn = true
    /// Non-nil once authenticated — the host swaps to the shifts screen.
    @Published var authedSession: AuthSession?

    private let gateway: AuthGateway

    init(gateway: AuthGateway) {
        self.gateway = gateway
    }

    func setEmail(_ value: String) {
        email = value
        emailError = nil
        formError = nil
    }

    func setPassword(_ value: String) {
        password = value
        passwordError = nil
        formError = nil
    }

    func submit() {
        let errors = LoginFormValidator.shared.validate(email: email, password: password)
        if errors.hasError {
            emailError = errors.email
            passwordError = errors.password
            return
        }
        submitting = true
        formError = nil
        Task {
            do {
                // The gateway's AuthOutcome is ignored; success is read back as a live session.
                _ = try await gateway.signIn(email: email, password: password)
                let session = try await gateway.currentSession()
                submitting = false
                if let session {
                    WorkerBackend.shared.wireAccessToken()
                    authedSession = session
                } else {
                    formError = "Incorrect email or password."
                }
            } catch {
                submitting = false
                formError = "Network error. Check your connection and try again."
            }
        }
    }
}

struct LoginScreen: View {
    @ObservedObject var model: LoginObservable
    @Environment(\.colorScheme) private var scheme
    @FocusState private var focused: Field?

    private enum Field { case email, password }

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        return ScrollView {
            VStack(spacing: 0) {
                Spacer().frame(height: 40)
                BrandMark(size: 72)
                Text("Shift@PennHousing")
                    .font(ShiftFont.sans(27, .bold)).tracking(-0.5).foregroundColor(c.ink)
                    .padding(.top, 20)
                Text("Your schedule, floats and open shifts — for Residential Services staff.")
                    .font(ShiftFont.sans(14.5)).foregroundColor(c.sec)
                    .multilineTextAlignment(.center).lineSpacing(3)
                    .padding(.top, 6).frame(maxWidth: 280)

                VStack(spacing: 16) {
                    field(
                        label: "PennKey email", icon: ShiftIcons.person, text: model.email,
                        onChange: model.setEmail, error: model.emailError, isFocused: focused == .email
                    )
                    .focused($focused, equals: .email)
                    .keyboardType(.emailAddress).textInputAutocapitalization(.never)
                    .accessibilityIdentifier("login_email")

                    passwordField(c)
                }
                .padding(.top, 36)

                HStack {
                    Button(action: { model.keepSignedIn.toggle() }) {
                        HStack(spacing: 8) {
                            ZStack {
                                RoundedRectangle(cornerRadius: 6, style: .continuous)
                                    .fill(model.keepSignedIn ? c.blue : .clear).frame(width: 20, height: 20)
                                RoundedRectangle(cornerRadius: 6, style: .continuous)
                                    .strokeBorder(model.keepSignedIn ? c.blue : c.outline, lineWidth: 1.5).frame(width: 20, height: 20)
                                if model.keepSignedIn {
                                    Image(systemName: ShiftIcons.check).font(.system(size: 12, weight: .bold)).foregroundColor(.white)
                                }
                            }
                            Text("Keep me signed in").font(ShiftFont.sans(13.5, .medium)).foregroundColor(c.sec)
                        }
                    }
                    .buttonStyle(.plain)
                    Spacer()
                    Text("Need help?").font(ShiftFont.sans(13.5, .semibold)).foregroundColor(c.blue)
                }
                .padding(.top, 16)

                ShiftButton(
                    title: model.submitting ? "Signing in…" : "Sign in with PennKey",
                    action: { model.submit() },
                    variant: .filled, size: .lg, systemIcon: model.submitting ? nil : ShiftIcons.lock, fullWidth: true
                )
                .disabled(model.submitting)
                .padding(.top, 20)
                .accessibilityIdentifier("login_submit")

                if let formError = model.formError {
                    ShiftBanner(title: formError, tone: .error)
                        .padding(.top, 16)
                        .accessibilityIdentifier("login_error")
                }

                Spacer().frame(height: 28)
                Text("University of Pennsylvania · Residential Services\nBy signing in you agree to the staff scheduling policy.")
                    .font(ShiftFont.sans(11.5)).foregroundColor(c.ter)
                    .multilineTextAlignment(.center).lineSpacing(3)
                    .padding(.bottom, 24)
            }
            .padding(.horizontal, 24)
            .frame(maxWidth: .infinity)
        }
        .background(c.bg)
        .accessibilityIdentifier("login_screen")
    }

    private func passwordField(_ c: ShiftColors) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text("Password").font(ShiftFont.sans(12.5, .semibold)).foregroundColor(c.sec)
            HStack(spacing: 10) {
                Image(systemName: ShiftIcons.lock).font(.system(size: 18)).foregroundColor(c.ter)
                Group {
                    if model.showPassword {
                        TextField("", text: Binding(get: { model.password }, set: { model.setPassword($0) }))
                    } else {
                        SecureField("", text: Binding(get: { model.password }, set: { model.setPassword($0) }))
                    }
                }
                .font(ShiftFont.sans(16, .medium)).foregroundColor(c.ink)
                .textInputAutocapitalization(.never)
                .focused($focused, equals: .password)
                Button(action: { model.showPassword.toggle() }) {
                    Text(model.showPassword ? "Hide" : "Show").font(ShiftFont.sans(13, .semibold)).foregroundColor(c.blue)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 14).frame(height: 52)
            .background(c.surface)
            .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 13, style: .continuous)
                    .strokeBorder(model.passwordError != nil ? c.danger.accent : (focused == .password ? c.blue : c.divider), lineWidth: 1.5)
            )
            if let err = model.passwordError {
                Text(err).font(ShiftFont.sans(12.5)).foregroundColor(c.danger.accent)
            }
        }
        .accessibilityIdentifier("login_password")
    }

    private func field(
        label: String, icon: String, text: String, onChange: @escaping (String) -> Void,
        error: String?, isFocused: Bool
    ) -> some View {
        let c = ShiftColors.resolve(scheme)
        return VStack(alignment: .leading, spacing: 7) {
            Text(label).font(ShiftFont.sans(12.5, .semibold)).foregroundColor(c.sec)
            HStack(spacing: 10) {
                Image(systemName: icon).font(.system(size: 18)).foregroundColor(c.ter)
                TextField("", text: Binding(get: { text }, set: onChange))
                    .font(ShiftFont.sans(16, .medium)).foregroundColor(c.ink)
            }
            .padding(.horizontal, 14).frame(height: 52)
            .background(c.surface)
            .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 13, style: .continuous)
                    .strokeBorder(error != nil ? c.danger.accent : (isFocused ? c.blue : c.divider), lineWidth: 1.5)
            )
            if let error {
                Text(error).font(ShiftFont.sans(12.5)).foregroundColor(c.danger.accent)
            }
        }
    }
}

/// The brand mark (worker-app.html `BrandMark`): brand-blue rounded square + "S" + dot.
struct BrandMark: View {
    let size: CGFloat
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        let c = ShiftColors.resolve(scheme)
        return ZStack {
            RoundedRectangle(cornerRadius: size * 0.28, style: .continuous).fill(c.blue)
            Text("S").font(ShiftFont.sans(size * 0.46, .bold)).tracking(-1).foregroundColor(.white)
            Circle().fill(Color.white.opacity(0.85))
                .frame(width: size * 0.1, height: size * 0.1)
                .offset(x: size * 0.28, y: size * 0.26)
        }
        .frame(width: size, height: size)
        .shadow(color: c.blue.opacity(0.35), radius: 9, y: 6)
    }
}
