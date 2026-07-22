package com.pennhousing.shift.shared.onboarding

import com.pennhousing.shift.shared.viewmodel.OnboardingViewModel
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Onboarding presentation (shared) — the pure welcome-tour / contextual-tip definitions
 * and the seen-flag reducer, plus the thin ViewModel that sequences them. Pure; no clock,
 * no I/O.
 */
class OnboardingTest {
    // ----- pure definitions -----

    @Test fun welcome_tour_starts_with_a_centered_intro_and_covers_the_tabs_plus_assistant() {
        val tour = Onboarding.WELCOME_TOUR
        assertEquals(OnboardingTarget.NONE, tour.first().target)
        val targets = tour.map { it.target }.toSet()
        assertTrue(OnboardingTarget.MY_SHIFTS_TAB in targets)
        assertTrue(OnboardingTarget.OPEN_TAB in targets)
        assertTrue(OnboardingTarget.HOUSE_TAB in targets)
        assertTrue(OnboardingTarget.SWAPS_TAB in targets)
        assertTrue(OnboardingTarget.MORE_TAB in targets)
        assertTrue(OnboardingTarget.ASSISTANT_BUTTON in targets)
    }

    @Test fun tour_keys_are_unique_and_none_collides_with_a_tip_key() {
        val tourKeys = Onboarding.WELCOME_TOUR.map { it.key }
        val tipKeys = Onboarding.CONTEXTUAL_TIPS.values.map { it.key }
        assertEquals(tourKeys.size, tourKeys.toSet().size, "tour keys unique")
        assertEquals(tipKeys.size, tipKeys.toSet().size, "tip keys unique")
        assertTrue((tourKeys.toSet() intersect tipKeys.toSet()).isEmpty(), "no shared keys")
    }

    @Test fun every_trigger_has_a_tip() {
        for (trigger in TipTrigger.entries) {
            assertNotNull(Onboarding.CONTEXTUAL_TIPS[trigger], "tip for $trigger")
        }
    }

    @Test fun no_user_facing_copy_uses_em_or_en_dashes() {
        val strings =
            Onboarding.WELCOME_TOUR.flatMap { listOf(it.title, it.body) } +
                Onboarding.CONTEXTUAL_TIPS.values.flatMap { listOf(it.title, it.body) }
        for (s in strings) {
            assertFalse(s.contains('—'), "em dash in: $s")
            assertFalse(s.contains('–'), "en dash in: $s")
        }
    }

    // ----- seen-flag reducer -----

    @Test fun welcome_tour_shows_until_done_key_is_present() {
        assertTrue(Onboarding.shouldShowWelcomeTour(emptySet()))
        assertFalse(Onboarding.shouldShowWelcomeTour(setOf(Onboarding.WELCOME_DONE_KEY)))
    }

    @Test fun tips_are_gated_until_the_welcome_tour_is_done() {
        // Before the tour is finished, no tip is due.
        assertNull(Onboarding.tipFor(TipTrigger.OPEN_SHIFTS, emptySet()))
        // Once done, the tip is due once.
        val done = setOf(Onboarding.WELCOME_DONE_KEY)
        val tip = Onboarding.tipFor(TipTrigger.OPEN_SHIFTS, done)
        assertNotNull(tip)
        // After it is seen, it never returns again.
        assertNull(Onboarding.tipFor(TipTrigger.OPEN_SHIFTS, done + tip.key))
    }

    // ----- ViewModel sequencing -----

    @Test fun start_begins_the_tour_only_when_unseen() {
        val vm = OnboardingViewModel()
        vm.start()
        val s = vm.uiState.value
        assertTrue(s.isTour)
        assertEquals(1, s.stepIndex)
        assertEquals(Onboarding.WELCOME_TOUR.size, s.stepCount)
        assertEquals(Onboarding.WELCOME_TOUR.first(), s.current)

        val seenVm = OnboardingViewModel(setOf(Onboarding.WELCOME_DONE_KEY))
        seenVm.start()
        assertNull(seenVm.uiState.value.current)
    }

