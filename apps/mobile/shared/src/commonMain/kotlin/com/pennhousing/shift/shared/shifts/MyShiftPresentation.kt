package com.pennhousing.shift.shared.shifts

import com.pennhousing.shift.shared.model.AssignmentKind
import com.pennhousing.shift.shared.model.MyShift
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Instant

/*
 * My Shifts (§5.6 Tab 1) — PURE presentation logic shared by both platforms, so the
 * Compose/SwiftUI cards stay thin and the (DST-correct, NY-anchored) formatting is
 * tested once. No I/O, no system clock — instants carry their own moment.
 *
 * The card's visual STATE is independent of which subsection it sits in
 * ([classifyMyShift]): e.g. a FLOAT_OUT shift lives in the Scheduled subsection but
 * renders with the float-out treatment.
 */

/** The visual treatment a My-Shifts card renders — a subset of the full state legend. */
enum class MyShiftCardState {
    SCHEDULED,
    PICKUP_HOME,
    PICKUP_CROSS,
    FLOAT_OUT,
    PENDING_FLOAT,
    BREAK_SHIFT,
    DROPPED,
}

/**
 * Map a [MyShift] to its card treatment (priority: dropped → float → pickup →
 * break → scheduled). `pending` only escalates a float to PENDING_FLOAT (§11.2).
 */
fun myShiftCardState(shift: MyShift): MyShiftCardState =
    when {
        shift.droppedStillOpen -> MyShiftCardState.DROPPED
        shift.kind == AssignmentKind.FLOAT_OUT ->
            if (shift.pending) MyShiftCardState.PENDING_FLOAT else MyShiftCardState.FLOAT_OUT
        shift.kind == AssignmentKind.TEMP_PICKUP || shift.kind == AssignmentKind.PERMANENT_PICKUP ->
            if (shift.crossHouse) MyShiftCardState.PICKUP_CROSS else MyShiftCardState.PICKUP_HOME
        shift.breakShift -> MyShiftCardState.BREAK_SHIFT
        else -> MyShiftCardState.SCHEDULED
    }

internal val DOW_SHORT = listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
internal val DOW_LONG = listOf("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
internal val MONTH_SHORT =
    listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

private fun pad2(n: Int): String = if (n < 10) "0$n" else n.toString()

/** "HH:mm" in America/New_York (invariant #6). */
fun formatBlockTime(
    instant: Instant,
    zone: TimeZone = NEW_YORK,
): String {
    val ldt = instant.toLocalDateTime(zone)
    return pad2(ldt.hour) + ":" + pad2(ldt.minute)
}

/** "HH:mm - HH:mm" (hyphen separator; no em/en dashes in user-facing copy). */
fun formatTimeRange(
    start: Instant,
    end: Instant,
    zone: TimeZone = NEW_YORK,
): String = formatBlockTime(start, zone) + " - " + formatBlockTime(end, zone)

/** "Wed · Jun 3" — day-of-week + short month + day, NY-anchored. */
fun formatDayLabel(
    instant: Instant,
    zone: TimeZone = NEW_YORK,
): String {
    val ldt = instant.toLocalDateTime(zone)
    return DOW_SHORT[ldt.dayOfWeek.ordinal] + " · " + MONTH_SHORT[ldt.month.ordinal] + " " + ldt.day
}

/** "4h" / "2h 30m" / "30m" — duration arithmetic on instants (DST-safe). */
fun formatDuration(
    start: Instant,
    end: Instant,
): String {
    val mins = (end - start).inWholeMinutes
    val h = mins / 60
    val m = mins % 60
    return when {
        h > 0 && m > 0 -> "${h}h ${m}m"
        h > 0 -> "${h}h"
        else -> "${m}m"
    }
}

/** "14h" / "14.5h" — strips a whole-number decimal. */
fun formatHours(hours: Double): String = if (hours % 1.0 == 0.0) "${hours.toInt()}h" else "${hours}h"

/** The "This week, 14h of 20h soft cap" summary chip (§5.3 caps). */
data class WeeklyHoursSummary(
    val current: String,
    val capLabel: String,
)

/** [cap] is the SHOWN week's server cap, so the chip follows week navigation. */
fun weeklyHoursSummary(
    currentWeeklyHours: Double,
    cap: WeeklyCap = WeeklyCap.FALLBACK,
): WeeklyHoursSummary =
    WeeklyHoursSummary(
        current = formatHours(currentWeeklyHours),
        capLabel = "of ${cap.hoursLabel} ${cap.enforcementLabel}",
    )

/**
 * A fully-formatted My-Shifts card row — the UI renders this verbatim. Cross-house
 * / float shifts show the [destination] (the desk you're covering); home shifts show
 * the [houseName].
 */
data class MyShiftRow(
    val id: String,
    val state: MyShiftCardState,
    val houseInitial: String,
    val houseName: String?,
    val destination: String?,
    val timeLabel: String,
    val dayLabel: String,
    val durationLabel: String,
    // A drop or swap on this shift is in flight (shifts/PendingWrites.kt). The card stays
    // put and renders as busy, refusing a second action, until the server answers.
    val busy: Boolean = false,
    val busyLabel: String? = null,
    val busyNote: String? = null,
)

fun MyShift.toRow(zone: TimeZone = NEW_YORK): MyShiftRow {
    val state = myShiftCardState(this)
    val cross =
        state == MyShiftCardState.PICKUP_CROSS ||
            state == MyShiftCardState.FLOAT_OUT ||
            state == MyShiftCardState.PENDING_FLOAT
    return MyShiftRow(
        id = id,
        state = state,
        houseInitial = house.name.take(1),
        houseName = if (cross) null else house.name,
        destination = if (cross) house.name else null,
        timeLabel = formatTimeRange(start, end, zone),
        dayLabel = formatDayLabel(start, zone),
        durationLabel = formatDuration(start, end),
        busy = busyKind != null,
        busyLabel = busyKind?.let { pendingWriteLabel(it) },
        busyNote = busyKind?.let { pendingWriteNote(it) },
    )
}
