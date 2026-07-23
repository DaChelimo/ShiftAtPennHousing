package com.pennhousing.shift.ui.manage

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RangeSlider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pennhousing.shift.shared.house.HouseSeat
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.onboarding.ShiftTour
import com.pennhousing.shift.shared.onboarding.SwapTour
import com.pennhousing.shift.shared.shifts.PartialDropPlan
import com.pennhousing.shift.shared.shifts.subShiftFor
import com.pennhousing.shift.shared.shifts.toRow
import com.pennhousing.shift.shared.swaps.SwapKind
import com.pennhousing.shift.shared.swaps.SwapProposal
import com.pennhousing.shift.shared.viewmodel.ShiftsScreenViewModel
import com.pennhousing.shift.shared.viewmodel.SwapTourViewModel
import com.pennhousing.shift.ui.house.durationLabel
import com.pennhousing.shift.ui.kit.ButtonVariant
import com.pennhousing.shift.ui.kit.HouseBadge
import com.pennhousing.shift.ui.kit.ShiftBottomSheet
import com.pennhousing.shift.ui.kit.ShiftButton
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.onboarding.SwapTourHelpButton
import com.pennhousing.shift.ui.onboarding.SwapTourOverlay
import com.pennhousing.shift.ui.onboarding.SwapTourPointerCallout
import com.pennhousing.shift.ui.onboarding.SwapTourPointerStore
import com.pennhousing.shift.ui.theme.ShiftTheme
import kotlinx.coroutines.delay

internal enum class ManagePage { Manage, Swap }

/**
 * The manage-shift sheet (§5.2 / §8) — ONE bottom sheet with two in-place pages: the
 * Drop/Swap chooser (Option C) and, when the worker proceeds to swap, the week-paged
 * give/take picker. "Choose who to swap with" PUSHES the swap page within the SAME sheet
 * (a back chevron returns) rather than dismissing and presenting a new sheet; the selected
 * range + scope carry into the give.
 */
