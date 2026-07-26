package com.pennhousing.shift.ui.onboarding

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pennhousing.shift.shared.onboarding.BreakTour
import com.pennhousing.shift.shared.onboarding.BreakTourStep
import com.pennhousing.shift.shared.onboarding.BreakTourStepId
import com.pennhousing.shift.shared.viewmodel.BreakTourUiState
import com.pennhousing.shift.ui.kit.ButtonSize
import com.pennhousing.shift.ui.kit.ButtonVariant
import com.pennhousing.shift.ui.kit.ShiftButton
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.theme.ShiftTheme

/**
 * BreakTourView (Android) — the Compose port of the interactive "Break calendar" onboarding
 * tour (see `iosApp/iosApp/BreakTourView.swift` for the SwiftUI original). It plays out on a
 * sample two-desk grid so the worker SEES the multi-lane layout with a couple of seats already
 * taken (step 1: LAYOUT), DOES a real press-and-drag claim across a desk (step 2: CLAIM), and
 * DOES a real press-and-drag drop over the worker's own hours with a live-updating action bar
 * (step 3: DROP).
 *
 * The step copy + the sample grid + the summary math live in shared `onboarding/BreakTour`;
 * `BreakTourViewModel` sequences the three steps. This file is rendering + gesture only,
 * mirroring `ShiftTourView.kt`'s exact shape (SharedPreferences seen-key store, plain Compose
 * visibility rather than iOS's spring/stagger motion).
 */

/** One thirty-minute row's rendered height, plus the 2dp of inter-row breathing room. */
private val ROW_PITCH = 32.dp
private val BLOCK_HEIGHT = 30.dp

/**
 * The tour overlay. The header "?" affordance (`BreakTourHelpButton`), its pointer callout
 * (`BreakTourPointerCallout`), and the two SharedPreferences stores (`BreakTourPrefs`,
 * `BreakTourPointerStore`) live in `BreakTourChrome.kt`; this file is the overlay itself: the
 * sample break grid the worker orients on (step 1), claims across with a
 * real press-and-drag (step 2), and drops from with a real press-and-drag plus a live action bar
 * (step 3), paired with a coach card carrying the step copy and Skip/Back/Next controls.
 */
@Composable
fun BreakTourOverlay(
    state: BreakTourUiState,
    onNext: () -> Unit,
    onBack: () -> Unit,
    onSkip: () -> Unit,
    onDismissOutside: () -> Unit = onSkip,
) {
    val step = state.step ?: return
    val c = ShiftTheme.colors
    val scrim = if (c.isDark) Color(0xC4000000) else Color(0x99101622)
    // Tapping the scrim dismisses the tour only on LAYOUT (view-only) -- CLAIM and DROP both
    // carry a real press-and-drag gesture, and a stray tap mid-drag must not lose the
    // worker's place.
    val dismissible = step.id == BreakTourStepId.LAYOUT

    // Live drag-selection state for the sample grid (steps 2 and 3 both drive it via the same
    // gesture; step 1 attaches no gesture at all). Block indices, [from, to] inclusive; -1 = no
    // selection. Reset whenever the step changes, mirroring iOS's `.onChange(of: idx)`.
    var selFrom by remember { mutableIntStateOf(-1) }
    var selTo by remember { mutableIntStateOf(-1) }
    var selLane by remember { mutableIntStateOf(0) }
    var dropConfirmed by remember { mutableStateOf(false) }

    LaunchedEffect(step.id) {
        selFrom = -1
        selTo = -1
        selLane = 0
        dropConfirmed = false
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(scrim)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = { if (dismissible) onDismissOutside() },
            )
            .testTag("break_tour"),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier.widthIn(max = 460.dp).fillMaxWidth().padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            stage(
                stepId = step.id,
                selFrom = selFrom,
                selTo = selTo,
                selLane = selLane,
                dropConfirmed = dropConfirmed,
                onSelect = { f, t, l -> selFrom = f; selTo = t; selLane = l },
                onDropConfirmed = {
                    dropConfirmed = true
                    selFrom = -1
                    selTo = -1
                },
            )
            coachCard(state, onNext = onNext, onBack = onBack, onSkip = onSkip)
        }
    }
}