    @Test fun next_advances_then_completes_the_tour() {
        val vm = OnboardingViewModel()
        vm.start()
        repeat(Onboarding.WELCOME_TOUR.size - 1) { vm.next() }
        assertEquals(Onboarding.WELCOME_TOUR.size, vm.uiState.value.stepIndex)
        // One more advance past the last step completes it.
        vm.next()
        val s = vm.uiState.value
        assertNull(s.current)
        assertFalse(s.isTour)
        assertTrue(Onboarding.WELCOME_DONE_KEY in s.seen)
    }

    @Test fun skip_completes_the_tour_immediately() {
        val vm = OnboardingViewModel()
        vm.start()
        vm.skipTour()
        val s = vm.uiState.value
        assertNull(s.current)
        assertTrue(Onboarding.WELCOME_DONE_KEY in s.seen)
    }

    @Test fun back_is_disabled_on_the_first_step_and_steps_back_thereafter() {
        val vm = OnboardingViewModel()
        vm.start()
        assertFalse(vm.uiState.value.canGoBack)
        vm.back() // no-op on step 1
        assertEquals(1, vm.uiState.value.stepIndex)

        vm.next()
        assertEquals(2, vm.uiState.value.stepIndex)
        assertTrue(vm.uiState.value.canGoBack)

        vm.back()
        val s = vm.uiState.value
        assertEquals(1, s.stepIndex)
        assertFalse(s.canGoBack)
        assertEquals(Onboarding.WELCOME_TOUR.first(), s.current)
    }

    @Test fun back_does_not_complete_or_persist_the_tour() {
        val vm = OnboardingViewModel()
        vm.start()
        vm.next()
        vm.back()
        assertFalse(Onboarding.WELCOME_DONE_KEY in vm.uiState.value.seen)
        assertTrue(vm.uiState.value.isTour)
    }

    @Test fun replay_tour_restarts_from_step_one_even_after_completion() {
        val vm = OnboardingViewModel()
        vm.start()
        vm.skipTour()
        assertTrue(Onboarding.WELCOME_DONE_KEY in vm.uiState.value.seen)

        vm.replayTour()
        val s = vm.uiState.value
        assertTrue(s.isTour)
        assertEquals(1, s.stepIndex)
        assertEquals(Onboarding.WELCOME_TOUR.first(), s.current)
        assertFalse(Onboarding.WELCOME_DONE_KEY in s.seen)
    }

    @Test fun replay_tour_overrides_an_open_tip() {
        val vm = OnboardingViewModel(setOf(Onboarding.WELCOME_DONE_KEY))
        vm.triggerTip(TipTrigger.OPEN_SHIFTS)
        assertFalse(vm.uiState.value.isTour)

        vm.replayTour()
        val s = vm.uiState.value
        assertTrue(s.isTour)
        assertEquals(Onboarding.WELCOME_TOUR.first(), s.current)
    }

    @Test fun tips_do_not_fire_during_the_tour_but_do_after() {
        val vm = OnboardingViewModel()
        vm.start()
        vm.triggerTip(TipTrigger.MY_SHIFTS)
        // Still showing the tour, not the tip.
        assertTrue(vm.uiState.value.isTour)

        vm.skipTour()
        vm.triggerTip(TipTrigger.MY_SHIFTS)
        val s = vm.uiState.value
        assertFalse(s.isTour)
        assertEquals(Onboarding.CONTEXTUAL_TIPS[TipTrigger.MY_SHIFTS], s.current)
    }

    @Test fun dismissing_a_tip_remembers_it_and_it_never_returns() {
        val vm = OnboardingViewModel(setOf(Onboarding.WELCOME_DONE_KEY))
        vm.triggerTip(TipTrigger.BREAK_WINDOW)
        assertNotNull(vm.uiState.value.current)
        vm.dismissTip()
        assertNull(vm.uiState.value.current)
        // Re-triggering does nothing now.
        vm.triggerTip(TipTrigger.BREAK_WINDOW)
        assertNull(vm.uiState.value.current)
    }

    @Test fun only_one_tip_shows_at_a_time() {
        val vm = OnboardingViewModel(setOf(Onboarding.WELCOME_DONE_KEY))
        vm.triggerTip(TipTrigger.OPEN_SHIFTS)
        val first = vm.uiState.value.current
        vm.triggerTip(TipTrigger.HOUSE_GRID)
        // The second trigger is ignored while the first tip is up.
        assertEquals(first, vm.uiState.value.current)
    }
}
