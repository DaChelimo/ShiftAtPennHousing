package com.pennhousing.shift.shared.onboarding

/*
 * OpenClaimTour — the interactive "Claim what's open" onboarding tour (shared, PURE).
 *
 * This teaches the Open Shifts / claim flow. Its single most important job: workers do
 * not realize an open shift can be claimed PERMANENTLY (a standing weekly pickup), not
 * just once for the shown week. That distinction is real on the actual screen (see
 * `ContentView.homeOpen` / `ShiftsScreen.OpenShiftsTabContent`, shared copy from
 * `OpenShiftPresentation.kt`): a "Weekly open shifts" section claims once for the week
 * shown, a separate "Permanent openings" section picks up a slot that repeats every week
 * (sheet title "Pick up permanently", confirm "Confirm pickup" / "Pick up {duration}",
 * toast "Picked up X of Y weeks"). Step 3 below is built around that real vocabulary.
 *
 * Everything here is a deterministic transform: no clock, no I/O. The step copy is fixed,
 * and the step-2 range controls + step-3 scope toggle are rendered natively per platform,
 * which just call the pure formatting helpers below for the live summary lines. The
 * seen-flag is persisted by the platform (its own UserDefaults / SharedPreferences key),
 * mirroring `ShiftTour`.
 *
 * The `viewmodel/OpenClaimTourViewModel` is the thin StateFlow wrapper that sequences the
 * three steps; this object owns the copy + the sample shift + the summary math.
 */

/** The three tour steps, in order. */
enum class OpenClaimTourStepId {
    CLAIM,
    AMOUNT,
    SCOPE,
}

/** One step's fixed copy: a kicker ("STEP 1"), a title, and a one-line body. */
data class OpenClaimTourStep(
    val id: OpenClaimTourStepId,
    val kicker: String,
    val title: String,
    val body: String,
)

object OpenClaimTour {
    /** Persisted once the tour is finished OR skipped, so it never auto-fires again. Its
     * own namespace, separate from `ShiftTour.DONE_KEY` and every other tour's key. */
    const val DONE_KEY: String = "tour.openclaim.done"

    // ----- The sample open shift the whole tour plays out on -----

    /** The house shown on the sample card. */
    const val SAMPLE_HOUSE: String = "Harnwell"

    /** Minutes-past-midnight of the sample shift's start (16:00). */
    const val SAMPLE_START_MINUTES: Int = 16 * 60

    /** One shift block is 30 minutes (block atomicity, invariant #5). */
    const val BLOCK_MINUTES: Int = 30

    /** The sample shift is 16:00 to 20:00 = 4h = 8 thirty-minute blocks. */
    const val SAMPLE_BLOCK_COUNT: Int = 8

    // The step-2 range starts pre-set to the back half (18:00 to 20:00), so the live
    // summary reads as a real partial claim the moment the step opens, and the worker can
    // drag either handle to change it. Block indices on the sample grid, [from, to).
    const val DEFAULT_FROM_BLOCK: Int = 4
    const val DEFAULT_TO_BLOCK: Int = SAMPLE_BLOCK_COUNT

    // Step 3 opens on the weekly (one-time) state, matching the real default: the
    // "Weekly open shifts" section is the primary/first feed and most claims are one-off.
    const val DEFAULT_PERMANENT: Boolean = false

    /**
     * The three steps. Copy is crisp + neutral, sentence case, no marketing, and (per the
     * house rule) contains no em or en dashes. Step 3's body states, in the real screen's
     * own wording, what a permanent pickup does: it repeats every week, not just once.
     */
    val STEPS: List<OpenClaimTourStep> =
        listOf(
            OpenClaimTourStep(
                id = OpenClaimTourStepId.CLAIM,
                kicker = "STEP 1",
                title = "Claim what's open",
                body = "Tap any open shift to claim it. Switch between My House and Others to see more.",
            ),
            OpenClaimTourStep(
                id = OpenClaimTourStepId.AMOUNT,
                kicker = "STEP 2",
                title = "Part or all",
                body = "Drag to choose how much you can cover.",
            ),
            OpenClaimTourStep(
                id = OpenClaimTourStepId.SCOPE,
                kicker = "STEP 3",
                title = "Every week, or just this once",
                body =
                    "Shifts under Permanent openings repeat every week, not just the one shown. " +
                        "Picking one up adds it to your schedule for good. Shifts under Weekly open " +
                        "shifts claim only this week.",
            ),
        )

    /** The number of steps (stable readout for the "n of N" progress). */
    val STEP_COUNT: Int = STEPS.size

    /** True while the tour still needs to auto-show (not yet finished or skipped). */
    fun shouldAutoShow(seen: Set<String>): Boolean = DONE_KEY !in seen

    // ----- Pure step-2 formatting (the live claim-amount summary line) -----

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
     * The step-2 live summary, recomputed as the worker drags the range, e.g.
     * "Covering 2h · 18:00 to 20:00". The middot separator is not a dash; the range uses
     * "to", never an en dash.
     */
    fun summaryLine(
        fromBlock: Int,
        toBlock: Int,
    ): String {
        val from = clampBlock(fromBlock)
        val to = clampBlock(toBlock).coerceAtLeast(from + 1)
        val duration = durationLabel(to - from)
        return "Covering $duration · ${timeLabel(from)} to ${timeLabel(to)}"
    }

    // ----- Pure step-3 formatting (the live scope summary line) -----

    /**
     * The step-3 live summary, recomputed the moment the worker flips the scope toggle. It
     * echoes the REAL claim-sheet's own title strings so the tour never invents wording the
     * live screen doesn't use ("Claim shift" / "Pick up permanently"), plus a one-line
     * consequence so the flip's effect is visible immediately (principle 12).
     */
    fun scopeSummary(permanent: Boolean): String =
        if (permanent) {
            "Pick up permanently · repeats every week"
        } else {
            "Claim shift · this week only"
        }
}
