package com.pennhousing.shift.shared.onboarding

import com.pennhousing.shift.shared.viewmodel.HouseGridTourViewModel
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * HouseGridTour (shared) — the pure step copy, and the thin ViewModel that sequences the
 * three steps and owns the done-flag. Pure; no clock, no I/O.
 */
class HouseGridTourTest {
    // ----- pure definitions -----

    @Test fun tour_has_exactly_three_ordered_steps() {
        assertEquals(3, HouseGridTour.STEPS.size)
        assertEquals(3, HouseGridTour.STEP_COUNT)
        assertEquals(
            listOf(HouseGridTourStepId.FIND_WHO, HouseGridTourStepId.SWITCH_HOUSE, HouseGridTourStepId.EMPTY_SEAT),
            HouseGridTour.STEPS.map { it.id },
        )
        assertEquals(listOf("STEP 1", "STEP 2", "STEP 3"), HouseGridTour.STEPS.map { it.kicker })
    }

    @Test fun done_key_is_its_own_namespace() {
        assertEquals("tour.housegrid.done", HouseGridTour.DONE_KEY)
    }

    @Test fun step_copy_matches_the_given_outline() {
        val steps = HouseGridTour.STEPS
        assertEquals("Find who's on", steps[0].title)
        assertEquals("Scroll to see the day and time. Tap any name to call them or the desk.", steps[0].body)
        assertEquals("Switch house or week", steps[1].title)
        assertEquals(
            "Use the house name to view another house you can cover. The week bar moves you forward or back.",
            steps[1].body,
        )
        assertEquals("An empty seat", steps[2].title)
        assertEquals("A blank block means nobody is covering it yet. Check Open shifts to pick it up.", steps[2].body)
    }

    @Test fun no_user_facing_copy_uses_em_or_en_dashes() {
        val strings = HouseGridTour.STEPS.flatMap { listOf(it.kicker, it.title, it.body) }
        for (s in strings) {
            assertFalse(s.contains('—'), "em dash in: $s")
            assertFalse(s.contains('–'), "en dash in: $s")
        }
    }

    // ----- shouldAutoShow gating -----

    @Test fun should_auto_show_gates_on_the_done_key_only() {
        assertTrue(HouseGridTour.shouldAutoShow(emptySet()))
        assertTrue(HouseGridTour.shouldAutoShow(setOf("some.other.tour.done")))
        assertFalse(HouseGridTour.shouldAutoShow(setOf(HouseGridTour.DONE_KEY)))
    }

    // ----- ViewModel sequencing -----

    @Test fun auto_start_begins_the_tour_only_when_unseen() {
        val vm = HouseGridTourViewModel()
        vm.autoStart()
        val s = vm.uiState.value
        assertTrue(s.active)
        assertEquals(1, s.stepIndex)
        assertEquals(3, s.stepCount)
        assertEquals(HouseGridTour.STEPS.first(), s.step)
        assertFalse(s.canGoBack)
        assertFalse(s.isLastStep)

        val seenVm = HouseGridTourViewModel(setOf(HouseGridTour.DONE_KEY))
        seenVm.autoStart()
        assertFalse(seenVm.uiState.value.active)
    }

    @Test fun next_advances_then_completes_and_persists_the_done_key() {
        val vm = HouseGridTourViewModel()
        vm.autoStart()
        vm.next()
        assertEquals(2, vm.uiState.value.stepIndex)
        vm.next()
        val onLast = vm.uiState.value
        assertEquals(3, onLast.stepIndex)
        assertTrue(onLast.isLastStep)
        // One more advance past the last step finishes it.
        vm.next()
        val done = vm.uiState.value
        assertFalse(done.active)
        assertNull(done.step)
        assertTrue(HouseGridTour.DONE_KEY in done.seen)
    }

    @Test fun skip_completes_the_tour_immediately() {
        val vm = HouseGridTourViewModel()
        vm.autoStart()
        vm.skip()
        val s = vm.uiState.value
        assertFalse(s.active)
        assertTrue(HouseGridTour.DONE_KEY in s.seen)
    }

    @Test fun back_is_disabled_on_the_first_step_and_steps_back_thereafter() {
        val vm = HouseGridTourViewModel()
        vm.autoStart()
        vm.back() // no-op on step 1
        assertEquals(1, vm.uiState.value.stepIndex)
        vm.next()
        assertTrue(vm.uiState.value.canGoBack)
        vm.back()
        val s = vm.uiState.value
        assertEquals(1, s.stepIndex)
        assertFalse(s.canGoBack)
        assertFalse(HouseGridTour.DONE_KEY in s.seen)
    }

    @Test fun replay_reopens_from_step_one_even_after_completion() {
        val vm = HouseGridTourViewModel(setOf(HouseGridTour.DONE_KEY))
        vm.autoStart() // no-op, already seen
        assertFalse(vm.uiState.value.active)
        vm.replay()
        val s = vm.uiState.value
        assertTrue(s.active)
        assertEquals(1, s.stepIndex)
        assertNotNull(s.step)
    }
}
