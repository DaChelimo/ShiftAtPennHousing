package com.pennhousing.shift.shared.viewmodel

import androidx.lifecycle.ViewModel
import com.pennhousing.shift.shared.calendar.AgendaSwapMark
import com.pennhousing.shift.shared.calendar.CalendarAgenda
import com.pennhousing.shift.shared.calendar.CalendarWeek
import com.pennhousing.shift.shared.calendar.CalendarWeekOverview
import com.pennhousing.shift.shared.calendar.TemplateSlot
import com.pennhousing.shift.shared.calendar.WeekOption
import com.pennhousing.shift.shared.calendar.buildCalendarAgenda
import com.pennhousing.shift.shared.calendar.buildCalendarWeek
import com.pennhousing.shift.shared.calendar.buildCalendarWeekOverview
import com.pennhousing.shift.shared.calendar.buildTypicalWeek
import com.pennhousing.shift.shared.calendar.shiftWeekAnchor
import com.pennhousing.shift.shared.calendar.shiftsInWeekOf
import com.pennhousing.shift.shared.calendar.weekPickerOptions
import com.pennhousing.shift.shared.model.AssignmentKind
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.model.OpenShift
import com.pennhousing.shift.shared.shifts.PendingWrite
import com.pennhousing.shift.shared.shifts.WeeklyCap
import com.pennhousing.shift.shared.shifts.WeeklyCapSchedule
import com.pennhousing.shift.shared.shifts.applyTemporaryDrop
import com.pennhousing.shift.shared.shifts.coalesceMyShifts
import com.pennhousing.shift.shared.shifts.hoursBetween
import com.pennhousing.shift.shared.shifts.pendingAwareMyShifts
import com.pennhousing.shift.shared.shifts.reclaimDroppedShift
import com.pennhousing.shift.shared.swaps.PendingSwap
import com.pennhousing.shift.shared.swaps.PendingSwapNotice
import com.pennhousing.shift.shared.swaps.SwapBanner
import com.pennhousing.shift.shared.swaps.SwapDecision
import com.pennhousing.shift.shared.swaps.SwapDirection
import com.pennhousing.shift.shared.swaps.buildPendingSwapNotice
import com.pennhousing.shift.shared.swaps.buildSwapBanner
import com.pennhousing.shift.shared.swaps.buildSwapDecision
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.time.Instant

/**
 * WEEK = the whole-week overview (the DEFAULT — every Mon-Sun day's agenda at once);
 * DAY = a single selected day's agenda (the per-day drill-in); TEMPLATE = the derived
 * recurring typical week (D5).
 */
enum class CalendarMode { WEEK, DAY, TEMPLATE }

