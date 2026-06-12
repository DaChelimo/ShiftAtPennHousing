package com.pennhousing.shift.shared.house

import com.pennhousing.shift.shared.viewmodel.HouseScheduleViewModel
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Instant

/**
 * House schedule (§11.4, T3b) — placing per-block seats on the Mon–Sun strip and
 * coalescing contiguous same-seat runs into roster rows with the contact fields
 * the full-directory ruling unlocked. Fixtures pin EST -05:00; now is Thu
 * 2026-01-15 14:00 ET (week Mon 01-12 .. Sun 01-18; Thu = index 3).
 */
class HouseScheduleTest {
    private fun at(iso: String): Instant = Instant.parse(iso)

    private val now = at("2026-01-15T14:00:00-05:00")

    private fun seats(
        prefix: String,
        startIso: String,
        n: Int,
        name: String? = "Worker $prefix",
        phone: String? = "+1$prefix",
        vacant: Boolean = false,
        pending: Boolean = false,
    ): List<HouseSeat> {
        val start = at(startIso)
        return (0 until n).map { i ->
            HouseSeat(
                id = "$prefix-$i",
                start = start + (i * 30).minutes,
                end = start + ((i + 1) * 30).minutes,
                vacant = vacant,
                pending = pending,
                floatIn = pending,
                userId = if (name != null) "u-$prefix" else null,
                workerName = name,
                workerPhone = phone,
            )
        }
    }

    @Test fun contiguous_same_worker_seats_coalesce_into_one_roster_row_with_contact() {
        val day = buildHouseDay(seats("a", "2026-01-15T14:00:00-05:00", 8), selectedDayIndex = 3, now = now)
        val row = day.rows.single()
        assertEquals("a-0", row.id)
        assertEquals("14:00 – 18:00", row.timeLabel)
        assertEquals("4h", row.durationLabel)
        assertEquals("Worker a", row.workerName)
        assertEquals("+1a", row.workerPhone) // §11.4 contact lookup (full-directory ruling)
        assertTrue(row.active) // 14:00 ≤ now < 18:00
    }

    @Test fun different_workers_on_parallel_seats_stay_separate_rows() {
        // Headcount 2: two workers covering the same span → two rows, name-ordered.
        val a = seats("a", "2026-01-15T14:00:00-05:00", 4, name = "Maya")
        val b = seats("b", "2026-01-15T14:00:00-05:00", 4, name = "Jordan")
        val day = buildHouseDay(a + b, selectedDayIndex = 3, now = now)
        assertEquals(2, day.rows.size)
        assertEquals(listOf("Jordan", "Maya"), day.rows.map { it.workerName })
    }

    @Test fun vacant_runs_coalesce_separately_and_carry_no_contact() {
        val staffed = seats("a", "2026-01-15T14:00:00-05:00", 2)
        val open = seats("v", "2026-01-15T15:00:00-05:00", 4, name = null, phone = null, vacant = true)
        val day = buildHouseDay(staffed + open, selectedDayIndex = 3, now = now)
        assertEquals(2, day.rows.size)
        val vacantRow = day.rows.single { it.vacant }
        assertNull(vacantRow.workerName)
        assertNull(vacantRow.workerPhone)
        assertEquals("15:00 – 17:00", vacantRow.timeLabel)
    }

    @Test fun a_gap_splits_a_workers_runs() {
        val morning = seats("a", "2026-01-15T09:00:00-05:00", 2)
        val evening = seats("a2", "2026-01-15T18:00:00-05:00", 2).map { it.copy(userId = "u-a", workerName = "Worker a") }
        val day = buildHouseDay(morning + evening, selectedDayIndex = 3, now = now)
        assertEquals(2, day.rows.size)
        assertFalse(day.rows[1].active) // 18:00 run not yet started at 14:00
    }

    @Test fun pending_float_seats_are_flagged_and_do_not_merge_with_settled_ones() {
        val settled = seats("a", "2026-01-15T14:00:00-05:00", 2)
        val pending = seats("p", "2026-01-15T15:00:00-05:00", 2, pending = true)
        val day = buildHouseDay(settled + pending, selectedDayIndex = 3, now = now)
        assertEquals(2, day.rows.size)
        assertTrue(day.rows.single { it.id == "p-0" }.pending)
        assertTrue(day.rows.single { it.id == "p-0" }.floatIn)
    }

    @Test fun seats_on_other_days_are_excluded_and_strip_dots_mark_seat_days() {
        val thu = seats("a", "2026-01-15T14:00:00-05:00", 2) // Thu = 3
        val sat = seats("s", "2026-01-17T10:00:00-05:00", 2) // Sat = 5
        assertEquals(emptyList(), buildHouseDay(thu + sat, selectedDayIndex = 0, now = now).rows)
        assertEquals(1, buildHouseDay(thu + sat, selectedDayIndex = 5, now = now).rows.size)
        assertEquals(setOf(3, 5), houseDaysWithSeats(thu + sat, now))
    }

    @Test fun view_model_defaults_to_today_and_select_day_moves_the_roster() {
        val snapshot =
            HouseScheduleSnapshot(
                houseName = "Harnwell",
                deskPhone = "+1 215 555 0142",
                seats = seats("a", "2026-01-15T14:00:00-05:00", 2) + seats("s", "2026-01-17T10:00:00-05:00", 2),
            )
        val vm = HouseScheduleViewModel(snapshot, now)
        val initial = vm.uiState.value
        assertEquals(3, initial.selectedDayIndex) // Thu (today)
        assertEquals("Harnwell", initial.houseName)
        assertEquals("+1 215 555 0142", initial.deskPhone)
        assertEquals(1, initial.day.rows.size)
        assertEquals(setOf(3, 5), initial.daysWithSeats)
        assertTrue(initial.week.days[5].hasShifts) // strip dot on Sat
        assertFalse(initial.week.days[0].hasShifts)
        vm.selectDay(5)
        assertEquals("s-0", vm.uiState.value.day.rows.single().id)
    }
}
