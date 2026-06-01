package com.pennhousing.shift.shared.platform

/**
 * Phase 13a — platform-specific behavior the shared layer triggers but cannot
 * implement in commonMain (deliverable #5).
 *
 * - [registerPushToken]: POST a device push token to the `register-push-token`
 *   Edge Function (phase-12 `push_tokens`). Android passes its FCM registration
 *   token (platform = "android"); iOS passes its Firebase FCM token derived from
 *   the APNs token (platform = "ios"). Firebase routes both — `dispatch-push`
 *   does not branch on platform (AGENTS phase-12 note).
 * - [openMailto]: open a `mailto:` URL — the leave-request generator's output
 *   (phase-12 §"leave mailto generator"). Android uses `Intent.ACTION_SENDTO`;
 *   iOS uses `UIApplication.shared.open`.
 */
expect fun registerPushToken(
    token: String,
    platform: String,
)

expect fun openMailto(url: String)
