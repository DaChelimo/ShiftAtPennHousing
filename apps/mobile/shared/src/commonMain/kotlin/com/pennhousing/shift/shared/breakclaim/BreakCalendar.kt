package com.pennhousing.shift.shared.breakclaim

import com.pennhousing.shift.shared.calendar.weekDayIndexInWeekOf
import com.pennhousing.shift.shared.shifts.BLOCK
import com.pennhousing.shift.shared.shifts.BREAK_HOURS_CAP
import com.pennhousing.shift.shared.shifts.DOW_SHORT
import com.pennhousing.shift.shared.shifts.MONTH_SHORT
import com.pennhousing.shift.shared.shifts.NEW_YORK
import com.pennhousing.shift.shared.shifts.formatBlockTime
import com.pennhousing.shift.shared.shifts.formatDuration
import com.pennhousing.shift.shared.shifts.formatHours
import com.pennhousing.shift.shared.shifts.formatTimeRange
import com.pennhousing.shift.shared.shifts.hoursBetween
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.minus
import kotlinx.datetime.plus
import kotlinx.datetime.toLocalDateTime
import kotlin.math.abs
import kotlin.time.Instant

/*
 * Break CALENDAR picker (Break redesign B2) — PURE, deterministic presentation logic
 * shared by both platforms. This is the spatial replacement for the flat break-shift
 * list: the break period is rendered like the house schedule (§11.4) — a day's blocks
 * with per-block coverage and read-only occupied cards — and during the claim window the
 * remaining capacity is DRAG-CLAIMABLE.
 *
 * The read model is `house_schedule_grid` scoped to the break window (migration
 * 20260615000001 added block_id + required_headcount). Each row is one 30-min SEAT;
 * grouping by block gives coverage (filled / required). The drag is "system-assigned
 * lane" (BSpec §4.4): the worker picks a TIME range and the system fills one open seat
 * per block; FCFS / cap conflicts TRIM the claim to the still-open part and report it.
 * That trim/coverage behavior is what the kotlin.test suite pins.
 *
 * No I/O, no system clock — `now`/`me`/`phase` are injected; the seats are the only data.
 */

/** The break claim lifecycle (mirrors the SQL `break_claim_phase`). */
enum class BreakPhase {
    /** Before T-14d — the calendar isn't open yet. */
    PRE_OPEN,

    /** T-14d → T-1d — round 1: drag-to-claim is live. */
    CLAIM_WINDOW,

    /** After T-1d — round 2: leftovers are now ordinary open shifts; calendar is read-only. */
    OPEN_FEED,
    ;

    val isClaimable: Boolean get() = this == CLAIM_WINDOW

    companion object {
        fun fromWire(value: String?): BreakPhase =
            when (value?.lowercase()) {
                "claim_window" -> CLAIM_WINDOW
                "open_feed" -> OPEN_FEED
                else -> PRE_OPEN
            }
    }
}

/** One 30-min break SEAT (a `house_schedule_grid` row scoped to the break window). */
data class BreakCalendarSeat(
    val id: String, // assignment_id
    val blockId: String,
    val start: Instant,
    val end: Instant,
    val status: String, // "vacant" | "scheduled" | "claimed" | "floated_in" | "pending_float_in"
    val requiredHeadcount: Int,
    val userId: String? = null,
    val workerName: String? = null,
) {
    val vacant: Boolean get() = status.equals("vacant", ignoreCase = true)
}

/**
 * The injected break-calendar state. [seats] is every seat the worker may see for the
 * break window at their house (vacant + occupied), RLS-scoped server-side. [meUserId]
 * identifies the worker so their own seats render droppable. [windowStart]/[windowEnd]
 * are the inclusive NY calendar dates of the break.
 */
