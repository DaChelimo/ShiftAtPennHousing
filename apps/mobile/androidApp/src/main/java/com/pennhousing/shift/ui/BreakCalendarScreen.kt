package com.pennhousing.shift.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pennhousing.shift.shared.breakclaim.BreakBlockCoverage
import com.pennhousing.shift.shared.breakclaim.BreakDragMode
import com.pennhousing.shift.shared.breakclaim.BreakDragPlan
import com.pennhousing.shift.shared.breakclaim.BreakHoursMeter
import com.pennhousing.shift.shared.breakclaim.BreakPhase
import com.pennhousing.shift.shared.breakclaim.BreakWeekCell
import com.pennhousing.shift.shared.viewmodel.BreakCalendarViewModel
import com.pennhousing.shift.ui.kit.BannerTone
import com.pennhousing.shift.ui.kit.ButtonSize
import com.pennhousing.shift.ui.kit.ButtonVariant
import com.pennhousing.shift.ui.kit.EmptyState
import com.pennhousing.shift.ui.kit.ShiftBanner
import com.pennhousing.shift.ui.kit.ShiftButton
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.kit.ShiftToast
import com.pennhousing.shift.ui.kit.ToastTone
import com.pennhousing.shift.ui.theme.ShiftTheme
import kotlinx.coroutines.delay

/**
 * Break CALENDAR picker (Break redesign B4) — the spatial replacement for the flat
 * break-shift list. The break window renders like the house schedule (single lane for
 * regular houses, 2 for Harnwell, 3 for Quad): a vertical time grid where occupied seats
 * are read-only and the remaining capacity is DRAG-CLAIMABLE. Tap a block or long-press +
 * drag a range; the claim fills one open seat per block ("system-assigned lane") and the
 * confirm bar reports the trim ("Claimed 4:00-6:00 · 6:00-8:00 was already full"). After
 * T-1d the calendar is read-only and points to Open Shifts (round 2).
 *
 * Selector ids: see apps/mobile/maestro/README.md.
 */
private val BREAK_BLOCK_HEIGHT = 30.dp
private val BREAK_GUTTER_WIDTH = 46.dp

