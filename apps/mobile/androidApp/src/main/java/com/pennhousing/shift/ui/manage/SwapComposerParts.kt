package com.pennhousing.shift.ui.manage

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RangeSlider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pennhousing.shift.shared.swaps.BlockRange
import com.pennhousing.shift.shared.swaps.HandoffWorker
import com.pennhousing.shift.shared.swaps.SwapCandidate
import com.pennhousing.shift.shared.swaps.SwapDayCard
import com.pennhousing.shift.shared.swaps.SwapSegment
import com.pennhousing.shift.shared.viewmodel.SwapCalendarUiState
import com.pennhousing.shift.shared.viewmodel.SwapDeal
import com.pennhousing.shift.shared.viewmodel.SwapLegSuggestion
import com.pennhousing.shift.ui.house.durationLabel
import com.pennhousing.shift.ui.kit.HouseBadge
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.theme.ShiftTheme

/**
 * The give ⇄ take "deal" card at the top of the swap sheet — the always-visible review of
 * the forming proposal. The give side is pinned from the tapped shift; the take side fills
 * in as the worker picks (or stays a muted placeholder). The connector is `⇄` for a swap,
 * `→` for a hand-off; a "Permanent" tag rides the card when the swap is permanent.
 */
@Composable
internal fun SwapDealCard(
    deal: SwapDeal,
    handoff: Boolean,
    permanent: Boolean,
) {
    val c = ShiftTheme.colors
    val primary = MaterialTheme.colorScheme.primary
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .border(BorderStroke(1.dp, c.divider), RoundedCornerShape(14.dp))
            .testTag("swap_deal_card"),
    ) {
        // Give side (always present) — sits on a tinted surface to read as "what leaves you".
        Column(
            Modifier.fillMaxWidth().background(c.surfaceVar).padding(horizontal = 14.dp, vertical = 12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "YOU GIVE",
                    color = c.sec,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Medium,
                    letterSpacing = 0.5.sp,
                    modifier = Modifier.weight(1f),
                )
                if (permanent) {
                    Text(
                        "Permanent",
                        color = primary,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Medium,
                        modifier =
                            Modifier
                                .clip(RoundedCornerShape(50))
                                .background(primary.copy(alpha = 0.12f))
                                .padding(horizontal = 8.dp, vertical = 2.dp),
                    )
                }
            }
            Text(deal.giveTitle, color = c.ink, fontSize = 15.sp, fontWeight = FontWeight.Medium)
            Text(deal.giveDetail, color = c.sec, fontSize = 13.sp)
        }
        // Connector — a divider broken by a tinted ⇄ / → badge.
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(Modifier.weight(1f).height(1.dp).background(c.divider))
            Box(
                Modifier.size(28.dp).clip(RoundedCornerShape(50)).background(primary.copy(alpha = 0.12f)),
                contentAlignment = Alignment.Center,
            ) {
                Text(if (handoff) "→" else "⇄", color = primary, fontSize = 15.sp, fontWeight = FontWeight.Medium)
            }
            Box(Modifier.weight(1f).height(1.dp).background(c.divider))
        }
        // Take side — filled once a counterparty is picked, else a muted prompt.
        Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp)) {
            Text(deal.takeEyebrow.uppercase(), color = c.sec, fontSize = 11.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.5.sp)
            if (deal.takeTitle == null) {
                Text(deal.takePlaceholder, color = c.ter, fontSize = 14.sp, modifier = Modifier.padding(top = 4.dp))
            } else {
                Row(
                    Modifier.padding(top = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    HouseBadge(deal.takeInitial ?: "?", c.surfaceVar, c.ink)
                    Column(Modifier.weight(1f)) {
                        Text(deal.takeTitle!!, color = c.ink, fontSize = 15.sp, fontWeight = FontWeight.Medium)
                        deal.takeDetail?.let { Text(it, color = c.sec, fontSize = 13.sp) }
                    }
                }
            }
        }
    }
}

@Composable
internal fun SwapModePill(
    title: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val c = ShiftTheme.colors
    Box(
        modifier
            .clip(RoundedCornerShape(50))
            .background(if (selected) MaterialTheme.colorScheme.primary else c.surfaceVar)
            .clickable(onClick = onClick)
            .padding(vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            title,
            color = if (selected) androidx.compose.ui.graphics.Color.White else c.ink,
            fontSize = 13.5.sp,
            fontWeight = if (selected) FontWeight.Medium else FontWeight.Normal,
        )
    }
}

/**
 * The permanent-swap toggle as a prominent card (§8.3) — promoted from the old tiny
 * bottom checkbox. Visible up front (the give shift is pinned), and partial-aware: the
 * give-duration control above still applies, so a worker can permanently hand off just
 * part of a recurring slot.
 */
