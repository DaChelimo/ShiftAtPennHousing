package com.pennhousing.shift.shared.viewmodel

import androidx.lifecycle.ViewModel
import com.pennhousing.shift.shared.calendar.WeekOption
import com.pennhousing.shift.shared.calendar.buildCalendarWeek
import com.pennhousing.shift.shared.calendar.shiftWeekAnchor
import com.pennhousing.shift.shared.calendar.weekPickerOptions
import com.pennhousing.shift.shared.house.HouseGridWeek
import com.pennhousing.shift.shared.house.HouseScheduleSnapshot
import com.pennhousing.shift.shared.house.HouseSeat
import com.pennhousing.shift.shared.house.buildHouseGridWeek
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.time.Instant

data class HouseScheduleUiState(
    val houseName: String,
    val deskPhone: String?,
    val weekOffset: Int,
    val weekRange: String, // "Jun 1 – Jun 7"
    val weekRelative: String, // "This week" / "Last week" / "Next week" / "In 2 weeks"
    /** The shown week's NY anchor — the host passes it to `fetchHouseScheduleForWeek`. */
    val anchor: Instant,
    val canPreviousWeek: Boolean,
    val canNextWeek: Boolean,
    /** The pickable weeks (last week … +4) for the week-picker sheet. */
    val weekOptions: List<WeekOption>,
    /** The Excel-style grid for the shown week (time rail + Mon–Sun day columns). */
    val grid: HouseGridWeek,
    /** True while the host is (re)fetching this week's grid — the columns are empty until it lands. */
    val loadingWeek: Boolean,
    /** The raw shown-week seats — the swap counterparty picker derives candidates from these (D2). */
    val seats: List<HouseSeat> = emptyList(),
)

/**
 * §11.4 (T3b) — the home-house schedule ViewModel, rebuilt as a week-paged grid (design
 * `HouseScheduleScreen`). A thin `StateFlow` wrapper over the pure `house/` builder, in
 * the [SwapCalendarViewModel] shape (synchronous, no `viewModelScope`; `now` injected
 * once). Week navigation is clamped to [[MIN_WEEK_OFFSET], [MAX_WEEK_OFFSET]] — last week
 * through four weeks out.
 *
 * Data flow mirrors the swap calendar: the worker's own week starts seeded with the
 * current-week [HouseScheduleSnapshot]; on every week change the host fetches that week's
 * grid (`fetchHouseScheduleForWeek(anchor)`) and calls [setWeekSeats]. Until that lands,
 * [HouseScheduleUiState.loadingWeek] is true.
 */
class HouseScheduleViewModel(
    private val houseName: String,
    private val deskPhone: String?,
    initialSeats: List<HouseSeat>,
    private val meUserId: String?,
    private val now: Instant,
) : ViewModel() {
    /** Backward-compatible constructor (current-week snapshot only). */
    constructor(
        snapshot: HouseScheduleSnapshot,
        now: Instant,
        meUserId: String? = null,
    ) : this(snapshot.houseName, snapshot.deskPhone, snapshot.seats, meUserId, now)

    companion object {
        const val MIN_WEEK_OFFSET = -1
        const val MAX_WEEK_OFFSET = 4
    }

    private var weekOffset = 0
    private var weekSeats: List<HouseSeat> = initialSeats
    private var seatsForOffset: Int = 0 // which weekOffset weekSeats belong to

    private val _uiState = MutableStateFlow(snapshot())
    val uiState: StateFlow<HouseScheduleUiState> = _uiState.asStateFlow()

    private fun relativeLabel(offset: Int): String =
        when {
            offset == 0 -> "This week"
            offset == 1 -> "Next week"
            offset == -1 -> "Last week"
            offset > 1 -> "In $offset weeks"
            else -> "${-offset} weeks ago"
        }

    private fun snapshot(): HouseScheduleUiState {
        val anchor = shiftWeekAnchor(now, weekOffset)
        val week = buildCalendarWeek(emptyList(), now, anchor = anchor)
        val current = seatsForOffset == weekOffset
        val seats = if (current) weekSeats else emptyList()
        return HouseScheduleUiState(
            houseName = houseName,
            deskPhone = deskPhone,
            weekOffset = weekOffset,
            weekRange = week.rangeLabel,
            weekRelative = relativeLabel(weekOffset),
            anchor = anchor,
            canPreviousWeek = weekOffset > MIN_WEEK_OFFSET,
            canNextWeek = weekOffset < MAX_WEEK_OFFSET,
            weekOptions = weekPickerOptions(now, offsets = (MIN_WEEK_OFFSET..MAX_WEEK_OFFSET).toList()),
            grid = buildHouseGridWeek(seats, now, meUserId, anchor),
            loadingWeek = !current,
            seats = seats,
        )
    }

    /**
     * The host fetched [seats] for the week at [forOffset] (`fetchHouseScheduleForWeek`).
     * Ignored if the worker has since navigated away (stale fetch), so a slow week never
     * paints the wrong housemates.
     */
    fun setWeekSeats(
        forOffset: Int,
        seats: List<HouseSeat>,
    ) {
        if (forOffset != weekOffset) return
        weekSeats = seats
        seatsForOffset = forOffset
        _uiState.value = snapshot()
    }

    fun selectWeek(offset: Int) {
        weekOffset = offset.coerceIn(MIN_WEEK_OFFSET, MAX_WEEK_OFFSET)
        _uiState.value = snapshot()
    }

    fun previousWeek() = selectWeek(weekOffset - 1)

    fun nextWeek() = selectWeek(weekOffset + 1)
}
