package com.pennhousing.shift.shared.onboarding

import com.pennhousing.shift.shared.viewmodel.OpenClaimTourViewModel
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * OpenClaimTour (shared) — the pure step copy + step-2/step-3 summary math, and the thin
 * ViewModel that sequences the three steps and owns the done-flag. Pure; no clock, no I/O.
 */
class OpenClaimTourTest {
    // ----- pure definitions -----

    @Test fun tour_has_exactly_three_ordered_steps() {
        assertEquals(3, OpenClaimTour.STEPS.size)
        assertEquals(3, OpenClaimTour.STEP_COUNT)
        assertEquals(
            listOf(OpenClaimTourStepId.CLAIM, OpenClaimTourStepId.AMOUNT, OpenClaimTourStepId.SCOPE),
            OpenClaimTour.STEPS.map { it.id },
        )
        assertEquals(listOf("STEP 1", "STEP 2", "STEP 3"), OpenClaimTour.STEPS.map { it.kicker })
    }

    @Test fun done_key_has_its_own_namespace() {
        assertEquals("tour.openclaim.done", OpenClaimTour.DONE_KEY)
        // Never collides with the "Manage a shift" tour's own key.
        assertFalse(OpenClaimTour.DONE_KEY == ShiftTour.DONE_KEY)
    }

    @Test fun step_three_names_the_real_permanent_pickup_wording() {
        val step = OpenClaimTour.STEPS[2]
        assertEquals(OpenClaimTourStepId.SCOPE, step.id)
        assertTrue(step.body.contains("Permanent openings"), "expected real section name in: ${step.body}")
        assertTrue(step.body.contains("every week"), "expected the recurring consequence in: ${step.body}")
        assertTrue(step.body.contains("Weekly open shifts"), "expected the real weekly section name in: ${step.body}")
    }

    @Test fun no_user_facing_copy_uses_em_or_en_dashes() {
        val strings =
            OpenClaimTour.STEPS.flatMap { listOf(it.kicker, it.title, it.body) } +
                OpenClaimTour.summaryLine(OpenClaimTour.DEFAULT_FROM_BLOCK, OpenClaimTour.DEFAULT_TO_BLOCK) +
                OpenClaimTour.scopeSummary(true) +
                OpenClaimTour.scopeSummary(false)
        for (s in strings) {
            assertFalse(s.contains('—'), "em dash in: $s")
            assertFalse(s.contains('–'), "en dash in: $s")
        }
    }

    // ----- pure formatting -----

    @Test fun time_labels_map_block_indices_to_the_sample_grid() {
        assertEquals("16:00", OpenClaimTour.timeLabel(0))
        assertEquals("16:30", OpenClaimTour.timeLabel(1))
        assertEquals("18:00", OpenClaimTour.timeLabel(4))
        assertEquals("20:00", OpenClaimTour.timeLabel(8))
    }

    @Test fun duration_labels_read_naturally_across_spans() {
        assertEquals("0m", OpenClaimTour.durationLabel(0))
        assertEquals("30m", OpenClaimTour.durationLabel(1))
        assertEquals("1h", OpenClaimTour.durationLabel(2))
        assertEquals("1h 30m", OpenClaimTour.durationLabel(3))
        assertEquals("4h", OpenClaimTour.durationLabel(8))
    }

    @Test fun summary_line_reflects_the_selected_range() {
        // Default back-half range.
        assertEquals(
            "Covering 2h · 18:00 to 20:00",
            OpenClaimTour.summaryLine(4, 8),
        )
        // Whole shift.
        assertEquals(
            "Covering 4h · 16:00 to 20:00",
            OpenClaimTour.summaryLine(0, 8),
        )
    }

    @Test fun summary_line_keeps_at_least_one_block_selected() {
        // A collapsed/inverted range still reads as a single block, never empty or negative.
        val line = OpenClaimTour.summaryLine(8, 8)
        assertTrue(line.contains("30m"), "expected a 30m floor, got: $line")
    }

    @Test fun scope_summary_reflects_the_toggle_using_real_screen_wording() {
        assertEquals("Claim shift · this week only", OpenClaimTour.scopeSummary(false))
        assertEquals("Pick up permanently · repeats every week", OpenClaimTour.scopeSummary(true))
    }

    // ----- ViewModel sequencing -----

    @Test fun auto_start_begins_the_tour_only_when_unseen() {
        val vm = OpenClaimTourViewModel()
        vm.autoStart()
        val s = vm.uiState.value
        assertTrue(s.active)
        assertEquals(1, s.stepIndex)
        assertEquals(3, s.stepCount)
        assertEquals(OpenClaimTour.STEPS.first(), s.step)
        assertFalse(s.canGoBack)
        assertFalse(s.isLastStep)

        val seenVm = OpenClaimTourViewModel(setOf(OpenClaimTour.DONE_KEY))
        seenVm.autoStart()
        assertFalse(seenVm.uiState.value.active)
    }

    @Test fun next_advances_then_completes_and_persists_the_done_key() {
        val vm = OpenClaimTourViewModel()
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
        assertTrue(OpenClaimTour.DONE_KEY in done.seen)
    }

    @Test fun skip_completes_the_tour_immediately() {
        val vm = OpenClaimTourViewModel()
        vm.autoStart()
        vm.skip()
        val s = vm.uiState.value
        assertFalse(s.active)
        assertTrue(OpenClaimTour.DONE_KEY in s.seen)
    }

    @Test fun back_is_disabled_on_the_first_step_and_steps_back_thereafter() {
        val vm = OpenClaimTourViewModel()
        vm.autoStart()
        vm.back() // no-op on step 1
        assertEquals(1, vm.uiState.value.stepIndex)
        vm.next()
        assertTrue(vm.uiState.value.canGoBack)
        vm.back()
        val s = vm.uiState.value
        assertEquals(1, s.stepIndex)
        assertFalse(s.canGoBack)
        assertFalse(OpenClaimTour.DONE_KEY in s.seen)
    }

    @Test fun replay_reopens_from_step_one_even_after_completion() {
        val vm = OpenClaimTourViewModel(setOf(OpenClaimTour.DONE_KEY))
        vm.autoStart() // no-op, already seen
        assertFalse(vm.uiState.value.active)
        vm.replay()
        val s = vm.uiState.value
        assertTrue(s.active)
        assertEquals(1, s.stepIndex)
        assertNotNull(s.step)
    }
}
