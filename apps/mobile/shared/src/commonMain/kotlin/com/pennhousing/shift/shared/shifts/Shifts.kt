package com.pennhousing.shift.shared.shifts

import com.pennhousing.shift.shared.model.AssignmentKind
import com.pennhousing.shift.shared.model.House
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.model.MyShiftsSection
import com.pennhousing.shift.shared.model.OpenFeed
import com.pennhousing.shift.shared.model.OpenShift
import kotlin.time.Duration.Companion.hours
import kotlin.time.Duration.Companion.minutes
import kotlin.time.DurationUnit
import kotlin.time.Instant

/**
 * Phase 13a — the Shifts-screen decision surface (BEHAVIORAL_SPECIFICATION.md
 * §5.6 / §5.3 / §5.4 / §5.2). PURE and deterministic: no I/O, no system clock —
 * `now` is always injected. This is the mobile analogue of the project's
 * "pure decision surface in code, atomic state elsewhere" split
 * (phase-06/07/12, tests/PHASE_13a/TEST_PLAN.md).
 */

val NEW_YORK: kotlinx.datetime.TimeZone = kotlinx.datetime.TimeZone.of("America/New_York") // invariant #6
val CLAIM_CUTOFF_BEFORE_START = 2.hours // T-2h unpickable (§5.4)
val SHORT_NOTICE_WINDOW = 20.minutes // §5.2
val BLOCK = 30.minutes // invariant #5
const val SOFT_HOURS_CAP = 20.0 // §5.3 regular / spring fling
const val BREAK_HOURS_CAP = 40.0 // §5.3 break

// ===================================================================
// Tab 1 — My Shifts (§5.6).
// ===================================================================

data class MyShiftsTab(
    val pickedUp: List<MyShift>,
    val dropped: List<MyShift>,
    val scheduled: List<MyShift>,
) {
    /** Top→bottom: picked-up, then dropped, then their (scheduled) shifts (§5.6 Tab 1). */
    fun inDisplayOrder(): List<MyShift> = pickedUp + dropped + scheduled
}

/**
 * §5.6 / decision #1, #2: `droppedStillOpen` wins (DROPPED) even for a dropped
 * pickup; else a this-week voluntary pickup is PICKED_UP; else (SCHEDULED /
 * PERMANENT_PICKUP / FLOAT_OUT) is the worker's own shift → SCHEDULED.
 */
fun classifyMyShift(shift: MyShift): MyShiftsSection =
    when {
        shift.droppedStillOpen -> MyShiftsSection.DROPPED
        shift.kind == AssignmentKind.TEMP_PICKUP -> MyShiftsSection.PICKED_UP
        else -> MyShiftsSection.SCHEDULED
    }

/** Partition by [classifyMyShift]; each subsection sorted by start ascending. */
fun buildMyShiftsTab(shifts: List<MyShift>): MyShiftsTab {
    val bySection = shifts.groupBy(::classifyMyShift)

    fun section(s: MyShiftsSection) = bySection[s].orEmpty().sortedBy { it.start }
    return MyShiftsTab(
        pickedUp = section(MyShiftsSection.PICKED_UP),
        dropped = section(MyShiftsSection.DROPPED),
        scheduled = section(MyShiftsSection.SCHEDULED),
    )
}

// ===================================================================
// Tab 2 — Open Shifts in My House (§5.6 Tab 2 / §5.1).
// ===================================================================

data class HomeOpenShiftsTab(
    val weekly: List<OpenShift>,
    val permanentOpenings: List<OpenShift>,
)

/** Home-house feeds only; split weekly/permanent; each sorted by start (decision #4). */
fun buildHomeOpenShiftsTab(openShifts: List<OpenShift>): HomeOpenShiftsTab {
    val home = openShifts.filter { it.homeHouse }
    return HomeOpenShiftsTab(
        weekly = home.filter { it.feed == OpenFeed.WEEKLY }.sortedBy { it.start },
        permanentOpenings = home.filter { it.feed == OpenFeed.PERMANENT_OPENING }.sortedBy { it.start },
    )
}

// ===================================================================
// Tab 3 — Open Shifts in Other Houses (§5.6 Tab 3).
// ===================================================================

data class HouseGroup(
    val house: House,
    val weekly: List<OpenShift>,
    val permanentOpenings: List<OpenShift>,
)

data class OtherHousesTab(
    val groups: List<HouseGroup>,
) {
    /** Empty when no eligible cross-house feed exists — e.g. winter break (§5.6 / decision #6). */
    val isEmpty: Boolean get() = groups.isEmpty()
}

/**
 * Cross-house feeds only; grouped by house, groups ordered by `house.name`;
 * within a group split weekly/permanent, each sorted by start (decision #5).
 * The client does NOT re-derive cross-house eligibility — it renders the
 * matrix-filtered feed it is given (decision #6).
 */