data class BreakCalendarSnapshot(
    val houseName: String,
    val breakName: String,
    val phase: BreakPhase,
    val meUserId: String?,
    val seats: List<BreakCalendarSeat>,
    val windowStart: LocalDate,
    val windowEnd: LocalDate,
    val cap: Double = BREAK_HOURS_CAP,
    // True only on the LIVE build when no break is currently scheduled — the screen shows an
    // honest "no break" state instead of a (fake, non-claimable) demo calendar. Claiming is
    // impossible here, which is exactly the point: a live build must never present a
    // claimable calendar that silently fails to save.
    val noActiveBreak: Boolean = false,
) {
    /** The worker's currently-held break hours (their occupied seats in the window). */
    fun claimedHours(): Double =
        seats.filter { it.userId == meUserId && meUserId != null && !it.vacant }
            .sumOf { hoursBetween(it.start, it.end) }
}

/**
 * The "no break is scheduled" snapshot the LIVE build uses when [fetchActiveBreak] /
 * [fetchBreakCalendar] resolve to nothing — the honest replacement for the demo calendar
 * (which has fake, non-UUID block ids that the backend rejects). `now` supplied here so the
 * host need not name kotlinx-datetime types across the bridge.
 */
fun noBreakCalendar(
    meUserId: String?,
    now: Instant,
    zone: TimeZone = NEW_YORK,
): BreakCalendarSnapshot {
    val today = now.toLocalDateTime(zone).date
    return BreakCalendarSnapshot(
        houseName = "",
        breakName = "",
        phase = BreakPhase.PRE_OPEN,
        meUserId = meUserId,
        seats = emptyList(),
        windowStart = today,
        windowEnd = today,
        noActiveBreak = true,
    )
}

// ===================================================================
// Per-block coverage.
// ===================================================================

/** One lane (desk) of a block: its occupant (read-only / mine) or open capacity. */
data class BreakLaneCell(
    val seatId: String?, // present for an occupied seat (a drop targets it)
    val workerName: String?, // occupant name, or null when open
    val mine: Boolean,
    val open: Boolean,
)

/** Coverage of one 30-min block: how many of [requiredHeadcount] seats are filled. */
data class BreakBlockCoverage(
    val blockId: String,
    val start: Instant,
    val end: Instant,
    val startLabel: String, // NY-anchored "HH:mm" (the front ends never call a formatter)
    val requiredHeadcount: Int,
    val filled: Int,
    val mineHere: Boolean, // the worker already holds a seat on this block
    val openSeatIds: List<String>, // the vacant seat ids on this block
    val lanes: List<BreakLaneCell> = emptyList(), // occupied-first, then open, padded to required
) {
    /** Open capacity = required − filled (never negative). */
    val open: Int get() = (requiredHeadcount - filled).coerceAtLeast(0)
    val full: Boolean get() = open == 0

    /** True on the hour (":00") — the front ends draw the gutter label there. */
    val isHourStart: Boolean get() = startLabel.endsWith(":00")

    /** "1 / 2" coverage label (filled of required). */
    val coverageLabel: String get() = "$filled / $requiredHeadcount"

    /**
     * The lane index to HIGHLIGHT for a drag whose finger is over [preferredColumn]
     * (0-based) — the open seat nearest the finger, or null when the block is full.
     * Occupied seats are left-packed, so a half-full block highlights its (right-side) open
     * seat regardless of finger column; a fully-open block highlights the column under the
     * finger. The actual seat stays system-assigned — this is the drag PREVIEW only.
     */
    fun highlightLane(preferredColumn: Int): Int? {
        val vacant = lanes.indices.filter { lanes[it].open }
        if (vacant.isEmpty()) return null
        return vacant.minByOrNull { abs(it - preferredColumn) }
    }
}

