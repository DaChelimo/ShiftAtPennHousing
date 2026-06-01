package com.pennhousing.shift.shared.platform

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.net.Uri

/**
 * Holds the application [Context] the platform hooks need. Set once from the
 * Android `Application`/`MainActivity` at start (application context — not an
 * Activity — so there is no leak).
 */
@SuppressLint("StaticFieldLeak")
object AndroidPlatform {
    @Volatile
    var appContext: Context? = null
}

/**
 * Android: POST the FCM registration token (acquired by `FirebaseMessaging` /
 * the app's `FirebaseMessagingService`) to the Edge Function (deliverable #6).
 */
actual fun registerPushToken(
    token: String,
    platform: String,
) {
    PushTokenRegistrar.enqueue(token, platform)
}

/** Android: open a `mailto:` URL with `Intent.ACTION_SENDTO` (deliverable #5). */
actual fun openMailto(url: String) {
    val ctx = AndroidPlatform.appContext ?: return
    val intent =
        Intent(Intent.ACTION_SENDTO, Uri.parse(url))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    runCatching { ctx.startActivity(intent) }
}
