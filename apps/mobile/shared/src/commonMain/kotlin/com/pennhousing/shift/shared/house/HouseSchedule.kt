package com.pennhousing.shift.shared.house

import com.pennhousing.shift.shared.calendar.weekDayIndexInWeekOf
import com.pennhousing.shift.shared.shifts.DOW_SHORT
import com.pennhousing.shift.shared.shifts.MONTH_SHORT
import com.pennhousing.shift.shared.shifts.NEW_YORK
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.TimeZone
import kotlinx.datetime.daysUntil
import kotlinx.datetime.minus
import kotlinx.datetime.plus
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Instant

/*
 * House schedule (§11.4, parity T3b) — PURE presentation logic for the worker's
 * home-house staffing view, rebuilt as an Excel-style WEEK GRID (design
 * `HouseScheduleScreen`): a fixed left time rail plus one column per Mon-Sun day,
 * each block positioned by its minute-of-day so a worker can read the whole week
 * at a glance — the thing SWs use the spreadsheet for: deciding what to drop and,
 * more often, who to swap with.
 *
 * The data is the `house_schedule_grid` read model: ONE ROW PER 30-MIN BLOCK
 * SEAT (invariant #5), RLS-scoped to the caller's home house. This layer places
 * seats on the Mon-Sun strip of a navigable [anchor] week, coalesces contiguous
 * same-seat runs (same worker — or the same vacancy — across adjacent blocks)
 * into displayed blocks, then assigns lanes so concurrent desks (Harnwell/Quad)
 * sit side by side. No I/O, no clock — `now` is injected (today/active flags).
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

/**
 * One positioned block in the grid — a coalesced run of same-seat blocks, placed
 * absolutely by [startMin]/[endMin] (minutes from that day's NY midnight; an end at
 * the next midnight is 1440 = "24:00") and assigned a [lane] within its day. The UI
 * lays out a rectangle from these numbers and the resolved strings/flags; it does no
 * time math of its own.
 */
data class HouseGridBlock(
    val id: String, // first seat's assignment_id (stable)
    val startMin: Int,
    val endMin: Int,
    val lane: Int,
    val timeLabel: String, // "14:00 - 18:00" (24:00 rendered for an end-of-day block)
    val workerLabel: String, // "You" / "Maya R." / "Open"
    val workerName: String?, // null → an open/vacant run
    val workerPhone: String?,
    val vacant: Boolean,
    val pending: Boolean,
    val floatIn: Boolean,
    val mine: Boolean, // this is the signed-in worker (drives the "You" treatment)
    val active: Boolean, // in progress at `now`
)

/** One day column: the Mon-Sun header + its lane-assigned blocks. */
data class HouseGridDay(
    val index: Int, // 0=Mon..6=Sun
    val dayLabel: String, // "Mon"
    val dateLabel: String, // "Jun 1"
    val isToday: Boolean,
    val laneCount: Int,
    val blocks: List<HouseGridBlock>,
) {
    val isEmpty: Boolean get() = blocks.isEmpty()
}

/**
 * The whole navigable week as a grid. [laneCount] is the week-wide max (so every day
 * column is the same width and the headers line up); [startHour]/[endHour] bound the
 * time rail (default 08:00-24:00, expanded to even hours if the data runs outside it).
 */
data class HouseGridWeek(
    val days: List<HouseGridDay>,
    val laneCount: Int,
    val startHour: Int,
    val endHour: Int,
) {
    val isEmpty: Boolean get() = days.all { it.isEmpty }
}

/** What two adjacent seats must share to be one displayed run. */
private data class SeatKey(
    val userId: String?,
    val vacant: Boolean,
    val pending: Boolean,
    val floatIn: Boolean,
)

private fun key(seat: HouseSeat) = SeatKey(seat.userId, seat.vacant, seat.pending, seat.floatIn)

private fun pad2(v: Int): String = if (v < 10) "0$v" else "$v"

/** "HH:mm" from a minute-of-day, rendering 1440 as "24:00" (the end-of-day block). */
private fun fmtMinOfDay(min: Int): String = pad2(min / 60) + ":" + pad2(min % 60)

private const val MIN_PER_DAY = 24 * 60

/**
 * Build the [anchor] week's house grid: seats placed on the Mon-Sun strip, contiguous
 * same-seat runs merged, lanes assigned so concurrent desks don't overlap. [meUserId]
 * (the signed-in worker) marks "You" blocks; placement uses [anchor]'s NY week while
 * today/active flags use [now], so a navigated week renders correctly with no "today".
 */