@Composable
fun BreakCalendarTabContent(
    vm: BreakCalendarViewModel,
    // Live host POSTs the dragged block ids to `break-claim` (best-effort), then reconciles
    // the picker to the server's actual claimed seats; demo defaults to no live write.
    onClaimRange: (List<String>) -> Unit = {},
    // Live host POSTs a `drop-shift` covering the run's seats; demo defaults to no write.
    onDropSeats: (List<String>) -> Unit = {},
    // Live host writes the §4.4 "no break hours" opt-out; argument = the NEW state.
    onToggleOptOut: (Boolean) -> Unit = {},
) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    val c = ShiftTheme.colors

    var toastTick by remember { mutableIntStateOf(0) }
    var toastMsg by remember { mutableStateOf("Break shift claimed") }
    var showToast by remember { mutableStateOf(false) }
    LaunchedEffect(toastTick) {
        if (toastTick > 0) {
            showToast = true
            delay(2200)
            showToast = false
        }
    }
    // The current drag/tap selection (block indices on the shown day); -1 = none. Cleared
    // when the shown day/week changes so a stale selection never claims the wrong day.
    var selFrom by remember(state.selectedDayIndex, state.weekIndex) { mutableIntStateOf(-1) }
    var selTo by remember(state.selectedDayIndex, state.weekIndex) { mutableIntStateOf(-1) }
    // The lane (desk) column the finger is over — drives the nearest-seat highlight.
    var selCol by remember(state.selectedDayIndex, state.weekIndex) { mutableIntStateOf(0) }
    fun clearSelection() {
        selFrom = -1
        selTo = -1
    }

    // LIVE build, no break scheduled → honest empty state (never the fake demo calendar,
    // whose claims silently fail). Claiming is impossible here by design.
    if (state.noActiveBreak) {
        Column(Modifier.fillMaxSize().background(c.bg).testTag("break_calendar_screen")) {
            EmptyState(
                title = "No break scheduled",
                icon = ShiftIcons.Snowflake,
                body = "There's no break open for claiming right now. When a break's calendar opens, you'll be able to pick your shifts here.",
            )
        }
        return
    }

    Column(Modifier.fillMaxSize().background(c.bg).testTag("break_calendar_screen")) {
        Text(
            "${state.breakName.uppercase()} · CLAIM-BASED",
            modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 10.dp),
            color = c.breakShift.deep,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = 0.05.em,
        )
        if (showToast) {
            ShiftToast(
                message = toastMsg,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp).testTag("break_calendar_success"),
                tone = ToastTone.Success,
                icon = ShiftIcons.Snowflake,
            )
        }
        BreakCalInfoCard(state.houseName, state.windowLabel, state.phase)
        Spacer(Modifier.height(6.dp))
        BreakCalMeter(state.meter)
        BreakCalOptOut(state.optedOut) { onToggleOptOut(vm.toggleOptedOut()) }

        if (state.weeks.size > 1) {
            Spacer(Modifier.height(4.dp))
            BreakWeekTabs(state.weeks.map { it.rangeLabel }, state.weekIndex) { vm.selectWeek(it) }
        }
        Spacer(Modifier.height(4.dp))
        BreakDayStrip(state.weekStrip, state.selectedDayIndex) { vm.selectDay(it) }
        // Breathing room between the day selector and the shifts grid.
        Spacer(Modifier.height(14.dp))

        // The grid takes the remaining height so the action bar stays pinned to the bottom.
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                state.optedOut ->
                    EmptyState(
                        title = "No break hours",
                        icon = ShiftIcons.Ban,
                        body = "You won't be scheduled this break. Untick \"no break hours\" to claim shifts.",
                    )
                state.phase == BreakPhase.PRE_OPEN ->
                    EmptyState(
                        title = "Opens soon",
                        icon = ShiftIcons.Snowflake,
                        body = "The ${state.breakName} calendar (${state.windowLabel}) opens 14 days before the break. Come back to pick your shifts.",
                    )
                !state.day.inWindow ->
                    EmptyState(
                        title = "Outside the break",
                        icon = ShiftIcons.Snowflake,
                        body = "Pick a day inside ${state.windowLabel} to claim break shifts.",
                    )
                state.day.isEmpty ->
                    EmptyState(
                        title = "Nothing scheduled",
                        icon = ShiftIcons.Snowflake,
                        body = "No blocks open for this day.",
                    )
                else -> {
                    val lanes = state.day.blocks.firstOrNull()?.requiredHeadcount ?: 1
                    Column(Modifier.fillMaxSize()) {
                        // Greyed "Desk 1 / Desk 2 …" column headers so the side-by-side seats
                        // of a multi-staff house read clearly. Fixed above the scrolling grid.
                        if (lanes > 1) BreakDeskHeader(lanes)
                        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
                            if (state.readOnly) {
                                ShiftBanner(
                                    title = "Claiming closed",
                                    body = "The picker closed for this break. Remaining shifts are now in Open Shifts.",
                                    tone = BannerTone.Info,
                                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp).testTag("break_calendar_readonly_banner"),
                                )
                            }
                            BreakDayGrid(
                                blocks = state.day.blocks,
                                selFrom = selFrom,
                                selTo = selTo,
                                selCol = selCol,
                                lanes = lanes,
                                enabled = !state.readOnly,
                                onSelect = { from, to, col ->
                                    selFrom = from
                                    selTo = to
                                    selCol = col
                                },
                            )
                            Spacer(Modifier.height(16.dp))
                        }
                    }
                }
            }
        }

        // The contextual action bar — PINNED above the bottom nav whenever a selection
        // exists (claim open capacity, or confirm dropping the worker's own coverage).
        if (selFrom >= 0 && !state.readOnly && !state.optedOut) {
            val plan = vm.previewDrag(selFrom, selTo)
            BreakActionBar(
                plan = plan,
                onClaim = {
                    val blockIds = vm.commitDrag(plan)
                    if (blockIds.isNotEmpty()) {
                        onClaimRange(blockIds)
                        toastMsg = "Break shift claimed"
                        toastTick++
                    }
                    clearSelection()
                },
                onDrop = {
                    vm.drop(plan.dropSeatIds)
                    onDropSeats(plan.dropSeatIds)
                    toastMsg = "Break shift dropped"
                    toastTick++
                    clearSelection()
                },
                onCancel = { clearSelection() },
            )
        }
    }
}

// ── Header / meter / opt-out ─────────────────────────────────────────────────────

