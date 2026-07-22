package com.pennhousing.shift.ui.onboarding

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RangeSlider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pennhousing.shift.shared.onboarding.SwapTour
import com.pennhousing.shift.shared.onboarding.SwapTourMode
import com.pennhousing.shift.shared.onboarding.SwapTourStepId
import com.pennhousing.shift.shared.viewmodel.SwapTourUiState
import com.pennhousing.shift.ui.kit.ButtonSize
import com.pennhousing.shift.ui.kit.ButtonVariant
import com.pennhousing.shift.ui.kit.ShiftButton
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.theme.ShiftTheme

/**
 * SwapTourView (Android) — the Compose port of the interactive swap-composer onboarding
 * tour (see `iosApp/iosApp/SwapTourView.swift` for the SwiftUI original). It opens ONLY
 * once a worker is already inside the swap composer, having already chosen "Swap it" over
 * "Drop the shift" on the prior Manage-shift screen (that decision is `ShiftTour`'s job).
 * This tour teaches what's INSIDE the composer: the Swap-vs-Hand-off sub-mode (step 1),
 * picking a housemate and an amount with the real range slider (step 2), and the segmented
 * give/take timeline for splitting a shift between two people (step 3).
 *
 * The step copy + the step-2 give/take summary math live in shared `onboarding/SwapTour`;
 * the `SwapTourViewModel` sequences the three steps. This file is rendering only, matching
 * `ShiftTourView.kt`'s conventions exactly (SharedPreferences for the seen-key store, plain
 * Compose visibility rather than iOS's spring/stagger motion).
 */

/** Its OWN seen-key store, separate from ShiftTour's and every other tour's (mirrors iOS). */
object SwapTourPrefs {
    private const val PREFS = "onboarding"
    private const val KEY = "swap_tour_seen_keys"

    fun read(context: Context): Set<String> =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getStringSet(KEY, emptySet())?.toSet() ?: emptySet()

    fun write(
        context: Context,
        seen: Set<String>,
    ) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putStringSet(KEY, HashSet(seen)).apply()
    }
}

/** Per-device flag: whether the swap composer's "?" has already shown its one-time pointer. */
object SwapTourPointerStore {
    private const val PREFS = "onboarding"
    private const val KEY = "swap_tour_pointer_shown"

    fun hasShown(context: Context): Boolean = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY, false)

    fun markShown(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY, true).apply()
    }
}

/**
 * The "?" affordance in the swap composer's header that replays the tour. Reports its own
 * on-screen bounds via [onPositioned] so the one-time pointer callout can point at the real
 * button without the two composables needing to know each other's layout.
 */
@Composable
fun SwapTourHelpButton(
    onClick: () -> Unit,
    onPositioned: (Rect) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    Box(
        modifier
            .size(34.dp)
            .onGloballyPositioned { coords -> onPositioned(coords.boundsInRoot()) }
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.primaryContainer)
            .clickable(onClick = onClick)
            .testTag("swap_tour_help"),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            ShiftIcons.QuestionMark,
            contentDescription = "Replay the swap tour",
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(16.dp),
        )
    }
}

/**
 * The one-time "look here" pointer at the header "?", shown once right after the tour first
 * finishes so the worker learns where it went. Non-blocking (no click handling), fading on
 * its own timer driven by the caller. [targetRect] is the help button's root-space bounds
 * (from [SwapTourHelpButton]'s [onPositioned]); renders nothing until known.
 */
