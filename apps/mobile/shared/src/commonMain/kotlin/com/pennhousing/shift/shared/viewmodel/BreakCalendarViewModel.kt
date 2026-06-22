package com.pennhousing.shift.shared.viewmodel

import androidx.lifecycle.ViewModel
import com.pennhousing.shift.shared.breakclaim.BreakCalendarDay
import com.pennhousing.shift.shared.breakclaim.BreakCalendarSnapshot
import com.pennhousing.shift.shared.breakclaim.BreakDragPlan
import com.pennhousing.shift.shared.breakclaim.BreakHoursMeter
import com.pennhousing.shift.shared.breakclaim.BreakPhase
import com.pennhousing.shift.shared.breakclaim.BreakWeekCell
import com.pennhousing.shift.shared.breakclaim.applyBreakDrag
import com.pennhousing.shift.shared.breakclaim.applyBreakDrop
import com.pennhousing.shift.shared.breakclaim.breakWeekRangeLabel
import com.pennhousing.shift.shared.breakclaim.breakWeeks
import com.pennhousing.shift.shared.breakclaim.breakWindowLabel
import com.pennhousing.shift.shared.breakclaim.buildBreakCalendarDay
import com.pennhousing.shift.shared.breakclaim.buildBreakHoursMeter
import com.pennhousing.shift.shared.breakclaim.breakWeekStrip
import com.pennhousing.shift.shared.breakclaim.planBreakDrag
import com.pennhousing.shift.shared.breakclaim.reconcileBreakClaim
import com.pennhousing.shift.shared.shifts.NEW_YORK
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.datetime.LocalDate
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Instant

/**
 * One pickable week of the break (the picker pages through them; winter spans ~3). */
data class BreakWeekTab(
    val index: Int,
    val rangeLabel: String,
)

data class BreakCalendarUiState(
    val houseName: String,
    val breakName: String,
    val windowLabel: String,
    val phase: BreakPhase,
    /** True after T-1d — the calendar is read-only and points to Open Shifts (round 2). */
    val readOnly: Boolean,
    val weeks: List<BreakWeekTab>,
    val weekIndex: Int,
    val weekRangeLabel: String,
    val weekStrip: List<BreakWeekCell>,
    val selectedDayIndex: Int,
    val day: BreakCalendarDay,
    val meter: BreakHoursMeter,
    val optedOut: Boolean,
    /** True on the live build when no break is scheduled — the screen shows the no-break state. */
    val noActiveBreak: Boolean,
    /** The last drag's human summary ("Claimed 4:00–6:00 · 6:00–8:00 was already full"). */
    val lastMessage: String?,
)

/**
 * Break CALENDAR ViewModel (Break redesign B3) — a thin `StateFlow` wrapper over the pure
 * `breakclaim/BreakCalendar.kt` builders, in the [HouseScheduleViewModel] shape
 * (synchronous, no `viewModelScope`). The [snapshot] is the only data; `now` is injected.
 *
 * Claims are OPTIMISTIC-LOCAL: [previewDrag] computes the trim/coverage plan for the
 * confirm sheet, [commitDrag] applies it locally and returns the block ids the live
 * `break-claim` write loops, and [reconcileClaim] folds the server's actual claimed seats
 * back in (the server may FCFS-trim further). The opt-out + drop mirror the old picker.
 */
