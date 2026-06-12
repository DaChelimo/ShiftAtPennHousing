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
        #if canImport(FirebaseCore)
        FirebaseApp.configure()
        #endif

        // Supabase config from Info.plist (the iOS analogue of Android BuildConfig).
        if let url = Bundle.main.object(forInfoDictionaryKey: "SUPABASE_URL") as? String, !url.isEmpty {
            AppConfig.shared.supabaseUrl = url
        }
        if let key = Bundle.main.object(forInfoDictionaryKey: "SUPABASE_ANON_KEY") as? String, !key.isEmpty {
            AppConfig.shared.supabaseAnonKey = key
        }

        UNUserNotificationCenter.current().delegate = self
        #if canImport(FirebaseMessaging)
        Messaging.messaging().delegate = self
        #endif
        requestNotificationAuthorization(application)
        return true
    }

    private func requestNotificationAuthorization(_ application: UIApplication) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async { application.registerForRemoteNotifications() }
        }
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        #if canImport(FirebaseMessaging)
        Messaging.messaging().apnsToken = deviceToken
        Messaging.messaging().token { fcmToken, _ in
            if let fcmToken {
                PlatformHooksKt.registerPushToken(token: fcmToken, platform: "ios")
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
            appName: "Shift@PennHousing"
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
            PlatformHooksKt.registerPushToken(token: fcmToken, platform: "ios")
        }
    }
}
#endif
