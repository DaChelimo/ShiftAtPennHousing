package com.pennhousing.shift.ui.calendar

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pennhousing.shift.shared.calendar.CalendarDaySection
import com.pennhousing.shift.shared.calendar.CalendarWeekOverview
import com.pennhousing.shift.shared.house.HouseSeat
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.swaps.PendingSwapNotice
import com.pennhousing.shift.shared.swaps.SwapDecision
import com.pennhousing.shift.shared.swaps.SwapProposal
import com.pennhousing.shift.shared.swaps.swapKindsFor
import com.pennhousing.shift.shared.viewmodel.CalendarMode
import com.pennhousing.shift.shared.viewmodel.CalendarViewModel
import com.pennhousing.shift.shared.viewmodel.FloatCarouselUiState
import com.pennhousing.shift.shared.viewmodel.ShiftsScreenViewModel
import com.pennhousing.shift.shared.viewmodel.SwapTourViewModel
import com.pennhousing.shift.ui.FloatRequestCarousel
import com.pennhousing.shift.ui.common.PageTitle
import com.pennhousing.shift.ui.common.WeekTotalChip
import com.pennhousing.shift.ui.common.weekOffsetTitle
import com.pennhousing.shift.ui.kit.BannerTone
import com.pennhousing.shift.ui.kit.EmptyState
import com.pennhousing.shift.ui.kit.ShiftBanner
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.manage.ManageShiftSheet
import com.pennhousing.shift.ui.onboarding.AskAssistantButton
import com.pennhousing.shift.ui.onboarding.ShiftTourHelpButton
import com.pennhousing.shift.ui.theme.ShiftTheme
import kotlinx.coroutines.launch

/**
 * The Personal Calendar (worker-app.html `CalendarScreen`, agenda-first): a static
 * "this week" header (NO week-picker — only the current week is exposed; arbitrary
 * weeks + the permanent template have no data), a Mon-Sun strip, and the selected
 * day's agenda with a live NOW line. All from the shared, tested
 * [com.pennhousing.shift.shared.calendar.buildCalendarWeek] / `buildCalendarAgenda`
 * over the same `MyShift` snapshot the Shifts screen renders.
 */
