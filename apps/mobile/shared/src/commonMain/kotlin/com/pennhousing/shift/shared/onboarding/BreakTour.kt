package com.pennhousing.shift.shared.onboarding

/*
 * BreakTour — the interactive "Break calendar" onboarding tour (shared, PURE).
 *
 * Teaches the claim-based break-shift picker (`BreakCalendarView`): a multi-lane grid
 * (one lane per required desk seat) where hours open to everyone at once on a first-come,
 * first-served basis, claimed with a press-then-drag gesture (no native affordance), and
 * un-claimed with the same gesture over the worker's own hours.
 *
 * Everything here is a deterministic transform: no clock, no I/O. The step copy is fixed;
 * the sample grid (which seats are already taken by named others, which are already the
 * worker's own) is fixed data so both platforms render the identical demo. The live drag
 * state (selection range + lane) is owned by the platform view, which calls the pure
 * formatting helpers below for the summary line the pinned action bar shows, mirroring how
 * `ShiftTour.summaryLine` backs the "Manage a shift" tour's step 2.
 *
 * `viewmodel/BreakTourViewModel` is the thin StateFlow wrapper that sequences the three
 * steps; this object owns the copy + the sample grid + the summary math.
 */

/** The three tour steps, in order. */
enum class BreakTourStepId {
    LAYOUT,
    CLAIM,
    DROP,
}

/** One step's fixed copy: a kicker ("STEP 1"), a title, and a one-line body. */
data class BreakTourStep(
    val id: BreakTourStepId,
    val kicker: String,
    val title: String,
    val body: String,
)

/** One already-taken seat shown on the step-1/step-2 sample grid (orientation only). */
data class BreakTourTakenSeat(
    val blockIndex: Int,
    val lane: Int,
    val workerName: String,
)

object BreakTour {
    /** Persisted once the tour is finished OR skipped, so it never auto-fires again. Its own
     * namespace, separate from `ShiftTour.DONE_KEY` and every other tour. */
    const val DONE_KEY: String = "tour.breaks.done"

    // ----- The sample break grid the whole tour plays out on -----

    /** Minutes-past-midnight of the sample grid's first block (08:00). */
    const val SAMPLE_START_MINUTES: Int = 8 * 60

    /** One shift block is 30 minutes (block atomicity, invariant #5). */
    const val BLOCK_MINUTES: Int = 30

    /** The sample grid spans 08:00 to 11:00 = 3h = 6 thirty-minute blocks. */
    const val SAMPLE_BLOCK_COUNT: Int = 6

    /** Two lanes ("Desk 1" / "Desk 2"), mirroring a two-staff house's break window. */
    const val LANE_COUNT: Int = 2

    /** The lane header labels, matching `BreakCalendarView.deskHeader`'s "Desk n" copy. */
    val LANE_LABELS: List<String> = listOf("Desk 1", "Desk 2")

    /**
     * Step 1's static orientation: a couple of cells already "Taken" by other named workers,
     * so the worker sees real occupied-seat chrome before anything is interactive. Also
     * present (still read-only) behind step 2's live claim.
     */
    val TAKEN_SEATS: List<BreakTourTakenSeat> =
        listOf(
            BreakTourTakenSeat(blockIndex = 0, lane = 0, workerName = "Priya"),
            BreakTourTakenSeat(blockIndex = 1, lane = 0, workerName = "Priya"),
            BreakTourTakenSeat(blockIndex = 4, lane = 1, workerName = "Marcus"),
            BreakTourTakenSeat(blockIndex = 5, lane = 1, workerName = "Marcus"),
        )

    /** The lane step 3's already-claimed ("You") blocks live on. */
    const val MINE_LANE: Int = 0

    /** Step 3's pre-set "You" blocks (09:00 to 10:30), so a real drop-drag has something to
     * flip mid-tour. */
    val MINE_BLOCKS: List<Int> = listOf(2, 3, 4)

    /**
     * The three steps. Copy is crisp + neutral, sentence case, no marketing, and (per the
     * house rule) contains no em or en dashes. Step 3's body is rendered richly on-platform
     * (the word "Open" gets the pending/amber accent) but is stored here as one flat string
     * so the dash check and any plain-text consumer see the exact same copy.
     */
    val STEPS: List<BreakTourStep> =
        listOf(
            BreakTourStep(
                id = BreakTourStepId.LAYOUT,
                kicker = "STEP 1",
                title = "First come, first served",
                body = "Break coverage opens for everyone at once. Grab the hours you want before someone else does.",
            ),
            BreakTourStep(
                id = BreakTourStepId.CLAIM,
                kicker = "STEP 2",
                title = "Press and drag to claim",
                body = "Press and drag down a desk to claim a range. Slide sideways to pick a different desk.",
            ),
            BreakTourStep(
                id = BreakTourStepId.DROP,
                kicker = "STEP 3",
                title = "Change your mind",
                body = "Drag over hours you claimed to drop them. Anything left unclaimed moves to Open shifts.",
            ),
        )

