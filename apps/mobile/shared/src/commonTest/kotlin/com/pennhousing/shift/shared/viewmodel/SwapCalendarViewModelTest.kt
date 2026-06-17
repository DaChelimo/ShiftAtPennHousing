package com.pennhousing.shift.shared.viewmodel

import com.pennhousing.shift.shared.house.HouseSeat
import com.pennhousing.shift.shared.model.AssignmentKind
import com.pennhousing.shift.shared.model.House
import com.pennhousing.shift.shared.model.MyShift
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Instant

/**
 * Calendar swap ViewModel (CALENDAR_REDESIGN.md §3) — week-paged give/take selection.
 * Pins persist across week navigation (cross-week swaps); the host feeds per-week
 * housemate seats. These pin the CLIENT state-machine contract; the server stays
 * authoritative for §8 eligibility.
 */
class SwapCalendarViewModelTest {
    private fun at(iso: String): Instant = Instant.parse(iso)

    private val quad = House("quad", "Quad")
    private val now = at("2026-01-15T12:00:00-05:00") // Thursday (day index 3)

    private fun myShift(
        id: String,
        kind: AssignmentKind,
        startIso: String,
        endIso: String,
        blocks: Int,
    ) = MyShift(
        id = id,
        house = quad,
        start = at(startIso),
        end = at(endIso),
        kind = kind,
        blockIds = (0 until blocks).map { "$id-$it" },
    )

    private fun seats(
        prefix: String,
        startIso: String,
        n: Int,
        userId: String,
    ): List<HouseSeat> {
        val start = at(startIso)
        return (0 until n).map { i ->
            HouseSeat(
                id = "$prefix-$i",
                start = start + (i * 30).minutes,
                end = start + ((i + 1) * 30).minutes,
                vacant = false,
                pending = false,
                floatIn = false,
                userId = userId,
                workerName = "W $userId",
                workerPhone = null,
            )
        }
    }

    private val schedThu = myShift("sch", AssignmentKind.SCHEDULED, "2026-01-15T14:00:00-05:00", "2026-01-15T16:00:00-05:00", 4)
    private val floatThu = myShift("flo", AssignmentKind.FLOAT_OUT, "2026-01-15T18:00:00-05:00", "2026-01-15T19:00:00-05:00", 2)

    private val thuSeats = seats("ben", "2026-01-15T12:00:00-05:00", 4, "ben") // this-week Thursday housemate
    private val nextThuSeats = seats("cara", "2026-01-22T14:00:00-05:00", 4, "cara") // NEXT-week Thursday housemate

    @Test
    fun prepinned_give_opens_on_its_week_and_day() {
        val vm = SwapCalendarViewModel(listOf(schedThu), meUserId = "me", now = now, initialGiveShiftId = "sch")
        val s = vm.uiState.value
        assertEquals(0, s.weekOffset)
        assertEquals(3, s.selectedDayIndex) // Thursday
        assertEquals(listOf("sch-0", "sch-1", "sch-2", "sch-3"), s.give?.seatIds)
        assertTrue(s.loadingWeek) // host hasn't fed seats yet
        assertFalse(s.canPropose)
    }

    @Test
    fun feeding_seats_then_picking_take_enables_a_shift_swap_proposal() {
        val vm = SwapCalendarViewModel(listOf(schedThu), meUserId = "me", now = now, initialGiveShiftId = "sch")
        vm.setWeekSeats(0, thuSeats)
        val s = vm.uiState.value
        assertFalse(s.loadingWeek)
        assertEquals(1, s.day.others.size)
        vm.pickTake(s.day.others[0])
        val after = vm.uiState.value
        assertTrue(after.canPropose)
        val proposals = vm.proposals()
        assertEquals(1, proposals.size)
        assertEquals("shift_swap", proposals[0].swapType)
        assertEquals(listOf("sch-0", "sch-1", "sch-2", "sch-3"), proposals[0].initiatorAssignmentIds)
        assertEquals(4, proposals[0].counterpartyAssignmentIds?.size)
    }

