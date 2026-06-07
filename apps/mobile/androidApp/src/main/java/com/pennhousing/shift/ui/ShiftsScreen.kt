package com.pennhousing.shift.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryScrollableTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pennhousing.shift.shared.calendar.CalendarAgenda
import com.pennhousing.shift.shared.calendar.CalendarDayHeader
import com.pennhousing.shift.shared.calendar.CalendarWeek
import com.pennhousing.shift.shared.calendar.WeekDayCell
import com.pennhousing.shift.shared.data.ToastNotification
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.model.OpenShift
import com.pennhousing.shift.shared.notifications.NotificationCategory
import com.pennhousing.shift.shared.notifications.NotificationRow
import com.pennhousing.shift.shared.notifications.UpdatesFeed
import com.pennhousing.shift.shared.shifts.ClaimCapVerdict
import com.pennhousing.shift.shared.shifts.ClaimMeter
import com.pennhousing.shift.shared.shifts.HomeOpenShiftsTab
import com.pennhousing.shift.shared.shifts.MyShiftCardState
import com.pennhousing.shift.shared.shifts.MyShiftRow
import com.pennhousing.shift.shared.shifts.MyShiftsTab
import com.pennhousing.shift.shared.shifts.OpenShiftCardState
import com.pennhousing.shift.shared.shifts.OpenShiftRow
import com.pennhousing.shift.shared.shifts.OtherHousesTab
import com.pennhousing.shift.shared.shifts.claimMeter
import com.pennhousing.shift.shared.shifts.hoursBetween
import com.pennhousing.shift.shared.shifts.toRow
import com.pennhousing.shift.shared.shifts.weeklyHoursSummary
import com.pennhousing.shift.shared.viewmodel.AckDeclineViewModel
import com.pennhousing.shift.shared.viewmodel.BreakClaimViewModel
import com.pennhousing.shift.shared.viewmodel.CalendarViewModel
import com.pennhousing.shift.shared.viewmodel.PreferencesViewModel
import com.pennhousing.shift.shared.viewmodel.ShiftsScreenViewModel
import com.pennhousing.shift.shared.viewmodel.ShiftsTab
import com.pennhousing.shift.shared.viewmodel.UpdatesViewModel
import com.pennhousing.shift.ui.kit.BannerTone
import com.pennhousing.shift.ui.kit.ButtonSize
import com.pennhousing.shift.ui.kit.ButtonVariant
import com.pennhousing.shift.ui.kit.EmptyState
import com.pennhousing.shift.ui.kit.HouseBadge
import com.pennhousing.shift.ui.kit.SectionHeader
import com.pennhousing.shift.ui.kit.ShiftBanner
import com.pennhousing.shift.ui.kit.ShiftBottomSheet
import com.pennhousing.shift.ui.kit.ShiftButton
import com.pennhousing.shift.ui.kit.ShiftCard
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.kit.ShiftSection
import com.pennhousing.shift.ui.kit.ShiftState
import com.pennhousing.shift.ui.kit.ShiftToast
import com.pennhousing.shift.ui.kit.ToastTone
import com.pennhousing.shift.ui.theme.ShiftTheme

private const val TAB_MY = 0
private const val TAB_HOME = 1
private const val TAB_OTHER = 2
private const val TAB_CALENDAR = 3
private const val TAB_UPDATES = 4
private const val TAB_PREFS = 5
private const val TAB_BREAK = 6

/**
 * Phase 13a — the worker's Shifts screen (BEHAVIORAL_SPECIFICATION.md §5.6).
 *
 * The three spec tabs (My Shifts / Open in My House / Open in Other Houses) plus
 * an Updates tab where a pending float surfaces (the ack/decline modal opens from
 * it). All decision logic comes from the shared [ShiftsScreenViewModel]; this is
 * native Compose UI over it (the Fruitties split). Selector ids match
 * `apps/mobile/maestro/README.md`.
 */
