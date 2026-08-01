package com.pennhousing.shift.shared.notifications

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

/*
 * The in-app toast for a live `notifications` INSERT (§10.1, deliverable #7).
 *
 * Extracted out of WorkerShiftsRepository on 2026-07-29 (AGENTS §5.2 quarantine: that
 * file is a God class and must not grow). The mapping is PURE, so unlike the rest of the
 * repository's wire handling it is covered by kotlin.test.
 */

/** A new `notifications` row, mapped for the in-app toast. */
data class ToastNotification(
    val title: String,
    val body: String,
)

/**
 * Map a realtime `notifications` INSERT to a toast, or null when the row carries no
 * displayable copy.
 *
 * THE BUG THIS FIXES (found 2026-07-29). The realtime record is the ROW, whose columns
 * are `notification_id / recipient_user_id / type / delivered_at / scheduled_for /
 * payload / acknowledged_at`. There is no top-level `title` column and there never was:
 * every producer puts the copy inside `payload` (`process_broadcast_step`,
 * `notify_shift_opened`, the swap trigger, the float RPCs). The previous implementation
 * read `row["title"]`, so it returned null for EVERY notification and the toast never
 * fired once, on either platform.
 *
 * `payload` wins; the top-level lookup is kept as a fallback so a future flattened
 * producer, and the demo fixtures, still work.
 */
fun toastFromNotificationRow(row: JsonObject): ToastNotification? {
    val payload = row["payload"] as? JsonObject

    fun field(key: String): String? =
        (payload?.get(key) ?: row[key])?.jsonPrimitive?.content

    val title = field("title") ?: return null
    val body = field("body") ?: field("message") ?: ""
    return ToastNotification(title = title, body = body)
}