/** Group a day's seats into per-block coverage, sorted by start. */
fun buildBreakCoverage(
    seats: List<BreakCalendarSeat>,
    meUserId: String?,
): List<BreakBlockCoverage> =
    seats
        .groupBy { it.blockId }
        .map { (blockId, group) ->
            val first = group.minByOrNull { it.start }!!
            val required = group.maxOf { it.requiredHeadcount }
            val occupied =
                group.filter { !it.vacant }
                    .sortedBy { it.workerName ?: "" }
                    .map { BreakLaneCell(it.id, it.workerName, it.userId != null && it.userId == meUserId, open = false) }
            val openCount = (required - occupied.size).coerceAtLeast(0)
            val open = List(openCount) { BreakLaneCell(seatId = null, workerName = null, mine = false, open = true) }
            BreakBlockCoverage(
                blockId = blockId,
                start = first.start,
                end = first.end,
                startLabel = formatBlockTime(first.start),
                requiredHeadcount = required,
                filled = occupied.size,
                mineHere = occupied.any { it.mine },
                openSeatIds = group.filter { it.vacant }.map { it.id },
                lanes = occupied + open,
            )
        }
        .sortedBy { it.start }

// ===================================================================
// Day model + week navigation across the break window.
// ===================================================================

/** A single day of the break calendar: its blocks (coverage) and occupied roster runs. */
data class BreakCalendarDay(
    val dayIndex: Int, // 0=Mon..6=Sun within the shown week
    val date: LocalDate,
    val inWindow: Boolean, // the date is inside the break window
    val blocks: List<BreakBlockCoverage>,
    val roster: List<BreakRosterRun>, // coalesced occupied runs (read-only cards + my droppables)
) {
    val isEmpty: Boolean get() = blocks.isEmpty()
}

/** A coalesced run of occupied seats — a read-only name card, or (if [mine]) a droppable one. */
data class BreakRosterRun(
    val id: String, // first seat's assignment_id
    val start: Instant,
    val end: Instant,
    val timeLabel: String,
    val durationLabel: String,
    val workerName: String?,
    val mine: Boolean,
    val seatIds: List<String>, // every constituent seat (a drop targets all of them)
)

private fun mondayOf(
    date: LocalDate,
): LocalDate = date.minus(date.dayOfWeek.ordinal, DateTimeUnit.DAY)

/**
 * The Monday of every NY week that intersects the break window — the weeks the UI lets
 * the worker page through (winter break spans ~3). Always at least one.
 */
fun breakWeeks(
    windowStart: LocalDate,
    windowEnd: LocalDate,
): List<LocalDate> {
    val firstMonday = mondayOf(windowStart)
    val lastMonday = mondayOf(windowEnd)
    val weeks = mutableListOf<LocalDate>()
    var m = firstMonday
    while (m <= lastMonday) {
        weeks.add(m)
        m = m.plus(7, DateTimeUnit.DAY)
    }
    return weeks
}

/** "Nov 21 – Nov 25" — the inclusive break window label. */
fun breakWindowLabel(
    windowStart: LocalDate,
    windowEnd: LocalDate,
): String = "${monthDayOf(windowStart)} - ${monthDayOf(windowEnd)}"

/** "Nov 19 – Nov 25" — the Mon–Sun range of the week anchored at [weekMonday]. */
fun breakWeekRangeLabel(weekMonday: LocalDate): String =
    "${monthDayOf(weekMonday)} - ${monthDayOf(weekMonday.plus(6, DateTimeUnit.DAY))}"

private fun monthDayOf(date: LocalDate): String = "${MONTH_SHORT[date.month.ordinal]} ${date.day}"

/** The strip cell for a calendar day in the break picker. */
data class BreakWeekCell(
    val index: Int, // 0=Mon..6=Sun
    val dayLetter: String,
    val dateLabel: String,
    val inWindow: Boolean, // inside the break → claimable; outside → dimmed
    val hasSeats: Boolean,
    val isToday: Boolean,
)

/** The Mon–Sun strip for the week anchored at [weekMonday]. */
fun breakWeekStrip(
    snapshot: BreakCalendarSnapshot,
    weekMonday: LocalDate,
    now: Instant,
    zone: TimeZone = NEW_YORK,
): List<BreakWeekCell> {
    val today = now.toLocalDateTime(zone).date
    val seatDays = snapshot.seats.map { it.start.toLocalDateTime(zone).date }.toSet()
    return (0 until 7).map { i ->
        val d = weekMonday.plus(i, DateTimeUnit.DAY)
        BreakWeekCell(
            index = i,
            dayLetter = DOW_SHORT[i].take(1),
            dateLabel = d.day.toString(),
            inWindow = d in snapshot.windowStart..snapshot.windowEnd,
            hasSeats = d in seatDays,
            isToday = d == today,
        )
    }
}