@Composable
fun SwapTourPointerCallout(
    targetRect: Rect?,
    modifier: Modifier = Modifier,
) {
    if (targetRect == null) return
    Box(modifier.fillMaxSize().testTag("swap_tour_pointer")) {
        Column(
            Modifier
                .padding(top = with(androidx.compose.ui.platform.LocalDensity.current) { (targetRect.bottom + 10f).toDp() })
                .align(Alignment.TopEnd)
                .padding(end = 16.dp)
                .widthIn(max = 200.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(MaterialTheme.colorScheme.primary)
                .padding(horizontal = 14.dp, vertical = 10.dp),
        ) {
            Text("Find this again here", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Text("Tap to replay the tour", color = Color.White.copy(alpha = 0.85f), fontSize = 12.sp)
        }
    }
}

/**
 * The tour overlay — the sample swap composer the worker picks a mode on (step 1), sizes a
 * give amount on (step 2), and splits between two people on (step 3), paired with a coach
 * card carrying the step copy and Skip/Back/Next controls.
 */
@Composable
fun SwapTourOverlay(
    state: SwapTourUiState,
    onNext: () -> Unit,
    onBack: () -> Unit,
    onSkip: () -> Unit,
    onDismissOutside: () -> Unit = onSkip,
) {
    val step = state.step ?: return
    val c = ShiftTheme.colors
    val scrim = if (c.isDark) Color(0xC4000000) else Color(0x99101622)
    // Tapping the scrim dismisses the tour, except on the AMOUNT step where the sample
    // range slider needs the full card area to itself -- a stray tap while dragging must
    // not lose the worker's place.
    val dismissible = step.id != SwapTourStepId.AMOUNT

    // Step-1 sub-mode choice. Defaults to Swap, matching the real composer's own default.
    // Step-2 interactive state: block indices on the sample give-shift grid, [from, to).
    // Defaults mirror SwapTour.DEFAULT_FROM_BLOCK/TO_BLOCK (18:00 to 20:00). Step-3: which
    // free segment is currently focused (tap-to-focus). All fresh every time this composable
    // mounts (the overlay is only composed while the tour is active).
    var mode by remember { mutableStateOf(SwapTourMode.SWAP) }
    var from by remember { mutableIntStateOf(SwapTour.DEFAULT_FROM_BLOCK) }
    var to by remember { mutableIntStateOf(SwapTour.DEFAULT_TO_BLOCK) }
    var focusedSegmentId by remember { mutableIntStateOf(1) }
    val blockCount = SwapTour.SAMPLE_BLOCK_COUNT

    Box(
        Modifier
            .fillMaxSize()
            .background(scrim)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = { if (dismissible) onDismissOutside() },
            )
            .testTag("swap_tour"),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier.widthIn(max = 460.dp).fillMaxWidth().padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            stage(
                stepId = step.id,
                mode = mode,
                from = from,
                to = to,
                focusedSegmentId = focusedSegmentId,
                blockCount = blockCount,
                onModeChange = { mode = it },
                onRange = { f, t -> from = f; to = t },
                onSegmentFocus = { focusedSegmentId = it },
            )
            coachCard(state, onNext = onNext, onBack = onBack, onSkip = onSkip)
        }
    }
}

@Composable
private fun stage(
    stepId: SwapTourStepId,
    mode: SwapTourMode,
    from: Int,
    to: Int,
    focusedSegmentId: Int,
    blockCount: Int,
    onModeChange: (SwapTourMode) -> Unit,
    onRange: (Int, Int) -> Unit,
    onSegmentFocus: (Int) -> Unit,
) {
    val c = ShiftTheme.colors
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(22.dp))
            .background(c.surface)
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        when (stepId) {
            SwapTourStepId.MODE ->
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    breadcrumb()
                    modeCards(mode, onModeChange)
                }
            SwapTourStepId.AMOUNT -> amountControls(mode, from, to, blockCount, onRange)
            SwapTourStepId.SPLIT -> splitStage(focusedSegmentId, onSegmentFocus)
        }
        mockNav(highlightSwaps = stepId == SwapTourStepId.SPLIT)
    }
}

/**
 * A small breadcrumb above step 1's cards, so it reads as nested inside a flow (the worker
 * already chose "Swap" on the prior Manage-shift screen) rather than a standalone top-level
 * choice.
 */
@Composable
private fun breadcrumb() {
    val c = ShiftTheme.colors
    Row(
        Modifier.testTag("swap_tour_breadcrumb"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text("From Manage shift", color = c.ter, fontSize = 11.5.sp, fontWeight = FontWeight.Medium)
        Icon(ShiftIcons.ChevronRight, contentDescription = null, tint = c.ter, modifier = Modifier.size(8.dp))
        Text("Swap", color = c.sec, fontSize = 11.5.sp, fontWeight = FontWeight.Medium)
    }
}

/**
 * Step 1: two equal-weight cards, Swap vs Hand off — a real two-way choice inside the
 * composer (unlike the Drop-vs-Swap decision from the prior screen, never shown here).
 */
@Composable
private fun modeCards(
    mode: SwapTourMode,
    onModeChange: (SwapTourMode) -> Unit,
) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        modeCard(
            title = "Swap",
            icon = ShiftIcons.Refresh,
            selected = mode == SwapTourMode.SWAP,
            tag = "swap_tour_mode_swap",
            modifier = Modifier.weight(1f),
            onClick = { onModeChange(SwapTourMode.SWAP) },
        )
        modeCard(
            title = "Hand off",
            icon = ShiftIcons.Send,
            selected = mode == SwapTourMode.HAND_OFF,
            tag = "swap_tour_mode_handoff",
            modifier = Modifier.weight(1f),
            onClick = { onModeChange(SwapTourMode.HAND_OFF) },
        )
    }
}

