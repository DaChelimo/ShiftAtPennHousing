package com.pennhousing.shift.shared.house

import com.pennhousing.shift.shared.viewmodel.HouseScheduleViewModel
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Instant

/**
 * House schedule (§11.4, T3b) — the Excel-style WEEK GRID: per-block seats placed on
 * the Mon–Sun strip, coalesced into positioned blocks, lane-assigned for concurrent
 * desks, with the "You" treatment and the contact fields the full-directory ruling
 * unlocked. Fixtures pin EST -05:00; now is Thu 2026-01-15 14:00 ET (week Mon 01-12 ..
 * Sun 01-18; Thu = index 3).
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

    // ----- block placement + coalescing -----

    @Test fun contiguous_same_worker_seats_coalesce_into_one_block_with_contact() {
        // 4h Thu run (14:00–18:00) arrives as 8 per-30-min seats → one positioned block.
        val grid = buildHouseGridWeek(seats("a", "2026-01-15T14:00:00-05:00", 8), now, me)
        val block = grid.days[3].blocks.single()
        assertEquals("a-0", block.id)
        assertEquals(14 * 60, block.startMin)
        assertEquals(18 * 60, block.endMin)
        assertEquals("14:00 – 18:00", block.timeLabel)
        assertEquals("Worker a", block.workerLabel)
        assertEquals("+1a", block.workerPhone) // §11.4 contact (full-directory ruling)
        assertTrue(block.active) // 14:00 ≤ now < 18:00
        assertFalse(block.mine)
    }

    @Test fun the_signed_in_workers_block_is_flagged_mine_and_labelled_you() {
        val grid = buildHouseGridWeek(seats("a", "2026-01-15T09:00:00-05:00", 4, userId = me), now, me)
        val block = grid.days[3].blocks.single()
        assertTrue(block.mine)
        assertEquals("You", block.workerLabel)
    }

    @Test fun end_of_day_block_renders_as_24_00() {
        val grid = buildHouseGridWeek(seats("a", "2026-01-15T20:00:00-05:00", 8), now, me) // 20:00–24:00
        val block = grid.days[3].blocks.single()
        assertEquals(20 * 60, block.startMin)
        assertEquals(24 * 60, block.endMin)
        assertEquals("20:00 – 24:00", block.timeLabel)
    }

    @Test fun concurrent_workers_get_separate_lanes() {
        // Two desks covering the same Thu span → two lanes; week-wide laneCount = 2.
        val a = seats("a", "2026-01-15T14:00:00-05:00", 4, name = "Maya", userId = "u-maya")
        val b = seats("b", "2026-01-15T14:00:00-05:00", 4, name = "Jordan", userId = "u-jordan")
        val grid = buildHouseGridWeek(a + b, now, me)
        val day = grid.days[3]
        assertEquals(2, day.laneCount)
        assertEquals(setOf(0, 1), day.blocks.map { it.lane }.toSet())
        assertEquals(2, grid.laneCount)
    }

    @Test fun sequential_blocks_on_one_desk_share_lane_zero() {
        val morning = seats("a", "2026-01-15T08:00:00-05:00", 8) // 08:00–12:00
        val afternoon = seats("b", "2026-01-15T12:00:00-05:00", 8, name = "Two", userId = "u-two") // 12:00–16:00
        val grid = buildHouseGridWeek(morning + afternoon, now, me)
        assertEquals(1, grid.days[3].laneCount)
        assertTrue(grid.days[3].blocks.all { it.lane == 0 })
    }

    @Test fun vacant_runs_are_open_and_carry_no_contact() {
        val open = seats("v", "2026-01-15T16:00:00-05:00", 4, vacant = true)
        val grid = buildHouseGridWeek(open, now, me)
        val block = grid.days[3].blocks.single()
        assertTrue(block.vacant)
        assertEquals("Open", block.workerLabel)
        assertEquals(null, block.workerName)
        assertEquals(null, block.workerPhone)
    }

    @Test fun concurrent_vacant_seats_coalesce_into_separate_full_open_blocks() {
        // Harnwell-style under-coverage: two empty desks over the SAME 08:00–10:00 window
        // arrive as two sets of 4 vacant 30-min seats (all sharing the one "open" key). They
        // must become TWO clean 08:00–10:00 "Open" blocks (one per lane), NOT eight half-hour
        // fragments — the "aggregate every contiguous empty 30-min chunk" contract.
        val deskA = seats("va", "2026-01-15T08:00:00-05:00", 4, vacant = true)
        val deskB = seats("vb", "2026-01-15T08:00:00-05:00", 4, vacant = true)
        val grid = buildHouseGridWeek(deskA + deskB, now, me)
        val opens = grid.days[3].blocks.filter { it.vacant }
        assertEquals(2, opens.size) // two Open blocks, not fragments
        assertTrue(opens.all { it.startMin == 8 * 60 && it.endMin == 10 * 60 })
        assertTrue(opens.all { it.workerLabel == "Open" })
        assertEquals(setOf(0, 1), opens.map { it.lane }.toSet()) // side-by-side lanes
        assertEquals(2, grid.days[3].laneCount)
    }

    @Test fun a_vacant_seat_concurrent_with_a_worker_stays_its_own_open_block() {
        // One desk worked, one desk empty, same 14:00–16:00 span → a filled block + a full
        // 14:00–16:00 Open block side by side (the open half mustn't fragment or merge).
        val worked = seats("a", "2026-01-15T14:00:00-05:00", 4, name = "Maya", userId = "u-maya")
        val empty = seats("v", "2026-01-15T14:00:00-05:00", 4, vacant = true)
        val grid = buildHouseGridWeek(worked + empty, now, me)
        val open = grid.days[3].blocks.single { it.vacant }
        assertEquals(14 * 60, open.startMin)
        assertEquals(16 * 60, open.endMin)
        assertEquals("Open", open.workerLabel)
    }

    @Test fun pending_float_seats_are_flagged_and_do_not_merge_with_settled_ones() {
        val settled = seats("a", "2026-01-15T14:00:00-05:00", 2)
        val pending = seats("p", "2026-01-15T15:00:00-05:00", 2, pending = true)
        val grid = buildHouseGridWeek(settled + pending, now, me)
        val p = grid.days[3].blocks.single { it.id == "p-0" }
        assertTrue(p.pending)
        assertTrue(p.floatIn)
    }

    @Test fun seats_are_placed_on_the_right_day_and_other_weeks_excluded() {
        val thu = seats("a", "2026-01-15T14:00:00-05:00", 2) // Thu = 3
        val sat = seats("s", "2026-01-17T10:00:00-05:00", 2) // Sat = 5
        val nextThu = seats("n", "2026-01-22T09:00:00-05:00", 2) // a different week
        val grid = buildHouseGridWeek(thu + sat + nextThu, now, me)
        assertTrue(grid.days[0].isEmpty) // Mon
        assertEquals(1, grid.days[3].blocks.size)
        assertEquals(1, grid.days[5].blocks.size)
        assertTrue(grid.days[3].isToday)
        assertFalse(grid.days[5].isToday)
    }

    @Test fun grid_bounds_default_to_8_to_24_and_expand_for_early_or_late_data() {
        assertEquals(8, buildHouseGridWeek(emptyList(), now, me).startHour)
        assertEquals(24, buildHouseGridWeek(emptyList(), now, me).endHour)
        // A 06:30 start floors to an even 06:00 bound.
        val early = buildHouseGridWeek(seats("e", "2026-01-15T06:30:00-05:00", 2), now, me)
        assertEquals(6, early.startHour)
        assertEquals(24, early.endHour)
    }

    // ----- view model: week navigation, clamping, per-week seats -----

    @Test fun view_model_defaults_to_this_week_with_initial_seats() {
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
        assertFalse(s.loadingWeek) // seeded for week 0
        assertEquals(1, s.grid.days[3].blocks.size)
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
        assertTrue(vm.uiState.value.grid.isEmpty)
        vm.setWeekSeats(1, seats("a", "2026-01-22T14:00:00-05:00", 2)) // next-week Thu
        assertFalse(vm.uiState.value.loadingWeek)
        assertEquals(1, vm.uiState.value.grid.days[3].blocks.size)
    }

    @Test fun a_stale_week_fetch_is_ignored() {
        val vm = HouseScheduleViewModel(HouseScheduleSnapshot("Harnwell", null, emptyList()), now, me)
        vm.nextWeek() // now on week 1
        vm.setWeekSeats(0, seats("a", "2026-01-15T14:00:00-05:00", 2)) // a late week-0 fetch
        assertTrue(vm.uiState.value.loadingWeek) // ignored — still waiting on week 1
    }
}
