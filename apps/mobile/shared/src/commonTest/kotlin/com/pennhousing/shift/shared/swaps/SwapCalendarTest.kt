package com.pennhousing.shift.shared.swaps

import com.pennhousing.shift.shared.house.HouseSeat
import com.pennhousing.shift.shared.model.AssignmentKind
import com.pennhousing.shift.shared.model.House
import com.pennhousing.shift.shared.model.MyShift
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Instant

/**
 * Calendar swap picker (CALENDAR_REDESIGN.md §3b) — the per-day give/take grid the
 * week-paged swap calendar renders. Placement is by the shift's own start within the
 * navigated week, so cross-week shifts never collide on a weekday; the server stays
 * authoritative for eligibility. These pin the CLIENT day-grid contract.
 */
class SwapCalendarTest {
    private fun at(iso: String): Instant = Instant.parse(iso)

    private val quad = House("quad", "Quad")

    // Anchor weeks: Jan 15 2026 is a Thursday (day index 3); Jan 12 is its Monday.
    private val thisWeek = at("2026-01-15T12:00:00-05:00")
    private val nextWeek = at("2026-01-22T12:00:00-05:00")

    private fun myShift(
        id: String,
        kind: AssignmentKind,
        startIso: String,
        endIso: String,
        blocks: Int,
        dropped: Boolean = false,
    ) = MyShift(
        id = id,
        house = quad,
        start = at(startIso),
        end = at(endIso),
        kind = kind,
        droppedStillOpen = dropped,
        blockIds = (0 until blocks).map { "$id-$it" },
    )

    private fun seats(
        prefix: String,
        startIso: String,
        n: Int,
        userId: String?,
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
                userId = userId,
                workerName = userId?.let { "W $it" },
                workerPhone = null,
            )
        }
    }

    private val schedThu = myShift("sch", AssignmentKind.SCHEDULED, "2026-01-15T14:00:00-05:00", "2026-01-15T16:00:00-05:00", 4)
    private val floatFri = myShift("flo", AssignmentKind.FLOAT_OUT, "2026-01-16T18:00:00-05:00", "2026-01-16T19:00:00-05:00", 2)
    private val droppedThu =
        myShift("drp", AssignmentKind.SCHEDULED, "2026-01-15T20:00:00-05:00", "2026-01-15T21:00:00-05:00", 2, dropped = true)
    private val schedNextThu =
        myShift("nxt", AssignmentKind.SCHEDULED, "2026-01-22T14:00:00-05:00", "2026-01-22T16:00:00-05:00", 4)

    private val myShifts = listOf(schedThu, floatFri, droppedThu, schedNextThu)

    // Quad Thursday: three housemates on desk, plus a vacant seat, a pending float, and ME (all excluded from "take").
    private val thuSeats =
        seats("ben", "2026-01-15T12:00:00-05:00", 4, "ben") +
            seats("cara", "2026-01-15T14:00:00-05:00", 4, "cara") +
            seats("dan", "2026-01-15T16:00:00-05:00", 4, "dan") +
            seats("vac", "2026-01-15T18:00:00-05:00", 1, null, vacant = true) +
            seats("pf", "2026-01-15T18:30:00-05:00", 1, "flt", pending = true) +
            seats("meseat", "2026-01-15T19:00:00-05:00", 2, "me")

    @Test
    fun thursday_splits_my_shift_from_three_quad_housemates() {
        val day = buildSwapDay(myShifts, thuSeats, meUserId = "me", selectedDayIndex = 3, anchor = thisWeek)
        // give: only my Thursday SCHEDULED shift (dropped + Friday + next-week excluded).
        assertEquals(1, day.mine.size)
        assertEquals("sch", day.mine[0].seatIds[0].substringBeforeLast("-"))
        assertTrue(day.mine[0].isMine)
        assertEquals("You", day.mine[0].workerName)
        assertTrue(day.mine[0].permanentEligible)
        assertFalse(day.mine[0].isFloat)
        assertEquals(4, day.mine[0].seatIds.size)
        // take: ben/cara/dan, time-sorted; vacant, pending-float and me excluded.
        assertEquals(listOf("W ben", "W cara", "W dan"), day.others.map { it.workerName })
        assertTrue(day.others.all { !it.isMine })
        assertEquals(4, day.others[0].seatIds.size) // coalesced run
    }

    @Test
    fun friday_shows_my_float_as_a_float_give_and_no_takes() {
        val day = buildSwapDay(myShifts, thuSeats, meUserId = "me", selectedDayIndex = 4, anchor = thisWeek)
        assertEquals(1, day.mine.size)
        assertTrue(day.mine[0].isFloat)
        assertFalse(day.mine[0].permanentEligible)
        assertTrue(day.others.isEmpty()) // the seats are all Thursday
    }

    @Test
    fun next_week_anchor_surfaces_next_weeks_shift_not_this_weeks() {
        val day = buildSwapDay(myShifts, emptyList(), meUserId = "me", selectedDayIndex = 3, anchor = nextWeek)
        assertEquals(1, day.mine.size)
        assertEquals("nxt", day.mine[0].seatIds[0].substringBeforeLast("-"))
    }

    @Test
    fun break_profile_disables_permanent_on_a_scheduled_give() {
        val day = buildSwapDay(myShifts, thuSeats, meUserId = "me", selectedDayIndex = 3, anchor = thisWeek, breakProfile = true)
        assertFalse(day.mine[0].permanentEligible)
    }

    @Test
    fun days_with_shifts_marks_thursday_and_friday_only() {
        // Thursday (my sched + 3 housemates) and Friday (my float); dropped + next-week excluded.
        assertEquals(setOf(3, 4), swapWeekDaysWithShifts(myShifts, thuSeats, meUserId = "me", anchor = thisWeek))
    }
}
