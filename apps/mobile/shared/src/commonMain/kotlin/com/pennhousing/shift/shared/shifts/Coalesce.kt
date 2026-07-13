package com.pennhousing.shift.shared.shifts

import com.pennhousing.shift.shared.model.AssignmentKind
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.model.OpenFeed
import com.pennhousing.shift.shared.model.OpenShift
import kotlinx.datetime.isoDayNumber
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Instant

/*
 * Block coalescing (parity CO) — PURE, shared by both platforms.
 *
 * The live worker read models (`worker_my_shifts` / `worker_open_shifts`) return ONE
 * ROW PER 30-MINUTE BLOCK (invariant #5: every operation works in 30-min blocks), so
 * a live 4h shift would otherwise render as 8 identical cards. This layer merges
 * consecutive blocks that belong to the same displayed shift into one card whose
 * [MyShift.blockIds] / [OpenShift.blockIds] carry every constituent block
 * `assignment_id`, so drop/claim can still target all — or a sub-range (§5.2 partial
 * drop / §5.3 partial claim) — of the underlying blocks.
 *
 * Contiguity is duration arithmetic on instants — `next.start == run.end` — never
 * wall-clock arithmetic (invariant #6), so runs merge correctly across DST
 * transitions (the spring-forward gap and the fall-back repeated hour are seamless
 * on the instant timeline).
 *
 * Blocks merge only when EVERYTHING the card displays matches: same house, same
 * kind/feed, and identical §11.2 treatment flags. The merged card keeps the first
 * block's id (stable for selectors/optimistic moves) and spans first.start →
 * last.end. No I/O, no clock.
 */

/** What must match for two adjacent My-Shifts blocks to be one displayed shift. */
private data class MyShiftMergeKey(
    val houseId: String,
    val kind: AssignmentKind,
    val crossHouse: Boolean,
    val pending: Boolean,
    val breakShift: Boolean,
    val droppedStillOpen: Boolean,
)

private fun mergeKey(shift: MyShift) =
    MyShiftMergeKey(
        houseId = shift.house.id,
        kind = shift.kind,
        crossHouse = shift.crossHouse,
        pending = shift.pending,
        breakShift = shift.breakShift,
        droppedStillOpen = shift.droppedStillOpen,
    )

/** What must match for two adjacent open-feed blocks to be one displayed opening. */
private data class OpenShiftMergeKey(
    val houseId: String,
    val feed: OpenFeed,
    val homeHouse: Boolean,
    val weeksRemaining: Int?,
    // Coverage flags are per-block (§5.4/§5.5), so two adjacent blocks can differ —
    // one still covered/claimable, the next empty or one-way locked. Keying on them
    // keeps blocks with different claimability in separate cards rather than merging
    // them into one card whose action would misrepresent half its blocks.
    val deskCovered: Boolean,
    val coverageLocked: Boolean,
)

private fun mergeKey(shift: OpenShift) =
    OpenShiftMergeKey(
        houseId = shift.house.id,
        feed = shift.feed,
        homeHouse = shift.homeHouse,
        weeksRemaining = shift.weeksRemaining,
        deskCovered = shift.deskCovered,
        coverageLocked = shift.coverageLocked,
    )

/**
 * Thread [items] (same merge key) into maximal contiguous LANES: each item extends the
 * first open lane whose current end equals the item's start, else it opens a new lane.
 *
 * A single sweep ("extend the one current run iff its start equals its end") is WRONG
 * when the read model carries CONCURRENT blocks — a multi-staff house (the Quad) has
 * several desks vacant for the same span, so `worker_open_shifts` returns multiple rows
 * with the same start. A sweep treats the second same-start row as an overlap and splits
 * the run, fragmenting 8:00-8:30 + 8:30-9:00 into three cards. Threading instead runs one
 * lane per desk, so two desks open 8:00-9:00 yield two clean 8:00-9:00 lanes (the caller
 * then groups them into a single "2 open" card). Non-concurrent input → exactly one lane,
 * identical to the old behaviour. Each lane's items stay in ascending start order.
 *
 * Contiguity is duration arithmetic on instants (`end == start`), never wall-clock
 * (invariant #6), so lanes merge correctly across DST transitions.
 */
