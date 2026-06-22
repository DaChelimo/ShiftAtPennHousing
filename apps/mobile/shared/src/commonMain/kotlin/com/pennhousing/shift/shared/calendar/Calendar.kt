package com.pennhousing.shift.shared.calendar

import com.pennhousing.shift.shared.model.AssignmentKind
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.shifts.DOW_SHORT
import com.pennhousing.shift.shared.shifts.MONTH_SHORT
import com.pennhousing.shift.shared.shifts.MyShiftRow
import com.pennhousing.shift.shared.shifts.NEW_YORK
import com.pennhousing.shift.shared.shifts.coalesceMyShifts
import com.pennhousing.shift.shared.shifts.formatBlockTime
import com.pennhousing.shift.shared.shifts.toRow
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.LocalDate
import kotlinx.datetime.LocalDateTime
import kotlinx.datetime.LocalTime
import kotlinx.datetime.TimeZone
import kotlinx.datetime.minus
import kotlinx.datetime.plus
import kotlinx.datetime.toInstant
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Instant

/*
 * Personal Calendar (agenda-first) — PURE presentation logic over the worker's
 * EXISTING current-week shifts (`MyShift`, the same `worker_my_shifts` snapshot the
 * Shifts screen renders). DATA NOTE: only the current week is exposed (no date-param
 * view) and there is no recurring-template entity, so this builds a single-week
 * agenda — a Mon–Sun strip + a selected-day list with a live "now" line. Arbitrary
 * past/future weeks + the permanent-schedule view are intentionally absent (no data).
 *
 * No I/O, no system clock — `now` is injected. A shift is placed only if it actually
 * falls in [now]'s Mon–Sun week, so cross-week rows (which share a weekday) never
 * collide on the strip.
 */

const val DAYS_IN_WEEK = 7

/** One Mon–Sun strip cell. [closed] — the worker's home house is closed (§3.4/§11.3). */
data class WeekDayCell(
    val index: Int,
    val dayLetter: String,
    val dateLabel: String,
    val hasShifts: Boolean,
    val isToday: Boolean,
    val closed: Boolean = false,
)

data class CalendarWeek(
    val rangeLabel: String,
    val todayIndex: Int,
    val days: List<WeekDayCell>,
)

data class CalendarDayHeader(
    val title: String,
    val dateLabel: String,
    /** "2 shifts · 6h" — null when the day is empty. */
    val summary: String?,
    /** Home house closed this date (§3.4/§11.3) — the UI shows the "Closed" treatment. */
    val closed: Boolean = false,
)

/**
 * A pending-swap flag on an agenda card (lives in the calendar package to avoid a cycle
 * with `swaps/`): the swap id plus whether it's [incoming] (someone asked to swap with you
 * → tap opens the accept/decline popup) vs outgoing (a swap you proposed → just a marker).
 */
data class AgendaSwapMark(
    val swapId: String,
    val incoming: Boolean,
)

/**
 * One agenda row: a [shift] (with [active] = in progress) OR the now-line ([nowLabel]
 * non-null). [past] is true once the shift has fully ended (now >= end) so the UI can
 * render it inactive/greyed; future + in-progress shifts have past = false. [swap] is
 * non-null when this shift has a pending swap (see [AgendaSwapMark]).
 */
data class CalendarAgendaItem(
    val shift: MyShiftRow?,
    val active: Boolean,
    val nowLabel: String?,
    val past: Boolean = false,
    val swap: AgendaSwapMark? = null,
)

data class CalendarAgenda(
    val header: CalendarDayHeader,
    val items: List<CalendarAgendaItem>,
) {
    val isEmpty: Boolean get() = items.none { it.shift != null }
}

private fun mondayOf(
    now: Instant,
    zone: TimeZone,
): LocalDate {
    val date = now.toLocalDateTime(zone).date
    return date.minus(date.dayOfWeek.ordinal, DateTimeUnit.DAY)
}

/** The Mon–Sun index of a shift IFF it falls in [monday]'s week, else null (other week). */
private fun weekDayIndex(
    shift: MyShift,
    monday: LocalDate,
    zone: TimeZone,
): Int? = weekDayIndexOf(shift.start, monday, zone)

private fun weekDayIndexOf(
    start: Instant,
    monday: LocalDate,
    zone: TimeZone,
): Int? {
    val d = start.toLocalDateTime(zone).date
    val idx = d.dayOfWeek.ordinal
    return if (d == monday.plus(idx, DateTimeUnit.DAY)) idx else null
}

/**
 * The Mon–Sun index (0..6) of [start] IFF it falls in [now]'s NY week, else null —
 * the public form the house-schedule builders use to place seats on the strip.
 */
