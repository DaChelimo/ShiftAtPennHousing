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
/// Like Android, login is the LIVE path only (the demo bypasses it). PennKey SSO is not
/// wired — the gateway is plain email+password, which is why the CTA reads "Sign in"
/// rather than naming an identity provider the app does not actually redirect to.
/// "Keep me signed in" is informational (the Supabase session persists via storage
/// regardless).
@MainActor
final class LoginObservable: ObservableObject {
    @Published var email = ""
    @Published var password = ""
    @Published var submitting = false
    @Published var emailError: String?
    /// Non-blocking domain hint (e.g. neither `@upenn.edu` nor `@gmail.com`) — never blocks sign-in.
    @Published var emailWarning: String?
    @Published var passwordError: String?
    @Published var formError: String?
    /// DEBUG-only raw diagnostic behind `formError` (network/config detail); never shown in release.
    @Published var formErrorDetail: String?
    @Published var showPassword = false
    @Published var keepSignedIn = true
    /// Non-nil once authenticated — the host swaps to the shifts screen.
    @Published var authedSession: AuthSession?

    private let gateway: AuthGateway
    /// The in-flight sign-in, so `cancel()` can actually stop it. Cancelling the Swift
    /// Task cancels the bridged Kotlin coroutine, which the gateway lets propagate
    /// rather than reporting as a failure.
    private var signInTask: Task<Void, Never>?

    init(gateway: AuthGateway) {
        self.gateway = gateway
    }

    func setEmail(_ value: String) {
        email = value
        emailError = nil
        emailWarning = LoginFormValidator.shared.domainWarning(email: value)
        formError = nil
        formErrorDetail = nil
    }

    func setPassword(_ value: String) {
        password = value
        passwordError = nil
        formError = nil
        formErrorDetail = nil
    }

    /// Maps the gateway's classified `AuthError` to user-facing copy (mirrors Android's
    /// `AuthError.toMessage()`). The raw `detail` behind it is surfaced separately in DEBUG.
    private static func message(for error: AuthError) -> String {
        switch error {
        case .invalidCredentials: return "Incorrect email or password."
        case .network: return "Network error. Check your connection and try again."
        case .timeout: return "Signing in took too long. Check your connection and try again."
        case .unknown: return "Something went wrong. Please try again."
        @unknown default: return "Something went wrong. Please try again."
        }
    }

    func submit() {
        let errors = LoginFormValidator.shared.validate(email: email, password: password)
        if errors.hasError {
            emailError = errors.email
            passwordError = errors.password
            return
        }
        signInTask?.cancel()
        submitting = true
        formError = nil
        formErrorDetail = nil
        signInTask = Task { [weak self] in
            guard let self else { return }
            do {
                // Switch on the gateway's classified outcome (like Android's LoginHost) so a
                // network/config failure is distinguishable from a wrong password. The success
                // case already carries the session, so no second currentSession() probe/race.
                let outcome = try await self.gateway.signIn(email: self.email, password: self.password)
                // A result that lands after the worker cancelled must not sign them in or
                // flash a stale error. Mirrors the reducer arm on Android, which honours
                // AuthSucceeded/AuthFailed only while still SUBMITTING.
                guard !Task.isCancelled, self.submitting else { return }
                switch onEnum(of: outcome) {
                case .success(let ok):
                    WorkerBackend.shared.wireAccessToken()
                    // Deliberately leaves `submitting` TRUE. The host swaps to the splash on
                    // the very next frame; clearing it first would flash the button back to
                    // its idle state, which reads as "nothing happened, tap again".
                    self.authedSession = ok.session
                case .failure(let fail):
                    self.submitting = false
                    self.formError = Self.message(for: fail.error)
                    self.formErrorDetail = fail.detail
                }
            } catch {
                // The gateway converts every terminal condition (including its own timeout)
                // into an outcome, so a throw here is cancellation — the worker tapped Cancel,
                // and `cancel()` has already reset the screen. Reporting an error would blame
                // them for their own deliberate action.
                guard !Task.isCancelled else { return }
                self.submitting = false
                self.formError = "Something went wrong. Please try again."
                self.formErrorDetail = "signIn threw: \(error.localizedDescription)"
            }
        }
    }

