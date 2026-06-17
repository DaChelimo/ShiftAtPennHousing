package com.pennhousing.shift.shared.viewmodel

import androidx.lifecycle.ViewModel
import com.pennhousing.shift.shared.calendar.WeekDayCell
import com.pennhousing.shift.shared.calendar.buildCalendarWeek
import com.pennhousing.shift.shared.calendar.shiftWeekAnchor
import com.pennhousing.shift.shared.calendar.weekDayIndexInWeekOf
import com.pennhousing.shift.shared.house.HouseSeat
import com.pennhousing.shift.shared.model.AssignmentKind
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.shifts.NEW_YORK
import com.pennhousing.shift.shared.shifts.coalesceMyShifts
import com.pennhousing.shift.shared.shifts.formatDayLabel
import com.pennhousing.shift.shared.shifts.formatDuration
import com.pennhousing.shift.shared.shifts.formatTimeRange
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.minus
import kotlinx.datetime.toLocalDateTime
import com.pennhousing.shift.shared.swaps.SwapDay
import com.pennhousing.shift.shared.swaps.SwapDayCard
import com.pennhousing.shift.shared.swaps.SwapKind
import com.pennhousing.shift.shared.swaps.SwapProposal
import com.pennhousing.shift.shared.swaps.asCandidate
import com.pennhousing.shift.shared.swaps.buildHandoffProposal
import com.pennhousing.shift.shared.swaps.buildSwapDay
import com.pennhousing.shift.shared.swaps.buildSwapProposal
import com.pennhousing.shift.shared.swaps.swapWeekDaysWithShifts
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.time.Instant

data class SwapCalendarUiState(
    val weekOffset: Int,
    val weekRange: String, // "Jun 22 – 28"
    val weekRelative: String, // "This week" / "Next week" / "Last week" / "In 2 weeks"
    /** The shown week's NY anchor — the host passes it to `fetchHouseScheduleForWeek`. */
    val anchor: Instant,
    val days: List<WeekDayCell>, // Mon–Sun strip (date + today)
    val daysWithShifts: Set<Int>, // strip dots
    val selectedDayIndex: Int,
    val day: SwapDay, // the selected day's give (mine) + take (others) cards
    val give: SwapDayCard?, // pinned "give" (persists across week navigation)
    val take: SwapDayCard?, // pinned "take"
    val permanent: Boolean,
    val permanentToggleVisible: Boolean, // give is a SCHEDULED shift + a take is picked
    /** Hand-off mode (§8.5): give-only — the worker hands their shift to the picked person, who gives nothing back. */
    val handoff: Boolean,
    val canPropose: Boolean,
    val summary: String?, // bottom-bar copy for the forming swap
    /** True while the host is (re)fetching this week's house grid — "take" cards are absent until it lands. */
    val loadingWeek: Boolean,
)

/**
 * Calendar swap ViewModel (CALENDAR_REDESIGN.md §3) — the week-paged give/take selection
 * engine both front ends render. A thin `StateFlow` wrapper over the pure `swaps/`
 * `calendar/` builders, in the [CalendarViewModel] shape (synchronous, no `viewModelScope`;
 * `now` injected once). Week + anchor logic lives HERE (Kotlin) so the native UIs never
 * bridge `kotlin.time.Instant`; they just render state and call methods.
 *
 * Data flow: the worker's own shifts (give) come from the date-unbounded [myShifts]
 * snapshot, so all weeks are present. Housemates' shifts (take) are per-week: on every
 * week change the host fetches that week's grid (`fetchHouseScheduleForWeek(anchor)`) and
 * calls [setWeekSeats]; until then [SwapCalendarUiState.loadingWeek] is true. The pinned
 * give/take persist across navigation, so "give my Saturday ↔ take Ben's next-Tuesday"
 * is two taps across two weeks. Whole-run swaps in v1 (partial sub-ranges + multi-leg +
 * one-sided handoff land in follow-up slices); the server stays authoritative for §8.
 */