    @Test
    fun give_this_week_take_next_week_is_a_cross_week_swap() {
        val vm = SwapCalendarViewModel(listOf(schedThu), meUserId = "me", now = now, initialGiveShiftId = "sch")
        vm.nextWeek() // → week offset 1; give stays pinned from week 0
        assertEquals(1, vm.uiState.value.weekOffset)
        assertTrue(vm.uiState.value.loadingWeek)
        vm.setWeekSeats(1, nextThuSeats)
        val s = vm.uiState.value
        assertEquals(1, s.day.others.size) // next-week housemate
        vm.pickTake(s.day.others[0])
        val proposals = vm.proposals()
        assertEquals(1, proposals.size)
        // give from week 0 (sch), take from week 1 (cara) — different ISO weeks.
        assertEquals(listOf("sch-0", "sch-1", "sch-2", "sch-3"), proposals[0].initiatorAssignmentIds)
        assertEquals(listOf("cara-0", "cara-1", "cara-2", "cara-3"), proposals[0].counterpartyAssignmentIds)
    }

    @Test
    fun permanent_toggle_only_after_take_and_drives_permanent_swap() {
        val vm = SwapCalendarViewModel(listOf(schedThu), meUserId = "me", now = now, initialGiveShiftId = "sch")
        vm.setWeekSeats(0, thuSeats)
        assertFalse(vm.uiState.value.permanentToggleVisible) // no take yet
        vm.pickTake(vm.uiState.value.day.others[0])
        assertTrue(vm.uiState.value.permanentToggleVisible)
        vm.togglePermanent()
        assertTrue(vm.uiState.value.permanent)
        assertEquals("permanent_swap", vm.proposals()[0].swapType)
    }

    @Test
    fun float_give_produces_a_float_swap() {
        val vm = SwapCalendarViewModel(listOf(floatThu), meUserId = "me", now = now, initialGiveShiftId = "flo")
        vm.setWeekSeats(0, thuSeats)
        vm.pickTake(vm.uiState.value.day.others[0])
        assertEquals("float_swap", vm.proposals()[0].swapType)
        assertFalse(vm.uiState.value.permanentToggleVisible) // a float can't be a permanent swap
    }

    @Test
    fun handoff_mode_produces_a_give_only_handoff_proposal() {
        val vm = SwapCalendarViewModel(listOf(schedThu), meUserId = "me", now = now, initialGiveShiftId = "sch")
        vm.setWeekSeats(0, thuSeats)
        vm.pickTake(vm.uiState.value.day.others[0]) // picks the recipient
        vm.setHandoff(true)
        assertTrue(vm.uiState.value.handoff)
        assertFalse(vm.uiState.value.permanentToggleVisible) // permanent hidden in hand-off
        val p = vm.proposals()
        assertEquals(1, p.size)
        assertEquals("handoff", p[0].swapType)
        assertEquals("ben", p[0].counterpartyUserId) // the recipient
        assertEquals(listOf("sch-0", "sch-1", "sch-2", "sch-3"), p[0].initiatorAssignmentIds) // I give my whole shift
        assertNull(p[0].counterpartyAssignmentIds) // they give nothing back
    }

    @Test
    fun handoff_and_permanent_are_mutually_exclusive() {
        val vm = SwapCalendarViewModel(listOf(schedThu), meUserId = "me", now = now, initialGiveShiftId = "sch")
        vm.setWeekSeats(0, thuSeats)
        vm.pickTake(vm.uiState.value.day.others[0])
        vm.togglePermanent()
        assertTrue(vm.uiState.value.permanent)
        vm.setHandoff(true)
        assertTrue(vm.uiState.value.handoff)
        assertFalse(vm.uiState.value.permanent) // permanent cleared
    }

    @Test
    fun stale_seat_feed_for_another_week_is_ignored() {
        val vm = SwapCalendarViewModel(listOf(schedThu), meUserId = "me", now = now, initialGiveShiftId = "sch")
        vm.setWeekSeats(5, thuSeats) // arrives for a week the worker isn't on
        assertTrue(vm.uiState.value.loadingWeek)
        assertTrue(vm.uiState.value.day.others.isEmpty())
    }

    @Test
    fun tapping_the_pinned_take_again_unpins_it() {
        val vm = SwapCalendarViewModel(listOf(schedThu), meUserId = "me", now = now, initialGiveShiftId = "sch")
        vm.setWeekSeats(0, thuSeats)
        val card = vm.uiState.value.day.others[0]
        vm.pickTake(card)
        assertTrue(vm.uiState.value.canPropose)
        vm.pickTake(card)
        assertNull(vm.uiState.value.take)
        assertFalse(vm.uiState.value.canPropose)
    }
}