fun weekDayIndexInWeekOf(
    start: Instant,
    now: Instant,
    zone: TimeZone = NEW_YORK,
): Int? = weekDayIndexOf(start, mondayOf(now, zone), zone)

/**
 * The subset of [shifts] whose start falls in [anchor]'s NY Mon–Sun week — the
 * week-scoping the Shifts screen's My-Shifts tab applies so a future-week pickup
 * or drop shows under the week it actually belongs to (and not the current one).
 * DST-safe: the week boundary is derived from [anchor]'s LocalDate, not wall-clock
 * arithmetic (invariant #6). The underlying `worker_my_shifts` read is date-unbounded,
 * so other weeks' shifts are already in the snapshot.
 */
fun shiftsInWeekOf(
    shifts: List<MyShift>,
    anchor: Instant,
    zone: TimeZone = NEW_YORK,
): List<MyShift> {
    val monday = mondayOf(anchor, zone)
    return shifts.filter { weekDayIndexOf(it.start, monday, zone) != null }
}

/**
 * The Mon–Sun strip for [anchor]'s week (default: [now]'s — the current week),
 * with a dot on days that have shifts. [closedDayIndexes] (0=Mon..6=Sun) marks
 * dates the worker's HOME house is closed (§3.4/§11.3 — the backend
 * `house_closure` signal); the cells render the closed treatment. Cross-house
 * shifts on a closed home-house date still render.
 *
 * T3b-4 week navigation: a non-current-week [anchor] renders that week's strip;
 * `isToday` marks the cell whose DATE is [now]'s NY date (so no cell is "today"
 * on other weeks) and [CalendarWeek.todayIndex] is -1 there.
 */
fun buildCalendarWeek(
    shifts: List<MyShift>,
    now: Instant,
    zone: TimeZone = NEW_YORK,
    closedDayIndexes: Set<Int> = emptySet(),
    anchor: Instant = now,
): CalendarWeek {
    val monday = mondayOf(anchor, zone)
    val today = now.toLocalDateTime(zone).date
    val hasShifts = BooleanArray(DAYS_IN_WEEK)
    // Dropped-still-open blocks have left the worker's week (they live in the open feed
    // now), so they don't light a strip dot.
    shifts.filter { !it.droppedStillOpen }.forEach { s -> weekDayIndexOf(s.start, monday, zone)?.let { hasShifts[it] = true } }
    val days =
        (0 until DAYS_IN_WEEK).map { i ->
            val d = monday.plus(i, DateTimeUnit.DAY)
            WeekDayCell(
                index = i,
                dayLetter = DOW_SHORT[i].take(1),
                dateLabel = d.day.toString(),
                hasShifts = hasShifts[i],
                isToday = d == today,
                closed = i in closedDayIndexes,
            )
        }
    val sunday = monday.plus(6, DateTimeUnit.DAY)
    val range = "${MONTH_SHORT[monday.month.ordinal]} ${monday.day} – ${MONTH_SHORT[sunday.month.ordinal]} ${sunday.day}"
    return CalendarWeek(rangeLabel = range, todayIndex = days.indexOfFirst { it.isToday }, days = days)
}

/**
 * Move a week [anchor] by [weeks] whole weeks (T3b-4 navigation) — LocalDate
 * arithmetic, reconstructed at NOON local so a DST-transition midnight can never
 * skew which week the result lands in (invariant #6).
 */
fun shiftWeekAnchor(
    anchor: Instant,
    weeks: Int,
    zone: TimeZone = NEW_YORK,
): Instant {
    val date = anchor.toLocalDateTime(zone).date.plus(weeks * DAYS_IN_WEEK, DateTimeUnit.DAY)
    return LocalDateTime(date, LocalTime(12, 0)).toInstant(zone)
}

/**
 * The 7 ISO dates (yyyy-MM-dd, Mon..Sun) of [now]'s NY week — what the host hands
 * the `house_closure(p_house_id, p_on_date)` RPC for the visible strip.
 */
fun calendarWeekDates(
    now: Instant,
    zone: TimeZone = NEW_YORK,
): List<String> {
    val monday = mondayOf(now, zone)
    return (0 until DAYS_IN_WEEK).map { monday.plus(it, DateTimeUnit.DAY).toString() }
}

/**
 * The [Mon 00:00, next-Mon 00:00) instant bounds of [now]'s NY week — the range
 * the data layer queries for week-scoped reads (e.g. the §11.4 house grid).
 * Computed via LocalDate arithmetic then converted, so DST weeks bound correctly.
 */