@Composable
internal fun PermanentToggleCard(
    on: Boolean,
    onToggle: () -> Unit,
) {
    val c = ShiftTheme.colors
    val primary = MaterialTheme.colorScheme.primary
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (on) primary.copy(alpha = 0.08f) else c.surface)
            .border(BorderStroke(if (on) 1.5.dp else 1.dp, if (on) primary else c.divider), RoundedCornerShape(12.dp))
            .clickable(onClick = onToggle)
            .padding(horizontal = 12.dp, vertical = 11.dp)
            .testTag("swap_permanent_toggle"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier
                .size(22.dp)
                .clip(RoundedCornerShape(6.dp))
                .background(if (on) primary else androidx.compose.ui.graphics.Color.Transparent)
                .border(if (on) 0.dp else 1.5.dp, if (on) primary else c.outline, RoundedCornerShape(6.dp)),
            contentAlignment = Alignment.Center,
        ) {
            if (on) Text("✓", color = androidx.compose.ui.graphics.Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold)
        }
        Column(Modifier.weight(1f)) {
            Text("Make it permanent", color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.Medium)
            Text("Swap this slot every week for the rest of the period", color = c.sec, fontSize = 12.5.sp)
        }
    }
}

@Composable
internal fun SwapTakeCard(
    card: SwapDayCard,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.08f) else c.surface)
            .border(
                BorderStroke(
                    if (selected) 1.5.dp else 1.dp,
                    if (selected) MaterialTheme.colorScheme.primary else c.divider,
                ),
                RoundedCornerShape(12.dp),
            ).clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .testTag("swap_take_row"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        HouseBadge(card.workerName.take(1), c.surfaceVar, c.ink)
        Column(Modifier.weight(1f)) {
            Text(card.workerName, color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.Medium)
            Text("${card.timeLabel} · ${card.durationLabel}", color = c.sec, fontSize = 12.5.sp)
        }
        if (selected) Text("✓", color = MaterialTheme.colorScheme.primary, fontSize = 16.sp)
    }
}

/**
 * Hand-off (§8.5) recipient directory — replaces the swap calendar with a people picker:
 * a "My House" tab (the worker's own-house roster, flat) and an "Others" tab (every other
 * house, grouped + searchable, since 10+ houses × ~8 workers is too long to scan). Only
 * workers eligible to receive THIS shift are listed (the VM pre-filters via
 * `buildHandoffDirectory`); the server stays authoritative on create/accept.
 */