data class CalendarUiState(
    val week: CalendarWeek,
    val selectedDayIndex: Int,
    /** The selected day's agenda — the DAY view, and the drill-in target from the overview. */
    val agenda: CalendarAgenda,
    /** Every Mon-Sun day's agenda — populated only in [CalendarMode.WEEK]. */
    val weekOverview: CalendarWeekOverview? = null,
    /** Weeks from the current one (0 = this week) — drives the header label (T3b-4). */
    val weekOffset: Int = 0,
    val mode: CalendarMode = CalendarMode.WEEK,
    val template: List<TemplateSlot> = emptyList(),
    /** Held hours in the SHOWN week — the "This week — Xh of cap" chip total (now lives on this tab). */
    val weekHours: Double = 0.0,
    /** The SHOWN week's server cap, for the hours chip. Follows [weekOffset]. */
    val weekCap: WeeklyCap = WeeklyCap.FALLBACK,
    /**
     * Pending swaps surfaced at the top of My Shifts, both directions (BSpec §10.1).
     * NOT week-scoped: a request that needs an answer must be visible whatever week the
     * worker happens to be looking at. See swaps/SwapBanner.kt.
     */
    val swapBanner: SwapBanner = SwapBanner(emptyList()),
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
    myShifts: List<MyShift>,
    private val now: Instant,
    // Mon..Sun indexes the worker's HOME house is closed (§3.4/§11.3) — the host
    // resolves them via the `house_closure` RPC for the CURRENT week; navigated
    // weeks render without the closed treatment (no per-week closure data).
    private val closedDayIndexes: Set<Int> = emptySet(),
    // The worker's pending swaps (both directions) from `worker_pending_swaps`; a shift
    // card whose blocks appear here is flagged, and an incoming card taps into the popup.
    pendingSwaps: List<PendingSwap> = emptyList(),
    // Writes the worker started that the server has not answered (shifts/PendingWrites.kt).
    // Live only; the demo path keeps its optimistic [drop]/[claim] moves.
    private val pendingWrites: List<PendingWrite> = emptyList(),
    // Per-week server caps (`effective_weekly_caps`), so the hours chip names the SHOWN
    // week's real cap. Mirrors ShiftsScreenViewModel; both read the same snapshot field.
    private val weeklyCaps: WeeklyCapSchedule = WeeklyCapSchedule.PENDING,
) : ViewModel() {
    // Mutable: an optimistic [drop] flags blocks dropped-still-open so they leave the
    // agenda (the builders exclude them); the open feed gains them on the Shifts VM.
    private var workerShifts: List<MyShift> = myShifts
    private var weekOffset = 0

    // Mutable so accepting/declining an incoming swap optimistically un-tints its card
    // ([resolveSwap]); the live host additionally refetches to reconcile to server truth.
    private var swaps: List<PendingSwap> = pendingSwaps

    // assignment_id → swap mark (incoming preferred). Recomputed per snapshot from [swaps]
    // (a small list); an incoming card's [AgendaSwapMark.swapId] opens [decisionFor].
    private fun swapMarks(): Map<String, AgendaSwapMark> =
        swaps
            // Outgoing first, incoming last: toMap keeps the LAST entry, so an incoming
            // (actionable) mark wins a same-assignment clash with an outgoing one.
            .sortedBy { it.direction == SwapDirection.INCOMING }
            .flatMap { s -> s.myAssignmentIds.map { id -> id to AgendaSwapMark(s.swapId, s.direction == SwapDirection.INCOMING) } }
            .toMap()

    // The derived recurring typical week (D5) — computed once from the snapshot.
    // Declared BEFORE _uiState: snapshot() runs inside _uiState's initializer.
    private val template: List<TemplateSlot> by lazy { buildTypicalWeek(workerShifts) }
    private var mode = CalendarMode.WEEK

    private val _uiState = MutableStateFlow(snapshot(buildWeek().todayIndex))
    val uiState: StateFlow<CalendarUiState> = _uiState.asStateFlow()

    private fun closedFor(offset: Int): Set<Int> = if (offset == 0) closedDayIndexes else emptySet()

    /**
     * The shifts the calendar draws: the snapshot projected through any in-flight write,
     * so a claim being written block by block does not assemble itself in the agenda and
     * a shift being dropped stays put (busy) until the server confirms it is gone.
     */
    private fun visibleShifts(): List<MyShift> = pendingAwareMyShifts(workerShifts, pendingWrites)

    private fun buildWeek(): CalendarWeek =
        buildCalendarWeek(
            visibleShifts(),
            now,
            closedDayIndexes = closedFor(weekOffset),
            anchor = shiftWeekAnchor(now, weekOffset),
        )

    private fun snapshot(dayIndex: Int): CalendarUiState {
        val week = buildWeek()
        val day = dayIndex.coerceIn(0, week.days.size - 1)
        val anchor = shiftWeekAnchor(now, weekOffset)
        val closed = closedFor(weekOffset)
        val shown = visibleShifts()
        return CalendarUiState(
            week = week,
            selectedDayIndex = day,
            agenda = buildCalendarAgenda(shown, day, now, closedDayIndexes = closed, anchor = anchor, swapMarks = swapMarks()),
            weekOverview =
                if (mode == CalendarMode.WEEK) {
                    buildCalendarWeekOverview(shown, now, closedDayIndexes = closed, anchor = anchor, swapMarks = swapMarks())
                } else {
                    null
                },
            weekOffset = weekOffset,
            mode = mode,
            template = if (mode == CalendarMode.TEMPLATE) template else emptyList(),
            // Held hours in the shown week (dropped-still-open blocks don't count) —
            // mirrors ShiftsScreenViewModel.weekHours so the chip reads the same total.
            weekHours = shiftsInWeekOf(shown, anchor).filter { !it.droppedStillOpen }.sumOf { hoursBetween(it.start, it.end) },
            weekCap = weeklyCaps.capAt(anchor),
            // The always-on swap banner (BSpec §10.1): what is waiting on this worker and
            // what this worker is waiting on, from the same `swaps` the card marks use.
            swapBanner = buildSwapBanner(swaps, now),
        )
    }

    /**
     * The accept/decline popup model for a tapped INCOMING-swap card ([AgendaSwapMark.swapId]).
     * Null when the id isn't an incoming pending swap (outgoing cards aren't actionable here).
     */
    fun decisionFor(swapId: String): SwapDecision? =
        swaps
            .firstOrNull { it.swapId == swapId && it.direction == SwapDirection.INCOMING }
            ?.let { buildSwapDecision(it) }

    /**
     * The "swap pending" notice for a tapped OUTGOING-swap card ([AgendaSwapMark.swapId]) —
     * shown instead of the drop sheet, since the shift is tied up in a swap the worker
     * proposed (dropping/swapping it would fail server-side). Null when the id isn't an
     * outgoing pending swap (incoming cards open the accept/decline popup via [decisionFor]).
     * Cancelling from the notice calls [resolveSwap] (optimistic un-tint) + the host's `void-swap`.
     */
    fun pendingSwapNoticeFor(swapId: String): PendingSwapNotice? =
        swaps
            .firstOrNull { it.swapId == swapId && it.direction == SwapDirection.OUTGOING }
            ?.let { buildPendingSwapNotice(it) }

    /**
     * The worker's own assignment ids tied up in ANY pending swap (either direction) — what
     * the swap-calendar picker uses to drop already-pending shifts from the "give" pool, so a
     * second proposal on the same shift can't be started (and fail server-side). See
     * [SwapCalendarViewModel].
     */
    fun pendingGiveAssignmentIds(): Set<String> = swaps.flatMap { it.myAssignmentIds }.toSet()

    /**
     * Optimistically drop a swap from the calendar after the worker accepts/declines it
     * (or cancels an outgoing one) — its card un-tints immediately. Idempotent; the live
     * host also refetches `worker_pending_swaps` to reconcile.
     */
    fun resolveSwap(swapId: String) {
        val remaining = swaps.filterNot { it.swapId == swapId }
        if (remaining.size == swaps.size) return
        swaps = remaining
        _uiState.value = snapshot(_uiState.value.selectedDayIndex)
    }

    /** Drill into a single day (the per-day view) — switches out of the week overview. */
    fun selectDay(index: Int) {
        mode = CalendarMode.DAY
        _uiState.value = snapshot(index)
    }

    /**
     * Resolve a tapped agenda card (its coalesced display id) back to the underlying
     * [MyShift] — what the drop/swap sheets operate on. Null if the id no longer
     * matches a held shift (e.g. it was just dropped).
     */
    fun shiftForCard(cardId: String): MyShift? = coalesceMyShifts(workerShifts).firstOrNull { it.id == cardId }

    /**
     * Optimistic drop from the agenda: flag the given blocks dropped-still-open so they
     * leave the calendar (the builders exclude them) and the shown-week hours drop. The
     * shift becomes a vacant opening on the Shifts VM ([ShiftsScreenViewModel.dropToOpen]);
     * there is no reclaim — re-picking it up is a normal claim from the open feed.
     */
    fun drop(blockIds: List<String>) {
        workerShifts = applyTemporaryDrop(workerShifts, blockIds.toSet())
        _uiState.value = snapshot(_uiState.value.selectedDayIndex)
    }

    /**
     * Optimistic claim reflected in the agenda — the mirror of [drop], so "My Shifts"
     * (this calendar) shows what the worker now holds. Re-picking up a shift dropped
     * here un-hides it (reverse of [drop]); a fresh pickup is added as a this-week
     * TEMP_PICKUP (cross-house iff not the home house). Keeps the two view models — the
     * calendar and the open-shifts VM — consistent without a server round-trip.
     */
    fun claim(shift: OpenShift) {
        val ids = shift.blockIds.toSet()
        workerShifts =
            if (workerShifts.any { it.id in ids && it.droppedStillOpen }) {
                reclaimDroppedShift(workerShifts, ids)
            } else {
                workerShifts +
                    MyShift(
                        id = shift.id,
                        house = shift.house,
                        start = shift.start,
                        end = shift.end,
                        kind = AssignmentKind.TEMP_PICKUP,
                        crossHouse = !shift.homeHouse,
                        blockIds = shift.blockIds,
                    )
            }
        _uiState.value = snapshot(_uiState.value.selectedDayIndex)
    }

    /** Return to the whole-week overview (the default view), keeping the selected day. */
    fun showWeek() {
        mode = CalendarMode.WEEK
        _uiState.value = snapshot(_uiState.value.selectedDayIndex)
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
        // Navigating dated weeks exits the derived template; WEEK/DAY granularity is kept.
        if (mode == CalendarMode.TEMPLATE) mode = CalendarMode.WEEK
        weekOffset = offset
        val week = buildWeek()
        _uiState.value = snapshot(if (week.todayIndex >= 0) week.todayIndex else 0)
    }
}
