package com.pennhousing.shift.shared.viewmodel

import androidx.lifecycle.ViewModel
import com.pennhousing.shift.shared.calendar.WeekOption
import com.pennhousing.shift.shared.calendar.buildCalendarWeek
import com.pennhousing.shift.shared.calendar.shiftWeekAnchor
import com.pennhousing.shift.shared.calendar.shiftsInWeekOf
import com.pennhousing.shift.shared.calendar.weekPickerOptions
import com.pennhousing.shift.shared.model.AssignmentKind
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.model.OpenFeed
import com.pennhousing.shift.shared.model.OpenShift
import com.pennhousing.shift.shared.shifts.ClaimCapVerdict
import com.pennhousing.shift.shared.shifts.DropOptions
import com.pennhousing.shift.shared.shifts.DropPlan
import com.pennhousing.shift.shared.shifts.HomeOpenShiftsTab
import com.pennhousing.shift.shared.shifts.MyShiftsTab
import com.pennhousing.shift.shared.shifts.OpenShiftSplit
import com.pennhousing.shift.shared.shifts.OtherHousesTab
import com.pennhousing.shift.shared.shifts.applyTemporaryDrop
import com.pennhousing.shift.shared.shifts.buildHomeOpenShiftsTab
import com.pennhousing.shift.shared.shifts.buildMyShiftsTab
import com.pennhousing.shift.shared.shifts.buildOtherHousesTab
import com.pennhousing.shift.shared.shifts.coalesceMyShifts
import com.pennhousing.shift.shared.shifts.coalesceOpenShifts
import com.pennhousing.shift.shared.shifts.PartialClaimPlan
import com.pennhousing.shift.shared.shifts.PartialDropPlan
import com.pennhousing.shift.shared.shifts.blockIndexAt
import com.pennhousing.shift.shared.shifts.dropOptionsFor
import com.pennhousing.shift.shared.shifts.evaluateClaimCap
import com.pennhousing.shift.shared.shifts.hoursBetween
import com.pennhousing.shift.shared.shifts.isClaimable
import com.pennhousing.shift.shared.shifts.openShiftsInWeekOf
import com.pennhousing.shift.shared.shifts.planPartialClaim
import com.pennhousing.shift.shared.shifts.planPartialDrop
import com.pennhousing.shift.shared.shifts.planTemporaryDrop
import com.pennhousing.shift.shared.shifts.reclaimDroppedShift
import com.pennhousing.shift.shared.shifts.splitPastOpenShifts
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.time.Instant

enum class ShiftsTab { MY_SHIFTS, OPEN_HOME, OPEN_OTHER }

data class ShiftsUiState(
    val selectedTab: ShiftsTab,
    val myShifts: MyShiftsTab,
    val homeOpen: HomeOpenShiftsTab,
    val otherHouses: OtherHousesTab,
    /** Weeks from the current one (0 = this week) — drives the My-Shifts week header. */
    val weekOffset: Int = 0,
    /** "Jun 8 – Jun 14" — the shown week's range, for the week header subtitle. */
    val weekRangeLabel: String = "",
    /** The held hours in the SHOWN week (the "This week — Xh" chip total). */
    val weekHours: Double = 0.0,
    /**
     * Weeks from the current one (0 = this week) — drives the Open-Shifts week header,
     * INDEPENDENT of [weekOffset]. The open feeds ([homeOpen]/[otherHouses]) are scoped to
     * this week so a worker browses one Mon–Sun at a time (last week through +4).
     */
    val openWeekOffset: Int = 0,
    /** "Jun 8 – Jun 14" — the Open-Shifts shown week's range, for its week header. */
    val openWeekRangeLabel: String = "",
)

/**
 * Phase 13a — the Shifts-screen ViewModel (BEHAVIORAL_SPECIFICATION.md §5.6).
 *
 * A thin `StateFlow` wrapper over the pure `shifts/` decision surface, in the
 * shape of the existing [MainViewModel]: it constructs and emits synchronously
 * (no `viewModelScope`, no launched coroutines), so it runs on the JVM host test
 * target without an Android runtime (tests/PHASE_13a/TEST_PLAN.md). `now` is the
 * screen's load instant, injected once at construction (decision #17).
 *
 * The data layer (Supabase fetch + Realtime, see `data/`) constructs the
 * snapshot; this ViewModel only decides over it. `drop`/`reclaim` are optimistic
 * local section moves (decision #13); server reconciliation is out of scope.
 *
 * Week navigation: the My-Shifts tab is scoped to [weekOffset]'s NY week (0 = this
 * week). [previousWeek]/[nextWeek]/[selectWeekOffset] move the shown week so a
 * worker can see a pickup or drop that lands in a future week — the underlying
 * `worker_my_shifts` read is date-unbounded, so those weeks' shifts are already in
 * the snapshot (the same pattern the Personal-Calendar VM uses). The OPEN-shift
 * feeds (Tabs 2/3) are NOT week-scoped — claiming is always for the current week.
 */
