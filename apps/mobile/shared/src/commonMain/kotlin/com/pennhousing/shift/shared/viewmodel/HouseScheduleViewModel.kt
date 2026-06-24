package com.pennhousing.shift.shared.viewmodel

import androidx.lifecycle.ViewModel
import com.pennhousing.shift.shared.calendar.CalendarWeek
import com.pennhousing.shift.shared.calendar.WeekOption
import com.pennhousing.shift.shared.calendar.buildCalendarWeek
import com.pennhousing.shift.shared.calendar.shiftWeekAnchor
import com.pennhousing.shift.shared.calendar.weekPickerOptions
import com.pennhousing.shift.shared.house.HouseDay
import com.pennhousing.shift.shared.house.HouseOption
import com.pennhousing.shift.shared.house.HouseScheduleSnapshot
import com.pennhousing.shift.shared.house.HouseSeat
import com.pennhousing.shift.shared.house.buildHouseDay
import com.pennhousing.shift.shared.house.houseDaysWithSeats
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
    /** The shown week's NY anchor — the host passes it to `fetchHouseGridForWeek`. */
    val anchor: Instant,
    val canPreviousWeek: Boolean,
    val canNextWeek: Boolean,
    /** The pickable weeks (last week … +4) for the week-picker sheet. */
    val weekOptions: List<WeekOption>,
    /** The Mon–Sun strip for the shown week (dots = days with seats). */
    val week: CalendarWeek,
    /** The selected day (0=Mon..6=Sun) within the shown week. */
    val selectedDayIndex: Int,
    /** The selected day's roster — a readable list of coalesced shift rows. */
    val day: HouseDay,
    /** Strip dots — the Mon..Sun indexes of the shown week that have any seat. */
    val daysWithSeats: Set<Int>,
    /** True while the host is (re)fetching this week's seats — the roster is empty until it lands. */
    val loadingWeek: Boolean,
    /** The raw shown-week seats — the swap counterparty picker derives candidates from these (D2). */
    val seats: List<HouseSeat> = emptyList(),
    /** Every pickable house for the switcher (2026-06-23 cross-house view ruling). */
    val houses: List<HouseOption> = emptyList(),
    /** The house currently shown — defaults to the worker's home house. */
    val selectedHouseId: String? = null,
    /** The worker's home house — marked "Your house" in the switcher. */
    val homeHouseId: String? = null,
    /** True when the shown house IS the worker's home house (drives the "Your house" marker). */
    val isHomeHouse: Boolean = true,
    /** True once more than one house is known — the header acts as a dropdown. */
    val canSwitchHouse: Boolean = false,
)

/**
 * §11.4 (T3b) — the house-schedule ViewModel: a week-paged, day-roster view of who
 * covers each desk block. A thin `StateFlow` wrapper over the pure `house/` builders, in
 * the [CalendarViewModel] shape (synchronous, no `viewModelScope`; `now` injected once).
 * The Mon–Sun strip picks a day; the day's roster lists readable shift cards. Week
 * navigation is clamped to [[MIN_WEEK_OFFSET], [MAX_WEEK_OFFSET]] — last week through
 * four weeks out.
 *
 * Cross-house view (2026-06-23 ruling): the tab DEFAULTS to the worker's home house but
 * a worker may switch to any other house and read its schedule (read-only). The host
 * supplies the pickable [HouseOption] list via [setHouses]; [selectHouse] re-centres on
 * the current week so opening a house lands on "today".
 *
 * Data flow mirrors the swap calendar: the worker's home week starts seeded with the
 * current-week [HouseScheduleSnapshot]; on every (house, week) change the host fetches
 * that week's seats and calls [setWeekSeats]. Until that lands,
 * [HouseScheduleUiState.loadingWeek] is true.
 */
