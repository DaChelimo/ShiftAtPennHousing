package com.pennhousing.shift.shared.ack

import com.pennhousing.shift.shared.model.PendingFloat
import com.pennhousing.shift.shared.shifts.NEW_YORK
import com.pennhousing.shift.shared.shifts.formatBlockTime
import com.pennhousing.shift.shared.shifts.formatDayLabel
import com.pennhousing.shift.shared.shifts.formatDuration
import com.pennhousing.shift.shared.shifts.formatTimeRange
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Instant

/*
 * Float-request carousel (§7.1) — PURE presentation logic for the prominent blue
 * card stack on My Shifts that lets a worker Accept/Decline each outstanding float
 * without digging through Updates. One card per pending float, SORTED closest-start
 * first (the soonest shift demands the soonest answer). Each card carries the full
 * destination window so it reads "18:00 – 20:00", not the demo-float "starts in 2h"
 * guess that the old worker_my_shifts lookup fell back to.
 *
 * No I/O, no system clock — `now` is injected (the load instant), matching every
 * other tested surface. Accept/Decline both reduce to "resolve" locally; the EF POST
 * (`acknowledge-float` / `decline-float`) is the host's, exactly like the ack hero.
 */

/** One fully-formatted carousel card — the UI renders these strings verbatim. */
data class FloatRequestCard(
    val floatId: String,
    val destinationName: String,
    /** "Today" or "Thu · Jun 25". */
    val whenLabel: String,
    /** "18:00 – 20:00" (NY, 24h, en dash). */
    val rangeLabel: String,
    /** "2h" / "2h 30m". */
    val durationLabel: String,
    /** "Starts in 2h" / "Starting now" / "Started". */
    val startsInLabel: String,
    /**
     * The time-to-RESPOND countdown — the headline number for a respondable card.
     * "Accept by 20:20 · 52m left" (deadline is T-10m before the float start, §7.1).
     * Null once the deadline has passed (the card then shows the reassignment note).
     */
    val acceptByLabel: String?,
    /** True within [ACK_URGENT_REMAINING_MINUTES] of the deadline — render emphasised. */
    val acceptUrgent: Boolean,
    /** Before the T-10m deadline — Accept/Decline are live. */
    val respondable: Boolean,
    /** At/after T-10m — the float is being reassigned; buttons are replaced by a note. */
    val deadlinePassed: Boolean,
)

/** Just the day portion of the float start: "Today" when it's today (NY), else "Thu · Jun 25". */
internal fun floatDayLabel(
    start: Instant,
    now: Instant,
    zone: TimeZone = NEW_YORK,
): String {
    val s = start.toLocalDateTime(zone)
    val n = now.toLocalDateTime(zone)
    return if (s.year == n.year && s.month == n.month && s.day == n.day) "Today" else formatDayLabel(start, zone)
}

/**
 * Map the worker's pending floats to carousel cards, SORTED by start ascending
 * (closest first). A float past its T-10m deadline still shows (so the worker knows
 * it was reassigned) but is not respondable.
 */
fun buildFloatRequestCards(
    floats: List<PendingFloat>,
    now: Instant,
    zone: TimeZone = NEW_YORK,
): List<FloatRequestCard> =
    floats
        .sortedBy { it.start }
        .map { f ->
            val passed = isPastAckDeadline(f.start, now)
            val deadline = ackDeadline(f.start)
            FloatRequestCard(
                floatId = f.floatId,
                destinationName = f.destinationHouse.name,
                whenLabel = floatDayLabel(f.start, now, zone),
                rangeLabel = formatTimeRange(f.start, f.end, zone),
                durationLabel = formatDuration(f.start, f.end),
                startsInLabel =
                    when {
                        f.start > now -> "Starts in ${formatDuration(now, f.start)}"
                        now < f.end -> "Starting now"
                        else -> "Started"
                    },
                acceptByLabel =
                    if (passed) {
                        null
                    } else {
                        val remaining = if (now < deadline) formatDuration(now, deadline) else "0m"
                        "Accept by ${formatBlockTime(deadline, zone)} · $remaining left"
                    },
                acceptUrgent = !passed && deadline - now <= ACK_URGENT_REMAINING_MINUTES.minutes,
                respondable = canRespondToFloat(f.start, now),
                deadlinePassed = passed,
            )
        }
