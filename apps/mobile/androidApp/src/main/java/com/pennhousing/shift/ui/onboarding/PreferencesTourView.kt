package com.pennhousing.shift.ui.onboarding

import android.content.Context
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
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pennhousing.shift.shared.onboarding.PreferencesTour
import com.pennhousing.shift.shared.onboarding.PreferencesTourBrush
import com.pennhousing.shift.shared.onboarding.PreferencesTourStepId
import com.pennhousing.shift.shared.viewmodel.PreferencesTourUiState
import com.pennhousing.shift.ui.kit.ButtonSize
import com.pennhousing.shift.ui.kit.ButtonVariant
import com.pennhousing.shift.ui.kit.ShiftButton
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.theme.ShiftTheme

/**
 * PreferencesTourView (Android) — the Compose port of the interactive "Preferences"
 * (availability paint) onboarding tour (see `iosApp/iosApp/PreferencesTourView.swift` for the
 * SwiftUI original). The step copy + the step-2/step-3 formatting math live in shared
 * `onboarding/PreferencesTour`; the `PreferencesTourViewModel` sequences the three steps. This
 * file is rendering only, matching `ShiftTourView.kt`'s exact shape (SharedPreferences for the
 * seen-key store, plain Compose visibility rather than iOS's spring/stagger/wiggle motion).
 */

/** Its OWN seen-key store, separate from `ShiftTourPrefs` / every other tour (mirrors iOS). */
object PreferencesTourPrefs {
    private const val PREFS = "onboarding"
    private const val KEY = "preferences_tour_seen_keys"

    fun read(context: Context): Set<String> =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getStringSet(KEY, emptySet())?.toSet() ?: emptySet()

    fun write(
        context: Context,
        seen: Set<String>,
    ) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putStringSet(KEY, HashSet(seen)).apply()
    }
}

/** Per-device flag: whether the header "?" has already shown its one-time post-tour pointer. */
object PreferencesTourPointerStore {
    private const val PREFS = "onboarding"
    private const val KEY = "preferences_tour_pointer_shown"

    fun hasShown(context: Context): Boolean = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY, false)

    fun markShown(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY, true).apply()
    }
}

/**
 * The "?" affordance in the Preferences header that replays the tour. Reports its own on-screen
 * bounds via [onPositioned] so the one-time pointer callout can point at the real button without
 * the two composables needing to know each other's layout.
 */
@Composable
fun PreferencesTourHelpButton(
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
            .testTag("preferences_tour_help"),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            ShiftIcons.QuestionMark,
            contentDescription = "Replay the preferences tour",
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(16.dp),
        )
    }
}

/**
 * The one-time "look here" pointer at the header "?", shown once right after the tour first
 * finishes so the worker learns where it went. Non-blocking (no click handling). [targetRect] is
 * the help button's root-space bounds (from [PreferencesTourHelpButton]'s [onPositioned]);
 * renders nothing until known.
 */