class HouseScheduleViewModel(
    private val initialHouseName: String,
    private val initialDeskPhone: String?,
    private val initialHouseId: String?,
    initialSeats: List<HouseSeat>,
    private val meUserId: String?,
    private val now: Instant,
) : ViewModel() {
    /** Backward-compatible constructor (current-week snapshot only). */
    constructor(
        snapshot: HouseScheduleSnapshot,
        now: Instant,
        meUserId: String? = null,
    ) : this(snapshot.houseName, snapshot.deskPhone, snapshot.houseId, snapshot.seats, meUserId, now)

    companion object {
        const val MIN_WEEK_OFFSET = -1
        const val MAX_WEEK_OFFSET = 4
    }

    private val homeHouseId: String? = initialHouseId

    private var weekOffset = 0
    private var houses: List<HouseOption> = emptyList()
    private var selectedHouseId: String? = initialHouseId
    private var weekSeats: List<HouseSeat> = initialSeats
    private var seatsForOffset: Int = 0 // which weekOffset weekSeats belong to
    private var seatsForHouseId: String? = initialHouseId // which house weekSeats belong to

    // null = "auto" (default to today if it's in the shown week, else Monday). A manual
    // selectDay pins it; navigating weeks / switching houses returns it to auto.
    private var selectedDayIndex: Int? = null

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
        val current = seatsForOffset == weekOffset && seatsForHouseId == selectedHouseId
        val seats = if (current) weekSeats else emptyList()
        val daysWithSeats = houseDaysWithSeats(seats, anchor)
        val week =
            buildCalendarWeek(emptyList(), now, anchor = anchor).let { w ->
                w.copy(days = w.days.map { it.copy(hasShifts = it.index in daysWithSeats) })
            }
        // Resolve "auto" to today's index when today is in the shown week, else Monday.
        val dayIndex = selectedDayIndex ?: week.todayIndex.takeIf { it >= 0 } ?: 0
        val day = buildHouseDay(seats, dayIndex, now, meUserId, anchor)
        // Name/phone come from the picker list once it's loaded; before then (or for the
        // home house) the seed values stand in.
        val opt = houses.firstOrNull { it.id == selectedHouseId }
        val isInitial = selectedHouseId == null || selectedHouseId == initialHouseId
        val name = opt?.name ?: if (isInitial) initialHouseName else (selectedHouseId ?: initialHouseName)
        val phone = opt?.deskPhone ?: if (isInitial) initialDeskPhone else null
        return HouseScheduleUiState(
            houseName = name,
            deskPhone = phone,
            weekOffset = weekOffset,
            weekRange = week.rangeLabel,
            weekRelative = relativeLabel(weekOffset),
            anchor = anchor,
            canPreviousWeek = weekOffset > MIN_WEEK_OFFSET,
            canNextWeek = weekOffset < MAX_WEEK_OFFSET,
            weekOptions = weekPickerOptions(now, offsets = (MIN_WEEK_OFFSET..MAX_WEEK_OFFSET).toList()),
            week = week,
            selectedDayIndex = dayIndex,
            day = day,
            daysWithSeats = daysWithSeats,
            loadingWeek = !current,
            seats = seats,
            houses = houses,
            selectedHouseId = selectedHouseId,
            homeHouseId = homeHouseId,
            isHomeHouse = selectedHouseId == null || selectedHouseId == homeHouseId,
            canSwitchHouse = houses.size > 1,
        )
    }

    /** Pick a day (0=Mon..6=Sun) within the shown week — pins the roster to that day. */
    fun selectDay(index: Int) {
        selectedDayIndex = index.coerceIn(0, 6)
        _uiState.value = snapshot()
    }

    /** The host loaded the pickable houses (`fetchHouses`); populates the switcher. */
    fun setHouses(options: List<HouseOption>) {
        houses = options
        _uiState.value = snapshot()
    }

    /**
     * Open another house's schedule (cross-house view). Re-centres on the CURRENT week so
     * the worker lands on "today" (the day strip re-defaults to today), and marks the week
     * loading until the host fetches the new house's seats. A no-op for the already-shown house.
     */
    fun selectHouse(houseId: String) {
        if (houseId == selectedHouseId) return
        selectedHouseId = houseId
        weekOffset = 0
        selectedDayIndex = null // back to auto → today
        _uiState.value = snapshot()
    }

    /**
     * The host fetched [seats] for the week at [forOffset] of [forHouseId]
     * (`fetchHouseGridForWeek`). Ignored if the worker has since navigated to another
     * week OR switched houses (a stale fetch), so a slow load never paints the wrong house.
     */
    fun setWeekSeats(
        forHouseId: String?,
        forOffset: Int,
        seats: List<HouseSeat>,
    ) {
        if (forOffset != weekOffset || forHouseId != selectedHouseId) return
        weekSeats = seats
        seatsForOffset = forOffset
        seatsForHouseId = forHouseId
        _uiState.value = snapshot()
    }

    /** Back-compat overload — seats for the currently-shown house at [forOffset]. */
    fun setWeekSeats(
        forOffset: Int,
        seats: List<HouseSeat>,
    ) = setWeekSeats(selectedHouseId, forOffset, seats)

    fun selectWeek(offset: Int) {
        weekOffset = offset.coerceIn(MIN_WEEK_OFFSET, MAX_WEEK_OFFSET)
        selectedDayIndex = null // back to auto → today (if in the new week) else Monday
        _uiState.value = snapshot()
    }

    fun previousWeek() = selectWeek(weekOffset - 1)

    fun nextWeek() = selectWeek(weekOffset + 1)
}