@Composable
private fun modeCard(
    title: String,
    icon: ImageVector,
    selected: Boolean,
    tag: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val c = ShiftTheme.colors
    Column(
        modifier
            .clip(RoundedCornerShape(12.dp))
            .background(if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.08f) else c.surface)
            .border(
                if (selected) 1.5.dp else 1.dp,
                if (selected) MaterialTheme.colorScheme.primary else c.divider,
                RoundedCornerShape(12.dp),
            )
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 11.dp)
            .testTag(tag),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(32.dp).clip(RoundedCornerShape(9.dp)).background(c.surfaceVar),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    icon,
                    contentDescription = null,
                    tint = if (selected) MaterialTheme.colorScheme.primary else c.sec,
                    modifier = Modifier.size(16.dp),
                )
            }
            Spacer(Modifier.weight(1f))
            if (selected) {
                Icon(
                    ShiftIcons.CheckCircle,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(16.dp),
                )
            }
        }
        Text(title, color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
    }
}

/**
 * The sample housemate offered in step 2, styled like the mode cards (selected state,
 * checkmark). Their own take-side span is fixed (09:00 to 11:00 = 2h) — only the GIVE side
 * is driven by the slider, mirroring the real composer where the take amount comes from the
 * picked person's own shift.
 */
@Composable
private fun candidateRow() {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.08f))
            .border(1.5.dp, MaterialTheme.colorScheme.primary, RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .testTag("swap_tour_candidate_row"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.size(36.dp).clip(CircleShape).background(c.surfaceVar), contentAlignment = Alignment.Center) {
            Text("J", color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.Bold)
        }
        Column(Modifier.weight(1f)) {
            Text(SwapTour.SAMPLE_CANDIDATE_NAME, color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            Text(
                "09:00 to 11:00 · " + SwapTour.durationLabel(SwapTour.SAMPLE_CANDIDATE_BLOCK_COUNT),
                color = c.sec,
                fontSize = 12.5.sp,
            )
        }
        Icon(ShiftIcons.CheckCircle, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(16.dp))
    }
}

/**
 * Step 2 controls: the sample candidate/take row, the real (Material 3) [RangeSlider] over
 * the sample give-shift's blocks, and the live summary line recomputed by the shared
 * `SwapTour.summaryLine` (branching on the step-1 mode).
 */
@Composable
private fun amountControls(
    mode: SwapTourMode,
    from: Int,
    to: Int,
    blockCount: Int,
    onRange: (Int, Int) -> Unit,
) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        candidateRow()
        RangeSlider(
            value = from.toFloat()..to.toFloat(),
            onValueChange = { r ->
                val newFrom = r.start.toInt().coerceIn(0, blockCount - 1)
                val newTo = r.endInclusive.toInt().coerceIn(newFrom + 1, blockCount)
                onRange(newFrom, newTo)
            },
            valueRange = 0f..blockCount.toFloat(),
            steps = (blockCount - 1).coerceAtLeast(0),
            modifier = Modifier.fillMaxWidth().testTag("swap_tour_range"),
        )
        Text(
            SwapTour.summaryLine(mode = mode, giveFromBlock = from, giveToBlock = to),
            color = MaterialTheme.colorScheme.primary,
            fontSize = 14.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.testTag("swap_tour_summary"),
        )
    }
}

/**
 * A local, tour-only sample segment shape (locked / active / free), matching the real swap
 * timeline's cell treatment. Stays local (not a shared model) because the tour's sample data
 * is fixed prose, the same way [candidateRow]'s "Jordan" is hardcoded rather than sourced
 * from a real candidate.
 */
private data class TourSegment(
    val id: Int,
    val rangeLabel: String,
    val blocks: Int,
    val locked: Boolean,
)

private val TOUR_SEGMENTS =
    listOf(
        TourSegment(id = 0, rangeLabel = "16:00 to 17:00", blocks = 2, locked = true),
        TourSegment(id = 1, rangeLabel = "17:00 to 18:00", blocks = 2, locked = false),
        TourSegment(id = 2, rangeLabel = "18:00 to 20:00", blocks = 4, locked = false),
    )

