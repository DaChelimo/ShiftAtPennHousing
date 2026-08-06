import UIKit
import UserNotifications
import Shared

// Firebase is added by the deployer via Swift Package Manager (see iosApp/README.md).
// Guarded with canImport so the app still builds before the package is added —
// the UI and APNs authorization work; only FCM-token forwarding is gated.
#if canImport(FirebaseCore)
import FirebaseCore
#endif
#if canImport(FirebaseMessaging)
import FirebaseMessaging
#endif

/// Phase 13a — push + APNs wiring (deliverable #6).
///
/// `UNUserNotificationCenter.requestAuthorization` → `registerForRemoteNotifications`
/// gets the APNs token; Firebase converts it to an FCM token (it routes both
/// FCM and APNs — `dispatch-push` does not branch on platform, AGENTS phase-12),
/// which is POSTed to `register-push-token` via the shared `registerPushToken`
/// hook with platform = "ios".
class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // Fixes the "white flash on launch" bug: the native UILaunchScreen (LaunchBackground
        // in Assets.xcassets) is drawn by the OS before this method even runs, and can only
        // ever resolve off the SYSTEM light/dark setting — it has no way to consult
        // UserDefaults. The handoff to SwiftUI is where an EXPLICIT in-app override used to
        // visibly flash: `.preferredColorScheme` on the root view sets the window's
        // `overrideUserInterfaceStyle`, but only once SwiftUI has mounted and laid out the
        // first view — one frame after the window's trait collection (and so
        // `@Environment(\.colorScheme)`) has already resolved with the default `.light`
        // value. Setting it here, via the `UIAppearance` proxy, applies to every `UIView`
        // (including the window) at CREATION time, so the very first SwiftUI frame already
        // carries the correct trait — no lag, no flash.
        //
        // Deliberately skipped for `.system` (nil): touching `overrideUserInterfaceStyle` at
        // all — even setting it to `.unspecified` — is a documented way to desync the window
        // from SwiftUI's own tracking of `.preferredColorScheme`, which silently breaks live
        // system Dark Mode tracking later (system chrome updates, app content does not; see
        // regression fixed 2026-08-01). System-choice users were never at risk of the launch
        // flash anyway — a freshly created window's untouched trait already matches system.
        if let style = ThemeChoice.fromPersisted(UserDefaults.standard.string(forKey: ThemeController.storageKey)).uiUserInterfaceStyle {
            UIView.appearance().overrideUserInterfaceStyle = style
        }

        #if canImport(FirebaseCore)
        FirebaseApp.configure()
        #endif

        // Resolve demo-vs-live and install the Supabase config from Info.plist (the iOS
        // analogue of Android BuildConfig). ShiftConfig owns the decision and is a lazy
        // `static let`, so touching it here just forces it early: whichever of this
        // method or the first SwiftUI body runs first gets the same answer.
        _ = ShiftConfig.dataSource

        UNUserNotificationCenter.current().delegate = self
        #if canImport(FirebaseMessaging)
        Messaging.messaging().delegate = self
        #endif
        // The notification authorization request is no longer fired cold at launch. It is
        // raised by the inline ask on My Shifts (see NotificationNudgeRow in Onboarding.swift
        // → NotificationAuthorizer.request), so the worker sees WHY alerts matter, on the
        // screen where it matters, before the one-shot OS dialog appears.
        //
        // Registering for REMOTE notifications is a different thing from ASKING for
        // permission, and Apple requires it on EVERY launch: APNs may issue a new device
        // token at any time (restore from backup, reinstall, OS update) and the system does
        // not persist it for us. It presents no UI, so it does not undo the deferred-ask
        // decision above.
        //
        // Before this call existed, `registerForRemoteNotifications()` was reachable ONLY
        // from the permission-granted callback inside NotificationAuthorizer.request(), and
        // that callback only runs while the status is `.notDetermined`. So the FIRST launch
        // after a grant worked and EVERY launch afterwards silently did not: no APNs token
        // arrived, Firebase never derived an FCM token, `didRegisterForRemoteNotifications`
        // never fired, and nothing was ever POSTed to `register-push-token`. Android was
        // unaffected because ShiftApp.onCreate fetches its FCM token unconditionally.
        NotificationAuthorizer.registerIfAlreadyAuthorized()
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        #if canImport(FirebaseMessaging)
        Messaging.messaging().apnsToken = deviceToken
        Messaging.messaging().token { fcmToken, _ in
            if let fcmToken {
                PlatformHooks_iosKt.registerPushToken(token: fcmToken, platform: "ios")
            }
        }
        #else
        // Firebase SDK not yet added via SPM (see iosApp/README.md). The FCM token —
        // not the raw APNs token — is what register-push-token expects (phase-12),
        // so nothing is POSTed until Firebase is wired.
        _ = deviceToken
        #endif
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // Best-effort: no APNs token in the simulator without a paid dev account.
    }

    // Show banners while the app is foregrounded (the in-app toast also surfaces
    // these via Realtime — see ShiftsRootView).
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }

    // T2-13 — a tapped push routes into the full-screen FloatAckSurface. The
    // phase-12 `dispatch-push` data shape is `{ notification_id, type, payload }`;
    // the shared, tested `pushDisplayFromData` extracts the float id (non-nil only
    // for a `float_assigned` payload).
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        let display = pushDisplayFromData(
            type: userInfo["type"] as? String,
            payloadJson: userInfo["payload"] as? String,
            appName: "SHIFT"
        )
        if let floatId = display.floatId {
            DispatchQueue.main.async { DeepLinkRouter.shared.floatAckId = floatId }
        }
        completionHandler()
    }
}

#if canImport(FirebaseMessaging)
extension AppDelegate: MessagingDelegate {
    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        if let fcmToken {
            PlatformHooks_iosKt.registerPushToken(token: fcmToken, platform: "ios")
        }
    }
}
#endif

/// The deferred notification-authorization entry point. Called from the priming card's
/// "Turn on alerts" button (Onboarding.swift), NOT at launch, so the worker sees the
/// rationale first. On grant it registers for remote notifications, which drives the
/// APNs → FCM token flow in `AppDelegate`.
enum NotificationAuthorizer {
    /// Fire the real OS notification permission dialog.
    static func request() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
        }
    }

    /// Re-register with APNs when the worker has ALREADY granted permission, which is the
    /// case on every launch after the one where they granted it. Presents no UI and never
    /// prompts: `registerForRemoteNotifications()` only asks APNs for a device token, and
    /// the OS dialog is governed solely by `requestAuthorization` above.
    ///
    /// `.provisional` and `.ephemeral` deliver notifications too, so they register as well,
    /// matching how `NotificationNudgeObservable.refresh()` treats them as granted.
    static func registerIfAlreadyAuthorized() {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
            default:
                break
            }
        }
    }
}
