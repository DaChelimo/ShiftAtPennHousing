package com.pennhousing.shift.shared.swaps

import com.pennhousing.shift.shared.calendar.weekDayIndexInWeekOf
import com.pennhousing.shift.shared.house.HouseSeat
import com.pennhousing.shift.shared.model.AssignmentKind
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.shifts.NEW_YORK
import com.pennhousing.shift.shared.shifts.coalesceMyShifts
import com.pennhousing.shift.shared.shifts.formatDayLabel
import com.pennhousing.shift.shared.shifts.formatDuration
import com.pennhousing.shift.shared.shifts.formatTimeRange
import kotlinx.datetime.TimeZone
import kotlin.time.Instant

/*
 * Calendar swap picker (docs/swaps-enhancement/CALENDAR_REDESIGN.md) — PURE day-grid
 * logic for the week-paged swap calendar that replaces the flat candidate list.
 *
 * For a navigated week ([anchor]) + a selected weekday it lays out two card lists:
 *  - "give" = the worker's OWN swappable shifts that day, from their `MyShift`
 *    snapshot (ALL kinds — home desk, cross-house pickup, float-out — per the
 *    owner ruling), and
 *  - "take" = HOUSEMATES' shifts that day from the home-house grid (`swapCandidates`).
 *
 * Cross-week + retroactive fall out of week navigation: the host pages [anchor] and
 * refetches that week's house grid (`fetchHouseScheduleForWeek`); the worker's
 * MyShift snapshot is already date-unbounded. The pinned "give" persists across weeks
 * in the host. The server (`create-swap` EF + `packages/core`) stays AUTHORITATIVE for
 * §8 eligibility/conflicts/expiry; this layer only shapes the day grid. No I/O, no
 * clock — placement is by [anchor]'s NY week (invariant #6, DST-safe via the calendar
 * helpers). The UI maps a picked give + take to the EF via the existing
 * [buildSwapProposal] (a take card is shape-compatible with [SwapCandidate]).
 */

/** One tappable shift on the swap calendar — a coalesced run; the worker's own ("give") or a housemate's ("take"). */
data class SwapDayCard(
    val userId: String,
    val workerName: String, // "You" for the worker's own cards
    val isMine: Boolean,
    /** Per-block `assignment_id`s of the coalesced run — the EF span (initiator/counterparty). */
    val seatIds: List<String>,
    val start: Instant,
    val end: Instant,
    val timeLabel: String, // "12:00 - 4:00pm"
    val durationLabel: String, // "4h"
    val dayLabel: String, // "Sat · Jun 20"
    /** A SCHEDULED own shift outside a break profile → the permanent-swap toggle applies (§8.3). */
    val permanentEligible: Boolean,
    /** A FLOAT_OUT own shift → the proposal is a float_swap, not a shift_swap (§8.2). */
    val isFloat: Boolean,
)

/** The selected day's two columns of the swap calendar. */
data class SwapDay(
    val mine: List<SwapDayCard>,
    val others: List<SwapDayCard>,
) {
    val isEmpty: Boolean get() = mine.isEmpty() && others.isEmpty()
}

/**
 * The [selectedDayIndex] (0=Mon..6=Sun) of [anchor]'s NY week as swap cards: the
 * worker's own swappable shifts ([SwapDay.mine], from [myShifts] — coalesced,
 * dropped-still-open excluded since a dropped shift is no longer the worker's to swap)
 * and housemates' shifts ([SwapDay.others], from [seats] via [swapCandidates], the
 * proposer excluded). Both filtered to the day by the shift's own start, so a shift in
 * another week never lands on this week's day (cross-week shifts share a weekday).
 *
 * [pendingGiveAssignmentIds] are the worker's own assignment ids already tied up in a
 * pending swap (either direction). A shift touching any of them is EXCLUDED from "give":
 * it can't be offered again — the server would reject a second proposal — so it's removed
 * from the picker rather than left to fail (matches the My-Shifts "swap pending" guard).
 */
