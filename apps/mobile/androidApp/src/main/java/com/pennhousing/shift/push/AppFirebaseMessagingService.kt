package com.pennhousing.shift.push

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.pennhousing.shift.MainActivity
import com.pennhousing.shift.R
import com.pennhousing.shift.shared.ack.floatAckDeepLink
import com.pennhousing.shift.shared.ack.pushDisplayFromData
import com.pennhousing.shift.shared.platform.registerPushToken

// Accent color per notification type, matching the house/urgency color used
// elsewhere in the app (schedule rails, badges). No large icon is set — the
// small icon + this accent color are the only branding, so a redesign never
// re-adds a right-side icon.
private val URGENT_TYPES = setOf("hmod_urgent", "allied_page")
private val OPEN_SHIFT_TYPES = setOf("broadcast")

private fun accentColorFor(type: String?): Int =
    when (type) {
        in URGENT_TYPES -> Color.parseColor("#E24B4A")
        in OPEN_SHIFT_TYPES -> Color.parseColor("#639922")
        else -> Color.parseColor("#378ADD")
    }

/**
 * Phase 13a — FCM service (deliverable #6) + T2-13 push routing.
 *
 * - [onNewToken]: a refreshed registration token → POST it to the Edge Function
 *   via the shared [registerPushToken] hook (`push_tokens`, phase-12).
 * - [onMessageReceived]: a delivered push → post a system notification on the
 *   app's channel. Personal notifications (your float) are §10.1-mandatory.
 *
 * T2-13: the phase-12 `dispatch-push` EF sends DATA-ONLY messages
 * (`{ notification_id, type, payload }` — no `notification` block), which the
 * previous handler silently dropped. Display now comes from the shared, tested
 * [pushDisplayFromData]; a `float_assigned` payload's tap intent deep-links to
 * `pennshift://float-ack/{floatId}` → MainActivity opens the FULL-SCREEN
 * FloatAckSurface. A notification-block message (e.g. console test sends) still
 * displays as before.
 */
class AppFirebaseMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        registerPushToken(token, "android")
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val manager = getSystemService(NotificationManager::class.java) ?: return

        // dispatch-push data shape; notification-block messages override title/body.
        val display = pushDisplayFromData(message.data["type"], message.data["payload"])
        val title = message.notification?.title ?: display.title
        val body = message.notification?.body ?: display.body

        val builder =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Notification.Builder(this, getString(R.string.default_notification_channel_id))
            } else {
                @Suppress("DEPRECATION")
                Notification.Builder(this)
            }
        builder
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(Notification.BigTextStyle().bigText(body))
            .setColor(accentColorFor(message.data["type"]))
            .setAutoCancel(true)
            .setContentIntent(contentIntent(display.floatId))

        manager.notify(message.messageId.hashCode(), builder.build())
    }

    /**
     * Tap target: the float-assignment push deep-links into the full-screen ack
     * (T2-13); any other push just opens the app.
     */
    private fun contentIntent(floatId: String?): PendingIntent {
        val intent =
            Intent(this, MainActivity::class.java).apply {
                if (floatId != null) {
                    action = Intent.ACTION_VIEW
                    data = Uri.parse(floatAckDeepLink(floatId))
                }
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
        return PendingIntent.getActivity(
            this,
            floatId?.hashCode() ?: 0,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }
}
