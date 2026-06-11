package com.pennhousing.shift.shared.ack

import com.pennhousing.shift.shared.shifts.NEW_YORK
import com.pennhousing.shift.shared.shifts.formatBlockTime
import com.pennhousing.shift.shared.shifts.formatDayLabel
import com.pennhousing.shift.shared.shifts.formatDuration
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Instant

/*
 * Float Acknowledgment (§7.1 / §7.2) — PURE presentation logic for the ack hero,
 * the float-ack analogue of MyShiftPresentation / OpenShiftPresentation. Both front
 * ends render this verbatim, so the per-phase copy + the NY-anchored time/countdown
 * formatting are tested once. No I/O, no system clock — `now` is injected (the UI's
 * load instant), matching the snapshot ViewModel.
 *
 * The hero uses the FLOAT-OUT (purple) treatment in the UI — the worker is being
 * sent out to cover another desk; the icon/colour mapping is a rendering concern
 * derived from [AckPhase].
 */

/** Countdown turns urgent within this many minutes of the T-10m ack deadline. */
const val ACK_URGENT_REMAINING_MINUTES = 30

/** The fully-formatted float-ack hero — the UI renders these strings directly. */
data class FloatAckHero(
    val eyebrow: String,
    val headline: String,
    val whenLabel: String,
    val startsInLabel: String,
    /** Pending only: "Respond by 17:50 · 1h 50m left". Null in terminal phases. */
    val countdownLabel: String?,
    val countdownUrgent: Boolean,
    /** The terminal tail line (acked / declined / passed). Null while pending. */
    val statusLine: String?,
)

/**
 * §7.1 / §7.2 — map the ack state at an injected [now] to the hero's copy. Pending
 * shows the headline + a live-ish countdown to the T-10m deadline; the terminal
 * phases show a reassuring tail line. `floatStart`/`deadline` come straight from the
 * ViewModel state ([com.pennhousing.shift.shared.viewmodel.AckDeclineUiState]).
 */
fun floatAckHero(
    phase: AckPhase,
    destinationName: String,
    floatStart: Instant,
    deadline: Instant,
    now: Instant,
    zone: TimeZone = NEW_YORK,
): FloatAckHero {
    val eyebrow =
        when (phase) {
            AckPhase.PENDING -> "Float assignment"
            AckPhase.ACKNOWLEDGED -> "Acknowledged"
            AckPhase.DECLINED -> "Declined"
            AckPhase.DEADLINE_PASSED -> "Deadline passed"
        }
    val headline =
        when (phase) {
            AckPhase.PENDING -> "You're needed at $destinationName"
            AckPhase.ACKNOWLEDGED -> "You're covering $destinationName"
            AckPhase.DECLINED -> "No problem"
            AckPhase.DEADLINE_PASSED -> "Reassigned"
        }
    val countdownLabel =
        if (phase == AckPhase.PENDING) {
            val remaining = if (now < deadline) formatDuration(now, deadline) else "0m"
            "Respond by ${formatBlockTime(deadline, zone)} · $remaining left"
        } else {
            null
        }
    val statusLine =
        when (phase) {
            AckPhase.PENDING -> null
            AckPhase.ACKNOWLEDGED -> "Confirmed · read-only"
            AckPhase.DECLINED -> "We'll find another floater. You can still be reassigned."
            AckPhase.DEADLINE_PASSED -> "This float was reassigned to another worker."
        }
    return FloatAckHero(
        eyebrow = eyebrow,
        headline = headline,
        whenLabel = formatFloatWhen(floatStart, now, zone),
        startsInLabel = if (floatStart > now) formatDuration(now, floatStart) else "now",
        countdownLabel = countdownLabel,
        countdownUrgent = phase == AckPhase.PENDING && deadline - now <= ACK_URGENT_REMAINING_MINUTES.minutes,
        statusLine = statusLine,
    )
}

/** "Today · 18:00" when the float is today (NY), else "Thu · Jan 15 · 18:00". */
internal fun formatFloatWhen(
    floatStart: Instant,
    now: Instant,
    zone: TimeZone = NEW_YORK,
): String {
    val s = floatStart.toLocalDateTime(zone)
    val n = now.toLocalDateTime(zone)
    val day = if (s.year == n.year && s.month == n.month && s.day == n.day) "Today" else formatDayLabel(floatStart, zone)
    return "$day · ${formatBlockTime(floatStart, zone)}"
}