/**
 * Build the calendar for the day at [weekMonday] + [selectedDayIndex] (0=Mon..6=Sun):
 * per-block coverage + the coalesced occupied roster runs (read-only others + droppable
 * mine). Seats are placed by their NY date so cross-week break dates never collide.
 */
fun buildBreakCalendarDay(
    snapshot: BreakCalendarSnapshot,
    weekMonday: LocalDate,
    selectedDayIndex: Int,
    now: Instant = Instant.fromEpochSeconds(0),
    zone: TimeZone = NEW_YORK,
): BreakCalendarDay {
    val date = weekMonday.plus(selectedDayIndex, DateTimeUnit.DAY)
    val daySeats = snapshot.seats.filter { it.start.toLocalDateTime(zone).date == date }
    return BreakCalendarDay(
        dayIndex = selectedDayIndex,
        date = date,
        inWindow = date in snapshot.windowStart..snapshot.windowEnd,
        blocks = buildBreakCoverage(daySeats, snapshot.meUserId),
        roster = buildBreakRoster(daySeats, snapshot.meUserId, zone),
    )
}

/** Coalesce a day's OCCUPIED seats into per-worker contiguous runs (read-only cards). */
fun buildBreakRoster(
    seats: List<BreakCalendarSeat>,
    meUserId: String?,
    zone: TimeZone = NEW_YORK,
): List<BreakRosterRun> =
    seats
        .filter { !it.vacant }
        .groupBy { it.userId }
        .values
        .flatMap { group ->
            val sorted = group.sortedBy { it.start }
            val runs = mutableListOf<MutableList<BreakCalendarSeat>>()
            var runEnd: Instant? = null
            for (seat in sorted) {
                if (runEnd != null && seat.start == runEnd) runs.last().add(seat) else runs.add(mutableListOf(seat))
                runEnd = seat.end
            }
            runs.map { run ->
                val first = run.first()
                val end = run.last().end
                BreakRosterRun(
                    id = first.id,
                    start = first.start,
                    end = end,
                    timeLabel = formatTimeRange(first.start, end, zone),
                    durationLabel = formatDuration(first.start, end),
                    workerName = first.workerName,
                    mine = first.userId != null && first.userId == meUserId,
                    seatIds = run.map { it.id },
                )
            }
        }
        .sortedWith(compareBy({ it.start }, { it.workerName ?: "" }))

// ===================================================================
// The drag — claim a TIME range; trim to the still-open part (THE tested contract).
// ===================================================================

/** Whether a drag resolves to claiming open capacity or dropping the worker's own runs. */
enum class BreakDragMode { NONE, CLAIM, DROP }

/** Why a block in the dragged range could not be claimed. */
enum class BreakDragSkip { FULL, CONFLICT, CAP }

/** A contiguous run of successfully-claimable blocks within a drag. */
data class BreakDragSegment(
    val start: Instant,
    val end: Instant,
    val rangeLabel: String,
    val durationLabel: String,
)

/** A contiguous run of trimmed-away blocks within a drag, with the reason. */
data class BreakDragTrim(
    val start: Instant,
    val end: Instant,
    val rangeLabel: String,
    val reason: BreakDragSkip,
)

/**
 * The reconciled plan for a drag over blocks [fromIndex..toIndex] (inclusive) of a day.
 *
 * [mode] decides the intent:
 *  - DROP — the selection is ENTIRELY the worker's own coverage → offer to drop it
 *    ([dropSeatIds] / [dropLabel]); the UI confirms before dropping.
 *  - CLAIM — the selection contains open capacity → claim from the FIRST open block to the
 *    end of the selection ([claimableBlockIds]); any leading own/full blocks are the drag's
 *    anchor and are ignored. The server may trim further (true FCFS).
 *  - NONE — nothing actionable (closed window / out of range).
 */
