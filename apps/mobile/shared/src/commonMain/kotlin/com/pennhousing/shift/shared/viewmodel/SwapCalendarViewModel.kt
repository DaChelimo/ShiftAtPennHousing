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
import com.pennhousing.shift.shared.swaps.BlockRange
import com.pennhousing.shift.shared.swaps.HandoffDirectory
import com.pennhousing.shift.shared.swaps.HandoffWorker
import com.pennhousing.shift.shared.swaps.ReservedRun
import com.pennhousing.shift.shared.swaps.buildHandoffDirectory
import com.pennhousing.shift.shared.swaps.SwapCandidate
import com.pennhousing.shift.shared.swaps.SwapDay
import com.pennhousing.shift.shared.swaps.SwapDayCard
import com.pennhousing.shift.shared.swaps.SwapKind
import com.pennhousing.shift.shared.swaps.SwapLeg
import com.pennhousing.shift.shared.swaps.SwapProposal
import com.pennhousing.shift.shared.swaps.SwapSegment
import com.pennhousing.shift.shared.swaps.asCandidate
import com.pennhousing.shift.shared.swaps.buildHandoffProposal
import com.pennhousing.shift.shared.swaps.buildSwapDay
import com.pennhousing.shift.shared.swaps.buildSwapProposal
import com.pennhousing.shift.shared.swaps.buildSwapProposals
import com.pennhousing.shift.shared.swaps.buildSwapSegments
import com.pennhousing.shift.shared.swaps.enclosingFreeRun
import com.pennhousing.shift.shared.swaps.firstFreeRange
import com.pennhousing.shift.shared.swaps.planSwapSpan
import com.pennhousing.shift.shared.swaps.swapWeekDaysWithShifts
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.time.Instant

data class SwapCalendarUiState(
    val weekOffset: Int,
    val weekRange: String, // "Jun 22 - 28"
    val weekRelative: String, // "This week" / "Next week" / "Last week" / "In 2 weeks"
    /** The shown week's NY anchor — the host passes it to `fetchHouseScheduleForWeek`. */
    val anchor: Instant,
    val days: List<WeekDayCell>, // Mon-Sun strip (date + today)
    val daysWithShifts: Set<Int>, // strip dots
    val selectedDayIndex: Int,
    val day: SwapDay, // the selected day's give (mine) + take (others) cards
    val give: SwapDayCard?, // pinned "give" (persists across week navigation)
    val take: SwapDayCard?, // pinned "take"
    val permanent: Boolean,
    val permanentToggleVisible: Boolean, // give is a SCHEDULED shift + a take is picked
    /** Hand-off mode (§8.5): give-only — the worker hands their shift to the picked person, who gives nothing back. */
    val handoff: Boolean,
    /** Hand-off recipient directory (§8.5): My House (flat) + Others (grouped, searchable) — eligible workers only. */
    val handoffDirectory: HandoffDirectory,
    /** The live "Others" search text (worker / house name). */
    val handoffQuery: String,
    /** The picked hand-off recipient (a directory worker), or null until one is tapped. */
    val recipient: HandoffWorker?,
    val canPropose: Boolean,
    /** The forming swap as a two-sided "deal" card (give ⇄ take) at the top of the sheet. */
    val deal: SwapDeal?,
    // ── partial-hour sub-ranges (§8.1) — progressive disclosure; whole-shift by default ──
    /** Whether the give / take shifts can be split (>1 block) — gates the "adjust hours" affordance. */
    val giveSplittable: Boolean,
    val takeSplittable: Boolean,
    /** The CURRENT leg's give sub-range over the give shift's 30-min grid ([from, to) indices). */
    val giveFrom: Int,
    val giveTo: Int,
    /** The CURRENT leg's take sub-range over the take shift's grid. */
    val takeFrom: Int,
    val takeTo: Int,
    val giveBlockCount: Int,
    val takeBlockCount: Int,
    // ── multi-person independent legs (one create-swap each) ──
    /** Committed legs (give part A ⇄ B with one person, part C ⇄ D with another). */
    val legs: List<SwapLegChip>,
    /** The current leg can be banked and another person added (a leg is ready AND give hours remain free). */
    val canAddLeg: Boolean,
    // ── segmented give/take timeline (locked zones; AGENTS two-budget rule) ──
    /**
     * The give shift split into FREE / LOCKED (already given to another leg) / ACTIVE runs.
     * Empty until a give is pinned; once a leg is banked, the locked runs render greyed with
     * the receiver's name so a fragmented shift reads as one day.
     */
    val giveSegments: List<SwapSegment>,
    /** The picked counterparty shift split the same way (LOCKED = already taken in another leg). */
    val takeSegments: List<SwapSegment>,
    /** The FREE run the give handles live in — the slider clamps to [giveRunFrom, giveRunTo]. */
    val giveRunFrom: Int,
    val giveRunTo: Int,
    /** The FREE run the take handles live in. */
    val takeRunFrom: Int,
    val takeRunTo: Int,
    /**
     * After banking a leg, a one-tap "give the next free run to the same person too" shortcut
     * (the chosen same-person flow). Null unless a leg is banked, the current leg is fresh
     * (no take yet), give hours remain free, and the last counterparty still has a free block.
     */
    val suggestion: SwapLegSuggestion?,
    /** True while the host is (re)fetching this week's house grid — "take" cards are absent until it lands. */
    val loadingWeek: Boolean,
)

