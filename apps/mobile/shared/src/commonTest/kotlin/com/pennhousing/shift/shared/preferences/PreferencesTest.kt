package com.pennhousing.shift.shared.preferences

import com.pennhousing.shift.shared.shifts.NEW_YORK
import com.pennhousing.shift.shared.viewmodel.PreferencesViewModel
import kotlinx.datetime.toLocalDateTime
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.time.Instant

/**
 * Preference-submission presentation (shared) — the Mon-Sun strip, the drag-paint day
 * timeline (bare segments + gutter hours + per-run labels), the target-hours meter, the
 * banner, the submit payload, and the edit-until-deadline + dirty lifecycle, all over an
 * injected period snapshot. Fixtures pin explicit America/New_York offsets (EDT −04:00).
 * Anchor: week of Mon 2026-06-08 (a real Monday) .. Sun 2026-06-14.
 */
class PreferencesTest {
    private fun at(iso: String): Instant = Instant.parse(iso)

    private fun block(
        id: String,
        iso: String,
    ) = PrefBlock(blockId = id, start = at(iso))

    private val weekStart = at("2026-06-08T12:00:00-04:00").toLocalDateTime(NEW_YORK).date // Mon Jun 8

    // Mon has two AVAILABLE blocks; Wed has four (two pre-painted); the rest empty.
    private val mon = listOf(block("d0-b0", "2026-06-08T08:00:00-04:00"), block("d0-b1", "2026-06-08T08:30:00-04:00"))
    private val wed =
        listOf(
            block("d2-b0", "2026-06-10T08:00:00-04:00"),
            block("d2-b1", "2026-06-10T08:30:00-04:00"),
            block("d2-b2", "2026-06-10T09:00:00-04:00"),
            block("d2-b3", "2026-06-10T09:30:00-04:00"),
        )
    private val days = listOf(mon, emptyList(), wed, emptyList(), emptyList(), emptyList(), emptyList())

    private fun period(
        submitted: Boolean = false,
        target: Int = 16,
        optedOut: Boolean = false,
        deadlinePassed: Boolean = false,
    ) = PreferencePeriod(
        periodId = "period-test",
        periodLabel = "Week of Jun 8",
        deadlineLabel = "Due Fri 17:00",
        submitted = submitted,
        deadlinePassed = deadlinePassed,
        weekStart = weekStart,
        days = days,
        initialStatuses = mapOf("d2-b0" to PrefBrush.CANNOT, "d2-b2" to PrefBrush.PREFERRED),
        targetHours = target,
        optedOut = optedOut,
    )

    // ----- brush vocabulary -----

    @Test fun brush_order_and_db_status() {
        assertEquals(listOf(PrefBrush.AVAILABLE, PrefBrush.PREFERRED, PrefBrush.CANNOT), PREF_BRUSH_ORDER)
        assertEquals("available", PrefBrush.AVAILABLE.dbStatus)
        assertEquals("preferred", PrefBrush.PREFERRED.dbStatus)
        assertEquals("cannot", PrefBrush.CANNOT.dbStatus)
    }

    // ----- week strip -----

    @Test fun week_strip_has_seven_cells_letters_dates_and_painted_days() {
        val strip = buildPrefWeekStrip(period(), period().initialGrid(), selectedDayIndex = 2)
        assertEquals(7, strip.cells.size)
        assertEquals(listOf("M", "T", "W", "T", "F", "S", "S"), strip.cells.map { it.dayLetter })
        assertEquals(listOf("8", "9", "10", "11", "12", "13", "14"), strip.cells.map { it.dateLabel })
        assertEquals("Jun 8 - Jun 14", strip.rangeLabel)
        assertTrue(strip.cells[2].selected) // Wed selected
        assertFalse(strip.cells[0].selected)
        assertTrue(strip.cells[2].painted) // Wed has Cannot + Preferred
        assertFalse(strip.cells[0].painted) // Mon all available
        assertFalse(strip.cells[1].painted) // empty day
    }

