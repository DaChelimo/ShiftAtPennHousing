package com.pennhousing.shift.shared.onboarding

import com.pennhousing.shift.shared.viewmodel.ShiftTourViewModel
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * ShiftTour (shared) — the pure step copy + step-2 summary math, and the thin ViewModel
 * that sequences the three steps and owns the done-flag. Pure; no clock, no I/O.
 */
class ShiftTourTest {
    // ----- pure definitions -----

    @Test fun tour_has_exactly_three_ordered_steps() {
        assertEquals(3, ShiftTour.STEPS.size)
        assertEquals(3, ShiftTour.STEP_COUNT)
        assertEquals(
            listOf(ShiftTourStepId.MANAGE, ShiftTourStepId.AMOUNT, ShiftTourStepId.DESTINATION),
            ShiftTour.STEPS.map { it.id },
        )
        assertEquals(listOf("STEP 1", "STEP 2", "STEP 3"), ShiftTour.STEPS.map { it.kicker })
    }

    @Test fun action_chips_are_drop_then_the_grouped_swap_pair() {
        assertEquals(
            listOf(ShiftTourAction.DROP, ShiftTourAction.SWAP, ShiftTourAction.HAND_OFF),
            ShiftTour.ACTIONS,
        )
    }

    @Test fun no_user_facing_copy_uses_em_or_en_dashes() {
        val strings =
            ShiftTour.STEPS.flatMap { listOf(it.kicker, it.title, it.body) } +
                ShiftTour.summaryLine(ShiftTour.DEFAULT_FROM_BLOCK, ShiftTour.DEFAULT_TO_BLOCK, false) +
                ShiftTour.summaryLine(ShiftTour.DEFAULT_FROM_BLOCK, ShiftTour.DEFAULT_TO_BLOCK, true)
        for (s in strings) {
            assertFalse(s.contains('—'), "em dash in: $s")
            assertFalse(s.contains('–'), "en dash in: $s")
        }
    }

    // ----- pure formatting -----

    @Test fun time_labels_map_block_indices_to_the_sample_grid() {
        assertEquals("16:00", ShiftTour.timeLabel(0))
        assertEquals("16:30", ShiftTour.timeLabel(1))
        assertEquals("18:00", ShiftTour.timeLabel(4))
        assertEquals("20:00", ShiftTour.timeLabel(8))
    }

    @Test fun duration_labels_read_naturally_across_spans() {
        assertEquals("0m", ShiftTour.durationLabel(0))
        assertEquals("30m", ShiftTour.durationLabel(1))
        assertEquals("1h", ShiftTour.durationLabel(2))
        assertEquals("1h 30m", ShiftTour.durationLabel(3))
        assertEquals("4h", ShiftTour.durationLabel(8))
    }

    @Test fun summary_line_reflects_range_and_scope() {
        // Default back-half range, one time.
        assertEquals(
            "Giving 2h · 18:00 to 20:00 · this week",
            ShiftTour.summaryLine(4, 8, false),
        )
        // Same range, permanent.
        assertEquals(
            "Giving 2h · 18:00 to 20:00 · permanently",
            ShiftTour.summaryLine(4, 8, true),
        )
        // Whole shift.
        assertEquals(
            "Giving 4h · 16:00 to 20:00 · this week",
            ShiftTour.summaryLine(0, 8, false),
        )
    }

    @Test fun summary_line_keeps_at_least_one_block_selected() {
        // A collapsed/inverted range still reads as a single block, never empty or negative.
        val line = ShiftTour.summaryLine(8, 8, false)
        assertTrue(line.contains("30m"), "expected a 30m floor, got: $line")
    }

    // ----- ViewModel sequencing -----

    @Test fun auto_start_begins_the_tour_only_when_unseen() {
        val vm = ShiftTourViewModel()
        vm.autoStart()
        val s = vm.uiState.value
        assertTrue(s.active)
        assertEquals(1, s.stepIndex)
        assertEquals(3, s.stepCount)
        assertEquals(ShiftTour.STEPS.first(), s.step)
        assertFalse(s.canGoBack)
        assertFalse(s.isLastStep)

        val seenVm = ShiftTourViewModel(setOf(ShiftTour.DONE_KEY))
        seenVm.autoStart()
        assertFalse(seenVm.uiState.value.active)
    }

    @Test fun next_advances_then_completes_and_persists_the_done_key() {
        val vm = ShiftTourViewModel()
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
        assertTrue(ShiftTour.DONE_KEY in done.seen)
    }

    @Test fun skip_completes_the_tour_immediately() {
        val vm = ShiftTourViewModel()
        vm.autoStart()
        vm.skip()
        val s = vm.uiState.value
        assertFalse(s.active)
        assertTrue(ShiftTour.DONE_KEY in s.seen)
    }

    @Test fun back_is_disabled_on_the_first_step_and_steps_back_thereafter() {
        val vm = ShiftTourViewModel()
        vm.autoStart()
        vm.back() // no-op on step 1
        assertEquals(1, vm.uiState.value.stepIndex)
        vm.next()
        assertTrue(vm.uiState.value.canGoBack)
        vm.back()
        val s = vm.uiState.value
        assertEquals(1, s.stepIndex)
        assertFalse(s.canGoBack)
        assertFalse(ShiftTour.DONE_KEY in s.seen)
    }

    @Test fun replay_reopens_from_step_one_even_after_completion() {
        val vm = ShiftTourViewModel(setOf(ShiftTour.DONE_KEY))
        vm.autoStart() // no-op, already seen
        assertFalse(vm.uiState.value.active)
        vm.replay()
        val s = vm.uiState.value
        assertTrue(s.active)
        assertEquals(1, s.stepIndex)
        assertNotNull(s.step)
    }
}
