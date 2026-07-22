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
        assertEquals("Jan 12 - Jan 18", w.rangeLabel)
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
        assertEquals("09:00 - 13:00", a.items[0].shift?.timeLabel)
        assertEquals("NOW · 14:00", a.items[1].nowLabel)
        assertNull(a.items[1].shift)
        assertEquals("16:00 - 18:00", a.items[2].shift?.timeLabel)
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
        assertEquals("09:00 - 13:00", a.items[0].shift?.timeLabel)
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
        assertEquals("10:00 - 14:00", a.items[0].shift?.timeLabel)
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
        assertEquals("Jan 19 - Jan 25", w.rangeLabel)
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
        assertEquals("Mar 9 - Mar 15", w.rangeLabel)
        // And a round trip returns to the original week.
        val back = shiftWeekAnchor(shiftWeekAnchor(now, 1), -1)
        assertEquals("Jan 12 - Jan 18", buildCalendarWeek(emptyList(), now, anchor = back).rangeLabel)
    }

    @Test fun view_model_week_navigation_moves_the_strip_and_resets_selection() {
        val vm = com.pennhousing.shift.shared.viewmodel.CalendarViewModel(all, now)
        assertEquals(0, vm.uiState.value.weekOffset)
        assertEquals(3, vm.uiState.value.selectedDayIndex) // Thu (today)
        vm.nextWeek()
        val next = vm.uiState.value
        assertEquals(1, next.weekOffset)
        assertEquals("Jan 19 - Jan 25", next.week.rangeLabel)
        assertEquals(0, next.selectedDayIndex) // Monday on a navigated week
        vm.previousWeek()
        val home = vm.uiState.value
        assertEquals(0, home.weekOffset)
        assertEquals("Jan 12 - Jan 18", home.week.rangeLabel)
        assertEquals(3, home.selectedDayIndex) // back to today
    }

    @Test fun closed_days_apply_only_to_the_current_week() {
        val vm = com.pennhousing.shift.shared.viewmodel.CalendarViewModel(all, now, setOf(5))
        assertTrue(vm.uiState.value.week.days[5].closed)
        vm.nextWeek()
        assertFalse(vm.uiState.value.week.days[5].closed) // no closure data off-week
    }

    // ----- week picker + derived template (D5) -----

    @Test fun week_picker_options_label_and_range_each_offset() {
        val options = weekPickerOptions(now)
        assertEquals(listOf(-1, 0, 1, 2, 3), options.map { it.offset })
        assertEquals(listOf("Last week", "This week", "Next week", "In 2 weeks", "In 3 weeks"), options.map { it.label })
        assertEquals("Jan 12 - Jan 18", options.first { it.offset == 0 }.rangeLabel)
        assertEquals("Jan 5 - Jan 11", options.first { it.offset == -1 }.rangeLabel)
        assertEquals("Jan 19 - Jan 25", options.first { it.offset == 1 }.rangeLabel)
    }

    @Test fun typical_week_derives_recurring_scheduled_slots_across_weeks() {
        // The same Thu 09:00–13:00 Harnwell slot in two consecutive weeks → ONE
        // template slot, weeksSeen = 2. A pickup never enters the template.
        val nextWeekSame = shift("2026-01-22T09:00:00-05:00", "2026-01-22T13:00:00-05:00")
        val slots = buildTypicalWeek(listOf(morning, nextWeekSame, saturday))
        assertEquals(1, slots.size)
        val slot = slots.single()
        assertEquals("Thu", slot.dayLabel)
        assertEquals("09:00 - 13:00", slot.timeLabel)
        assertEquals("Harnwell", slot.houseName)
        assertEquals(2, slot.weeksSeen)
    }

    @Test fun typical_week_excludes_breaks_drops_and_coalesces_per_block_rows() {
        val blocks =
            (0 until 4).map { i ->
                MyShift(
                    id = "b-$i",
                    house = harnwell,
                    start = at("2026-01-16T10:00:00-05:00") + (i * 30).minutes,
                    end = at("2026-01-16T10:00:00-05:00") + ((i + 1) * 30).minutes,
                    kind = AssignmentKind.SCHEDULED,
                )
            }
        val breakShift = shift("2026-01-16T18:00:00-05:00", "2026-01-16T20:00:00-05:00").copy(id = "br", breakShift = true)
        val dropped = shift("2026-01-16T20:00:00-05:00", "2026-01-16T22:00:00-05:00").copy(id = "dr", droppedStillOpen = true)
        val slots = buildTypicalWeek(blocks + breakShift + dropped)
        assertEquals(1, slots.size) // 4 blocks coalesce to one Fri 10:00–12:00 slot
        assertEquals("10:00 - 12:00", slots.single().timeLabel)
        assertEquals("Fri", slots.single().dayLabel)
    }

    @Test fun view_model_template_mode_toggles_and_week_pick_exits_it() {
        val vm = com.pennhousing.shift.shared.viewmodel.CalendarViewModel(all, now)
        vm.showTemplate()
        val tpl = vm.uiState.value
        assertEquals(com.pennhousing.shift.shared.viewmodel.CalendarMode.TEMPLATE, tpl.mode)
        assertTrue(tpl.template.isNotEmpty()) // morning + evening are SCHEDULED
        vm.selectWeekOffset(1)
        val wk = vm.uiState.value
        assertEquals(com.pennhousing.shift.shared.viewmodel.CalendarMode.WEEK, wk.mode)
        assertEquals(1, wk.weekOffset)
        assertTrue(wk.template.isEmpty())
    }

    // ----- week overview (default view) -----

    @Test fun week_overview_has_seven_day_sections_with_shifts_in_the_right_days() {
        val o = buildCalendarWeekOverview(all, now)
        assertEquals(7, o.days.size)
        assertEquals((0..6).toList(), o.days.map { it.dayIndex })
        val thu = o.days[3]
        assertTrue(thu.isToday)
        assertEquals("Today", thu.header.title)
        assertEquals("2 shifts · 6h", thu.header.summary)
        assertFalse(thu.isEmpty)
        val sat = o.days[5]
        assertFalse(sat.isEmpty) // the Saturday pickup
        assertFalse(sat.isToday)
        assertTrue(o.days[0].isEmpty) // Monday — nothing scheduled
    }

    @Test fun week_overview_now_line_appears_only_in_todays_section() {
        val o = buildCalendarWeekOverview(all, now)
        // Today (Thu) carries the NOW line; no other day does.
        assertTrue(o.days[3].items.any { it.nowLabel != null })
        assertTrue(o.days.filter { !it.isToday }.all { sec -> sec.items.none { it.nowLabel != null } })
    }

    // ----- week overview: collapse already-past days on the ongoing week -----

    @Test fun week_overview_folds_days_before_today_on_the_ongoing_week() {
        // now = Thu (index 3): Mon/Tue/Wed fold into the "Earlier this week" card;
        // Thu..Sun stay active with today first.
        val o = buildCalendarWeekOverview(all, now)
        assertEquals(7, o.days.size) // raw list unchanged
        assertTrue(o.hasCollapsedPast)
        assertEquals(listOf(0, 1, 2), o.collapsedPastDays.map { it.dayIndex }) // Mon,Tue,Wed
        assertEquals(listOf(3, 4, 5, 6), o.activeDays.map { it.dayIndex }) // Thu..Sun
        assertTrue(o.activeDays.first().isToday) // today anchors the active list
    }

    @Test fun week_overview_keeps_empty_upcoming_days_in_the_active_list() {
        // Q2 decision: today..Sunday still render, empties included. Fri (index 4) has
        // no fixture shift yet is present and empty in the active list.
        val o = buildCalendarWeekOverview(all, now)
        val fri = o.activeDays.single { it.dayIndex == 4 }
        assertTrue(fri.isEmpty)
    }

    @Test fun week_overview_collapsed_shift_count_counts_only_past_shifts() {
        // A Tuesday shift (before today) is folded and counted; the Thu/Sat shifts are not.
        val tuesday = shift("2026-01-13T09:00:00-05:00", "2026-01-13T12:00:00-05:00")
        val o = buildCalendarWeekOverview(all + tuesday, now)
        assertEquals(1, o.collapsedShiftCount)
        assertFalse(o.collapsedPastDays.single { it.dayIndex == 1 }.isEmpty) // Tue holds it
    }

    @Test fun week_overview_does_not_fold_when_today_is_monday() {
        val mondayNow = at("2026-01-12T10:00:00-05:00") // Mon of this week — nothing before it
        val o = buildCalendarWeekOverview(all, mondayNow)
        assertFalse(o.hasCollapsedPast)
        assertEquals(o.days, o.activeDays) // all seven render normally
    }

    @Test fun week_overview_sunday_today_lifts_the_lone_sunday_to_the_top() {
        // now = Sun (index 6): Mon..Sat fold, so a Sunday shift sits right at the top.
        val sundayNow = at("2026-01-18T10:00:00-05:00")
        val sunday = shift("2026-01-18T14:00:00-05:00", "2026-01-18T18:00:00-05:00")
        val o = buildCalendarWeekOverview(listOf(sunday), sundayNow)
        assertEquals(6, o.collapsedPastDays.size) // Mon..Sat all folded away
        assertEquals(listOf(6), o.activeDays.map { it.dayIndex }) // only Sunday active
        assertTrue(o.activeDays.single().isToday)
        assertFalse(o.activeDays.single().isEmpty)
    }

    @Test fun navigated_weeks_never_fold_past_days() {
        // A future week (no "today") and a fully-past week both render Mon..Sun uncollapsed.
        val nextO = buildCalendarWeekOverview(all, now, anchor = shiftWeekAnchor(now, 1))
        assertFalse(nextO.hasCollapsedPast)
        assertEquals(nextO.days, nextO.activeDays)

        val lastO = buildCalendarWeekOverview(all, now, anchor = shiftWeekAnchor(now, -1))
        assertFalse(lastO.hasCollapsedPast)
        assertEquals(lastO.days, lastO.activeDays)
    }

    @Test fun view_model_defaults_to_week_overview() {
        val vm = com.pennhousing.shift.shared.viewmodel.CalendarViewModel(all, now)
        val s = vm.uiState.value
        assertEquals(com.pennhousing.shift.shared.viewmodel.CalendarMode.WEEK, s.mode)
        assertEquals(7, s.weekOverview?.days?.size)
        assertEquals(3, s.selectedDayIndex) // today, ready for a drill-in
    }

    @Test fun view_model_select_day_drills_in_and_show_week_returns_to_overview() {
        val vm = com.pennhousing.shift.shared.viewmodel.CalendarViewModel(all, now)
        vm.selectDay(5) // Saturday
        val day = vm.uiState.value
        assertEquals(com.pennhousing.shift.shared.viewmodel.CalendarMode.DAY, day.mode)
        assertNull(day.weekOverview) // overview suppressed in the day view
        assertEquals(5, day.selectedDayIndex)
        assertFalse(day.agenda.isEmpty)

        vm.showWeek()
        val wk = vm.uiState.value
        assertEquals(com.pennhousing.shift.shared.viewmodel.CalendarMode.WEEK, wk.mode)
        assertEquals(7, wk.weekOverview?.days?.size)
    }

    // ----- duration formatter -----

    @Test fun formats_hours_and_minutes() {
        assertEquals("6h", formatHoursMinutes(360))
        assertEquals("1h 30m", formatHoursMinutes(90))
        assertEquals("45m", formatHoursMinutes(45))
    }
}
