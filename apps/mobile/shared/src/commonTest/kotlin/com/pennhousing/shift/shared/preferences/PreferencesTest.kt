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
 * Preference-submission presentation (shared) — the Mon–Sun strip, the tri-state
 * paint grid, the target-hours meter, the banner, and the submit payload, all over
 * an injected period snapshot. Fixtures pin explicit America/New_York offsets
 * (EDT −04:00). Anchor: week of Mon 2026-06-08 (a real Monday) .. Sun 2026-06-14.
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
    ) = PreferencePeriod(
        periodId = "period-test",
        periodLabel = "Week of Jun 8",
        deadlineLabel = "Due Fri 17:00",
        submitted = submitted,
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
        assertEquals("Jun 8 – Jun 14", strip.rangeLabel)
        assertTrue(strip.cells[2].selected) // Wed selected
        assertFalse(strip.cells[0].selected)
        assertTrue(strip.cells[2].painted) // Wed has Cannot + Preferred
        assertFalse(strip.cells[0].painted) // Mon all available
        assertFalse(strip.cells[1].painted) // empty day
    }

    // ----- selected-day grid -----

    @Test fun day_grid_has_time_labels_brushes_and_summary() {
        val day = buildPrefDay(period(), period().initialGrid(), selectedDayIndex = 2)
        assertEquals("Wed · Jun 10", day.title)
        assertEquals(listOf("08:00", "08:30", "09:00", "09:30"), day.cells.map { it.timeLabel })
        assertEquals(PrefBrush.CANNOT, day.cells[0].brush)
        assertEquals(PrefBrush.AVAILABLE, day.cells[1].brush) // unset → AVAILABLE
        assertEquals(PrefBrush.PREFERRED, day.cells[2].brush)
        assertEquals(PrefDaySummary(preferred = 1, available = 2, cannot = 1), day.summary)
        assertFalse(day.isEmpty)
    }

    @Test fun empty_day_is_empty_with_zero_summary() {
        val day = buildPrefDay(period(), period().initialGrid(), selectedDayIndex = 1)
        assertTrue(day.isEmpty)
        assertEquals(PrefDaySummary(0, 0, 0), day.summary)
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

    @Test fun banner_editable_then_read_only() {
        val editable = buildPreferenceBanner(period(submitted = false))
        assertEquals(PrefBannerTone.INFO, editable.tone)
        assertEquals("Submit by Due Fri 17:00", editable.title)

        val done = buildPreferenceBanner(period(submitted = true))
        assertEquals(PrefBannerTone.SUCCESS, done.tone)
        assertEquals("Submitted · read-only", done.title)
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

    @Test fun viewmodel_steps_target_within_cap() {
        val vm = PreferencesViewModel(period(target = 18))
        vm.incrementTarget()
        assertEquals(20, vm.uiState.value.targetHours) // 18 + 2, clamped to cap
        vm.incrementTarget()
        assertEquals(20, vm.uiState.value.targetHours) // stays at cap
    }

    @Test fun viewmodel_submit_flips_to_read_only_and_blocks_edits() {
        val vm = PreferencesViewModel(period())
        vm.selectDay(2)
        vm.submit()
        assertTrue(vm.uiState.value.submitted)
        assertEquals(PrefBannerTone.SUCCESS, vm.uiState.value.banner.tone)
        // edits are no-ops once submitted
        vm.setBrush(PrefBrush.CANNOT)
        vm.paint("d2-b1")
        assertEquals(PrefBrush.AVAILABLE, vm.uiState.value.day.cells[1].brush)
    }

    @Test fun viewmodel_context_label_combines_period_and_deadline() {
        val vm = PreferencesViewModel(period())
        assertEquals("WEEK OF JUN 8 · DUE FRI 17:00", vm.uiState.value.contextLabel)
    }
}
