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
 * coalescing contiguous same-seat runs into readable roster ROWS, with the "You"
 * marker and the contact fields the full-directory ruling unlocked, plus the week
 * navigation + cross-house switcher. Fixtures pin EST -05:00; now is Thu 2026-01-15
 * 14:00 ET (week Mon 01-12 .. Sun 01-18; Thu = index 3).
 */
class HouseScheduleTest {
    private fun at(iso: String): Instant = Instant.parse(iso)

    private val now = at("2026-01-15T14:00:00-05:00")
    private val me = "u-me"

    private fun seats(
        prefix: String,
        startIso: String,
        n: Int,
        name: String? = "Worker $prefix",
        userId: String? = "u-$prefix",
        phone: String? = "+1$prefix",
        vacant: Boolean = false,
        pending: Boolean = false,
        floatIn: Boolean = false,
    ): List<HouseSeat> {
        val start = at(startIso)
        return (0 until n).map { i ->
            HouseSeat(
                id = "$prefix-$i",
                start = start + (i * 30).minutes,
                end = start + ((i + 1) * 30).minutes,
                vacant = vacant,
                pending = pending,
                floatIn = pending || floatIn,
                userId = if (vacant) null else userId,
                workerName = if (vacant) null else name,
                workerPhone = if (vacant) null else phone,
            )
        }
    }

    // ----- roster coalescing -----

    @Test fun contiguous_same_worker_seats_coalesce_into_one_row_with_contact() {
        // 4h Thu run (14:00–18:00) arrives as 8 per-30-min seats → one roster row.
        val day = buildHouseDay(seats("a", "2026-01-15T14:00:00-05:00", 8), selectedDayIndex = 3, now = now, meUserId = me)
        val row = day.rows.single()
        assertEquals("a-0", row.id)
        assertEquals("14:00 – 18:00", row.timeLabel)
        assertEquals("4h", row.durationLabel)
        assertEquals("Worker a", row.workerName)
        assertEquals("+1a", row.workerPhone) // §11.4 contact (full-directory ruling)
        assertTrue(row.active) // 14:00 ≤ now < 18:00
        assertFalse(row.mine)
    }

    @Test fun the_signed_in_workers_row_is_flagged_mine() {
        val day = buildHouseDay(seats("a", "2026-01-15T09:00:00-05:00", 4, userId = me), selectedDayIndex = 3, now = now, meUserId = me)
        assertTrue(day.rows.single().mine)
    }

    @Test fun end_of_day_run_renders_to_midnight() {
        // Same `formatTimeRange` helper the My-Shifts agenda uses → a midnight end reads "00:00".
        val day = buildHouseDay(seats("a", "2026-01-15T20:00:00-05:00", 8), selectedDayIndex = 3, now = now) // 20:00–00:00
        assertEquals("20:00 – 00:00", day.rows.single().timeLabel)
    }

    @Test fun different_workers_on_parallel_seats_stay_separate_rows() {
        // Headcount 2: two workers covering the same span → two rows, name-ordered.
        val a = seats("a", "2026-01-15T14:00:00-05:00", 4, name = "Maya", userId = "u-maya")
        val b = seats("b", "2026-01-15T14:00:00-05:00", 4, name = "Jordan", userId = "u-jordan")
        val day = buildHouseDay(a + b, selectedDayIndex = 3, now = now)
        assertEquals(2, day.rows.size)
        assertEquals(listOf("Jordan", "Maya"), day.rows.map { it.workerName })
    }

    @Test fun sequential_runs_on_one_desk_stay_separate_rows() {
        val morning = seats("a", "2026-01-15T08:00:00-05:00", 8) // 08:00–12:00
        val afternoon = seats("b", "2026-01-15T12:00:00-05:00", 8, name = "Two", userId = "u-two") // 12:00–16:00
        val day = buildHouseDay(morning + afternoon, selectedDayIndex = 3, now = now)
        assertEquals(2, day.rows.size)
    }

    @Test fun vacant_runs_are_open_and_carry_no_contact() {
        val open = seats("v", "2026-01-15T16:00:00-05:00", 4, vacant = true)
        val row = buildHouseDay(open, selectedDayIndex = 3, now = now).rows.single()
        assertTrue(row.vacant)
        assertNull(row.workerName)
        assertNull(row.workerPhone)
        assertEquals("16:00 – 18:00", row.timeLabel)
    }