    /// Backs out of an in-flight sign-in: stops the gateway call and returns the form to
    /// its editable state with the typed credentials intact. The worker chose this, so no
    /// error banner is raised.
    func cancel() {
        signInTask?.cancel()
        signInTask = nil
        submitting = false
        formError = nil
        formErrorDetail = nil
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
                Text("SHIFT")
                    .font(ShiftFont.sans(27, .bold)).tracking(-0.5).foregroundColor(c.ink)
                    .padding(.top, 20)
                Text("Your schedule, floats and open shifts, for Residential Services staff.")
                    .font(ShiftFont.sans(14.5)).foregroundColor(c.sec)
                    .multilineTextAlignment(.center).lineSpacing(3)
                    .padding(.top, 6).frame(maxWidth: 280)

                VStack(spacing: 16) {
                    field(
                        label: "Your email", placeholder: "andrew@upenn.edu",
                        icon: ShiftIcons.person, text: model.email,
                        onChange: model.setEmail, error: model.emailError, warning: model.emailWarning, isFocused: focused == .email
                    )
                    .focused($focused, equals: .email)
                    .keyboardType(.emailAddress).textInputAutocapitalization(.never)
                    .submitLabel(.next)
                    .onSubmit { focused = .password }
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
                    title: model.submitting ? "Signing in…" : "Sign in",
                    action: { model.submit() },
                    variant: .filled, size: .lg, systemIcon: model.submitting ? nil : ShiftIcons.lock, fullWidth: true,
                    loading: model.submitting
                )
                .disabled(model.submitting)
                .padding(.top, 20)
                .accessibilityIdentifier("login_submit")

                if model.submitting {
                    // The way out of a slow sign-in. The CTA is disabled while the gateway
                    // call is in flight, so without this the worker has no control at all —
                    // they either wait out the timeout or force-quit the app. Shown from the
                    // first frame rather than on a delay: a sign-in that resolves quickly
                    // barely renders it, and one that does not is exactly when it is needed.
                    Button(action: { model.cancel() }) {
                        Text("Cancel")
                            .font(ShiftFont.sans(14, .semibold))
                            .foregroundColor(c.blue)
                            .padding(.horizontal, 16).padding(.vertical, 8)
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 14)
                    .transition(.opacity)
                    .accessibilityIdentifier("login_cancel")
                }

                if let formError = model.formError {
                    ShiftBanner(title: formError, tone: .error)
                        .padding(.top, 16)
                        .accessibilityIdentifier("login_error")
                    #if DEBUG
                    // The raw underlying error (yellow), so a network/config failure is not
                    // mistaken for a wrong password. DEBUG builds only, truncated to 3 lines.
                    if let detail = model.formErrorDetail {
                        Text("debug: \(detail)")
                            .font(ShiftFont.mono(11.5))
                            .foregroundColor(Color(red: 0.72, green: 0.53, blue: 0.04))
                            .lineLimit(3)
                            .truncationMode(.tail)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 12).padding(.vertical, 8)
                            .background(Color(red: 0.78, green: 0.57, blue: 0.0).opacity(0.13))
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                            .padding(.top, 8)
                            .accessibilityIdentifier("login_error_debug")
                    }
                    #endif
                }

                Spacer().frame(height: 28)
                Text("University of Pennsylvania · Residential Services\nBy signing in you agree to the staff scheduling policy.")
                    .font(ShiftFont.sans(11.5)).foregroundColor(c.ter)
                    .multilineTextAlignment(.center).lineSpacing(3)
                    .padding(.bottom, 24)
            }
            .padding(.horizontal, 24)
            .frame(maxWidth: .infinity)
            .animation(.easeInOut(duration: 0.2), value: model.submitting)
        }
        .background(c.bg)
        // A non-wrapping marker, not the container itself — an identifier set directly on a
        // wrapping container leaks onto every descendant element in the XCUITest tree,
        // shadowing that container's own more-specific descendant identifiers (confirmed
        // empirically; see ContentView.swift's `shifts_screen` fix for the full explanation).
        .overlay(alignment: .topLeading) {
            Color.clear.frame(width: 1, height: 1).accessibilityIdentifier("login_screen")
        }
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
                .submitLabel(.go)
                .onSubmit { model.submit() }
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
        // A non-wrapping marker, not the container itself — an identifier set directly on a
        // wrapping container leaks onto every descendant element in the XCUITest tree,
        // shadowing that container's own more-specific descendant identifiers (confirmed
        // empirically; see ContentView.swift's `shifts_screen` fix for the full explanation).
        .overlay(alignment: .topLeading) {
            Color.clear.frame(width: 1, height: 1).accessibilityIdentifier("login_password")
        }
    }

    private func field(
        label: String, placeholder: String = "", icon: String, text: String, onChange: @escaping (String) -> Void,
        error: String?, warning: String? = nil, isFocused: Bool
    ) -> some View {
        let c = ShiftColors.resolve(scheme)
        return VStack(alignment: .leading, spacing: 7) {
            Text(label).font(ShiftFont.sans(12.5, .semibold)).foregroundColor(c.sec)
            HStack(spacing: 10) {
                Image(systemName: icon).font(.system(size: 18)).foregroundColor(c.ter)
                TextField(placeholder, text: Binding(get: { text }, set: onChange))
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
            } else if let warning {
                Text(warning).font(ShiftFont.sans(12.5)).foregroundColor(c.pending)
                    .accessibilityIdentifier("login_email_warning")
            }
        }
    }
}

/// The brand mark: the Penn crest, matching the web login mark (`Logo.tsx`) and the
/// mobile splash lockup.
///
/// `LoginMark` is generated by scripts/brand/build-icons.mjs from the same crest crop
/// as the AppIcon, the Android launcher icon and the web favicon, so this cannot drift
/// from them. The asset switches light/dark crop by appearance (see the imageset's
/// Contents.json), so no colour-scheme branch is needed here. 2026-07-29: supersedes
/// the geometry-derived chevron this surface held onto during the crest rebrand — see
/// docs/design/brand-source/README.md.
struct BrandMark: View {
    let size: CGFloat

    var body: some View {
        Image("LoginMark")
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}