fun buildOtherHousesTab(openShifts: List<OpenShift>): OtherHousesTab {
    val groups =
        openShifts
            .filter { !it.homeHouse }
            .groupBy { it.house }
            .toList()
            .sortedBy { (house, _) -> house.name }
            .map { (house, shifts) ->
                HouseGroup(
                    house = house,
                    weekly = shifts.filter { it.feed == OpenFeed.WEEKLY }.sortedBy { it.start },
                    permanentOpenings = shifts.filter { it.feed == OpenFeed.PERMANENT_OPENING }.sortedBy { it.start },
                )
            }
    return OtherHousesTab(groups)
}

// ===================================================================
// Claim (§5.3 / §5.4).
// ===================================================================

/** §5.4 / decision #7: claimable strictly before T-2h; at exactly T-2h, NOT claimable. */
fun isClaimable(
    shift: OpenShift,
    now: Instant,
): Boolean = now < shift.start - CLAIM_CUTOFF_BEFORE_START

enum class ClaimCapVerdict {
    OK,
    SOFT_CAP_WARNING,
    HARD_CAP_BLOCKED,
    ;

    /** Over the hard break cap — the claim is prohibited (§5.3). */
    val isBlocked: Boolean get() = this == HARD_CAP_BLOCKED

    /** Over the soft cap — allowed, but the UI warns first (§5.3). */
    val needsWarning: Boolean get() = this == SOFT_CAP_WARNING
}

fun hoursBetween(
    start: Instant,
    end: Instant,
): Double = (end - start).toDouble(DurationUnit.HOURS)

/**
 * §5.3 / decision #8: break → total > 40 blocks (HARD_CAP_BLOCKED), else OK;
 * regular/spring-fling → total > 20 warns (SOFT_CAP_WARNING), else OK. "Over"
 * is strictly greater — exactly at the cap is OK.
 */
fun evaluateClaimCap(
    currentWeeklyHours: Double,
    addedHours: Double,
    breakProfile: Boolean,
): ClaimCapVerdict {
    val total = currentWeeklyHours + addedHours
    return if (breakProfile) {
        if (total > BREAK_HOURS_CAP) ClaimCapVerdict.HARD_CAP_BLOCKED else ClaimCapVerdict.OK
    } else {
        if (total > SOFT_HOURS_CAP) ClaimCapVerdict.SOFT_CAP_WARNING else ClaimCapVerdict.OK
    }
}

// ===================================================================
// Drop (§5.2).
// ===================================================================

data class DropOptions(
    val canDropOccurrence: Boolean,
    val canDropPermanently: Boolean,
)

/**
 * §5.2 / decision #10: occurrence drop is always offered; permanent drop only
 * for recurring slots (SCHEDULED / PERMANENT_PICKUP) and never during a break
 * profile ("Permanent drops do not apply during break profiles"). A this-week
 * TEMP_PICKUP is not a recurring slot → occurrence-only.
 */
fun dropOptionsFor(
    shift: MyShift,
    breakProfile: Boolean,
): DropOptions {
    val recurring = shift.kind == AssignmentKind.SCHEDULED || shift.kind == AssignmentKind.PERMANENT_PICKUP
    return DropOptions(canDropOccurrence = true, canDropPermanently = recurring && !breakProfile)
}

data class DropPlan(
    val gapStart: Instant,
    val gapEnd: Instant,
    val midShift: Boolean,
    val shortNotice: Boolean,
)

/**
 * Floor an instant to the most recent 30-minute block boundary (= NY :00/:30).
 *
 * NY's UTC offset is always a whole number of hours (incl. across DST), so
 * flooring on the epoch-second grid equals NY-local :00/:30 flooring — this is
 * DST-safe duration arithmetic on instants, never wall-clock arithmetic
 * (invariant #6, AGENTS phase-03 note).
 */
fun roundDownToBlock(instant: Instant): Instant {
    val blockSeconds = BLOCK.inWholeSeconds
    val secs = instant.epochSeconds
    return Instant.fromEpochSeconds(secs - secs.mod(blockSeconds))
}

/**
 * §5.2 / decisions #11, #12: a mid-shift drop-from-now floors the gap start to
 * the most recent block boundary ("A drop initiated at 17:51 … produces a gap
 * of 17:30–19:00"); a whole-occurrence drop anchors the gap at the shift start.
 * `shortNotice` ⇔ the gap starts within 20 minutes of `now` (inclusive).
 */
fun planTemporaryDrop(
    shift: MyShift,
    dropFromNow: Boolean,
    now: Instant,
): DropPlan {
    val midShift = now >= shift.start && now < shift.end
    val gapStart = if (dropFromNow && midShift) roundDownToBlock(now) else shift.start
    return DropPlan(
        gapStart = gapStart,
        gapEnd = shift.end,
        midShift = midShift,
        shortNotice = gapStart <= now + SHORT_NOTICE_WINDOW,
    )
}

// ===================================================================
// Partial drop (§5.2, T2-11) — a sub-range of a coalesced card's blocks.
// ===================================================================