    // ----- selected-day timeline -----

    @Test fun day_view_has_bare_segments_brushes_and_summary() {
        val day = buildPrefDay(period(), period().initialGrid(), selectedDayIndex = 2)
        assertEquals("Wed · Jun 10", day.title)
        assertEquals(4, day.cells.size)
        assertEquals(PrefBrush.CANNOT, day.cells[0].brush)
        assertEquals(PrefBrush.AVAILABLE, day.cells[1].brush) // unset → AVAILABLE
        assertEquals(PrefBrush.PREFERRED, day.cells[2].brush)
        assertEquals(PrefDaySummary(preferred = 1, available = 2, cannot = 1), day.summary)
        assertFalse(day.isEmpty)
    }

    @Test fun day_view_marks_hour_starts_and_carries_a11y_labels_not_visible_text() {
        val day = buildPrefDay(period(), period().initialGrid(), selectedDayIndex = 2)
        // 08:00 + 09:00 are on the hour; 08:30 + 09:30 are not.
        assertEquals(listOf(true, false, true, false), day.cells.map { it.isHourStart })
        // The time is accessibility copy, NOT a rendered per-cell label.
        assertEquals("8:00 AM - 8:30 AM · cannot", day.cells[0].a11yLabel)
        assertEquals("8:30 AM - 9:00 AM · available", day.cells[1].a11yLabel)
    }

    @Test fun day_view_exposes_hour_marks_aligned_to_hour_boundaries() {
        val day = buildPrefDay(period(), period().initialGrid(), selectedDayIndex = 2)
        // Marks at every on-the-hour boundary 08:00, 09:00, and the end edge 10:00.
        assertEquals(listOf(0, 2, 4), day.hourMarks.map { it.boundaryIndex })
        // Meridiem only on the first mark (and at noon/midnight, none here).
        assertEquals(listOf("8 AM", "9", "10"), day.hourMarks.map { it.label })
    }

    @Test fun day_view_groups_contiguous_painted_blocks_into_labelled_runs() {
        val day = buildPrefDay(period(), period().initialGrid(), selectedDayIndex = 2)
        // d2-b0 Cannot (1 block), d2-b2 Preferred (1 block); the AVAILABLE gaps are not runs.
        assertEquals(2, day.runs.size)
        assertEquals(PrefBrush.CANNOT, day.runs[0].brush)
        assertEquals(0, day.runs[0].startBlockIndex)
        assertEquals(1, day.runs[0].blockCount)
        assertEquals("8:00 - 8:30 AM", day.runs[0].label)
        assertEquals(PrefBrush.PREFERRED, day.runs[1].brush)
        assertEquals("9:00 - 9:30 AM", day.runs[1].label)
    }

    @Test fun all_available_day_has_no_runs() {
        val day = buildPrefDay(period(), period().initialGrid(), selectedDayIndex = 0) // Mon all available
        assertTrue(day.runs.isEmpty())
    }

    @Test fun empty_day_is_empty_with_zero_summary_and_no_marks() {
        val day = buildPrefDay(period(), period().initialGrid(), selectedDayIndex = 1)
        assertTrue(day.isEmpty)
        assertEquals(PrefDaySummary(0, 0, 0), day.summary)
        assertTrue(day.hourMarks.isEmpty())
        assertTrue(day.runs.isEmpty())
    }

    // ----- range label -----

    @Test fun range_label_drops_leading_meridiem_when_shared() {
        // Same meridiem (AM) → "8:00 - 10:00 AM"; single block → "8:00 - 8:30 AM".
        assertEquals("8:00 - 10:00 AM", prefRangeLabel(wed, 0, 3))
        assertEquals("8:00 - 8:30 AM", prefRangeLabel(wed, 0, 0))
    }

    @Test fun range_label_shows_both_meridiems_across_noon() {
        val span =
            listOf(
                block("x0", "2026-06-10T11:30:00-04:00"),
                block("x1", "2026-06-10T12:00:00-04:00"),
            )
        assertEquals("11:30 AM - 12:30 PM", prefRangeLabel(span, 0, 1))
    }

