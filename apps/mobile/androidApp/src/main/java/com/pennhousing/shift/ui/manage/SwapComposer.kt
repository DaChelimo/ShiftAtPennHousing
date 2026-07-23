package com.pennhousing.shift.ui.manage

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pennhousing.shift.shared.data.WorkerBackend
import com.pennhousing.shift.shared.house.HouseSeat
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.samples.DemoData
import com.pennhousing.shift.shared.samples.DemoFactory
import com.pennhousing.shift.shared.shifts.toRow
import com.pennhousing.shift.shared.swaps.BlockRange
import com.pennhousing.shift.shared.swaps.SwapCandidate
import com.pennhousing.shift.shared.swaps.SwapKind
import com.pennhousing.shift.shared.swaps.SwapLeg
import com.pennhousing.shift.shared.swaps.SwapProposal
import com.pennhousing.shift.shared.swaps.buildSwapProposal
import com.pennhousing.shift.shared.swaps.buildSwapProposals
import com.pennhousing.shift.shared.swaps.firstFreeRange
import com.pennhousing.shift.shared.swaps.planSwapSpan
import com.pennhousing.shift.shared.swaps.swapPeople
import com.pennhousing.shift.ui.house.durationLabel
import com.pennhousing.shift.ui.kit.ButtonVariant
import com.pennhousing.shift.ui.kit.HouseBadge
import com.pennhousing.shift.ui.kit.SectionHeader
import com.pennhousing.shift.ui.kit.ShiftBottomSheet
import com.pennhousing.shift.ui.kit.ShiftButton
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.theme.ShiftTheme

/** A committed leg in the compose flow (UI-side; resolved to a [SwapLeg] at submit). */
internal data class PendingSwapLeg(
    val candidate: SwapCandidate,
    val give: BlockRange,
    val giveLabel: String,
    val takeBlockIds: List<String>,
    val takeLabel: String,
)

/**
 * The swap-proposal sheet: pick the swap kind the card supports (§8 — float
 * cards propose a float swap; scheduled cards a this-week or permanent swap;
 * pickups a this-week swap), then the counterparty — a housemate's run from
 * the §11.4 house grid for temporary swaps, a PERSON for permanent swaps. The
 * server (`create-swap` + packages/core eligibility) stays authoritative; a
 * rejected proposal simply creates nothing and the feed never shows it.
 */
