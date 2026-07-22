package com.pennhousing.shift.shared.onboarding

/*
 * HouseGridTour — the interactive "House grid" onboarding tour (shared, PURE).
 *
 * This is the richer successor to the plain `TipTrigger.HOUSE_GRID` contextual tip
 * ("Call the desk" / "Tap any name in the grid to call that person or the desk. Use the
 * house name at the top to view another house."). That tip compressed three distinct
 * lessons (the frozen rail + scroll, the tap-a-name affordance, the house/week switchers,
 * and what a blank block means) into one paragraph. This tour splits them into three
 * single-focus steps that play out on a faithful mini version of the real House grid
 * (ContentView.swift `houseTab`/`houseGrid`), mirroring the shape of `ShiftTour`.
 *
 * Everything here is a deterministic transform: no clock, no I/O. The step copy is fixed;
 * the sample grid data (house/day/worker labels) is fixed sample content, not live data.
 * The seen-flag is persisted by the platform (its own UserDefaults / SharedPreferences
 * key, separate from every other tour's), mirroring `ShiftTour.DONE_KEY`.
 *
 * `viewmodel/HouseGridTourViewModel` is the thin StateFlow wrapper that sequences the
 * three steps; this object owns the copy + the sample grid content.
 */

/** The three tour steps, in order. */
enum class HouseGridTourStepId {
    FIND_WHO,
    SWITCH_HOUSE,
    EMPTY_SEAT,
}

/** One step's fixed copy: a kicker ("STEP 1"), a title, and a one-line body. */
data class HouseGridTourStep(
    val id: HouseGridTourStepId,
    val kicker: String,
    val title: String,
    val body: String,
)

object HouseGridTour {
    /** Persisted once the tour is finished OR skipped, so it never auto-fires again. Own
     * namespace, separate from `ShiftTour.DONE_KEY` and every other tour's done-key. */
    const val DONE_KEY: String = "tour.housegrid.done"

    // ----- The sample grid the whole tour plays out on (prototype parity with the real
    // House screen: frozen time rail, day-header row, day columns of desk blocks) -----

    /** The house shown on the sample stage (matches the reference tour's sample house). */
    const val SAMPLE_HOUSE: String = "Harnwell"

    /** Sample day labels shown as the frozen header row (Mon, Tue, Wed). */
    val SAMPLE_DAYS: List<String> = listOf("Mon", "Tue", "Wed")

    /** Sample worker name shown in the pulsed name cell (step 1). */
    const val SAMPLE_WORKER_NAME: String = "Priya N."

    /** The number of steps (stable readout for the "n of N" progress). */
    val STEP_COUNT: Int get() = STEPS.size

    /**
     * The three steps. Copy is crisp + neutral, sentence case, no marketing, and (per the
     * house rule) contains no em or en dashes. Step 3's body carries rich emphasis on the
     * word "Open" (rendered in the pending/amber accent by the platform); [body] here is
     * the plain-text fallback / accessibility string.
     */
    val STEPS: List<HouseGridTourStep> =
        listOf(
            HouseGridTourStep(
                id = HouseGridTourStepId.FIND_WHO,
                kicker = "STEP 1",
                title = "Find who's on",
                body = "Scroll to see the day and time. Tap any name to call them or the desk.",
            ),
            HouseGridTourStep(
                id = HouseGridTourStepId.SWITCH_HOUSE,
                kicker = "STEP 2",
                title = "Switch house or week",
                body = "Use the house name to view another house you can cover. The week bar moves you forward or back.",
            ),
            HouseGridTourStep(
                id = HouseGridTourStepId.EMPTY_SEAT,
                kicker = "STEP 3",
                title = "An empty seat",
                body = "A blank block means nobody is covering it yet. Check Open shifts to pick it up.",
            ),
        )

    /** True while the tour still needs to auto-show (not yet finished or skipped). */
    fun shouldAutoShow(seen: Set<String>): Boolean = DONE_KEY !in seen
}