data class BreakDragPlan(
    val mode: BreakDragMode,
    val claimableBlockIds: List<String>,
    val claimedSegments: List<BreakDragSegment>,
    val trimmedSegments: List<BreakDragTrim>,
    val skippedFullBlockIds: List<String>,
    val skippedConflictBlockIds: List<String>,
    val capTrimmedBlockIds: List<String>,
    val projectedHours: Double,
    val capExceeded: Boolean,
    val dropSeatIds: List<String>,
    val dropLabel: String,
    val message: String,
) {
    /** The drag claims open capacity. */
    val claimable: Boolean get() = mode == BreakDragMode.CLAIM && claimableBlockIds.isNotEmpty()

    /** The drag drops the worker's own coverage (confirm first). */
    val droppable: Boolean get() = mode == BreakDragMode.DROP && dropSeatIds.isNotEmpty()
}

private enum class Outcome { ACCEPTED, FULL, CONFLICT, CAP }

/**
 * Plan a drag over blocks [fromIndex..toIndex] (inclusive; clamped & order-normalized).
 *
 * - The whole selection is the worker's own coverage → **DROP** (the UI confirms).
 * - Otherwise → **CLAIM**, starting at the first OPEN block (a drag that begins on the
 *   worker's own shift then runs over open capacity claims only the open part). Within the
 *   claim range: an own block → CONFLICT (skip), a full block → FULL (skip), a block past
 *   the 40h hard cap → CAP (skip + everything after). Contiguous same-outcome blocks
 *   coalesce into segments so an interior hole splits the claim and the message reports
 *   exactly what was taken and what was trimmed.
 */