/**
 * The plan for dropping blocks [fromBlock, toBlock) of a coalesced card (§5.2
 * "SWs may drop a portion of a shift"): the selected block `assignment_id`s (what
 * the live `drop-shift` call posts — one contiguous run), the resulting gap, and
 * the same short-notice flag [planTemporaryDrop] computes (the WARNING anchors to
 * the gap start, not the shift start). The NY-anchored labels are precomputed here
 * so both front ends render them verbatim (and Swift needs no formatter calls).
 */
data class PartialDropPlan(
    val blockIds: List<String>,
    val gapStart: Instant,
    val gapEnd: Instant,
    val wholeShift: Boolean,
    val shortNotice: Boolean,
    val rangeLabel: String, // "17:30 – 19:00"
    val durationLabel: String, // "1h 30m"
    val gapStartLabel: String, // "17:30"
    val gapEndLabel: String, // "19:00"
)

/**
 * Plan a drop of blocks [fromBlock, toBlock) (block indexes on the shift's own
 * 30-min grid, [toBlock] exclusive). Indexes are clamped to a non-empty range. A
 * card whose `blockIds` don't sub-divide (a single hand-built span, e.g. legacy
 * demo data) always plans the whole shift — partial selection needs real per-block
 * ids to target.
 */
fun planPartialDrop(
    shift: MyShift,
    fromBlock: Int,
    toBlock: Int,
    now: Instant,
): PartialDropPlan {
    val n = shift.blockIds.size
    val from = fromBlock.coerceIn(0, n - 1)
    val to = toBlock.coerceIn(from + 1, n)
    val gapStart = shift.start + BLOCK * from
    // Anchor the gap end at the SHIFT end and walk back, so a 1-id multi-hour span
    // (n=1) still plans gapEnd = shift.end rather than start + 30m.
    val gapEnd = shift.end - BLOCK * (n - to)
    return PartialDropPlan(
        blockIds = shift.blockIds.subList(from, to),
        gapStart = gapStart,
        gapEnd = gapEnd,
        wholeShift = from == 0 && to == n,
        shortNotice = gapStart <= now + SHORT_NOTICE_WINDOW,
        rangeLabel = formatTimeRange(gapStart, gapEnd),
        durationLabel = formatDuration(gapStart, gapEnd),
        gapStartLabel = formatBlockTime(gapStart),
        gapEndLabel = formatBlockTime(gapEnd),
    )
}

/**
 * The index of the block containing [now] on the shift's own grid, or null when
 * [now] is outside the shift — drives the §5.2 mid-shift "drop from now" quick
 * action ("a drop initiated at 17:51 … produces a gap of 17:30–19:00": index 5 of
 * a 15:00 shift). Duration arithmetic on instants (invariant #6).
 */
fun blockIndexAt(
    shift: MyShift,
    now: Instant,
): Int? =
    if (now < shift.start || now >= shift.end) {
        null
    } else {
        ((now - shift.start).inWholeMinutes / BLOCK.inWholeMinutes).toInt()
    }

/**
 * The displayed sub-shift covering [plan]'s selected range — what the live drop
 * posts (its `blockIds` are the run `drop-shift` receives) and what the drop sheet
 * summarizes. Keeps every treatment flag; the id is the first selected block
 * (a real `assignment_id`, and the id the re-coalesced dropped card will carry).
 */
fun subShiftFor(
    shift: MyShift,
    plan: PartialDropPlan,
): MyShift =
    shift.copy(
        id = plan.blockIds.first(),
        start = plan.gapStart,
        end = plan.gapEnd,
        blockIds = plan.blockIds,
    )

/** Optimistic local section move: flag the shift as dropped-still-open (decision #13). */
fun applyTemporaryDrop(
    shifts: List<MyShift>,
    shiftId: String,
): List<MyShift> = applyTemporaryDrop(shifts, setOf(shiftId))

/**
 * Block-set form of [applyTemporaryDrop]: flag every block whose id is in [blockIds]
 * — a coalesced card drops all (or, for a partial §5.2 drop, a sub-range of) its
 * constituent per-block rows.
 */
fun applyTemporaryDrop(
    shifts: List<MyShift>,
    blockIds: Set<String>,
): List<MyShift> = shifts.map { if (it.id in blockIds) it.copy(droppedStillOpen = true) else it }

/** Reverse of [applyTemporaryDrop]: the worker reclaims a shift no one else took (§5.2). */
fun reclaimDroppedShift(
    shifts: List<MyShift>,
    shiftId: String,
): List<MyShift> = reclaimDroppedShift(shifts, setOf(shiftId))

/** Block-set form of [reclaimDroppedShift] (see [applyTemporaryDrop]'s block-set form). */
fun reclaimDroppedShift(
    shifts: List<MyShift>,
    blockIds: Set<String>,
): List<MyShift> = shifts.map { if (it.id in blockIds) it.copy(droppedStillOpen = false) else it }