@Composable
internal fun CalendarTabContent(
    vm: CalendarViewModel,
    shiftsVm: ShiftsScreenViewModel,
    breakProfile: Boolean = false,
    // §7.1 float-request carousel state + actions (the blue card stack under the hours
    // chip). Empty state → no carousel renders.
    floatCarousel: FloatCarouselUiState = FloatCarouselUiState(emptyList(), 0, false, emptyList()),
    onFloatAccept: (String) -> Unit = {},
    onFloatDecline: (String) -> Unit = {},
    onFloatDetail: (String) -> Unit = {},
    onDropShift: (MyShift, Boolean) -> Unit = { _, _ -> },
    swapMeUserId: String? = null,
    swapDemoSeats: List<HouseSeat> = emptyList(),
    onCreateSwap: suspend (SwapProposal) -> Boolean = { false },
    onSwapProposed: () -> Unit = {},
    // Accept / decline an INCOMING swap tapped from a flagged agenda card (best-effort
    // live POST is the host's; the popup resolves the calendar mark optimistically).
    onAcceptSwap: (String) -> Unit = {},
    onRejectSwap: (String) -> Unit = {},
    // Cancel (void) an OWN outgoing swap from the "swap pending" card.
    onVoidSwap: (String) -> Unit = {},
    // The header "?" that replays the interactive shift tour, and its reported bounds
    // (for the one-time post-tour pointer callout to point at).
    onReplayShiftTour: () -> Unit = {},
    onShiftTourHelpPositioned: (Rect) -> Unit = {},
    // The swap-composer tour's ViewModel, threaded down to the manage-shift sheet (its
    // autoStart trigger, overlay, help button, and pointer all render from inside the
    // sheet — see the swapTourVm comment where it's created in ShiftsApp).
    swapTourVm: SwapTourViewModel,
    // The "Ask Snoopy" pill. It floats over the agenda, anchored ABOVE the bottom week
    // navigator (it used to sit in the Scaffold's FAB slot, which put it on top of the
    // navigator and covered its arrows). Null on surfaces that don't offer the Assistant.
    onAskAssistant: (() -> Unit)? = null,
) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    val c = ShiftTheme.colors
    val swapScope = rememberCoroutineScope()
    var showWeekPicker by remember { mutableStateOf(false) }
    // Tapping an agenda card opens the manage-shift sheet (§5.2), which pages in-place to the
    // swap give/take picker (§8) — one sheet, no dismiss-and-re-present.
    var dropTarget by remember { mutableStateOf<MyShift?>(null) }
    // An incoming-swap card opens the accept/decline popup instead of the manage sheet.
    var decisionTarget by remember { mutableStateOf<SwapDecision?>(null) }
    // An OUTGOING-swap card opens the "swap pending" notice (cancel / keep waiting) — it can't
    // be dropped or swapped while the swap is live, so the drop sheet would just fail.
    var pendingNotice by remember { mutableStateOf<PendingSwapNotice?>(null) }
    val onShiftClick: (String) -> Unit = { id -> vm.shiftForCard(id)?.let { dropTarget = it } }
    val onSwapClick: (String) -> Unit = { swapId -> vm.decisionFor(swapId)?.let { decisionTarget = it } }
    val onPendingSwapClick: (String) -> Unit = { swapId -> vm.pendingSwapNoticeFor(swapId)?.let { pendingNotice = it } }

    if (showWeekPicker) {
        WeekPickerSheet(
            options = vm.weekOptions(),
            currentOffset = state.weekOffset,
            onPick = { offset ->
                vm.selectWeekOffset(offset)
                showWeekPicker = false
            },
            onDismiss = { showWeekPicker = false },
            onTemplate = {
                vm.showTemplate()
                showWeekPicker = false
            },
        )
    }

    if (state.mode == CalendarMode.TEMPLATE) {
        // D5 — the derived recurring typical week (honestly labelled; no template
        // entity exists, this is the union of SCHEDULED-kind slots in the snapshot).
        Column(Modifier.fillMaxSize().background(c.bg).testTag("calendar_template")) {
            PageTitle("My Shifts") {
                ShiftTourHelpButton(onClick = onReplayShiftTour, onPositioned = onShiftTourHelpPositioned)
            }
            ShiftBanner(
                title = "Viewing the recurring template",
                body = "Derived from your scheduled weeks. Permanent drops and swaps change every future week.",
                tone = BannerTone.Info,
                modifier = Modifier.padding(horizontal = 16.dp).testTag("template_banner"),
            )
            Box(Modifier.weight(1f).fillMaxWidth()) {
                if (state.template.isEmpty()) {
                    EmptyState(
                        title = "No recurring slots",
                        icon = ShiftIcons.Calendar,
                        body = "Nothing in your SM-built schedule yet.",
                    )
                } else {
                    LazyColumn(
                        Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 24.dp),
                    ) {
                        item {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                state.template.forEach { slot -> TemplateSlotRow(slot) }
                            }
                        }
                    }
                }
                AskAssistantOverlay(onAskAssistant)
            }
            // The week navigator now lives at the BOTTOM, above the nav bar.
            WeekNavBar(
                title = "Recurring template",
                rangeLabel = "Derived from your scheduled weeks",
                onOpenPicker = { showWeekPicker = true },
            )
        }
        return
    }

    Column(Modifier.fillMaxSize().background(c.bg).testTag("calendar_screen")) {
        PageTitle("My Shifts")
        // The "This week — Xh of cap" total, carried over from the old My-Shifts tab and
        // placed directly under the title (the hours always follow the shown week).
        WeekTotalChip(
            weekHours = state.weekHours,
            cap = state.weekCap,
            weekOffset = state.weekOffset,
            modifier = Modifier.padding(horizontal = 16.dp).testTag("week_total_chip"),
        )
        // §7.1 — the float-request carousel sits directly under the hours chip, above the
        // week/day content, so it shows in BOTH modes and an outstanding float can't be
        // missed. Renders nothing when there are no pending floats.
        FloatRequestCarousel(
            state = floatCarousel,
            onAccept = onFloatAccept,
            onDecline = onFloatDecline,
            onOpenDetail = onFloatDetail,
            modifier = Modifier.padding(top = 4.dp, bottom = 6.dp),
        )
        // Pending swaps, both directions, above everything else and NOT week-scoped: a
        // request that needs an answer has to be visible on the screen the worker opens,
        // not only on the card for the day it happens to fall on (BSpec §10.1).
        SwapBannerColumn(
            banner = state.swapBanner,
            onIncoming = onSwapClick,
            onOutgoing = onPendingSwapClick,
            modifier = Modifier.padding(bottom = 10.dp),
        )
        // The whole-week overview is the default; the Day segment drills into a single day.
        CalendarViewToggle(
            mode = state.mode,
            onWeek = vm::showWeek,
            onDay = { vm.selectDay(state.selectedDayIndex) },
        )
        // The Mon-Sun day picker only makes sense in Day mode (in Week mode every day is
        // already shown in the overview), so it expands in / collapses out with the mode.
        AnimatedVisibility(
            visible = state.mode == CalendarMode.DAY,
            enter = fadeIn() + expandVertically(),
            exit = fadeOut() + shrinkVertically(),
        ) {
            WeekStrip(state.week, state.selectedDayIndex, vm::selectDay)
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (state.mode == CalendarMode.DAY) {
                Column(Modifier.fillMaxSize()) {
                    DayHeaderRow(state.agenda.header)
                    if (state.agenda.isEmpty) {
                        if (state.agenda.header.closed) {
                            // §3.4/§11.3 (T2-12c): the home house is closed this date — no
                            // blocks exist to work, so say so instead of "day off".
                            EmptyState(
                                title = "House closed",
                                icon = ShiftIcons.Building,
                                body = "Your house is closed this day, so no desk shifts are scheduled.",
                            )
                        } else {
                            EmptyState(
                                title = "No shifts this day",
                                icon = ShiftIcons.Calendar,
                                body = "Enjoy the day off, or browse Open Shifts to pick one up.",
                            )
                        }
                    } else {
                        LazyColumn(
                            Modifier.fillMaxSize().testTag("calendar_agenda"),
                            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
                        ) {
                            item {
                                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                    state.agenda.items.forEach { AgendaItemRow(it, onShiftClick, onSwapClick, onPendingSwapClick) }
                                }
                            }
                        }
                    }
                }
            } else {
                CalendarWeekOverviewList(state.weekOverview, onShiftClick, onSwapClick, onPendingSwapClick)
            }
            AskAssistantOverlay(onAskAssistant)
        }
        // The week navigator now lives at the BOTTOM, above the nav bar.
        WeekNavBar(
            title = weekOffsetTitle(state.weekOffset),
            rangeLabel = state.week.rangeLabel,
            onOpenPicker = { showWeekPicker = true },
            onPreviousWeek = vm::previousWeek,
            onNextWeek = vm::nextWeek,
        )
    }

    dropTarget?.let { shift ->
        // ONE sheet, two in-place pages (manage ⇄ swap) — "Choose who to swap with" pushes the
        // swap page inside the SAME sheet instead of dismissing + presenting a new one.
        ManageShiftSheet(
            shift = shift,
            vm = shiftsVm,
            breakProfile = breakProfile,
            onDismiss = { dropTarget = null },
            onDrop = { effective, permanent ->
                // Live host POSTs `drop-shift` / `permanent-drop`; the dropped (sub)shift
                // leaves the agenda (calendar VM) and becomes a vacant opening (shifts VM)
                // so it shows under Open Shifts — claimable, partial or full, by anyone.
                onDropShift(effective, permanent)
                vm.drop(effective.blockIds)
                shiftsVm.dropToOpen(effective)
            },
            swapKinds = swapKindsFor(shift, breakProfile),
            swapMeUserId = swapMeUserId,
            swapDemoSeats = swapDemoSeats,
            // Drop the worker's already-pending shifts from the give pool (defensive — the
            // pinned give is never pending, but a give-picker must not offer one).
            swapPendingGiveIds = vm.pendingGiveAssignmentIds(),
            onSubmitSwap = { proposals ->
                // Fire one create-swap per leg (independent legs). The "Swap proposed" toast
                // fires ONLY when every leg's write actually lands — a failed write surfaces
                // the host's red writeError toast instead of a false success.
                swapScope.launch {
                    val allOk = proposals.map { onCreateSwap(it) }.all { it }
                    if (allOk) onSwapProposed()
                }
            },
            swapTourVm = swapTourVm,
        )
    }

    decisionTarget?.let { decision ->
        SwapDecisionSheet(
            decision = decision,
            onAccept = {
                vm.resolveSwap(decision.swapId) // optimistic: the card un-tints
                onAcceptSwap(decision.swapId)
                decisionTarget = null
            },
            onDecline = {
                vm.resolveSwap(decision.swapId)
                onRejectSwap(decision.swapId)
                decisionTarget = null
            },
            onDismiss = { decisionTarget = null },
        )
    }

    pendingNotice?.let { notice ->
        PendingSwapNoticeSheet(
            notice = notice,
            onCancelSwap = {
                vm.resolveSwap(notice.swapId) // optimistic: the card un-tints
                onVoidSwap(notice.swapId)
                pendingNotice = null
            },
            // "Keep waiting" and the corner ✕ both just minimise the card — no action taken.
            onDismiss = { pendingNotice = null },
        )
    }
}

