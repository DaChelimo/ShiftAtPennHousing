import SwiftUI
import Shared

/// T2-13 — routes a tapped float push / external `pennshift://float-ack/{id}` deep
/// link into the full-screen FloatAckSurface. AppDelegate (push tap) and onOpenURL
/// both write here; ShiftsRootView observes and presents.
///
/// Widget tiles add tab routes (`pennshift://my-shifts`, `pennshift://open-shifts`,
/// `pennshift://updates`); `requestedRoute` carries those and ShiftsRootView reacts.
@MainActor
final class DeepLinkRouter: ObservableObject {
    static let shared = DeepLinkRouter()
    @Published var floatAckId: String?
    @Published var requestedRoute: WidgetRoute?
}

/// A tab destination a widget tile can open.
enum WidgetRoute: Equatable {
    case myShifts
    case openShifts(WidgetOpenScope)
    case updates
}

/// Parses the tab-routing widget deep links (the float-ack link is parsed Kotlin-side by
/// `parseFloatAckDeepLink`). Returns nil for anything else.
@MainActor
func parseWidgetRoute(uri: URL) -> WidgetRoute? {
    guard uri.scheme?.lowercased() == WidgetDeepLink.scheme else { return nil }
    switch uri.host?.lowercased() {
    case "my-shifts": return .myShifts
    case "updates": return .updates
    case "open-shifts":
        let raw = URLComponents(url: uri, resolvingAgainstBaseURL: false)?
            .queryItems?.first(where: { $0.name == "scope" })?.value
        let scope = raw.flatMap(WidgetOpenScope.init(rawValue:)) ?? .both
        return .openShifts(scope)
    default: return nil
    }
}

/// Phase 13a — iOS entry point.
///
/// Installs `AppDelegate` (push/APNs) and routes through `RootView`: with no backend
/// configured (the demo) it shows the worker Shifts screen directly; with a backend
/// (`AppConfig.supabaseUrl` set from Info.plist) it shows login, then shifts — the
/// iOS analogue of the Android `MainActivity` bootstrap.
@main
struct iOSApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        WindowGroup {
            RootView()
                .onOpenURL { url in
                    // T2-13 — external deep link into the full-screen ack.
                    if let id = parseFloatAckDeepLink(uri: url.absoluteString) {
                        DeepLinkRouter.shared.floatAckId = id
                    } else if let route = parseWidgetRoute(uri: url) {
                        // Widget tile → land on the relevant tab.
                        DeepLinkRouter.shared.requestedRoute = route
                    }
                }
        }
    }
}

/// Demo vs. live decision (mirrors Android `MainActivity`), owned by `ShiftConfig` and
/// driven by the `SHIFT_DATA_SOURCE` flag in `Configuration/Config.xcconfig`:
/// demo → bundled DemoData; live → the login/live path; misconfigured → a visible
/// error, so asking for live and getting demo can never happen silently.
struct RootView: View {
    /// The in-app appearance override (System / Light / Dark). Applied here at the very
    /// top so it covers login, the loading restore, and the live/demo shifts UI alike.
    @StateObject private var theme = ThemeController.shared

    var body: some View {
        Group {
            switch ShiftConfig.dataSource {
            case .demo:
                ShiftsRootView()
            case .live:
                LiveRootView()
            case .misconfigured(let reason):
                ConfigErrorView(reason: reason)
            }
        }
        .preferredColorScheme(theme.preferredColorScheme)
    }
}

/// Shown when the build asked for `SHIFT_DATA_SOURCE = live` but the backend config is
/// incomplete. A loud, specific failure beats the old silent demo fallback: that fallback
/// is what made the app look like it "randomly" signed in as the demo worker.
struct ConfigErrorView: View {
    let reason: String
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        return ZStack {
            c.bg.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 16) {
                Text("Backend not configured")
                    .font(.title2.bold())
                Text(reason)
                    .font(.body)
                Text("SHIFT_DATA_SOURCE is set to \"live\", so the app will not fall back to demo data. Fill in apps/mobile/iosApp/Configuration/Config.xcconfig and rebuild, or set SHIFT_DATA_SOURCE to \"demo\" there.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .padding(24)
        }
        .accessibilityIdentifier("config_error")
    }
}

/// The backend-configured path: on cold launch, restore any persisted Supabase
/// session (`SupabaseAuthGateway.currentSession()` → `loadFromStorage()` +
/// `awaitInitialization()`) and route straight to the shifts screen when it is still
/// valid — the iOS analogue of Android `MainActivity`'s `currentSession()` bootstrap.
/// While the (async) restore is in flight a loading view shows; with no/expired
/// session it falls through to login. A fresh sign-in promotes to shifts, and Sign out
/// returns here. The validity check reuses the shared, tested `SessionValidity` so the
/// restore decision is identical to Android's `AppBootstrap.decide`.
struct LiveRootView: View {
    @StateObject private var login = LoginObservable(gateway: WorkerBackend.shared.authGateway)
    /// nil while the launch restore runs; .some(session?) once it has resolved.
    @State private var restored: AuthSession?? = nil
    @Environment(\.scenePhase) private var scenePhase
    /// Bumped when a foreground re-sync finds the dev clock actually changed; `.id()`
    /// below then rebuilds the live tree so every ViewModel recaptures the fresh `now`.
    @State private var clockEpoch = 0

