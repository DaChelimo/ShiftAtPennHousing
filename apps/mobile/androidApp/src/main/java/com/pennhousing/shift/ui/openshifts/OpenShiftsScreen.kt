package com.pennhousing.shift.ui.openshifts

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.SecondaryTabRow
import androidx.compose.material3.Tab
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.pennhousing.shift.shared.data.PermanentPickupScope
import com.pennhousing.shift.shared.model.OpenFeed
import com.pennhousing.shift.shared.model.OpenShift
import com.pennhousing.shift.shared.shifts.HomeOpenShiftsTab
import com.pennhousing.shift.shared.shifts.OpenShiftSort
import com.pennhousing.shift.shared.shifts.OtherHousesTab
import com.pennhousing.shift.shared.viewmodel.CalendarViewModel
import com.pennhousing.shift.shared.viewmodel.ShiftsScreenViewModel
import com.pennhousing.shift.shared.viewmodel.ShiftsTab
import com.pennhousing.shift.shared.viewmodel.ShiftsUiState
import com.pennhousing.shift.ui.OPEN_SUB_HOME
import com.pennhousing.shift.ui.OPEN_SUB_OTHER
import com.pennhousing.shift.ui.calendar.WeekNavBar
import com.pennhousing.shift.ui.calendar.WeekPickerSheet
import com.pennhousing.shift.ui.common.PageTitle
import com.pennhousing.shift.ui.common.ShiftCardColumn
import com.pennhousing.shift.ui.common.SpecTab
import com.pennhousing.shift.ui.common.weekOffsetTitle
import com.pennhousing.shift.ui.kit.EmptyState
import com.pennhousing.shift.ui.kit.SegmentedControl
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.kit.ShiftSection
import com.pennhousing.shift.ui.onboarding.OpenClaimTourHelpButton
import com.pennhousing.shift.ui.theme.ShiftTheme

/**
 * The "Open Shifts" tab: a secondary sub-tab row over the two open feeds — the
 * home-house feed (§5.6 Tab 2 / §5.1) and the cross-house feeds (§5.6 Tab 3). Both
 * are always in the snapshot; the sub-tab only switches which one renders. "My House"
 * is the default. The sub-tab selector ids (`tab_open_home` / `tab_open_other`) and the
 * feed-container ids below carry over from when these were two top-level tabs.
 */
@Composable
internal fun OpenShiftsTabContent(
    state: ShiftsUiState,
    vm: ShiftsScreenViewModel,
    calendarVm: CalendarViewModel,
    currentWeeklyHours: Double,
    onClaimed: (String) -> Unit,
    onClaimShift: (OpenShift) -> Unit = {},
    onPickUpPermanent: (OpenShift) -> Unit = {},
    loadPermanentScope: suspend (OpenShift) -> PermanentPickupScope? = { null },
    // The header "?" that replays the interactive Open-Shifts claim tour, and its reported
    // bounds (for the one-time post-tour pointer callout to point at).
    onReplayOpenClaimTour: () -> Unit = {},
    onOpenClaimTourHelpPositioned: (Rect) -> Unit = {},
) {
    var sub by remember { mutableIntStateOf(OPEN_SUB_HOME) }
    var showWeekPicker by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().background(ShiftTheme.colors.bg)) {
        PageTitle("Open Shifts") {
            OpenClaimTourHelpButton(
                onClick = onReplayOpenClaimTour,
                onPositioned = onOpenClaimTourHelpPositioned,
            )
        }
        SecondaryTabRow(selectedTabIndex = sub) {
            SpecTab("My House", "tab_open_home", sub == OPEN_SUB_HOME) {
                sub = OPEN_SUB_HOME
                vm.selectTab(ShiftsTab.OPEN_HOME)
            }
            SpecTab("Others", "tab_open_other", sub == OPEN_SUB_OTHER) {
                sub = OPEN_SUB_OTHER
                vm.selectTab(ShiftsTab.OPEN_OTHER)
            }
        }
        // The feed fills the space; the open-week navigator is pinned at the BOTTOM
        // (mirroring My Shifts) and scopes BOTH sub-tabs to one Mon-Sun week.
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when (sub) {
                OPEN_SUB_HOME ->
                    HomeOpenTabContent(
                        tab = state.homeOpen,
                        vm = vm,
                        calendarVm = calendarVm,
                        currentWeeklyHours = currentWeeklyHours,
                        onClaimed = onClaimed,
                        onClaimShift = onClaimShift,
                        onPickUpPermanent = onPickUpPermanent,
                        loadPermanentScope = loadPermanentScope,
                    )
                else ->
                    OtherHousesTabContent(
                        tab = state.otherHouses,
                        vm = vm,
                        calendarVm = calendarVm,
                        currentWeeklyHours = currentWeeklyHours,
                        onClaimed = onClaimed,
                        onClaimShift = onClaimShift,
                        onPickUpPermanent = onPickUpPermanent,
                        loadPermanentScope = loadPermanentScope,
                    )
            }
        }
        WeekNavBar(
            title = weekOffsetTitle(state.openWeekOffset),
            rangeLabel = state.openWeekRangeLabel,
            onOpenPicker = { showWeekPicker = true },
            onPreviousWeek = vm::previousOpenWeek,
            onNextWeek = vm::nextOpenWeek,
            pickerTag = "open_week_picker_open",
            prevTag = "open_prev_week",
            nextTag = "open_next_week",
        )
    }

    if (showWeekPicker) {
        WeekPickerSheet(
            options = vm.openWeekOptions(),
            currentOffset = state.openWeekOffset,
            onPick = { offset ->
                vm.selectOpenWeekOffset(offset)
                showWeekPicker = false
            },
            onDismiss = { showWeekPicker = false },
            sheetTag = "open_week_picker_sheet",
            optionTag = "open_week_picker_option",
        )
    }
}

