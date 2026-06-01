package com.pennhousing.shift.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pennhousing.shift.shared.data.ToastNotification
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.model.OpenShift
import com.pennhousing.shift.shared.shifts.ClaimCapVerdict
import com.pennhousing.shift.shared.shifts.HomeOpenShiftsTab
import com.pennhousing.shift.shared.shifts.MyShiftsTab
import com.pennhousing.shift.shared.shifts.OtherHousesTab
import com.pennhousing.shift.shared.viewmodel.AckDeclineViewModel
import com.pennhousing.shift.shared.viewmodel.ShiftsScreenViewModel
import com.pennhousing.shift.shared.viewmodel.ShiftsTab

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
    MaterialTheme {
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
                    TAB_MY -> MyShiftsTabContent(state.myShifts, shiftsVm)
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
) {
    var dropTarget by remember { mutableStateOf<MyShift?>(null) }

    LazyColumn(Modifier.fillMaxSize().padding(12.dp)) {
        item {
            ShiftSection("Picked-up", "section_picked_up", tab.pickedUp.isEmpty()) {
                tab.pickedUp.forEach { ShiftRow(it, "picked_up_shift_card") }
            }
        }
        item {
            ShiftSection("Dropped", "section_dropped", tab.dropped.isEmpty()) {
                tab.dropped.forEach {
                    ShiftRow(it, "dropped_shift_card", trailing = {
                        OutlinedButton(onClick = { vm.reclaim(it.id) }) { Text("Reclaim") }
                    })
                }
            }
        }
        item {
            ShiftSection("Their shifts", "section_scheduled", tab.scheduled.isEmpty()) {
                tab.scheduled.forEach { shift ->
                    ShiftRow(shift, "scheduled_shift_card", onClick = { dropTarget = shift })
                }
            }
        }
    }

    dropTarget?.let { shift ->
        DropFlowDialog(
            shift = shift,
            vm = vm,
            onDismiss = { dropTarget = null },
        )
    }
}

@Composable
private fun ShiftSection(
    title: String,
    tag: String,
    empty: Boolean,
    content: @Composable () -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp).testTag(tag)) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        if (empty) {
            Text("None this week", style = MaterialTheme.typography.bodySmall)
        } else {
            content()
        }
        HorizontalDivider(Modifier.padding(top = 6.dp))
    }
}

@Composable
private fun ShiftRow(
    shift: MyShift,
    tag: String,
    onClick: (() -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    Card(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(vertical = 4.dp)
                .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
                .testTag(tag),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column {
                val label = buildString {
                    append(shift.house.name)
                    if (shift.crossHouse) append("  (cross-house)")
                    if (shift.pending) append("  (Pending)")
                }
                Text(label, fontWeight = FontWeight.SemiBold)
                Text("${shift.start} – ${shift.end}", style = MaterialTheme.typography.bodySmall)
            }
            trailing?.invoke()
        }
    }
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
            }
            if (claimable) {
                Button(onClick = onClaim, modifier = Modifier.testTag("claim_button")) { Text("Claim") }
            } else {
                Text("Unpickable")
            }
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

@Composable
private fun DropFlowDialog(
    shift: MyShift,
    vm: ShiftsScreenViewModel,
    onDismiss: () -> Unit,
) {
    val options = vm.dropOptions(shift, breakProfile = false)
    val plan = vm.planDrop(shift, dropFromNow = false)
    var occurrenceChosen by remember { mutableStateOf(false) }
    var shortNoticeAccepted by remember { mutableStateOf(false) }

    Dialog(onDismissRequest = onDismiss) {
        Surface(shape = MaterialTheme.shapes.large, tonalElevation = 6.dp) {
            Column(Modifier.padding(20.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (!occurrenceChosen) {
                    Column(Modifier.testTag("drop_options_sheet"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Drop this shift", style = MaterialTheme.typography.titleLarge)
                        Button(
                            onClick = { occurrenceChosen = true },
                            modifier = Modifier.fillMaxWidth().testTag("drop_occurrence_option"),
                        ) { Text("Drop this occurrence") }
                        Button(
                            onClick = { /* permanent drop is the §8.4 flow; out of scope here */ },
                            enabled = options.canDropPermanently,
                            modifier = Modifier.fillMaxWidth().testTag("drop_permanent_option"),
                        ) { Text("Drop permanently") }
                    }
                } else if (plan.shortNotice && !shortNoticeAccepted) {
                    Column(Modifier.testTag("drop_short_notice_warning"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("This shift starts within 20 minutes. Dropping it is short notice (§5.2).")
                        Button(
                            onClick = { shortNoticeAccepted = true },
                            modifier = Modifier.testTag("drop_short_notice_continue"),
                        ) { Text("Continue anyway") }
                    }
                } else {
                    Button(
                        onClick = {
                            vm.drop(shift.id)
                            onDismiss()
                        },
                        modifier = Modifier.testTag("drop_confirm_button"),
                    ) { Text("Confirm drop") }
                }
            }
        }
    }
}