@Composable
private fun BreakCalInfoCard(
    houseName: String,
    windowLabel: String,
    phase: BreakPhase,
) {
    val c = ShiftTheme.colors
    val body =
        when (phase) {
            BreakPhase.CLAIM_WINDOW -> "First-come, first-served · drag to pick your hours · 40h hard cap · $windowLabel"
            BreakPhase.OPEN_FEED -> "Claiming closed. Leftover shifts are in Open Shifts · $windowLabel"
            BreakPhase.PRE_OPEN -> "Opens 14 days before the break · $windowLabel"
        }
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 2.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(c.surface)
            .border(1.dp, c.divider, RoundedCornerShape(14.dp))
            .padding(horizontal = 14.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(11.dp),
    ) {
        Icon(ShiftIcons.Snowflake, contentDescription = null, tint = c.breakShift.accent, modifier = Modifier.size(20.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(houseName, color = c.breakShift.deep, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            Text(body, color = c.sec, fontSize = 12.5.sp, lineHeight = 17.sp)
        }
    }
}

@Composable
private fun BreakCalMeter(meter: BreakHoursMeter) {
    val c = ShiftTheme.colors
    val barColor = if (meter.atCap) c.danger.accent else c.breakShift.accent
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).testTag("break_hours_meter"),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("This break", color = c.sec, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Row {
                Text(
                    meter.currentLabel,
                    style = ShiftTheme.type.monoTime.copy(fontSize = 13.sp),
                    color = if (meter.atCap) c.danger.accent else c.ink,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(" / ${meter.capLabel}", style = ShiftTheme.type.monoTime.copy(fontSize = 13.sp), color = c.ter)
            }
        }
        Box(Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(50)).background(c.surfaceVar)) {
            Box(Modifier.fillMaxWidth(meter.fraction.toFloat()).height(6.dp).clip(RoundedCornerShape(50)).background(barColor))
        }
    }
}

@Composable
private fun BreakCalOptOut(
    optedOut: Boolean,
    onToggle: () -> Unit,
) {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp)
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onToggle)
            .testTag("break_no_hours_toggle"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Box(
            Modifier
                .size(22.dp)
                .clip(RoundedCornerShape(7.dp))
                .background(if (optedOut) c.breakShift.accent else Color.Transparent)
                .border(1.5.dp, if (optedOut) c.breakShift.accent else c.outline, RoundedCornerShape(7.dp)),
            contentAlignment = Alignment.Center,
        ) {
            if (optedOut) Icon(ShiftIcons.Check, contentDescription = null, tint = Color.White, modifier = Modifier.size(14.dp))
        }
        Text("I have no hours this break", color = c.sec, fontSize = 13.5.sp, fontWeight = FontWeight.Medium)
    }
}

// ── Week tabs + day strip ─────────────────────────────────────────────────────────

@Composable
private fun BreakWeekTabs(
    labels: List<String>,
    selected: Int,
    onSelect: (Int) -> Unit,
) {
    val c = ShiftTheme.colors
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp).testTag("break_calendar_week_tabs"),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        labels.forEachIndexed { i, label ->
            val on = i == selected
            Text(
                label,
                modifier =
                    Modifier
                        .clip(RoundedCornerShape(50))
                        .background(if (on) c.breakShift.tint else c.surfaceVar)
                        .clickable { onSelect(i) }
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                color = if (on) c.breakShift.deep else c.sec,
                fontSize = 12.5.sp,
                fontWeight = if (on) FontWeight.SemiBold else FontWeight.Medium,
            )
        }
    }
}

@Composable
private fun BreakDayStrip(
    cells: List<BreakWeekCell>,
    selected: Int,
    onSelect: (Int) -> Unit,
) {
    val c = ShiftTheme.colors
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).testTag("break_calendar_week_strip"),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        cells.forEach { cell ->
            val on = cell.index == selected
            val enabled = cell.inWindow
            Column(
                Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(12.dp))
                    .background(if (on) c.breakShift.accent else if (enabled) c.surface else Color.Transparent)
                    .then(if (enabled) Modifier.clickable { onSelect(cell.index) } else Modifier)
                    .padding(vertical = 7.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Text(cell.dayLetter, color = if (on) Color.White else c.ter, fontSize = 10.5.sp, fontWeight = FontWeight.Medium)
                Text(
                    cell.dateLabel,
                    color = if (on) Color.White else if (enabled) c.ink else c.ter.copy(alpha = 0.5f),
                    fontSize = 13.sp,
                    fontWeight = if (on) FontWeight.Bold else FontWeight.Medium,
                )
                Box(
                    Modifier.size(4.dp).clip(RoundedCornerShape(50))
                        .background(if (cell.hasSeats && !on) c.breakShift.accent else Color.Transparent),
                )
            }
        }
    }
}

