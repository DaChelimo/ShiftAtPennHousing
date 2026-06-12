package com.pennhousing.shift.shared.viewmodel

import androidx.lifecycle.ViewModel
import com.pennhousing.shift.shared.calendar.CalendarAgenda
import com.pennhousing.shift.shared.calendar.CalendarWeek
import com.pennhousing.shift.shared.calendar.TemplateSlot
import com.pennhousing.shift.shared.calendar.buildCalendarAgenda
import com.pennhousing.shift.shared.calendar.buildCalendarWeek
import com.pennhousing.shift.shared.calendar.WeekOption
import com.pennhousing.shift.shared.calendar.buildTypicalWeek
import com.pennhousing.shift.shared.calendar.shiftWeekAnchor
import com.pennhousing.shift.shared.calendar.weekPickerOptions
import com.pennhousing.shift.shared.model.MyShift
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.time.Instant

enum class CalendarMode { WEEK, TEMPLATE }

data class CalendarUiState(
    val week: CalendarWeek,
    val selectedDayIndex: Int,
    val agenda: CalendarAgenda,
    /** Weeks from the current one (0 = this week) — drives the header label (T3b-4). */
    val weekOffset: Int = 0,
    /** WEEK = the dated agenda; TEMPLATE = the derived recurring typical week (D5). */
    val mode: CalendarMode = CalendarMode.WEEK,
    val template: List<TemplateSlot> = emptyList(),
)

/**
 * Phase 13a — the Personal-Calendar ViewModel (agenda-first). A thin `StateFlow`
 * wrapper over the pure `calendar/` builders, in the [ShiftsScreenViewModel] shape
 * (synchronous, no `viewModelScope`). `now` is the load instant, injected once
 * (decision #17). [selectDay] moves the agenda within the shown week, and
 * [previousWeek]/[nextWeek] move the shown week itself (T3b-4 — the underlying
 * `worker_my_shifts` read is date-unbounded, so other weeks' shifts are already in
 * the snapshot). Same `MyShift` snapshot the Shifts screen renders — no new data.
 */
class CalendarViewModel(
    private val myShifts: List<MyShift>,
    private val now: Instant,
    // Mon..Sun indexes the worker's HOME house is closed (§3.4/§11.3) — the host
    // resolves them via the `house_closure` RPC for the CURRENT week; navigated
    // weeks render without the closed treatment (no per-week closure data).
    private val closedDayIndexes: Set<Int> = emptySet(),
) : ViewModel() {
    private var weekOffset = 0

    // The derived recurring typical week (D5) — computed once from the snapshot.
    // Declared BEFORE _uiState: snapshot() runs inside _uiState's initializer.
    private val template: List<TemplateSlot> by lazy { buildTypicalWeek(myShifts) }
    private var mode = CalendarMode.WEEK

    private val _uiState = MutableStateFlow(snapshot(buildWeek().todayIndex))
    val uiState: StateFlow<CalendarUiState> = _uiState.asStateFlow()

    private fun closedFor(offset: Int): Set<Int> = if (offset == 0) closedDayIndexes else emptySet()

    private fun buildWeek(): CalendarWeek =
        buildCalendarWeek(
            myShifts,
            now,
            closedDayIndexes = closedFor(weekOffset),
            anchor = shiftWeekAnchor(now, weekOffset),
        )

    private fun snapshot(dayIndex: Int): CalendarUiState {
        val week = buildWeek()
        val day = dayIndex.coerceIn(0, week.days.size - 1)
        return CalendarUiState(
            week = week,
            selectedDayIndex = day,
            agenda =
                buildCalendarAgenda(
                    myShifts,
                    day,
                    now,
                    closedDayIndexes = closedFor(weekOffset),
                    anchor = shiftWeekAnchor(now, weekOffset),
                ),
            weekOffset = weekOffset,
            mode = mode,
            template = if (mode == CalendarMode.TEMPLATE) template else emptyList(),
        )
    }

    fun selectDay(index: Int) {
        _uiState.value = snapshot(index)
    }

    /** T3b-4: show the previous/next week. Selection resets to today (current week) or Monday. */
    fun previousWeek() = selectWeek(weekOffset - 1)

    fun nextWeek() = selectWeek(weekOffset + 1)

    /** D5 — the week-picker sheet's absolute pick (also exits template mode). */
    fun selectWeekOffset(offset: Int) = selectWeek(offset)

    /** D5 — the quick weeks the picker sheet offers (label + range per offset). */
    fun weekOptions(): List<WeekOption> = weekPickerOptions(now)

    /** D5 — show the derived recurring typical week. */
    fun showTemplate() {
        mode = CalendarMode.TEMPLATE
        _uiState.value = snapshot(_uiState.value.selectedDayIndex)
    }

    private fun selectWeek(offset: Int) {
        mode = CalendarMode.WEEK
        weekOffset = offset
        val week = buildWeek()
        _uiState.value = snapshot(if (week.todayIndex >= 0) week.todayIndex else 0)
    }
}