    // ----- grid painting -----

    @Test fun paint_sets_one_block_and_leaves_others_untouched() {
        val g0 = period().initialGrid()
        val g1 = g0.paint("d2-b1", PrefBrush.CANNOT)
        assertEquals(PrefBrush.CANNOT, g1.statusOf("d2-b1"))
        assertEquals(PrefBrush.CANNOT, g1.statusOf("d2-b0")) // pre-painted, unchanged
        assertEquals(PrefBrush.PREFERRED, g1.statusOf("d2-b2")) // unchanged
        assertEquals(PrefBrush.AVAILABLE, g0.statusOf("d2-b1")) // original immutable
    }

    @Test fun unknown_block_defaults_to_available() {
        assertEquals(PrefBrush.AVAILABLE, PreferenceGrid(emptyMap()).statusOf("nope"))
    }

    // ----- target meter -----

    @Test fun target_meter_label_and_fraction() {
        val m = buildTargetMeter(targetHours = 16, optedOut = false, capHours = 20)
        assertEquals("16h", m.label)
        assertEquals("20h", m.capLabel)
        assertEquals(0.8, m.fraction, 1e-9)
    }

    @Test fun target_meter_zeroes_when_opted_out() {
        val m = buildTargetMeter(targetHours = 16, optedOut = true, capHours = 20)
        assertEquals("0h", m.label)
        assertEquals(0.0, m.fraction, 1e-9)
    }

    @Test fun clamp_target_bounds() {
        assertEquals(0, clampTarget(-2, 20))
        assertEquals(20, clampTarget(22, 20))
        assertEquals(16, clampTarget(16, 20))
    }

    // ----- banner -----

    @Test fun banner_open_not_submitted_is_submit_by_deadline() {
        val editable = buildPreferenceBanner(period(submitted = false), isDirty = false)
        assertEquals(PrefBannerTone.INFO, editable.tone)
        assertEquals("Submit by Due Fri 17:00", editable.title)
    }

    @Test fun banner_submitted_but_editable_is_success_not_read_only() {
        val done = buildPreferenceBanner(period(submitted = true), isDirty = false)
        assertEquals(PrefBannerTone.SUCCESS, done.tone)
        assertEquals("Submitted — you can still edit", done.title)
    }

    @Test fun banner_dirty_warns_about_losing_edits() {
        val dirty = buildPreferenceBanner(period(submitted = true), isDirty = true)
        assertEquals("Unsaved changes", dirty.title)
        assertTrue(dirty.body.contains("Due Fri 17:00"))
    }

    @Test fun banner_deadline_passed_with_submission_is_window_closed() {
        val banner = buildPreferenceBanner(period(submitted = true, deadlinePassed = true))
        assertEquals(PrefBannerTone.SUCCESS, banner.tone)
        assertEquals("Submitted · window closed", banner.title)
    }

    @Test fun banner_deadline_passed_without_submission_is_locked() {
        val banner = buildPreferenceBanner(period(submitted = false, deadlinePassed = true))
        assertEquals("Deadline passed — preferences are locked", banner.title)
    }

    // ----- submit payload -----

    @Test fun submit_payload_flattens_every_block_with_target_and_optout() {
        val payload = buildSubmitPayload(period(), period().initialGrid(), targetHours = 16, optedOut = false)
        assertEquals("period-test", payload.periodId)
        assertEquals(6, payload.entries.size) // 2 (Mon) + 4 (Wed)
        assertEquals(16, payload.targetHours)
        assertFalse(payload.optedOut)
        assertEquals("cannot", payload.entries.first { it.blockId == "d2-b0" }.status)
        assertEquals("preferred", payload.entries.first { it.blockId == "d2-b2" }.status)
        assertEquals("available", payload.entries.first { it.blockId == "d0-b0" }.status)
    }

