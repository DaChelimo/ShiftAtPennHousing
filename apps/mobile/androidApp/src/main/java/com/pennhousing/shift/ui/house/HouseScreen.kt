package com.pennhousing.shift.ui.house

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pennhousing.shift.shared.data.WorkerBackend
import com.pennhousing.shift.shared.house.HouseGridBlock
import com.pennhousing.shift.shared.manager.AssignOutcome
import com.pennhousing.shift.shared.manager.ForceTriggerOutcome
import com.pennhousing.shift.shared.manager.RosterWorker
import com.pennhousing.shift.shared.network.TOAST_DURATION_MS
import com.pennhousing.shift.shared.samples.DemoData
import com.pennhousing.shift.shared.viewmodel.HouseScheduleViewModel
import com.pennhousing.shift.ui.calendar.WeekNavBar
import com.pennhousing.shift.ui.calendar.WeekPickerSheet
import com.pennhousing.shift.ui.common.PageTitle
import com.pennhousing.shift.ui.kit.HouseBadge
import com.pennhousing.shift.ui.kit.ShiftAlertDialog
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.kit.ShiftToast
import com.pennhousing.shift.ui.kit.ToastTone
import com.pennhousing.shift.ui.onboarding.HouseGridTourHelpButton
import com.pennhousing.shift.ui.theme.ShiftTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The home-house schedule (§11.4, T3b) as an Excel-style WEEK GRID (design
 * `HouseScheduleScreen`) — the spreadsheet SWs are used to: a fixed left time rail
 * plus one Mon-Sun column per day, each desk block placed by the hour, concurrent
 * desks (Harnwell/Quad) side-by-side. The rail stays put while the days scroll
 * sideways; the week navigator (last week … +4) pages the grid. Tapping a staffed
 * block opens the contact sheet (worker name + phone per the full-directory ruling,
 * plus the house desk phone) — the "who do I swap with" affordance.
 *
 * [meUserId] is the live worker (its blocks read "You"); null = demo. The host fetches
 * each navigated week's grid (`fetchHouseScheduleForWeek`) — or generates the demo week
 * — and feeds it to the VM via `setWeekSeats`, exactly like the swap calendar.
 */