    var body: some View {
        Group {
            // An in-session sign-in (login.authedSession) takes precedence; otherwise
            // use the launch-restored session once the restore has resolved.
            if let session = login.authedSession ?? restored.flatMap({ $0 }) {
                // Staggered-launch gate: a worker whose home house is not live yet sees a
                // "coming soon" placeholder instead of the portal. GatedShiftsView resolves
                // the gate (fail-open) before rendering the live shifts tree.
                GatedShiftsView(
                    userId: session.userId,
                    // A sign-in the worker just performed explains its own wait; a cold launch
                    // with a restored session just keeps the splash silent.
                    signingIn: login.authedSession != nil,
                    onSignOut: {
                        Task { try? await WorkerBackend.shared.authGateway.signOut() }
                        // Forget the remembered app shape (docs/manager-app/SPEC.md §5.1).
                        // `resolveRoleShape`'s user-id check already stops the next signed-in
                        // person inheriting these tabs; this is belt and braces, and it also
                        // stops a signed-out device carrying a record of who last used it.
                        ManagerModePrefs.clear()
                        login.authedSession = nil
                        // A sign-out forces LOGIN even though a session was restored at launch.
                        restored = .some(nil)
                    })
                .id(clockEpoch)
            } else if restored == nil {
                // The session restore is the FIRST thing after the OS launch screen, so this
                // is the launch screen continued, not a spinner interrupting it.
                ShiftSplashView()
            } else {
                LoginScreen(model: login)
            }
        }
        .task {
            // Restore the persisted session exactly once on cold launch (mirrors
            // Android's `produceState { currentSession() }` + `AppBootstrap.decide`).
            // `restoreValidSession()` runs the shared `SessionValidity` gate Kotlin-side
            // and wires the worker JWT on success, so a valid restored session routes
            // straight to shifts and carries the bearer on every privileged read.
            guard restored == nil else { return }
            // Capture the dev sim-clock offset BEFORE building any live ViewModel, so the
            // app's `now` (sourced via DemoFactory.now() → SimClock) tracks the
            // time-travelled server clock. No-op at offset 0 (demo/production).
            _ = try? await WorkerBackend.shared.syncSimClock()
            let session = try? await WorkerBackend.shared.restoreValidSession()
            restored = .some(session)
        }
        .onChange(of: scenePhase) { phase in
            // Returning to the foreground: re-read the dev clock. If it actually moved
            // (a clock change made on the web), bump clockEpoch to rebuild the live tree
            // with the fresh `now` — no relaunch needed. No-op otherwise (incl. prod).
            guard phase == .active else { return }
            Task { @MainActor in
                if (try? await WorkerBackend.shared.syncSimClock()) == true {
                    clockEpoch += 1
                }
            }
        }
    }
}

/// Staggered-launch gate wrapper: resolve whether the signed-in worker's home house is
/// live before showing the shifts portal. While the (async) gate check runs a loading
/// view shows; a not-yet-live house shows the "coming soon" placeholder; a live house
/// falls through to the normal `ShiftsRootView`. The repo call fails OPEN, so a transient
/// error resolves to live rather than locking a real worker out.
struct GatedShiftsView: View {
    let userId: String
    /// True when this view was reached by a sign-in the worker just performed — the splash
    /// then names what it is waiting on instead of staying silent.
    var signingIn: Bool = false
    var onSignOut: () -> Void
    /// nil while the gate check runs; .some once resolved.
    @State private var gate: HomeHouseGate?

    var body: some View {
        Group {
            if let gate {
                if gate.isLive {
                    ShiftsRootView(onSignOut: onSignOut, liveUserId: userId, signingIn: signingIn)
                } else {
                    HouseNotLiveView(houseName: gate.houseName, onSignOut: onSignOut)
                }
            } else {
                ShiftSplashView(caption: signingIn ? "Signing you in" : nil)
            }
        }
        .task(id: userId) {
            gate = try? await WorkerBackend.shared.shiftsRepository.fetchHomeHouseGate(userId: userId)
            // Fail-open at the view layer too: an unreadable gate (nil) resolves to live so a
            // real worker is never stranded on the loading view by a transient error.
            if gate == nil {
                gate = HomeHouseGate(isLive: true, houseName: "your house")
            }
        }
    }
}

// The launch-time loading state is `ShiftSplashView` (SplashView.swift) — the OS launch
// screen continued. It replaced a bare `ProgressView` on a plain background, which made a
// cold launch read as: brand splash, stray spinner, then login.