/**
 * Step 3: the segmented give/take timeline — one locked zone (already given), one focused
 * free zone (the active reservation), and a further free zone a worker can tap to hand the
 * rest to someone else, live-focusing it on tap.
 */
@Composable
private fun splitStage(
    focusedSegmentId: Int,
    onSegmentFocus: (Int) -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().height(46.dp).testTag("swap_tour_split_timeline"),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        TOUR_SEGMENTS.forEach { seg ->
            segmentCell(
                seg = seg,
                active = seg.id == focusedSegmentId,
                onTap = { onSegmentFocus(seg.id) },
                modifier = Modifier.weight(seg.blocks.toFloat()),
            )
        }
    }
}

/**
 * Zone treatment: locked = surfaceVar bg + divider border + muted text + "Given"; active =
 * primary-tinted bg + primary border + primary text + "Giving"; free = surface bg + outline
 * border + muted "Tap". Identifiers deliberately match the real screen's own convention
 * (`swap_seg_locked` / `swap_seg_active` / `swap_seg_free`).
 */
@Composable
private fun segmentCell(
    seg: TourSegment,
    active: Boolean,
    onTap: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = ShiftTheme.colors
    val bg = if (seg.locked) c.surfaceVar else if (active) MaterialTheme.colorScheme.primary.copy(alpha = 0.10f) else c.surface
    val borderColor = if (active) MaterialTheme.colorScheme.primary else if (seg.locked) c.divider else c.outline
    val sub = if (seg.locked) "Given" else if (active) "Giving" else "Tap"
    val tag = if (seg.locked) "swap_seg_locked" else if (active) "swap_seg_active" else "swap_seg_free"
    var cell =
        modifier
            .fillMaxHeight()
            .clip(RoundedCornerShape(8.dp))
            .background(bg)
            .border(if (active) 1.5.dp else 1.dp, borderColor, RoundedCornerShape(8.dp))
    if (!seg.locked && !active) cell = cell.clickable(onClick = onTap)
    Column(
        // mergeDescendants: the two child Text labels (range + "Given"/"Giving"/"Tap") are
        // reachable through this cell's own testTag as one queryable text, matching how
        // clickable() already merges its own descendants (which only the FREE cell gets).
        cell.padding(horizontal = 4.dp).semantics(mergeDescendants = true) {}.testTag(tag),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            seg.rangeLabel,
            color = if (seg.locked) c.ter else c.ink,
            fontSize = 10.5.sp,
            maxLines = 1,
        )
        Text(
            sub,
            color = if (active) MaterialTheme.colorScheme.primary else c.ter,
            fontSize = 10.sp,
            fontWeight = if (active) FontWeight.Medium else FontWeight.Normal,
            maxLines = 1,
        )
    }
}

/**
 * A representative bottom-nav strip. The Swaps item is tinted success-green on step 3, so
 * the "where it goes" step points at the actual tab a swap proposal lands in.
 */
@Composable
private fun mockNav(highlightSwaps: Boolean) {
    val c = ShiftTheme.colors
    Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
        navItem("My Shifts", ShiftIcons.Calendar, c.ter)
        navItem("Open", ShiftIcons.Plus, c.ter)
        navItem("House", ShiftIcons.Building, c.ter)
        navItem("Swaps", ShiftIcons.Refresh, if (highlightSwaps) c.success.accent else c.ter)
        navItem("More", ShiftIcons.MoreHorizontal, c.ter)
    }
}

@Composable
private fun navItem(
    label: String,
    icon: ImageVector,
    tint: Color,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(16.dp))
        Text(label, color = tint, fontSize = 10.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun coachCard(
    state: SwapTourUiState,
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
        Text(step.body, color = c.sec, fontSize = 15.sp)
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
                modifier = Modifier.testTag("swap_tour_skip"),
            )
            Text("${state.stepIndex} of ${state.stepCount}", color = c.ter, fontSize = 13.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (state.canGoBack) {
                    ShiftButton(
                        text = "Back",
                        onClick = onBack,
                        variant = ButtonVariant.Outlined,
                        size = ButtonSize.Sm,
                        modifier = Modifier.testTag("swap_tour_back"),
                    )
                }
                ShiftButton(
                    text = if (state.isLastStep) "Done" else "Next",
                    onClick = onNext,
                    variant = ButtonVariant.Filled,
                    size = ButtonSize.Sm,
                    modifier = Modifier.testTag("swap_tour_next"),
                )
            }
        }
    }
}