    @Test fun submit_payload_zeroes_target_when_opted_out() {
        val payload = buildSubmitPayload(period(), period().initialGrid(), targetHours = 16, optedOut = true)
        assertEquals(0, payload.targetHours)
        assertTrue(payload.optedOut)
    }

    // ----- ViewModel reducer -----

    @Test fun viewmodel_paints_with_current_brush_and_updates_summary() {
        val vm = PreferencesViewModel(period())
        vm.selectDay(2)
        vm.setBrush(PrefBrush.CANNOT)
        vm.paint("d2-b1")
        val day = vm.uiState.value.day
        assertEquals(PrefBrush.CANNOT, day.cells[1].brush)
        assertEquals(2, day.summary.cannot) // b0 (pre) + b1 (painted)
    }

    @Test fun viewmodel_paint_range_paints_the_inclusive_span_with_current_brush() {
        val vm = PreferencesViewModel(period())
        vm.selectDay(2)
        vm.setBrush(PrefBrush.PREFERRED)
        vm.paintRange("d2-b0", "d2-b3") // whole Wed span
        val day = vm.uiState.value.day
        assertTrue(day.cells.all { it.brush == PrefBrush.PREFERRED })
        assertEquals(4, day.summary.preferred)
        assertEquals(1, day.runs.size)
        assertEquals("8:00 - 10:00 AM", day.runs[0].label)
    }

    @Test fun viewmodel_paint_range_is_order_independent() {
        val vm = PreferencesViewModel(period())
        vm.selectDay(2)
        vm.setBrush(PrefBrush.CANNOT)
        vm.paintRange("d2-b3", "d2-b1") // dragged "upward"
        val day = vm.uiState.value.day
        assertEquals(PrefBrush.CANNOT, day.cells[1].brush)
        assertEquals(PrefBrush.CANNOT, day.cells[2].brush)
        assertEquals(PrefBrush.CANNOT, day.cells[3].brush)
    }

    @Test fun viewmodel_steps_target_within_cap() {
        val vm = PreferencesViewModel(period(target = 18))
        vm.incrementTarget()
        assertEquals(20, vm.uiState.value.targetHours) // 18 + 2, clamped to cap
        vm.incrementTarget()
        assertEquals(20, vm.uiState.value.targetHours) // stays at cap
    }

    @Test fun viewmodel_context_label_combines_period_and_deadline() {
        val vm = PreferencesViewModel(period())
        assertEquals("WEEK OF JUN 8 · DUE FRI 17:00", vm.uiState.value.contextLabel)
    }

    // ----- edit-until-deadline + dirty lifecycle -----

    @Test fun viewmodel_starts_clean_not_dirty() {
        val state = PreferencesViewModel(period()).uiState.value
        assertFalse(state.isDirty)
        assertFalse(state.readOnly)
    }

    @Test fun viewmodel_paint_marks_state_dirty() {
        val vm = PreferencesViewModel(period())
        vm.selectDay(2)
        vm.setBrush(PrefBrush.PREFERRED)
        vm.paint("d2-b1")
        assertTrue(vm.uiState.value.isDirty)
    }

    @Test fun viewmodel_target_change_marks_state_dirty() {
        val vm = PreferencesViewModel(period())
        vm.incrementTarget()
        assertTrue(vm.uiState.value.isDirty)
    }

    @Test fun viewmodel_repainting_back_to_saved_clears_dirty() {
        val vm = PreferencesViewModel(period())
        vm.selectDay(2)
        vm.setBrush(PrefBrush.CANNOT)
        vm.paint("d2-b1") // dirty
        assertTrue(vm.uiState.value.isDirty)
        vm.setBrush(PrefBrush.AVAILABLE)
        vm.paint("d2-b1") // back to the saved (unset → available) status
        assertFalse(vm.uiState.value.isDirty)
    }