/**
 * The floating "Ask Snoopy" pill, anchored to the bottom-right of the agenda area so it
 * sits ABOVE the week navigator rather than on top of it (the Scaffold FAB slot floats
 * above the bottom NAV bar, which is one bar too low). Matches iOS, which anchors the
 * same pill to the bottom-trailing corner of the content, clear of its week bar.
 *
 * Call this as the LAST child of the agenda [Box] so it draws over the list.
 */
@Composable
private fun BoxScope.AskAssistantOverlay(onAskAssistant: (() -> Unit)?) {
    if (onAskAssistant == null) return
    AskAssistantButton(
        onClick = onAskAssistant,
        modifier =
            Modifier
                .align(Alignment.BottomEnd)
                .padding(end = 16.dp, bottom = 14.dp),
    )
}

/** Week / Day segmented toggle in the calendar header. */
@Composable
internal fun CalendarViewToggle(
    mode: CalendarMode,
    onWeek: () -> Unit,
    onDay: () -> Unit,
) {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .padding(horizontal = 16.dp, vertical = 4.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(c.surfaceVar)
            .padding(3.dp)
            .testTag("calendar_view_toggle"),
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        CalendarToggleSegment("Week", mode == CalendarMode.WEEK, onWeek, Modifier.testTag("calendar_view_week"))
        CalendarToggleSegment("Day", mode == CalendarMode.DAY, onDay, Modifier.testTag("calendar_view_day"))
    }
}