fun buildHouseGridWeek(
    seats: List<HouseSeat>,
    now: Instant,
    meUserId: String?,
    anchor: Instant = now,
    zone: TimeZone = NEW_YORK,
): HouseGridWeek {
    val today = now.toLocalDateTime(zone).date
    val anchorMonday = anchor.toLocalDateTime(zone).date.let { it.minus(it.dayOfWeek.ordinal, DateTimeUnit.DAY) }

    // Day index (0=Mon..6=Sun) within the anchor week → its coalesced, lane-assigned blocks.
    val byDay: Map<Int, List<HouseGridBlock>> =
        seats
            .groupBy { weekDayIndexInWeekOf(it.start, anchor, zone) }
            .filterKeys { it != null }
            .mapKeys { it.key!! }
            .mapValues { (_, daySeats) -> assignLanes(coalesce(daySeats, now, meUserId, zone)) }

    val days =
        (0 until 7).map { i ->
            val date = anchorMonday.plus(i, DateTimeUnit.DAY)
            val blocks = byDay[i].orEmpty()
            HouseGridDay(
                index = i,
                dayLabel = DOW_SHORT[i],
                dateLabel = "${MONTH_SHORT[date.month.ordinal]} ${date.day}",
                isToday = date == today,
                laneCount = (blocks.maxOfOrNull { it.lane + 1 } ?: 0).coerceAtLeast(1),
                blocks = blocks,
            )
        }

    val laneCount = days.maxOf { it.laneCount }.coerceAtLeast(1)
    val allBlocks = days.flatMap { it.blocks }
    val minStartHour = allBlocks.minOfOrNull { it.startMin / 60 } ?: 8
    val maxEndHour = allBlocks.maxOfOrNull { (it.endMin + 59) / 60 } ?: 24
    val startHour = evenFloor(minOf(8, minStartHour))
    val endHour = evenCeil(maxOf(24, maxEndHour))
    return HouseGridWeek(days = days, laneCount = laneCount, startHour = startHour, endHour = endHour)
}

/**
 * Coalesce a day's seats into displayed runs (no lane yet). Mirrors the My-Shifts coalescing,
 * but with one extra concern: a multi-staff house (Harnwell ×2, Quad ×3) can have SEVERAL
 * vacant seats at the SAME time when a slot is under-covered — all sharing the one "open" key.
 * A naive single-pointer merge interleaves those concurrent seats and shatters them into
 * 30-min fragments. So within each occupant group we assign seats to parallel TRACKS (a track
 * extends only when its current end == the next seat's start), yielding one clean contiguous
 * run per concurrent seat — e.g. an all-vacant 08:00-10:00 at Harnwell becomes TWO "Open"
 * blocks of 08:00-10:00, not eight half-hour slivers. Filled groups (a worker can't double-book)
 * have ≤1 seat per time, so they degenerate to the old contiguous-run behaviour.
 */
private fun coalesce(
    daySeats: List<HouseSeat>,
    now: Instant,
    meUserId: String?,
    zone: TimeZone,
): List<HouseGridBlock> =
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
                val startMin = minOfDay(first.start, zone)
                val endMin = minOfDay(end, zone, relativeTo = first.start)
                val mine = meUserId != null && !first.vacant && first.userId == meUserId
                HouseGridBlock(
                    id = first.id,
                    startMin = startMin,
                    endMin = endMin,
                    lane = 0,
                    timeLabel = "${fmtMinOfDay(startMin)} - ${fmtMinOfDay(endMin)}",
                    workerLabel =
                        when {
                            first.vacant -> "Open"
                            mine -> "You"
                            else -> first.workerName ?: "—"
                        },
                    workerName = first.workerName,
                    workerPhone = first.workerPhone,
                    vacant = first.vacant,
                    pending = first.pending,
                    floatIn = first.floatIn,
                    mine = mine,
                    active = now >= first.start && now < end,
                )
            }
        }

/**
 * Greedy interval-partition: sort by start, place each block in the first lane whose
 * last block has ended, else open a new lane. Minimal lanes, deterministic — handles
 * variable headcount (single desk, Harnwell ×2, Quad ×3) without hard-coding it.
 */
private fun assignLanes(blocks: List<HouseGridBlock>): List<HouseGridBlock> {
    val sorted = blocks.sortedWith(compareBy({ it.startMin }, { it.endMin }, { it.workerName ?: "" }))
    val laneEnds = mutableListOf<Int>() // each lane's current end minute
    return sorted.map { b ->
        val lane = laneEnds.indexOfFirst { it <= b.startMin }.let { if (it >= 0) it else laneEnds.size }
        if (lane < laneEnds.size) laneEnds[lane] = b.endMin else laneEnds.add(b.endMin)
        b.copy(lane = lane)
    }
}

private fun minOfDay(
    instant: Instant,
    zone: TimeZone,
    relativeTo: Instant? = null,
): Int {
    val ldt = instant.toLocalDateTime(zone)
    val min = ldt.hour * 60 + ldt.minute
    if (relativeTo == null) return min
    // Carry an end that lands on a later calendar day (an end-of-day 00:00 → 1440).
    val startDate = relativeTo.toLocalDateTime(zone).date
    val dayDiff: Int = startDate.daysUntil(ldt.date)
    return min + dayDiff * MIN_PER_DAY
}

private fun evenFloor(h: Int): Int = h - (h % 2)

private fun evenCeil(h: Int): Int = if (h % 2 == 0) h else h + 1