// ===================================================================
// Tab 2 — Open Shifts in My House (§5.6 Tab 2 / §5.1).
// ===================================================================

/**
 * Route a confirmed open-shift pickup to the right live write, then do the optimistic local
 * move. A WEEKLY opening → `claim-shift` ([onClaimShift]); a PERMANENT opening → the
 * `permanent-pickup` EF ([onPickUpPermanent], the real path — `claim-shift`'s permanent
 * branch 501s). The ViewModel's optimistic [ShiftsScreenViewModel.claim] is the same local
 * move for both (decision #13); the server stays authoritative and the next Realtime
 * snapshot reconciles. Shared by Tab 2 and Tab 3.
 */
internal fun confirmOpenShift(
    shift: OpenShift,
    vm: ShiftsScreenViewModel,
    calendarVm: CalendarViewModel,
    onClaimShift: (OpenShift) -> Unit,
    onPickUpPermanent: (OpenShift) -> Unit,
    successMessage: String,
    onClaimed: (String) -> Unit,
) {
    if (shift.feed == OpenFeed.PERMANENT_OPENING) onPickUpPermanent(shift) else onClaimShift(shift)
    vm.claim(shift)
    // Mirror the pickup into the calendar ("My Shifts") so the claimed shift shows in the
    // agenda — and a re-pickup of a shift dropped here un-hides it.
    calendarVm.claim(shift)
    onClaimed(successMessage)
}

@Composable
internal fun HomeOpenTabContent(
    tab: HomeOpenShiftsTab,
    vm: ShiftsScreenViewModel,
    calendarVm: CalendarViewModel,
    currentWeeklyHours: Double,
    onClaimed: (String) -> Unit,
    onClaimShift: (OpenShift) -> Unit = {},
    onPickUpPermanent: (OpenShift) -> Unit = {},
    loadPermanentScope: suspend (OpenShift) -> PermanentPickupScope? = { null },
) {
    var claimTarget by remember { mutableStateOf<OpenShift?>(null) }
    // Split the shown-week feed: upcoming shifts in the live section, already-started
    // ones in a collapsed-by-default "Earlier this week" card (greyed).
    val weeklySplit = remember(tab.weekly) { vm.pastUpcoming(tab.weekly) }

    LazyColumn(
        Modifier.fillMaxSize().background(ShiftTheme.colors.bg),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(22.dp),
    ) {
        item {
            ShiftSection(
                title = "Weekly open shifts",
                isEmpty = weeklySplit.upcoming.isEmpty(),
                modifier = Modifier.testTag("home_weekly_feed"),
                count = weeklySplit.upcoming.size,
                emptyText = "No open shifts in your house this week.",
                prominent = true,
                icon = ShiftIcons.Calendar,
                accent = ShiftTheme.colors.pickupDot,
            ) {
                ShiftCardColumn { weeklySplit.upcoming.forEach { OpenFeedCard(it, vm) { claimTarget = it } } }
            }
        }
        if (weeklySplit.past.isNotEmpty()) {
            item {
                PastOpenShiftsSection(past = weeklySplit.past, vm = vm) { claimTarget = it }
            }
        }
        item {
            ShiftSection(
                title = "Permanent openings",
                isEmpty = tab.permanentOpenings.isEmpty(),
                modifier = Modifier.testTag("home_permanent_feed"),
                count = tab.permanentOpenings.size,
                emptyText = "No permanent openings right now.",
                prominent = true,
                icon = ShiftIcons.Refresh,
                accent = ShiftTheme.colors.permanent.accent,
            ) {
                ShiftCardColumn { tab.permanentOpenings.forEach { OpenFeedCard(it, vm) { claimTarget = it } } }
            }
        }
    }

    claimTarget?.let { shift ->
        ClaimSheet(
            shift = shift,
            vm = vm,
            currentWeeklyHours = currentWeeklyHours,
            loadPermanentScope = loadPermanentScope,
            onConfirmed = { effective, message ->
                confirmOpenShift(effective, vm, calendarVm, onClaimShift, onPickUpPermanent, message, onClaimed)
            },
            onDismiss = { claimTarget = null },
        )
    }
}

