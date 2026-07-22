package com.pennhousing.shift.shared.onboarding

/*
 * WidgetPrompt — the pure gate + copy for the "add the Shift widget" nudge. Rendered
 * natively per platform (Compose / SwiftUI); this object is the shared source of truth for
 * WHEN the prompt is eligible and WHAT it says, the sibling of `NotificationPriming`.
 *
 * The nudge is BEHAVIORAL, not part of first-run setup: a widget is a habit surface, so it
 * only earns its ask once the worker has repeatedly reached for their schedule. It becomes
 * eligible after the worker has opened the My-Shifts/Calendar tab [OPENS_THRESHOLD] times,
 * has an upcoming shift worth glancing at, and is on a return session (not their first ever
 * launch). It shows at most [MAX_SHOWS] times (ask once, resurface once, then stop), never
 * twice in the same session, and never once the worker has been guided through adding it
 * or already has the widget installed.
 *
 * The per-device counters (opens / launches / shows / accepted) are a platform concern
 * (SharedPreferences on Android, UserDefaults on iOS), like the onboarding seen-keys.
 */
object WidgetPrompt {
    /** Persisted once the worker taps "Show me how" (guided), so it never nags again. */
    const val ACCEPTED_KEY: String = "widget.prompt.accepted"

    /** Calendar-tab opens before the nudge is eligible (the behavioral trigger). */
    const val OPENS_THRESHOLD: Int = 7

    /** Ask once, resurface once more, then stop. */
    const val MAX_SHOWS: Int = 2

    const val TITLE: String = "Your next shift, without opening the app"
    const val BODY: String =
        "Add the Shift widget to your home screen and always see what is next at a glance."
    const val CONFIRM: String = "Show me how"
    const val DISMISS: String = "Maybe later"
    const val HOW_TO_TITLE: String = "Add the Shift widget"
    const val HOW_TO_DONE: String = "Got it"

    /**
     * Whether a NEW showing of the prompt may open right now. The platform owns the display
     * flag; this only decides the open transition, then records the show (so the same-session
     * `launchCount > lastShownLaunch` guard stops it re-opening until the next launch):
     *  - not already [accepted] (guided) and no widget installed ([alreadyHasWidget]);
     *  - shown fewer than [MAX_SHOWS] times;
     *  - a return session ([launchCount] >= 2), never the very first launch;
     *  - the worker has opened the calendar at least [OPENS_THRESHOLD] times;
     *  - there is an upcoming shift to preview ([hasUpcomingShift]);
     *  - it has not already been shown this session ([launchCount] > [lastShownLaunch]).
     */
    fun eligible(
        calendarOpens: Int,
        hasUpcomingShift: Boolean,
        launchCount: Int,
        showCount: Int,
        accepted: Boolean,
        alreadyHasWidget: Boolean,
        lastShownLaunch: Int,
    ): Boolean =
        !accepted &&
            !alreadyHasWidget &&
            showCount < MAX_SHOWS &&
            launchCount >= 2 &&
            calendarOpens >= OPENS_THRESHOLD &&
            hasUpcomingShift &&
            launchCount > lastShownLaunch
}