@Composable
fun ShiftsApp(
    shiftsVm: ShiftsScreenViewModel,
    ackVm: AckDeclineViewModel,
    updatesVm: UpdatesViewModel,
    calendarVm: CalendarViewModel,
    preferencesVm: PreferencesViewModel,
    breakClaimVm: BreakClaimViewModel,
    currentWeeklyHours: Double,
    breakProfile: Boolean = false,
    toast: ToastNotification? = null,
) {
    ShiftTheme {
        val state by shiftsVm.uiState.collectAsStateWithLifecycle()
        val updatesState by updatesVm.uiState.collectAsStateWithLifecycle()
        var selectedIndex by remember { mutableIntStateOf(TAB_MY) }
        var showAckModal by remember { mutableStateOf(false) }
        var claimSuccess by remember { mutableStateOf(false) }

        Scaffold(modifier = Modifier.fillMaxSize().testTag("shifts_screen")) { padding ->
            Column(Modifier.fillMaxSize().padding(padding)) {
                toast?.let { NotificationToast(it) }
                if (claimSuccess) {
                    // §5.6 #1 — the sheet dismisses on confirm (so the tab bar stays
                    // reachable for the Maestro flow); this top success toast carries
                    // the `claim_success` selector and the "now in My Shifts" feedback.
                    ShiftToast(
                        message = "Claimed — it's now in My Shifts",
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp, vertical = 8.dp)
                                .testTag("claim_success"),
                        tone = ToastTone.Success,
                        icon = ShiftIcons.Check,
                    )
                }

                PrimaryScrollableTabRow(selectedTabIndex = selectedIndex, edgePadding = 0.dp) {
                    SpecTab("My Shifts", "tab_my_shifts", selectedIndex == TAB_MY) {
                        selectedIndex = TAB_MY
                        shiftsVm.selectTab(ShiftsTab.MY_SHIFTS)
                    }
                    SpecTab("Open Shifts in My House", "tab_open_home", selectedIndex == TAB_HOME) {
                        selectedIndex = TAB_HOME
                        shiftsVm.selectTab(ShiftsTab.OPEN_HOME)
                    }
                    SpecTab("Open Shifts in Other Houses", "tab_open_other", selectedIndex == TAB_OTHER) {
                        selectedIndex = TAB_OTHER
                        shiftsVm.selectTab(ShiftsTab.OPEN_OTHER)
                    }
                    SpecTab("Calendar", "tab_calendar", selectedIndex == TAB_CALENDAR) {
                        selectedIndex = TAB_CALENDAR
                    }
                    SpecTab("Updates", "tab_updates", selectedIndex == TAB_UPDATES) {
                        selectedIndex = TAB_UPDATES
                    }
                    SpecTab("Preferences", "tab_preferences", selectedIndex == TAB_PREFS) {
                        selectedIndex = TAB_PREFS
                    }
                    SpecTab("Break shifts", "tab_break", selectedIndex == TAB_BREAK) {
                        selectedIndex = TAB_BREAK
                    }
                }

                when (selectedIndex) {
                    TAB_MY -> MyShiftsTabContent(state.myShifts, shiftsVm, currentWeeklyHours, breakProfile)
                    TAB_HOME ->
                        HomeOpenTabContent(
                            tab = state.homeOpen,
                            vm = shiftsVm,
                            currentWeeklyHours = currentWeeklyHours,
                            breakProfile = breakProfile,
                            onClaimed = { claimSuccess = true },
                        )
                    TAB_OTHER ->
                        OtherHousesTabContent(
                            tab = state.otherHouses,
                            vm = shiftsVm,
                            currentWeeklyHours = currentWeeklyHours,
                            breakProfile = breakProfile,
                            onClaimed = { claimSuccess = true },
                        )
                    TAB_CALENDAR -> CalendarTabContent(calendarVm)
                    TAB_UPDATES ->
                        UpdatesTabContent(
                            feed = updatesState.feed,
                            onOpenAck = { showAckModal = true },
                        )
                    TAB_PREFS -> PreferencesTabContent(preferencesVm)
                    TAB_BREAK -> BreakClaimTabContent(breakClaimVm)
                }
            }
        }

        if (showAckModal) {
            FloatAcknowledgmentModal(ackVm) { showAckModal = false }
        }
    }
}

@Composable
private fun SpecTab(
    title: String,
    tag: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Tab(
        selected = selected,
        onClick = onClick,
        modifier = Modifier.testTag(tag),
        text = { Text(title, maxLines = 1) },
    )
}

/** Deliverable #7 — top-of-screen toast for a new Realtime `notifications` row. */
@Composable
private fun NotificationToast(toast: ToastNotification) {
    Surface(
        color = MaterialTheme.colorScheme.primaryContainer,
        modifier = Modifier.fillMaxWidth().testTag("notification_toast"),
    ) {
        Column(Modifier.padding(12.dp)) {
            Text(toast.title, fontWeight = FontWeight.SemiBold)
            if (toast.body.isNotBlank()) Text(toast.body)
        }
    }
}

// ===================================================================
// Tab 1 — My Shifts: three subsections, top → bottom (§5.6).
// ===================================================================