/**
 * The "Give the next part to the same person too" chip (CALENDAR_REDESIGN brainstorm —
 * the chosen flow for assigning two non-contiguous parts of one shift to one person:
 * two independent atomic legs, surfaced as one fluid intent). [acceptSuggestion] re-pins
 * the last counterparty and advances the give to the next free run.
 */
data class SwapLegSuggestion(
    val workerName: String, // "Dan"
    val label: String, // "Give 6:00-8:00pm to Dan too"
)

/**
 * The forming swap rendered as a two-sided "deal" card at the top of the swap sheet
 * (give ⇄ take). Fully resolved so both front ends only lay out strings: the give side
 * is always present (pinned from the tapped shift); the take side stays a muted
 * placeholder until a counterparty is picked. The connector glyph and "Permanent" tag
 * come from [SwapCalendarUiState.handoff] / `permanent`, so each platform draws its own
 * native icon. The give/take detail reflects the CURRENT leg's (possibly partial) hours.
 */
data class SwapDeal(
    val giveTitle: String, // "Sat · Jun 20"
    val giveDetail: String, // "12:00 - 4:00pm · 4h"
    val takeEyebrow: String, // "You take" (swap) / "Hand off to" (hand-off)
    val takeInitial: String?, // counterparty avatar initial — null until a take is picked
    val takeTitle: String?, // "Ben · Tue · Jun 23" (swap) / "Ben" (hand-off) — null until picked
    val takeDetail: String?, // "9:00 - 1:00pm · 4h" / "They give nothing back" — null until picked
    val takePlaceholder: String, // muted prompt shown until a take is picked
)