fun buildSwapDay(
    myShifts: List<MyShift>,
    seats: List<HouseSeat>,
    meUserId: String,
    selectedDayIndex: Int,
    anchor: Instant,
    breakProfile: Boolean = false,
    zone: TimeZone = NEW_YORK,
    pendingGiveAssignmentIds: Set<String> = emptySet(),
): SwapDay {
    val mine =
        coalesceMyShifts(myShifts)
            .asSequence()
            .filter { !it.droppedStillOpen }
            .filter { shift -> shift.blockIds.none { it in pendingGiveAssignmentIds } }
            .filter { weekDayIndexInWeekOf(it.start, anchor, zone) == selectedDayIndex }
            .map { s ->
                SwapDayCard(
                    userId = meUserId,
                    workerName = "You",
                    isMine = true,
                    seatIds = s.blockIds,
                    start = s.start,
                    end = s.end,
                    timeLabel = formatTimeRange(s.start, s.end, zone),
                    durationLabel = formatDuration(s.start, s.end),
                    dayLabel = formatDayLabel(s.start, zone),
                    permanentEligible = !breakProfile && s.kind == AssignmentKind.SCHEDULED,
                    isFloat = s.kind == AssignmentKind.FLOAT_OUT,
                )
            }
            .sortedBy { it.start }
            .toList()
    val others =
        swapCandidates(seats, excludeUserId = meUserId, zone = zone)
            .asSequence()
            .filter { weekDayIndexInWeekOf(it.start, anchor, zone) == selectedDayIndex }
            .map { c ->
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
            }
            .sortedWith(compareBy({ it.start }, { it.workerName }))
            .toList()
    return SwapDay(mine = mine, others = others)
}

/** NY-fixed convenience for the Swift bridge (Kotlin default args don't export). */
fun buildSwapDayFor(
    myShifts: List<MyShift>,
    seats: List<HouseSeat>,
    meUserId: String,
    selectedDayIndex: Int,
    anchor: Instant,
    breakProfile: Boolean,
): SwapDay = buildSwapDay(myShifts, seats, meUserId, selectedDayIndex, anchor, breakProfile)

/**
 * The Mon-Sun day indexes of [anchor]'s week that have ANY swappable shift (the
 * worker's own or a housemate's) — drives the swap calendar's strip dots, so a worker
 * sees at a glance which days hold something to swap.
 */
fun swapWeekDaysWithShifts(
    myShifts: List<MyShift>,
    seats: List<HouseSeat>,
    meUserId: String,
    anchor: Instant,
    zone: TimeZone = NEW_YORK,
    pendingGiveAssignmentIds: Set<String> = emptySet(),
): Set<Int> {
    val mineDays =
        coalesceMyShifts(myShifts)
            .filter { !it.droppedStillOpen }
            .filter { shift -> shift.blockIds.none { it in pendingGiveAssignmentIds } }
            .mapNotNull { weekDayIndexInWeekOf(it.start, anchor, zone) }
    val otherDays =
        swapCandidates(seats, excludeUserId = meUserId, zone = zone)
            .mapNotNull { weekDayIndexInWeekOf(it.start, anchor, zone) }
    return (mineDays + otherDays).toSet()
}

/** NY-fixed convenience for the Swift bridge. */
fun swapWeekDaysWithShiftsFor(
    myShifts: List<MyShift>,
    seats: List<HouseSeat>,
    meUserId: String,
    anchor: Instant,
): Set<Int> = swapWeekDaysWithShifts(myShifts, seats, meUserId, anchor)

/**
 * Convert a picked take [SwapDayCard] to a [SwapCandidate] so the existing
 * [buildSwapProposal] / [planSwapSpan] machinery (partial sub-ranges, multi-leg) maps
 * the calendar selection to the EF unchanged.
 */
fun SwapDayCard.asCandidate(): SwapCandidate =
    SwapCandidate(
        userId = userId,
        workerName = workerName,
        seatIds = seatIds,
        start = start,
        end = end,
        timeLabel = timeLabel,
        dayLabel = dayLabel,
        durationLabel = durationLabel,
    )

/**
 * A GIVE-ONLY one-sided handoff (§8.5): the worker hands [giveBlockIds] of their own
 * [initiatorShift] to [toUserId], who gives nothing back. Maps to the `handoff` EF with
 * a null counterparty span (the empty side). Take-over (initiator-empty) is the standalone
 * entry's job; from a My-Shifts card the worker is always the giver.
 */
fun buildHandoffProposal(
    initiatorShift: MyShift,
    giveBlockIds: List<String>,
    toUserId: String,
): SwapProposal =
    SwapProposal(
        swapType = "handoff",
        counterpartyUserId = toUserId,
        initiatorShift = initiatorShift,
        initiatorAssignmentIds = giveBlockIds,
        counterpartyAssignmentIds = null,
    )