    /** The number of steps (stable readout for the "n of N" progress). */
    val STEP_COUNT: Int = STEPS.size

    /** True while the tour still needs to auto-show (not yet finished or skipped). */
    fun shouldAutoShow(seen: Set<String>): Boolean = DONE_KEY !in seen

    // ----- Pure grid formatting (shared by steps 2 and 3's live summaries) -----

    private fun clampBlock(index: Int): Int = index.coerceIn(0, SAMPLE_BLOCK_COUNT)

    /**
     * A 24-hour "H:MM" label for a block boundary index on the sample grid, e.g. 0 -> 8:00,
     * 1 -> 8:30, 4 -> 10:00, 6 -> 11:00.
     */
    fun timeLabel(blockIndex: Int): String {
        val minutes = SAMPLE_START_MINUTES + clampBlock(blockIndex) * BLOCK_MINUTES
        val hour = minutes / 60
        val minute = minutes % 60
        val mm = if (minute < 10) "0$minute" else "$minute"
        return "$hour:$mm"
    }

    /**
     * A human duration for a span of [blocks] thirty-minute blocks: "30m", "1h", "1h 30m",
     * "3h". Zero or negative spans read as "0m".
     */
    fun durationLabel(blocks: Int): String {
        if (blocks <= 0) return "0m"
        val totalMinutes = blocks * BLOCK_MINUTES
        val hours = totalMinutes / 60
        val minutes = totalMinutes % 60
        return when {
            hours == 0 -> "${minutes}m"
            minutes == 0 -> "${hours}h"
            else -> "${hours}h ${minutes}m"
        }
    }

    /** A lane label, clamped to a known lane so a stray index never crashes the summary. */
    fun laneLabel(lane: Int): String = LANE_LABELS.getOrElse(lane) { LANE_LABELS.first() }

    /**
     * Step-2's live claim summary, recomputed as the worker drags, e.g. "Claiming 1h 30m ·
     * 09:00 to 10:30 · Desk 2". The middot separators are not dashes; the range uses "to".
     */
    fun claimSummary(
        fromBlock: Int,
        toBlock: Int,
        lane: Int,
    ): String {
        val from = clampBlock(fromBlock)
        val to = clampBlock(toBlock).coerceAtLeast(from + 1)
        val duration = durationLabel(to - from)
        return "Claiming $duration · ${timeLabel(from)} to ${timeLabel(to)} · ${laneLabel(lane)}"
    }

    /**
     * Step-3's live drop summary over the actual overlap with the worker's own claimed
     * blocks (not the whole drag span), so the pinned bar never claims a drop that isn't
     * really selected. [fromBlock] < 0 (or an empty/inverted range) reads as no overlap yet,
     * the neutral pre-drag prompt, matching the real action bar's behavior of only showing a
     * drop message once a drop is actually pending. [toBlock] is exclusive.
     *
     * Takes primitive block bounds (not a `List<Int>`) so the call is a plain value crossing
     * the Kotlin/Swift boundary in either direction; pair with [overlappingMineBlocks] (whose
     * `List<Int>` result Swift only ever READS, the safe direction) to get [fromBlock] /
     * [toBlock] from a live drag.
     */
    fun dropSummary(
        fromBlock: Int,
        toBlock: Int,
    ): String {
        if (fromBlock < 0 || toBlock <= fromBlock) return "Drag over your hours to drop them"
        val duration = durationLabel(toBlock - fromBlock)
        return "Dropping $duration · ${timeLabel(fromBlock)} to ${timeLabel(toBlock)}"
    }

    /**
     * The subset of [MINE_BLOCKS] (on [MINE_LANE]) actually covered by a drag over
     * [fromBlock, toBlock) on [lane]. Empty when the drag is on a different lane or doesn't
     * overlap any claimed block, exactly like the real screen only offers a drop for blocks
     * that are genuinely the worker's own.
     */
    fun overlappingMineBlocks(
        fromBlock: Int,
        toBlock: Int,
        lane: Int,
    ): List<Int> {
        if (lane != MINE_LANE) return emptyList()
        val from = clampBlock(fromBlock)
        val to = clampBlock(toBlock).coerceAtLeast(from + 1)
        return MINE_BLOCKS.filter { it in from until to }.sorted()
    }
}
