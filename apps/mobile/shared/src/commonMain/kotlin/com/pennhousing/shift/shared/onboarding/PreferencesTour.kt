package com.pennhousing.shift.shared.onboarding

/*
 * PreferencesTour — the interactive "Preferences" (availability paint) onboarding tour
 * (shared, PURE). Same three-tier reasoning and shape as `ShiftTour` (see
 * docs/design/interactive-onboarding-pattern.md): the plain contextual tip taught one idea
 * ("paint your availability"), but the real screen has a non-standard press-and-drag paint
 * gesture (principle 4) plus a mode-then-paint-then-target sequence worth chunking into three
 * single-focus steps (principle 2). This tour plays out on a sample day timeline so the worker
 * *picks* a brush, *does* the press-and-drag paint themselves, and *sets* a sample target.
 *
 * Everything here is a deterministic transform: no clock, no I/O. The step copy is fixed; the
 * step-2 sample paint state (which blocks are painted, with which brush) is rendered natively
 * per platform, which calls the pure formatting helpers below for the live "painted" readout.
 * The seen-flag is persisted by the platform (its own UserDefaults / SharedPreferences key),
 * with its OWN namespace, separate from `ShiftTour` and every other tour.
 *
 * The `viewmodel/PreferencesTourViewModel` is the thin StateFlow wrapper that sequences the
 * three steps; this object owns the copy + the sample grid + the summary math.
 */

/**
 * The tri-state brush the tour teaches in step 1, in the same order as the real screen's
 * brush selector (Available, Preferred, Cannot). This is a tour-local enum (mirrors
 * `ShiftTourAction`'s relationship to the real drop/swap flow) rather than a reuse of the real
 * `PrefBrush`, so the pure tour module stays self-contained.
 */
enum class PreferencesTourBrush {
    AVAILABLE,
    PREFERRED,
    CANNOT,
}

/** The three tour steps, in order. */
enum class PreferencesTourStepId {
    MODE,
    PAINT,
    TARGET,
}

/** One step's fixed copy: a kicker ("STEP 1"), a title, and a one-line body. */
data class PreferencesTourStep(
    val id: PreferencesTourStepId,
    val kicker: String,
    val title: String,
    val body: String,
)

object PreferencesTour {
    /** Persisted once the tour is finished OR skipped, so it never auto-fires again. Its own
     * namespace, separate from `ShiftTour.DONE_KEY` and every other tour's done-key. */
    const val DONE_KEY: String = "tour.preferences.done"

    /** Brush order for step 1's live selector (mirrors `PREF_BRUSH_ORDER`): Available, Preferred, Cannot. */
    val BRUSHES: List<PreferencesTourBrush> =
        listOf(PreferencesTourBrush.AVAILABLE, PreferencesTourBrush.PREFERRED, PreferencesTourBrush.CANNOT)

    /** The brush pre-selected when the tour opens, and the one step 2's sample paint uses. */
    val DEFAULT_BRUSH: PreferencesTourBrush = PreferencesTourBrush.PREFERRED

    /** One shift block is 30 minutes (block atomicity, invariant #5). */
    const val BLOCK_MINUTES: Int = 30

    // ----- The sample day timeline step 2 plays out on -----

    /** Minutes-past-midnight of the sample timeline's start (9:00 AM). */
    const val SAMPLE_START_MINUTES: Int = 9 * 60

    /** The sample timeline is 9:00 AM to 1:00 PM = 4h = 8 thirty-minute blocks. */
    const val SAMPLE_BLOCK_COUNT: Int = 8

    // ----- The sample target-hours card step 3 plays out on -----

    /** The target shown when the tour opens (mirrors a typical mid-range pick). */
    const val SAMPLE_TARGET_HOURS: Int = 12

    /** The soft cap the sample progress bar is measured against (`PREF_DEFAULT_CAP_HOURS`). */
    const val SAMPLE_CAP_HOURS: Int = 20

    /** The stepper increment (mirrors `PREF_TARGET_STEP`). */
    const val TARGET_STEP: Int = 2