@Composable
internal fun ManageShiftSheet(
    shift: MyShift,
    vm: ShiftsScreenViewModel,
    breakProfile: Boolean,
    onDismiss: () -> Unit,
    onDrop: (MyShift, Boolean) -> Unit,
    swapKinds: List<SwapKind>,
    swapMeUserId: String?,
    swapDemoSeats: List<HouseSeat>,
    swapPendingGiveIds: Set<String>,
    onSubmitSwap: (List<SwapProposal>) -> Unit,
    // The swap-composer tour. Auto-opens the FIRST time the worker reaches the swap page
    // (not the manage page — Drop-vs-Swap is ShiftTour's job, not this tour's). See
    // ui/onboarding/SwapTourView.kt.
    swapTourVm: SwapTourViewModel,
) {
    var page by remember(shift) { mutableStateOf(ManagePage.Manage) }
    var swapGive by remember(shift) { mutableStateOf<MyShift?>(null) }
    var swapPermanent by remember(shift) { mutableStateOf(false) }
    val swapTourState by swapTourVm.uiState.collectAsStateWithLifecycle()
    // One-shot pointer callout on the swap page's help "?" after the tour first finishes.
    // Local to this sheet (mirrors iOS's `showSwapTourPointer` being `@State` on
    // `ManageShiftSheet`, not lifted to the top-level screen) — it only ever matters while
    // the sheet carrying the help button is still open.
    var swapTourHelpRect by remember { mutableStateOf<Rect?>(null) }
    var showSwapTourPointer by remember { mutableStateOf(false) }
    val context = LocalContext.current

    LaunchedEffect(page) {
        if (page == ManagePage.Swap) swapTourVm.autoStart()
    }
    LaunchedEffect(swapTourState.active) {
        if (!swapTourState.active &&
            !SwapTour.shouldAutoShow(swapTourState.seen) &&
            !SwapTourPointerStore.hasShown(context)
        ) {
            SwapTourPointerStore.markShown(context)
            showSwapTourPointer = true
        }
    }
    LaunchedEffect(showSwapTourPointer) {
        if (showSwapTourPointer) {
            delay(3200)
            showSwapTourPointer = false
        }
    }

    ShiftBottomSheet(
        onDismiss = onDismiss,
        title = if (page == ManagePage.Swap) "Propose a swap" else "Manage shift",
        onBack = if (page == ManagePage.Swap) ({ page = ManagePage.Manage }) else null,
    ) {
        Box(Modifier.fillMaxWidth()) {
            AnimatedContent(
                targetState = page,
                transitionSpec = {
                    // Forward (→ Swap) slides in from the right; Back slides in from the left.
                    if (targetState == ManagePage.Swap) {
                        (slideInHorizontally { it / 3 } + fadeIn()) togetherWith (slideOutHorizontally { -it / 3 } + fadeOut())
                    } else {
                        (slideInHorizontally { -it / 3 } + fadeIn()) togetherWith (slideOutHorizontally { it / 3 } + fadeOut())
                    }
                },
                label = "manage_page",
            ) { p ->
                when (p) {
                    ManagePage.Manage ->
                        ManagePageContent(
                            shift = shift,
                            vm = vm,
                            breakProfile = breakProfile,
                            swapKinds = swapKinds,
                            onDrop = { sub, permanent ->
                                onDrop(sub, permanent)
                                onDismiss()
                            },
                            onProposeSwap = { sub, permanent ->
                                swapGive = sub
                                swapPermanent = permanent
                                page = ManagePage.Swap
                            },
                        )
                    ManagePage.Swap ->
                        swapGive?.let { give ->
                            SwapCalendarBody(
                                giveShift = give,
                                meUserId = swapMeUserId,
                                demoSeats = swapDemoSeats,
                                pendingGiveAssignmentIds = swapPendingGiveIds,
                                initialPermanent = swapPermanent,
                                onSubmit = { proposals ->
                                    onSubmitSwap(proposals)
                                    onDismiss()
                                },
                            )
                        }
                }
            }
            // The composer's own help "?", floating top-end since ShiftBottomSheet's own
            // header has no trailing accessory slot (its close X already owns that spot).
            if (page == ManagePage.Swap) {
                SwapTourHelpButton(
                    onClick = swapTourVm::replay,
                    onPositioned = { swapTourHelpRect = it },
                    modifier = Modifier.align(Alignment.TopEnd).padding(top = 2.dp, end = 2.dp),
                )
            }
            // Gated on page == Swap too: a Settings "Replay swap tour" flips `active` true
            // immediately (before the sheet may even be open on this page), and it must stay
            // invisible until the worker actually reaches the swap page, not show over the
            // Drop/Swap manage page. Rendered as a sibling in this SAME Box (not a separate
            // Column row) so it overlaps the page content instead of stacking below it.
            if (swapTourState.active && page == ManagePage.Swap) {
                SwapTourOverlay(
                    state = swapTourState,
                    onNext = swapTourVm::next,
                    onBack = swapTourVm::back,
                    onSkip = swapTourVm::skip,
                    onDismissOutside = {
                        swapTourVm.skip()
                        showSwapTourPointer = true
                    },
                )
            }
            if (showSwapTourPointer) {
                SwapTourPointerCallout(targetRect = swapTourHelpRect)
            }
        }
    }
}

/**
 * Drop sheet (§5.2): the design's bottom sheet — scope radios (occurrence /
 * permanent), a short-notice warning, and a destructive confirm. The exact
 * "Drop this occurrence" / "Drop permanently" labels + the
 * `drop_*` selectors satisfy the Maestro contract. Both scopes drive the existing
 * optimistic-local [ShiftsScreenViewModel.drop] (decision #13); the §8.4 server
 * semantics of a permanent drop are a later step.
 *
 * T2-11 — when the displayed card coalesces several 30-min blocks, BOTH scopes gain
 * a "How much to drop" block-range slider (defaulting to the whole shift, so the
 * Maestro 03 whole-drop path is unchanged), so a permanent drop can release just a
 * sub-range of the recurring slot. The occurrence scope also offers a mid-shift "From
 * now" quick action (§5.2: a 17:51 drop opens a 17:30-anchored gap). The selected run
 * is dropped via the `drop-shift` / `permanent-drop` EF (its `assignment_ids` array);
 * the remaining blocks re-coalesce into their own card(s). The short-notice warning
 * anchors to the SELECTED gap start.
 */