@Composable
private fun MyShiftsTabContent(
    tab: MyShiftsTab,
    vm: ShiftsScreenViewModel,
    currentWeeklyHours: Double,
    breakProfile: Boolean,
) {
    var dropTarget by remember { mutableStateOf<MyShift?>(null) }

    // §5.6 Tab 1 order (top→bottom): picked-up, dropped, scheduled. (The design's
    // visual order is scheduled-first, but the spec + Maestro contract pin this order.)
    LazyColumn(
        Modifier.fillMaxSize().background(ShiftTheme.colors.bg),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(22.dp),
    ) {
        item { WeekTotalChip(currentWeeklyHours, breakProfile) }
        item {
            ShiftSection(
                title = "Picked up",
                isEmpty = tab.pickedUp.isEmpty(),
                modifier = Modifier.testTag("section_picked_up"),
                count = tab.pickedUp.size,
                emptyText = "Nothing picked up. Browse Open Shifts to claim.",
            ) {
                ShiftCardColumn { tab.pickedUp.forEach { MyShiftCardItem(it, "picked_up_shift_card", onClick = { dropTarget = it }) } }
            }
        }
        item {
            ShiftSection(
                title = "Dropped — still open",
                isEmpty = tab.dropped.isEmpty(),
                modifier = Modifier.testTag("section_dropped"),
                count = tab.dropped.size,
                emptyText = "Nothing dropped. 👍",
            ) {
                ShiftCardColumn { tab.dropped.forEach { MyShiftCardItem(it, "dropped_shift_card", reclaim = { vm.reclaim(it.id) }) } }
            }
        }
        item {
            ShiftSection(
                title = "Scheduled",
                isEmpty = tab.scheduled.isEmpty(),
                modifier = Modifier.testTag("section_scheduled"),
                count = tab.scheduled.size,
                emptyText = "No scheduled shifts.",
            ) {
                ShiftCardColumn { tab.scheduled.forEach { MyShiftCardItem(it, "scheduled_shift_card", onClick = { dropTarget = it }) } }
            }
        }
    }

    dropTarget?.let { shift ->
        DropSheet(shift = shift, vm = vm, breakProfile = breakProfile, onDismiss = { dropTarget = null })
    }
}

@Composable
private fun ShiftCardColumn(content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) { content() }
}