@Composable
fun PreferencesTourPointerCallout(
    targetRect: Rect?,
    modifier: Modifier = Modifier,
) {
    if (targetRect == null) return
    Box(modifier.fillMaxSize().testTag("preferences_tour_pointer")) {
        Column(
            Modifier
                .padding(top = with(LocalDensity.current) { (targetRect.bottom + 10f).toDp() })
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

/** Brush styling (color + icon + text), mirroring `brushStyle` in `PreferencesScreen.kt` exactly
 * so the tour never lies about the real screen's information architecture. */
private data class TourBrushStyle(
    val label: String,
    val bg: Color,
    val fg: Color,
    val accent: Color,
    val icon: ImageVector,
)

@Composable
private fun tourBrushStyle(brush: PreferencesTourBrush): TourBrushStyle {
    val c = ShiftTheme.colors
    return when (brush) {
        PreferencesTourBrush.AVAILABLE -> TourBrushStyle("Available", c.surfaceVar, c.sec, c.sec, ShiftIcons.Check)
        PreferencesTourBrush.PREFERRED ->
            TourBrushStyle(
                "Preferred",
                MaterialTheme.colorScheme.primaryContainer,
                c.onBlueContainer,
                c.pickupDot,
                ShiftIcons.Heart,
            )
        PreferencesTourBrush.CANNOT -> TourBrushStyle("Cannot", c.danger.tint, c.danger.accent, c.danger.accent, ShiftIcons.Ban)
    }
}

private fun PreferencesTourBrush.tag(): String =
    when (this) {
        PreferencesTourBrush.AVAILABLE -> "preferences_tour_brush_available"
        PreferencesTourBrush.PREFERRED -> "preferences_tour_brush_preferred"
        PreferencesTourBrush.CANNOT -> "preferences_tour_brush_cannot"
    }

/**
 * The tour overlay — the sample brush selector (step 1), the sample press-and-drag paint canvas
 * (step 2), and the sample target-hours stepper (step 3), paired with a coach card carrying the
 * step copy and Skip/Back/Next controls.
 */
@Composable
fun PreferencesTourOverlay(
    state: PreferencesTourUiState,
    onNext: () -> Unit,
    onBack: () -> Unit,
    onSkip: () -> Unit,
    onDismissOutside: () -> Unit = onSkip,
) {
    val step = state.step ?: return
    val c = ShiftTheme.colors
    val scrim = if (c.isDark) Color(0xC4000000) else Color(0x99101622)
    // Tapping the scrim dismisses the tour, except on the PAINT step where the sample
    // press-and-drag canvas needs the full card area to itself -- a stray tap mid-drag must
    // not lose the worker's place.
    val dismissible = step.id != PreferencesTourStepId.PAINT

    // Step 1's live brush pick, carried into step 2's sample paint (mirrors
    // PreferencesTour.DEFAULT_BRUSH -> PREFERRED). Fresh every time this composable mounts (the
    // overlay is only composed while the tour is active, matching iOS's per-appearance @State).
    var selectedBrush by remember { mutableStateOf(PreferencesTour.DEFAULT_BRUSH) }

    // Step 2's sample paint state: block index -> the brush painted there. An unpainted block
    // reads as "available" (no fill), matching the real screen's default.
    var paintedBlocks by remember { mutableStateOf<Map<Int, PreferencesTourBrush>>(emptyMap()) }
    var liveDragSpan by remember { mutableStateOf<IntRange?>(null) }

    // Step 3's sample target-hours state.
    var targetHours by remember { mutableStateOf(PreferencesTour.SAMPLE_TARGET_HOURS) }
    var optedOut by remember { mutableStateOf(false) }

    Box(
        Modifier
            .fillMaxSize()
            .background(scrim)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = { if (dismissible) onDismissOutside() },
            )
            .testTag("preferences_tour"),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier.widthIn(max = 460.dp).fillMaxWidth().padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            stage(
                stepId = step.id,
                selectedBrush = selectedBrush,
                onSelectBrush = { selectedBrush = it },
                paintedBlocks = paintedBlocks,
                liveDragSpan = liveDragSpan,
                onPaintedBlocksChange = { paintedBlocks = it },
                onLiveDragSpanChange = { liveDragSpan = it },
                targetHours = targetHours,
                optedOut = optedOut,
                onTargetHoursChange = { targetHours = it },
                onOptedOutChange = { optedOut = it },
            )
            coachCard(state, onNext = onNext, onBack = onBack, onSkip = onSkip)
        }
    }
}

@Composable
private fun stage(
    stepId: PreferencesTourStepId,
    selectedBrush: PreferencesTourBrush,
    onSelectBrush: (PreferencesTourBrush) -> Unit,
    paintedBlocks: Map<Int, PreferencesTourBrush>,
    liveDragSpan: IntRange?,
    onPaintedBlocksChange: (Map<Int, PreferencesTourBrush>) -> Unit,
    onLiveDragSpanChange: (IntRange?) -> Unit,
    targetHours: Int,
    optedOut: Boolean,
    onTargetHoursChange: (Int) -> Unit,
    onOptedOutChange: (Boolean) -> Unit,
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
            PreferencesTourStepId.MODE -> brushStage(selectedBrush, onSelectBrush)
            PreferencesTourStepId.PAINT ->
                paintStage(selectedBrush, paintedBlocks, liveDragSpan, onPaintedBlocksChange, onLiveDragSpanChange)
            PreferencesTourStepId.TARGET -> targetStage(targetHours, optedOut, onTargetHoursChange, onOptedOutChange)
        }
    }
}

