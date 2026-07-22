package com.pennhousing.shift.shared.onboarding

import com.pennhousing.shift.shared.viewmodel.SwapTourViewModel
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * SwapTour (shared) — the pure step copy + step-2 give/take summary math, and the thin
 * ViewModel that sequences the three steps and owns the done-flag. Pure; no clock, no I/O.
 */
class SwapTourTest {
    // ----- pure definitions -----

    @Test fun tour_has_exactly_three_ordered_steps() {
        assertEquals(3, SwapTour.STEPS.size)
        assertEquals(3, SwapTour.STEP_COUNT)
        assertEquals(
            listOf(SwapTourStepId.MODE, SwapTourStepId.AMOUNT, SwapTourStepId.SPLIT),
            SwapTour.STEPS.map { it.id },
        )
        assertEquals(listOf("STEP 1", "STEP 2", "STEP 3"), SwapTour.STEPS.map { it.kicker })
    }

    @Test fun own_done_key_namespace_distinct_from_the_shift_tour() {
        assertEquals("tour.swap.done", SwapTour.DONE_KEY)
        assertFalse(SwapTour.DONE_KEY == ShiftTour.DONE_KEY)
    }

    @Test fun no_user_facing_copy_uses_em_or_en_dashes() {
        val strings =
            SwapTour.STEPS.flatMap { listOf(it.kicker, it.title, it.body) } +
                SwapTour.summaryLine(SwapTourMode.SWAP, SwapTour.DEFAULT_FROM_BLOCK, SwapTour.DEFAULT_TO_BLOCK) +
                SwapTour.summaryLine(SwapTourMode.HAND_OFF, SwapTour.DEFAULT_FROM_BLOCK, SwapTour.DEFAULT_TO_BLOCK)
        for (s in strings) {
            assertFalse(s.contains('—'), "em dash in: $s")
            assertFalse(s.contains('–'), "en dash in: $s")
        }
    }

    // ----- pure formatting -----

    @Test fun time_labels_map_block_indices_to_the_sample_grid() {
        assertEquals("16:00", SwapTour.timeLabel(0))
        assertEquals("16:30", SwapTour.timeLabel(1))
        assertEquals("18:00", SwapTour.timeLabel(4))
        assertEquals("20:00", SwapTour.timeLabel(8))
    }

    @Test fun duration_labels_read_naturally_across_spans() {
        assertEquals("0m", SwapTour.durationLabel(0))
        assertEquals("30m", SwapTour.durationLabel(1))
        assertEquals("1h", SwapTour.durationLabel(2))
        assertEquals("1h 30m", SwapTour.durationLabel(3))
        assertEquals("4h", SwapTour.durationLabel(8))
    }

    @Test fun summary_line_swap_branch_reflects_give_and_take() {
        // Default back-half give range (18:00 to 20:00 = 2h); candidate's fixed take is 2h.
        assertEquals(
            "You give 2h · you get 2h",
            SwapTour.summaryLine(SwapTourMode.SWAP, 4, 8),
        )
        // Whole give shift (4h); take stays the candidate's own fixed 2h.
        assertEquals(
            "You give 4h · you get 2h",
            SwapTour.summaryLine(SwapTourMode.SWAP, 0, 8),
        )
    }

    @Test fun summary_line_hand_off_branch_names_the_recipient_and_has_no_take_side() {
        assertEquals(
            "Giving Jordan 2h · nothing comes back",
            SwapTour.summaryLine(SwapTourMode.HAND_OFF, 4, 8),
        )
        assertEquals(
            "Giving Jordan 4h · nothing comes back",
            SwapTour.summaryLine(SwapTourMode.HAND_OFF, 0, 8),
        )
        // A different candidate name flows through.
        assertEquals(
            "Giving Alex 2h · nothing comes back",
            SwapTour.summaryLine(SwapTourMode.HAND_OFF, 4, 8, candidateName = "Alex"),
        )
    }

    @Test fun summary_line_keeps_at_least_one_block_selected() {
        // A collapsed/inverted give range still reads as a single block, never empty or negative.
        val line = SwapTour.summaryLine(SwapTourMode.SWAP, 8, 8)
        assertTrue(line.contains("30m"), "expected a 30m floor, got: $line")
    }

    // ----- ViewModel sequencing -----

    @Test fun auto_start_begins_the_tour_only_when_unseen() {
        val vm = SwapTourViewModel()
        vm.autoStart()
        val s = vm.uiState.value
        assertTrue(s.active)
        assertEquals(1, s.stepIndex)
        assertEquals(3, s.stepCount)
        assertEquals(SwapTour.STEPS.first(), s.step)
        assertFalse(s.canGoBack)
        assertFalse(s.isLastStep)

        val seenVm = SwapTourViewModel(setOf(SwapTour.DONE_KEY))
        seenVm.autoStart()
        assertFalse(seenVm.uiState.value.active)
    }

    @Test fun next_advances_then_completes_and_persists_the_done_key() {
        val vm = SwapTourViewModel()
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
        assertTrue(SwapTour.DONE_KEY in done.seen)
    }

    @Test fun skip_completes_the_tour_immediately() {
        val vm = SwapTourViewModel()
        vm.autoStart()
        vm.skip()
        val s = vm.uiState.value
        assertFalse(s.active)
        assertTrue(SwapTour.DONE_KEY in s.seen)
    }

    @Test fun back_is_disabled_on_the_first_step_and_steps_back_thereafter() {
        val vm = SwapTourViewModel()
        vm.autoStart()
        vm.back() // no-op on step 1
        assertEquals(1, vm.uiState.value.stepIndex)
        vm.next()
        assertTrue(vm.uiState.value.canGoBack)
        vm.back()
        val s = vm.uiState.value
        assertEquals(1, s.stepIndex)
        assertFalse(s.canGoBack)
        assertFalse(SwapTour.DONE_KEY in s.seen)
    }

    @Test fun replay_reopens_from_step_one_even_after_completion() {
        val vm = SwapTourViewModel(setOf(SwapTour.DONE_KEY))
        vm.autoStart() // no-op, already seen
        assertFalse(vm.uiState.value.active)
        vm.replay()
        val s = vm.uiState.value
        assertTrue(s.active)
        assertEquals(1, s.stepIndex)
        assertNotNull(s.step)
    }
}