    @Test fun concurrent_vacant_seats_coalesce_into_separate_full_open_rows() {
        // Harnwell-style under-coverage: two empty desks over the SAME 08:00–10:00 window
        // arrive as two sets of 4 vacant 30-min seats (all sharing the one "open" key). They
        // must become TWO clean 08:00–10:00 "Open" rows, NOT eight half-hour fragments — the
        // multi-track coalescing contract.
        val deskA = seats("va", "2026-01-15T08:00:00-05:00", 4, vacant = true)
        val deskB = seats("vb", "2026-01-15T08:00:00-05:00", 4, vacant = true)
        val opens = buildHouseDay(deskA + deskB, selectedDayIndex = 3, now = now).rows.filter { it.vacant }
        assertEquals(2, opens.size) // two Open rows, not fragments
        assertTrue(opens.all { it.timeLabel == "08:00 – 10:00" })
    }

    @Test fun a_vacant_seat_concurrent_with_a_worker_stays_its_own_open_row() {
        val worked = seats("a", "2026-01-15T14:00:00-05:00", 4, name = "Maya", userId = "u-maya")
        val empty = seats("v", "2026-01-15T14:00:00-05:00", 4, vacant = true)
        val day = buildHouseDay(worked + empty, selectedDayIndex = 3, now = now)
        val open = day.rows.single { it.vacant }
        assertEquals("14:00 – 16:00", open.timeLabel)
    }

    @Test fun pending_float_seats_are_flagged_and_do_not_merge_with_settled_ones() {
        val settled = seats("a", "2026-01-15T14:00:00-05:00", 2)
        val pending = seats("p", "2026-01-15T15:00:00-05:00", 2, pending = true)
        val day = buildHouseDay(settled + pending, selectedDayIndex = 3, now = now)
        val p = day.rows.single { it.id == "p-0" }
        assertTrue(p.pending)
        assertTrue(p.floatIn)
    }

    @Test fun seats_on_other_days_are_excluded_and_strip_dots_mark_seat_days() {
        val thu = seats("a", "2026-01-15T14:00:00-05:00", 2) // Thu = 3
        val sat = seats("s", "2026-01-17T10:00:00-05:00", 2) // Sat = 5
        val nextThu = seats("n", "2026-01-22T09:00:00-05:00", 2) // a different week
        assertTrue(buildHouseDay(thu + sat + nextThu, selectedDayIndex = 0, now = now).isEmpty) // Mon
        assertEquals(1, buildHouseDay(thu + sat + nextThu, selectedDayIndex = 3, now = now).rows.size)
        assertEquals(1, buildHouseDay(thu + sat + nextThu, selectedDayIndex = 5, now = now).rows.size)
        assertEquals(setOf(3, 5), houseDaysWithSeats(thu + sat + nextThu, now)) // nextThu excluded from this week
    }

    // ----- view model: day selection, week navigation, clamping, per-week seats -----

    @Test fun view_model_defaults_to_today_with_initial_seats() {
        val vm =
            HouseScheduleViewModel(
                HouseScheduleSnapshot("Harnwell", "+1 215 555 0142", seats("a", "2026-01-15T14:00:00-05:00", 2)),
                now,
                me,
            )
        val s = vm.uiState.value
        assertEquals("Harnwell", s.houseName)
        assertEquals("+1 215 555 0142", s.deskPhone)
        assertEquals(0, s.weekOffset)
        assertEquals("This week", s.weekRelative)
        assertEquals("Jan 12 – Jan 18", s.weekRange)
        assertEquals(3, s.selectedDayIndex) // Thu (today)
        assertFalse(s.loadingWeek) // seeded for week 0
        assertEquals(1, s.day.rows.size)
        assertTrue(s.week.days[3].hasShifts) // strip dot on Thu
    }

    @Test fun select_day_moves_the_roster() {
        val vm =
            HouseScheduleViewModel(
                HouseScheduleSnapshot(
                    "Harnwell",
                    null,
                    seats("a", "2026-01-15T14:00:00-05:00", 2) + seats("s", "2026-01-17T10:00:00-05:00", 2),
                ),
                now,
                me,
            )
        assertEquals(setOf(3, 5), vm.uiState.value.daysWithSeats)
        vm.selectDay(5)
        assertEquals("s-0", vm.uiState.value.day.rows.single().id)
    }

    @Test fun week_navigation_is_clamped_to_last_week_through_four_weeks_out() {
        val vm = HouseScheduleViewModel(HouseScheduleSnapshot("Harnwell", null, emptyList()), now, me)
        assertTrue(vm.uiState.value.canPreviousWeek) // week 0 → last week reachable
        assertTrue(vm.uiState.value.canNextWeek)
        // Forward to the cap.
        repeat(6) { vm.nextWeek() }
        assertEquals(4, vm.uiState.value.weekOffset)
        assertFalse(vm.uiState.value.canNextWeek)
        assertTrue(vm.uiState.value.canPreviousWeek)
        assertEquals("In 4 weeks", vm.uiState.value.weekRelative)
        // Back to the floor.
        repeat(10) { vm.previousWeek() }
        assertEquals(-1, vm.uiState.value.weekOffset)
        assertFalse(vm.uiState.value.canPreviousWeek)
        assertTrue(vm.uiState.value.canNextWeek)
        assertEquals("Last week", vm.uiState.value.weekRelative)
    }

