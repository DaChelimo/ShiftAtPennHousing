package com.pennhousing.shift.shared.notifications

import com.pennhousing.shift.shared.shifts.DOW_SHORT
import com.pennhousing.shift.shared.shifts.NEW_YORK
import com.pennhousing.shift.shared.shifts.formatBlockTime
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Instant

/*
 * Updates (§10.1 personal notifications + the §7 pending-float entry) — PURE
 * presentation logic for the notifications feed, the Updates analogue of the other
 * screens' presentation layers. Both front ends render this verbatim, so the
 * Today/Earlier grouping + NY-anchored relative time are tested once. No I/O, no
 * system clock — `now` is injected (the UI's load instant).
 *
 * The data is the worker's own `notifications` rows (RLS: select own). The
 * notification `type` (notification_type enum) maps to a display [NotificationCategory]
 * via [categoryForType] (best-effort — `personal_shift` is generic, so the live
 * float-vs-removed split needs the payload; the demo sets categories explicitly).
 * "Mark read" is NOT modelled here: workers have no UPDATE policy on `notifications`,
 * so the unread flag is read-only (derived from `acknowledged_at`).
 */

/** Display category — the UI maps each to a kit icon + state colour (never colour alone). */
enum class NotificationCategory { FLOAT, REMINDER, SHIFT_REMOVED, PERMANENT, PREFERENCES, SWAP, INFO }

/**
 * Best-effort map from a `notifications.type` value to a display category, for the
 * repository wiring. `personal_shift` is intentionally generic (its float / removal
 * meaning lives in the payload), so it falls through to [NotificationCategory.INFO].
 */
fun categoryForType(rawType: String): NotificationCategory =
    when (rawType.lowercase()) {
        "ack_reminder" -> NotificationCategory.REMINDER
        "swap_request" -> NotificationCategory.SWAP
        "sm_permanent_drop_alert", "sw_permanent_removal_alert" -> NotificationCategory.PERMANENT
        else -> NotificationCategory.INFO // broadcast, hm_leave_notice, hmod_urgent, personal_shift, unknown
    }

/** One notification the worker can see — a `notifications` row mapped to the app. */
data class NotificationItem(
    val id: String,
    val category: NotificationCategory,
    val title: String,
    val body: String,
    val createdAt: Instant,
    val unread: Boolean,
    val urgent: Boolean = false,
    /** Non-null → the actionable pending-float entry; tapping it opens the ack hero (§7). */
    val floatId: String? = null,
)

/** A fully-formatted Updates row — the UI renders this directly. */
data class NotificationRow(
    val id: String,
    val category: NotificationCategory,
    val title: String,
    val body: String,
    val timeLabel: String,
    val unread: Boolean,
    val urgent: Boolean,
    /** This row is the pending-float entry (carries the `pending_float_notification` selector). */
    val opensAck: Boolean,
)

/** "18:36" when the notification is from today (NY), else the short day-of-week ("Mon"). */
fun notificationTimeLabel(
    createdAt: Instant,
    now: Instant,
    zone: TimeZone = NEW_YORK,
): String =
    if (isSameNyDay(createdAt, now, zone)) {
        formatBlockTime(createdAt, zone)
    } else {
        DOW_SHORT[createdAt.toLocalDateTime(zone).dayOfWeek.ordinal]
    }

fun NotificationItem.toRow(
    now: Instant,
    zone: TimeZone = NEW_YORK,
): NotificationRow =
    NotificationRow(
        id = id,
        category = category,
        title = title,
        body = body,
        timeLabel = notificationTimeLabel(createdAt, now, zone),
        unread = unread,
        urgent = urgent,
        opensAck = floatId != null,
    )

/** The grouped Updates feed — Today and Earlier, each newest-first. */
data class UpdatesFeed(
    val today: List<NotificationRow>,
    val earlier: List<NotificationRow>,
) {
    val isEmpty: Boolean get() = today.isEmpty() && earlier.isEmpty()
    val unreadCount: Int get() = today.count { it.unread } + earlier.count { it.unread }
}

/**
 * Group [items] into Today (same NY calendar day as [now]) vs Earlier, each sorted
 * newest-first by `createdAt`. The client renders the matrix it is given; it does not
 * filter by recipient (RLS already scoped the rows to the worker).
 */
fun buildUpdatesFeed(
    items: List<NotificationItem>,
    now: Instant,
    zone: TimeZone = NEW_YORK,
): UpdatesFeed {
    val sorted = items.sortedByDescending { it.createdAt }
    val (todayItems, earlierItems) = sorted.partition { isSameNyDay(it.createdAt, now, zone) }
    return UpdatesFeed(
        today = todayItems.map { it.toRow(now, zone) },
        earlier = earlierItems.map { it.toRow(now, zone) },
    )
}

private fun isSameNyDay(
    a: Instant,
    b: Instant,
    zone: TimeZone,
): Boolean {
    val da = a.toLocalDateTime(zone)
    val db = b.toLocalDateTime(zone)
    return da.year == db.year && da.month == db.month && da.day == db.day
}