@Composable
private fun stage(
    stepId: BreakTourStepId,
    selFrom: Int,
    selTo: Int,
    selLane: Int,
    dropConfirmed: Boolean,
    onSelect: (Int, Int, Int) -> Unit,
    onDropConfirmed: () -> Unit,
) {
    val c = ShiftTheme.colors
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(22.dp))
            .background(c.surface)
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        deskHeader()
        sampleGrid(stepId, selFrom, selTo, selLane, onSelect)
        if (stepId == BreakTourStepId.CLAIM) {
            claimSummaryLine(selFrom, selTo, selLane)
        }
        if (stepId == BreakTourStepId.DROP) {
            dropActionBar(selFrom, selTo, selLane, onDropConfirmed)
        }
        mockNav(highlightOpen = dropConfirmed)
    }
}

@Composable
private fun deskHeader() {
    val c = ShiftTheme.colors
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        BreakTour.LANE_LABELS.forEach { label ->
            Text(
                label,
                modifier = Modifier.weight(1f),
                textAlign = TextAlign.Center,
                color = c.ter,
                fontSize = 10.5.sp,
                fontWeight = FontWeight.Medium,
            )
        }
    }
}

/**
 * The sample break grid: two lanes ("Desk 1" / "Desk 2"), six thirty-minute blocks (08:00 to
 * 11:00), same visual vocabulary (colors, cell shape) as the real `BreakCalendarScreen`'s grid
 * so the lesson transfers directly. A single tap selects one block under the finger's desk
 * column; a press-and-drag selects a range, exactly like the real screen's
 * `detectDragGesturesAfterLongPress` (here implemented as a raw `awaitEachGesture` loop so it
 * isn't preempted and stays reliable under Robolectric's synthetic touch injection). Step 1
 * (LAYOUT) attaches no gesture at all: "no interaction required".
 */
@Composable
private fun sampleGrid(
    stepId: BreakTourStepId,
    selFrom: Int,
    selTo: Int,
    selLane: Int,
    onSelect: (Int, Int, Int) -> Unit,
) {
    val interactive = stepId != BreakTourStepId.LAYOUT
    val lo = if (selFrom < 0) -1 else minOf(selFrom, selTo)
    val hi = if (selFrom < 0) -1 else maxOf(selFrom, selTo)

    val gestureModifier =
        if (interactive) {
            Modifier.pointerInput(stepId) {
                val rowPitchPx = ROW_PITCH.toPx()
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    down.consume()
                    val laneWidthPx = size.width.toFloat() / BreakTour.LANE_COUNT
                    fun idxFor(y: Float) = (y / rowPitchPx).toInt().coerceIn(0, BreakTour.SAMPLE_BLOCK_COUNT - 1)
                    fun laneFor(x: Float) = (x / laneWidthPx).toInt().coerceIn(0, BreakTour.LANE_COUNT - 1)
                    val fromBlock = idxFor(down.position.y)
                    onSelect(fromBlock, fromBlock, laneFor(down.position.x))
                    while (true) {
                        val event = awaitPointerEvent()
                        val change = event.changes.firstOrNull { it.id == down.id } ?: break
                        if (!change.pressed) break
                        change.consume()
                        onSelect(fromBlock, idxFor(change.position.y), laneFor(change.position.x))
                    }
                }
            }
        } else {
            Modifier
        }

    // A non-merging semantics boundary, not a plain layout container: makes this ONE
    // queryable/draggable element instead of leaking per-cell tags, mirroring iOS's
    // `.accessibilityElement(children: .ignore)`.
    Column(
        Modifier
            .fillMaxWidth()
            .height(ROW_PITCH * BreakTour.SAMPLE_BLOCK_COUNT)
            .semantics(mergeDescendants = false) {}
            .testTag("break_tour_grid")
            .then(gestureModifier),
    ) {
        for (block in 0 until BreakTour.SAMPLE_BLOCK_COUNT) {
            val selected = lo >= 0 && block in lo..hi
            gridRow(stepId = stepId, block = block, selected = selected, selLane = selLane)
        }
    }
}

