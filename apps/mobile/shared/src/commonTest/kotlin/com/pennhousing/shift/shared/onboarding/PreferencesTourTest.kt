package com.pennhousing.shift.shared.onboarding

import com.pennhousing.shift.shared.viewmodel.PreferencesTourViewModel
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * PreferencesTour (shared) — the pure step copy + step-2/step-3 formatting math, and the thin
 * ViewModel that sequences the three steps and owns the done-flag. Pure; no clock, no I/O.
 */
class PreferencesTourTest {
    // ----- pure definitions -----

    @Test fun tour_has_exactly_three_ordered_steps() {
        assertEquals(3, PreferencesTour.STEPS.size)
        assertEquals(3, PreferencesTour.STEP_COUNT)
        assertEquals(
            listOf(PreferencesTourStepId.MODE, PreferencesTourStepId.PAINT, PreferencesTourStepId.TARGET),
            PreferencesTour.STEPS.map { it.id },
        )
        assertEquals(listOf("STEP 1", "STEP 2", "STEP 3"), PreferencesTour.STEPS.map { it.kicker })
    }

    @Test fun brush_order_is_available_preferred_cannot() {
        assertEquals(
            listOf(PreferencesTourBrush.AVAILABLE, PreferencesTourBrush.PREFERRED, PreferencesTourBrush.CANNOT),
            PreferencesTour.BRUSHES,
        )
        assertEquals(PreferencesTourBrush.PREFERRED, PreferencesTour.DEFAULT_BRUSH)
    }

    @Test fun done_key_has_its_own_namespace() {
        assertEquals("tour.preferences.done", PreferencesTour.DONE_KEY)
    }

    @Test fun no_user_facing_copy_uses_em_or_en_dashes() {
        val strings =
            PreferencesTour.STEPS.flatMap { listOf(it.kicker, it.title, it.body) } +
                PreferencesTour.paintSummaryLine(0, 0, 0) +
                PreferencesTour.paintSummaryLine(4, 0, 4) +
                PreferencesTour.targetLabel(PreferencesTour.SAMPLE_TARGET_HOURS)
        for (s in strings) {
            assertFalse(s.contains('—'), "em dash in: $s")
            assertFalse(s.contains('–'), "en dash in: $s")
        }
    }

    // ----- pure formatting -----

    @Test fun time_labels_map_block_indices_to_the_sample_grid() {
        assertEquals("9:00 AM", PreferencesTour.timeLabel(0))
        assertEquals("9:30 AM", PreferencesTour.timeLabel(1))
        assertEquals("11:00 AM", PreferencesTour.timeLabel(4))
        assertEquals("12:00 PM", PreferencesTour.timeLabel(6))
        assertEquals("1:00 PM", PreferencesTour.timeLabel(8))
    }

    @Test fun duration_labels_read_naturally_across_spans() {
        assertEquals("0m", PreferencesTour.durationLabel(0))
        assertEquals("30m", PreferencesTour.durationLabel(1))
        assertEquals("1h", PreferencesTour.durationLabel(2))
        assertEquals("1h 30m", PreferencesTour.durationLabel(3))
        assertEquals("4h", PreferencesTour.durationLabel(8))
    }

    @Test fun paint_summary_reads_no_hours_painted_yet_when_empty() {
        assertEquals("No hours painted yet", PreferencesTour.paintSummaryLine(0, 0, 0))
    }

    @Test fun paint_summary_reflects_the_painted_span() {
        assertEquals(
            "Painted 2h · 10:00 AM to 12:00 PM",
            PreferencesTour.paintSummaryLine(paintedCount = 4, fromBlock = 2, toBlock = 6),
        )
        assertEquals(
            "Painted 4h · 9:00 AM to 1:00 PM",
            PreferencesTour.paintSummaryLine(paintedCount = 8, fromBlock = 0, toBlock = 8),
        )
    }

    @Test fun paint_summary_keeps_at_least_one_block_selected_when_painted() {
        val line = PreferencesTour.paintSummaryLine(paintedCount = 1, fromBlock = 8, toBlock = 8)
        assertTrue(line.contains("30m"), "expected a 30m floor, got: $line")
    }

    @Test fun target_label_and_fraction_track_the_sample_cap() {
        assertEquals("12h", PreferencesTour.targetLabel(PreferencesTour.SAMPLE_TARGET_HOURS))
        assertEquals("0h", PreferencesTour.targetLabel(0))
        assertEquals(0.6, PreferencesTour.targetFraction(12, capHours = 20))
        assertEquals(1.0, PreferencesTour.targetFraction(25, capHours = 20)) // clamped
        assertEquals(0.0, PreferencesTour.targetFraction(-5, capHours = 20)) // clamped
    }

    @Test fun clamp_target_steps_within_the_cap() {
        assertEquals(20, PreferencesTour.clampTarget(24, capHours = 20))
        assertEquals(0, PreferencesTour.clampTarget(-2, capHours = 20))
        assertEquals(12, PreferencesTour.clampTarget(12, capHours = 20))
    }

    // ----- ViewModel sequencing -----

    @Test fun auto_start_begins_the_tour_only_when_unseen() {
        val vm = PreferencesTourViewModel()
        vm.autoStart()
        val s = vm.uiState.value
        assertTrue(s.active)
        assertEquals(1, s.stepIndex)
        assertEquals(3, s.stepCount)
        assertEquals(PreferencesTour.STEPS.first(), s.step)
        assertFalse(s.canGoBack)
        assertFalse(s.isLastStep)

        val seenVm = PreferencesTourViewModel(setOf(PreferencesTour.DONE_KEY))
        seenVm.autoStart()
        assertFalse(seenVm.uiState.value.active)
    }

    @Test fun next_advances_then_completes_and_persists_the_done_key() {
        val vm = PreferencesTourViewModel()
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
        assertTrue(PreferencesTour.DONE_KEY in done.seen)
    }

    @Test fun skip_completes_the_tour_immediately() {
        val vm = PreferencesTourViewModel()
        vm.autoStart()
        vm.skip()
        val s = vm.uiState.value
        assertFalse(s.active)
        assertTrue(PreferencesTour.DONE_KEY in s.seen)
    }

    @Test fun back_is_disabled_on_the_first_step_and_steps_back_thereafter() {
        val vm = PreferencesTourViewModel()
        vm.autoStart()
        vm.back() // no-op on step 1
        assertEquals(1, vm.uiState.value.stepIndex)
        vm.next()
        assertTrue(vm.uiState.value.canGoBack)
        vm.back()
        val s = vm.uiState.value
        assertEquals(1, s.stepIndex)
        assertFalse(s.canGoBack)
        assertFalse(PreferencesTour.DONE_KEY in s.seen)
    }

    @Test fun replay_reopens_from_step_one_even_after_completion() {
        val vm = PreferencesTourViewModel(setOf(PreferencesTour.DONE_KEY))
        vm.autoStart() // no-op, already seen
        assertFalse(vm.uiState.value.active)
        vm.replay()
        val s = vm.uiState.value
        assertTrue(s.active)
        assertEquals(1, s.stepIndex)
        assertNotNull(s.step)
    }
}