/** The "This week — 14h of 20h soft cap" summary chip (design My-Shifts header). */
@Composable
private fun WeekTotalChip(
    currentWeeklyHours: Double,
    breakProfile: Boolean,
) {
    val c = ShiftTheme.colors
    val summary = remember(currentWeeklyHours, breakProfile) { weeklyHoursSummary(currentWeeklyHours, breakProfile) }
    val mono = ShiftTheme.type.monoTime.copy(fontSize = 13.5.sp)
    Row(
        Modifier
            .fillMaxWidth()
            .background(c.surface, RoundedCornerShape(12.dp))
            .border(1.dp, c.divider, RoundedCornerShape(12.dp))
            .padding(horizontal = 13.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(ShiftIcons.Clock, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(17.dp))
        Text("This week", color = c.sec, fontSize = 13.5.sp, fontWeight = FontWeight.Medium)
        Spacer(Modifier.weight(1f))
        Text(summary.current, style = mono, color = c.ink)
        Text(summary.capLabel, style = mono.copy(fontWeight = FontWeight.Normal), color = c.ter)
    }
}

/** One My-Shifts card, driven by the shared [com.pennhousing.shift.shared.shifts.toRow] row model. */
@Composable
private fun MyShiftCardItem(
    shift: MyShift,
    tag: String,
    onClick: (() -> Unit)? = null,
    reclaim: (() -> Unit)? = null,
) {
    val row = remember(shift) { shift.toRow() }
    ShiftCard(
        state = row.state.toKitState(),
        houseInitial = row.houseInitial,
        timeLabel = row.timeLabel,
        modifier = Modifier.testTag(tag),
        houseName = row.houseName,
        destination = row.destination,
        durationLabel = row.durationLabel,
        meta = row.dayLabel,
        onClick = onClick,
        action =
            if (reclaim != null) {
                { ShiftButton("Reclaim", reclaim, variant = ButtonVariant.Tonal, size = ButtonSize.Sm) }
            } else {
                null
            },
    )
}

private fun MyShiftCardState.toKitState(): ShiftState =
    when (this) {
        MyShiftCardState.SCHEDULED -> ShiftState.SCHEDULED
        MyShiftCardState.PICKUP_HOME -> ShiftState.PICKUP_HOME
        MyShiftCardState.PICKUP_CROSS -> ShiftState.PICKUP_CROSS
        MyShiftCardState.FLOAT_OUT -> ShiftState.FLOAT_OUT
        MyShiftCardState.PENDING_FLOAT -> ShiftState.PENDING_FLOAT
        MyShiftCardState.BREAK_SHIFT -> ShiftState.BREAK
        MyShiftCardState.DROPPED -> ShiftState.DROPPED
    }

// ===================================================================
// Tab 2 — Open Shifts in My House (§5.6 Tab 2 / §5.1).
// ===================================================================

@Composable
private fun HomeOpenTabContent(
    tab: HomeOpenShiftsTab,
    vm: ShiftsScreenViewModel,
    currentWeeklyHours: Double,
    breakProfile: Boolean,
    onClaimed: () -> Unit,
) {
    var claimTarget by remember { mutableStateOf<OpenShift?>(null) }

    LazyColumn(
        Modifier.fillMaxSize().background(ShiftTheme.colors.bg),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(22.dp),
    ) {
        item {
            ShiftSection(
                title = "Weekly open shifts",
                isEmpty = tab.weekly.isEmpty(),
                modifier = Modifier.testTag("home_weekly_feed"),
                count = tab.weekly.size,
                emptyText = "No open shifts in your house this week.",
            ) {
                ShiftCardColumn { tab.weekly.forEach { OpenFeedCard(it, vm) { claimTarget = it } } }
            }
        }
        item {
            ShiftSection(
                title = "Permanent openings",
                isEmpty = tab.permanentOpenings.isEmpty(),
                modifier = Modifier.testTag("home_permanent_feed"),
                count = tab.permanentOpenings.size,
                emptyText = "No permanent openings right now.",
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
            breakProfile = breakProfile,
            onConfirmed = {
                vm.claim(shift)
                onClaimed()
            },
            onDismiss = { claimTarget = null },
        )
    }
}

/**
 * One open-shift feed card, driven by the shared
 * [com.pennhousing.shift.shared.shifts.toRow]: OPEN → Claim (filled), PERMANENT →
 * Pick up (tonal), UNPICKABLE → no action + "Locked" meta (§5.4 keeps the gap
 * visible past T-2h, withholding only the action). The card root + the action carry
 * the `open_shift_card` / `claim_button` selectors.
 */
@Composable
private fun OpenFeedCard(
    shift: OpenShift,
    vm: ShiftsScreenViewModel,
    onClaim: () -> Unit,
) {
    val claimable = vm.claimable(shift)
    val row = remember(shift, claimable) { shift.toRow(claimable) }
    ShiftCard(
        state = row.state.toKitState(),
        houseInitial = row.houseInitial,
        timeLabel = row.timeLabel,
        modifier = Modifier.testTag("open_shift_card"),
        eyebrow = row.dayLabel,
        houseName = row.houseName,
        durationLabel = row.durationLabel,
        meta = row.meta,
        action =
            row.actionLabel?.let { label ->
                {
                    ShiftButton(
                        label,
                        onClaim,
                        modifier = Modifier.testTag("claim_button"),
                        variant = if (row.state == OpenShiftCardState.PERMANENT) ButtonVariant.Tonal else ButtonVariant.Filled,
                        size = ButtonSize.Sm,
                    )
                }
            },
    )
}

private fun OpenShiftCardState.toKitState(): ShiftState =
    when (this) {
        OpenShiftCardState.OPEN -> ShiftState.OPEN
        OpenShiftCardState.UNPICKABLE -> ShiftState.UNPICKABLE
        OpenShiftCardState.PERMANENT -> ShiftState.PERMANENT
    }

// ===================================================================
// Claim flow (§5.3 / §5.4) — the design `ClaimSheet`.
// ===================================================================

/**
 * The claim / pick-up sheet (worker-app.html `ClaimSheet`): a shift summary, the
 * "this brings your week to Xh of Yh" hours meter, and the §5.3 cap gating. A
 * soft-cap claim is a two-step confirm (warning banner → "Claim anyway" →
 * `claim_confirm_button`) so the Maestro `soft_cap_*` contract holds; a break
 * hard-cap claim disables the confirm. On confirm the sheet dismisses and the
 * screen shows the `claim_success` toast — the picked-up shift is already in My
 * Shifts (the optimistic [ShiftsScreenViewModel.claim], decision #13).
 */
@Composable
private fun ClaimSheet(
    shift: OpenShift,
    vm: ShiftsScreenViewModel,
    currentWeeklyHours: Double,
    breakProfile: Boolean,
    onConfirmed: () -> Unit,
    onDismiss: () -> Unit,
) {
    val c = ShiftTheme.colors
    val claimable = vm.claimable(shift)
    val row = remember(shift, claimable) { shift.toRow(claimable) }
    val permanent = row.state == OpenShiftCardState.PERMANENT
    val meter =
        remember(shift, currentWeeklyHours, breakProfile) {
            claimMeter(currentWeeklyHours, hoursBetween(shift.start, shift.end), breakProfile)
        }
    val overHard = meter.verdict == ClaimCapVerdict.HARD_CAP_BLOCKED
    val overSoft = meter.verdict == ClaimCapVerdict.SOFT_CAP_WARNING
    var warningAccepted by remember { mutableStateOf(false) }

    ShiftBottomSheet(onDismiss = onDismiss, title = if (permanent) "Pick up permanently" else "Claim shift") {
        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
            // Shift summary — badge + mono time + house · duration · day.
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                HouseBadge(
                    row.houseInitial,
                    if (permanent) c.permanent.tint else c.surfaceVar,
                    if (permanent) c.permanent.deep else c.ink,
                )
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(row.timeLabel, style = ShiftTheme.type.monoTimeHero.copy(fontSize = 20.sp), color = c.ink)
                    Text("${row.houseName} · ${row.durationLabel} · ${row.dayLabel}", color = c.sec, fontSize = 13.5.sp)
                }
            }

            if (permanent) PermanentRecurringNote(row)

            ClaimHoursMeter(meter)

            if (overSoft) {
                ShiftBanner(
                    title = "Puts you over the 20h soft cap",
                    body = "Allowed this period, but your manager sees the overage.",
                    tone = BannerTone.Warning,
                    modifier = Modifier.testTag("soft_cap_warning_modal"),
                )
            }
            if (overHard) {
                ShiftBanner(
                    title = "Over the 40h limit — can't claim",
                    body = "Break-period hard cap. Drop another shift first.",
                    tone = BannerTone.Error,
                )
            }

            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                ShiftButton("Cancel", onDismiss, modifier = Modifier.weight(1f), variant = ButtonVariant.Outlined)
                if (overSoft && !warningAccepted) {
                    ShiftButton(
                        "Claim anyway",
                        onClick = { warningAccepted = true },
                        modifier = Modifier.weight(1f).testTag("soft_cap_confirm_button"),
                    )
                } else {
                    ShiftButton(
                        if (permanent) "Confirm pickup" else "Claim shift",
                        onClick = {
                            onConfirmed()
                            onDismiss()
                        },
                        modifier = Modifier.weight(1f).testTag("claim_confirm_button"),
                        enabled = !overHard,
                    )
                }
            }
        }
    }
}