@Composable
private fun gridRow(
    stepId: BreakTourStepId,
    block: Int,
    selected: Boolean,
    selLane: Int,
) {
    Row(
        Modifier.fillMaxWidth().height(ROW_PITCH).padding(vertical = 1.dp),
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        for (lane in 0 until BreakTour.LANE_COUNT) {
            cell(
                stepId = stepId,
                block = block,
                lane = lane,
                selected = selected && lane == selLane,
                modifier = Modifier.weight(1f).fillMaxHeight(),
            )
        }
    }
}

@Composable
private fun cell(
    stepId: BreakTourStepId,
    block: Int,
    lane: Int,
    selected: Boolean,
    modifier: Modifier,
) {
    val c = ShiftTheme.colors
    val taken = BreakTour.TAKEN_SEATS.firstOrNull { it.blockIndex == block && it.lane == lane }
    // "Mine" (already-claimed-by-you) cells only appear in step 3's demo: steps 1/2 show those
    // same cells as OPEN so the claim gesture has real open seats to drag across.
    val isMine = stepId == BreakTourStepId.DROP && lane == BreakTour.MINE_LANE && block in BreakTour.MINE_BLOCKS
    // Step 3 only: a selected "mine" cell flips to the danger "about to drop" treatment.
    val aboutToDrop = stepId == BreakTourStepId.DROP && isMine && selected

    val bg =
        when {
            aboutToDrop -> c.danger.accent
            isMine -> c.breakShift.accent
            taken != null -> c.surface
            selected -> c.breakShift.accent.copy(alpha = 0.35f)
            else -> c.surfaceVar
        }
    val borderColor =
        when {
            aboutToDrop -> c.danger.accent
            taken != null -> c.divider
            selected && !isMine -> c.breakShift.accent
            else -> Color.Transparent
        }
    val label =
        when {
            aboutToDrop -> "Dropping"
            isMine -> "You"
            taken != null -> taken.workerName
            else -> null
        }
    val labelColor = if (aboutToDrop || isMine) Color.White else c.sec

    Box(
        modifier
            .clip(RoundedCornerShape(6.dp))
            .background(bg)
            .border(1.dp, borderColor, RoundedCornerShape(6.dp)),
        contentAlignment = Alignment.CenterStart,
    ) {
        if (label != null) {
            Text(
                label,
                color = labelColor,
                fontSize = 11.5.sp,
                fontWeight = if (aboutToDrop || isMine) FontWeight.SemiBold else FontWeight.Medium,
                maxLines = 1,
                modifier = Modifier.padding(horizontal = 8.dp),
            )
        }
    }
}

/**
 * Step 2's live claim summary caption, recomputed by the shared `BreakTour.claimSummary` as the
 * worker drags. Default/no-selection text mirrors the real screen's neutral prompt.
 */
@Composable
private fun claimSummaryLine(
    selFrom: Int,
    selTo: Int,
    selLane: Int,
) {
    val text =
        if (selFrom >= 0) {
            BreakTour.claimSummary(fromBlock = minOf(selFrom, selTo), toBlock = maxOf(selFrom, selTo) + 1, lane = selLane)
        } else {
            "Press and drag down a desk"
        }
    Text(
        text,
        color = MaterialTheme.colorScheme.primary,
        fontSize = 14.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.fillMaxWidth().testTag("break_tour_claim_summary"),
    )
}

/**
 * Step 3's pinned action bar: message + Drop button, both driven LIVE off the actual drag
 * overlap with the worker's claimed blocks (`BreakTour.overlappingMineBlocks`). Starts neutral
 * with Drop disabled; only enables once the drag overlaps a "mine" block.
 */