class ShiftsScreenViewModel(
    myShifts: List<MyShift>,
    openShifts: List<OpenShift>,
    private val now: Instant,
    initialTab: ShiftsTab = ShiftsTab.MY_SHIFTS,
) : ViewModel() {
    private var workerShifts: List<MyShift> = myShifts
    private var openFeed: List<OpenShift> = openShifts
    private var weekOffset = 0
    private var openWeekOffset = 0

    private val _uiState = MutableStateFlow(snapshot(initialTab))
    val uiState: StateFlow<ShiftsUiState> = _uiState.asStateFlow()

    private fun snapshot(tab: ShiftsTab): ShiftsUiState {
        // The stores stay PER-BLOCK (the live read models are one row per 30-min
        // block); coalescing at presentation time merges each contiguous same-shift
        // run into one displayed card carrying its constituent blockIds.
        val anchor = shiftWeekAnchor(now, weekOffset)
        // My Shifts is scoped to its shown week; the open feeds are scoped to THEIR own
        // (independent) week so a worker browses one Mon–Sun at a time — permanent openings
        // recur and pass through every week (see openShiftsInWeekOf).
        val weekShifts = shiftsInWeekOf(workerShifts, anchor)
        val openAnchor = shiftWeekAnchor(now, openWeekOffset)
        val weekOpen = openShiftsInWeekOf(coalesceOpenShifts(openFeed), openAnchor)
        return ShiftsUiState(
            selectedTab = tab,
            myShifts = buildMyShiftsTab(coalesceMyShifts(weekShifts)),
            homeOpen = buildHomeOpenShiftsTab(weekOpen),
            otherHouses = buildOtherHousesTab(weekOpen),
            weekOffset = weekOffset,
            weekRangeLabel = buildCalendarWeek(emptyList(), now, anchor = anchor).rangeLabel,
            // Held hours in the shown week (dropped-still-open blocks no longer count),
            // mirroring `weeklyHours` but for the navigated week.
            weekHours = weekShifts.filter { !it.droppedStillOpen }.sumOf { hoursBetween(it.start, it.end) },
            openWeekOffset = openWeekOffset,
            openWeekRangeLabel = buildCalendarWeek(emptyList(), now, anchor = openAnchor).rangeLabel,
        )
    }

    fun selectTab(tab: ShiftsTab) {
        // Tab data is unchanged by selection — only the selected tab moves.
        _uiState.value = _uiState.value.copy(selectedTab = tab)
    }

    /** Show the previous/next week's My-Shifts (the open feeds stay current). */
    fun previousWeek() = selectWeek(weekOffset - 1)

    fun nextWeek() = selectWeek(weekOffset + 1)

    /** The week-picker sheet's absolute pick (last / this / next / +2 / +3). */
    fun selectWeekOffset(offset: Int) = selectWeek(offset)

    /** The quick weeks the picker sheet offers (label + range per offset). */
    fun weekOptions(): List<WeekOption> = weekPickerOptions(now)

    private fun selectWeek(offset: Int) {
        weekOffset = offset
        _uiState.value = snapshot(_uiState.value.selectedTab)
    }

    /** Show the previous/next week's OPEN feeds (independent of the My-Shifts week). */
    fun previousOpenWeek() = selectOpenWeek(openWeekOffset - 1)

    fun nextOpenWeek() = selectOpenWeek(openWeekOffset + 1)

    /** The Open-Shifts week-picker absolute pick. */
    fun selectOpenWeekOffset(offset: Int) = selectOpenWeek(offset)

    /**
     * The weeks the Open-Shifts picker offers: last week through +4 (a UI guardrail so a
     * worker can't claim a shift weeks out and forget it). Applies to BOTH sub-tabs.
     */
    fun openWeekOptions(): List<WeekOption> = weekPickerOptions(now, offsets = listOf(-1, 0, 1, 2, 3, 4))

    private fun selectOpenWeek(offset: Int) {
        openWeekOffset = offset
        _uiState.value = snapshot(_uiState.value.selectedTab)
    }

    /**
     * Split an open feed into upcoming (live) vs already-started (collapsed greyed card).
     * The UI hands the SHOWN-week feed (e.g. `homeOpen.weekly` or `otherHouses.openShifts`);
     * permanent openings never count as past, so they stay in [OpenShiftSplit.upcoming].
     */
    fun pastUpcoming(openShifts: List<OpenShift>): OpenShiftSplit = splitPastOpenShifts(openShifts, now)

    fun claimable(shift: OpenShift): Boolean = isClaimable(shift, now)

    fun claimCap(
        shift: OpenShift,
        currentWeeklyHours: Double,
        breakProfile: Boolean,
    ): ClaimCapVerdict = evaluateClaimCap(currentWeeklyHours, hoursBetween(shift.start, shift.end), breakProfile)

    fun dropOptions(
        shift: MyShift,
        breakProfile: Boolean,
    ): DropOptions = dropOptionsFor(shift, breakProfile)

    fun planDrop(
        shift: MyShift,
        dropFromNow: Boolean,
    ): DropPlan = planTemporaryDrop(shift, dropFromNow, now)

    /** §5.2 partial drop: plan blocks [fromBlock, toBlock) of the displayed card. */
    fun planDropRange(
        shift: MyShift,
        fromBlock: Int,
        toBlock: Int,
    ): PartialDropPlan = planPartialDrop(shift, fromBlock, toBlock, now)

    /** The block index containing `now` (mid-shift "drop from now"), or null. */
    fun dropFromNowIndex(shift: MyShift): Int? = blockIndexAt(shift, now)

    /** §5.3 partial claim (T2-10): plan blocks [fromBlock, toBlock) of an open card. */
    fun planClaimRange(
        shift: OpenShift,
        fromBlock: Int,
        toBlock: Int,
    ): PartialClaimPlan = planPartialClaim(shift, fromBlock, toBlock)

    /**
     * Optimistic local pickup: move an open shift into the worker's week as a
     * this-week TEMP_PICKUP (cross-house iff it is not the home house). The server
     * write (§5.3) is out of scope here, exactly as `drop`/`reclaim` are optimistic
     * local section moves (decision #13). The pure decision surface still gates it
     * via [claimable] / [claimCap] in the UI before this is called.
     */
    fun claim(shift: OpenShift) {
        // [shift] is the DISPLAYED (coalesced) card: its blockIds cover every
        // constituent vacant block, so all of them leave the feed and the picked-up
        // span carries them for the live per-block claim writes.
        val claimedIds = shift.blockIds.toSet()
        val picked =
            MyShift(
                id = shift.id,
                house = shift.house,
                start = shift.start,
                end = shift.end,
                kind = AssignmentKind.TEMP_PICKUP,
                crossHouse = !shift.homeHouse,
                blockIds = shift.blockIds,
            )
        workerShifts = workerShifts + picked
        openFeed = openFeed.filterNot { it.id in claimedIds }
        _uiState.value = snapshot(_uiState.value.selectedTab)
    }

    fun drop(shiftId: String) {
        workerShifts = applyTemporaryDrop(workerShifts, displayedBlockIds(shiftId))
        _uiState.value = snapshot(_uiState.value.selectedTab)
    }

    /**
     * A shift dropped from the calendar becomes a vacant opening: add it to the open
     * feed so it surfaces in the Open-Shifts tabs and the worker (or anyone) can claim
     * it — partial or full — like any other open shift. The shift leaves the calendar
     * agenda via [CalendarViewModel.drop]; there is no "reclaim" affordance any more (a
     * dropped shift is just an open shift). A home-house shift opens in Tab 2, a
     * cross-house one in Tab 3 ([OpenShift.homeHouse] = !crossHouse).
     */
    fun dropToOpen(shift: MyShift) {
        openFeed =
            openFeed +
            OpenShift(
                id = shift.id,
                house = shift.house,
                start = shift.start,
                end = shift.end,
                feed = OpenFeed.WEEKLY,
                homeHouse = !shift.crossHouse,
                blockIds = shift.blockIds,
            )
        _uiState.value = snapshot(_uiState.value.selectedTab)
    }

    /**
     * §5.2 partial drop: flag only the selected blocks; the remaining blocks
     * re-coalesce into their own card(s) (a middle drop leaves two), and the
     * dropped run re-coalesces into one dropped-still-open card.
     */
    fun dropBlocks(blockIds: List<String>) {
        workerShifts = applyTemporaryDrop(workerShifts, blockIds.toSet())
        _uiState.value = snapshot(_uiState.value.selectedTab)
    }

    fun reclaim(shiftId: String) {
        workerShifts = reclaimDroppedShift(workerShifts, displayedBlockIds(shiftId))
        _uiState.value = snapshot(_uiState.value.selectedTab)
    }

    /**
     * Resolve a displayed card id to the block ids it covers: the UI hands back the
     * coalesced card's id (its first block), but the store is per-block, so the
     * optimistic move must flag every constituent row. An id with no coalesced match
     * (already a single block) falls back to itself.
     */
    private fun displayedBlockIds(shiftId: String): Set<String> =
        coalesceMyShifts(workerShifts).firstOrNull { it.id == shiftId }?.blockIds?.toSet() ?: setOf(shiftId)
}
