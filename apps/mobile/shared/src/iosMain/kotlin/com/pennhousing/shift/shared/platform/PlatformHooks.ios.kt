package com.pennhousing.shift.shared.platform

import platform.Foundation.NSURL
import platform.UIKit.UIApplication

/**
 * iOS: POST the Firebase FCM token (derived from the APNs token registered via
 * `UNUserNotificationCenter` / `didRegisterForRemoteNotificationsWithDeviceToken`)
 * to the Edge Function with platform = "ios" (deliverable #6). Firebase routes
 * APNs; `dispatch-push` does not branch on platform (AGENTS phase-12 note).
 */
actual fun registerPushToken(
    token: String,
    platform: String,
) {
    PushTokenRegistrar.enqueue(token, platform)
}

/** iOS: open a `mailto:` URL with `UIApplication.openURL` (deliverable #5). */
actual fun openMailto(url: String) {
    val nsUrl = NSURL.URLWithString(url) ?: return
    UIApplication.sharedApplication.openURL(nsUrl)
}

/** iOS: open an `https:` URL with `UIApplication.openURL` (the Settings legal links). */
actual fun openUrl(url: String) {
    val nsUrl = NSURL.URLWithString(url) ?: return
    UIApplication.sharedApplication.openURL(nsUrl)
}