/** The "this brings your week to {after}h of {cap}h" meter + progress bar (§5.3 caps). */
@Composable
private fun ClaimHoursMeter(meter: ClaimMeter) {
    val c = ShiftTheme.colors
    val overHard = meter.verdict == ClaimCapVerdict.HARD_CAP_BLOCKED
    val overSoft = meter.verdict == ClaimCapVerdict.SOFT_CAP_WARNING
    val emphasis =
        when {
            overHard -> c.danger.accent
            overSoft -> c.pending
            else -> c.ink
        }
    val barColor = if (overHard) {
        c.danger.accent
    } else if (overSoft) {
        c.pending
    } else {
        MaterialTheme.colorScheme.primary
    }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("This brings your week to", color = c.sec, fontSize = 13.sp, fontWeight = FontWeight.Medium)
            Text(
                "${meter.afterLabel} of ${meter.capLabel}",
                style = ShiftTheme.type.monoTime.copy(fontSize = 13.sp, fontWeight = FontWeight.SemiBold),
                color = emphasis,
            )
        }
        Box(
            Modifier
                .fillMaxWidth()
                .height(8.dp)
                .clip(RoundedCornerShape(50))
                .background(c.surfaceVar),
        ) {
            // Where you are now (ghost), then where this claim takes you (colored).
            Box(
                Modifier
                    .fillMaxWidth(meter.currentFraction.toFloat())
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(50))
                    .background(c.ink.copy(alpha = 0.22f)),
            )
            Box(
                Modifier
                    .fillMaxWidth(meter.afterFraction.toFloat())
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(50))
                    .background(barColor),
            )
        }
    }
}

/** The recurring-slot note shown when picking up a permanent opening (design `ClaimSheet`). */
@Composable
private fun PermanentRecurringNote(row: OpenShiftRow) {
    val c = ShiftTheme.colors
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(c.permanent.tint)
            .padding(horizontal = 13.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Text("Recurring · ${row.dayLabel} · ${row.timeLabel}", color = c.permanent.deep, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        row.meta?.let { Text("Repeats weekly — $it.", color = c.sec, fontSize = 12.5.sp) }
    }
}

// ===================================================================
// Tab 3 — Open Shifts in Other Houses (§5.6 Tab 3).
// ===================================================================

@Composable
private fun OtherHousesTabContent(
    tab: OtherHousesTab,
    vm: ShiftsScreenViewModel,
    currentWeeklyHours: Double,
    breakProfile: Boolean,
    onClaimed: () -> Unit,
) {
    var claimTarget by remember { mutableStateOf<OpenShift?>(null) }

    LazyColumn(
        Modifier.fillMaxSize().background(ShiftTheme.colors.bg).testTag("other_houses_tab"),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(22.dp),
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
            tab.groups.forEach { group ->
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        SectionHeader(group.house.name, count = group.weekly.size + group.permanentOpenings.size)
                        ShiftCardColumn {
                            group.weekly.forEach { OpenFeedCard(it, vm) { claimTarget = it } }
                            group.permanentOpenings.forEach { OpenFeedCard(it, vm) { claimTarget = it } }
                        }
                    }
                }
            }
        }
    }

    claimTarget?.let { shift ->
        ClaimSheet(
            shift = shift,
            vm = vm,
            currentWeeklyHours = currentWeeklyHours,
            breakProfile = breakProfile,
            onConfirmed = {
                vm.claim(shift)
                onClaimed()
            },
            onDismiss = { claimTarget = null },
        )
    }
}

