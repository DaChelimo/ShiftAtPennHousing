package com.pennhousing.shift.shared.house

import com.pennhousing.shift.shared.calendar.weekDayIndexInWeekOf
import com.pennhousing.shift.shared.shifts.NEW_YORK
import com.pennhousing.shift.shared.shifts.formatDuration
import com.pennhousing.shift.shared.shifts.formatTimeRange
import kotlinx.datetime.TimeZone
import kotlin.time.Instant

/*
 * House schedule (§11.4, parity T3b) — PURE presentation logic for the worker's
 * home-house staffing view: who covers each desk block this week, with the
 * contact affordances the user's full-directory RLS ruling unlocked (worker
 * name + phone via `worker_directory`, desk phone via `houses.desk_phone`).
 *
 * The data is the `house_schedule_grid` read model: ONE ROW PER 30-MIN BLOCK
 * SEAT (invariant #5), RLS-scoped to the caller's home house. This layer places
 * seats on the Mon–Sun strip and coalesces contiguous same-seat runs (same
 * worker — or the same vacancy — across adjacent blocks) into displayed roster
 * rows, mirroring the My-Shifts coalescing. No I/O, no clock — `now` is injected.
 */

/** One 30-min seat from `house_schedule_grid` (wire row mapped by the repository). */
data class HouseSeat(
    val id: String, // assignment_id
    val start: Instant,
    val end: Instant,
    val vacant: Boolean,
    val pending: Boolean, // pending_float_in — floater not yet acknowledged
    val floatIn: Boolean, // floated_in / pending_float_in
    val userId: String?,
    val workerName: String?,
    val workerPhone: String?,
)

/** The week's grid for one house, plus the contact surface (§11.4). */
data class HouseScheduleSnapshot(
    val houseName: String,
    val deskPhone: String?,
    val seats: List<HouseSeat>,
)

/** One displayed roster row — a coalesced run of seats. The UI renders it verbatim. */
data class HouseRosterRow(
    val id: String, // first seat's assignment_id (stable)
    val start: Instant,
    val end: Instant,
    val timeLabel: String, // "14:00 – 18:00"
    val durationLabel: String, // "4h"
    val workerName: String?, // null → an open/vacant run
    val workerPhone: String?,
    val vacant: Boolean,
    val pending: Boolean,
    val floatIn: Boolean,
    val active: Boolean, // in progress at `now`
)

data class HouseDay(
    val rows: List<HouseRosterRow>,
) {
    val isEmpty: Boolean get() = rows.isEmpty()
}

/** What two adjacent seats must share to be one displayed roster run. */
private data class SeatKey(
    val userId: String?,
    val vacant: Boolean,
    val pending: Boolean,
    val floatIn: Boolean,
)

private fun key(seat: HouseSeat) = SeatKey(seat.userId, seat.vacant, seat.pending, seat.floatIn)

/**
 * The selected day's roster (0=Mon..6=Sun of [now]'s NY week): seats placed on the
 * strip, grouped per seat identity, contiguous runs merged (duration arithmetic on
 * instants — DST-safe, invariant #6), sorted by start then worker name so parallel
 * seats (headcount > 1) list deterministically.
 */
fun buildHouseDay(
    seats: List<HouseSeat>,
    selectedDayIndex: Int,
    now: Instant,
    zone: TimeZone = NEW_YORK,
): HouseDay {
    val daySeats = seats.filter { weekDayIndexInWeekOf(it.start, now, zone) == selectedDayIndex }
    val rows =
        daySeats
            .groupBy(::key)
            .values
            .flatMap { group ->
                val sorted = group.sortedBy { it.start }
                val runs = mutableListOf<MutableList<HouseSeat>>()
                var runEnd: Instant? = null
                for (seat in sorted) {
                    if (runEnd != null && seat.start == runEnd) runs.last().add(seat) else runs.add(mutableListOf(seat))
                    runEnd = seat.end
                }
                runs.map { run ->
                    val first = run.first()
                    val end = run.last().end
                    HouseRosterRow(
                        id = first.id,
                        start = first.start,
                        end = end,
                        timeLabel = formatTimeRange(first.start, end, zone),
                        durationLabel = formatDuration(first.start, end),
                        workerName = first.workerName,
                        workerPhone = first.workerPhone,
                        vacant = first.vacant,
                        pending = first.pending,
                        floatIn = first.floatIn,
                        active = now >= first.start && now < end,
                    )
                }
            }
            .sortedWith(compareBy({ it.start }, { it.workerName ?: "" }))
    return HouseDay(rows = rows)
}

/** The Mon–Sun indexes that have any seat — drives the strip dots. */
fun houseDaysWithSeats(
    seats: List<HouseSeat>,
    now: Instant,
    zone: TimeZone = NEW_YORK,
): Set<Int> = seats.mapNotNull { weekDayIndexInWeekOf(it.start, now, zone) }.toSet()
