package com.pennhousing.shift.shared.swaps

import com.pennhousing.shift.shared.house.HouseSeat
import com.pennhousing.shift.shared.model.AssignmentKind
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.shifts.BLOCK
import com.pennhousing.shift.shared.shifts.NEW_YORK
import com.pennhousing.shift.shared.shifts.formatBlockTime
import com.pennhousing.shift.shared.shifts.formatDayLabel
import com.pennhousing.shift.shared.shifts.formatDuration
import com.pennhousing.shift.shared.shifts.formatTimeRange
import kotlinx.datetime.TimeZone
import kotlin.time.Instant

/*
 * Swap initiation (§8.1–§8.4, D2–D4) — PURE decision/presentation logic for
 * proposing a swap from a My-Shifts card. The server (`create-swap` EF +
 * `packages/core` eligibility) stays AUTHORITATIVE for §8 eligibility, pending
 * conflicts and expiry; this layer only decides which proposal kinds a card can
 * offer and shapes the counterparty picker from the §11.4 house grid (the same
 * `house_schedule_grid` snapshot the House tab renders).
 */

/** Which swap the worker can propose from a given card (§8.1/§8.2/§8.3). */
enum class SwapKind { SHIFT, FLOAT, PERMANENT }

/**
 * §8: a FLOAT_OUT card proposes a float swap (someone takes your float); a
 * SCHEDULED card proposes a this-week shift swap or — outside break profiles
 * (§8.3: permanent swaps apply only to SM-built regular slots) — a permanent
 * swap of the recurring slot; pickups propose a plain shift swap. A
 * dropped-still-open card proposes nothing (the slot is already vacated).
 */
fun swapKindsFor(
    shift: MyShift,
    breakProfile: Boolean,
): List<SwapKind> =
    when {
        shift.droppedStillOpen -> emptyList()
        shift.kind == AssignmentKind.FLOAT_OUT -> listOf(SwapKind.FLOAT)
        shift.kind == AssignmentKind.SCHEDULED ->
            if (breakProfile) listOf(SwapKind.SHIFT) else listOf(SwapKind.SHIFT, SwapKind.PERMANENT)
        else -> listOf(SwapKind.SHIFT) // TEMP_PICKUP / PERMANENT_PICKUP — this-week swap only
    }

/** One pickable counterparty run (a housemate's coalesced same-seat span). */
data class SwapCandidate(
    val userId: String,
    val workerName: String,
    /** The run's per-block `assignment_id`s — `counterparty_assignment_ids` for the EF. */
    val seatIds: List<String>,
    val start: Instant,
    val end: Instant,
    val timeLabel: String,
    val dayLabel: String,
    val durationLabel: String,
)

/**
 * The counterparty picker: coalesce the house grid's seats into per-worker
 * contiguous runs (vacant seats, pending floats and [excludeUserId] — the
 * proposer — are not pickable; a pending float seat is not the counterparty's
 * settled shift). Sorted by start, then name.
 */
fun swapCandidates(
    seats: List<HouseSeat>,
    excludeUserId: String?,
    zone: TimeZone = NEW_YORK,
): List<SwapCandidate> =
    seats
        .asSequence()
        .filter { !it.vacant && !it.pending && it.userId != null && it.userId != excludeUserId }
        .groupBy { it.userId }
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
                SwapCandidate(
                    userId = first.userId!!,
                    workerName = first.workerName ?: "Housemate",
                    seatIds = run.map { it.id },
                    start = first.start,
                    end = end,
                    timeLabel = formatTimeRange(first.start, end, zone),
                    dayLabel = formatDayLabel(first.start, zone),
                    durationLabel = formatDuration(first.start, end),
                )
            }
        }
        .sortedWith(compareBy({ it.start }, { it.workerName }))

/** NY-fixed convenience for the Swift bridge (Kotlin default args don't export). */
fun swapCandidatesFor(
    seats: List<HouseSeat>,
    excludeUserId: String?,
): List<SwapCandidate> = swapCandidates(seats, excludeUserId)

/**
 * A PERMANENT swap picks a PERSON (the recurring slot transfers; the acceptance
 * enumerates affected assignments server-side, §8.4) — one entry per worker,
 * keyed by their earliest run.
 */
fun swapPeople(candidates: List<SwapCandidate>): List<SwapCandidate> =
    candidates
        .groupBy { it.userId }
        .values
        .map { runs -> runs.minByOrNull { it.start }!! }
        .sortedBy { it.workerName }