// ===================================================================
// Updates tab — §10.1 notifications feed + the §7 pending-float entry (Maestro 04).
// ===================================================================

/**
 * The Updates feed (worker-app.html `UpdatesScreen`): Today / Earlier groups of
 * notification rows (shared, tested [com.pennhousing.shift.shared.notifications.buildUpdatesFeed]).
 * The urgent float-assignment row carries the `pending_float_notification` selector and
 * opens the ack hero. Empty → "You're all caught up". (No "mark all read" — workers
 * have no UPDATE policy on `notifications`; the unread dots are read-only.)
 */
@Composable
private fun UpdatesTabContent(
    feed: UpdatesFeed,
    onOpenAck: () -> Unit,
) {
    if (feed.isEmpty) {
        Column(Modifier.fillMaxSize().background(ShiftTheme.colors.bg).padding(top = 40.dp)) {
            EmptyState(
                title = "You're all caught up",
                icon = ShiftIcons.Bell,
                body = "No new notifications. Float assignments and reminders show up here.",
            )
        }
        return
    }
    LazyColumn(
        Modifier.fillMaxSize().background(ShiftTheme.colors.bg),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(22.dp),
    ) {
        if (feed.today.isNotEmpty()) {
            item { NotificationGroup("Today", feed.today, onOpenAck) }
        }
        if (feed.earlier.isNotEmpty()) {
            item { NotificationGroup("Earlier", feed.earlier, onOpenAck) }
        }
    }
}

@Composable
private fun NotificationGroup(
    title: String,
    rows: List<NotificationRow>,
    onOpenAck: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SectionHeader(title)
        rows.forEach { NotificationCard(it, onOpenAck) }
    }
}

/** One Updates row (worker-app.html `UpdateRow`). Urgent → float-tint card + left accent + "Action needed". */
@Composable
private fun NotificationCard(
    row: NotificationRow,
    onOpenAck: () -> Unit,
) {
    val c = ShiftTheme.colors
    val (icon, accent) =
        when (row.category) {
            NotificationCategory.FLOAT -> ShiftIcons.FloatOut to c.floatOut.accent
            NotificationCategory.REMINDER -> ShiftIcons.Warning to c.pending
            NotificationCategory.SHIFT_REMOVED -> ShiftIcons.ArrowDown to c.sec
            NotificationCategory.PERMANENT -> ShiftIcons.Refresh to c.permanent.accent
            NotificationCategory.PREFERENCES -> ShiftIcons.CheckCircle to c.success.accent
            NotificationCategory.SWAP -> ShiftIcons.Refresh to c.floatIn.accent
            NotificationCategory.INFO -> ShiftIcons.Bell to c.pickupDot
        }
    val shape = RoundedCornerShape(14.dp)
    var box = Modifier.fillMaxWidth().clip(shape).background(if (row.urgent) c.floatSoft else c.surface)
    box = if (row.urgent) box else box.border(1.dp, c.divider, shape)
    if (row.opensAck) box = box.clickable(onClick = onOpenAck).testTag("pending_float_notification")

    Box(box) {
        if (row.urgent) {
            Box(
                Modifier
                    .align(Alignment.CenterStart)
                    .width(4.dp)
                    .fillMaxHeight()
                    .background(c.floatOut.accent),
            )
        }
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 13.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(
                Modifier.size(38.dp).clip(RoundedCornerShape(10.dp)).background(accent.copy(alpha = 0.10f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, contentDescription = null, tint = accent, modifier = Modifier.size(19.dp))
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    Text(
                        row.title,
                        modifier = Modifier.weight(1f, fill = false),
                        color = c.ink,
                        fontSize = 14.5.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                    if (row.unread) Box(Modifier.size(7.dp).clip(RoundedCornerShape(50)).background(c.pickupDot))
                }
                if (row.urgent) ActionNeededTag()
                Text(row.body, color = c.sec, fontSize = 13.sp, lineHeight = 18.sp)
            }
            Text(row.timeLabel, style = ShiftTheme.type.monoId.copy(fontSize = 11.5.sp), color = c.ter)
        }
    }
}