@Composable
internal fun SwapSheet(
    shift: MyShift,
    kinds: List<SwapKind>,
    candidates: List<SwapCandidate>,
    onSubmit: (List<SwapProposal>) -> Unit,
    onDismiss: () -> Unit,
) {
    val c = ShiftTheme.colors
    val row = remember(shift) { shift.toRow() }
    var kind by remember { mutableStateOf(kinds.first()) }
    val options = remember(kind, candidates) { if (kind == SwapKind.PERMANENT) swapPeople(candidates) else candidates }
    val blockCount = shift.blockIds.size

    // Multi-party = INDEPENDENT LEGS (decision 2026-06-15). `committed` holds the legs
    // already added; `picked` + `give` + `take` are the leg currently being composed.
    // A new `kind` resets everything (permanent has no legs/partial).
    var committed by remember(kind) { mutableStateOf<List<PendingSwapLeg>>(emptyList()) }
    var picked by remember(kind) { mutableStateOf<SwapCandidate?>(null) }
    var give by remember(kind) { mutableStateOf<BlockRange?>(null) }
    var take by remember(kind) { mutableStateOf<BlockRange?>(null) }

    val isTemp = kind != SwapKind.PERMANENT
    val allocated = remember(committed) { committed.flatMap { it.give.from until it.give.to }.toSet() }
    val giveOverlaps = give?.let { (it.from until it.to).any { i -> i in allocated } } ?: false
    val allAllocated = allocated.size >= blockCount

    fun defaultGive(): BlockRange? = if (blockCount <= 1) BlockRange(0, blockCount) else firstFreeRange(blockCount, allocated)

    fun pick(candidate: SwapCandidate) {
        picked = candidate
        take = BlockRange(0, candidate.seatIds.size)
        if (give == null || giveOverlaps) give = defaultGive()
    }

    fun currentLeg(): SwapLeg? {
        val cand = picked ?: return null
        val g = give ?: return null
        if ((g.from until g.to).any { it in allocated }) return null
        val gPlan = planSwapSpan(shift.blockIds, shift.start, shift.end, g.from, g.to)
        val t = take ?: BlockRange(0, cand.seatIds.size)
        val tPlan = planSwapSpan(cand.seatIds, cand.start, cand.end, t.from, t.to)
        return SwapLeg(cand, gPlan.blockIds, tPlan.blockIds)
    }

    fun addLeg() {
        val cand = picked ?: return
        val g = give ?: return
        val gPlan = planSwapSpan(shift.blockIds, shift.start, shift.end, g.from, g.to)
        val t = take ?: BlockRange(0, cand.seatIds.size)
        val tPlan = planSwapSpan(cand.seatIds, cand.start, cand.end, t.from, t.to)
        committed = committed + PendingSwapLeg(cand, g, gPlan.rangeLabel, tPlan.blockIds, tPlan.rangeLabel)
        val newAllocated = allocated + (g.from until g.to)
        picked = null
        take = null
        give = if (blockCount <= 1) null else firstFreeRange(blockCount, newAllocated)
    }

    val readyLeg = currentLeg()
    val canPropose = committed.isNotEmpty() || readyLeg != null

    ShiftBottomSheet(onDismiss = onDismiss, title = "Propose a swap") {
        Column(
            Modifier.fillMaxWidth().testTag("swap_sheet"),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                HouseBadge(row.houseInitial, c.surfaceVar, c.ink)
                Column {
                    Text(row.timeLabel, style = ShiftTheme.type.monoTime, color = c.ink)
                    Text(
                        "${row.houseName ?: row.destination ?: ""} · ${row.durationLabel} · ${row.dayLabel}",
                        color = c.sec,
                        fontSize = 13.sp,
                    )
                }
            }

            if (kinds.size > 1) {
                ScopeOption(
                    selected = kind == SwapKind.SHIFT,
                    title = "Swap this week's occurrence",
                    body = "You take theirs, they take yours, this week only.",
                    icon = ShiftIcons.Refresh,
                    accent = MaterialTheme.colorScheme.primary,
                    tag = "swap_kind_shift",
                    onClick = { kind = SwapKind.SHIFT },
                )
                ScopeOption(
                    selected = kind == SwapKind.PERMANENT,
                    title = "Swap permanently",
                    body = "Transfers this whole recurring slot for the rest of the period.",
                    icon = ShiftIcons.Refresh,
                    accent = c.permanent.accent,
                    tag = "swap_kind_permanent",
                    onClick = { kind = SwapKind.PERMANENT },
                )
            } else if (kind == SwapKind.FLOAT) {
                Text(
                    "Float swap: a housemate takes your float assignment.",
                    color = c.sec,
                    fontSize = 13.sp,
                )
            }

            // Committed legs (multi-party). Each is independent — remove one without
            // touching the others. Shown only when there is more than the in-progress leg.
            if (committed.isNotEmpty()) {
                Column(
                    Modifier.testTag("swap_legs"),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    SectionHeader("Swapping with ${committed.size + if (readyLeg != null) 1 else 0}")
                    committed.forEachIndexed { i, leg ->
                        CommittedLegRow(leg = leg, onRemove = { committed = committed.filterIndexed { j, _ -> j != i } })
                    }
                }
            }

            SectionHeader(
                when {
                    kind == SwapKind.PERMANENT -> "Who takes the slot?"
                    committed.isEmpty() -> "Whose shift do you want?"
                    else -> "Add another person"
                },
            )
            if (options.isEmpty()) {
                Text("No housemates with shifts this week to swap with.", color = c.ter, fontSize = 13.sp)
            } else {
                Column(
                    Modifier.testTag("swap_candidate_list"),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    options.take(8).forEach { candidate ->
                        SwapCandidateRow(
                            candidate = candidate,
                            personOnly = kind == SwapKind.PERMANENT,
                            selected = picked?.userId == candidate.userId && picked?.seatIds == candidate.seatIds,
                            onClick = { if (kind == SwapKind.PERMANENT) picked = candidate else pick(candidate) },
                        )
                    }
                }
            }

            // §8.1 partial block pickers — only for temporary swaps with a picked
            // counterparty and a sub-dividable span. Default to the whole free run.
            if (isTemp && picked != null) {
                give?.let { g ->
                    if (blockCount > 1) {
                        SwapRangeSelector(
                            title = "Your hours to give",
                            plan = planSwapSpan(shift.blockIds, shift.start, shift.end, g.from, g.to),
                            blockCount = blockCount,
                            range = g,
                            tag = "swap_give_range",
                            onRange = { from, to -> give = BlockRange(from, to) },
                        )
                    }
                }
                picked?.let { cand ->
                    val t = take ?: BlockRange(0, cand.seatIds.size)
                    if (cand.seatIds.size > 1) {
                        SwapRangeSelector(
                            title = "Hours you want from ${cand.workerName}",
                            plan = planSwapSpan(cand.seatIds, cand.start, cand.end, t.from, t.to),
                            blockCount = cand.seatIds.size,
                            range = t,
                            tag = "swap_take_range",
                            onRange = { from, to -> take = BlockRange(from, to) },
                        )
                    }
                }
                if (giveOverlaps) {
                    Text(
                        "Those hours overlap another swap, so pick different hours.",
                        color = c.floatOut.deep,
                        fontSize = 12.5.sp,
                        modifier = Modifier.testTag("swap_overlap_warning"),
                    )
                }
                if (!allAllocated) {
                    ShiftButton(
                        "Add another person",
                        onClick = { addLeg() },
                        modifier = Modifier.fillMaxWidth().testTag("swap_add_leg_button"),
                        variant = ButtonVariant.Tonal,
                        fullWidth = true,
                        enabled = readyLeg != null,
                    )
                }
            }

            ShiftButton(
                if (kind == SwapKind.PERMANENT || committed.size + (if (readyLeg != null) 1 else 0) <= 1) {
                    "Propose swap"
                } else {
                    "Propose ${committed.size + (if (readyLeg != null) 1 else 0)} swaps"
                },
                onClick = {
                    if (kind == SwapKind.PERMANENT) {
                        picked?.let { onSubmit(listOf(buildSwapProposal(SwapKind.PERMANENT, shift, it))) }
                    } else {
                        val legs =
                            committed.map {
                                SwapLeg(it.candidate, shift.blockIds.subList(it.give.from, it.give.to), it.takeBlockIds)
                            }
                        val all = legs + listOfNotNull(readyLeg)
                        if (all.isNotEmpty()) onSubmit(buildSwapProposals(kind, shift, all))
                    }
                    onDismiss()
                },
                modifier = Modifier.fillMaxWidth().testTag("swap_submit_button"),
                fullWidth = true,
                enabled = if (kind == SwapKind.PERMANENT) picked != null else canPropose,
            )
        }
    }
}