@Composable
internal fun OtherHousesTabContent(
    tab: OtherHousesTab,
    vm: ShiftsScreenViewModel,
    calendarVm: CalendarViewModel,
    currentWeeklyHours: Double,
    onClaimed: (String) -> Unit,
    onClaimShift: (OpenShift) -> Unit = {},
    onPickUpPermanent: (OpenShift) -> Unit = {},
    loadPermanentScope: suspend (OpenShift) -> PermanentPickupScope? = { null },
) {
    var claimTarget by remember { mutableStateOf<OpenShift?>(null) }
    // Screen-local UI state (the ViewModel stays data-only): the by-house / by-day sort
    // and the per-group collapsed set. Groups default to expanded; keys differ between the
    // two sort modes (house id vs "dow-N"), so switching sort naturally resets to expanded.
    var sortBy by remember { mutableStateOf(OpenShiftSort.BY_HOUSE) }
    val expanded = remember { mutableStateMapOf<String, Boolean>() }
    // Split the shown-week cross-house feed: upcoming ones group/sort as before, the
    // already-started ones go into the collapsed "Earlier this week" card.
    val split = remember(tab.openShifts) { vm.pastUpcoming(tab.openShifts) }
    val upcomingTab = remember(split.upcoming) { OtherHousesTab(split.upcoming) }
    val groups = remember(upcomingTab, sortBy) { upcomingTab.grouped(sortBy) }

    LazyColumn(
        Modifier.fillMaxSize().background(ShiftTheme.colors.bg).testTag("other_houses_tab"),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        if (tab.isEmpty) {
            // §5.6 / decision #6 — no eligible cross-house feed (e.g. winter break).
            item {
                EmptyState(
                    title = "No eligible shifts elsewhere",
                    icon = ShiftIcons.Building,
                    body = "No open shifts at houses you can pick up at right now. Common during winter break.",
                )
            }
        } else {
            item {
                SegmentedControl(
                    options = listOf("By house", "By day"),
                    selectedIndex = if (sortBy == OpenShiftSort.BY_HOUSE) 0 else 1,
                    onSelect = { sortBy = if (it == 0) OpenShiftSort.BY_HOUSE else OpenShiftSort.BY_DAY },
                    modifier = Modifier.testTag("other_houses_sort"),
                )
            }
            groups.forEach { group ->
                item(key = "${sortBy.name}-${group.key}") {
                    CollapsibleGroup(
                        group = group,
                        sortBy = sortBy,
                        expanded = expanded[group.key] ?: true,
                        onToggle = { expanded[group.key] = !(expanded[group.key] ?: true) },
                    ) {
                        ShiftCardColumn {
                            group.shifts.forEach { OpenFeedCard(it, vm) { claimTarget = it } }
                        }
                    }
                }
            }
            if (split.past.isNotEmpty()) {
                item { PastOpenShiftsSection(past = split.past, vm = vm) { claimTarget = it } }
            }
        }
    }

    claimTarget?.let { shift ->
        ClaimSheet(
            shift = shift,
            vm = vm,
            currentWeeklyHours = currentWeeklyHours,
            loadPermanentScope = loadPermanentScope,
            onConfirmed = { effective, message ->
                confirmOpenShift(effective, vm, calendarVm, onClaimShift, onPickUpPermanent, message, onClaimed)
            },
            onDismiss = { claimTarget = null },
        )
    }
}