@Composable
internal fun CalendarToggleSegment(
    label: String,
    active: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = ShiftTheme.colors
    Text(
        label,
        modifier =
            modifier
                .clip(RoundedCornerShape(8.dp))
                .background(if (active) c.surface else Color.Transparent)
                .clickable(onClick = onClick)
                .padding(horizontal = 18.dp, vertical = 6.dp),
        color = if (active) c.ink else c.sec,
        fontSize = 13.sp,
        fontWeight = if (active) FontWeight.SemiBold else FontWeight.Medium,
    )
}

/**
 * The whole-week overview (default calendar view): every Mon-Sun day as a section —
 * its header + agenda rows, empty days shown compactly. The NOW line appears only in
 * today's section (the shared builder gates it).
 *
 * On the ongoing week the shared builder folds days that already happened into
 * [CalendarWeekOverview.collapsedPastDays]; they render as one expandable card pinned at
 * the top ([PastDaysCard]) so today is the first day in view. Navigated and whole-past
 * weeks fold nothing, so [CalendarWeekOverview.activeDays] is the full Mon-Sun list.
 */
@Composable
internal fun CalendarWeekOverviewList(
    overview: CalendarWeekOverview?,
    onShiftClick: (String) -> Unit = {},
    onSwapClick: (String) -> Unit = {},
    onPendingSwapClick: (String) -> Unit = {},
) {
    LazyColumn(
        Modifier.fillMaxSize().testTag("calendar_week_overview"),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 2.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (overview?.hasCollapsedPast == true) {
            item(key = "calendar_past_days_card") {
                PastDaysCard(days = overview.collapsedPastDays, shiftCount = overview.collapsedShiftCount)
            }
        }
        overview?.activeDays?.forEach { section ->
            item {
                CalendarDaySectionBlock(section, onShiftClick, onSwapClick, onPendingSwapClick)
            }
        }
    }
}

