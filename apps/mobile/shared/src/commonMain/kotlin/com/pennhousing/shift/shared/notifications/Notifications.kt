package com.pennhousing.shift.shared.notifications

import com.pennhousing.shift.shared.shifts.DOW_SHORT
import com.pennhousing.shift.shared.shifts.NEW_YORK
import com.pennhousing.shift.shared.shifts.formatBlockTime
import com.pennhousing.shift.shared.shifts.formatDayLabel
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Duration.Companion.minutes
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

/** The `payload.kind` the float-lookup / force-trigger RPCs stamp on the float-assigned notification. */
const val PAYLOAD_KIND_FLOAT_ASSIGNED: String = "float_assigned"

/**
 * Map ONE `notifications` row (its `type`, `payload.kind`, `payload.float_id`, and any
 * payload title/body) into the displayable [NotificationItem]. PURE — the repository
 * extracts the wire fields and calls this so the float-linkage rule is tested once.
 *
 * The load-bearing case: a `personal_shift` row whose `payload.kind = 'float_assigned'`
 * (stamped by `process_float_lookup_assignment` AND `force_trigger_float`) is the
 * worker's pending-float entry. It maps to [NotificationCategory.FLOAT], is `urgent`,
 * and carries [NotificationItem.floatId] from `payload.float_id` — so its row's
 * `opensAck` is true and tapping it opens the §7 ack hero. (Backend follow-up: a
 * dedicated `notification_type` for floats would let `categoryForType` resolve this
 * without inspecting the payload; today the kind lives only in the JSON payload.)
 *
 * Any other row defers to [categoryForType] and carries no `floatId` (never opens the
 * hero). A `float_assigned` row missing `float_id` cannot open the hero, so it is
 * treated as a plain informational float entry (category FLOAT, not urgent, no link).
 */
fun notificationFromPayload(
    id: String,
    rawType: String,
    payloadKind: String?,
    floatId: String?,
    title: String?,
    body: String?,
    createdAt: Instant,
    unread: Boolean,
): NotificationItem {
    val isFloatAssigned = payloadKind == PAYLOAD_KIND_FLOAT_ASSIGNED
    val openable = isFloatAssigned && floatId != null
    return NotificationItem(
        id = id,
        category = if (isFloatAssigned) NotificationCategory.FLOAT else categoryForType(rawType),
        title = title ?: if (isFloatAssigned) "Float assignment" else "Notification",
        body = body ?: if (openable) "You've been floated. Tap to acknowledge." else "",
        createdAt = createdAt,
        unread = unread,
        urgent = openable,
        floatId = if (openable) floatId else null,
    )
}

/**
 * Ensure the worker's current pending float is reachable in the Updates feed.
 *
 * Belt-and-suspenders over [notificationFromPayload]: the float-lookup / force-trigger
 * RPCs insert a `float_assigned` notification row (the primary path), but the live ack
 * hero is driven by a SEPARATE `fetchPendingFloat` read. If that pending float is NOT
 * already represented by an openable row in [items] — e.g. push delivery lagged, or the
 * row was created before this linkage shipped — synthesize one urgent FLOAT entry so the
 * `pending_float_notification` row is always present and opens the §7 ack hero.
 *
 * [pendingFloatId]/[pendingFloatStart] come from the live `fetchPendingFloat` result
 * (null → nothing to add). The synthesized entry sorts by [pendingFloatStart] like any
 * other row; [buildUpdatesFeed] handles grouping. Idempotent: if an existing item
 * already carries [pendingFloatId], [items] is returned unchanged (no duplicate).
 */
fun withPendingFloatEntry(
    items: List<NotificationItem>,
    pendingFloatId: String?,
    pendingFloatStart: Instant?,
    destinationHouseName: String? = null,
): List<NotificationItem> {
    if (pendingFloatId == null) return items
    if (items.any { it.floatId == pendingFloatId }) return items
    val whereSuffix = destinationHouseName?.let { " to $it" } ?: ""
    return items +
        NotificationItem(
            id = "pending-float-$pendingFloatId",
            category = NotificationCategory.FLOAT,
            title = "Float assignment",
            body = "You've been floated$whereSuffix. Tap to acknowledge.",
            createdAt = pendingFloatStart ?: items.maxOfOrNull { it.createdAt } ?: return items,
            unread = true,
            urgent = true,
            floatId = pendingFloatId,
            floatStart = pendingFloatStart,
        )
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
    /** The pending float's start — drives the row's live ack countdown (D7). */
    val floatStart: Instant? = null,
    /**
     * Non-null → an INCOMING pending-swap MIRROR (DESIGN §6): the row deep-links into
     * the Swaps tab, where Accept / Decline live. Updates no longer renders swap actions
     * inline — this is just a discoverable pointer, like the pending-float entry.
     */
    val swapId: String? = null,
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
    /** D7 — "Respond by 16:52 · 1h 49m left" on the pending-float row; null otherwise. */
    val ackCountdownLabel: String? = null,
    /** Non-null → an incoming-swap mirror; tapping the row deep-links to the Swaps tab. */
    val swapId: String? = null,
    /** This row is the incoming-swap mirror (carries the `swap_request_notification` selector). */
    val opensSwaps: Boolean = false,
)