@Composable
internal fun HouseTabContent(
    vm: HouseScheduleViewModel,
    meUserId: String?,
    // The header "?" that replays the interactive House-grid tour, and its reported bounds
    // (for the one-time post-tour pointer callout to point at).
    onReplayHouseGridTour: () -> Unit = {},
    onHouseGridTourHelpPositioned: (Rect) -> Unit = {},
) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    val c = ShiftTheme.colors
    val scope = rememberCoroutineScope()
    var contactTarget by remember { mutableStateOf<HouseGridBlock?>(null) }
    var showWeekPicker by remember { mutableStateOf(false) }
    var showHousePicker by remember { mutableStateOf(false) }

    // ── SM/HM/BM/RSM manager actions on a VACANT seat (BSpec §2.2 / §6.6). Only shown
    // when `state.canManage` (a manager on their OWN house). Tapping an open seat opens a
    // two-option chooser: assign a worker, or get coverage now (force a float lookup). The
    // async writes run in this composable's scope (the House tab already owns its own I/O),
    // never in the pure VM; a success refetches the shown week via `refreshKey`. ──
    var manageChoice by remember { mutableStateOf<HouseGridBlock?>(null) } // the two-option chooser
    var assignFor by remember { mutableStateOf<HouseGridBlock?>(null) } // the roster picker
    var forceFor by remember { mutableStateOf<HouseGridBlock?>(null) } // the force-trigger confirm
    var assignConfirm by remember { mutableStateOf<AssignConfirmState?>(null) } // soft-advisory confirm
    var roster by remember { mutableStateOf<List<RosterWorker>>(emptyList()) }
    var rosterLoading by remember { mutableStateOf(false) }
    var rosterSearch by remember { mutableStateOf("") }
    var managerToast by remember { mutableStateOf<Pair<String, ToastTone>?>(null) }
    var refreshKey by remember { mutableIntStateOf(0) }
    LaunchedEffect(managerToast) {
        if (managerToast != null) {
            delay(TOAST_DURATION_MS)
            managerToast = null
        }
    }

    // The shown house id — actions target the VIEWED house (a manager only ever manages
    // their home house, but this is explicit and matches the read path).
    val shownHouseId = state.selectedHouseId ?: state.homeHouseId

    fun runAssign(
        block: HouseGridBlock,
        worker: RosterWorker,
        override: Boolean,
    ) {
        scope.launch {
            when (val outcome = WorkerBackend.managerRepository.assignWorker(block.assignmentIds, worker.userId, override = override)) {
                is AssignOutcome.Assigned -> {
                    assignFor = null
                    assignConfirm = null
                    val n = outcome.count
                    managerToast = (if (n == 1) "Assigned to 1 block" else "Assigned to $n blocks") to ToastTone.Success
                    refreshKey++
                }
                is AssignOutcome.NeedsConfirm ->
                    assignConfirm = AssignConfirmState(block, worker, outcome.advisories)
                is AssignOutcome.Rejected -> {
                    assignConfirm = null
                    managerToast = outcome.message to ToastTone.Error
                }
                AssignOutcome.Failed -> {
                    assignConfirm = null
                    managerToast = "That could not be done. Try again." to ToastTone.Error
                }
            }
        }
    }

    fun runForce(block: HouseGridBlock) {
        val houseId = shownHouseId ?: return
        scope.launch {
            when (val outcome = WorkerBackend.managerRepository.forceTrigger(houseId, block.assignmentIds)) {
                is ForceTriggerOutcome.Triggered -> {
                    managerToast = (if (outcome.floatCount > 0) "Float assigned" else "Coverage started") to ToastTone.Success
                    refreshKey++
                }
                is ForceTriggerOutcome.Rejected -> managerToast = outcome.message to ToastTone.Error
                ForceTriggerOutcome.Failed -> managerToast = "That could not be done. Try again." to ToastTone.Error
            }
        }
    }

    // Load the shown house's roster whenever the assign picker opens.
    LaunchedEffect(assignFor?.id) {
        val target = assignFor
        if (target == null || shownHouseId == null) return@LaunchedEffect
        rosterSearch = ""
        rosterLoading = true
        roster = WorkerBackend.managerRepository.fetchHouseRoster(shownHouseId)
        rosterLoading = false
    }

    // The pickable houses (2026-06-23 cross-house ruling): live `fetchHouses`, demo list
    // otherwise. Loaded once; the switcher defaults to the worker's home house.
    LaunchedEffect(meUserId) {
        val houses =
            if (meUserId != null) {
                runCatching { WorkerBackend.shiftsRepository.fetchHouses() }.getOrDefault(emptyList())
            } else {
                DemoData.houses()
            }
        if (houses.isNotEmpty()) vm.setHouses(houses)
    }

    // Per-(house, week) seats: live fetch on the backend path, deterministic demo week
    // otherwise. Keyed on the selected house + weekOffset so switching house / paging weeks
    // reloads; setWeekSeats ignores stale fetches (wrong house OR week). `refreshKey` re-runs
    // it after a manager assign / force-trigger so the grid reflects the new state.
    val selectedHouseId = state.selectedHouseId
    LaunchedEffect(selectedHouseId, state.weekOffset, meUserId, refreshKey) {
        if (selectedHouseId == null) return@LaunchedEffect
        val seats =
            if (meUserId != null) {
                runCatching { WorkerBackend.shiftsRepository.fetchHouseGridForWeek(selectedHouseId, state.anchor)?.seats }
                    .getOrNull() ?: emptyList()
            } else {
                DemoData.houseWeekSeats(
                    state.anchor,
                    DemoData.DEMO_ME_USER_ID,
                    isHome = selectedHouseId == DemoData.DEMO_HOME_HOUSE_ID,
                )
            }
        vm.setWeekSeats(selectedHouseId, state.weekOffset, seats)
    }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().background(c.bg).testTag("house_screen")) {
            PageTitle("House") {
                HouseGridTourHelpButton(
                    onClick = onReplayHouseGridTour,
                    onPositioned = onHouseGridTourHelpPositioned,
                )
            }
            HouseHeaderCard(
                houseName = state.houseName,
                deskPhone = state.deskPhone,
                isHomeHouse = state.isHomeHouse,
                canSwitchHouse = state.canSwitchHouse,
                onOpenPicker = { if (state.canSwitchHouse) showHousePicker = true },
            )
            HouseLegend()
            Box(Modifier.weight(1f).fillMaxWidth().testTag("house_grid")) {
                HouseGrid(
                    grid = state.grid,
                    focusDayIndex = state.todayIndex,
                    nowMinOfDay = state.nowMinOfDay,
                    // Re-centre the scroll whenever the house or shown week changes.
                    focusKey = "${state.selectedHouseId}#${state.weekOffset}",
                    // A manager on their own house may tap an OPEN seat to manage it.
                    vacantTappable = state.canManage,
                    onBlockTap = {
                        if (it.vacant) {
                            if (state.canManage) manageChoice = it
                        } else {
                            contactTarget = it
                        }
                    },
                )
            }
            WeekNavBar(
                title = state.weekRelative,
                rangeLabel = state.weekRange,
                onOpenPicker = { showWeekPicker = true },
                onPreviousWeek = if (state.canPreviousWeek) vm::previousWeek else null,
                onNextWeek = if (state.canNextWeek) vm::nextWeek else null,
                pickerTag = "house_week_picker_open",
                prevTag = "house_prev_week",
                nextTag = "house_next_week",
            )
        }
        // Transient manager-action confirmation / error toast (the House tab owns its own
        // I/O, so it also owns this toast rather than routing through the host's toast row).
        managerToast?.let { (msg, tone) ->
            ShiftToast(
                message = msg,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 12.dp)
                    .testTag("house_manage_toast"),
                tone = tone,
                icon = if (tone == ToastTone.Error) ShiftIcons.Warning else ShiftIcons.Check,
            )
        }
    }

    // The two-option chooser for a vacant seat (assign a worker / get coverage now).
    manageChoice?.let { block ->
        ManagerActionSheet(
            houseName = state.houseName,
            block = block,
            onAssign = {
                manageChoice = null
                assignFor = block
            },
            onForce = {
                manageChoice = null
                forceFor = block
            },
            onDismiss = { manageChoice = null },
        )
    }

    // The roster picker: search + tap a worker to assign.
    assignFor?.let { block ->
        AssignWorkerSheet(
            houseName = state.houseName,
            block = block,
            roster = roster,
            loading = rosterLoading,
            search = rosterSearch,
            onSearch = { rosterSearch = it },
            onPick = { worker -> runAssign(block, worker, override = false) },
            onDismiss = { assignFor = null },
        )
    }

    // Soft-advisory confirm (over-target / soft-cap / cannot / opted-out): re-submit with override.
    assignConfirm?.let { pending ->
        ShiftAlertDialog(
            title = "Assign anyway?",
            text = pending.advisories.joinToString("\n") { it.message },
            confirmLabel = "Assign anyway",
            onConfirm = { runAssign(pending.block, pending.worker, override = true) },
            onDismiss = { assignConfirm = null },
        )
    }

    // Force-trigger confirm.
    forceFor?.let { block ->
        ShiftAlertDialog(
            title = "Get coverage now",
            text = "Run a float lookup to cover this seat now?",
            confirmLabel = "Run coverage",
            onConfirm = {
                forceFor = null
                runForce(block)
            },
            onDismiss = { forceFor = null },
        )
    }

    if (showWeekPicker) {
        WeekPickerSheet(
            options = state.weekOptions,
            currentOffset = state.weekOffset,
            onPick = {
                vm.selectWeek(it)
                showWeekPicker = false
            },
            onDismiss = { showWeekPicker = false },
            sheetTag = "house_week_picker_sheet",
            optionTag = "house_week_picker_option",
        )
    }

    if (showHousePicker) {
        HousePickerSheet(
            houses = state.houses,
            selectedHouseId = state.selectedHouseId,
            homeHouseId = state.homeHouseId,
            onPick = {
                vm.selectHouse(it)
                showHousePicker = false
            },
            onDismiss = { showHousePicker = false },
        )
    }

    contactTarget?.let { block ->
        ContactSheet(
            block = block,
            deskPhone = state.deskPhone,
            deskHouseName = state.houseName,
            onDismiss = { contactTarget = null },
        )
    }
}

