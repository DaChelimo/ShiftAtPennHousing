package com.pennhousing.shift.shared.viewmodel

import androidx.lifecycle.ViewModel
import com.pennhousing.shift.shared.calendar.CalendarWeek
import com.pennhousing.shift.shared.calendar.buildCalendarWeek
import com.pennhousing.shift.shared.house.HouseDay
import com.pennhousing.shift.shared.house.HouseScheduleSnapshot
import com.pennhousing.shift.shared.house.buildHouseDay
import com.pennhousing.shift.shared.house.houseDaysWithSeats
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.time.Instant

data class HouseScheduleUiState(
    val houseName: String,
    val deskPhone: String?,
    val week: CalendarWeek,
    val selectedDayIndex: Int,
    val day: HouseDay,
    /** Strip dots — the Mon..Sun indexes that have any seat. */
    val daysWithSeats: Set<Int>,
    /** The raw week seats — the swap counterparty picker derives candidates from these (D2). */
    val seats: List<com.pennhousing.shift.shared.house.HouseSeat> = emptyList(),
)

/**
 * §11.4 (T3b) — the home-house schedule ViewModel: a thin `StateFlow` wrapper over
 * the pure `house/` builders, in the [CalendarViewModel] shape (synchronous, no
 * `viewModelScope`; `now` injected once). The week strip is the same Mon–Sun
 * component the personal calendar uses; the dots mark days that have seats.
 */
class HouseScheduleViewModel(
    private val snapshot: HouseScheduleSnapshot,
    private val now: Instant,
) : ViewModel() {
    private val daysWithSeats = houseDaysWithSeats(snapshot.seats, now)

    // The shared Mon–Sun strip, with the dots driven by seat-bearing days.
    private val week: CalendarWeek =
        buildCalendarWeek(emptyList(), now).let { w ->
            w.copy(days = w.days.map { it.copy(hasShifts = it.index in daysWithSeats) })
        }

    private val _uiState = MutableStateFlow(state(week.todayIndex))
    val uiState: StateFlow<HouseScheduleUiState> = _uiState.asStateFlow()

    private fun state(dayIndex: Int): HouseScheduleUiState =
        HouseScheduleUiState(
            houseName = snapshot.houseName,
            deskPhone = snapshot.deskPhone,
            week = week,
            selectedDayIndex = dayIndex,
            day = buildHouseDay(snapshot.seats, dayIndex, now),
            daysWithSeats = daysWithSeats,
            seats = snapshot.seats,
        )

    fun selectDay(index: Int) {
        _uiState.value = state(index)
    }
}