/**
 * D7 — the pending-float row's live ack countdown: the §7 deadline is T-10m
 * before the float start (phase-12 cadence). "Respond by HH:mm · Xh Ym left"
 * while open; "Ack window closed" past it; null when the row carries no float
 * start (e.g. a raw notification row whose payload has no start).
 */
fun ackCountdownLabel(
    floatId: String?,
    floatStart: Instant?,
    now: Instant,
    zone: TimeZone = NEW_YORK,
): String? {
    if (floatId == null || floatStart == null) return null
    val deadline = floatStart - 10.minutes
    if (now >= deadline) return "Ack window closed"
    val left = deadline - now
    val h = left.inWholeMinutes / 60
    val m = left.inWholeMinutes % 60
    val leftLabel = if (h > 0) "${h}h ${m}m left" else "${m}m left"
    return "Respond by ${formatBlockTime(deadline, zone)} · $leftLabel"
}

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
        ackCountdownLabel = ackCountdownLabel(floatId, floatStart, now, zone),
        swapId = swapId,
        opensSwaps = swapId != null,
    )

/**
 * One INCOMING pending swap aimed at this worker (§8.2) — the worker's own
 * `swap_requests` row (counterparty + status 'pending', own-row RLS), mapped for
 * the Updates feed. The initiator's identity is intentionally absent: `users` rows
 * are not cross-worker-readable (the §11.4 T3b privacy decision is still open).
 */
data class IncomingSwap(
    val swapId: String,
    /** `shift_swap` | `float_swap` | `permanent_swap` (the `swap_type_enum` value). */
    val swapType: String,
    val createdAt: Instant,
    val expiresAt: Instant,
)

private fun swapTypeLabel(swapType: String): String =
    when (swapType.lowercase()) {
        "shift_swap" -> "Shift swap"
        "float_swap" -> "Float swap"
        "permanent_swap" -> "Permanent swap"
        else -> "Swap"
    }

/**
 * Surface the worker's INCOMING pending swaps as deep-link MIRRORS in the Updates feed
 * (DESIGN §6 — the full Accept / Decline surface lives in the Swaps tab now). `create-swap`
 * inserts no counterparty notification row, so these entries are synthesized from the
 * worker's own `swap_requests` rows — the swaps analogue of [withPendingFloatEntry]. Each
 * entry is urgent, carries [NotificationItem.swapId] (so its row `opensSwaps` and tapping
 * it deep-links to Swaps → Incoming), and is one entry PER LEG (decision 2026-06-15).
 * Idempotent — a swap already represented in [items] (by `swapId`) is not duplicated.
 * Outgoing swaps are NOT mirrored here; they live only in the Swaps tab's Outgoing list.
 */
fun withIncomingSwapEntries(
    items: List<NotificationItem>,
    swaps: List<IncomingSwap>,
    zone: TimeZone = NEW_YORK,
): List<NotificationItem> {
    val represented = items.mapNotNull { it.swapId }.toSet()
    val entries =
        swaps
            .filter { it.swapId !in represented }
            .map { swap ->
                val expires = "${formatDayLabel(swap.expiresAt, zone)}, ${formatBlockTime(swap.expiresAt, zone)}"
                NotificationItem(
                    id = "incoming-swap-${swap.swapId}",
                    category = NotificationCategory.SWAP,
                    title = "Swap request — ${swapTypeLabel(swap.swapType)}",
                    body = "A housemate proposed a swap with you. Review it in Swaps. Expires $expires.",
                    createdAt = swap.createdAt,
                    unread = true,
                    urgent = true,
                    swapId = swap.swapId,
                )
            }
    return items + entries
}

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