class BreakCalendarViewModel(
    snapshot: BreakCalendarSnapshot,
    private val now: Instant,
    val breakId: String? = null,
    initialOptedOut: Boolean = false,
) : ViewModel() {
    private var snapshot: BreakCalendarSnapshot = snapshot
    private var optedOut: Boolean = initialOptedOut
    private val weekMondays: List<LocalDate> = breakWeeks(snapshot.windowStart, snapshot.windowEnd)
    private var weekIndex: Int = defaultWeekIndex()
    private var selectedDayIndex: Int = defaultDayIndex(weekIndex)
    private var lastMessage: String? = null

    private val _uiState = MutableStateFlow(build())
    val uiState: StateFlow<BreakCalendarUiState> = _uiState.asStateFlow()

    private fun build(): BreakCalendarUiState {
        val monday = weekMondays[weekIndex]
        val day = buildBreakCalendarDay(snapshot, monday, selectedDayIndex, now)
        return BreakCalendarUiState(
            houseName = snapshot.houseName,
            breakName = snapshot.breakName,
            windowLabel = breakWindowLabel(snapshot.windowStart, snapshot.windowEnd),
            phase = snapshot.phase,
            readOnly = snapshot.phase != BreakPhase.CLAIM_WINDOW,
            weeks = weekMondays.mapIndexed { i, m -> BreakWeekTab(i, breakWeekRangeLabel(m)) },
            weekIndex = weekIndex,
            weekRangeLabel = breakWeekRangeLabel(monday),
            weekStrip = breakWeekStrip(snapshot, monday, now),
            selectedDayIndex = selectedDayIndex,
            day = day,
            meter = buildBreakHoursMeter(snapshot.claimedHours(), snapshot.cap),
            optedOut = optedOut,
            noActiveBreak = snapshot.noActiveBreak,
            lastMessage = lastMessage,
        )
    }

    /** The shown day, for the host to drive [previewDrag] without re-reading state. */
    fun currentDay(): BreakCalendarDay = _uiState.value.day

    fun selectWeek(index: Int) {
        weekIndex = index.coerceIn(0, weekMondays.size - 1)
        selectedDayIndex = defaultDayIndex(weekIndex)
        lastMessage = null
        _uiState.value = build()
    }

    fun selectDay(index: Int) {
        selectedDayIndex = index.coerceIn(0, 6)
        lastMessage = null
        _uiState.value = build()
    }

    /** Plan a drag over blocks [fromIndex..toIndex] of the shown day (for the confirm sheet). */
    fun previewDrag(
        fromIndex: Int,
        toIndex: Int,
    ): BreakDragPlan = planBreakDrag(snapshot, _uiState.value.day, fromIndex, toIndex)

    /**
     * Commit [plan] optimistically (one open seat per claimable block flips to mine) and
     * return the block ids to send to the live `break-claim` drag write. Empty when opted
     * out / nothing claimable.
     */
    fun commitDrag(plan: BreakDragPlan): List<String> {
        if (optedOut || !plan.claimable) return emptyList()
        snapshot = applyBreakDrag(snapshot, plan)
        lastMessage = plan.message
        _uiState.value = build()
        return plan.claimableBlockIds
    }

    /** Fold the server's actual claim back in — revert any optimistic seat it didn't take. */
    fun reconcileClaim(claimedAssignmentIds: List<String>) {
        snapshot = reconcileBreakClaim(snapshot, claimedAssignmentIds.toSet())
        _uiState.value = build()
    }

    /** Optimistically drop my seats [seatIds] back to the pool (server drop via drop-shift). */
    fun drop(seatIds: List<String>) {
        snapshot = applyBreakDrop(snapshot, seatIds.toSet())
        lastMessage = null
        _uiState.value = build()
    }

    /** Flip the §4.4 "no break hours" opt-out (the live write is the host's concern). */
    fun toggleOptedOut(): Boolean {
        optedOut = !optedOut
        _uiState.value = build()
        return optedOut
    }

    // Default to the week containing `now` if the window straddles it, else the first week.
    private fun defaultWeekIndex(): Int {
        val today = nowDate()
        val idx = weekMondays.indexOfLast { it <= today }
        return idx.coerceIn(0, weekMondays.size - 1)
    }

    // Default the day to the first in-window day of the shown week (the strip's first dot).
    private fun defaultDayIndex(week: Int): Int {
        val strip = breakWeekStrip(snapshot, weekMondays[week], now)
        return strip.firstOrNull { it.inWindow }?.index ?: 0
    }

    private fun nowDate(): LocalDate = now.toLocalDateTime(NEW_YORK).date
}