/** One banked independent leg shown as a chip above the deal card. */
data class SwapLegChip(
    val workerName: String,
    val summary: String, // "give 4:00-6:00pm ⇄ take 9:00-11:00am"
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
 * is two taps across two weeks.
 *
 * Three layers, progressive disclosure:
 *  1. COMMON — tap give, tap take, propose: a single whole-shift leg.
 *  2. PARTIAL (§8.1) — optionally trim the give and/or take to a contiguous sub-range
 *     ([setGiveRange]/[setTakeRange]); the deal card reflects it.
 *  3. MULTI-PERSON — [addLeg] banks the current leg and frees the next run of give hours
 *     for another person; [proposals] fires ONE create-swap per leg (independent — one
 *     failing never affects the others, the 2026-06-15 decision). The server stays
 *     authoritative for §8.
 */
class SwapCalendarViewModel(
    private val myShifts: List<MyShift>,
    private val meUserId: String,
    private val now: Instant,
    private val breakProfile: Boolean = false,
    initialGiveShiftId: String? = null,
    // The worker's own assignment ids already in a pending swap (either direction). Shifts
    // touching them can't be offered again, so they're filtered out of the "give" pool —
    // a worker never picks an already-pending shift as the give (the server would reject it).
    private val pendingGiveAssignmentIds: Set<String> = emptySet(),
    // When the manage-shift sheet opens from the "Swap" intent with the shared scope set to
    // Permanent, the give starts as a permanent swap (still toggleable in the sheet). Honoured
    // only when the pinned give slot is permanent-eligible (SCHEDULED, non-break); otherwise
    // ignored, so a non-eligible give never opens in an impossible permanent state.
    initialPermanent: Boolean = false,
) : ViewModel() {
    private val coalescedMine =
        coalesceMyShifts(myShifts)
            .filter { !it.droppedStillOpen }
            .filter { shift -> shift.blockIds.none { it in pendingGiveAssignmentIds } }
    private var weekOffset = 0
    private var selectedDay = 0
    private var weekSeats: List<HouseSeat> = emptyList()
    private var seatsForOffset: Int? = null // which weekOffset weekSeats belong to
    private var give: SwapDayCard? = null
    private var giveShift: MyShift? = null
    private var take: SwapDayCard? = null
    private var permanent = false
    private var handoff = false

    // ── hand-off recipient directory (§8.5) — a people picker, not a calendar take ──
    private var directory: List<HandoffWorker> = emptyList()
    private var handoffQuery: String = ""
    private var recipient: HandoffWorker? = null

    // ── partial + multi-leg state ──
    // A banked leg: the counterparty + the give/take sub-ranges (indices on each grid).
    private data class Leg(
        val candidate: SwapCandidate,
        val giveRange: BlockRange,
        val takeRange: BlockRange,
    )
    private val committed = mutableListOf<Leg>()

    // The CURRENT (in-progress) leg's sub-ranges. null = auto: give defaults to the first
    // free run not yet banked, take defaults to the whole picked shift.
    private var giveRange: BlockRange? = null
    private var takeRange: BlockRange? = null

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
        // Carry the shared scope from the manage-shift sheet: a Permanent + Swap entry opens
        // straight into the permanent deal (toggleable). Guarded by permanentEligible so a
        // float / pickup / break give can never start permanent.
        permanent = initialPermanent && give?.permanentEligible == true
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

    private fun giveCount(): Int = give?.seatIds?.size ?: 0

    private fun takeCount(): Int = take?.seatIds?.size ?: 0

    /** Give-block indices already banked into committed legs (so the next leg avoids them). */
    private fun bankedGiveIndices(): Set<Int> = committed.flatMap { it.giveRange.from until it.giveRange.to }.toSet()

    /**
     * Take-block indices already banked AGAINST [candidate]'s shift (keyed by the run's
     * seat ids). The two-budget rule: a take block is spent once per counterparty shift, so
     * re-taking the same person's same shift greys out the part already taken — but a
     * different shift (even same person) or a different person is untouched.
     */
    private fun bankedTakeIndicesFor(candidate: SwapCandidate): Set<Int> =
        committed
            .filter { it.candidate.seatIds == candidate.seatIds }
            .flatMap { it.takeRange.from until it.takeRange.to }
            .toSet()

    /** The current leg's give sub-range: a manual selection, else the first free (unbanked) run. */
    private fun resolvedGiveRange(): BlockRange {
        val n = giveCount()
        if (n == 0) return BlockRange(0, 0)
        giveRange?.let { return it }
        return firstFreeRange(n, bankedGiveIndices()) ?: BlockRange(0, n)
    }

    /** The current leg's take sub-range: a manual selection, else the first free run of the picked shift. */
    private fun resolvedTakeRange(): BlockRange {
        val t = take ?: return BlockRange(0, 0)
        val n = t.seatIds.size
        if (n == 0) return BlockRange(0, 0)
        takeRange?.let { return it }
        return firstFreeRange(n, bankedTakeIndicesFor(t.asCandidate())) ?: BlockRange(0, n)
    }

    /** The current in-progress leg, if a counterparty is picked and both its give + take runs are free. */
    private fun currentLeg(): Leg? {
        val t = take ?: return null
        val g = resolvedGiveRange()
        if ((g.from until g.to).any { it in bankedGiveIndices() }) return null // give overlaps a banked leg
        val cand = t.asCandidate()
        val tr = resolvedTakeRange()
        if ((tr.from until tr.to).any { it in bankedTakeIndicesFor(cand) }) return null // take overlaps a banked leg
        return Leg(cand, g, tr)
    }

    /** A take-side [SwapDayCard] reconstructed from a stored candidate (used by the same-person chip). */
    private fun cardForCandidate(c: SwapCandidate): SwapDayCard =
        SwapDayCard(
            userId = c.userId,
            workerName = c.workerName,
            isMine = false,
            seatIds = c.seatIds,
            start = c.start,
            end = c.end,
            timeLabel = c.timeLabel,
            durationLabel = c.durationLabel,
            dayLabel = c.dayLabel,
            permanentEligible = false,
            isFloat = false,
        )

    /** The "give the next free run to the last counterparty too" chip, when actionable. */
    private fun suggestion(): SwapLegSuggestion? {
        if (handoff || permanent) return null
        if (take != null) return null // only while a fresh leg is forming
        val last = committed.lastOrNull() ?: return null
        val g = give ?: return null
        val freeGive = firstFreeRange(giveCount(), bankedGiveIndices()) ?: return null
        // The last counterparty must still have an untaken block on that shift to take.
        firstFreeRange(last.candidate.seatIds.size, bankedTakeIndicesFor(last.candidate)) ?: return null
        val span = planSwapSpan(g.seatIds, g.start, g.end, freeGive.from, freeGive.to)
        return SwapLegSuggestion(
            workerName = last.candidate.workerName,
            label = "Give ${span.rangeLabel} to ${last.candidate.workerName} too",
        )
    }

    private fun legToSwapLeg(leg: Leg): SwapLeg {
        val g = give!!
        val give = planSwapSpan(g.seatIds, g.start, g.end, leg.giveRange.from, leg.giveRange.to)
        val take = planSwapSpan(leg.candidate.seatIds, leg.candidate.start, leg.candidate.end, leg.takeRange.from, leg.takeRange.to)
        return SwapLeg(leg.candidate, give.blockIds, take.blockIds)
    }

    private fun legChip(leg: Leg): SwapLegChip {
        val g = give!!
        val gs = planSwapSpan(g.seatIds, g.start, g.end, leg.giveRange.from, leg.giveRange.to)
        val ts = planSwapSpan(leg.candidate.seatIds, leg.candidate.start, leg.candidate.end, leg.takeRange.from, leg.takeRange.to)
        return SwapLegChip(workerName = leg.candidate.workerName, summary = "give ${gs.rangeLabel} ⇄ take ${ts.rangeLabel}")
    }

    /**
     * The two-sided deal-card model (give ⇄ take). The give/take detail reflects the
     * CURRENT leg's (possibly partial) hours. Hand-off rewrites the take side to a
     * recipient who "gives nothing back".
     */
    private fun deal(): SwapDeal? {
        val g = give ?: return null
        val t = take
        val gr = resolvedGiveRange()
        val giveSpan = planSwapSpan(g.seatIds, g.start, g.end, gr.from, gr.to)
        val takeSpan = t?.let { planSwapSpan(it.seatIds, it.start, it.end, resolvedTakeRange().from, resolvedTakeRange().to) }
        return SwapDeal(
            giveTitle = g.dayLabel,
            giveDetail = "${giveSpan.rangeLabel} · ${giveSpan.durationLabel}",
            takeEyebrow = if (handoff) "Hand off to" else "You take",
            takeInitial = if (handoff) recipient?.name?.take(1) else t?.workerName?.take(1),
            takeTitle =
                when {
                    handoff -> recipient?.name // just the recipient — they're not working a shift back
                    t == null -> null
                    else -> "${t.workerName} · ${t.dayLabel}"
                },
            takeDetail =
                when {
                    handoff -> recipient?.let { "${it.homeHouseName} · gives nothing back" }
                    t == null || takeSpan == null -> null
                    else -> "${takeSpan.rangeLabel} · ${takeSpan.durationLabel}"
                },
            takePlaceholder = if (handoff) "Pick someone below" else "Pick a shift below",
        )
    }

    private fun snapshot(): SwapCalendarUiState {
        val anchor = shiftWeekAnchor(now, weekOffset)
        val week = buildCalendarWeek(myShifts, now, anchor = anchor)
        val seats = if (seatsForOffset == weekOffset) weekSeats else emptyList()
        // Permanent and hand-off are mutually exclusive; permanent needs a SCHEDULED give;
        // neither applies once the worker is composing multiple legs.
        val single = committed.isEmpty()
        // The permanent toggle is shown UP FRONT (the give shift is already pinned) so the
        // worker can choose "make it permanent" before picking the person — a take is only
        // needed to actually propose (canPropose), not to offer the choice.
        val permVisible = give?.permanentEligible == true && !handoff && single
        val gr = resolvedGiveRange()
        val tr = resolvedTakeRange()
        // A leg can be banked when one is ready and there's still a free give run for the next.
        val afterCurrent = bankedGiveIndices() + (gr.from until gr.to)
        // ── segmented timeline: locked runs (banked legs) + the active selection ──
        val giveReserved = committed.map { ReservedRun(it.giveRange, it.candidate.workerName) }
        val giveSegments =
            give?.let { g -> buildSwapSegments(g.seatIds, g.start, g.end, giveReserved, BlockRange(gr.from, gr.to)) }
                ?: emptyList()
        val takeReserved =
            take?.let { tk -> committed.filter { it.candidate.seatIds == tk.seatIds }.map { ReservedRun(it.takeRange, "Taken") } }
                ?: emptyList()
        val takeSegments =
            take?.let { tk -> buildSwapSegments(tk.seatIds, tk.start, tk.end, takeReserved, BlockRange(tr.from, tr.to)) }
                ?: emptyList()
        // The free run the slider handles are clamped to (so they can't cross a locked zone).
        val giveRun = enclosingFreeRun(giveCount(), bankedGiveIndices(), gr.from) ?: BlockRange(gr.from, gr.to)
        val takeRun =
            take?.let { tk -> enclosingFreeRun(tk.seatIds.size, bankedTakeIndicesFor(tk.asCandidate()), tr.from) }
                ?: BlockRange(tr.from, tr.to)
        return SwapCalendarUiState(
            weekOffset = weekOffset,
            weekRange = week.rangeLabel,
            weekRelative = relativeLabel(weekOffset),
            anchor = anchor,
            days = week.days,
            daysWithShifts = swapWeekDaysWithShifts(myShifts, seats, meUserId, anchor, pendingGiveAssignmentIds = pendingGiveAssignmentIds),
            selectedDayIndex = selectedDay,
            day = buildSwapDay(myShifts, seats, meUserId, selectedDay, anchor, breakProfile, pendingGiveAssignmentIds = pendingGiveAssignmentIds),
            give = give,
            take = take,
            permanent = permanent && permVisible,
            permanentToggleVisible = permVisible,
            handoff = handoff && give != null,
            handoffDirectory =
                buildHandoffDirectory(
                    workers = directory,
                    meUserId = meUserId,
                    giveHouseId = giveShift?.house?.id ?: "",
                    giveIsFloat = give?.isFloat == true,
                    query = handoffQuery,
                ),
            handoffQuery = handoffQuery,
            recipient = recipient,
            canPropose = if (handoff) recipient != null && give != null else (committed.isNotEmpty() || currentLeg() != null),
            deal = deal(),
            // The GIVE shift can be trimmed for a plain swap AND a permanent swap (a partial
            // permanent transfers only the trimmed blocks each week); hand-off is whole-shift.
            // The TAKE hours apply only to a 1:1 shift/float swap (permanent is person-level).
            giveSplittable = giveCount() > 1 && !handoff,
            takeSplittable = take != null && takeCount() > 1 && !permanent && !handoff,
            giveFrom = gr.from,
            giveTo = gr.to,
            takeFrom = tr.from,
            takeTo = tr.to,
            giveBlockCount = giveCount(),
            takeBlockCount = takeCount(),
            legs = committed.map { legChip(it) },
            canAddLeg = !handoff && !permanent && take != null && currentLeg() != null && afterCurrent.size < giveCount(),
            giveSegments = if (handoff) emptyList() else giveSegments,
            takeSegments = if (handoff || permanent) emptyList() else takeSegments,
            giveRunFrom = giveRun.from,
            giveRunTo = giveRun.to,
            takeRunFrom = takeRun.from,
            takeRunTo = takeRun.to,
            suggestion = suggestion(),
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

    /** Tap a give (own) card — pins it, or unpins if it was already the give. Resets any legs/ranges. */
    fun pickGive(card: SwapDayCard) {
        if (give?.seatIds == card.seatIds) {
            give = null
            giveShift = null
        } else {
            give = card
            giveShift = coalescedMine.firstOrNull { it.blockIds == card.seatIds }
        }
        permanent = false
        committed.clear()
        giveRange = null
        takeRange = null
        recipient = null // a different give shift re-filters who is eligible to receive it
        _uiState.value = snapshot()
    }

    /** Tap a take (housemate) card — pins it for the current leg, or unpins if already picked. */
    fun pickTake(card: SwapDayCard) {
        take = if (take?.userId == card.userId && take?.seatIds == card.seatIds) null else card
        takeRange = null // a fresh counterparty defaults to its whole shift
        _uiState.value = snapshot()
    }

    /** §8.1 — trim the CURRENT leg's give to a contiguous sub-range [from, to). */
    fun setGiveRange(
        from: Int,
        to: Int,
    ) {
        val n = giveCount()
        val f = from.coerceIn(0, (n - 1).coerceAtLeast(0))
        giveRange = BlockRange(f, to.coerceIn(f + 1, n))
        _uiState.value = snapshot()
    }

    /** §8.1 — trim the CURRENT leg's take to a contiguous sub-range [from, to). */
    fun setTakeRange(
        from: Int,
        to: Int,
    ) {
        val n = takeCount()
        val f = from.coerceIn(0, (n - 1).coerceAtLeast(0))
        takeRange = BlockRange(f, to.coerceIn(f + 1, n))
        _uiState.value = snapshot()
    }

    /**
     * Tap a FREE block on the give timeline — focus its whole free run (the slider re-clamps
     * to it). No-op if [index] is locked (already given) or out of range.
     */
    fun focusGiveRun(index: Int) {
        val run = enclosingFreeRun(giveCount(), bankedGiveIndices(), index) ?: return
        giveRange = run
        _uiState.value = snapshot()
    }

    /** Tap a FREE block on the take timeline — focus its whole free run. No-op if locked / no take. */
    fun focusTakeRun(index: Int) {
        val t = take ?: return
        val run = enclosingFreeRun(t.seatIds.size, bankedTakeIndicesFor(t.asCandidate()), index) ?: return
        takeRange = run
        _uiState.value = snapshot()
    }

    /**
     * Accept the same-person chip ([SwapLegSuggestion]): re-pin the last counterparty and let
     * the give + take fall to their next free runs, so giving a second non-contiguous part of
     * the shift to one person is one tap (it still fires as an independent leg). No-op unless a
     * leg is banked and the current leg is fresh.
     */
    fun acceptSuggestion() {
        if (handoff || permanent || take != null) return
        val last = committed.lastOrNull() ?: return
        take = cardForCandidate(last.candidate)
        giveRange = null // first free give run
        takeRange = null // first free run of that candidate's shift (de-duped)
        _uiState.value = snapshot()
    }

    /**
     * Bank the current leg and start another with a different person — the next leg's give
     * defaults to the first still-free run of the give shift. No-op unless [canAddLeg].
     */
    fun addLeg() {
        val leg = currentLeg() ?: return
        if (bankedGiveIndices().size + (leg.giveRange.to - leg.giveRange.from) >= giveCount()) {
            // would consume the last free run — still bank it, just nothing to add after
        }
        committed.add(leg)
        take = null
        giveRange = null
        takeRange = null
        _uiState.value = snapshot()
    }

    /** Remove a banked leg (its give hours free up again). */
    fun removeLeg(index: Int) {
        if (index in committed.indices) {
            committed.removeAt(index)
            giveRange = null
            _uiState.value = snapshot()
        }
    }

    fun togglePermanent() {
        if (give?.permanentEligible == true && committed.isEmpty()) {
            permanent = !permanent
            if (permanent) handoff = false // mutually exclusive
            _uiState.value = snapshot()
        }
    }

    /**
     * Hand-off mode (§8.5, give-only): the worker hands their WHOLE give shift to a
     * recipient picked from the directory ([pickRecipient]), who gives nothing back.
     * Mutually exclusive with permanent + multi-leg + partial hours; cap-exempt
     * server-side. Turning it on drops any swap "take"/sub-ranges (hand-off is the
     * whole shift to a person); turning it off clears the recipient + search.
     */
    fun setHandoff(on: Boolean) {
        if (on && committed.isNotEmpty()) return // hand-off is single-leg
        handoff = on
        if (on) {
            permanent = false
            take = null // hand-off picks a person from the directory, not a calendar shift
            giveRange = null // always the whole shift
            takeRange = null
        } else {
            recipient = null
            handoffQuery = ""
        }
        _uiState.value = snapshot()
    }

    /**
     * The host fed the active-worker directory (`worker_directory` ∪ houses, or the demo
     * seed) — the eligible-recipient pool the hand-off picker filters. Independent of week
     * navigation (a directory is house-membership, not a schedule).
     */
    fun setWorkerDirectory(workers: List<HandoffWorker>) {
        directory = workers
        _uiState.value = snapshot()
    }

    /** Update the hand-off "Others" search text (matched against worker / house name). */
    fun setHandoffQuery(query: String) {
        handoffQuery = query
        _uiState.value = snapshot()
    }

    /** Tap a hand-off recipient — pins them, or unpins if already the recipient. */
    fun pickRecipient(worker: HandoffWorker) {
        recipient = if (recipient?.userId == worker.userId) null else worker
        _uiState.value = snapshot()
    }

    /**
     * The proposal(s) to POST. Hand-off → one give-only proposal. Permanent → one
     * person-level proposal. Otherwise ONE create-swap PER LEG (committed + the current
     * in-progress one) via [buildSwapProposals] — independent, partial-aware. A float
     * give → float_swap.
     */
    fun proposals(): List<SwapProposal> {
        val g = giveShift ?: return emptyList()
        if (handoff) {
            val r = recipient ?: return emptyList()
            return listOf(buildHandoffProposal(g, g.blockIds, r.userId))
        }
        if (permanent && give?.permanentEligible == true) {
            val t = take ?: return emptyList()
            // §8.3 supports a PARTIAL permanent swap: trim the give to a sub-range and the
            // recurring pattern names only those blocks (transferred each week).
            val gr = resolvedGiveRange()
            val span = planSwapSpan(g.blockIds, g.start, g.end, gr.from, gr.to)
            return listOf(
                buildSwapProposal(SwapKind.PERMANENT, g, t.asCandidate(), span.blockIds).copy(
                    recurringSlotStart = span.start,
                    recurringSlotEnd = span.end,
                ),
            )
        }
        val legs = (committed + listOfNotNull(currentLeg())).map { legToSwapLeg(it) }
        if (legs.isEmpty()) return emptyList()
        val kind = if (give?.isFloat == true) SwapKind.FLOAT else SwapKind.SHIFT
        return buildSwapProposals(kind, g, legs)
    }
}