// ── Step 1: the real brush selector, live and tappable ──────────────────────────

@Composable
private fun brushStage(
    selectedBrush: PreferencesTourBrush,
    onSelectBrush: (PreferencesTourBrush) -> Unit,
) {
    val c = ShiftTheme.colors
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        PreferencesTour.BRUSHES.forEach { brush ->
            val style = tourBrushStyle(brush)
            val on = brush == selectedBrush
            Column(
                Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(11.dp))
                    .background(if (on) style.bg else c.surface)
                    .border(1.5.dp, if (on) style.accent else c.divider, RoundedCornerShape(11.dp))
                    .clickable { onSelectBrush(brush) }
                    .testTag(brush.tag())
                    .padding(vertical = 9.dp, horizontal = 4.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Icon(style.icon, contentDescription = null, tint = if (on) style.fg else c.ter, modifier = Modifier.size(19.dp))
                Text(style.label, color = if (on) style.fg else c.sec, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

// ── Step 2: the real press-and-drag paint canvas, sample-scale ──────────────────

private val TOUR_BLOCK_HEIGHT = 30.dp
private val TOUR_GUTTER_WIDTH = 54.dp

@Composable
private fun paintStage(
    selectedBrush: PreferencesTourBrush,
    paintedBlocks: Map<Int, PreferencesTourBrush>,
    liveDragSpan: IntRange?,
    onPaintedBlocksChange: (Map<Int, PreferencesTourBrush>) -> Unit,
    onLiveDragSpanChange: (IntRange?) -> Unit,
) {
    val blockCount = PreferencesTour.SAMPLE_BLOCK_COUNT

    fun liveOrLastFrom(): Int = liveDragSpan?.first ?: (paintedBlocks.keys.minOrNull() ?: 0)

    fun liveOrLastTo(): Int =
        liveDragSpan?.let { it.last + 1 } ?: (paintedBlocks.keys.maxOrNull()?.plus(1) ?: 0)

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            paintGutter(blockCount)
            paintTimeline(
                blockCount = blockCount,
                selectedBrush = selectedBrush,
                paintedBlocks = paintedBlocks,
                liveDragSpan = liveDragSpan,
                onPaintedBlocksChange = onPaintedBlocksChange,
                onLiveDragSpanChange = onLiveDragSpanChange,
            )
        }
        Text(
            PreferencesTour.paintSummaryLine(
                paintedCount = paintedBlocks.size,
                fromBlock = liveOrLastFrom(),
                toBlock = liveOrLastTo(),
            ),
            color = MaterialTheme.colorScheme.primary,
            fontSize = 14.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.testTag("preferences_tour_paint_summary"),
        )
    }
}

/** The left time gutter, matching the real screen: the scroll handle, never a paint target. Hour
 * boundaries land at even block indices (blocks are 30 minutes; the sample starts on the hour),
 * so a label shows every 2 blocks. */
@Composable
private fun paintGutter(blockCount: Int) {
    val c = ShiftTheme.colors
    Box(Modifier.width(TOUR_GUTTER_WIDTH).height(TOUR_BLOCK_HEIGHT * blockCount).padding(end = 8.dp)) {
        for (boundary in 0..blockCount) {
            if (boundary % 2 == 0) {
                Text(
                    PreferencesTour.timeLabel(boundary),
                    modifier =
                        Modifier
                            .align(Alignment.TopEnd)
                            .offset(y = (TOUR_BLOCK_HEIGHT * boundary - 6.dp).coerceAtLeast(0.dp)),
                    color = c.sec,
                    fontSize = 10.5.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
    }
}

/**
 * The pure paint canvas: bare colored 30-min segments plus a live drag-span outline, driven by
 * raw touch-slot tracking (`awaitEachGesture`) rather than a plain nested drag gesture, so
 * pressing and dragging paints immediately and can't be pre-empted by an enclosing scrollable.
 * Mirrors `beginPaint`/`updatePaint`/`applyPaint` in `PreferencesTourView.swift` exactly: dragging
 * over an already-painted-with-the-selected-brush range ERASES it.
 *
 * `Modifier.semantics(mergeDescendants = false)` makes this Box ONE queryable/draggable element
 * instead of a plain layout container whose testTag would otherwise merge with (and become
 * ambiguous with) its per-block child cells — the Compose analogue of iOS's
 * `.accessibilityElement(children: .ignore)` fix noted in the SwiftUI original.
 */
@Composable
private fun paintTimeline(
    blockCount: Int,
    selectedBrush: PreferencesTourBrush,
    paintedBlocks: Map<Int, PreferencesTourBrush>,
    liveDragSpan: IntRange?,
    onPaintedBlocksChange: (Map<Int, PreferencesTourBrush>) -> Unit,
    onLiveDragSpanChange: (IntRange?) -> Unit,
) {
    val c = ShiftTheme.colors
    val totalHeight = TOUR_BLOCK_HEIGHT * blockCount
    val blockPx = with(LocalDensity.current) { TOUR_BLOCK_HEIGHT.toPx() }
    fun idxAt(y: Float): Int = (y / blockPx).toInt().coerceIn(0, blockCount - 1)

    // Always-fresh state so a NEW drag reads the CURRENT paint state (the pointerInput is keyed
    // on Unit, so it never restarts mid-drag and abort the sweep).
    val paintedNow by rememberUpdatedState(paintedBlocks)
    val brushNow by rememberUpdatedState(selectedBrush)

    fun applyPaint(
        span: IntRange,
        erase: Boolean,
    ) {
        val next = paintedNow.toMutableMap()
        for (i in span) {
            if (i < 0 || i >= blockCount) continue
            if (erase) next.remove(i) else next[i] = brushNow
        }
        onPaintedBlocksChange(next)
    }

    Box(
        Modifier
            .fillMaxWidth()
            .height(totalHeight)
            .semantics(mergeDescendants = false) {}
            .testTag("preferences_tour_paint_grid")
            .pointerInput(Unit) {
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    val startIdx = idxAt(down.position.y)
                    val startErase = paintedNow[startIdx] == brushNow
                    onLiveDragSpanChange(startIdx..startIdx)
                    applyPaint(startIdx..startIdx, startErase)
                    while (true) {
                        val event = awaitPointerEvent()
                        val change = event.changes.firstOrNull { it.id == down.id } ?: break
                        if (!change.pressed) {
                            onLiveDragSpanChange(null)
                            break
                        }
                        change.consume()
                        val cur = idxAt(change.position.y)
                        val span = minOf(startIdx, cur)..maxOf(startIdx, cur)
                        onLiveDragSpanChange(span)
                        applyPaint(span, startErase)
                    }
                }
            },
    ) {
        Column(Modifier.fillMaxSize()) {
            for (i in 0 until blockCount) {
                val brush = paintedBlocks[i]
                val style = brush?.let { tourBrushStyle(it) }
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(TOUR_BLOCK_HEIGHT)
                        .background(style?.bg ?: Color.Transparent)
                        .border(1.dp, c.divider.copy(alpha = if (i % 2 == 0) 1f else 0.4f), RoundedCornerShape(0.dp))
                        .testTag("preferences_tour_paint_cell"),
                )
            }
        }
        liveDragSpan?.let { span ->
            val erasing = paintedBlocks[span.first] == selectedBrush
            val hl = if (erasing) c.danger.accent else tourBrushStyle(selectedBrush).accent
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(TOUR_BLOCK_HEIGHT * (span.last - span.first + 1))
                    .offset(y = TOUR_BLOCK_HEIGHT * span.first)
                    .background(hl.copy(alpha = 0.16f), RoundedCornerShape(5.dp))
                    .border(2.dp, hl, RoundedCornerShape(5.dp)),
            )
        }
    }
}

// ── Step 3: the real target-hours stepper + no-hours toggle, live and tappable ──

@Composable
private fun targetStage(
    targetHours: Int,
    optedOut: Boolean,
    onTargetHoursChange: (Int) -> Unit,
    onOptedOutChange: (Boolean) -> Unit,
) {
    val c = ShiftTheme.colors
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Target weekly hours", color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                Text("Soft cap ${PreferencesTour.SAMPLE_CAP_HOURS}h this period", color = c.ter, fontSize = 12.sp)
            }
            Row(
                Modifier.padding(start = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                targetStepButton(
                    icon = ShiftIcons.Minus,
                    enabled = !optedOut,
                    testTag = "preferences_tour_target_decrement",
                ) {
                    onTargetHoursChange(
                        PreferencesTour.clampTarget(targetHours - PreferencesTour.TARGET_STEP, PreferencesTour.SAMPLE_CAP_HOURS),
                    )
                }
                Text(
                    PreferencesTour.targetLabel(if (optedOut) 0 else targetHours),
                    color = c.ink,
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.width(52.dp).testTag("preferences_tour_target_value"),
                )
                targetStepButton(
                    icon = ShiftIcons.Plus,
                    enabled = !optedOut,
                    testTag = "preferences_tour_target_increment",
                ) {
                    onTargetHoursChange(
                        PreferencesTour.clampTarget(targetHours + PreferencesTour.TARGET_STEP, PreferencesTour.SAMPLE_CAP_HOURS),
                    )
                }
            }
        }
        Box(
            Modifier
                .fillMaxWidth()
                .height(6.dp)
                .clip(RoundedCornerShape(50))
                .background(c.surfaceVar),
        ) {
            val fraction =
                PreferencesTour.targetFraction(
                    if (optedOut) 0 else targetHours,
                    PreferencesTour.SAMPLE_CAP_HOURS,
                )
            Box(
                Modifier
                    .fillMaxHeight()
                    .fillMaxWidth(fraction.toFloat())
                    .clip(RoundedCornerShape(50))
                    .background(MaterialTheme.colorScheme.primary),
            )
        }
        Row(
            Modifier
                .clickable { onOptedOutChange(!optedOut) }
                .testTag("preferences_tour_no_hours_toggle"),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Box(
                Modifier
                    .size(22.dp)
                    .clip(RoundedCornerShape(7.dp))
                    .background(if (optedOut) MaterialTheme.colorScheme.primary else Color.Transparent)
                    .border(1.5.dp, if (optedOut) MaterialTheme.colorScheme.primary else c.outline, RoundedCornerShape(7.dp)),
                contentAlignment = Alignment.Center,
            ) {
                if (optedOut) {
                    Icon(ShiftIcons.Check, contentDescription = null, tint = Color.White, modifier = Modifier.size(12.dp))
                }
            }
            Text("I have no hours this week", color = c.sec, fontSize = 13.5.sp, fontWeight = FontWeight.Medium)
        }
    }
}