/** What the host POSTs to `create-swap` (field mapping lives in the repository). */
data class SwapProposal(
    /** `shift_swap` | `float_swap` | `permanent_swap` (the EF's `swap_type`). */
    val swapType: String,
    val counterpartyUserId: String,
    /** The proposer's card — its house/start/end name the permanent recurring slot. */
    val initiatorShift: MyShift,
    /**
     * The proposer's offered block `assignment_id`s = `initiator_assignment_ids`. A
     * contiguous subset of [initiatorShift]'s blocks (§8.1 "any contiguous block run,
     * including partial shifts"); the whole shift when no sub-range is picked. A permanent
     * swap may ALSO be partial — `resolve_permanent_swap_affected` matches the recurring
     * pattern's block starts, so a sub-range transfers only those blocks each week.
     */
    val initiatorAssignmentIds: List<String>,
    /** The picked counterparty run's (sub)selected seat ids; null for a permanent swap. */
    val counterpartyAssignmentIds: List<String>?,
    /**
     * For a permanent swap: the (sub)selected recurring slot's span [start, end) — the
     * repository derives `recurring_pattern.block_start_locals` from it, so a partial
     * permanent swap names only the trimmed blocks. Null → the whole [initiatorShift].
     */
    val recurringSlotStart: Instant? = null,
    val recurringSlotEnd: Instant? = null,
)

/**
 * Map a picked [SwapKind] + candidate to the EF proposal. [initiatorBlockIds] /
 * [counterpartyBlockIds] are the (sub)selected contiguous spans (§8.1 partial swap);
 * they default to the whole shift / whole candidate run, preserving the original
 * whole-run behavior when no block-picker selection is made. A PERMANENT swap takes the
 * proposer's [initiatorBlockIds] (whole slot, or a trimmed sub-range — §8.3 transfers are
 * one-directional, so a partial slot is sound) but no counterparty span (person-level).
 */
fun buildSwapProposal(
    kind: SwapKind,
    initiatorShift: MyShift,
    candidate: SwapCandidate,
    initiatorBlockIds: List<String> = initiatorShift.blockIds,
    counterpartyBlockIds: List<String> = candidate.seatIds,
): SwapProposal {
    val permanent = kind == SwapKind.PERMANENT
    return SwapProposal(
        swapType =
            when (kind) {
                SwapKind.SHIFT -> "shift_swap"
                SwapKind.FLOAT -> "float_swap"
                SwapKind.PERMANENT -> "permanent_swap"
            },
        counterpartyUserId = candidate.userId,
        initiatorShift = initiatorShift,
        initiatorAssignmentIds = initiatorBlockIds,
        counterpartyAssignmentIds = if (permanent) null else counterpartyBlockIds,
    )
}

// ===================================================================
// Partial selection (§8.1: "any contiguous block run, including partial
// shifts") — PURE block-picker logic shared by both front ends. Mirrors the
// shifts/ planPartialDrop + planPartialClaim contract: index-based, contiguous
// by construction, with NY-anchored labels precomputed so Swift needs no
// formatter calls.
// ===================================================================

/** One selectable 30-min cell of a swap span — drives the block-picker toggles. */
data class SwapBlockCell(
    val index: Int,
    val blockId: String,
    val startLabel: String, // "14:00"
    val endLabel: String, // "14:30"
)

/**
 * Enumerate a span's selectable 30-min cells in time order. Each cell i covers
 * [spanStart + i*30m, +30m). A span whose ids don't sub-divide (n <= 1 — a legacy
 * hand-built span) yields ONE cell covering the whole span, so the picker degrades
 * to "the whole shift" rather than mislabelling.
 */
fun swapSpanCells(
    blockIds: List<String>,
    spanStart: Instant,
    spanEnd: Instant,
    zone: TimeZone = NEW_YORK,
): List<SwapBlockCell> {
    if (blockIds.size <= 1) {
        return listOf(
            SwapBlockCell(0, blockIds.firstOrNull() ?: "", formatBlockTime(spanStart, zone), formatBlockTime(spanEnd, zone)),
        )
    }
    return blockIds.mapIndexed { i, id ->
        val s = spanStart + BLOCK * i
        SwapBlockCell(i, id, formatBlockTime(s, zone), formatBlockTime(s + BLOCK, zone))
    }
}

/** NY-fixed convenience for the Swift bridge (Kotlin default args don't export). */
fun swapSpanCellsFor(
    blockIds: List<String>,
    spanStart: Instant,
    spanEnd: Instant,
): List<SwapBlockCell> = swapSpanCells(blockIds, spanStart, spanEnd)