@Composable
private fun dropActionBar(
    selFrom: Int,
    selTo: Int,
    selLane: Int,
    onDropConfirmed: () -> Unit,
) {
    val c = ShiftTheme.colors
    val overlap =
        if (selFrom >= 0) {
            BreakTour.overlappingMineBlocks(fromBlock = minOf(selFrom, selTo), toBlock = maxOf(selFrom, selTo) + 1, lane = selLane)
        } else {
            emptyList()
        }
    val hasDrop = overlap.isNotEmpty()
    val message =
        if (hasDrop) {
            BreakTour.dropSummary(fromBlock = overlap.min(), toBlock = overlap.max() + 1)
        } else {
            BreakTour.dropSummary(fromBlock = -1, toBlock = -1)
        }

    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(c.surfaceVar)
            .padding(12.dp)
            .testTag("break_tour_action_bar"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            message,
            color = if (hasDrop) c.danger.accent else c.ink,
            fontSize = 13.sp,
            fontWeight = if (hasDrop) FontWeight.Medium else FontWeight.Normal,
            modifier = Modifier.weight(1f).testTag("break_tour_drop_message"),
        )
        ShiftButton(
            text = "Drop",
            onClick = onDropConfirmed,
            variant = ButtonVariant.Destructive,
            size = ButtonSize.Sm,
            enabled = hasDrop,
            modifier = Modifier.testTag("break_tour_drop_button"),
        )
    }
}

/**
 * A representative bottom-nav strip mirroring the real bottom nav's icon set. The Open item
 * highlights once a step-3 drop is confirmed, showing where unclaimed hours land.
 */
@Composable
private fun mockNav(highlightOpen: Boolean) {
    val c = ShiftTheme.colors
    Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
        navItem("My Shifts", ShiftIcons.List, c.ter)
        navItem("Open", ShiftIcons.Plus, if (highlightOpen) c.pending else c.ter)
        navItem("House", ShiftIcons.Building, c.ter)
        navItem("Swaps", ShiftIcons.Refresh, c.ter)
        navItem("More", ShiftIcons.MoreHorizontal, c.ter)
    }
}

@Composable
private fun navItem(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    tint: Color,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(16.dp))
        Text(label, color = tint, fontSize = 10.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun coachCard(
    state: BreakTourUiState,
    onNext: () -> Unit,
    onBack: () -> Unit,
    onSkip: () -> Unit,
) {
    val step = state.step ?: return
    val c = ShiftTheme.colors
    Column(
        Modifier
            .widthIn(max = 460.dp)
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(c.surface)
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(step.kicker, color = MaterialTheme.colorScheme.primary, fontSize = 11.sp, fontWeight = FontWeight.Bold)
        Text(step.title, color = c.ink, fontSize = 19.sp, fontWeight = FontWeight.SemiBold)
        bodyText(step, c.sec, c.pending)
        Row(
            Modifier.fillMaxWidth().padding(top = 6.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ShiftButton(
                text = "Skip",
                onClick = onSkip,
                variant = ButtonVariant.Text,
                size = ButtonSize.Sm,
                modifier = Modifier.testTag("break_tour_skip"),
            )
            Text("${state.stepIndex} of ${state.stepCount}", color = c.ter, fontSize = 13.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (state.canGoBack) {
                    ShiftButton(
                        text = "Back",
                        onClick = onBack,
                        variant = ButtonVariant.Outlined,
                        size = ButtonSize.Sm,
                        modifier = Modifier.testTag("break_tour_back"),
                    )
                }
                ShiftButton(
                    text = if (state.isLastStep) "Done" else "Next",
                    onClick = onNext,
                    variant = ButtonVariant.Filled,
                    size = ButtonSize.Sm,
                    modifier = Modifier.testTag("break_tour_next"),
                )
            }
        }
    }
}

/**
 * Step 3 gets colored emphasis on "Open" (the pending/amber accent, matching the real Open tab);
 * other steps render the shared body verbatim. The words match `BreakTour.STEPS` exactly.
 */
@Composable
private fun bodyText(
    step: BreakTourStep,
    textColor: Color,
    openColor: Color,
) {
    if (step.id == BreakTourStepId.DROP) {
        val annotated =
            buildAnnotatedString {
                append("Drag over hours you claimed to drop them. Anything left unclaimed moves to ")
                withStyle(SpanStyle(color = openColor, fontWeight = FontWeight.Bold)) { append("Open") }
                append(" shifts.")
            }
        Text(annotated, color = textColor, fontSize = 15.sp)
    } else {
        Text(step.body, color = textColor, fontSize = 15.sp)
    }
}