@Composable
private fun targetStepButton(
    icon: ImageVector,
    enabled: Boolean,
    testTag: String,
    onClick: () -> Unit,
) {
    val c = ShiftTheme.colors
    Box(
        Modifier
            .size(36.dp)
            .clip(CircleShape)
            .background(c.surface)
            .border(1.dp, c.divider, CircleShape)
            .clickable(enabled = enabled, onClick = onClick)
            .testTag(testTag),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = if (enabled) c.ink else c.ter,
            modifier = Modifier.size(18.dp),
        )
    }
}

// ── Coach card (kicker / title / body / controls) ────────────────────────────────

@Composable
private fun coachCard(
    state: PreferencesTourUiState,
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
                modifier = Modifier.testTag("preferences_tour_skip"),
            )
            Text("${state.stepIndex} of ${state.stepCount}", color = c.ter, fontSize = 13.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (state.canGoBack) {
                    ShiftButton(
                        text = "Back",
                        onClick = onBack,
                        variant = ButtonVariant.Outlined,
                        size = ButtonSize.Sm,
                        modifier = Modifier.testTag("preferences_tour_back"),
                    )
                }
                ShiftButton(
                    text = if (state.isLastStep) "Done" else "Next",
                    onClick = onNext,
                    variant = ButtonVariant.Filled,
                    size = ButtonSize.Sm,
                    modifier = Modifier.testTag("preferences_tour_next"),
                )
            }
        }
    }
}