// ── Per-worker colours (docs/design/worker-colors.md) ───────────────────────────

/** The legend strip (design): You / Float-in / Open, plus the swipe-sideways hint. */
@Composable
internal fun HouseLegend() {
    val c = ShiftTheme.colors
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        LegendSwatch(MaterialTheme.colorScheme.primaryContainer, MaterialTheme.colorScheme.primary, "You")
        LegendSwatch(c.floatIn.tint, c.floatIn.accent, "Float-in")
        LegendSwatch(c.surface, c.outline, "Open", dashed = true)
        Spacer(Modifier.weight(1f))
        Text("Swipe", color = c.ter, fontSize = 11.sp)
        Icon(ShiftIcons.ChevronRight, contentDescription = null, tint = c.ter, modifier = Modifier.size(13.dp))
    }
}

@Composable
internal fun LegendSwatch(
    fill: Color,
    accent: Color,
    label: String,
    dashed: Boolean = false,
) {
    val c = ShiftTheme.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Box(
            Modifier
                .size(10.dp)
                .clip(RoundedCornerShape(3.dp))
                .background(fill)
                .then(if (dashed) Modifier.dashedBorder(accent, 3.dp) else Modifier.border(1.dp, accent, RoundedCornerShape(3.dp))),
        )
        Text(label, color = c.ter, fontSize = 11.5.sp)
    }
}

