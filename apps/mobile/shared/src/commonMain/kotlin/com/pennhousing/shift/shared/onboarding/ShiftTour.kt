package com.pennhousing.shift.shared.onboarding

/*
 * ShiftTour — the interactive "Manage a shift" onboarding tour (shared, PURE).
 *
 * This is the richer successor to the plain `TipTrigger.MY_SHIFTS` contextual tip
 * (`Onboarding.CONTEXTUAL_TIPS`). Where that tip was one grey paragraph, this tour is a
 * three-step gesture demo that plays out on a sample My-Shifts card so the worker *sees*
 * the three outcomes (drop / swap / hand off), *does* the part-or-all range pick, and
 * *watches* where the shift lands.
 *
 * Everything here is a deterministic transform: no clock, no I/O. The step copy is fixed,
 * and the step-2 controls (range, one-time vs permanent) are rendered natively per
 * platform, which just call the pure formatting helpers below for the live summary line.
 * The seen-flag is persisted by the platform (its own UserDefaults / SharedPreferences
 * key), mirroring how every other tour stores its seen-keys.
 *
 * The `viewmodel/ShiftTourViewModel` is the thin StateFlow wrapper that sequences the
 * three steps; this object owns the copy + the sample shift + the summary math.
 */

/**
 * The actions the tour teaches, surfaced as chips in step 1. DROP is one top-level intent;
 * SWAP and HAND_OFF are the two sides of the second intent (a two-way swap vs a one-way
 * hand off to a chosen housemate), so the UI groups them. This mirrors the real Manage
 * sheet: two top-level intents (Drop / Swap), with hand-off a sub-mode inside Swap.
 */
enum class ShiftTourAction {
    DROP,
    SWAP,
    HAND_OFF,
}

/** The three tour steps, in order. */
enum class ShiftTourStepId {
    MANAGE,
    AMOUNT,
    DESTINATION,
}

/** One step's fixed copy: a kicker ("STEP 1"), a title, and a one-line body. */
data class ShiftTourStep(
    val id: ShiftTourStepId,
    val kicker: String,
    val title: String,
    val body: String,
)

object ShiftTour {
    /** Persisted once the tour is finished OR skipped, so it never auto-fires again. */
    const val DONE_KEY: String = "tour.myshifts.done"

    // ----- The sample shift the whole tour plays out on (prototype parity) -----

    /** The house shown on the sample card. */
    const val SAMPLE_HOUSE: String = "Harnwell"

    /** Minutes-past-midnight of the sample shift's start (16:00). */
    const val SAMPLE_START_MINUTES: Int = 16 * 60

    /** One shift block is 30 minutes (block atomicity, invariant #5). */
    const val BLOCK_MINUTES: Int = 30

    /** The sample shift is 16:00 to 20:00 = 4h = 8 thirty-minute blocks. */
    const val SAMPLE_BLOCK_COUNT: Int = 8

    // The step-2 range starts pre-set to the back half (18:00 to 20:00), so the live
    // summary reads as a real partial give the moment the step opens, and the worker can
    // drag either handle to change it. Block indices on the sample grid, [from, to).
    const val DEFAULT_FROM_BLOCK: Int = 4
    const val DEFAULT_TO_BLOCK: Int = SAMPLE_BLOCK_COUNT

    /** The chip order for step 1: Drop, then the grouped Swap + Hand off. */
    val ACTIONS: List<ShiftTourAction> = listOf(ShiftTourAction.DROP, ShiftTourAction.SWAP, ShiftTourAction.HAND_OFF)

    /**
     * The three steps. Copy is crisp + neutral, sentence case, no marketing, and (per the
     * house rule) contains no em or en dashes. Step 2's body says "drag" because the real
     * control it mirrors is the two-handle range slider, not a tap target.
     */
    val STEPS: List<ShiftTourStep> =
        listOf(
            ShiftTourStep(
                id = ShiftTourStepId.MANAGE,
                kicker = "STEP 1",
                title = "Manage a shift",
                body = "Tap a shift, then pick what to do with it.",
            ),
            ShiftTourStep(
                id = ShiftTourStepId.AMOUNT,
                kicker = "STEP 2",
                title = "Part or all",
                body = "Drag to choose how much of the shift to give.",
            ),
            ShiftTourStep(
                id = ShiftTourStepId.DESTINATION,
                kicker = "STEP 3",
                title = "Where it goes",
                body = "Dropped shifts land in Open for anyone to grab. Swaps go to the Swaps tab for approval.",
            ),
        )

    /** The number of steps (stable readout for the "n of N" progress). */
    val STEP_COUNT: Int = STEPS.size

    /** True while the tour still needs to auto-show (not yet finished or skipped). */
    fun shouldAutoShow(seen: Set<String>): Boolean = DONE_KEY !in seen

    // ----- Pure step-2 formatting (the live summary line) -----

    /** Clamp a block index into the sample grid. */
    private fun clampBlock(index: Int): Int = index.coerceIn(0, SAMPLE_BLOCK_COUNT)

    /**
     * A 24-hour "H:MM" label for a block boundary index on the sample grid, e.g. 0 -> 16:00,
     * 1 -> 16:30, 4 -> 18:00, 8 -> 20:00.
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
     * "4h". Zero or negative spans read as "0m" (the UI keeps at least one block selected).
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

    /**
     * The step-2 live summary, recomputed as the worker drags the range or flips the scope,
     * e.g. "Giving 2h · 18:00 to 20:00 · this week" (or "· permanently" when Permanent is
     * selected). The middot separators are not dashes; the range uses "to", never an en dash.
     */
    fun summaryLine(
        fromBlock: Int,
        toBlock: Int,
        permanent: Boolean,
    ): String {
        val from = clampBlock(fromBlock)
        val to = clampBlock(toBlock).coerceAtLeast(from + 1)
        val duration = durationLabel(to - from)
        val scope = if (permanent) "permanently" else "this week"
        return "Giving $duration · ${timeLabel(from)} to ${timeLabel(to)} · $scope"
    }
}