    /**
     * The three steps. Copy is crisp + neutral, sentence case, no marketing, and (per the
     * house rule) contains no em or en dashes.
     */
    val STEPS: List<PreferencesTourStep> =
        listOf(
            PreferencesTourStep(
                id = PreferencesTourStepId.MODE,
                kicker = "STEP 1",
                title = "Pick a mode",
                body = "Choose Preferred, Available, or Cannot. The color you paint tells the scheduler what you want.",
            ),
            PreferencesTourStep(
                id = PreferencesTourStepId.PAINT,
                kicker = "STEP 2",
                title = "Press and drag to paint",
                body =
                    "Press on the hours and drag to fill them. Drag over the same color again to erase. " +
                        "Scroll the page from the time column on the left.",
            ),
            PreferencesTourStep(
                id = PreferencesTourStepId.TARGET,
                kicker = "STEP 3",
                title = "Set your target hours",
                body = "Tell the scheduler how many hours you want this period, or tick no hours to sit it out.",
            ),
        )

    /** The number of steps (stable readout for the "n of N" progress). */
    val STEP_COUNT: Int = STEPS.size

    /** True while the tour still needs to auto-show (not yet finished or skipped). */
    fun shouldAutoShow(seen: Set<String>): Boolean = DONE_KEY !in seen

    // ----- Pure step-2 formatting (the live "painted" readout) -----

    private fun clampBlock(index: Int): Int = index.coerceIn(0, SAMPLE_BLOCK_COUNT)

    /**
     * A 12-hour "H:MM AM/PM" label for a block boundary index on the sample grid, e.g.
     * 0 -> "9:00 AM", 2 -> "10:00 AM", 6 -> "12:00 PM", 8 -> "1:00 PM". This mirrors the real
     * screen's `formatClock12`, which the pure module here does not depend on so the tour stays
     * self-contained.
     */
    fun timeLabel(blockIndex: Int): String {
        val minutes = SAMPLE_START_MINUTES + clampBlock(blockIndex) * BLOCK_MINUTES
        val hour24 = (minutes / 60) % 24
        val minute = minutes % 60
        val hour12 = ((hour24 + 11) % 12) + 1
        val meridiem = if (hour24 < 12) "AM" else "PM"
        val mm = if (minute < 10) "0$minute" else "$minute"
        return "$hour12:$mm $meridiem"
    }

    /**
     * A human duration for a span of [blocks] thirty-minute blocks: "30m", "1h", "1h 30m",
     * "4h". Zero or negative spans read as "0m".
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
     * The step-2 live readout, recomputed on every frame of the worker's own drag (principle
     * 12): "No hours painted yet" while [paintedCount] is zero, else e.g. "Painted 2h · 10:00 AM
     * to 12:00 PM" for the contiguous span [fromBlock, toBlock). The middot separator is not a
     * dash; the range uses "to", never an en dash.
     */
    fun paintSummaryLine(
        paintedCount: Int,
        fromBlock: Int,
        toBlock: Int,
    ): String {
        if (paintedCount <= 0) return "No hours painted yet"
        val from = clampBlock(fromBlock)
        val to = clampBlock(toBlock).coerceAtLeast(from + 1)
        val duration = durationLabel(to - from)
        return "Painted $duration · ${timeLabel(from)} to ${timeLabel(to)}"
    }

    // ----- Pure step-3 formatting (the sample target-hours meter) -----

    /** Clamp a target into [0, capHours], stepping by [TARGET_STEP] (mirrors `clampTarget`). */
    fun clampTarget(
        value: Int,
        capHours: Int = SAMPLE_CAP_HOURS,
    ): Int = value.coerceIn(0, capHours)

    /** The stepper's mono hero label, e.g. "12h" (or "0h" when opted out). */
    fun targetLabel(hours: Int): String = "${hours}h"

    /** The progress-bar fraction of [hours] against [capHours], clamped to [0, 1]. */
    fun targetFraction(
        hours: Int,
        capHours: Int = SAMPLE_CAP_HOURS,
    ): Double {
        if (capHours <= 0) return 0.0
        return (hours.toDouble() / capHours.toDouble()).coerceIn(0.0, 1.0)
    }
}