@Composable
internal fun ManagePageContent(
    shift: MyShift,
    vm: ShiftsScreenViewModel,
    breakProfile: Boolean,
    swapKinds: List<SwapKind>,
    // Confirm a drop of the SELECTED sub-shift (the parent owns the dismiss + optimistic move).
    onDrop: (MyShift, Boolean) -> Unit,
    // §8 pivot — navigate to the swap PAGE in the same sheet, carrying the SELECTED sub-shift
    // (range pre-fills the give) + whether the shared scope is Permanent (drives a permanent swap).
    onProposeSwap: (MyShift, Boolean) -> Unit,
) {
    val c = ShiftTheme.colors
    val row = remember(shift) { shift.toRow() }
    val options = vm.dropOptions(shift, breakProfile)
    val canSwap = swapKinds.isNotEmpty()
    val canSwapPermanently = SwapKind.PERMANENT in swapKinds

    // Drop ⇄ Swap are equal-weight intents (Option C). The scope + range below are SHARED by
    // both — picking a range then switching to Swap carries that range into the give.
    var swapIntent by remember(shift) { mutableStateOf(false) }
    var permanentScope by remember(shift) { mutableStateOf(false) }

    // Permanent validity is per-intent: drop → recurring slot; swap → a permanent swap exists.
    val permanentAllowed = if (swapIntent) canSwapPermanently else options.canDropPermanently
    // The shared scope row only shows when SOME intent supports permanent; otherwise the card
    // is always this-week and the control would be a lone disabled segment.
    val scopeRowVisible = options.canDropPermanently || canSwapPermanently

    // §5.2 partial range — block indexes on the shift's own grid, [from, to). SHARED across
    // both intents (the swap pivot pins subShiftFor(shift, plan) as the give).
    val blockCount = shift.blockIds.size
    var rangeFrom by remember(shift) { mutableIntStateOf(0) }
    var rangeTo by remember(shift) { mutableIntStateOf(blockCount) }
    val partialPlan = vm.planDropRange(shift, rangeFrom, rangeTo)
    val fromNowIndex = remember(shift) { vm.dropFromNowIndex(shift) }
    // Short-notice gates the DROP confirm only — a swap proposal isn't a short-notice drop.
    val shortNotice = !swapIntent && partialPlan.shortNotice

    Column(
        Modifier.fillMaxWidth().testTag("manage_shift_sheet"),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            HouseBadge(row.houseInitial, c.surfaceVar, c.ink)
            Column {
                Text(row.timeLabel, style = ShiftTheme.type.monoTime, color = c.ink)
                Text("${row.houseName ?: row.destination ?: ""} · ${row.durationLabel}", color = c.sec, fontSize = 13.sp)
            }
        }

        // Equal-weight intent choice — Drop vs Swap (§5.2 / §8).
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            IntentCard(
                modifier = Modifier.weight(1f),
                selected = !swapIntent,
                title = "Drop the shift",
                body = "Opens for others to claim.",
                icon = ShiftIcons.Calendar,
                enabled = true,
                tag = "intent_drop",
                onClick = {
                    swapIntent = false
                    if (!options.canDropPermanently) permanentScope = false
                },
            )
            IntentCard(
                modifier = Modifier.weight(1f),
                selected = swapIntent,
                title = "Swap it",
                body = "Trade with a housemate.",
                icon = ShiftIcons.Refresh,
                enabled = canSwap,
                tag = "intent_swap",
                onClick = {
                    if (canSwap) {
                        swapIntent = true
                        if (!canSwapPermanently) permanentScope = false
                    }
                },
            )
        }

        // Shared scope — drives BOTH the drop (this-week vs permanent release) and the
        // swap (this-week vs permanent swap).
        if (scopeRowVisible) {
            ScopeSegmentedControl(
                permanent = permanentScope,
                permanentEnabled = permanentAllowed,
                onThisWeek = { permanentScope = false },
                onPermanent = { if (permanentAllowed) permanentScope = true },
            )
        }

        // §5.2 partial range — shown when the card spans >1 block. SHARED: it sizes the
        // drop AND pre-fills the swap give. The mid-shift "From now" stays this-week-only.
        if (blockCount > 1) {
            DropRangeSelector(
                plan = partialPlan,
                blockCount = blockCount,
                rangeFrom = rangeFrom,
                rangeTo = rangeTo,
                fromNowIndex = if (permanentScope) null else fromNowIndex,
                onRange = { from, to ->
                    rangeFrom = from
                    rangeTo = to
                },
            )
        }

        // Short-notice is a non-blocking heads-up, NOT a gate: a red-outlined caution
        // that sits directly above the (red) Drop button so the consequence reads as
        // part of that action. The drop stays one tap away.
        if (shortNotice) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(c.danger.tint)
                    .border(1.dp, c.danger.accent, RoundedCornerShape(12.dp))
                    .padding(horizontal = 13.dp, vertical = 11.dp)
                    .testTag("drop_short_notice_warning"),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(
                    ShiftIcons.Warning,
                    contentDescription = null,
                    tint = c.danger.accent,
                    modifier = Modifier.size(18.dp).padding(top = 1.dp),
                )
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("Starts within 20 minutes", color = c.ink, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold)
                    Text(
                        "Short-notice drop. Your manager is notified immediately to arrange cover.",
                        color = c.sec,
                        fontSize = 13.sp,
                    )
                }
            }
        }

        if (swapIntent) {
            // §8 pivot — navigate to the swap page carrying the SELECTED sub-shift + scope.
            ShiftButton(
                "Choose who to swap with",
                onClick = { onProposeSwap(subShiftFor(shift, partialPlan), permanentScope) },
                modifier = Modifier.fillMaxWidth().testTag("swap_continue_button"),
                fullWidth = true,
            )
        } else {
            ShiftButton(
                when {
                    permanentScope -> "Drop permanently"
                    !partialPlan.wholeShift -> "Drop ${partialPlan.rangeLabel}"
                    else -> "Drop this week"
                },
                // [onDrop] owns the whole move (live POST + the optimistic two-VM shuffle:
                // leave the agenda, appear in the open feed) AND the dismiss. BOTH scopes drop
                // the SELECTED sub-shift — its blockIds are the contiguous run the EF receives;
                // the rest re-coalesce. A whole-shift selection (the default) drops the whole slot.
                onClick = { onDrop(subShiftFor(shift, partialPlan), permanentScope) },
                modifier = Modifier.fillMaxWidth().testTag("drop_confirm_button"),
                variant = ButtonVariant.DestructiveFilled,
                fullWidth = true,
            )
        }
    }
}

