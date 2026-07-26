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
    /// DEBUG-only raw diagnostic behind `formError` (network/config detail); never shown in release.
    @Published var formErrorDetail: String?
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
        submitting = true
        formError = nil
        formErrorDetail = nil
        Task {
            do {
                // Switch on the gateway's classified outcome (like Android's LoginHost) so a
                // network/config failure is distinguishable from a wrong password. The success
                // case already carries the session, so no second currentSession() probe/race.
                let outcome = try await gateway.signIn(email: email, password: password)
                submitting = false
                switch onEnum(of: outcome) {
                case .success(let ok):
                    WorkerBackend.shared.wireAccessToken()
                    authedSession = ok.session
                case .failure(let fail):
                    formError = Self.message(for: fail.error)
                    formErrorDetail = fail.detail
                }
            } catch {
                // signIn only throws on cancellation; surface it as a transient network issue.
                submitting = false
                formError = "Network error. Check your connection and try again."
                formErrorDetail = "signIn threw: \(error.localizedDescription)"
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
                Text("Your schedule, floats and open shifts, for Residential Services staff.")
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

/// One chevron of the mark, drawn from `BrandMarkGeometry`. `holes` are the three
/// plates; they are cut with the even-odd rule so they show the ground through,
/// exactly as the SVG and Android vector drawable do.
private struct ChevronShape: Shape {
    let outline: [CGPoint]
    var holes: [CGPoint] = []
    /// Matches the `inset` the icon generator uses when centring the mark on a tile.
    let inset: CGFloat

    private func map(_ p: CGPoint, in rect: CGRect) -> CGPoint {
        let art = BrandMarkGeometry.artboard
        let b = BrandMarkGeometry.markBounds
        let x = p.x * inset + (art / 2 - b.midX * inset)
        let y = p.y * inset + (art / 2 - b.midY * inset)
        return CGPoint(x: rect.minX + x / art * rect.width,
                       y: rect.minY + y / art * rect.height)
    }

    func path(in rect: CGRect) -> Path {
        var path = Path()
        guard let first = outline.first else { return path }
        path.move(to: map(first, in: rect))
        for point in outline.dropFirst() { path.addLine(to: map(point, in: rect)) }
        path.closeSubpath()

        let r = BrandMarkGeometry.plateRadius * inset / BrandMarkGeometry.artboard * rect.width
        for hole in holes {
            let c = map(hole, in: rect)
            path.addEllipse(in: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2))
        }
        return path
    }
}

/// The brand mark: the chevronel on its paper ground.
///
/// The geometry comes from `BrandMarkGeometry.swift`, generated by
/// scripts/brand/build-icons.mjs from the same source as the AppIcon, the
/// Android launcher icon and the web favicon, so this cannot drift from them.
/// The mark carries its own ground, which is why it reads identically in light
/// and dark and needs no colour-scheme branch. See docs/design/logo.md.
struct BrandMark: View {
    let size: CGFloat
    private let inset: CGFloat = 0.94

    var body: some View {
        ZStack {
            Color(red: 244 / 255, green: 243 / 255, blue: 240 / 255)
            ChevronShape(outline: BrandMarkGeometry.upper, inset: inset)
                .fill(Color(red: 153 / 255, green: 0, blue: 0))
            ChevronShape(outline: BrandMarkGeometry.lower,
                         holes: BrandMarkGeometry.plates,
                         inset: inset)
                .fill(Color(red: 1 / 255, green: 31 / 255, blue: 91 / 255), style: FillStyle(eoFill: true))
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.2237, style: .continuous))
        .accessibilityHidden(true)
    }
}