@Composable
internal fun HandoffRecipientPicker(
    state: SwapCalendarUiState,
    onPick: (HandoffWorker) -> Unit,
    onQuery: (String) -> Unit,
) {
    val c = ShiftTheme.colors
    var tab by remember { mutableStateOf(0) } // 0 = My House, 1 = Others
    val dir = state.handoffDirectory
    Column(Modifier.fillMaxWidth().testTag("handoff_picker"), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            SwapModePill("My House", selected = tab == 0, modifier = Modifier.weight(1f).testTag("handoff_tab_my_house")) { tab = 0 }
            SwapModePill("Others", selected = tab == 1, modifier = Modifier.weight(1f).testTag("handoff_tab_others")) { tab = 1 }
        }
        if (tab == 0) {
            if (dir.myHouse.isEmpty()) {
                Text(
                    "No eligible workers in your house.",
                    color = c.ter,
                    fontSize = 13.sp,
                    modifier = Modifier.testTag("handoff_my_house_empty"),
                )
            } else {
                Column(Modifier.testTag("handoff_my_house_list"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    dir.myHouse.forEach { w ->
                        HandoffWorkerRow(w, selected = state.recipient?.userId == w.userId, showHouse = false) { onPick(w) }
                    }
                }
            }
        } else {
            HandoffSearchField(value = state.handoffQuery, onValue = onQuery)
            if (dir.others.isEmpty()) {
                Text(
                    if (state.handoffQuery.isBlank()) {
                        "No eligible workers in other houses."
                    } else {
                        "No matches for \"${state.handoffQuery}\"."
                    },
                    color = c.ter,
                    fontSize = 13.sp,
                    modifier = Modifier.testTag("handoff_others_empty"),
                )
            } else {
                Column(Modifier.testTag("handoff_others_list"), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    dir.others.forEach { group ->
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(
                                group.houseName.uppercase(),
                                color = c.sec,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Medium,
                                letterSpacing = 0.5.sp,
                                modifier = Modifier.testTag("handoff_house_group"),
                            )
                            group.workers.forEach { w ->
                                HandoffWorkerRow(w, selected = state.recipient?.userId == w.userId, showHouse = false) { onPick(w) }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** One pickable hand-off recipient (name + optional house), selected-state highlighted. */
@Composable
internal fun HandoffWorkerRow(
    worker: HandoffWorker,
    selected: Boolean,
    showHouse: Boolean,
    onClick: () -> Unit,
) {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.08f) else c.surface)
            .border(
                BorderStroke(
                    if (selected) 1.5.dp else 1.dp,
                    if (selected) MaterialTheme.colorScheme.primary else c.divider,
                ),
                RoundedCornerShape(12.dp),
            ).clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .testTag("handoff_worker_row"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        HouseBadge(worker.name.take(1), c.surfaceVar, c.ink)
        Column(Modifier.weight(1f)) {
            Text(worker.name, color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.Medium)
            if (showHouse) Text(worker.homeHouseName, color = c.sec, fontSize = 12.5.sp)
        }
        if (selected) Text("✓", color = MaterialTheme.colorScheme.primary, fontSize = 16.sp)
    }
}

/** A styled search field for the hand-off "Others" tab — filters by worker / house name. */
@Composable
internal fun HandoffSearchField(
    value: String,
    onValue: (String) -> Unit,
) {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(11.dp))
            .background(c.surfaceVar)
            .border(BorderStroke(1.dp, c.divider), RoundedCornerShape(11.dp))
            .padding(horizontal = 12.dp, vertical = 11.dp)
            .testTag("handoff_search"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(ShiftIcons.Search, contentDescription = null, tint = c.ter, modifier = Modifier.size(18.dp))
        Box(Modifier.weight(1f)) {
            if (value.isEmpty()) {
                Text("Search workers or houses", color = c.ter, fontSize = 14.sp)
            }
            BasicTextField(
                value = value,
                onValueChange = onValue,
                modifier = Modifier.fillMaxWidth().testTag("handoff_search_field"),
                singleLine = true,
                textStyle = TextStyle(color = c.ink, fontSize = 14.sp),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            )
        }
        if (value.isNotEmpty()) {
            Icon(
                ShiftIcons.Close,
                contentDescription = "Clear",
                tint = c.sec,
                modifier = Modifier
                    .size(18.dp)
                    .clip(RoundedCornerShape(50))
                    .clickable { onValue("") }
                    .testTag("handoff_search_clear"),
            )
        }
    }
}

/** A committed leg chip — "→ Ben · give 14:00-15:00 ⇄ take 09:00-10:00" + remove. */
@Composable
internal fun CommittedLegRow(
    leg: PendingSwapLeg,
    onRemove: () -> Unit,
) {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(c.surfaceVar)
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .testTag("swap_leg_row"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(leg.candidate.workerName, color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            Text("Give ${leg.giveLabel} · take ${leg.takeLabel}", color = c.sec, fontSize = 12.5.sp)
        }
        Icon(
            ShiftIcons.Close,
            contentDescription = "Remove",
            tint = c.sec,
            modifier =
                Modifier
                    .size(20.dp)
                    .clip(RoundedCornerShape(50))
                    .clickable(onClick = onRemove)
                    .testTag("swap_leg_remove"),
        )
    }
}

/**
 * The §8.1 "how much" block-range selector for a swap span — a stepped RangeSlider over
 * the span's 30-min blocks with a live "14:00 - 15:00 · 1h" summary (mirrors the drop /
 * claim partial selectors). Defaults to the whole span.
 */
@Composable
internal fun SwapRangeSelector(
    title: String,
    plan: com.pennhousing.shift.shared.swaps.SwapSpanSelection,
    blockCount: Int,
    range: BlockRange,
    tag: String,
    onRange: (Int, Int) -> Unit,
    // The free run the handles are clamped to (so they can't cross a locked zone). Defaults
    // to the whole span — the legacy quick-swap sheet has no locked runs.
    runFrom: Int = 0,
    runTo: Int = blockCount,
) {
    val c = ShiftTheme.colors
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(c.surface)
            .border(1.dp, c.divider, RoundedCornerShape(14.dp))
            .padding(horizontal = 13.dp, vertical = 11.dp)
            .testTag(tag),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(title, color = c.sec, fontSize = 13.sp, fontWeight = FontWeight.Medium)
        Text(plan.dayLabel, color = c.sec, fontSize = 12.5.sp, fontWeight = FontWeight.Medium)
        Text(
            "${plan.rangeLabel} · ${plan.durationLabel}" + if (plan.wholeSpan) " · whole shift" else "",
            style = ShiftTheme.type.monoTime.copy(fontSize = 13.5.sp),
            color = c.ink,
        )
        val lo = runFrom.coerceIn(0, (blockCount - 1).coerceAtLeast(0))
        val hi = runTo.coerceIn(lo + 1, blockCount)
        RangeSlider(
            value = range.from.toFloat().coerceIn(lo.toFloat(), hi.toFloat())..range.to.toFloat().coerceIn(lo.toFloat(), hi.toFloat()),
            onValueChange = { r ->
                val from = r.start.toInt().coerceIn(lo, hi - 1)
                val to = r.endInclusive.toInt().coerceIn(from + 1, hi)
                onRange(from, to)
            },
            valueRange = lo.toFloat()..hi.toFloat(),
            steps = (hi - lo - 1).coerceAtLeast(0),
        )
    }
}

/**
 * The segmented give/take timeline — one track per shift, locked zones greyed (with the
 * receiver's name / "Taken"), the active selection accented, free runs tap-to-focus. Shown
 * only once a part is reserved, so the common single-leg case stays a plain slider.
 */
@Composable
internal fun SwapTimelineStrip(
    segments: List<SwapSegment>,
    tag: String,
    activeVerb: String,
    onFocus: (Int) -> Unit,
) {
    val c = ShiftTheme.colors
    val primary = MaterialTheme.colorScheme.primary
    val shape = RoundedCornerShape(8.dp)
    Row(
        Modifier.fillMaxWidth().testTag(tag),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        segments.forEach { seg ->
            val weight = (seg.to - seg.from).coerceAtLeast(1).toFloat()
            val base =
                when {
                    seg.locked -> c.surfaceVar
                    seg.active -> primary.copy(alpha = 0.10f)
                    else -> c.surface
                }
            val borderColor = if (seg.active) {
                primary
            } else if (seg.locked) {
                c.divider
            } else {
                c.outline
            }
            Column(
                Modifier
                    .weight(weight)
                    .clip(shape)
                    .background(base)
                    .border(if (seg.active) 1.5.dp else 1.dp, borderColor, shape)
                    .then(if (!seg.locked && !seg.active) Modifier.clickable { onFocus(seg.from) } else Modifier)
                    .testTag(
                        if (seg.locked) {
                            "swap_seg_locked"
                        } else if (seg.active) {
                            "swap_seg_active"
                        } else {
                            "swap_seg_free"
                        },
                    ).padding(horizontal = 6.dp, vertical = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(seg.rangeLabel, color = if (seg.locked) c.ter else c.ink, fontSize = 10.5.sp, maxLines = 1, softWrap = false)
                Text(
                    when {
                        seg.locked -> seg.note ?: "Given"
                        seg.active -> activeVerb
                        else -> "Tap"
                    },
                    color = if (seg.active) primary else c.ter,
                    fontSize = 10.sp,
                    fontWeight = if (seg.active) FontWeight.Medium else FontWeight.Normal,
                    maxLines = 1,
                    softWrap = false,
                )
            }
        }
    }
}

/** The same-person "give the next part to X too" chip (accent, one tap → [acceptSuggestion]). */
@Composable
internal fun SwapSuggestionChip(
    suggestion: SwapLegSuggestion,
    onClick: () -> Unit,
) {
    val c = ShiftTheme.colors
    val primary = MaterialTheme.colorScheme.primary
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(primary.copy(alpha = 0.08f))
            .border(1.dp, primary.copy(alpha = 0.4f), RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .testTag("swap_suggestion"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("+", color = primary, fontSize = 16.sp, fontWeight = FontWeight.Medium)
        Text(suggestion.label, color = primary, fontSize = 13.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
        Text("›", color = primary, fontSize = 16.sp)
    }
}

/** One pickable counterparty row — a run (temporary swaps) or a person (permanent). */
@Composable
internal fun SwapCandidateRow(
    candidate: SwapCandidate,
    personOnly: Boolean,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val c = ShiftTheme.colors
    val accent = MaterialTheme.colorScheme.primary
    val shape = RoundedCornerShape(12.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (selected) accent.copy(alpha = 0.08f) else c.surface)
            .border(if (selected) 1.5.dp else 1.dp, if (selected) accent else c.divider, shape)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .testTag("swap_candidate_row"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        HouseBadge(candidate.workerName.take(1), c.surfaceVar, c.ink)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(candidate.workerName, color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            if (!personOnly) {
                Text(
                    "${candidate.dayLabel} · ${candidate.timeLabel} · ${candidate.durationLabel}",
                    color = c.sec,
                    fontSize = 12.5.sp,
                )
            }
        }
        if (selected) {
            Icon(ShiftIcons.CheckCircle, contentDescription = null, tint = accent, modifier = Modifier.size(18.dp))
        }
    }
}