fun calendarWeekBounds(
    now: Instant,
    zone: TimeZone = NEW_YORK,
): Pair<Instant, Instant> {
    val monday = mondayOf(now, zone)
    val nextMonday = monday.plus(DAYS_IN_WEEK, DateTimeUnit.DAY)
    return Pair(
        LocalDateTime(monday, LocalTime(0, 0)).toInstant(zone),
        LocalDateTime(nextMonday, LocalTime(0, 0)).toInstant(zone),
    )
}

/**
 * The agenda for the [selectedDayIndex] (0=Mon..6=Sun) of [now]'s week: the day's
 * shifts (sorted), the day header (+ "N shifts · total"), and — only when the
 * selected day is today — a "NOW · HH:mm" marker inserted before the first shift that
 * starts after `now` (or at the end), with the in-progress shift flagged [active].
 */
fun buildCalendarAgenda(
    shifts: List<MyShift>,
    selectedDayIndex: Int,
    now: Instant,
    zone: TimeZone = NEW_YORK,
    closedDayIndexes: Set<Int> = emptySet(),
    anchor: Instant = now,
    // assignment_id → pending-swap mark; a card is flagged when any of its blocks match.
    swapMarks: Map<String, AgendaSwapMark> = emptyMap(),
): CalendarAgenda {
    val monday = mondayOf(anchor, zone)
    val date = monday.plus(selectedDayIndex, DateTimeUnit.DAY)
    // "Today" is a DATE comparison (T3b-4): on a navigated week no day is today,
    // so the header shows the weekday and no NOW line is inserted.
    val isToday = date == now.toLocalDateTime(zone).date
    // Coalesce first: the live snapshot is one row per 30-min block, and the agenda
    // (like the Shifts tabs) shows one card per displayed shift, not per block. A
    // dropped-still-open shift is excluded — once dropped it's no longer the worker's
    // shift; it shows in the open feed for anyone (incl. the worker) to claim.
    val dayShifts =
        coalesceMyShifts(shifts)
            .filter { !it.droppedStillOpen }
            .filter { weekDayIndex(it, monday, zone) == selectedDayIndex }
            .sortedBy { it.start }

    val totalMinutes = dayShifts.sumOf { (it.end - it.start).inWholeMinutes }
    val summary =
        if (dayShifts.isEmpty()) {
            null
        } else {
            val n = dayShifts.size
            "$n shift${if (n > 1) "s" else ""} · ${formatHoursMinutes(totalMinutes)}"
        }
    val header =
        CalendarDayHeader(
            title = if (isToday) "Today" else DOW_SHORT[selectedDayIndex],
            dateLabel = "${MONTH_SHORT[date.month.ordinal]} ${date.day}",
            summary = summary,
            closed = selectedDayIndex in closedDayIndexes,
        )

    val nowLabel = "NOW · ${formatBlockTime(now, zone)}"
    val items = mutableListOf<CalendarAgendaItem>()
    var nowInserted = false
    dayShifts.forEach { s ->
        if (isToday && !nowInserted && s.start > now) {
            items.add(CalendarAgendaItem(shift = null, active = false, nowLabel = nowLabel))
            nowInserted = true
        }
        // A card carries the pending-swap mark of any of its blocks; prefer an INCOMING
        // mark (actionable — opens the popup) over an outgoing one when both touch it.
        val marks = s.blockIds.mapNotNull { swapMarks[it] }
        items.add(
            CalendarAgendaItem(
                shift = s.toRow(zone),
                active = now >= s.start && now < s.end,
                nowLabel = null,
                past = now >= s.end,
                swap = marks.firstOrNull { it.incoming } ?: marks.firstOrNull(),
            ),
        )
    }
    if (isToday && !nowInserted) {
        items.add(CalendarAgendaItem(shift = null, active = false, nowLabel = nowLabel))
    }
    return CalendarAgenda(header = header, items = items)
}

// ===================================================================
// Week overview — every Mon–Sun day's agenda at once (the DEFAULT calendar view, so
// the worker sees the whole week without tapping each day). A vertical list of day
// sections; the single-day agenda (above) is the per-day drill-in.
// ===================================================================

/** One day's section in the week overview: its header, agenda rows, and today-ness. */
data class CalendarDaySection(
    val dayIndex: Int, // 0=Mon..6=Sun
    val header: CalendarDayHeader,
    val items: List<CalendarAgendaItem>,
    val isToday: Boolean,
) {
    val isEmpty: Boolean get() = items.none { it.shift != null }
}

/** The whole week as stacked day sections (Mon..Sun). */
data class CalendarWeekOverview(
    val days: List<CalendarDaySection>,
)

/**
 * Build the week overview for [anchor]'s week: each Mon–Sun day's [buildCalendarAgenda]
 * wrapped as a [CalendarDaySection]. The "NOW" line is inserted only in today's section
 * (buildCalendarAgenda already gates it on the date), and only the current week has it at
 * all (a navigated [anchor] has no "today"). Reuses the per-day builder so the agenda
 * shape, coalescing, and now-line stay identical to the drill-in view.
 */
