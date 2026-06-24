package com.pennhousing.shift.shared.house

import com.pennhousing.shift.shared.calendar.weekDayIndexInWeekOf
import com.pennhousing.shift.shared.shifts.NEW_YORK
import com.pennhousing.shift.shared.shifts.formatDuration
import com.pennhousing.shift.shared.shifts.formatTimeRange
import kotlinx.datetime.TimeZone
import kotlin.time.Instant

/*
 * House schedule (§11.4, parity T3b) — PURE presentation logic for the house staffing
 * view: who covers each desk block this week, with the contact affordances the
 * full-directory ruling unlocked (worker name + phone via `worker_directory`, desk
 * phone via `houses.desk_phone`).
 *
 * The data is the `house_schedule_grid` read model: ONE ROW PER 30-MIN BLOCK SEAT
 * (invariant #5), RLS-scoped to the shown house. This layer places seats on the Mon–Sun
 * strip of a navigable [anchor] week and coalesces contiguous same-seat runs (same
 * worker — or the same vacancy — across adjacent blocks) into displayed roster ROWS,
 * mirroring the My-Shifts coalescing. The roster reads top-to-bottom as a readable list
 * of cards, NOT a cramped time grid. No I/O, no clock — `now` is injected (active flag).
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

/** The week's seats for one house, plus the contact surface (§11.4). */
data class HouseScheduleSnapshot(
    val houseName: String,
    val deskPhone: String?,
    val seats: List<HouseSeat>,
    /** The house this snapshot is for — the default selection + "your house" marker. */
    val houseId: String? = null,
)

/**
 * One pickable house for the House-tab switcher (2026-06-23 cross-house view ruling):
 * a worker may open any house's read-only schedule. Carries the desk phone so the
 * header's tap-to-call works without a per-house grid fetch.
 */
data class HouseOption(
    val id: String,
    val name: String,
    val deskPhone: String?,
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
    val pending: Boolean, // pending_float_in — floater not yet acknowledged
    val floatIn: Boolean, // floated_in / pending_float_in
    val mine: Boolean, // this is the signed-in worker (drives the subtle "You" treatment)
    val active: Boolean, // in progress at `now`
)

/** One day's roster (the selected day of the shown week). */
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
 * The selected day's roster (0=Mon..6=Sun of the [anchor] week): seats placed on the
 * strip, grouped per seat identity, contiguous runs merged (duration arithmetic on
 * instants — DST-safe, invariant #6), sorted by start then worker name so parallel
 * seats (headcount > 1) list deterministically. [now] drives the active flag and
 * defaults the [anchor]; pass a navigated-week anchor to read another week.
 *
 * A multi-staff house (Harnwell ×2, Quad ×3) can have SEVERAL seats sharing one key at
 * the SAME time (e.g. two empty desks). A single-pointer merge would interleave those
 * concurrent seats and shatter them into 30-min fragments, so within each key group we
 * assign seats to parallel TRACKS (a track extends only when its current end == the next
 * seat's start), yielding one clean contiguous run per concurrent seat — e.g. an
 * all-vacant 08:00–10:00 at Harnwell becomes TWO "Open" rows of 08:00–10:00, not eight
 * half-hour slivers. Filled groups (a worker can't double-book) degenerate to a single
 * contiguous run. [meUserId] marks the signed-in worker's own rows ("You").
 */
fun buildHouseDay(
    seats: List<HouseSeat>,
    selectedDayIndex: Int,
    now: Instant,
    meUserId: String? = null,
    anchor: Instant = now,
    zone: TimeZone = NEW_YORK,
): HouseDay {
    val daySeats = seats.filter { weekDayIndexInWeekOf(it.start, anchor, zone) == selectedDayIndex }
    val rows =
        daySeats
            .groupBy(::key)
            .values
            .flatMap { group ->
                val tracks = mutableListOf<MutableList<HouseSeat>>()
                val trackEnds = mutableListOf<Instant>()
                group.sortedBy { it.start }.forEach { seat ->
                    // Extend the first track that ends exactly where this seat starts; that track's
                    // end is bumped immediately, so a second concurrent seat at the same start can't
                    // re-grab it and instead opens its own parallel track.
                    val ti = trackEnds.indexOfFirst { it == seat.start }
                    if (ti >= 0) {
                        tracks[ti].add(seat)
                        trackEnds[ti] = seat.end
                    } else {
                        tracks.add(mutableListOf(seat))
                        trackEnds.add(seat.end)
                    }
                }
                tracks.map { run ->
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
                        mine = meUserId != null && !first.vacant && first.userId == meUserId,
                        active = now >= first.start && now < end,
                    )
                }
            }
            .sortedWith(compareBy({ it.start }, { it.workerName ?: "" }))
    return HouseDay(rows = rows)
}

/** The Mon–Sun indexes (of the [anchor] week) that have any seat — drives the strip dots. */
fun houseDaysWithSeats(
    seats: List<HouseSeat>,
    anchor: Instant,
    zone: TimeZone = NEW_YORK,
): Set<Int> = seats.mapNotNull { weekDayIndexInWeekOf(it.start, anchor, zone) }.toSet()
