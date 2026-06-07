package com.pennhousing.shift.shared.calendar

import com.pennhousing.shift.shared.model.AssignmentKind
import com.pennhousing.shift.shared.model.House
import com.pennhousing.shift.shared.model.MyShift
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
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

    // ----- duration formatter -----

    @Test fun formats_hours_and_minutes() {
        assertEquals("6h", formatHoursMinutes(360))
        assertEquals("1h 30m", formatHoursMinutes(90))
        assertEquals("45m", formatHoursMinutes(45))
    }
}