private fun <T> threadLanes(
    items: List<T>,
    start: (T) -> Instant,
    end: (T) -> Instant,
): List<List<T>> {
    val lanes = mutableListOf<MutableList<T>>()
    val laneEnds = mutableListOf<Instant>()
    for (item in items.sortedBy { start(it) }) {
        val laneIdx = laneEnds.indexOfFirst { it == start(item) }
        if (laneIdx >= 0) {
            lanes[laneIdx].add(item)
            laneEnds[laneIdx] = end(item)
        } else {
            lanes.add(mutableListOf(item))
            laneEnds.add(end(item))
        }
    }
    return lanes
}

/**
 * Merge consecutive same-shift blocks into displayed cards, sorted by start. A block
 * with no same-key neighbour passes through unchanged (the demo path's hand-built
 * multi-hour spans are single "blocks" here and render exactly as before). A worker never
 * holds two concurrent blocks, so each lane is a plain contiguous run (no count here).
 */
fun coalesceMyShifts(blocks: List<MyShift>): List<MyShift> =
    blocks
        .groupBy(::mergeKey)
        .values
        .flatMap { group ->
            threadLanes(group, MyShift::start, MyShift::end).map { lane ->
                lane.first().copy(end = lane.last().end, blockIds = lane.flatMap { it.blockIds })
            }
        }
        .sortedBy { it.start }

/**
 * The open-feed analogue of [coalesceMyShifts], concurrency-aware. After threading each
 * merge-key group into lanes, lanes with an IDENTICAL (start, end) span collapse into one
 * card carrying [OpenShift.count] = the lane count and ONE representative lane's
 * [OpenShift.blockIds] — so a multi-staff house shows "N open" instead of N duplicate (or
 * fragmented) cards, and claiming consumes exactly one desk (the next snapshot
 * re-coalesces to count − 1). Lanes of different spans stay separate count-1 cards.
 *
 * Permanent openings (§5.1) then get a SECOND collapse: a slot dropped for the rest of the
 * semester is vacant on every remaining week, so `worker_open_shifts` returns one block-run
 * per future occurrence — which the per-span step above renders as N identical "EVERY MON
 * 17:00-18:00 · N weeks remaining" cards (one per week). They describe the SAME recurring
 * slot, and permanent pickup re-derives every week server-side from the slot's house + NY
 * weekday + local HH:MM (see WorkerShiftsRepository.toSlot), so we keep only the earliest
 * occurrence per recurrence identity. Weekly openings carry no recurrence and pass through.
 */
fun coalesceOpenShifts(blocks: List<OpenShift>): List<OpenShift> {
    val perSpan =
        blocks
            .groupBy(::mergeKey)
            .values
            .flatMap { group ->
                threadLanes(group, OpenShift::start, OpenShift::end)
                    .map { lane -> lane.first().copy(end = lane.last().end, blockIds = lane.flatMap { it.blockIds }) }
                    .groupBy { it.start to it.end }
                    .values
                    .map { sameSpan -> sameSpan.first().copy(count = sameSpan.size) }
            }
    val (permanent, weekly) = perSpan.partition { it.feed == OpenFeed.PERMANENT_OPENING }
    val recurringSlots =
        permanent
            .groupBy(::recurrenceKey)
            .values
            .map { occurrences -> occurrences.minByOrNull { it.start }!! }
    return (weekly + recurringSlots).sortedWith(compareBy({ it.start }, { it.end }))
}

/**
 * The recurring-slot identity of a permanent opening: same house + home-house flag + NY
 * weekday + local start/end time-of-day. Two occurrences a week apart share this key but
 * sit at different absolute instants — matching how permanent pickup names the slot
 * (invariant #6: NY-local day-of-week + HH:MM, never an absolute date).
 */
private fun recurrenceKey(shift: OpenShift): String {
    val start = shift.start.toLocalDateTime(NEW_YORK)
    val end = shift.end.toLocalDateTime(NEW_YORK)
    fun hhmm(t: kotlinx.datetime.LocalDateTime) =
        t.hour.toString().padStart(2, '0') + ":" + t.minute.toString().padStart(2, '0')
    return listOf(
        shift.house.id,
        shift.homeHouse.toString(),
        start.dayOfWeek.isoDayNumber.toString(),
        hhmm(start),
        hhmm(end),
    ).joinToString("|")
}
