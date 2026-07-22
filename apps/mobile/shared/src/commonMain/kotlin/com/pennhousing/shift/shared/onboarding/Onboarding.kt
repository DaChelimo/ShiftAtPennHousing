package com.pennhousing.shift.shared.onboarding

/*
 * Onboarding — PURE presentation logic shared by both platforms (the onboarding
 * analogue of Settings / MyShiftPresentation). NO clock and NO I/O: the set of
 * already-seen keys is injected, and every function is a deterministic transform.
 *
 * The program is three layers (see the onboarding plan):
 *  1. A short first-run WELCOME tour (spotlight coach-marks) that only orients the
 *     worker to the five bottom tabs + the Assistant. Fires once.
 *  2. Just-in-time CONTEXTUAL TIPS: a single card the first time a worker lands on a
 *     surface (Manage sheet, Open shifts, an incoming swap, break window, a float).
 *     Teaches at the point of need instead of front-loading everything.
 *  3. The written how-to guides (scripts/desk-assistant/app-guides), which feed the
 *     Assistant. Not modeled here; that layer is content + the Assistant screen.
 *
 * Persistence of the seen-keys is a platform concern (SharedPreferences on Android,
 * UserDefaults on iOS), mirroring how the appearance choice is stored. These are
 * per-device UX flags, not server state.
 */

/**
 * A UI element the spotlight can highlight. [NONE] renders the coach-mark as a
 * centered card with no cutout (welcome / finish steps).
 */
enum class OnboardingTarget {
    NONE,
    MY_SHIFTS_TAB,
    OPEN_TAB,
    HOUSE_TAB,
    SWAPS_TAB,
    MORE_TAB,
    ASSISTANT_BUTTON,
}

/** One coach-mark: a stable [key] (persisted once seen), what it points at, and its copy. */
data class CoachMark(
    val key: String,
    val target: OnboardingTarget,
    val title: String,
    val body: String,
)

/**
 * The surfaces that raise a one-time contextual tip on first visit. Each maps to a
 * root-level moment (a tab selection, a banner or card appearing) so the tip renders
 * reliably above content on both platforms without fighting a modal sheet's z-order.
 */
enum class TipTrigger {
    MY_SHIFTS,
    OPEN_SHIFTS,
    INCOMING_SWAP,
    BREAK_WINDOW,
    HOUSE_GRID,
    FLOAT_REQUEST,
}

object Onboarding {
    /** Set once the welcome tour is finished OR skipped, so it never fires again. */
    const val WELCOME_DONE_KEY: String = "tour.welcome.done"

    /**
     * Layer 1 — the first-run orientation tour. Short by design: one welcome card, the
     * five bottom tabs, and the Assistant. Orientation, not instruction; the flows are
     * taught later as contextual tips (Layer 2).
     */
    val WELCOME_TOUR: List<CoachMark> =
        listOf(
            CoachMark(
                key = "tour.welcome.intro",
                target = OnboardingTarget.NONE,
                title = "Welcome to Shift",
                body = "A quick tour of where things are. It takes about 20 seconds, and you can skip it any time.",
            ),
            CoachMark(
                key = "tour.welcome.myshifts",
                target = OnboardingTarget.MY_SHIFTS_TAB,
                title = "My Shifts",
                body = "Your schedule lives here. Tap any shift to drop it or swap it, and check your hours for the week.",
            ),
            CoachMark(
                key = "tour.welcome.open",
                target = OnboardingTarget.OPEN_TAB,
                title = "Open",
                body = "Pick up extra hours. Claim open shifts in your house or at other houses you can cover.",
            ),
            CoachMark(
                key = "tour.welcome.house",
                target = OnboardingTarget.HOUSE_TAB,
                title = "House",
                body = "See who is on the desk right now. Tap a name to call that person or the desk.",
            ),
            CoachMark(
                key = "tour.welcome.swaps",
                target = OnboardingTarget.SWAPS_TAB,
                title = "Swaps",
                body = "Swap and hand off requests show up here. Accept or decline the ones waiting on you.",
            ),
            CoachMark(
                key = "tour.welcome.more",
                target = OnboardingTarget.MORE_TAB,
                title = "More",
                body = "Break shifts, preferences, updates and settings all live in here.",
            ),
            CoachMark(
                key = "tour.welcome.assistant",
                target = OnboardingTarget.ASSISTANT_BUTTON,
                title = "Ask anything",
                body = "Not sure how to do something? Ask the assistant. It explains how to use the app in seconds.",
            ),
        )

    /**
     * Layer 2 — the contextual tips, keyed by the surface that raises them. Each fires
     * once, the first time the worker reaches that surface, and points at the relevant
     * area. Copy stays short: enough to unblock the action, not a manual.
     */
    val CONTEXTUAL_TIPS: Map<TipTrigger, CoachMark> =
        mapOf(
            TipTrigger.MY_SHIFTS to
                CoachMark(
                    key = "tip.my_shifts",
                    target = OnboardingTarget.NONE,
                    title = "Manage your shifts",
                    body =
                        "Tap any shift to drop it, swap it, or hand it off to a housemate. You can give " +
                            "just part of a shift, or make it permanent.",
                ),
            TipTrigger.OPEN_SHIFTS to
                CoachMark(
                    key = "tip.open_shifts",
                    target = OnboardingTarget.NONE,
                    title = "Claiming shifts",
                    body =
                        "Tap any open shift to claim it. You can cover just part of it, and some shifts " +
                            "can be picked up every week.",
                ),
            TipTrigger.INCOMING_SWAP to
                CoachMark(
                    key = "tip.incoming_swap",
                    target = OnboardingTarget.NONE,
                    title = "Someone wants to swap",
                    body =
                        "Check You give and You get, then Accept or Decline. Respond before the " +
                            "deadline shown on the card.",
                ),
            TipTrigger.BREAK_WINDOW to
                CoachMark(
                    key = "tip.break_window",
                    target = OnboardingTarget.NONE,
                    title = "Break shifts are open",
                    body =
                        "Break coverage is first come, first served. Open Break shifts and drag on the " +
                            "calendar to claim your hours.",
                ),
            TipTrigger.HOUSE_GRID to
                CoachMark(
                    key = "tip.house_grid",
                    target = OnboardingTarget.NONE,
                    title = "Call the desk",
                    body =
                        "Tap any name in the grid to call that person or the desk. Use the house name at " +
                            "the top to view another house.",
                ),
            TipTrigger.FLOAT_REQUEST to
                CoachMark(
                    key = "tip.float_request",
                    target = OnboardingTarget.NONE,
                    title = "You are needed at another desk",
                    body =
                        "This is a float request. Your total hours do not change, it just moves a shift. " +
                            "Accept or Decline before the countdown ends.",
                ),
        )

    /** True while the welcome tour still needs to run (not yet finished or skipped). */
    fun shouldShowWelcomeTour(seen: Set<String>): Boolean = WELCOME_DONE_KEY !in seen

    /**
     * The tip for [trigger], or null if it has already been seen or the welcome tour has
     * not finished yet. Gating on the welcome tour keeps orientation and point-of-need
     * teaching from overlapping; a skipped tour still counts as done, so skippers still
     * get tips.
     */
    fun tipFor(
        trigger: TipTrigger,
        seen: Set<String>,
    ): CoachMark? {
        if (shouldShowWelcomeTour(seen)) return null
        val tip = CONTEXTUAL_TIPS[trigger] ?: return null
        return if (tip.key in seen) null else tip
    }
}