    @Test fun navigating_clears_seats_until_the_host_supplies_the_new_week() {
        val vm = HouseScheduleViewModel(HouseScheduleSnapshot("Harnwell", null, emptyList()), now, me)
        vm.nextWeek()
        assertTrue(vm.uiState.value.loadingWeek) // no seats for week 1 yet
        assertTrue(vm.uiState.value.day.isEmpty)
        vm.setWeekSeats(1, seats("a", "2026-01-22T14:00:00-05:00", 2)) // next-week Thu
        assertFalse(vm.uiState.value.loadingWeek)
        assertEquals(setOf(3), vm.uiState.value.daysWithSeats) // dot on next-week Thu
        vm.selectDay(3)
        assertEquals(1, vm.uiState.value.day.rows.size)
    }

    @Test fun a_stale_week_fetch_is_ignored() {
        val vm = HouseScheduleViewModel(HouseScheduleSnapshot("Harnwell", null, emptyList()), now, me)
        vm.nextWeek() // now on week 1
        vm.setWeekSeats(0, seats("a", "2026-01-15T14:00:00-05:00", 2)) // a late week-0 fetch
        assertTrue(vm.uiState.value.loadingWeek) // ignored — still waiting on week 1
    }

    // ----- cross-house view: default selection, switcher -----

    @Test fun snapshot_house_id_drives_the_default_selection_and_home_marker() {
        val vm =
            HouseScheduleViewModel(
                HouseScheduleSnapshot("Harnwell", "+1 215 555 0142", emptyList(), houseId = "harnwell"),
                now,
                me,
            )
        val s = vm.uiState.value
        assertEquals("harnwell", s.selectedHouseId)
        assertEquals("harnwell", s.homeHouseId)
        assertTrue(s.isHomeHouse)
        assertFalse(s.canSwitchHouse) // no pickable houses loaded yet
        assertEquals(3, s.selectedDayIndex) // Thu — today is in the shown (current) week
    }

    @Test fun loading_houses_enables_the_switcher_and_resolves_name_and_phone() {
        val vm = HouseScheduleViewModel(HouseScheduleSnapshot("Harnwell", null, emptyList(), houseId = "harnwell"), now, me)
        vm.setHouses(listOf(HouseOption("harnwell", "Harnwell", "+1A"), HouseOption("quad", "Quad", "+1Q")))
        val s = vm.uiState.value
        assertTrue(s.canSwitchHouse)
        assertEquals("Harnwell", s.houseName)
        assertEquals("+1A", s.deskPhone) // resolved from the picker options (carries the desk phone)
    }

    @Test fun selecting_another_house_recenters_to_this_week_and_loads_its_seats() {
        val vm = HouseScheduleViewModel(HouseScheduleSnapshot("Harnwell", "+1A", emptyList(), houseId = "harnwell"), now, me)
        vm.setHouses(listOf(HouseOption("harnwell", "Harnwell", "+1A"), HouseOption("quad", "Quad", "+1Q")))
        vm.nextWeek() // navigate off the current week first
        vm.selectHouse("quad")
        val s1 = vm.uiState.value
        assertEquals("quad", s1.selectedHouseId)
        assertEquals(0, s1.weekOffset) // re-centred on this week so "today" is in view
        assertEquals(3, s1.selectedDayIndex) // back to today
        assertFalse(s1.isHomeHouse)
        assertEquals("Quad", s1.houseName)
        assertEquals("+1Q", s1.deskPhone)
        assertTrue(s1.loadingWeek) // the new house's seats aren't fetched yet
        // The host fetches quad's week-0 seats.
        vm.setWeekSeats("quad", 0, seats("a", "2026-01-15T14:00:00-05:00", 2))
        val s2 = vm.uiState.value
        assertFalse(s2.loadingWeek)
        assertEquals(1, s2.day.rows.size)
    }

    @Test fun a_fetch_for_a_different_house_is_ignored() {
        val vm = HouseScheduleViewModel(HouseScheduleSnapshot("Harnwell", null, emptyList(), houseId = "harnwell"), now, me)
        vm.setHouses(listOf(HouseOption("harnwell", "Harnwell", null), HouseOption("quad", "Quad", null)))
        vm.selectHouse("quad")
        // A late fetch for the home house (the worker already switched to quad) must not paint.
        vm.setWeekSeats("harnwell", 0, seats("a", "2026-01-15T14:00:00-05:00", 2))
        assertTrue(vm.uiState.value.loadingWeek)
    }
}
