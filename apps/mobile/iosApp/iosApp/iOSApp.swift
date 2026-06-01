import SwiftUI

/// Phase 13a — iOS entry point.
///
/// Hosts the worker Shifts screen (`ShiftsRootView`) and installs `AppDelegate`,
/// which requests notification authorization, registers for APNs, and forwards
/// the Firebase FCM token to the shared `registerPushToken` hook (deliverable #6).
@main
struct iOSApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        WindowGroup {
            ShiftsRootView()
        }
    }
}