// ── The day grid (claim surface) ───────────────────────────────────────────────────

/** Greyed "Desk 1 / Desk 2 …" headers aligned with the grid's lane columns. */
@Composable
private fun BreakDeskHeader(lanes: Int) {
    val c = ShiftTheme.colors
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp)) {
        Spacer(Modifier.width(BREAK_GUTTER_WIDTH))
        Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            (0 until lanes).forEach { i ->
                Text(
                    "Desk ${i + 1}",
                    modifier = Modifier.weight(1f),
                    color = c.ter,
                    fontSize = 10.5.sp,
                    fontWeight = FontWeight.Medium,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}

@Composable
private fun BreakDayGrid(
    blocks: List<BreakBlockCoverage>,
    selFrom: Int,
    selTo: Int,
    selCol: Int,
    lanes: Int,
    enabled: Boolean,
    onSelect: (Int, Int, Int) -> Unit,
) {
    if (blocks.isEmpty()) return
    // Each block row is BREAK_BLOCK_HEIGHT + its 1.dp vertical padding on each side (see
    // BreakBlockRow). The grid height, the gutter label offsets, and the drag's y→index
    // math MUST all use this pitch, or they drift ~2.dp/row and the wrong (often first/last)
    // cell gets selected.
    val rowPitch = BREAK_BLOCK_HEIGHT + 2.dp
    val total = rowPitch * blocks.size
    val blockPx = with(LocalDensity.current) { rowPitch.toPx() }
    fun idxAt(y: Float): Int = (y / blockPx).toInt().coerceIn(0, blocks.size - 1)
    val lo = if (selFrom < 0) -1 else minOf(selFrom, selTo)
    val hi = if (selFrom < 0) -1 else maxOf(selFrom, selTo)

    Row(Modifier.fillMaxWidth().height(total).padding(horizontal = 12.dp).testTag("break_calendar_day")) {
        // Hour gutter — each label sits on its block's boundary line.
        Box(Modifier.width(BREAK_GUTTER_WIDTH).fillMaxHeight()) {
            blocks.forEachIndexed { i, b ->
                if (b.isHourStart) {
                    Text(
                        b.startLabel,
                        modifier = Modifier
                            .align(Alignment.TopEnd)
                            .offset(y = (rowPitch * i - 7.dp).coerceAtLeast(0.dp))
                            .padding(end = 8.dp),
                        color = ShiftTheme.colors.ter,
                        fontSize = 11.sp,
                    )
                }
            }
        }
        Box(
            Modifier
                .weight(1f)
                .fillMaxHeight()
                .then(
                    if (enabled) {
                        Modifier
                            // The lane (desk) column under the finger — drives the nearest-seat
                            // highlight (size.width is the lanes area, gutter excluded).
                            .pointerInput(blocks, lanes) {
                                fun colAt(x: Float): Int = (x / (size.width.toFloat() / lanes)).toInt().coerceIn(0, lanes - 1)
                                detectTapGestures { o -> val i = idxAt(o.y); onSelect(i, i, colAt(o.x)) }
                            }
                            .pointerInput(blocks, lanes) {
                                fun colAt(x: Float): Int = (x / (size.width.toFloat() / lanes)).toInt().coerceIn(0, lanes - 1)
                                var startIdx = 0
                                detectDragGesturesAfterLongPress(
                                    onDragStart = { o -> startIdx = idxAt(o.y); onSelect(startIdx, startIdx, colAt(o.x)) },
                                    onDrag = { ch, _ ->
                                        ch.consume()
                                        onSelect(startIdx, idxAt(ch.position.y), colAt(ch.position.x))
                                    },
                                )
                            }
                    } else {
                        Modifier
                    },
                ),
        ) {
            Column(Modifier.fillMaxSize()) {
                blocks.forEachIndexed { i, b ->
                    val selected = i in lo..hi && lo >= 0
                    BreakBlockRow(b, highlightedLane = if (selected) b.highlightLane(selCol) else null)
                }
            }
        }
    }
}

@Composable
private fun BreakBlockRow(
    block: BreakBlockCoverage,
    highlightedLane: Int?,
) {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .height(BREAK_BLOCK_HEIGHT)
            .testTag("break_block_row"),
        horizontalArrangement = Arrangement.spacedBy(3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        block.lanes.forEachIndexed { idx, lane ->
            // Only ONE seat per timeslot highlights — the open seat nearest the finger
            // ([highlightedLane]); the other open seat stays neutral so it never looks like
            // both desks are being taken at once.
            val isHi = idx == highlightedLane
            val bg =
                when {
                    lane.mine -> c.breakShift.accent
                    isHi -> c.breakShift.accent.copy(alpha = 0.35f)
                    lane.open -> c.surfaceVar
                    else -> c.surface
                }
            val borderColor =
                when {
                    isHi -> c.breakShift.accent
                    !lane.open -> c.divider
                    else -> Color.Transparent
                }
            val fg = if (lane.mine) Color.White else c.sec
            Box(
                Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .padding(vertical = 1.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(bg)
                    .then(if (borderColor != Color.Transparent) Modifier.border(1.dp, borderColor, RoundedCornerShape(6.dp)) else Modifier),
                contentAlignment = Alignment.CenterStart,
            ) {
                if (!lane.open) {
                    Text(
                        if (lane.mine) "You" else (lane.workerName?.firstName() ?: "Taken"),
                        modifier = Modifier.padding(horizontal = 8.dp),
                        color = fg,
                        fontSize = 11.5.sp,
                        fontWeight = if (lane.mine) FontWeight.SemiBold else FontWeight.Medium,
                    )
                }
            }
        }
    }
}

// ── The contextual action bar (pinned above the bottom nav) ─────────────────────────

@Composable
private fun BreakActionBar(
    plan: BreakDragPlan,
    onClaim: () -> Unit,
    onDrop: () -> Unit,
    onCancel: () -> Unit,
) {
    val c = ShiftTheme.colors
    val isDrop = plan.mode == BreakDragMode.DROP && plan.droppable
    Row(
        Modifier
            .fillMaxWidth()
            .background(c.surface)
            .drawTopBorder(c.divider)
            .padding(16.dp)
            .testTag("break_calendar_claim_bar"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            plan.message,
            color = if (isDrop) c.danger.accent else c.ink,
            fontSize = 13.sp,
            fontWeight = if (isDrop) FontWeight.Medium else FontWeight.Normal,
            modifier = Modifier.weight(1f),
        )
        ShiftButton("Cancel", onCancel, variant = ButtonVariant.Outlined, size = ButtonSize.Sm)
        if (isDrop) {
            ShiftButton(
                "Drop",
                onClick = onDrop,
                modifier = Modifier.testTag("break_calendar_drop_button"),
                variant = ButtonVariant.Destructive,
                size = ButtonSize.Sm,
            )
        } else {
            ShiftButton(
                "Claim",
                onClick = onClaim,
                modifier = Modifier.testTag("break_calendar_claim_button"),
                size = ButtonSize.Sm,
                enabled = plan.claimable,
            )
        }
    }
}

/** A 1dp top divider line for the pinned action bar. */
private fun Modifier.drawTopBorder(color: Color): Modifier =
    drawBehind {
        drawLine(color, Offset(0f, 0f), Offset(size.width, 0f), 1.dp.toPx())
    }

// ── small helpers ──────────────────────────────────────────────────────────────────

private fun String.firstName(): String = trim().substringBefore(' ').ifEmpty { this }

/**
 * The active-break promotion banner (Break redesign B6): shown on the other tabs while a
 * break's claim window is open, deep-linking into the Break calendar (which otherwise
 * lives in the More overflow).
 */
@Composable
fun BreakOpenBanner(
    breakName: String,
    onOpen: () -> Unit,
) {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(c.breakShift.tint)
            .clickable(onClick = onOpen)
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .testTag("break_open_banner"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(ShiftIcons.Snowflake, contentDescription = null, tint = c.breakShift.accent, modifier = Modifier.size(18.dp))
        Column(Modifier.weight(1f)) {
            Text("$breakName is open", color = c.breakShift.deep, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold)
            Text("Pick your break shifts", color = c.sec, fontSize = 12.sp)
        }
        Text("→", color = c.breakShift.accent, fontSize = 16.sp, fontWeight = FontWeight.Bold)
    }
}
