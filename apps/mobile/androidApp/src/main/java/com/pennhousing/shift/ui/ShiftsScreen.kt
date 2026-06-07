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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pennhousing.shift.shared.data.ToastNotification
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.model.OpenShift
import com.pennhousing.shift.shared.shifts.ClaimCapVerdict
import com.pennhousing.shift.shared.shifts.HomeOpenShiftsTab
import com.pennhousing.shift.shared.shifts.MyShiftCardState
import com.pennhousing.shift.shared.shifts.MyShiftsTab
import com.pennhousing.shift.shared.shifts.OtherHousesTab
import com.pennhousing.shift.shared.shifts.toRow
import com.pennhousing.shift.shared.shifts.weeklyHoursSummary
import com.pennhousing.shift.shared.viewmodel.AckDeclineViewModel
import com.pennhousing.shift.shared.viewmodel.ShiftsScreenViewModel
import com.pennhousing.shift.shared.viewmodel.ShiftsTab
import com.pennhousing.shift.ui.kit.BannerTone
import com.pennhousing.shift.ui.kit.ButtonSize
import com.pennhousing.shift.ui.kit.ButtonVariant
import com.pennhousing.shift.ui.kit.HouseBadge
import com.pennhousing.shift.ui.kit.ShiftBanner
import com.pennhousing.shift.ui.kit.ShiftBottomSheet
import com.pennhousing.shift.ui.kit.ShiftButton
import com.pennhousing.shift.ui.kit.ShiftCard
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.kit.ShiftSection
import com.pennhousing.shift.ui.kit.ShiftState
import com.pennhousing.shift.ui.theme.ShiftTheme

