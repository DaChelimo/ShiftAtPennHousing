import SwiftUI
import Shared

/// T2-13 — routes a tapped float push / external `pennshift://float-ack/{id}` deep
/// link into the full-screen FloatAckSurface. AppDelegate (push tap) and onOpenURL
/// both write here; ShiftsRootView observes and presents.
@MainActor
final class DeepLinkRouter: ObservableObject {
    static let shared = DeepLinkRouter()
    @Published var floatAckId: String?
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
                    }
                }
        }
    }
}

/// Demo vs. live decision (mirrors Android `MainActivity`): no backend → demo shifts;
/// backend configured → the login/live path.
struct RootView: View {
    /// The in-app appearance override (System / Light / Dark). Applied here at the very
    /// top so it covers login, the loading restore, and the live/demo shifts UI alike.
    @StateObject private var theme = ThemeController.shared

    var body: some View {
        Group {
            if AppConfig.shared.supabaseUrl.isEmpty {
                ShiftsRootView()
            } else {
                LiveRootView()
            }
        }
        .preferredColorScheme(theme.preferredColorScheme)
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
                ShiftsRootView(onSignOut: {
                    Task { try? await WorkerBackend.shared.authGateway.signOut() }
                    login.authedSession = nil
                    // A sign-out forces LOGIN even though a session was restored at launch.
                    restored = .some(nil)
                }, liveUserId: session.userId)
                .id(clockEpoch)
            } else if restored == nil {
                LaunchRestoreView()
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

/// Brief launch-time loading state while the persisted session is restored (the iOS
/// analogue of Android's skeleton `LoadingScreen`).
private struct LaunchRestoreView: View {
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        let c = ShiftColors.resolve(scheme)
        return ZStack {
            c.bg.ignoresSafeArea()
            ProgressView()
        }
    }
}