fun planBreakDrag(
    snapshot: BreakCalendarSnapshot,
    day: BreakCalendarDay,
    fromIndex: Int,
    toIndex: Int,
    zone: TimeZone = NEW_YORK,
): BreakDragPlan {
    val n = day.blocks.size
    if (n == 0 || !snapshot.phase.isClaimable || !day.inWindow) {
        return emptyPlan(snapshot.claimedHours(), closedReason = !snapshot.phase.isClaimable)
    }
    val lo = minOf(fromIndex, toIndex).coerceIn(0, n - 1)
    val hi = maxOf(fromIndex, toIndex).coerceIn(0, n - 1)
    val span = day.blocks.subList(lo, hi + 1)
    val held = snapshot.claimedHours()

    // DROP — the entire selection is the worker's own coverage.
    if (span.all { it.mineHere }) {
        val dropSeatIds = span.mapNotNull { b -> b.lanes.firstOrNull { it.mine }?.seatId }
        val label = formatTimeRange(span.first().start, span.last().end, zone)
        return BreakDragPlan(
            mode = BreakDragMode.DROP,
            claimableBlockIds = emptyList(),
            claimedSegments = emptyList(),
            trimmedSegments = emptyList(),
            skippedFullBlockIds = emptyList(),
            skippedConflictBlockIds = emptyList(),
            capTrimmedBlockIds = emptyList(),
            projectedHours = held,
            capExceeded = false,
            dropSeatIds = dropSeatIds,
            dropLabel = label,
            message = "Drop your $label shift?",
        )
    }

    // CLAIM — anchor at the first OPEN block; leading own/full blocks are ignored.
    val firstOpen = span.indexOfFirst { !it.mineHere && it.open > 0 }
    val claimSpan = if (firstOpen < 0) emptyList() else span.subList(firstOpen, span.size)

    val capBlocksRemaining = ((snapshot.cap - held) / 0.5).let { if (it < 0) 0 else it.toInt() }
    var accepted = 0
    val tagged: List<Pair<BreakBlockCoverage, Outcome>> =
        claimSpan.map { block ->
            val outcome =
                when {
                    block.mineHere -> Outcome.CONFLICT
                    block.full -> Outcome.FULL
                    accepted >= capBlocksRemaining -> Outcome.CAP
                    else -> {
                        accepted++
                        Outcome.ACCEPTED
                    }
                }
            block to outcome
        }

    val claimableBlockIds = tagged.filter { it.second == Outcome.ACCEPTED }.map { it.first.blockId }
    val skippedFull = tagged.filter { it.second == Outcome.FULL }.map { it.first.blockId }
    val skippedConflict = tagged.filter { it.second == Outcome.CONFLICT }.map { it.first.blockId }
    val capTrimmed = tagged.filter { it.second == Outcome.CAP }.map { it.first.blockId }

    val claimedSegments =
        runsOf(tagged, Outcome.ACCEPTED).map { run ->
            BreakDragSegment(
                start = run.first().first.start,
                end = run.last().first.end,
                rangeLabel = formatTimeRange(run.first().first.start, run.last().first.end, zone),
                durationLabel = formatDuration(run.first().first.start, run.last().first.end),
            )
        }
    val trimmedSegments =
        listOf(Outcome.FULL, Outcome.CONFLICT, Outcome.CAP).flatMap { reasonOutcome ->
            runsOf(tagged, reasonOutcome).map { run ->
                BreakDragTrim(
                    start = run.first().first.start,
                    end = run.last().first.end,
                    rangeLabel = formatTimeRange(run.first().first.start, run.last().first.end, zone),
                    reason =
                        when (reasonOutcome) {
                            Outcome.FULL -> BreakDragSkip.FULL
                            Outcome.CONFLICT -> BreakDragSkip.CONFLICT
                            else -> BreakDragSkip.CAP
                        },
                )
            }
        }.sortedBy { it.start }

    return BreakDragPlan(
        mode = BreakDragMode.CLAIM,
        claimableBlockIds = claimableBlockIds,
        claimedSegments = claimedSegments,
        trimmedSegments = trimmedSegments,
        skippedFullBlockIds = skippedFull,
        skippedConflictBlockIds = skippedConflict,
        capTrimmedBlockIds = capTrimmed,
        projectedHours = held + accepted * 0.5,
        capExceeded = capTrimmed.isNotEmpty(),
        dropSeatIds = emptyList(),
        dropLabel = "",
        message = dragMessage(claimedSegments, trimmedSegments),
    )
}

/** Contiguous (time-adjacent) runs of [outcome] within the tagged span. */
private fun runsOf(
    tagged: List<Pair<BreakBlockCoverage, Outcome>>,
    outcome: Outcome,
): List<List<Pair<BreakBlockCoverage, Outcome>>> {
    val runs = mutableListOf<MutableList<Pair<BreakBlockCoverage, Outcome>>>()
    var prevEnd: Instant? = null
    for (item in tagged) {
        if (item.second != outcome) {
            prevEnd = null
            continue
        }
        if (prevEnd != null && item.first.start == prevEnd) {
            runs.last().add(item)
        } else {
            runs.add(mutableListOf(item))
        }
        prevEnd = item.first.end
    }
    return runs
}

private fun dragMessage(
    claimed: List<BreakDragSegment>,
    trimmed: List<BreakDragTrim>,
): String {
    val parts = mutableListOf<String>()
    if (claimed.isNotEmpty()) {
        parts += "Claimed " + claimed.joinToString(", ") { it.rangeLabel }
    }
    trimmed.forEach { t ->
        parts +=
            when (t.reason) {
                BreakDragSkip.FULL -> "${t.rangeLabel} was already full"
                BreakDragSkip.CONFLICT -> "you already cover ${t.rangeLabel}"
                BreakDragSkip.CAP -> "${t.rangeLabel} is over the 40h limit"
            }
    }
    return if (parts.isEmpty()) "Nothing to claim here" else parts.joinToString(" · ")
}