/** The "Action needed" pill on an urgent (float) update — color + icon + text. */
@Composable
private fun ActionNeededTag() {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .clip(RoundedCornerShape(50))
            .background(c.floatOut.badge)
            .padding(start = 6.dp, top = 3.dp, end = 8.dp, bottom = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(ShiftIcons.Warning, contentDescription = null, tint = c.floatOut.deep, modifier = Modifier.size(13.dp))
        Text("Action needed", color = c.floatOut.deep, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    }
}

// ===================================================================
// Calendar tab — agenda-first Personal Calendar (current week only).
// ===================================================================

/**
 * The Personal Calendar (worker-app.html `CalendarScreen`, agenda-first): a static
 * "this week" header (NO week-picker — only the current week is exposed; arbitrary
 * weeks + the permanent template have no data), a Mon–Sun strip, and the selected
 * day's agenda with a live NOW line. All from the shared, tested
 * [com.pennhousing.shift.shared.calendar.buildCalendarWeek] / `buildCalendarAgenda`
 * over the same `MyShift` snapshot the Shifts screen renders.
 */
@Composable
private fun CalendarTabContent(vm: CalendarViewModel) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    val c = ShiftTheme.colors
    Column(Modifier.fillMaxSize().background(c.bg).testTag("calendar_screen")) {
        WeekHeaderCard(state.week.rangeLabel)
        WeekStrip(state.week, state.selectedDayIndex, vm::selectDay)
        DayHeaderRow(state.agenda.header)
        if (state.agenda.isEmpty) {
            EmptyState(
                title = "No shifts this day",
                icon = ShiftIcons.Calendar,
                body = "Enjoy the day off — or browse Open Shifts to pick one up.",
            )
        } else {
            LazyColumn(
                Modifier.fillMaxSize().testTag("calendar_agenda"),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
            ) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        state.agenda.items.forEach { item ->
                            val now = item.nowLabel
                            val shift = item.shift
                            if (now != null) {
                                NowLine(now)
                            } else if (shift != null) {
                                AgendaShiftCard(shift, item.active)
                            }
                        }
                    }
                }
            }
        }
    }
}