/**
 * Calendar swap sheet (CALENDAR_REDESIGN.md) — the week-paged give/take picker (Android
 * mirror of iOS `SwapCalendarSheetView`). The tapped shift is the pinned "give"; the
 * worker pages weeks and taps a housemate's shift to "take" (or, in Hand-off mode, picks
 * a recipient to give to). Live: fetches each shown week's house grid; demo: the seeded
 * current week. Whole-run swaps in v1.
 */
@Composable
internal fun SwapCalendarBody(
    giveShift: MyShift,
    meUserId: String?,
    demoSeats: List<HouseSeat>,
    onSubmit: (List<SwapProposal>) -> Unit,
    pendingGiveAssignmentIds: Set<String> = emptySet(),
    // Carries the shared manage-shift scope: opens straight into a permanent swap (when the
    // give is permanent-eligible) instead of a this-week swap.
    initialPermanent: Boolean = false,
) {
    val c = ShiftTheme.colors
    val vm =
        remember(giveShift, meUserId, pendingGiveAssignmentIds, initialPermanent) {
            DemoFactory.swapCalendarViewModel(giveShift, meUserId ?: "demo", false, pendingGiveAssignmentIds, initialPermanent)
        }
    val state by vm.uiState.collectAsStateWithLifecycle()
    // Fetch the shown week's housemate grid on every week change (live), or feed the demo
    // seats. Keyed on weekOffset so prev/next reloads; setWeekSeats ignores stale fetches.
    LaunchedEffect(state.weekOffset, meUserId) {
        val seats =
            if (meUserId != null) {
                runCatching { WorkerBackend.shiftsRepository.fetchHouseScheduleForWeek(meUserId, state.anchor)?.seats }
                    .getOrNull() ?: emptyList()
            } else {
                demoSeats
            }
        vm.setWeekSeats(state.weekOffset, seats)
    }
    // The §8.5 hand-off recipient directory (cross-house) — fetched once; the picker is
    // a people roster, independent of which week the give shift sits in.
    LaunchedEffect(meUserId) {
        val directory =
            if (meUserId != null) {
                runCatching { WorkerBackend.shiftsRepository.fetchWorkerDirectory() }.getOrNull().orEmpty()
            } else {
                DemoData.workerDirectory()
            }
        vm.setWorkerDirectory(directory)
    }
    Column(
        Modifier.fillMaxWidth().testTag("swap_calendar_sheet"),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (state.legs.isNotEmpty()) {
            Column(Modifier.testTag("swap_legs"), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                state.legs.forEachIndexed { i, leg ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .background(c.surfaceVar)
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(leg.workerName, color = c.ink, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                            Text(leg.summary, color = c.sec, fontSize = 12.sp)
                        }
                        Text(
                            "✕",
                            color = c.sec,
                            fontSize = 13.sp,
                            modifier = Modifier.clip(RoundedCornerShape(50)).clickable { vm.removeLeg(i) }.padding(6.dp),
                        )
                    }
                }
            }
        }

        // After banking a leg, the one-tap "give the next part to the same person too"
        // shortcut (the chosen same-person flow): two non-contiguous parts of one shift to
        // one person stay independent legs, but feel like one intent.
        state.suggestion?.let { sug -> SwapSuggestionChip(sug) { vm.acceptSuggestion() } }

        state.deal?.let { deal -> SwapDealCard(deal, handoff = state.handoff, permanent = state.permanent) }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            SwapModePill(
                "Swap",
                selected = !state.handoff,
                modifier = Modifier.weight(1f).testTag("swap_mode_swap"),
            ) { vm.setHandoff(false) }
            SwapModePill(
                "Hand off",
                selected = state.handoff,
                modifier = Modifier.weight(1f).testTag("swap_mode_handoff"),
            ) { vm.setHandoff(true) }
        }

        // Hand-off (§8.5) is NOT a calendar exchange — you just pick who covers the
        // shift. So in hand-off mode the whole week/day/take calendar is replaced by
        // the cross-house recipient directory below.
        if (state.handoff) {
            HandoffRecipientPicker(
                state = state,
                onPick = { vm.pickRecipient(it) },
                onQuery = { vm.setHandoffQuery(it) },
            )
        } else {
            // ── "Your shift" controls — PROMINENT, above the calendar. Partial swaps are
            // uncommon but heavily used; the old hidden "adjust hours" link was
            // undiscoverable. The give-duration control shows whenever your shift is
            // splittable — for a plain swap AND a permanent swap (§8.1/§8.3 partial).
            if (state.giveSplittable) {
                state.give?.let { g ->
                    // Once a part is banked, the shift fragments — show the segmented timeline
                    // (locked zones + tap-to-focus) above the slider; the slider then only
                    // adjusts "how much" within the focused free run.
                    if (state.giveSegments.any { it.locked }) {
                        SwapTimelineStrip(state.giveSegments, tag = "swap_give_timeline", activeVerb = "Giving") { vm.focusGiveRun(it) }
                    }
                    SwapRangeSelector(
                        title = if (state.permanent) "How much of your slot to give?" else "How much of your shift to give?",
                        plan = planSwapSpan(g.seatIds, g.start, g.end, state.giveFrom, state.giveTo),
                        blockCount = state.giveBlockCount,
                        runFrom = state.giveRunFrom,
                        runTo = state.giveRunTo,
                        range = BlockRange(state.giveFrom, state.giveTo),
                        tag = "swap_give_range",
                        onRange = { from, to -> vm.setGiveRange(from, to) },
                    )
                }
            }

            if (state.permanentToggleVisible) {
                PermanentToggleCard(on = state.permanent) { vm.togglePermanent() }
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "‹",
                    color = c.ink,
                    fontSize = 22.sp,
                    modifier =
                        Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .clickable { vm.previousWeek() }
                            .testTag("swap_week_prev")
                            .padding(horizontal = 10.dp),
                )
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(state.weekRange, color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                    Text(state.weekRelative, color = c.ter, fontSize = 12.sp)
                }
                Text(
                    "›",
                    color = c.ink,
                    fontSize = 22.sp,
                    modifier =
                        Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .clickable { vm.nextWeek() }
                            .testTag("swap_week_next")
                            .padding(horizontal = 10.dp),
                )
            }

            Row(Modifier.fillMaxWidth().testTag("swap_day_strip"), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                state.days.forEach { d ->
                    val sel = d.index == state.selectedDayIndex
                    Column(
                        Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(10.dp))
                            .clickable { vm.selectDay(d.index) }
                            .padding(vertical = 4.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Text(d.dayLetter, color = c.sec, fontSize = 11.sp)
                        Box(
                            Modifier
                                .size(28.dp)
                                .clip(RoundedCornerShape(50))
                                .background(if (sel) MaterialTheme.colorScheme.primary else Color.Transparent),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(d.dateLabel, color = if (sel) Color.White else c.ink, fontSize = 13.sp)
                        }
                        Box(
                            Modifier
                                .size(4.dp)
                                .clip(RoundedCornerShape(50))
                                .background(if (d.hasShifts) MaterialTheme.colorScheme.primary else Color.Transparent),
                        )
                    }
                }
            }

            SectionHeader(if (state.permanent) "Swap your slot with whom?" else "Whose shift do you want?")
            when {
                state.loadingWeek -> Text("Loading housemates…", color = c.ter, fontSize = 13.sp)
                state.day.others.isEmpty() -> Text("No housemates on this day. Try another day or week.", color = c.ter, fontSize = 13.sp)
                else ->
                    Column(Modifier.testTag("swap_take_list"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        state.day.others.forEach { card -> SwapTakeCard(card, selected = state.take == card) { vm.pickTake(card) } }
                    }
            }

            // Take hours — contextual to the picked person (1:1 shift/float swaps only; a
            // permanent swap is person-level, so this is hidden when permanent is on).
            if (state.take != null && state.takeSplittable) {
                state.take?.let { t ->
                    // Re-taking a counterparty shift you already took part of: the taken blocks
                    // render locked (two-budget rule, keyed per counterparty shift).
                    if (state.takeSegments.any { it.locked }) {
                        SwapTimelineStrip(state.takeSegments, tag = "swap_take_timeline", activeVerb = "Taking") { vm.focusTakeRun(it) }
                    }
                    SwapRangeSelector(
                        title = "Hours you want from ${t.workerName}",
                        plan = planSwapSpan(t.seatIds, t.start, t.end, state.takeFrom, state.takeTo),
                        blockCount = state.takeBlockCount,
                        runFrom = state.takeRunFrom,
                        runTo = state.takeRunTo,
                        range = BlockRange(state.takeFrom, state.takeTo),
                        tag = "swap_take_range",
                        onRange = { from, to -> vm.setTakeRange(from, to) },
                    )
                }
            }

            if (state.canAddLeg) {
                ShiftButton(
                    "+ Add another person",
                    onClick = { vm.addLeg() },
                    modifier = Modifier.fillMaxWidth().testTag("swap_add_leg"),
                    variant = ButtonVariant.Tonal,
                    fullWidth = true,
                )
            }
        } // end !handoff calendar block

        val legCount = state.legs.size + (if (state.take != null) 1 else 0)
        ShiftButton(
            when {
                state.handoff -> "Hand off shift"
                legCount > 1 -> "Propose $legCount swaps"
                else -> "Propose swap"
            },
            onClick = { onSubmit(vm.proposals()) },
            modifier = Modifier.fillMaxWidth().testTag("swap_submit_button"),
            fullWidth = true,
            enabled = state.canPropose,
        )
    }
}
