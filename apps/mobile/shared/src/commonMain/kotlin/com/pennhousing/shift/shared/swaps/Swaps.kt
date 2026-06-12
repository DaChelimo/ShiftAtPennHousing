package com.pennhousing.shift.shared.swaps

import com.pennhousing.shift.shared.house.HouseSeat
import com.pennhousing.shift.shared.model.AssignmentKind
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.shifts.NEW_YORK
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
    /** The proposer's card — its `blockIds` are `initiator_assignment_ids`. */
    val initiatorShift: MyShift,
    /** The picked counterparty run's seat ids; null for a permanent swap. */
    val counterpartyAssignmentIds: List<String>?,
)

/** Map a picked [SwapKind] + candidate to the EF proposal. */
fun buildSwapProposal(
    kind: SwapKind,
    initiatorShift: MyShift,
    candidate: SwapCandidate,
): SwapProposal =
    SwapProposal(
        swapType =
            when (kind) {
                SwapKind.SHIFT -> "shift_swap"
                SwapKind.FLOAT -> "float_swap"
                SwapKind.PERMANENT -> "permanent_swap"
            },
        counterpartyUserId = candidate.userId,
        initiatorShift = initiatorShift,
        counterpartyAssignmentIds = if (kind == SwapKind.PERMANENT) null else candidate.seatIds,
    )
