package com.pennhousing.shift.shared.onboarding

import com.pennhousing.shift.shared.viewmodel.BreakTourViewModel
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * BreakTour (shared) — the pure step copy + sample-grid summary math, and the thin
 * ViewModel that sequences the three steps and owns the done-flag. Pure; no clock, no I/O.
 */
class BreakTourTest {
    // ----- pure definitions -----

    @Test fun tour_has_exactly_three_ordered_steps() {
        assertEquals(3, BreakTour.STEPS.size)
        assertEquals(3, BreakTour.STEP_COUNT)
        assertEquals(
            listOf(BreakTourStepId.LAYOUT, BreakTourStepId.CLAIM, BreakTourStepId.DROP),
            BreakTour.STEPS.map { it.id },
        )
        assertEquals(listOf("STEP 1", "STEP 2", "STEP 3"), BreakTour.STEPS.map { it.kicker })
    }

    @Test fun done_key_is_its_own_namespace() {
        assertEquals("tour.breaks.done", BreakTour.DONE_KEY)
    }

    @Test fun no_user_facing_copy_uses_em_or_en_dashes() {
        val strings =
            BreakTour.STEPS.flatMap { listOf(it.kicker, it.title, it.body) } +
                BreakTour.claimSummary(0, 2, 0) +
                BreakTour.claimSummary(2, 4, 1) +
                BreakTour.dropSummary(-1, -1) +
                BreakTour.dropSummary(2, 5)
        for (s in strings) {
            assertFalse(s.contains('—'), "em dash in: $s")
            assertFalse(s.contains('–'), "en dash in: $s")
        }
    }

    @Test fun sample_grid_has_two_lanes_and_named_taken_seats() {
        assertEquals(2, BreakTour.LANE_COUNT)
        assertEquals(listOf("Desk 1", "Desk 2"), BreakTour.LANE_LABELS)
        assertTrue(BreakTour.TAKEN_SEATS.isNotEmpty())
        assertTrue(BreakTour.TAKEN_SEATS.all { it.workerName.isNotBlank() })
    }

    // ----- pure formatting -----

    @Test fun time_labels_map_block_indices_to_the_sample_grid() {
        assertEquals("8:00", BreakTour.timeLabel(0))
        assertEquals("8:30", BreakTour.timeLabel(1))
        assertEquals("10:00", BreakTour.timeLabel(4))
        assertEquals("11:00", BreakTour.timeLabel(6))
    }

    @Test fun duration_labels_read_naturally_across_spans() {
        assertEquals("0m", BreakTour.durationLabel(0))
        assertEquals("30m", BreakTour.durationLabel(1))
        assertEquals("1h", BreakTour.durationLabel(2))
        assertEquals("1h 30m", BreakTour.durationLabel(3))
        assertEquals("3h", BreakTour.durationLabel(6))
    }

    @Test fun claim_summary_reflects_range_and_lane() {
        assertEquals(
            "Claiming 1h · 8:00 to 9:00 · Desk 1",
            BreakTour.claimSummary(0, 2, 0),
        )
        assertEquals(
            "Claiming 1h · 9:00 to 10:00 · Desk 2",
            BreakTour.claimSummary(2, 4, 1),
        )
    }

    @Test fun claim_summary_keeps_at_least_one_block_selected() {
        val line = BreakTour.claimSummary(6, 6, 0)
        assertTrue(line.contains("30m"), "expected a 30m floor, got: $line")
    }

    @Test fun drop_summary_starts_neutral_and_disabled_until_a_real_overlap_exists() {
        // No selection (sentinel -1): the neutral pre-drag prompt, never a hardcoded
        // always-enabled message.
        assertEquals("Drag over your hours to drop them", BreakTour.dropSummary(-1, -1))
        // An inverted/empty range reads the same as no selection.
        assertEquals("Drag over your hours to drop them", BreakTour.dropSummary(3, 3))
        // A real overlap with the worker's own claimed blocks produces a live message.
        assertEquals("Dropping 1h 30m · 9:00 to 10:30", BreakTour.dropSummary(2, 5))
        assertEquals("Dropping 30m · 9:00 to 9:30", BreakTour.dropSummary(2, 3))
    }

    @Test fun overlapping_mine_blocks_only_counts_the_workers_own_lane_and_range() {
        // Drag on the mine lane, fully covering the claimed blocks.
        assertEquals(
            BreakTour.MINE_BLOCKS,
            BreakTour.overlappingMineBlocks(0, BreakTour.SAMPLE_BLOCK_COUNT, BreakTour.MINE_LANE),
        )
        // Drag on the mine lane, partially covering.
        assertEquals(listOf(2, 3), BreakTour.overlappingMineBlocks(2, 4, BreakTour.MINE_LANE))
        // Drag on the other lane never counts as a drop, even at the same block indices.
        assertTrue(BreakTour.overlappingMineBlocks(0, BreakTour.SAMPLE_BLOCK_COUNT, 1).isEmpty())
        // Drag entirely outside the claimed range.
        assertTrue(BreakTour.overlappingMineBlocks(0, 1, BreakTour.MINE_LANE).isEmpty())
    }

    // ----- ViewModel sequencing -----

    @Test fun auto_start_begins_the_tour_only_when_unseen() {
        val vm = BreakTourViewModel()
        vm.autoStart()
        val s = vm.uiState.value
        assertTrue(s.active)
        assertEquals(1, s.stepIndex)
        assertEquals(3, s.stepCount)
        assertEquals(BreakTour.STEPS.first(), s.step)
        assertFalse(s.canGoBack)
        assertFalse(s.isLastStep)

        val seenVm = BreakTourViewModel(setOf(BreakTour.DONE_KEY))
        seenVm.autoStart()
        assertFalse(seenVm.uiState.value.active)
    }

    @Test fun next_advances_then_completes_and_persists_the_done_key() {
        val vm = BreakTourViewModel()
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
        assertTrue(BreakTour.DONE_KEY in done.seen)
    }

    @Test fun skip_completes_the_tour_immediately() {
        val vm = BreakTourViewModel()
        vm.autoStart()
        vm.skip()
        val s = vm.uiState.value
        assertFalse(s.active)
        assertTrue(BreakTour.DONE_KEY in s.seen)
    }

    @Test fun back_is_disabled_on_the_first_step_and_steps_back_thereafter() {
        val vm = BreakTourViewModel()
        vm.autoStart()
        vm.back() // no-op on step 1
        assertEquals(1, vm.uiState.value.stepIndex)
        vm.next()
        assertTrue(vm.uiState.value.canGoBack)
        vm.back()
        val s = vm.uiState.value
        assertEquals(1, s.stepIndex)
        assertFalse(s.canGoBack)
        assertFalse(BreakTour.DONE_KEY in s.seen)
    }

    @Test fun replay_reopens_from_step_one_even_after_completion() {
        val vm = BreakTourViewModel(setOf(BreakTour.DONE_KEY))
        vm.autoStart() // no-op, already seen
        assertFalse(vm.uiState.value.active)
        vm.replay()
        val s = vm.uiState.value
        assertTrue(s.active)
        assertEquals(1, s.stepIndex)
        assertNotNull(s.step)
    }
}