/** A chosen contiguous sub-range of a span's blocks (§8.1). */
data class SwapSpanSelection(
    val blockIds: List<String>,
    val start: Instant,
    val end: Instant,
    val dayLabel: String, // "Thu · Jan 15" — day-of-week + date of the span
    val rangeLabel: String, // "14:00 – 15:00"
    val durationLabel: String, // "1h"
    val wholeSpan: Boolean,
)

/**
 * Select blocks [fromBlock, toBlock) of a span (indexes on its 30-min grid,
 * [toBlock] exclusive; clamped to a non-empty range). Contiguous BY CONSTRUCTION —
 * the result is always one run, which is exactly what §8.1 ("one or more contiguous
 * blocks each") requires; a worker wanting non-adjacent chunks of their own shift
 * makes separate legs ([buildSwapProposals]) rather than a gapped span. A span whose
 * ids don't sub-divide selects the whole span (see [swapSpanCells]).
 */
fun planSwapSpan(
    blockIds: List<String>,
    spanStart: Instant,
    spanEnd: Instant,
    fromBlock: Int,
    toBlock: Int,
    zone: TimeZone = NEW_YORK,
): SwapSpanSelection {
    val n = blockIds.size
    val from = fromBlock.coerceIn(0, n - 1)
    val to = toBlock.coerceIn(from + 1, n)
    val start = spanStart + BLOCK * from
    // Anchor the end at the SPAN end and walk back, so a 1-id multi-hour span still
    // resolves end = spanEnd rather than start + 30m (mirrors planPartialDrop).
    val end = spanEnd - BLOCK * (n - to)
    return SwapSpanSelection(
        blockIds = blockIds.subList(from, to),
        start = start,
        end = end,
        dayLabel = formatDayLabel(start, zone),
        rangeLabel = formatTimeRange(start, end, zone),
        durationLabel = formatDuration(start, end),
        wholeSpan = from == 0 && to == n,
    )
}

/** NY-fixed convenience for the Swift bridge (Kotlin default args don't export). */
fun planSwapSpanFor(
    blockIds: List<String>,
    spanStart: Instant,
    spanEnd: Instant,
    fromBlock: Int,
    toBlock: Int,
): SwapSpanSelection = planSwapSpan(blockIds, spanStart, spanEnd, fromBlock, toBlock)

// ===================================================================
// Multi-party swaps — INDEPENDENT LEGS (decision 2026-06-15: one leg failing
// never affects the others; the atomic mindset stays per-leg). A multi-party
// proposal is N independent 1:1 `swap_requests`, NOT one coupled basket. The
// §8.1 conflict guard already forbids the same block in two pending swaps, so
// the legs MUST use disjoint initiator blocks — which [unallocatedInitiatorBlocks]
// drives in the compose UI and [legsHaveOverlap] guards before the server does.
// ===================================================================

/** One leg of a (possibly multi-party) swap — one independent 1:1 proposal. */
data class SwapLeg(
    val candidate: SwapCandidate,
    /** A contiguous subset of the proposer's shift; DISJOINT across legs. */
    val initiatorBlockIds: List<String>,
    /** The (sub)selected counterparty seat ids this leg takes. */
    val counterpartyBlockIds: List<String>,
)

/** True iff two legs share an initiator block (the §8.1 conflict guard would reject these). */
fun legsHaveOverlap(legs: List<SwapLeg>): Boolean {
    val seen = mutableSetOf<String>()
    for (leg in legs) {
        for (id in leg.initiatorBlockIds) {
            if (!seen.add(id)) return true
        }
    }
    return false
}

/**
 * The proposer's blocks not yet allocated to any leg — the compose UI disables
 * already-allocated cells so each block lands in at most one leg (keeping the legs
 * disjoint, as the conflict guard requires). Preserves [allBlockIds]' order.
 */
fun unallocatedInitiatorBlocks(
    allBlockIds: List<String>,
    legs: List<SwapLeg>,
): List<String> {
    val taken = legs.flatMap { it.initiatorBlockIds }.toSet()
    return allBlockIds.filterNot { it in taken }
}

/** A half-open block-index range [from, to) on a span's 30-min grid. */
data class BlockRange(
    val from: Int,
    val to: Int,
)

/**
 * The first maximal run of block indexes (in [0, blockCount)) NOT in [allocated] — the
 * compose UI's default range for a freshly-added leg, so "add another person" lands on
 * free hours instead of overlapping a committed leg. Returns null when every block is
 * already allocated.
 */
