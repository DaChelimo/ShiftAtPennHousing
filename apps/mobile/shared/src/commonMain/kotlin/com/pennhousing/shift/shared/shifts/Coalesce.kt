package com.pennhousing.shift.shared.shifts

import com.pennhousing.shift.shared.model.AssignmentKind
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.model.OpenFeed
import com.pennhousing.shift.shared.model.OpenShift
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
)

private fun mergeKey(shift: OpenShift) =
    OpenShiftMergeKey(
        houseId = shift.house.id,
        feed = shift.feed,
        homeHouse = shift.homeHouse,
        weeksRemaining = shift.weeksRemaining,
    )

/**
 * Split [sorted] (ascending by start) into maximal contiguous runs: an item extends
 * the current run iff its start equals the run's end. An overlap or a gap starts a
 * new run (overlapping rows would be a read-model bug; never silently absorb them).
 */
private fun <T> contiguousRuns(
    sorted: List<T>,
    start: (T) -> Instant,
    end: (T) -> Instant,
): List<List<T>> {
    val runs = mutableListOf<MutableList<T>>()
    var runEnd: Instant? = null
    for (item in sorted) {
        if (runEnd != null && start(item) == runEnd) {
            runs.last().add(item)
        } else {
            runs.add(mutableListOf(item))
        }
        runEnd = end(item)
    }
    return runs
}

/**
 * Merge consecutive same-shift blocks into displayed cards, sorted by start. A block
 * with no same-key neighbour passes through unchanged (the demo path's hand-built
 * multi-hour spans are single "blocks" here and render exactly as before).
 */
fun coalesceMyShifts(blocks: List<MyShift>): List<MyShift> =
    blocks
        .groupBy(::mergeKey)
        .values
        .flatMap { group ->
            contiguousRuns(group.sortedBy { it.start }, MyShift::start, MyShift::end).map { run ->
                run.first().copy(end = run.last().end, blockIds = run.flatMap { it.blockIds })
            }
        }
        .sortedBy { it.start }

/** The open-feed analogue of [coalesceMyShifts]. */
fun coalesceOpenShifts(blocks: List<OpenShift>): List<OpenShift> =
    blocks
        .groupBy(::mergeKey)
        .values
        .flatMap { group ->
            contiguousRuns(group.sortedBy { it.start }, OpenShift::start, OpenShift::end).map { run ->
                run.first().copy(end = run.last().end, blockIds = run.flatMap { it.blockIds })
            }
        }
        .sortedBy { it.start }