fun buildCalendarWeekOverview(
    shifts: List<MyShift>,
    now: Instant,
    zone: TimeZone = NEW_YORK,
    closedDayIndexes: Set<Int> = emptySet(),
    anchor: Instant = now,
    swapMarks: Map<String, AgendaSwapMark> = emptyMap(),
): CalendarWeekOverview {
    val monday = mondayOf(anchor, zone)
    val today = now.toLocalDateTime(zone).date
    val days =
        (0 until DAYS_IN_WEEK).map { i ->
            val agenda = buildCalendarAgenda(shifts, i, now, zone, closedDayIndexes, anchor, swapMarks)
            CalendarDaySection(
                dayIndex = i,
                header = agenda.header,
                items = agenda.items,
                isToday = monday.plus(i, DateTimeUnit.DAY) == today,
            )
        }
    return CalendarWeekOverview(days = days)
}

// ===================================================================
// Week picker + derived recurring template (D5).
// ===================================================================

/** One pickable week in the week-picker sheet. */
data class WeekOption(
    val offset: Int,
    val label: String, // "This week" / "Next week" / "Last week" / "In N weeks"
    val rangeLabel: String, // "Jun 8 – Jun 14"
)

/** The quick weeks the picker offers (design: last / this / next / +2 / +3). */
fun weekPickerOptions(
    now: Instant,
    zone: TimeZone = NEW_YORK,
    offsets: List<Int> = listOf(-1, 0, 1, 2, 3),
): List<WeekOption> =
    offsets.map { offset ->
        WeekOption(
            offset = offset,
            label =
                when {
                    offset == 0 -> "This week"
                    offset == 1 -> "Next week"
                    offset == -1 -> "Last week"
                    offset > 1 -> "In $offset weeks"
                    else -> "${-offset} weeks ago"
                },
            rangeLabel = buildCalendarWeek(emptyList(), now, zone, anchor = shiftWeekAnchor(now, offset, zone)).rangeLabel,
        )
    }

/**
 * One recurring slot of the DERIVED typical week (D5). No recurring-template
 * entity exists in the read model — `worker_my_shifts` materializes dated
 * blocks — so this is the union of the worker's SCHEDULED-kind (SM-built,
 * non-break) spans grouped by NY weekday + time + house, with [weeksSeen]
 * saying how many distinct weeks back the derivation. The UI labels it
 * honestly as derived.
 */
data class TemplateSlot(
    val dayIndex: Int, // 0=Mon..6=Sun
    val dayLabel: String, // "Mon"
    val timeLabel: String, // "14:00 – 18:00"
    val durationLabel: String,
    val houseName: String,
    val weeksSeen: Int,
)

fun buildTypicalWeek(
    shifts: List<MyShift>,
    zone: TimeZone = NEW_YORK,
): List<TemplateSlot> =
    coalesceMyShifts(shifts)
        .asSequence()
        .filter { it.kind == AssignmentKind.SCHEDULED && !it.breakShift && !it.droppedStillOpen }
        .groupBy { shift ->
            val local = shift.start.toLocalDateTime(zone)
            Triple(local.dayOfWeek.ordinal, formatBlockTime(shift.start, zone) + formatBlockTime(shift.end, zone), shift.house.id)
        }
        .values
        .map { group ->
            val first = group.minByOrNull { it.start }!!
            val weeks = group.map { mondayOf(it.start, zone) }.toSet().size
            TemplateSlot(
                dayIndex = first.start.toLocalDateTime(zone).date.dayOfWeek.ordinal,
                dayLabel = DOW_SHORT[first.start.toLocalDateTime(zone).date.dayOfWeek.ordinal],
                timeLabel = formatTimeRangeLabel(first, zone),
                durationLabel = formatHoursMinutes((first.end - first.start).inWholeMinutes),
                houseName = first.house.name,
                weeksSeen = weeks,
            )
        }
        .sortedWith(compareBy({ it.dayIndex }, { it.timeLabel }))

private fun formatTimeRangeLabel(
    shift: MyShift,
    zone: TimeZone,
): String = "${formatBlockTime(shift.start, zone)} – ${formatBlockTime(shift.end, zone)}"

/** "6h" / "6h 30m" / "30m" — a whole-day total from minutes. */
internal fun formatHoursMinutes(minutes: Long): String {
    val h = minutes / 60
    val m = minutes % 60
    return when {
        h > 0 && m > 0 -> "${h}h ${m}m"
        h > 0 -> "${h}h"
        else -> "${m}m"
    }
}