class SwapCalendarViewModel(
    private val myShifts: List<MyShift>,
    private val meUserId: String,
    private val now: Instant,
    private val breakProfile: Boolean = false,
    initialGiveShiftId: String? = null,
) : ViewModel() {
    private val coalescedMine = coalesceMyShifts(myShifts).filter { !it.droppedStillOpen }
    private var weekOffset = 0
    private var selectedDay = 0
    private var weekSeats: List<HouseSeat> = emptyList()
    private var seatsForOffset: Int? = null // which weekOffset weekSeats belong to
    private var give: SwapDayCard? = null
    private var giveShift: MyShift? = null
    private var take: SwapDayCard? = null
    private var permanent = false
    private var handoff = false

    init {
        val pre = initialGiveShiftId?.let { id -> coalescedMine.firstOrNull { it.id == id } }
        if (pre != null) {
            giveShift = pre
            give = cardFor(pre)
            weekOffset = weekOffsetOf(pre.start)
            selectedDay = weekDayIndexInWeekOf(pre.start, shiftWeekAnchor(now, weekOffset)) ?: 0
        } else {
            val wk = buildCalendarWeek(myShifts, now, anchor = shiftWeekAnchor(now, 0))
            selectedDay = if (wk.todayIndex >= 0) wk.todayIndex else 0
        }
    }

    private val _uiState = MutableStateFlow(snapshot())
    val uiState: StateFlow<SwapCalendarUiState> = _uiState.asStateFlow()

    /** Whole NY weeks from [now]'s week to [target]'s week (0 = same, 1 = next, -1 = last). */
    private fun weekOffsetOf(target: Instant): Int {
        fun monday(i: Instant) =
            i.toLocalDateTime(NEW_YORK).date.let { d -> d.minus(d.dayOfWeek.ordinal, DateTimeUnit.DAY) }
        return ((monday(target).toEpochDays() - monday(now).toEpochDays()) / 7).toInt()
    }

    private fun cardFor(s: MyShift): SwapDayCard =
        SwapDayCard(
            userId = meUserId,
            workerName = "You",
            isMine = true,
            seatIds = s.blockIds,
            start = s.start,
            end = s.end,
            timeLabel = formatTimeRange(s.start, s.end),
            durationLabel = formatDuration(s.start, s.end),
            dayLabel = formatDayLabel(s.start),
            permanentEligible = !breakProfile && s.kind == AssignmentKind.SCHEDULED,
            isFloat = s.kind == AssignmentKind.FLOAT_OUT,
        )

    private fun relativeLabel(offset: Int): String =
        when {
            offset == 0 -> "This week"
            offset == 1 -> "Next week"
            offset == -1 -> "Last week"
            offset > 1 -> "In $offset weeks"
            else -> "${-offset} weeks ago"
        }

    private fun summaryLabel(): String? {
        val g = give
        val t = take
        return when {
            g != null && t != null && handoff -> "Hand off ${g.timeLabel} to ${t.workerName} (they give nothing back)"
            g != null && t != null && permanent -> "Swap permanently with ${t.workerName}"
            g != null && t != null -> "Give ${g.timeLabel} ⇄ take ${t.workerName} ${t.timeLabel}"
            else -> null
        }
    }

    private fun snapshot(): SwapCalendarUiState {
        val anchor = shiftWeekAnchor(now, weekOffset)
        val week = buildCalendarWeek(myShifts, now, anchor = anchor)
        val seats = if (seatsForOffset == weekOffset) weekSeats else emptyList()
        // Permanent and hand-off are mutually exclusive; permanent needs a SCHEDULED give.
        val permVisible = give?.permanentEligible == true && take != null && !handoff
        return SwapCalendarUiState(
            weekOffset = weekOffset,
            weekRange = week.rangeLabel,
            weekRelative = relativeLabel(weekOffset),
            anchor = anchor,
            days = week.days,
            daysWithShifts = swapWeekDaysWithShifts(myShifts, seats, meUserId, anchor),
            selectedDayIndex = selectedDay,
            day = buildSwapDay(myShifts, seats, meUserId, selectedDay, anchor, breakProfile),
            give = give,
            take = take,
            permanent = permanent && permVisible,
            permanentToggleVisible = permVisible,
            handoff = handoff && give != null && take != null,
            canPropose = give != null && take != null,
            summary = summaryLabel(),
            loadingWeek = seatsForOffset != weekOffset,
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
        weekOffset = offset
        _uiState.value = snapshot()
    }

    fun previousWeek() = selectWeek(weekOffset - 1)

    fun nextWeek() = selectWeek(weekOffset + 1)

    fun selectDay(index: Int) {
        selectedDay = index
        _uiState.value = snapshot()
    }

    /** Tap a give (own) card — pins it, or unpins if it was already the give. */
    fun pickGive(card: SwapDayCard) {
        if (give?.seatIds == card.seatIds) {
            give = null
            giveShift = null
            permanent = false
        } else {
            give = card
            giveShift = coalescedMine.firstOrNull { it.blockIds == card.seatIds }
            permanent = false
        }
        _uiState.value = snapshot()
    }

    /** Tap a take (housemate) card — pins it, or unpins if it was already the take. */
    fun pickTake(card: SwapDayCard) {
        take = if (take?.userId == card.userId && take?.seatIds == card.seatIds) null else card
        _uiState.value = snapshot()
    }

    fun togglePermanent() {
        if (give?.permanentEligible == true && take != null) {
            permanent = !permanent
            if (permanent) handoff = false // mutually exclusive
            _uiState.value = snapshot()
        }
    }

    /**
     * Hand-off mode (§8.5, give-only): the worker hands their give shift to the picked
     * person, who gives nothing back. Mutually exclusive with permanent. Cap-exempt
     * server-side. The picked take card supplies only the recipient (their shift is ignored).
     */
    fun setHandoff(on: Boolean) {
        handoff = on
        if (on) permanent = false
        _uiState.value = snapshot()
    }

    /**
     * The proposal(s) to POST — whole-run symmetric (or permanent) swap of the pinned
     * give ↔ take. Empty until both are picked. Reuses [buildSwapProposal] so the EF
     * mapping is identical to the legacy sheet. A float give → float_swap.
     */
    fun proposals(): List<SwapProposal> {
        val g = giveShift ?: return emptyList()
        val t = take ?: return emptyList()
        if (handoff) {
            // Give-only one-sided: hand the give shift to the picked person (their shift ignored).
            return listOf(buildHandoffProposal(g, g.blockIds, t.userId))
        }
        val kind =
            when {
                permanent && give?.permanentEligible == true -> SwapKind.PERMANENT
                give?.isFloat == true -> SwapKind.FLOAT
                else -> SwapKind.SHIFT
            }
        return listOf(buildSwapProposal(kind, g, t.asCandidate(), g.blockIds, t.seatIds))
    }
}
