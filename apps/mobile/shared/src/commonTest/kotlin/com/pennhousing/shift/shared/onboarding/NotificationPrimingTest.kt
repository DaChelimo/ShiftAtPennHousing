package com.pennhousing.shift.shared.onboarding

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * NotificationPriming (shared) — the pure gating and copy for the in-app notification ask
 * that precedes the OS dialog. Redesigned 2026-08-03 from a one-shot blocking modal into a
 * standing My-Shifts row plus two once-per-install contextual rows. Pure; no clock, no I/O.
 */
class NotificationPrimingTest {
    @Test fun standing_nudge_shows_whenever_alerts_are_off() {
        assertTrue(NotificationPriming.shouldShowStandingNudge(granted = false))
    }

    @Test fun standing_nudge_disappears_once_alerts_are_on() {
        assertFalse(NotificationPriming.shouldShowStandingNudge(granted = true))
    }

    @Test fun standing_nudge_has_no_dismiss_gate_so_ignoring_it_does_not_retire_it() {
        // There is deliberately no "responded" / "dismissed" input: the ONLY thing that
        // retires the row is the worker actually turning alerts on. This pins that, so a
        // reintroduced dismiss flag fails here rather than silently halving conversion.
        repeat(5) { assertTrue(NotificationPriming.shouldShowStandingNudge(granted = false)) }
    }

    @Test fun contextual_nudge_shows_once_while_alerts_are_off() {
        assertTrue(NotificationPriming.shouldShowContextualNudge(granted = false, alreadyAsked = false))
    }

    @Test fun contextual_nudge_does_not_repeat_once_that_moment_has_asked() {
        assertFalse(NotificationPriming.shouldShowContextualNudge(granted = false, alreadyAsked = true))
    }

    @Test fun contextual_nudge_never_shows_once_alerts_are_on() {
        assertFalse(NotificationPriming.shouldShowContextualNudge(granted = true, alreadyAsked = false))
    }

    @Test fun the_two_contextual_moments_have_distinct_keys() {
        // One shared key would let a claim retire the swap ask (and vice versa).
        assertTrue(NotificationPriming.ASKED_AFTER_CLAIM_KEY != NotificationPriming.ASKED_AFTER_SWAP_KEY)
    }

    @Test fun button_offers_the_os_dialog_while_it_can_fire_and_settings_after() {
        assertEquals(NotificationPriming.CONFIRM, NotificationPriming.confirmLabel(osCanPrompt = true))
        assertEquals(NotificationPriming.CONFIRM_SETTINGS, NotificationPriming.confirmLabel(osCanPrompt = false))
    }

    @Test fun every_body_stays_a_one_liner_and_carries_no_dashes() {
        val strings =
            listOf(
                NotificationPriming.BODY_MY_SHIFTS,
                NotificationPriming.BODY_AFTER_CLAIM,
                NotificationPriming.BODY_AFTER_SWAP,
                NotificationPriming.CONFIRM,
                NotificationPriming.CONFIRM_SETTINGS,
            )
        for (s in strings) {
            assertTrue(s.isNotBlank(), "copy must not be blank")
            // The redesign's whole point: the old three-line body went unread. Past ~60
            // characters it stops being glanceable and the ask gets skipped again.
            assertTrue(s.length <= 60, "copy must stay a one-liner: $s")
            assertFalse(s.contains('—'), "em dash in: $s")
            assertFalse(s.contains('–'), "en dash in: $s")
        }
    }
}