/**
 * One equal-weight intent card in the manage-shift sheet (Option C) — "Drop the shift" /
 * "Swap it". A disabled card (no swap available) dims and ignores taps.
 */
@Composable
internal fun IntentCard(
    modifier: Modifier,
    selected: Boolean,
    title: String,
    body: String,
    icon: ImageVector,
    enabled: Boolean,
    tag: String,
    onClick: () -> Unit,
) {
    val c = ShiftTheme.colors
    val primary = MaterialTheme.colorScheme.primary
    Column(
        modifier
            .clip(RoundedCornerShape(12.dp))
            .background(if (selected) primary.copy(alpha = 0.08f) else Color.Transparent)
            .border(BorderStroke(if (selected) 1.5.dp else 1.dp, if (selected) primary else c.divider), RoundedCornerShape(12.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .alpha(if (enabled) 1f else 0.4f)
            .padding(horizontal = 12.dp, vertical = 11.dp)
            .testTag(tag),
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Icon(icon, contentDescription = null, tint = if (selected) primary else c.sec, modifier = Modifier.size(20.dp))
        Text(title, color = c.ink, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold)
        Text(body, color = c.sec, fontSize = 11.5.sp, lineHeight = 14.sp)
    }
}

/**
 * The shared this-week / permanent scope selector (manage-shift sheet). "Permanent" dims and
 * ignores taps when the current intent can't go permanent (e.g. a pickup or float card).
 */
@Composable
internal fun ScopeSegmentedControl(
    permanent: Boolean,
    permanentEnabled: Boolean,
    onThisWeek: () -> Unit,
    onPermanent: () -> Unit,
) {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(c.surfaceVar)
            .padding(3.dp)
            .testTag("scope_segmented"),
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        ScopeSegment(
            "This week only",
            selected = !permanent,
            enabled = true,
            tag = "scope_this_week",
            modifier = Modifier.weight(1f),
            onClick = onThisWeek,
        )
        ScopeSegment(
            "Permanent",
            selected = permanent,
            enabled = permanentEnabled,
            tag = "scope_permanent",
            modifier = Modifier.weight(1f),
            onClick = onPermanent,
        )
    }
}

@Composable
internal fun ScopeSegment(
    label: String,
    selected: Boolean,
    enabled: Boolean,
    tag: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val c = ShiftTheme.colors
    Box(
        modifier
            .clip(RoundedCornerShape(8.dp))
            .background(if (selected) c.surface else Color.Transparent)
            .clickable(enabled = enabled, onClick = onClick)
            .alpha(if (enabled) 1f else 0.4f)
            .padding(vertical = 8.dp)
            .testTag(tag),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            color = if (selected) c.ink else c.sec,
            fontSize = 13.sp,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
        )
    }
}

