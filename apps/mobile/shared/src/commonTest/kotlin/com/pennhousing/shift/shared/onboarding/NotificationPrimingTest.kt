package com.pennhousing.shift.shared.onboarding

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * NotificationPriming (shared) — the pure gating for the pre-permission primer that replaces
 * the cold OS notification dialog. Pure; no clock, no I/O.
 */
class NotificationPrimingTest {
    @Test fun primer_shows_only_after_the_tour_when_the_os_can_prompt_and_no_response_yet() {
        assertTrue(
            NotificationPriming.shouldShowPrimer(tourDone = true, osCanPrompt = true, alreadyResponded = false),
        )
    }

    @Test fun primer_never_shows_before_the_welcome_tour_finishes() {
        assertFalse(
            NotificationPriming.shouldShowPrimer(tourDone = false, osCanPrompt = true, alreadyResponded = false),
        )
    }

    @Test fun primer_never_shows_when_the_os_would_not_prompt() {
        // Already granted, or a platform that cannot surface a prompt (e.g. iOS status not
        // .notDetermined, Android < 33): nothing to prime.
        assertFalse(
            NotificationPriming.shouldShowPrimer(tourDone = true, osCanPrompt = false, alreadyResponded = false),
        )
    }

    @Test fun primer_shows_once_then_never_again_after_a_response() {
        // "Not now" (or Confirm) marks responded, so the primer does not nag on every launch.
        assertFalse(
            NotificationPriming.shouldShowPrimer(tourDone = true, osCanPrompt = true, alreadyResponded = true),
        )
    }

    @Test fun copy_uses_no_em_or_en_dashes() {
        val strings =
            listOf(
                NotificationPriming.TITLE,
                NotificationPriming.BODY,
                NotificationPriming.CONFIRM,
                NotificationPriming.DISMISS,
            )
        for (s in strings) {
            assertFalse(s.contains('—'), "em dash in: $s")
            assertFalse(s.contains('–'), "en dash in: $s")
        }
    }
}