/**
 * The house header — a DROPDOWN (2026-06-23 cross-house ruling): tapping anywhere opens
 * the house switcher, EXCEPT the desk-phone line, which dials the desk (ACTION_DIAL — the
 * device dialer opens with the number prefilled; it does NOT auto-call). Shows a "Your
 * house" marker for the worker's own house and a chevron when switching is available.
 */
@Composable
internal fun HouseHeaderCard(
    houseName: String,
    deskPhone: String?,
    isHomeHouse: Boolean,
    canSwitchHouse: Boolean,
    onOpenPicker: () -> Unit,
) {
    val c = ShiftTheme.colors
    val context = LocalContext.current
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(c.surface)
            .border(1.dp, c.divider, RoundedCornerShape(14.dp))
            .clickable(enabled = canSwitchHouse, onClick = onOpenPicker)
            .padding(horizontal = 14.dp, vertical = 12.dp)
            .testTag("house_picker_open"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        HouseBadge(houseName.take(1), MaterialTheme.colorScheme.primaryContainer, MaterialTheme.colorScheme.primary)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(houseName, color = c.ink, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                if (isHomeHouse) {
                    Text(
                        "Your house",
                        color = MaterialTheme.colorScheme.primary,
                        fontSize = 10.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(MaterialTheme.colorScheme.primaryContainer)
                            .padding(horizontal = 6.dp, vertical = 1.dp),
                    )
                }
            }
            if (deskPhone != null) {
                // The desk phone is its OWN tap target — dials, doesn't open the picker.
                Row(
                    Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .clickable { context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$deskPhone"))) }
                        .padding(vertical = 2.dp, horizontal = 2.dp)
                        .testTag("house_call_desk"),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(5.dp),
                ) {
                    Icon(
                        ShiftIcons.Phone,
                        contentDescription = "Call desk",
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(14.dp),
                    )
                    Text("Desk · $deskPhone", color = MaterialTheme.colorScheme.primary, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                }
            } else {
                Text("House schedule", color = c.sec, fontSize = 13.sp)
            }
        }
        if (canSwitchHouse) {
            Icon(
                ShiftIcons.ChevronRight,
                contentDescription = "Change house",
                tint = c.ter,
                modifier = Modifier.size(18.dp).rotate(90f),
            )
        }
    }
}
