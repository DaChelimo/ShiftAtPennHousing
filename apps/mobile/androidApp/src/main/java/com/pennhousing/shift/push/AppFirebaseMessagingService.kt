package com.pennhousing.shift.push

import android.app.Notification
import android.app.NotificationManager
import android.os.Build
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.pennhousing.shift.R
import com.pennhousing.shift.shared.platform.registerPushToken

/**
 * Phase 13a — FCM service (deliverable #6).
 *
 * - [onNewToken]: a refreshed registration token → POST it to the Edge Function
 *   via the shared [registerPushToken] hook (`push_tokens`, phase-12).
 * - [onMessageReceived]: a delivered push → post a system notification on the
 *   app's channel. Personal notifications (your float) are §10.1-mandatory.
 */
class AppFirebaseMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        registerPushToken(token, "android")
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val notification = message.notification ?: return
        val manager = getSystemService(NotificationManager::class.java) ?: return

        val builder =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Notification.Builder(this, getString(R.string.default_notification_channel_id))
            } else {
                @Suppress("DEPRECATION")
                Notification.Builder(this)
            }
        builder
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(notification.title ?: getString(R.string.app_name))
            .setContentText(notification.body.orEmpty())
            .setAutoCancel(true)

        manager.notify(message.messageId.hashCode(), builder.build())
    }
}