/** The static "this week" header (the design's week-picker card, sans picker — no other weeks). */
@Composable
private fun WeekHeaderCard(rangeLabel: String) {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(c.surface)
            .border(1.dp, c.divider, RoundedCornerShape(14.dp))
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier.size(38.dp).clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.primaryContainer),
            contentAlignment = Alignment.Center,
        ) {
            Icon(ShiftIcons.Calendar, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(19.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text("This week", color = c.ink, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            Text(rangeLabel, color = c.sec, fontSize = 13.sp)
        }
    }
}

/** Mon–Sun day picker: weekday letter, a date pill (selected fill / today ring), a shift dot. */
@Composable
private fun WeekStrip(
    week: CalendarWeek,
    selected: Int,
    onSelect: (Int) -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().testTag("calendar_week_strip").padding(horizontal = 12.dp, vertical = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        week.days.forEach { day ->
            WeekDayCellView(day, day.index == selected, Modifier.weight(1f)) { onSelect(day.index) }
        }
    }
}

@Composable
private fun WeekDayCellView(
    day: WeekDayCell,
    selected: Boolean,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    val c = ShiftTheme.colors
    val blue = MaterialTheme.colorScheme.primary
    Column(
        modifier
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .testTag("calendar_day_cell")
            .padding(vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(day.dayLetter, color = c.ter, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
        Box(
            Modifier
                .size(34.dp)
                .clip(RoundedCornerShape(50))
                .background(if (selected) blue else Color.Transparent)
                .then(if (day.isToday && !selected) Modifier.border(1.5.dp, blue, RoundedCornerShape(50)) else Modifier),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                day.dateLabel,
                color = if (selected) Color.White else c.ink,
                fontSize = 14.sp,
                fontWeight = if (day.isToday) FontWeight.Bold else FontWeight.Medium,
            )
        }
        Box(
            Modifier.size(5.dp).clip(RoundedCornerShape(50)).background(if (day.hasShifts) blue else Color.Transparent),
        )
    }
}

/** "Today · Jun 3" + a "2 shifts · 6h" summary. */
@Composable
private fun DayHeaderRow(header: CalendarDayHeader) {
    val c = ShiftTheme.colors
    Row(
        Modifier.fillMaxWidth().padding(start = 18.dp, end = 18.dp, top = 6.dp, bottom = 10.dp),
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(header.title, color = c.ink, fontSize = 17.sp, fontWeight = FontWeight.Bold)
            Text("· ${header.dateLabel}", color = c.ter, fontSize = 15.sp, fontWeight = FontWeight.Medium)
        }
        header.summary?.let { Text(it, style = ShiftTheme.type.monoTime.copy(fontSize = 13.sp), color = c.sec) }
    }
}

/** The live "NOW · HH:mm" agenda divider (red dot + label + rule) — today only. */
@Composable
private fun NowLine(label: String) {
    val c = ShiftTheme.colors
    Row(
        Modifier.fillMaxWidth().padding(vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Box(Modifier.size(9.dp).clip(RoundedCornerShape(50)).background(c.danger.accent))
        Text(
            label,
            style = ShiftTheme.type.monoTime.copy(fontSize = 12.sp, fontWeight = FontWeight.SemiBold),
            color = c.danger.accent,
        )
        Box(
            Modifier
                .weight(1f)
                .height(1.5.dp)
                .clip(RoundedCornerShape(2.dp))
                .background(c.danger.accent.copy(alpha = 0.45f)),
        )
    }
}

@Composable
private fun AgendaShiftCard(
    row: MyShiftRow,
    active: Boolean,
) {
    ShiftCard(
        state = row.state.toKitState(),
        houseInitial = row.houseInitial,
        timeLabel = row.timeLabel,
        modifier = Modifier.testTag("calendar_shift_card"),
        houseName = row.houseName,
        destination = row.destination,
        durationLabel = row.durationLabel,
        active = active,
    )
}

// ===================================================================
// Drop flow (§5.2) — occurrence vs permanent, short-notice warning.
// ===================================================================

/**
 * Drop sheet (§5.2): the design's bottom sheet — scope radios (occurrence /
 * permanent), a short-notice warning, and a destructive confirm. The exact
 * "Drop this occurrence" / "Drop permanently" labels + the
 * `drop_*` selectors satisfy the Maestro contract. Both scopes drive the existing
 * optimistic-local [ShiftsScreenViewModel.drop] (decision #13); the §8.4 server
 * semantics of a permanent drop are a later step.
 */
@Composable
private fun DropSheet(
    shift: MyShift,
    vm: ShiftsScreenViewModel,
    breakProfile: Boolean,
    onDismiss: () -> Unit,
) {
    val c = ShiftTheme.colors
    val row = remember(shift) { shift.toRow() }
    val options = vm.dropOptions(shift, breakProfile)
    val plan = vm.planDrop(shift, dropFromNow = false)
    var permanentScope by remember { mutableStateOf(false) }
    var acknowledged by remember { mutableStateOf(false) }

    ShiftBottomSheet(onDismiss = onDismiss, title = "Drop shift") {
        Column(
            Modifier.fillMaxWidth().testTag("drop_options_sheet"),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                HouseBadge(row.houseInitial, c.surfaceVar, c.ink)
                Column {
                    Text(row.timeLabel, style = ShiftTheme.type.monoTime, color = c.ink)
                    Text("${row.houseName ?: row.destination ?: ""} · ${row.durationLabel}", color = c.sec, fontSize = 13.sp)
                }
            }

            ScopeOption(
                selected = !permanentScope,
                title = "Drop this occurrence",
                body = "Drops just this occurrence. The slot opens for others to claim.",
                icon = ShiftIcons.Calendar,
                accent = MaterialTheme.colorScheme.primary,
                tag = "drop_occurrence_option",
                onClick = { permanentScope = false },
            )
            ScopeOption(
                selected = permanentScope,
                title = "Drop permanently",
                body = "Releases this recurring slot. It becomes a permanent opening.",
                icon = ShiftIcons.Refresh,
                accent = c.permanent.accent,
                enabled = options.canDropPermanently,
                tag = "drop_permanent_option",
                onClick = { if (options.canDropPermanently) permanentScope = true },
            )

            if (plan.shortNotice && !acknowledged) {
                Column(Modifier.fillMaxWidth().testTag("drop_short_notice_warning"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    ShiftBanner(
                        title = "Starts within 20 minutes",
                        body = "Short-notice drop — your manager is notified immediately to arrange cover.",
                        tone = BannerTone.Warning,
                    )
                    ShiftButton(
                        "Continue anyway",
                        onClick = { acknowledged = true },
                        modifier = Modifier.testTag("drop_short_notice_continue"),
                        variant = ButtonVariant.Outlined,
                        size = ButtonSize.Sm,
                    )
                }
            }

            ShiftButton(
                if (permanentScope) "Drop permanently" else "Drop this week",
                onClick = {
                    vm.drop(shift.id)
                    onDismiss()
                },
                modifier = Modifier.fillMaxWidth().testTag("drop_confirm_button"),
                variant = ButtonVariant.DestructiveFilled,
                fullWidth = true,
                enabled = !plan.shortNotice || acknowledged,
            )
        }
    }
}

/** A radio-style drop-scope option (design `ScopeOption`). */
@Composable
private fun ScopeOption(
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
