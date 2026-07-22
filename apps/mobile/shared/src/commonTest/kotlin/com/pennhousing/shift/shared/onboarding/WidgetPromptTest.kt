package com.pennhousing.shift.shared.onboarding

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * WidgetPrompt (shared) — the pure behavioral gate for the "add the Shift widget" nudge.
 * Pure; no clock, no I/O.
 */
class WidgetPromptTest {
    /** A fully-eligible baseline; each test flips one field to prove that guard. */
    private fun eligible(
        calendarOpens: Int = WidgetPrompt.OPENS_THRESHOLD,
        hasUpcomingShift: Boolean = true,
        launchCount: Int = 3,
        showCount: Int = 0,
        accepted: Boolean = false,
        alreadyHasWidget: Boolean = false,
        lastShownLaunch: Int = 0,
    ) = WidgetPrompt.eligible(
        calendarOpens = calendarOpens,
        hasUpcomingShift = hasUpcomingShift,
        launchCount = launchCount,
        showCount = showCount,
        accepted = accepted,
        alreadyHasWidget = alreadyHasWidget,
        lastShownLaunch = lastShownLaunch,
    )

    @Test fun eligible_after_enough_opens_with_an_upcoming_shift_on_a_return_session() {
        assertTrue(eligible())
    }

    @Test fun not_eligible_before_the_opens_threshold() {
        assertFalse(eligible(calendarOpens = WidgetPrompt.OPENS_THRESHOLD - 1))
    }

    @Test fun not_eligible_without_an_upcoming_shift_to_preview() {
        assertFalse(eligible(hasUpcomingShift = false))
    }

    @Test fun not_eligible_on_the_first_ever_launch() {
        assertFalse(eligible(launchCount = 1))
    }

    @Test fun not_eligible_twice_in_the_same_session() {
        // Already shown this launch (lastShownLaunch == launchCount).
        assertFalse(eligible(launchCount = 3, lastShownLaunch = 3))
        // A later launch re-opens it (resurface), still under MAX_SHOWS.
        assertTrue(eligible(launchCount = 4, showCount = 1, lastShownLaunch = 3))
    }

    @Test fun stops_after_max_shows() {
        assertFalse(eligible(showCount = WidgetPrompt.MAX_SHOWS, launchCount = 9, lastShownLaunch = 5))
    }

    @Test fun stops_once_accepted_or_widget_installed() {
        assertFalse(eligible(accepted = true))
        assertFalse(eligible(alreadyHasWidget = true))
    }

    @Test fun copy_uses_no_em_or_en_dashes() {
        val strings =
            listOf(
                WidgetPrompt.TITLE,
                WidgetPrompt.BODY,
                WidgetPrompt.CONFIRM,
                WidgetPrompt.DISMISS,
                WidgetPrompt.HOW_TO_TITLE,
                WidgetPrompt.HOW_TO_DONE,
            )
        for (s in strings) {
            assertFalse(s.contains('—'), "em dash in: $s")
            assertFalse(s.contains('–'), "en dash in: $s")
        }
    }
}