fun firstFreeRange(
    blockCount: Int,
    allocated: Set<Int>,
): BlockRange? {
    var start = 0
    while (start < blockCount && start in allocated) start++
    if (start >= blockCount) return null
    var end = start
    while (end < blockCount && end !in allocated) end++
    return BlockRange(start, end)
}

/**
 * Map a multi-party compose action to INDEPENDENT 1:1 proposals — one per leg, each
 * fired through its own `create-swap` so one leg declining/expiring/voiding never
 * affects the others. Permanent swaps are person-level (§8.3) and never multi-leg
 * (the caller offers it only as a single whole-slot leg).
 */
fun buildSwapProposals(
    kind: SwapKind,
    initiatorShift: MyShift,
    legs: List<SwapLeg>,
): List<SwapProposal> =
    legs.map { leg ->
        buildSwapProposal(kind, initiatorShift, leg.candidate, leg.initiatorBlockIds, leg.counterpartyBlockIds)
    }

// ===================================================================
// Segmented give/take timeline (partial multi-leg swaps) — PURE model both
// front ends render as ONE track with locked zones (not N sliders), so a
// fragmented shift still reads as one day. The two-budget rule: a GIVE block is
// spent once across ALL your legs (whoever receives it); a TAKE block is spent
// once PER counterparty shift. Reserved runs render greyed + labelled; the FREE
// complement is tap-to-focus; the ACTIVE sub-range carries the slider handles.
// ===================================================================

/** A banked (locked) run on a span's 30-min grid + the note to show on it. */
data class ReservedRun(
    val range: BlockRange,
    /** Give side: who received it ("Dan"). Take side: "Taken" (already taken in another leg). */
    val note: String,
)

/**
 * One run of the segmented timeline. [locked] = already spent (not selectable);
 * [active] = the current leg's selection (carries the handles); neither set = a FREE
 * run the worker can tap to focus. The segments exactly cover the span, gap-free.
 */
data class SwapSegment(
    val from: Int, // inclusive block index
    val to: Int, // exclusive
    val locked: Boolean,
    val active: Boolean,
    val rangeLabel: String, // "12:00 – 4:00pm"
    val note: String?, // locked → its [ReservedRun.note]; else null
)

/**
 * The maximal FREE run (no reserved index) containing [index], or null when [index]
 * is itself reserved / out of range. Drives the slider clamp (handles stay inside one
 * free run) and tap-to-focus (tapping a free block selects that whole run).
 */
fun enclosingFreeRun(
    blockCount: Int,
    reserved: Set<Int>,
    index: Int,
): BlockRange? {
    if (index < 0 || index >= blockCount || index in reserved) return null
    var lo = index
    while (lo - 1 >= 0 && (lo - 1) !in reserved) lo--
    var hi = index + 1
    while (hi < blockCount && hi !in reserved) hi++
    return BlockRange(lo, hi)
}

/**
 * Split a span into ACTIVE / LOCKED / FREE runs for the timeline strip. [reserved] are
 * the banked (locked) runs with their notes; [active] is the current selection (always
 * inside a free run). Consecutive blocks of the same kind (and same note) coalesce, so a
 * shift with an interior locked gap surfaces as free → locked → free.
 */
fun buildSwapSegments(
    blockIds: List<String>,
    spanStart: Instant,
    spanEnd: Instant,
    reserved: List<ReservedRun>,
    active: BlockRange?,
    zone: TimeZone = NEW_YORK,
): List<SwapSegment> {
    val n = blockIds.size
    if (n == 0) return emptyList()
    val noteAt = arrayOfNulls<String>(n)
    for (r in reserved) {
        for (i in r.range.from until r.range.to) if (i in 0 until n) noteAt[i] = r.note
    }
    val activeSet = active?.let { (it.from until it.to).toHashSet() } ?: hashSetOf()
    val out = mutableListOf<SwapSegment>()
    var i = 0
    while (i < n) {
        val locked = noteAt[i] != null
        val active0 = !locked && i in activeSet
        val note = noteAt[i]
        var j = i + 1
        while (j < n) {
            val lockedJ = noteAt[j] != null
            val activeJ = !lockedJ && j in activeSet
            if (lockedJ != locked || activeJ != active0 || noteAt[j] != note) break
            j++
        }
        val span = planSwapSpan(blockIds, spanStart, spanEnd, i, j, zone)
        out.add(SwapSegment(i, j, locked, active0, span.rangeLabel, if (locked) note else null))
        i = j
    }
    return out
}