    @Test fun viewmodel_revert_restores_baseline_and_clears_dirty() {
        val vm = PreferencesViewModel(period())
        vm.selectDay(2)
        vm.setBrush(PrefBrush.CANNOT)
        vm.paint("d2-b1")
        vm.incrementTarget()
        assertTrue(vm.uiState.value.isDirty)
        vm.revert()
        val state = vm.uiState.value
        assertFalse(state.isDirty)
        assertEquals(PrefBrush.AVAILABLE, state.day.cells[1].brush)
        assertEquals(16, state.targetHours)
    }

    @Test fun viewmodel_submit_keeps_grid_editable_and_clears_dirty() {
        val vm = PreferencesViewModel(period())
        vm.selectDay(2)
        vm.setBrush(PrefBrush.CANNOT)
        vm.paint("d2-b1")
        vm.submit()
        val afterSubmit = vm.uiState.value
        assertFalse(afterSubmit.readOnly) // NOT locked — still editable until the deadline
        assertTrue(afterSubmit.hasSubmitted)
        assertFalse(afterSubmit.isDirty) // re-baselined
        assertEquals(PrefBannerTone.SUCCESS, afterSubmit.banner.tone)
        assertEquals("Submitted — you can still edit", afterSubmit.banner.title)
        // Edits still apply after submitting.
        vm.paint("d2-b3")
        val afterEdit = vm.uiState.value
        assertEquals(PrefBrush.CANNOT, afterEdit.day.cells[3].brush)
        assertTrue(afterEdit.isDirty)
    }

    @Test fun viewmodel_revert_after_submit_returns_to_submitted_baseline_not_original() {
        val vm = PreferencesViewModel(period())
        vm.selectDay(2)
        vm.setBrush(PrefBrush.CANNOT)
        vm.paint("d2-b1")
        vm.submit() // baseline now includes d2-b1 = Cannot
        vm.paint("d2-b3") // a new, unsaved edit
        vm.revert()
        val state = vm.uiState.value
        assertFalse(state.isDirty)
        assertEquals(PrefBrush.CANNOT, state.day.cells[1].brush) // kept from the submit
        assertEquals(PrefBrush.AVAILABLE, state.day.cells[3].brush) // the unsaved edit reverted
    }

    // ----- submit / discard affordances -----

    @Test fun submit_button_shown_first_time_then_hidden_when_clean() {
        val vm = PreferencesViewModel(period(submitted = false))
        val initial = vm.uiState.value
        assertTrue(initial.showSubmit) // never submitted → always offer submit
        assertFalse(initial.showDiscard)
        assertEquals("Submit preferences", initial.submitLabel)
        vm.submit()
        val afterSubmit = vm.uiState.value
        assertFalse(afterSubmit.showSubmit) // submitted + clean → nothing to submit
        assertFalse(afterSubmit.showDiscard)
    }

    @Test fun submit_and_discard_shown_only_when_dirty_after_submission() {
        val vm = PreferencesViewModel(period(submitted = true))
        val clean = vm.uiState.value
        assertFalse(clean.showSubmit) // already submitted, no edits
        assertFalse(clean.showDiscard)
        vm.selectDay(2)
        vm.setBrush(PrefBrush.PREFERRED)
        vm.paint("d2-b1")
        val dirty = vm.uiState.value
        assertTrue(dirty.showSubmit)
        assertTrue(dirty.showDiscard)
        assertEquals("Submit changes", dirty.submitLabel)
    }

    // ----- deadline-expired lock (D9, §4.2) -----

    @Test fun deadline_passed_makes_the_screen_read_only_and_blocks_edits() {
        val vm = PreferencesViewModel(period(deadlinePassed = true))
        val state = vm.uiState.value
        assertTrue(state.readOnly)
        assertFalse(state.showSubmit)
        assertFalse(state.showDiscard)
        assertEquals("Deadline passed — preferences are locked", state.banner.title)
        // Edits + submit are no-ops past the deadline (the RPC would reject anyway).
        vm.selectDay(2)
        vm.paint("d2-b1")
        assertEquals(PrefBrush.AVAILABLE, vm.uiState.value.day.cells[1].brush)
        vm.submit()
        assertFalse(vm.uiState.value.hasSubmitted)
    }
}
