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
import androidx.compose.material3.RangeSlider
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
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
import com.pennhousing.shift.shared.data.PermanentPickupScope
import com.pennhousing.shift.shared.data.ToastNotification
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.model.OpenFeed
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
import com.pennhousing.shift.shared.shifts.PartialClaimPlan
import com.pennhousing.shift.shared.shifts.PartialDropPlan
import com.pennhousing.shift.shared.shifts.claimMeter
import com.pennhousing.shift.shared.shifts.hoursBetween
import com.pennhousing.shift.shared.shifts.subOpenShiftFor
import com.pennhousing.shift.shared.shifts.subShiftFor
import com.pennhousing.shift.shared.shifts.toRow
import com.pennhousing.shift.shared.shifts.weeklyHoursSummary
import com.pennhousing.shift.shared.viewmodel.AckDeclineViewModel
import com.pennhousing.shift.shared.viewmodel.BreakClaimViewModel
import com.pennhousing.shift.shared.viewmodel.CalendarViewModel
import com.pennhousing.shift.shared.viewmodel.PreferencesViewModel
import com.pennhousing.shift.shared.viewmodel.SettingsViewModel
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
private const val TAB_SETTINGS = 7

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
    settingsVm: SettingsViewModel,
    currentWeeklyHours: Double,
    breakProfile: Boolean = false,
    toast: ToastNotification? = null,
    onSignOut: () -> Unit = {},
    // Live host POSTs to `submit-preferences` then flips the optimistic state; demo
    // defaults to the local-only flip (the screen's own ViewModel.submit).
    onSubmitPreferences: () -> Unit = preferencesVm::submit,
    // Live host POSTs to `drop-shift` / `permanent-drop` on confirm (best-effort) while
    // the ViewModel still does the optimistic local move; demo defaults to no live write.
    onDropShift: (MyShift, Boolean) -> Unit = { _, _ -> },
    // Live host POSTs to `claim-shift` on confirm (best-effort) while the ViewModel still
    // does the optimistic local pickup; demo defaults to no live write. Used for WEEKLY
    // openings only — permanent openings route through [onPickUpPermanent].
    onClaimShift: (OpenShift) -> Unit = {},
    // Live host POSTs to the `permanent-pickup` EF on confirm of a PERMANENT opening
    // (best-effort) — the real permanent-pickup path (the prior `claim-shift` permanent
    // returned 501). The ViewModel still does the optimistic local pickup; demo = no write.
    onPickUpPermanent: (OpenShift) -> Unit = {},
    // Live host GETs the `permanent-pickup` dry-run SCOPE for the design's "Picking up N of
    // M weeks · K skipped" confirmation; demo returns null (the sheet shows the plain note).
    loadPermanentScope: suspend (OpenShift) -> PermanentPickupScope? = { null },
    // Live host POSTs the same `claim-shift` to reclaim a dropped-still-open shift
    // (its assignment_id is still vacant); demo defaults to no live write.
    onReclaimShift: (MyShift) -> Unit = {},
    // Live host POSTs to `acknowledge-float` / `decline-float` (best-effort) while the
    // ack ViewModel still does the optimistic local phase transition; demo defaults to
    // no live write. The argument is the float id the modal is showing.
    onAcknowledgeFloat: (String) -> Unit = {},
    onDeclineFloat: (String) -> Unit = {},
    // Live host POSTs to `break-claim` / `drop-shift` (best-effort) while the break
    // picker still does the optimistic local move; demo defaults to no live write. The
    // argument is the break shift's pool-row id (= its block assignment_id).
    onClaimBreak: (String) -> Unit = {},
    onDropBreak: (String) -> Unit = {},
    // Live host writes the §4.4 "no break hours" opt-out (own `break_optouts` row, insert/
    // delete) DIRECTLY via Postgrest while the picker flips its optimistic opted-out state;
    // demo defaults to no live write. The argument is the NEW desired opted-out state.
    onToggleBreakOptOut: (Boolean) -> Unit = {},
    // Live host PATCHes `users-broadcast-subscription` (best-effort) while the settings
    // ViewModel still does the optimistic local toggle; demo defaults to no live write.
    // The argument is the NEW desired subscription state. Only the broadcast / "General
    // updates" channel is interactive — the three personal-notif rows stay disabled (§10.1).
    onToggleBroadcast: (Boolean) -> Unit = {},
    // Live host loops the worker's still-unread notification ids through the
    // `mark_notification_read` RPC (best-effort) when "Mark all read" is tapped; the Updates
    // ViewModel does the optimistic local clear. Demo defaults to local-only (no write).
    onMarkAllRead: (List<String>) -> Unit = {},
    // Live host POSTs `accept-swap` / `reject-swap` (best-effort) when an incoming swap
    // entry's Accept/Decline is tapped (T3a); the Updates ViewModel already resolved the
    // entry optimistically. Demo defaults to local-only. The argument is the swap id.
    onAcceptSwap: (String) -> Unit = {},
    onRejectSwap: (String) -> Unit = {},
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
                    SpecTab("Settings", "tab_settings", selectedIndex == TAB_SETTINGS) {
                        selectedIndex = TAB_SETTINGS
                    }
                }

                when (selectedIndex) {
                    TAB_MY -> MyShiftsTabContent(state.myShifts, shiftsVm, currentWeeklyHours, breakProfile, onDropShift, onReclaimShift)
                    TAB_HOME ->
                        HomeOpenTabContent(
                            tab = state.homeOpen,
                            vm = shiftsVm,
                            currentWeeklyHours = currentWeeklyHours,
                            breakProfile = breakProfile,
                            onClaimed = { claimSuccess = true },
                            onClaimShift = onClaimShift,
                            onPickUpPermanent = onPickUpPermanent,
                            loadPermanentScope = loadPermanentScope,
                        )
                    TAB_OTHER ->
                        OtherHousesTabContent(
                            tab = state.otherHouses,
                            vm = shiftsVm,
                            currentWeeklyHours = currentWeeklyHours,
                            breakProfile = breakProfile,
                            onClaimed = { claimSuccess = true },
                            onClaimShift = onClaimShift,
                            onPickUpPermanent = onPickUpPermanent,
                            loadPermanentScope = loadPermanentScope,
                        )
                    TAB_CALENDAR -> CalendarTabContent(calendarVm)
                    TAB_UPDATES ->
                        UpdatesTabContent(
                            feed = updatesState.feed,
                            hasUnread = updatesState.hasUnread,
                            onOpenAck = { showAckModal = true },
                            onMarkAllRead = {
                                // Optimistic local clear (returns the ids that were unread),
                                // then best-effort live persist via the host callback.
                                onMarkAllRead(updatesVm.markAllRead())
                            },
                            // T3a — incoming swap: optimistic local resolve (the row leaves
                            // the feed), then the best-effort live POST via the host callback.
                            onAcceptSwap = { swapId ->
                                updatesVm.resolveSwap(swapId)
                                onAcceptSwap(swapId)
                            },
                            onRejectSwap = { swapId ->
                                updatesVm.resolveSwap(swapId)
                                onRejectSwap(swapId)
                            },
                        )
                    TAB_PREFS -> PreferencesTabContent(preferencesVm, onSubmitPreferences)
                    TAB_BREAK -> BreakClaimTabContent(breakClaimVm, onClaimBreak, onDropBreak, onToggleBreakOptOut)
                    TAB_SETTINGS -> SettingsTabContent(settingsVm, onSignOut, onToggleBroadcast)
                }
            }
        }

        if (showAckModal) {
            FloatAcknowledgmentModal(
                ackVm = ackVm,
                onAcknowledgeFloat = onAcknowledgeFloat,
                onDeclineFloat = onDeclineFloat,
                onClose = { showAckModal = false },
            )
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
    onDropShift: (MyShift, Boolean) -> Unit = { _, _ -> },
    onReclaimShift: (MyShift) -> Unit = {},
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
                ShiftCardColumn {
                    tab.dropped.forEach { dropped ->
                        MyShiftCardItem(
                            dropped,
                            "dropped_shift_card",
                            reclaim = {
                                // Live host POSTs `claim-shift` to retake the still-vacant
                                // slot (best-effort); the ViewModel does the optimistic move.
                                onReclaimShift(dropped)
                                vm.reclaim(dropped.id)
                            },
                        )
                    }
                }
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
        DropSheet(
            shift = shift,
            vm = vm,
            breakProfile = breakProfile,
            onDrop = onDropShift,
            onDismiss = { dropTarget = null },
        )
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

/**
 * Route a confirmed open-shift pickup to the right live write, then do the optimistic local
 * move. A WEEKLY opening → `claim-shift` ([onClaimShift]); a PERMANENT opening → the
 * `permanent-pickup` EF ([onPickUpPermanent], the real path — `claim-shift`'s permanent
 * branch 501s). The ViewModel's optimistic [ShiftsScreenViewModel.claim] is the same local
 * move for both (decision #13); the server stays authoritative and the next Realtime
 * snapshot reconciles. Shared by Tab 2 and Tab 3.
 */
private fun confirmOpenShift(
    shift: OpenShift,
    vm: ShiftsScreenViewModel,
    onClaimShift: (OpenShift) -> Unit,
    onPickUpPermanent: (OpenShift) -> Unit,
    onClaimed: () -> Unit,
) {
    if (shift.feed == OpenFeed.PERMANENT_OPENING) onPickUpPermanent(shift) else onClaimShift(shift)
    vm.claim(shift)
    onClaimed()
}

@Composable
private fun HomeOpenTabContent(
    tab: HomeOpenShiftsTab,
    vm: ShiftsScreenViewModel,
    currentWeeklyHours: Double,
    breakProfile: Boolean,
    onClaimed: () -> Unit,
    onClaimShift: (OpenShift) -> Unit = {},
    onPickUpPermanent: (OpenShift) -> Unit = {},
    loadPermanentScope: suspend (OpenShift) -> PermanentPickupScope? = { null },
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
            loadPermanentScope = loadPermanentScope,
            onConfirmed = { effective -> confirmOpenShift(effective, vm, onClaimShift, onPickUpPermanent, onClaimed) },
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
 *
 * T2-10 — a WEEKLY opening that coalesces several 30-min blocks gains a "How much
 * can you cover?" block-range selector (default: the whole opening, so the Maestro
 * 02 whole-claim path is unchanged). The hours meter + cap gating recompute from
 * the SELECTED span, and confirm claims only the selected blocks ([onConfirmed]
 * receives the effective — whole or sub — open shift). A permanent opening always
 * takes the whole recurring slot (§8.4.3).
 */
@Composable
private fun ClaimSheet(
    shift: OpenShift,
    vm: ShiftsScreenViewModel,
    currentWeeklyHours: Double,
    breakProfile: Boolean,
    onConfirmed: (OpenShift) -> Unit,
    onDismiss: () -> Unit,
    loadPermanentScope: suspend (OpenShift) -> PermanentPickupScope? = { null },
) {
    val c = ShiftTheme.colors
    val claimable = vm.claimable(shift)
    val row = remember(shift, claimable) { shift.toRow(claimable) }
    val permanent = row.state == OpenShiftCardState.PERMANENT
    // Dry-run the `permanent-pickup` EF so the confirm can show "Picking up N of M weeks ·
    // K skipped" (§8.4.3). Null until loaded / on the demo path → the plain recurring note.
    var permanentScope by remember(shift) { mutableStateOf<PermanentPickupScope?>(null) }
    LaunchedEffect(shift, permanent) {
        if (permanent) permanentScope = loadPermanentScope(shift)
    }

    // §5.3 partial claim (T2-10) — block indexes on the opening's grid, [from, to).
    val blockCount = shift.blockIds.size
    var rangeFrom by remember(shift) { mutableIntStateOf(0) }
    var rangeTo by remember(shift) { mutableIntStateOf(blockCount) }
    val claimPlan = vm.planClaimRange(shift, rangeFrom, rangeTo)
    // The shift the confirm actually claims: the selection for a weekly opening,
    // always the whole slot for a permanent pickup.
    val effective = if (permanent || claimPlan.wholeShift) shift else subOpenShiftFor(shift, claimPlan)

    // Meter + cap gating recompute from the SELECTED span (§5.3).
    val meter =
        remember(shift, claimPlan, currentWeeklyHours, breakProfile) {
            claimMeter(currentWeeklyHours, hoursBetween(effective.start, effective.end), breakProfile)
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

            if (permanent) PermanentRecurringNote(row, permanentScope)

            if (!permanent && blockCount > 1) {
                ClaimRangeSelector(
                    plan = claimPlan,
                    blockCount = blockCount,
                    rangeFrom = rangeFrom,
                    rangeTo = rangeTo,
                    onRange = { from, to ->
                        rangeFrom = from
                        rangeTo = to
                    },
                )
            }

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
                        when {
                            permanent -> "Confirm pickup"
                            !claimPlan.wholeShift -> "Claim ${claimPlan.rangeLabel}"
                            else -> "Claim shift"
                        },
                        onClick = {
                            onConfirmed(effective)
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

/**
 * The §5.3 "How much can you cover?" block-range selector (T2-10): a stepped range
 * slider over the opening's 30-min blocks with a live "17:30 – 19:00 · 1h 30m"
 * summary. Defaults to the whole opening.
 */
@Composable
private fun ClaimRangeSelector(
    plan: PartialClaimPlan,
    blockCount: Int,
    rangeFrom: Int,
    rangeTo: Int,
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
            .testTag("claim_range_selector"),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text("How much can you cover?", color = c.sec, fontSize = 13.sp, fontWeight = FontWeight.Medium)
        Text(
            "${plan.rangeLabel} · ${plan.durationLabel}" + if (plan.wholeShift) " · whole shift" else "",
            style = ShiftTheme.type.monoTime.copy(fontSize = 13.5.sp),
            color = c.ink,
            modifier = Modifier.testTag("claim_range_label"),
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

/**
 * The recurring-slot note shown when picking up a permanent opening (design `ClaimSheet`).
 * When the `permanent-pickup` dry-run [scope] has resolved, it also shows the §8.4.3
 * "Picking up N of M weeks · K skipped" line so the worker sees how the slot lands against
 * their caps + existing shifts before committing; before that (or on the demo path) only
 * the plain recurring summary shows.
 */
@Composable
private fun PermanentRecurringNote(
    row: OpenShiftRow,
    scope: PermanentPickupScope?,
) {
    val c = ShiftTheme.colors
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(c.permanent.tint)
            .padding(horizontal = 13.dp, vertical = 12.dp)
            .testTag("permanent_recurring_note"),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Text("Recurring · ${row.dayLabel} · ${row.timeLabel}", color = c.permanent.deep, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        row.meta?.let { Text("Repeats weekly — $it.", color = c.sec, fontSize = 12.5.sp) }
        scope?.let {
            val skipped = if (it.weeksSkipped > 0) " · ${it.weeksSkipped} skipped" else ""
            Text(
                "Picking up ${it.weeksPickedUp} of ${it.totalWeeksInScope} weeks$skipped",
                color = c.permanent.deep,
                fontSize = 12.5.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.testTag("permanent_pickup_scope"),
            )
        }
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
    onClaimShift: (OpenShift) -> Unit = {},
    onPickUpPermanent: (OpenShift) -> Unit = {},
    loadPermanentScope: suspend (OpenShift) -> PermanentPickupScope? = { null },
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
            loadPermanentScope = loadPermanentScope,
            onConfirmed = { effective -> confirmOpenShift(effective, vm, onClaimShift, onPickUpPermanent, onClaimed) },
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
 * opens the ack hero. Empty → "You're all caught up".
 *
 * T2-8 — a "Mark all read" affordance (the design's AppHeader trailing check, omitted in
 * T1-1) sits in the feed header when [hasUnread]. Tapping it fires [onMarkAllRead], which
 * optimistically clears the unread dots (and, on the live host, loops the worker's unread
 * ids through the `mark_notification_read` RPC). Hidden when nothing is unread.
 */
@Composable
private fun UpdatesTabContent(
    feed: UpdatesFeed,
    hasUnread: Boolean,
    onOpenAck: () -> Unit,
    onMarkAllRead: () -> Unit,
    onAcceptSwap: (String) -> Unit = {},
    onRejectSwap: (String) -> Unit = {},
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
        if (hasUnread) {
            item { MarkAllReadHeader(onMarkAllRead) }
        }
        if (feed.today.isNotEmpty()) {
            item { NotificationGroup("Today", feed.today, onOpenAck, onAcceptSwap, onRejectSwap) }
        }
        if (feed.earlier.isNotEmpty()) {
            item { NotificationGroup("Earlier", feed.earlier, onOpenAck, onAcceptSwap, onRejectSwap) }
        }
    }
}

/** The Updates header trailing affordance — "Mark all read" (worker-app.html AppHeader trailing check). */
@Composable
private fun MarkAllReadHeader(onMarkAllRead: () -> Unit) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.End,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            Modifier
                .clip(RoundedCornerShape(10.dp))
                .clickable(onClick = onMarkAllRead)
                .testTag("mark_all_read")
                .padding(horizontal = 10.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                ShiftIcons.CheckCircle,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(17.dp),
            )
            Text("Mark all read", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Medium)
        }
    }
}

@Composable
private fun NotificationGroup(
    title: String,
    rows: List<NotificationRow>,
    onOpenAck: () -> Unit,
    onAcceptSwap: (String) -> Unit = {},
    onRejectSwap: (String) -> Unit = {},
) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SectionHeader(title)
        rows.forEach { NotificationCard(it, onOpenAck, onAcceptSwap, onRejectSwap) }
    }
}

/** One Updates row (worker-app.html `UpdateRow`). Urgent → float-tint card + left accent + "Action needed". */
@Composable
private fun NotificationCard(
    row: NotificationRow,
    onOpenAck: () -> Unit,
    onAcceptSwap: (String) -> Unit = {},
    onRejectSwap: (String) -> Unit = {},
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
    if (row.swapId != null) box = box.testTag("swap_request_notification")

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
                row.swapId?.let { swapId ->
                    // T3a — the counterparty action on an incoming swap. Accept only for
                    // temporary swaps (a permanent acceptance needs the desk/web — §8.4).
                    Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (row.swapAcceptable) {
                            ShiftButton(
                                "Accept",
                                onClick = { onAcceptSwap(swapId) },
                                modifier = Modifier.testTag("swap_accept_button"),
                                size = ButtonSize.Sm,
                            )
                        }
                        ShiftButton(
                            "Decline",
                            onClick = { onRejectSwap(swapId) },
                            modifier = Modifier.testTag("swap_reject_button"),
                            variant = ButtonVariant.Outlined,
                            size = ButtonSize.Sm,
                        )
                    }
                }
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
            if (state.agenda.header.closed) {
                // §3.4/§11.3 (T2-12c): the home house is closed this date — no
                // blocks exist to work, so say so instead of "day off".
                EmptyState(
                    title = "House closed",
                    icon = ShiftIcons.Building,
                    body = "Your house is closed this day — no desk shifts are scheduled.",
                )
            } else {
                EmptyState(
                    title = "No shifts this day",
                    icon = ShiftIcons.Calendar,
                    body = "Enjoy the day off — or browse Open Shifts to pick one up.",
                )
            }
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
                .background(
                    when {
                        selected -> blue
                        day.closed -> c.surfaceVar // §3.4 closed-day cell — muted fill
                        else -> Color.Transparent
                    },
                )
                .then(if (day.isToday && !selected) Modifier.border(1.5.dp, blue, RoundedCornerShape(50)) else Modifier)
                .then(if (day.closed) Modifier.testTag("calendar_closed_day") else Modifier),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                day.dateLabel,
                color =
                    when {
                        selected -> Color.White
                        day.closed -> c.ter
                        else -> c.ink
                    },
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
            if (header.closed) {
                // §3.4/§11.3 — the home house is closed this date.
                Text(
                    "Closed",
                    color = c.sec,
                    fontSize = 11.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier =
                        Modifier
                            .clip(RoundedCornerShape(50))
                            .background(c.surfaceVar)
                            .padding(horizontal = 8.dp, vertical = 2.dp)
                            .testTag("calendar_closed_chip"),
                )
            }
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
 *
 * T2-11 — when the displayed card coalesces several 30-min blocks, the occurrence
 * scope gains a "How much to drop" block-range selector (defaulting to the whole
 * shift, so the Maestro 03 whole-drop path is unchanged) + a mid-shift "From now"
 * quick action (§5.2: a 17:51 drop opens a 17:30-anchored gap). The selected run
 * is dropped via the same `drop-shift` EF (its `assignment_ids` array); the
 * remaining blocks re-coalesce into their own card(s). The short-notice warning
 * anchors to the SELECTED gap start.
 */
@Composable
private fun DropSheet(
    shift: MyShift,
    vm: ShiftsScreenViewModel,
    breakProfile: Boolean,
    onDismiss: () -> Unit,
    onDrop: (MyShift, Boolean) -> Unit = { _, _ -> },
) {
    val c = ShiftTheme.colors
    val row = remember(shift) { shift.toRow() }
    val options = vm.dropOptions(shift, breakProfile)
    var permanentScope by remember { mutableStateOf(false) }
    var acknowledged by remember { mutableStateOf(false) }

    // §5.2 partial range — block indexes on the shift's own grid, [from, to).
    val blockCount = shift.blockIds.size
    var rangeFrom by remember(shift) { mutableIntStateOf(0) }
    var rangeTo by remember(shift) { mutableIntStateOf(blockCount) }
    val partialPlan = vm.planDropRange(shift, rangeFrom, rangeTo)
    val fromNowIndex = remember(shift) { vm.dropFromNowIndex(shift) }
    // Permanent scope always releases the WHOLE recurring slot; the short-notice
    // check then anchors to the shift start, exactly as before.
    val shortNotice = if (permanentScope) vm.planDrop(shift, dropFromNow = false).shortNotice else partialPlan.shortNotice

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

            if (!permanentScope && blockCount > 1) {
                DropRangeSelector(
                    plan = partialPlan,
                    blockCount = blockCount,
                    rangeFrom = rangeFrom,
                    rangeTo = rangeTo,
                    fromNowIndex = fromNowIndex,
                    onRange = { from, to ->
                        rangeFrom = from
                        rangeTo = to
                    },
                )
            }

            if (shortNotice && !acknowledged) {
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
                when {
                    permanentScope -> "Drop permanently"
                    !partialPlan.wholeShift -> "Drop ${partialPlan.rangeLabel}"
                    else -> "Drop this week"
                },
                onClick = {
                    // Live host POSTs to `drop-shift` / `permanent-drop` (best-effort);
                    // the ViewModel still does the optimistic local section move. The
                    // occurrence path posts the SELECTED sub-shift (its blockIds are the
                    // contiguous run the EF receives) and flags only those blocks.
                    if (permanentScope) {
                        onDrop(shift, true)
                        vm.drop(shift.id)
                    } else {
                        onDrop(subShiftFor(shift, partialPlan), false)
                        vm.dropBlocks(partialPlan.blockIds)
                    }
                    onDismiss()
                },
                modifier = Modifier.fillMaxWidth().testTag("drop_confirm_button"),
                variant = ButtonVariant.DestructiveFilled,
                fullWidth = true,
                enabled = !shortNotice || acknowledged,
            )
        }
    }
}

/**
 * The §5.2 "How much to drop" block-range selector (T2-11): a stepped range
 * slider over the card's 30-min blocks with a live "17:30 – 19:00 · 1h 30m"
 * summary, plus the mid-shift "From now" quick action when `now` falls inside
 * the shift. Defaults to the whole shift.
 */
@Composable
private fun DropRangeSelector(
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
            Text("How much to drop", color = c.sec, fontSize = 13.sp, fontWeight = FontWeight.Medium)
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