/** One Mon-Sun day in the week overview: header + agenda rows, or the empty-day treatment. */
@Composable
internal fun CalendarDaySectionBlock(
    section: CalendarDaySection,
    onShiftClick: (String) -> Unit,
    onSwapClick: (String) -> Unit,
    onPendingSwapClick: (String) -> Unit,
) {
    val c = ShiftTheme.colors
    Column(
        Modifier.fillMaxWidth().testTag("calendar_day_section"),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        DayHeaderRow(section.header)
        if (section.isEmpty) {
            Text(
                if (section.header.closed) "House closed" else "No shifts",
                color = c.ter,
                fontSize = 13.sp,
                modifier = Modifier.padding(start = 18.dp, bottom = 4.dp),
            )
            // An empty TODAY still gets the NOW line (the shared builder always inserts one
            // for today), so the live time is visible even on a day off rather than only
            // appearing once a shift exists.
            section.items
                .firstOrNull { it.nowLabel != null }
                ?.nowLabel
                ?.let { NowLine(it) }
        } else {
            section.items.forEach { AgendaItemRow(it, onShiftClick, onSwapClick, onPendingSwapClick) }
        }
    }
}

/**
 * The ongoing week's already-passed days, folded into one expandable card at the top of
 * the week overview (collapsed by default, so today leads the list). Expanding reveals a
 * compact per-day mini row for each folded day: weekday + date + its held-hours summary
 * (or "No shifts"), with the day's shift(s) shown inline and read-only. Past shifts are
 * not actionable, so the cards carry no tap target.
 */
@Composable
internal fun PastDaysCard(
    days: List<CalendarDaySection>,
    shiftCount: Int,
) {
    val c = ShiftTheme.colors
    var expanded by remember { mutableStateOf(false) }
    val subtitle =
        buildString {
            append("${days.size} ${if (days.size == 1) "day" else "days"}")
            if (shiftCount > 0) append(" · $shiftCount ${if (shiftCount == 1) "shift" else "shifts"}")
        }
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(c.surfaceVar)
            .testTag("calendar_past_days_card"),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .clickable { expanded = !expanded }
                .padding(horizontal = 14.dp, vertical = 12.dp)
                .testTag("calendar_past_days_toggle"),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(
                ShiftIcons.ChevronRight,
                contentDescription = null,
                tint = c.sec,
                modifier = Modifier.size(16.dp).rotate(if (expanded) 90f else 0f),
            )
            Text(
                if (expanded) "Earlier this week" else "Show earlier this week",
                color = c.ink,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f),
            )
            Text(subtitle, color = c.sec, fontSize = 12.5.sp)
        }
        AnimatedVisibility(visible = expanded) {
            Column(
                Modifier.fillMaxWidth().padding(start = 14.dp, end = 14.dp, bottom = 10.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                days.forEach { section ->
                    Column(
                        Modifier.fillMaxWidth().testTag("calendar_past_day_row"),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.Bottom,
                        ) {
                            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text(section.header.title, color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                                Text("· ${section.header.dateLabel}", color = c.ter, fontSize = 13.sp)
                            }
                            val summary = section.header.summary
                            if (summary != null) {
                                Text(summary, color = c.sec, style = ShiftTheme.type.monoTime.copy(fontSize = 12.5.sp))
                            } else {
                                Text("No shifts", color = c.ter, fontSize = 12.5.sp)
                            }
                        }
                        section.items.filter { it.shift != null }.forEach { itemRow ->
                            AgendaShiftCard(
                                row = itemRow.shift!!,
                                active = false,
                                past = true,
                                swap = itemRow.swap,
                                onClick = null,
                            )
                        }
                    }
                }
            }
        }
    }
}
