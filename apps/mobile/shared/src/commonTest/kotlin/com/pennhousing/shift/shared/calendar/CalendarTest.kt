package com.pennhousing.shift.shared.calendar

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
 * Personal Calendar presentation (shared) — the Mon–Sun strip + the selected-day
 * agenda + the live "now" line, all over the current-week `MyShift` snapshot.
 * Fixtures pin explicit America/New_York offsets (EST -05:00). Anchor: now is
 * Thu 2026-01-15 14:00 ET → that week is Mon 2026-01-12 .. Sun 2026-01-18; Thu = index 3.
 */
class CalendarTest {
    private fun at(iso: String): Instant = Instant.parse(iso)

    private val harnwell = House("harnwell", "Harnwell")
    private val quad = House("quad", "Quad")
    private val now = at("2026-01-15T14:00:00-05:00") // Thu 14:00

    private fun shift(
        start: String,
        end: String,
        house: House = harnwell,
        kind: AssignmentKind = AssignmentKind.SCHEDULED,
    ) = MyShift(id = "$start", house = house, start = at(start), end = at(end), kind = kind)

    private val morning = shift("2026-01-15T09:00:00-05:00", "2026-01-15T13:00:00-05:00") // Thu, 4h, before now
    private val evening = shift("2026-01-15T16:00:00-05:00", "2026-01-15T18:00:00-05:00") // Thu, 2h, after now
    private val saturday = shift("2026-01-17T10:00:00-05:00", "2026-01-17T12:00:00-05:00", quad, AssignmentKind.TEMP_PICKUP)
    private val all = listOf(morning, evening, saturday)

    // ----- week strip -----

    @Test fun week_strip_has_seven_cells_marks_shift_days_and_today() {
        val w = buildCalendarWeek(all, now)
        assertEquals(7, w.days.size)
        assertEquals(3, w.todayIndex) // Thu
        assertEquals(listOf("M", "T", "W", "T", "F", "S", "S"), w.days.map { it.dayLetter })
        assertEquals(listOf("12", "13", "14", "15", "16", "17", "18"), w.days.map { it.dateLabel })
        assertTrue(w.days[3].hasShifts) // Thu (morning + evening)
        assertTrue(w.days[5].hasShifts) // Sat (pickup)
        assertFalse(w.days[0].hasShifts) // Mon empty
        assertTrue(w.days[3].isToday)
        assertEquals("Jan 12 – Jan 18", w.rangeLabel)
    }

    @Test fun shift_in_another_week_is_not_placed() {
        // Next Thursday (2026-01-22) shares the weekday but is a different week → excluded.
        val nextThu = shift("2026-01-22T09:00:00-05:00", "2026-01-22T11:00:00-05:00")
        val w = buildCalendarWeek(listOf(nextThu), now)
        assertFalse(w.days.any { it.hasShifts })
    }

    // ----- agenda: today (with now-line) -----

    @Test fun today_agenda_inserts_now_line_before_the_next_shift() {
        val a = buildCalendarAgenda(all, selectedDayIndex = 3, now = now)
        assertEquals("Today", a.header.title)
        assertEquals("Jan 15", a.header.dateLabel)
        assertEquals("2 shifts · 6h", a.header.summary)
        // morning (09–13, past), NOW (14:00), evening (16–18, upcoming).
        assertEquals(3, a.items.size)
        assertEquals("09:00 – 13:00", a.items[0].shift?.timeLabel)
        assertEquals("NOW · 14:00", a.items[1].nowLabel)
        assertNull(a.items[1].shift)
        assertEquals("16:00 – 18:00", a.items[2].shift?.timeLabel)
        assertFalse(a.isEmpty)
    }

    @Test fun active_shift_is_flagged_in_progress() {
        val inProgress = shift("2026-01-15T13:30:00-05:00", "2026-01-15T15:30:00-05:00") // spans now 14:00
        val a = buildCalendarAgenda(listOf(inProgress), selectedDayIndex = 3, now = now)
        val shiftItem = a.items.first { it.shift != null }
        assertTrue(shiftItem.active)
    }

    @Test fun now_line_appended_when_all_shifts_are_past() {
        val a = buildCalendarAgenda(listOf(morning), selectedDayIndex = 3, now = now)
        assertEquals("09:00 – 13:00", a.items[0].shift?.timeLabel)
        assertEquals("NOW · 14:00", a.items[1].nowLabel) // appended at the end
    }

    // ----- agenda: other days / empty -----

    @Test fun other_day_agenda_has_no_now_line() {
        val a = buildCalendarAgenda(all, selectedDayIndex = 5, now = now) // Sat
        assertEquals("Sat", a.header.title)
        assertEquals("Jan 17", a.header.dateLabel)
        assertEquals("1 shift · 2h", a.header.summary)
        assertEquals(1, a.items.size)
        assertNull(a.items[0].nowLabel)
    }

    @Test fun empty_day_has_no_summary_and_is_empty() {
        val a = buildCalendarAgenda(all, selectedDayIndex = 0, now = now) // Mon
        assertEquals("Mon", a.header.title)
        assertNull(a.header.summary)
        assertTrue(a.isEmpty)
    }

    // ----- block coalescing (parity CO) -----

    @Test fun agenda_coalesces_per_block_rows_into_one_card() {
        // A live 4h Saturday shift arrives as 8 per-30-min rows (the live read model);
        // the agenda shows ONE card with the merged span and counts it as one shift.
        val start = at("2026-01-17T10:00:00-05:00")
        val blocks =
            (0 until 8).map { i ->
                MyShift(
                    id = "blk-$i",
                    house = harnwell,
                    start = start + (i * 30).minutes,
                    end = start + ((i + 1) * 30).minutes,
                    kind = AssignmentKind.SCHEDULED,
                )
            }
        val a = buildCalendarAgenda(blocks, selectedDayIndex = 5, now = now) // Sat
        assertEquals("1 shift · 4h", a.header.summary)
        assertEquals(1, a.items.size)
        assertEquals("10:00 – 14:00", a.items[0].shift?.timeLabel)
    }