private fun emptyPlan(
    held: Double,
    closedReason: Boolean,
): BreakDragPlan =
    BreakDragPlan(
        mode = BreakDragMode.NONE,
        claimableBlockIds = emptyList(),
        claimedSegments = emptyList(),
        trimmedSegments = emptyList(),
        skippedFullBlockIds = emptyList(),
        skippedConflictBlockIds = emptyList(),
        capTrimmedBlockIds = emptyList(),
        projectedHours = held,
        capExceeded = false,
        dropSeatIds = emptyList(),
        dropLabel = "",
        message = if (closedReason) "Claiming isn't open right now" else "Nothing to claim here",
    )

// ===================================================================
// Optimistic local apply (the server write is the data layer's concern).
// ===================================================================

/**
 * Optimistically apply [plan] — for each claimable block, flip ONE vacant seat to mine
 * ("system-assigned lane"). The live `claim_break_blocks` is authoritative and may have
 * trimmed further; [reconcileClaim] folds the server's actual claimed seats back in.
 */
fun applyBreakDrag(
    snapshot: BreakCalendarSnapshot,
    plan: BreakDragPlan,
): BreakCalendarSnapshot {
    if (!plan.claimable || snapshot.meUserId == null) return snapshot
    val toClaim = plan.claimableBlockIds.toMutableSet()
    val claimedSeatId = mutableSetOf<String>()
    // Pick the first vacant seat per claimable block.
    for (block in toClaim) {
        snapshot.seats.firstOrNull { it.blockId == block && it.vacant && it.id !in claimedSeatId }
            ?.let { claimedSeatId += it.id }
    }
    return snapshot.copy(seats = snapshot.seats.map { seat -> if (seat.id in claimedSeatId) seat.toMine(snapshot.meUserId) else seat })
}

/**
 * Reconcile against the server's actual claim: [claimedAssignmentIds] are the seats
 * `claim_break_blocks` truly took. Any locally-claimed seat NOT in that set reverts to
 * vacant (the server trimmed it — FCFS lost after the optimistic flip).
 */
fun reconcileBreakClaim(
    snapshot: BreakCalendarSnapshot,
    claimedAssignmentIds: Set<String>,
): BreakCalendarSnapshot =
    snapshot.copy(
        seats =
            snapshot.seats.map { seat ->
                when {
                    seat.id in claimedAssignmentIds -> seat.toMine(snapshot.meUserId)
                    // a seat I optimistically claimed but the server didn't → revert
                    seat.userId == snapshot.meUserId && seat.status.equals("claimed", true) && seat.id !in claimedAssignmentIds ->
                        seat.copy(status = "vacant", userId = null, workerName = null)
                    else -> seat
                }
            },
    )

/** Optimistically drop my seats [seatIds] back to the pool (server drop via drop-shift). */
fun applyBreakDrop(
    snapshot: BreakCalendarSnapshot,
    seatIds: Set<String>,
): BreakCalendarSnapshot =
    snapshot.copy(
        seats =
            snapshot.seats.map { seat ->
                if (seat.id in seatIds && seat.userId == snapshot.meUserId) {
                    seat.copy(status = "vacant", userId = null, workerName = null)
                } else {
                    seat
                }
            },
    )

private fun BreakCalendarSeat.toMine(meUserId: String?): BreakCalendarSeat =
    copy(status = "claimed", userId = meUserId, workerName = "You")

/** The "This week — Xh / 40h" hard-cap meter atop the break picker. */
data class BreakHoursMeter(
    val currentLabel: String,
    val capLabel: String,
    val fraction: Double,
    val atCap: Boolean,
)

fun buildBreakHoursMeter(
    claimedHours: Double,
    cap: Double = BREAK_HOURS_CAP,
): BreakHoursMeter =
    BreakHoursMeter(
        currentLabel = formatHours(claimedHours),
        capLabel = formatHours(cap),
        fraction = (claimedHours / cap).coerceIn(0.0, 1.0),
        atCap = claimedHours >= cap,
    )