private const val TAB_MY = 0
private const val TAB_HOME = 1
private const val TAB_OTHER = 2
private const val TAB_UPDATES = 3

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
    currentWeeklyHours: Double,
    breakProfile: Boolean = false,
    toast: ToastNotification? = null,
) {
    ShiftTheme {
        val state by shiftsVm.uiState.collectAsStateWithLifecycle()
        var selectedIndex by remember { mutableIntStateOf(TAB_MY) }
        var showAckModal by remember { mutableStateOf(false) }
        var claimSuccess by remember { mutableStateOf(false) }

        Scaffold(modifier = Modifier.fillMaxSize().testTag("shifts_screen")) { padding ->
            Column(Modifier.fillMaxSize().padding(padding)) {
                toast?.let { NotificationToast(it) }
                if (claimSuccess) {
                    Text(
                        "Shift claimed ✓",
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .padding(12.dp)
                                .testTag("claim_success"),
                        fontWeight = FontWeight.SemiBold,
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
                    SpecTab("Updates", "tab_updates", selectedIndex == TAB_UPDATES) {
                        selectedIndex = TAB_UPDATES
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
                    TAB_OTHER -> OtherHousesTabContent(state.otherHouses)
                    TAB_UPDATES ->
                        UpdatesTabContent(
                            destinationHouse = ackVm.uiState.value.destinationHouse.name,
                            onOpen = { showAckModal = true },
                        )
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

    LazyColumn(Modifier.fillMaxSize().padding(12.dp)) {
        item {
            Column(Modifier.fillMaxWidth().testTag("home_weekly_feed")) {
                Text("This week", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                if (tab.weekly.isEmpty()) Text("No open shifts.")
                tab.weekly.forEach { OpenShiftCard(it, vm) { claimTarget = it } }
            }
        }
        item {
            Column(Modifier.fillMaxWidth().padding(top = 8.dp).testTag("home_permanent_feed")) {
                Text("Permanent openings", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                if (tab.permanentOpenings.isEmpty()) Text("None.")
                tab.permanentOpenings.forEach { OpenShiftCard(it, vm) { claimTarget = it } }
            }
        }
    }

    claimTarget?.let { shift ->
        ClaimFlowDialog(
            shift = shift,
            vm = vm,
            currentWeeklyHours = currentWeeklyHours,
            breakProfile = breakProfile,
            onClaimed = {
                vm.claim(shift)
                onClaimed()
            },
            onDismiss = { claimTarget = null },
        )
    }
}

@Composable
private fun OpenShiftCard(
    shift: OpenShift,
    vm: ShiftsScreenViewModel,
    onClaim: () -> Unit,
) {
    val claimable = vm.claimable(shift)
    Card(Modifier.fillMaxWidth().padding(vertical = 4.dp).testTag("open_shift_card")) {
        Row(
            Modifier.fillMaxWidth().padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column {
                Text(shift.house.name, fontWeight = FontWeight.SemiBold)
                Text("${shift.start} – ${shift.end}", style = MaterialTheme.typography.bodySmall)
                shift.weeksRemaining?.let { Text("$it weeks remaining", style = MaterialTheme.typography.bodySmall) }
                // §5.4: the shift stays VISIBLE past T-2h; only the claim action is gated.
                if (!claimable) {
                    Text("Unpickable (past T-2h)", style = MaterialTheme.typography.bodySmall)
                }
            }
            // §5.4 / §5.6: the Claim button is DISABLED past T-2h — never hidden, so
            // the worker still sees the shift and that it is no longer claimable.
            Button(
                onClick = onClaim,
                enabled = claimable,
                modifier = Modifier.testTag("claim_button"),
            ) { Text("Claim") }
        }
    }
}

@Composable
private fun ClaimFlowDialog(
    shift: OpenShift,
    vm: ShiftsScreenViewModel,
    currentWeeklyHours: Double,
    breakProfile: Boolean,
    onClaimed: () -> Unit,
    onDismiss: () -> Unit,
) {
    var warningAccepted by remember { mutableStateOf(false) }
    val verdict = vm.claimCap(shift, currentWeeklyHours, breakProfile)

    Dialog(onDismissRequest = onDismiss) {
        Surface(shape = MaterialTheme.shapes.large, tonalElevation = 6.dp) {
            Column(Modifier.padding(20.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Claim ${shift.house.name} shift", style = MaterialTheme.typography.titleLarge)
                Text("${shift.start} – ${shift.end}")

                when {
                    verdict == ClaimCapVerdict.HARD_CAP_BLOCKED ->
                        Column {
                            Text("This claim is over the 40-hour break cap and is blocked (§5.3).")
                            OutlinedButton(onClick = onDismiss) { Text("Close") }
                        }
                    verdict == ClaimCapVerdict.SOFT_CAP_WARNING && !warningAccepted ->
                        Column(Modifier.testTag("soft_cap_warning_modal"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("This claim puts you over the 20-hour cap. It is allowed (§5.3).")
                            Button(
                                onClick = { warningAccepted = true },
                                modifier = Modifier.testTag("soft_cap_confirm_button"),
                            ) { Text("Claim anyway") }
                        }
                    else ->
                        Button(
                            onClick = {
                                onClaimed()
                                onDismiss()
                            },
                            modifier = Modifier.testTag("claim_confirm_button"),
                        ) { Text("Confirm claim") }
                }
            }
        }
    }
}

// ===================================================================
// Tab 3 — Open Shifts in Other Houses (§5.6 Tab 3).
// ===================================================================

@Composable
private fun OtherHousesTabContent(tab: OtherHousesTab) {
    LazyColumn(Modifier.fillMaxSize().padding(12.dp).testTag("other_houses_tab")) {
        if (tab.isEmpty) {
            item { Text("No cross-house shifts available (e.g. during winter break).") }
        } else {
            tab.groups.forEach { group ->
                item {
                    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                        Text(group.house.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        group.weekly.forEach { CrossHouseCard(it) }
                        group.permanentOpenings.forEach { CrossHouseCard(it) }
                        HorizontalDivider(Modifier.padding(top = 6.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun CrossHouseCard(shift: OpenShift) {
    Card(Modifier.fillMaxWidth().padding(vertical = 4.dp).testTag("open_shift_card")) {
        Column(Modifier.padding(12.dp)) {
            Text(shift.house.name, fontWeight = FontWeight.SemiBold)
            Text("${shift.start} – ${shift.end}", style = MaterialTheme.typography.bodySmall)
            shift.weeksRemaining?.let { Text("$it weeks remaining", style = MaterialTheme.typography.bodySmall) }
        }
    }
}

// ===================================================================
// Updates tab — where a pending float surfaces (§7 / Maestro 04).
// ===================================================================

@Composable
private fun UpdatesTabContent(
    destinationHouse: String,
    onOpen: () -> Unit,
) {
    LazyColumn(Modifier.fillMaxSize().padding(12.dp)) {
        item {
            Card(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(vertical = 4.dp)
                        .clickable(onClick = onOpen)
                        .testTag("pending_float_notification"),
            ) {
                Column(Modifier.padding(12.dp)) {
                    Text("Float assigned — action needed", fontWeight = FontWeight.SemiBold)
                    Text("You have been floated to $destinationHouse. Tap to acknowledge or decline.")
                }
            }
        }
    }
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