    // ----- closed-house days (§3.4/§11.3, T2-12c) -----

    @Test fun closed_day_indexes_mark_strip_cells_and_the_selected_header() {
        // Sat (index 5) closed: its strip cell flags closed; selecting it flags the
        // header; other days are untouched.
        val w = buildCalendarWeek(all, now, closedDayIndexes = setOf(5))
        assertTrue(w.days[5].closed)
        assertFalse(w.days[3].closed)
        val closedAgenda = buildCalendarAgenda(all, selectedDayIndex = 5, now = now, closedDayIndexes = setOf(5))
        assertTrue(closedAgenda.header.closed)
        val openAgenda = buildCalendarAgenda(all, selectedDayIndex = 3, now = now, closedDayIndexes = setOf(5))
        assertFalse(openAgenda.header.closed)
    }

    @Test fun closed_day_still_renders_cross_house_shifts() {
        // §3.4: a home-house closure does not erase the worker's cross-house pickups —
        // the Saturday Quad pickup renders even when Saturday is flagged closed.
        val a = buildCalendarAgenda(all, selectedDayIndex = 5, now = now, closedDayIndexes = setOf(5))
        assertTrue(a.header.closed)
        assertFalse(a.isEmpty)
        assertEquals(1, a.items.size)
    }

    @Test fun calendar_week_dates_are_the_iso_monday_to_sunday_of_nows_week() {
        // The strings handed to the `house_closure(p_house_id, p_on_date)` RPC.
        val dates = calendarWeekDates(now)
        assertEquals(7, dates.size)
        assertEquals("2026-01-12", dates.first()) // Mon
        assertEquals("2026-01-15", dates[3]) // Thu (today)
        assertEquals("2026-01-18", dates.last()) // Sun
    }

    // ----- week navigation (T3b-4) -----

    @Test fun next_week_anchor_renders_that_week_with_no_today_cell() {
        val anchor = shiftWeekAnchor(now, 1)
        val w = buildCalendarWeek(all, now, anchor = anchor)
        assertEquals("Jan 19 – Jan 25", w.rangeLabel)
        assertEquals(listOf("19", "20", "21", "22", "23", "24", "25"), w.days.map { it.dateLabel })
        assertFalse(w.days.any { it.isToday }) // today is not in next week
        assertEquals(-1, w.todayIndex)
        assertFalse(w.days.any { it.hasShifts }) // this-week fixtures don't place there
    }

    @Test fun next_week_agenda_places_that_weeks_shifts_and_has_no_now_line() {
        val nextThu = shift("2026-01-22T09:00:00-05:00", "2026-01-22T11:00:00-05:00")
        val anchor = shiftWeekAnchor(now, 1)
        val a = buildCalendarAgenda(listOf(nextThu), selectedDayIndex = 3, now = now, anchor = anchor)
        assertEquals("Thu", a.header.title) // a navigated week's Thursday is NOT "Today"
        assertEquals("Jan 22", a.header.dateLabel)
        assertEquals(1, a.items.count { it.shift != null })
        assertTrue(a.items.none { it.nowLabel != null }) // no NOW line off the current day
    }

    @Test fun shift_week_anchor_moves_whole_weeks_dst_safely() {
        // Across the 2026-03-08 spring-forward: +1 week from Thu Mar 5 lands on
        // Thu Mar 12 (EDT), not skewed by the missing hour.
        val beforeDst = at("2026-03-05T14:00:00-05:00")
        val w = buildCalendarWeek(emptyList(), beforeDst, anchor = shiftWeekAnchor(beforeDst, 1))
        assertEquals("Mar 9 – Mar 15", w.rangeLabel)
        // And a round trip returns to the original week.
        val back = shiftWeekAnchor(shiftWeekAnchor(now, 1), -1)
        assertEquals("Jan 12 – Jan 18", buildCalendarWeek(emptyList(), now, anchor = back).rangeLabel)
    }

    @Test fun view_model_week_navigation_moves_the_strip_and_resets_selection() {
        val vm = com.pennhousing.shift.shared.viewmodel.CalendarViewModel(all, now)
        assertEquals(0, vm.uiState.value.weekOffset)
        assertEquals(3, vm.uiState.value.selectedDayIndex) // Thu (today)
        vm.nextWeek()
        val next = vm.uiState.value
        assertEquals(1, next.weekOffset)
        assertEquals("Jan 19 – Jan 25", next.week.rangeLabel)
        assertEquals(0, next.selectedDayIndex) // Monday on a navigated week
        vm.previousWeek()
        val home = vm.uiState.value
        assertEquals(0, home.weekOffset)
        assertEquals("Jan 12 – Jan 18", home.week.rangeLabel)
        assertEquals(3, home.selectedDayIndex) // back to today
    }

    @Test fun closed_days_apply_only_to_the_current_week() {
        val vm = com.pennhousing.shift.shared.viewmodel.CalendarViewModel(all, now, setOf(5))
        assertTrue(vm.uiState.value.week.days[5].closed)
        vm.nextWeek()
        assertFalse(vm.uiState.value.week.days[5].closed) // no closure data off-week
    }

    // ----- duration formatter -----

    @Test fun formats_hours_and_minutes() {
        assertEquals("6h", formatHoursMinutes(360))
        assertEquals("1h 30m", formatHoursMinutes(90))
        assertEquals("45m", formatHoursMinutes(45))
    }
}
