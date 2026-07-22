package com.pennhousing.shift.shared.onboarding

/*
 * SwapTour — the interactive swap-composer onboarding tour (shared, PURE).
 *
 * This tour opens ONLY once a worker is already inside the swap composer
 * (`SwapCalendarPage` on iOS), having already chosen "Swap it" over "Drop the shift" on
 * the prior Manage-shift screen (`ManagePageContent`'s equal-weight intent cards). That
 * Drop-vs-Swap decision is taught nowhere here, deliberately: `ShiftTour` already covers
 * it (its step 1). This tour teaches what's INSIDE the composer once you're in it: the
 * Swap-vs-Hand-off sub-mode, picking a housemate and an amount, and the segmented
 * give/take timeline for splitting a shift between two people.
 *
 * Everything here is a deterministic transform: no clock, no I/O. The step copy is fixed;
 * the step-2 range control and step-3 segment taps are rendered natively per platform,
 * which just call the pure formatting helpers below for the live summary line. The
 * seen-flag is persisted by the platform under its OWN key
 * (`swap_tour_seen_keys` on iOS), separate from `ShiftTour`'s and every other tour's.
 *
 * The `viewmodel/SwapTourViewModel` is the thin StateFlow wrapper that sequences the
 * three steps; this object owns the copy + the sample data + the summary math.
 */

/**
 * The two sub-modes taught in step 1, mirroring `SwapCalendarPage`'s `modeButton`s
 * ("Swap" / "Hand off"). Both live INSIDE the swap composer as equal-weight cards here
 * (§principle 6: this is a real two-way choice inside the composer, unlike the Drop
 * decision that already happened before this screen exists, so it is fine for these two
 * to render as equal-weight cards rather than a nested cluster).
 */
enum class SwapTourMode {
    SWAP,
    HAND_OFF,
}

/** The three tour steps, in order. */
enum class SwapTourStepId {
    MODE,
    AMOUNT,
    SPLIT,
}

/** One step's fixed copy: a kicker ("STEP 1"), a title, and a one-line (or rich) body. */
data class SwapTourStep(
    val id: SwapTourStepId,
    val kicker: String,
    val title: String,
    val body: String,
)

object SwapTour {
    /** Persisted once the tour is finished OR skipped, so it never auto-fires again. Its
     * own namespace, separate from `ShiftTour.DONE_KEY`. */
    const val DONE_KEY: String = "tour.swap.done"

    // ----- The sample data the whole tour plays out on (prototype parity) -----

    /** The house shown on the sample give shift. */
    const val SAMPLE_HOUSE: String = "Harnwell"

    /** Minutes-past-midnight of the sample give shift's start (16:00). */
    const val SAMPLE_START_MINUTES: Int = 16 * 60

    /** One shift block is 30 minutes (block atomicity, invariant #5). */
    const val BLOCK_MINUTES: Int = 30

    /** The sample give shift is 16:00 to 20:00 = 4h = 8 thirty-minute blocks. */
    const val SAMPLE_BLOCK_COUNT: Int = 8

    // The step-2 give range starts pre-set to the back half (18:00 to 20:00), so the live
    // summary reads as a real partial give the moment the step opens, and the worker can
    // drag either handle to change it. Block indices on the sample grid, [from, to).
    const val DEFAULT_FROM_BLOCK: Int = 4
    const val DEFAULT_TO_BLOCK: Int = SAMPLE_BLOCK_COUNT

    /** The sample housemate offered in the step-2 candidate/take row. */
    const val SAMPLE_CANDIDATE_NAME: String = "Jordan"

    /** The sample candidate's own fixed take-side span: 09:00 to 11:00 = 2h. Not driven
     * by the range slider (that only sizes the GIVE side, mirroring the real composer,
     * where the take side comes from the picked person's own shift). */
    const val SAMPLE_CANDIDATE_START_MINUTES: Int = 9 * 60
    const val SAMPLE_CANDIDATE_BLOCK_COUNT: Int = 4

    /**
     * The three steps. Copy is crisp + neutral, sentence case, no marketing, and (per the
     * house rule) contains no em or en dashes.
     */
    val STEPS: List<SwapTourStep> =
        listOf(
            SwapTourStep(
                id = SwapTourStepId.MODE,
                kicker = "STEP 1",
                title = "Swap or hand off",
                body = "Swap trades hours with a housemate. Hand off gives them away with nothing back.",
            ),
            SwapTourStep(
                id = SwapTourStepId.AMOUNT,
                kicker = "STEP 2",
                title = "Pick who, and how much",
                body = "Choose a housemate, then drag to set how much of the shift moves.",
            ),
            SwapTourStep(
                id = SwapTourStepId.SPLIT,
                kicker = "STEP 3",
                title = "Split it up",
                body = "Reserve part for one person, then tap a free segment to hand the rest to someone else. Swaps go to the Swaps tab for approval.",
            ),
        )

    /** The number of steps (stable readout for the "n of N" progress). */
    val STEP_COUNT: Int = STEPS.size

    /** True while the tour still needs to auto-show (not yet finished or skipped). */
    fun shouldAutoShow(seen: Set<String>): Boolean = DONE_KEY !in seen

    // ----- Pure step-2 formatting (the live give/take summary line) -----

    /** Clamp a block index into the sample give-shift grid. */
    private fun clampBlock(index: Int): Int = index.coerceIn(0, SAMPLE_BLOCK_COUNT)

    /**
     * A 24-hour "H:MM" label for a give-side block boundary index on the sample grid, e.g.
     * 0 -> 16:00, 1 -> 16:30, 4 -> 18:00, 8 -> 20:00.
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
     * The step-2 live summary, recomputed as the worker drags the give-side range or flips
     * the step-1 mode. Branches on [mode]:
     * - SWAP: "You give Xh · you get Yh" (Y is the picked housemate's own fixed take span).
     * - HAND_OFF: "Giving [name] Xh · nothing comes back" (there is no take side at all).
     * The middot separator is not a dash; no em or en dashes appear in either branch.
     */
    fun summaryLine(
        mode: SwapTourMode,
        giveFromBlock: Int,
        giveToBlock: Int,
        candidateName: String = SAMPLE_CANDIDATE_NAME,
        candidateBlocks: Int = SAMPLE_CANDIDATE_BLOCK_COUNT,
    ): String {
        val from = clampBlock(giveFromBlock)
        val to = clampBlock(giveToBlock).coerceAtLeast(from + 1)
        val giveDuration = durationLabel(to - from)
        return when (mode) {
            SwapTourMode.SWAP -> {
                val takeDuration = durationLabel(candidateBlocks)
                "You give $giveDuration · you get $takeDuration"
            }
            SwapTourMode.HAND_OFF -> "Giving $candidateName $giveDuration · nothing comes back"
        }
    }
}
