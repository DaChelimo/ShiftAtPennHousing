package com.pennhousing.shift

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import com.google.firebase.messaging.FirebaseMessaging
import com.pennhousing.shift.shared.platform.AndroidPlatform
import com.pennhousing.shift.shared.platform.AppConfig
import com.pennhousing.shift.shared.platform.registerPushToken

/**
 * Phase 13a — Android entry point. Wires the shared platform hooks and config,
 * creates the notification channel (API 26+), and acquires + registers the FCM
 * token on launch (deliverable #6).
 *
 * FCM init is guarded: with no `google-services.json` (the non-deployed default,
 * per phase-12's "deployers configure Firebase" convention) `FirebaseMessaging`
 * has no default app, so the call throws and we simply skip registration. The app
 * otherwise runs fully on [com.pennhousing.shift.shared.samples.DemoData].
 */
class ShiftApp : Application() {
    override fun onCreate() {
        super.onCreate()

        AndroidPlatform.appContext = applicationContext
        AppConfig.supabaseUrl = BuildConfig.SUPABASE_URL
        AppConfig.supabaseAnonKey = BuildConfig.SUPABASE_ANON_KEY

        createNotificationChannel()
        registerFcmToken()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel =
                NotificationChannel(
                    getString(R.string.default_notification_channel_id),
                    getString(R.string.default_notification_channel_name),
                    NotificationManager.IMPORTANCE_HIGH,
                )
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun registerFcmToken() {
        runCatching {
            FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
                registerPushToken(token, "android")
            }
        }
    }
}
