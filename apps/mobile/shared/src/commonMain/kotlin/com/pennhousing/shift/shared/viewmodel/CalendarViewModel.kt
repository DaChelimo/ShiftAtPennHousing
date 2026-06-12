package com.pennhousing.shift.shared.viewmodel

import androidx.lifecycle.ViewModel
import com.pennhousing.shift.shared.calendar.CalendarAgenda
import com.pennhousing.shift.shared.calendar.CalendarWeek
import com.pennhousing.shift.shared.calendar.buildCalendarAgenda
import com.pennhousing.shift.shared.calendar.buildCalendarWeek
import com.pennhousing.shift.shared.model.MyShift
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.time.Instant

data class CalendarUiState(
    val week: CalendarWeek,
    val selectedDayIndex: Int,
    val agenda: CalendarAgenda,
)

/**
 * Phase 13a — the Personal-Calendar ViewModel (agenda-first). A thin `StateFlow`
 * wrapper over the pure `calendar/` builders, in the [ShiftsScreenViewModel] shape
 * (synchronous, no `viewModelScope`). `now` is the load instant, injected once
 * (decision #17); the week is fixed (only the current week is exposed), and
 * [selectDay] moves the agenda within it. Same `MyShift` snapshot the Shifts screen
 * renders — no new data.
 */
class CalendarViewModel(
    private val myShifts: List<MyShift>,
    private val now: Instant,
    // Mon..Sun indexes the worker's HOME house is closed (§3.4/§11.3) — the host
    // resolves them via the `house_closure` RPC; empty on the demo path.
    private val closedDayIndexes: Set<Int> = emptySet(),
) : ViewModel() {
    private val week: CalendarWeek = buildCalendarWeek(myShifts, now, closedDayIndexes = closedDayIndexes)

    private val _uiState = MutableStateFlow(snapshot(week.todayIndex))
    val uiState: StateFlow<CalendarUiState> = _uiState.asStateFlow()

    private fun snapshot(dayIndex: Int): CalendarUiState =
        CalendarUiState(
            week = week,
            selectedDayIndex = dayIndex,
            agenda = buildCalendarAgenda(myShifts, dayIndex, now, closedDayIndexes = closedDayIndexes),
        )

    fun selectDay(index: Int) {
        _uiState.value = snapshot(index)
    }
}
