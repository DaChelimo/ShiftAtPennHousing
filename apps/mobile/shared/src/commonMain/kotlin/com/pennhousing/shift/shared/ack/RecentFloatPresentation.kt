package com.pennhousing.shift.shared.ack

import com.pennhousing.shift.shared.model.PendingFloat
import com.pennhousing.shift.shared.model.RecentFloat
import com.pennhousing.shift.shared.model.RecentFloatStatus
import com.pennhousing.shift.shared.shifts.NEW_YORK
import com.pennhousing.shift.shared.shifts.formatDuration
import com.pennhousing.shift.shared.shifts.formatTimeRange
import kotlinx.datetime.TimeZone
import kotlin.time.Duration.Companion.hours
import kotlin.time.Instant

/*
 * "Recent float requests" — PURE presentation for the collapsible, de-emphasized history
 * section under the float-request carousel (§7.1/§7.2). The carousel holds only floats the
 * worker can still ACT on (respondable, before T-10m); once a float resolves it drops here
 * as a muted record, so it never lingers in the prominent zone with no way to dismiss it.
 *
 * Two sources, deduped by floatId:
 *   1. `RecentFloat` rows from the bounded `worker_recent_floats` view (acknowledged /
 *      declined / voided in the last 24h) — the authoritative resolved state.
 *   2. PENDING floats whose T-10m deadline has already passed but which the orchestrator
 *      has not yet voided. Synthesized as EXPIRED so a just-lapsed float is never invisible
 *      (in neither the carousel nor here) in the window between its deadline and its void.
 *
 * No I/O, no system clock — `now` is injected (the load instant), matching every other
 * tested surface. The section auto-ages: anything older than 24h is dropped (the view
 * already bounds its rows; this also bounds the synthesized pending ones).
 */

const val RECENT_FLOAT_WINDOW_HOURS = 24

/** One fully-formatted recent-float row — the UI renders these strings verbatim. */
data class RecentFloatRow(
    val floatId: String,
    /** "DuBois · 19:30 - 20:30" (NY, 24h). */
    val title: String,
    /** "Window passed · 8m ago" / "You declined · 3h ago" / "You're covering · 5h ago". */
    val detail: String,
    /** "Expired" / "Declined" / "Accepted". */
    val statusChip: String,
    val status: RecentFloatStatus,
)

/**
 * Build the recent-section rows from the resolved [recent] feed plus any past-deadline
 * [pending] floats (synthesized as EXPIRED), deduped by floatId (the resolved feed wins),
 * bounded to the last [RECENT_FLOAT_WINDOW_HOURS], sorted most-recent first.
 */
fun buildRecentFloatRows(
    recent: List<RecentFloat>,
    pending: List<PendingFloat>,
    now: Instant,
    zone: TimeZone = NEW_YORK,
): List<RecentFloatRow> {
    val resolvedIds = recent.mapTo(mutableSetOf()) { it.floatId }
    val synthesizedExpired =
        pending
            .filter { it.floatId !in resolvedIds && isPastAckDeadline(it.start, now) }
            .map {
                RecentFloat(
                    floatId = it.floatId,
                    destinationHouse = it.destinationHouse,
                    start = it.start,
                    end = it.end,
                    status = RecentFloatStatus.EXPIRED,
                    // It lapsed at its T-10m deadline; that is when it stopped being actionable.
                    resolvedAt = ackDeadline(it.start),
                )
            }

    val cutoff = now - RECENT_FLOAT_WINDOW_HOURS.hours
    return (recent + synthesizedExpired)
        .filter { it.resolvedAt >= cutoff }
        .sortedByDescending { it.resolvedAt }
        .map { it.toRow(now, zone) }
}

private fun RecentFloat.toRow(
    now: Instant,
    zone: TimeZone,
): RecentFloatRow {
    val reason =
        when (status) {
            RecentFloatStatus.ACCEPTED -> "You're covering"
            RecentFloatStatus.DECLINED -> "You declined"
            RecentFloatStatus.EXPIRED -> "Window passed"
        }
    val chip =
        when (status) {
            RecentFloatStatus.ACCEPTED -> "Accepted"
            RecentFloatStatus.DECLINED -> "Declined"
            RecentFloatStatus.EXPIRED -> "Expired"
        }
    return RecentFloatRow(
        floatId = floatId,
        title = "${destinationHouse.name} · ${formatTimeRange(start, end, zone)}",
        detail = "$reason · ${relativeAgo(resolvedAt, now)}",
        statusChip = chip,
        status = status,
    )
}

/** "just now" within a minute, else "8m ago" / "3h ago" (reuses the block-duration formatter). */
internal fun relativeAgo(
    past: Instant,
    now: Instant,
): String = if (now - past < 1.hours / 60) "just now" else "${formatDuration(past, now)} ago"