/**
 * The §5.2 "How much to drop" block-range selector (T2-11): a stepped range
 * slider over the card's 30-min blocks with a live "17:30 - 19:00 · 1h 30m"
 * summary, plus the mid-shift "From now" quick action when `now` falls inside
 * the shift. Defaults to the whole shift.
 */
@Composable
internal fun DropRangeSelector(
    plan: PartialDropPlan,
    blockCount: Int,
    rangeFrom: Int,
    rangeTo: Int,
    fromNowIndex: Int?,
    onRange: (Int, Int) -> Unit,
) {
    val c = ShiftTheme.colors
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(c.surface)
            .border(1.dp, c.divider, RoundedCornerShape(14.dp))
            .padding(horizontal = 13.dp, vertical = 11.dp)
            .testTag("drop_range_selector"),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("How much", color = c.sec, fontSize = 13.sp, fontWeight = FontWeight.Medium)
            if (fromNowIndex != null) {
                Text(
                    "From now",
                    color = MaterialTheme.colorScheme.primary,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier =
                        Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .clickable { onRange(fromNowIndex, blockCount) }
                            .testTag("drop_from_now")
                            .padding(horizontal = 8.dp, vertical = 4.dp),
                )
            }
        }
        Text(
            "${plan.rangeLabel} · ${plan.durationLabel}" + if (plan.wholeShift) " · whole shift" else "",
            style = ShiftTheme.type.monoTime.copy(fontSize = 13.5.sp),
            color = c.ink,
            modifier = Modifier.testTag("drop_range_label"),
        )
        RangeSlider(
            value = rangeFrom.toFloat()..rangeTo.toFloat(),
            onValueChange = { range ->
                val from = range.start.toInt().coerceIn(0, blockCount - 1)
                val to = range.endInclusive.toInt().coerceIn(from + 1, blockCount)
                onRange(from, to)
            },
            valueRange = 0f..blockCount.toFloat(),
            steps = (blockCount - 1).coerceAtLeast(0),
        )
    }
}

// ===================================================================
// Swap proposal (§8.1-§8.4, D2/D3) — initiate a swap from a My-Shifts card.
// ===================================================================

/** A radio-style drop-scope option (design `ScopeOption`). */
@Composable
internal fun ScopeOption(
    selected: Boolean,
    title: String,
    body: String,
    icon: ImageVector,
    accent: Color,
    tag: String,
    onClick: () -> Unit,
    enabled: Boolean = true,
) {
    val c = ShiftTheme.colors
    val shape = RoundedCornerShape(14.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (selected) accent.copy(alpha = 0.08f) else c.surface)
            .border(if (selected) 1.5.dp else 1.dp, if (selected) accent else c.divider, shape)
            .clickable(enabled = enabled, onClick = onClick)
            .alpha(if (enabled) 1f else 0.5f)
            .padding(12.dp)
            .testTag(tag),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            Modifier.size(20.dp).clip(RoundedCornerShape(50)).border(2.dp, if (selected) accent else c.outline, RoundedCornerShape(50)),
            contentAlignment = Alignment.Center,
        ) {
            if (selected) Box(Modifier.size(10.dp).clip(RoundedCornerShape(50)).background(accent))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, color = c.ink, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            Text(body, color = c.sec, fontSize = 13.sp, lineHeight = 18.sp)
        }
        Icon(icon, contentDescription = null, tint = if (selected) accent else c.ter, modifier = Modifier.size(20.dp))
    }
}
