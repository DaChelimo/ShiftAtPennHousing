import SwiftUI
import Shared

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
        }
    }
}

/// Demo vs. live decision (mirrors Android `MainActivity`): no backend → demo shifts;
/// backend configured → the login/live path.
struct RootView: View {
    var body: some View {
        if AppConfig.shared.supabaseUrl.isEmpty {
            ShiftsRootView()
        } else {
            LiveRootView()
        }
    }
}

/// The backend-configured path: login until authenticated, then the shifts screen.
/// Launch-time session restore is a follow-up (mirrors the iOS data-layer TODO); a
/// fresh sign-in promotes to shifts, and Sign out returns here.
struct LiveRootView: View {
    @StateObject private var login = LoginObservable(gateway: WorkerBackend.shared.authGateway)

    var body: some View {
        if let session = login.authedSession {
            ShiftsRootView(onSignOut: {
                Task { try? await WorkerBackend.shared.authGateway.signOut() }
                login.authedSession = nil
            }, liveUserId: session.userId)
        } else {
            LoginScreen(model: login)
        }
    }
}
