package com.pennhousing.shift.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pennhousing.shift.shared.preferences.PrefBlockCell
import com.pennhousing.shift.shared.preferences.PrefBlockRun
import com.pennhousing.shift.shared.preferences.PrefBrush
import com.pennhousing.shift.shared.preferences.PrefDayView
import com.pennhousing.shift.shared.preferences.PrefHourMark
import com.pennhousing.shift.shared.preferences.PrefWeekCell
import com.pennhousing.shift.shared.preferences.PrefWeekStrip
import com.pennhousing.shift.shared.preferences.PREF_BRUSH_ORDER
import com.pennhousing.shift.shared.preferences.PreferenceBanner
import com.pennhousing.shift.shared.preferences.PrefBannerTone
import com.pennhousing.shift.shared.preferences.TargetMeter
import com.pennhousing.shift.shared.viewmodel.PreferencesViewModel
import com.pennhousing.shift.ui.kit.BannerTone
import com.pennhousing.shift.ui.kit.ButtonSize
import com.pennhousing.shift.ui.kit.ButtonVariant
import com.pennhousing.shift.ui.kit.EmptyState
import com.pennhousing.shift.ui.kit.ShiftBanner
import com.pennhousing.shift.ui.kit.ShiftBottomSheet
import com.pennhousing.shift.ui.kit.ShiftButton
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.theme.ShiftTheme

/**
 * Preference submission (the tri-state paint timeline + target weekly hours) — Compose UI
 * over the shared [PreferencesViewModel]. The canonical kit: the context eyebrow, the
 * deadline/unsaved banner, a Mon-Sun strip, the target-hours stepper card, the
 * Available/Preferred/Cannot brush selector, the day TIMELINE (hours in a left gutter,
 * bare colored segments, one label per painted run — long-press-drag to paint a range,
 * tap for one block), and a Submit/Discard bar that appears only when there are unsaved
 * edits. Editable until the deadline; read-only only once it has passed. Selector ids
 * match `apps/mobile/maestro/README.md`.
 */
@Composable
fun PreferencesTabContent(
    vm: PreferencesViewModel,
    onSubmit: () -> Unit = vm::submit,
    onDiscard: () -> Unit = vm::revert,
) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    val c = ShiftTheme.colors

    Column(Modifier.fillMaxSize().background(c.bg).testTag("preferences_screen")) {
        Text(
            state.contextLabel,
            modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 6.dp),
            color = MaterialTheme.colorScheme.primary,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = 0.05.em,
        )
        Box(Modifier.padding(horizontal = 16.dp, vertical = 2.dp)) {
            PreferenceBannerView(state.banner)
        }
        PrefWeekStripView(state.weekStrip, vm::selectDay)

        Column(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            TargetCard(
                meter = state.targetMeter,
                optedOut = state.optedOut,
                enabled = !state.readOnly,
                onIncrement = vm::incrementTarget,
                onDecrement = vm::decrementTarget,
                onToggleNoHours = vm::toggleOptedOut,
            )

            if (state.optedOut) {
                EmptyState(
                    title = "No hours marked",
                    icon = ShiftIcons.Ban,
                    body = "You won't be scheduled next week. Untick \"no hours\" to set availability.",
                )
            } else {
                if (!state.readOnly) {
                    Text(
                        "Pick a mode",
                        color = c.ter,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                BrushSelector(state.brush, enabled = !state.readOnly, onSelect = vm::setBrush)
                if (!state.readOnly) {
                    PaintHelpCard()
                }
                Text(state.day.title, color = c.ink, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                PrefTimeline(
                    day = state.day,
                    enabled = !state.readOnly,
                    activeBrush = state.brush,
                    onPaint = vm::paint,
                    onBeginPaint = vm::beginPaintDrag,
                    onPaintRange = vm::paintRange,
                    onEndPaint = vm::endPaintDrag,
                )
                Box(Modifier.height(8.dp))
            }
        }

        if (state.showSubmit || state.showDiscard) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(c.surface)
                    .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 14.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (state.showDiscard) {
                    ShiftButton(
                        text = "Discard",
                        onClick = onDiscard,
                        modifier = Modifier.testTag("pref_discard_button"),
                        variant = ButtonVariant.Outlined,
                        size = ButtonSize.Lg,
                    )
                }
                if (state.showSubmit) {
                    ShiftButton(
                        text = state.submitLabel,
                        onClick = onSubmit,
                        modifier = Modifier.weight(1f).testTag("submit_preferences_button"),
                        size = ButtonSize.Lg,
                        fullWidth = true,
                    )
                }
            }
        }
    }
}

/**
 * The unsaved-changes guard shown when the worker leaves the Preferences tab with edits
 * they haven't submitted (BEH §4 save-safety). Submit & leave persists then navigates;
 * Discard & leave reverts then navigates; Keep editing (or a scrim tap) cancels the move.
 * Hosted by [ShiftsApp]; carries the `pref_unsaved_sheet` selector.
 */
@Composable
fun PrefUnsavedChangesSheet(
    onSubmitAndLeave: () -> Unit,
    onDiscardAndLeave: () -> Unit,
    onKeepEditing: () -> Unit,
) {
    val c = ShiftTheme.colors
    ShiftBottomSheet(
        onDismiss = onKeepEditing,
        modifier = Modifier.testTag("pref_unsaved_sheet"),
        title = "Unsaved preferences",
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(
                "You've changed your preferences but haven't saved them. Save them before leaving, or discard them.",
                color = c.sec,
                fontSize = 15.sp,
                lineHeight = 21.sp,
            )
            ShiftButton(
                text = "Save & leave",
                onClick = onSubmitAndLeave,
                modifier = Modifier.fillMaxWidth().testTag("pref_unsaved_submit"),
                size = ButtonSize.Lg,
                fullWidth = true,
            )
            ShiftButton(
                text = "Discard & leave",
                onClick = onDiscardAndLeave,
                modifier = Modifier.fillMaxWidth().testTag("pref_unsaved_discard"),
                variant = ButtonVariant.Outlined,
                size = ButtonSize.Lg,
                fullWidth = true,
            )
            ShiftButton(
                text = "Keep editing",
                onClick = onKeepEditing,
                modifier = Modifier.fillMaxWidth(),
                variant = ButtonVariant.Text,
                size = ButtonSize.Lg,
                fullWidth = true,
            )
        }
    }
}

@Composable
private fun PreferenceBannerView(banner: PreferenceBanner) {
    ShiftBanner(
        title = banner.title,
        body = banner.body,
        tone = if (banner.tone == PrefBannerTone.SUCCESS) BannerTone.Success else BannerTone.Info,
    )
}

/** Mon-Sun strip: weekday letter, a date pill (selected fill), and a "painted" dot. */
@Composable
private fun PrefWeekStripView(
    strip: PrefWeekStrip,
    onSelect: (Int) -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().testTag("pref_week_strip").padding(horizontal = 12.dp, vertical = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        strip.cells.forEach { cell ->
            PrefWeekCellView(cell, Modifier.weight(1f)) { onSelect(cell.dayIndex) }
        }
    }
}

@Composable
private fun PrefWeekCellView(
    cell: PrefWeekCell,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    val c = ShiftTheme.colors
    val blue = MaterialTheme.colorScheme.primary
    // Weekday-only pill (preferences are a weekly template, so no calendar date is shown).
    Column(
        modifier
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .testTag("pref_day_cell")
            .padding(vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(if (cell.selected) blue else Color.Transparent)
                .padding(vertical = 11.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                cell.dayLabel,
                color = if (cell.selected) Color.White else c.ink,
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
        Box(Modifier.size(6.dp).clip(RoundedCornerShape(50)).background(if (cell.painted) blue else Color.Transparent))
    }
}

/** The "Target weekly hours" stepper card + soft-cap progress bar + "no hours" tick. */
@Composable
private fun TargetCard(
    meter: TargetMeter,
    optedOut: Boolean,
    enabled: Boolean,
    onIncrement: () -> Unit,
    onDecrement: () -> Unit,
    onToggleNoHours: () -> Unit,
) {
    val c = ShiftTheme.colors
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(c.surface)
            .border(1.dp, c.divider, RoundedCornerShape(14.dp))
            .padding(horizontal = 14.dp, vertical = 12.dp)
            .testTag("pref_target_stepper"),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column(Modifier.weight(1f)) {
                Text("Target weekly hours", color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                Text("Soft cap ${meter.capLabel} this period", color = c.ter, fontSize = 12.sp)
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.alpha(if (optedOut) 0.35f else 1f),
            ) {
                StepButton(ShiftIcons.Minus, enabled = enabled && !optedOut, tag = "pref_target_decrement", onClick = onDecrement)
                Text(
                    meter.label,
                    style = ShiftTheme.type.monoTimeHero,
                    color = c.ink,
                    modifier = Modifier.width(52.dp),
                    textAlign = TextAlign.Center,
                )
                StepButton(ShiftIcons.Plus, enabled = enabled && !optedOut, tag = "pref_target_increment", onClick = onIncrement)
            }
        }
        Box(Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(50)).background(c.surfaceVar)) {
            Box(
                Modifier
                    .fillMaxWidth(meter.fraction.toFloat())
                    .height(6.dp)
                    .clip(RoundedCornerShape(50))
                    .background(MaterialTheme.colorScheme.primary),
            )
        }
        Row(
            Modifier
                .clickable(enabled = enabled, onClick = onToggleNoHours)
                .testTag("pref_no_hours_toggle"),
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
                if (optedOut) Icon(ShiftIcons.Check, contentDescription = null, tint = Color.White, modifier = Modifier.size(14.dp))
            }
            Text("I have no hours this week", color = c.sec, fontSize = 13.5.sp, fontWeight = FontWeight.Medium)
        }
    }
}

@Composable
private fun StepButton(
    icon: ImageVector,
    enabled: Boolean,
    tag: String,
    onClick: () -> Unit,
) {
    val c = ShiftTheme.colors
    Box(
        Modifier
            .size(36.dp)
            .clip(RoundedCornerShape(50))
            .background(c.surface)
            .border(1.dp, c.divider, RoundedCornerShape(50))
            .clickable(enabled = enabled, onClick = onClick)
            .alpha(if (enabled) 1f else 0.4f)
            .testTag(tag),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = c.ink, modifier = Modifier.size(18.dp))
    }
}

/** The Available · Preferred · Cannot brush selector (the load-bearing color+icon+text). */
@Composable
private fun BrushSelector(
    selected: PrefBrush,
    enabled: Boolean,
    onSelect: (PrefBrush) -> Unit,
) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        PREF_BRUSH_ORDER.forEach { brush ->
            BrushChip(brush, on = brush == selected, enabled = enabled, modifier = Modifier.weight(1f)) { onSelect(brush) }
        }
    }
}

@Composable
private fun BrushChip(
    brush: PrefBrush,
    on: Boolean,
    enabled: Boolean,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    val c = ShiftTheme.colors
    val style = brushStyle(brush)
    val borderColor = if (on) style.accent else c.divider
    val bg = if (on) style.bg else c.surface
    Column(
        modifier
            .clip(RoundedCornerShape(11.dp))
            .background(bg)
            .border(1.5.dp, borderColor, RoundedCornerShape(11.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .testTag(brush.selectorTag())
            .padding(vertical = 9.dp, horizontal = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(style.icon, contentDescription = null, tint = if (on) style.fg else c.ter, modifier = Modifier.size(19.dp))
        Text(style.label, color = if (on) style.fg else c.sec, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold)
    }
}

/**
 * A compact rounded hint that teaches the split-gesture model: the left time column scrolls the
 * page, and pressing then dragging across the shifts picks or drops hours.
 */
@Composable
private fun PaintHelpCard() {
    val c = ShiftTheme.colors
    val blue = MaterialTheme.colorScheme.primary
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(MaterialTheme.colorScheme.primaryContainer)
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .testTag("pref_paint_help"),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(ShiftIcons.Info, contentDescription = null, tint = blue, modifier = Modifier.size(16.dp))
        Text(
            "Scroll the page using the time column on the left. On the shifts, press and drag to pick or drop hours.",
            color = c.sec,
            fontSize = 12.5.sp,
            lineHeight = 17.sp,
            modifier = Modifier.weight(1f),
        )
    }
}

// ── Day timeline (the drag-paint picker) ─────────────────────────────────────────

// 1.5x the original 26.dp — real thumbs on real phones need a bigger target than the
// emulator suggested; the emulator's finer pointer made 26.dp feel fine but it is too tight
// to reliably land single 30-min blocks by touch.
private val PREF_BLOCK_HEIGHT = 39.dp
// The time gutter doubles as the page scroll handle: the shift grid is a pure paint canvas that
// consumes its drags (so it never scrolls), so the page is scrolled by dragging the gutter (or any
// other non-grid area) instead.
private val PREF_GUTTER_WIDTH = 46.dp

/**
 * The selected day's vertical timeline: hours in a left gutter (on the dividing lines),
 * bare colored 30-min segments (no per-cell text), and ONE label pill per painted run.
 * A plain swipe SCROLLS the page; holding a block still for [PAINT_LONG_PRESS_MS] hands off
 * to paint mode (a haptic tick fires at the handoff), after which dragging paints a contiguous
 * range. While dragging, the affected span is outlined and tinted LIVE: accent blue when the
 * drag is adding the active brush, red when it is erasing (dragging back over blocks already
 * painted in that same mode). A single tap toggles one block. The add-vs-erase operation is
 * decided by the block the drag starts on (see [PreferencesViewModel.beginPaintDrag]).
 * [enabled] is false once the deadline has passed.
 */
@Composable
private fun PrefTimeline(
    day: PrefDayView,
    enabled: Boolean,
    activeBrush: PrefBrush,
    onPaint: (String) -> Unit,
    onBeginPaint: (String) -> Unit,
    onPaintRange: (String, String) -> Unit,
    onEndPaint: () -> Unit,
) {
    val cells = day.cells
    if (cells.isEmpty()) return
    val total = PREF_BLOCK_HEIGHT * cells.size
    val blockPx = with(LocalDensity.current) { PREF_BLOCK_HEIGHT.toPx() }
    fun idxAt(y: Float): Int = (y / blockPx).toInt().coerceIn(0, cells.size - 1)

    val c = ShiftTheme.colors
    val haptics = LocalHapticFeedback.current
    val addColor = MaterialTheme.colorScheme.primary
    val eraseColor = c.danger.accent
    // Always-fresh cells + brush so a NEW drag reads the CURRENT paint state (the pointerInput
    // is keyed on the day only, so it never restarts mid-drag and abort the sweep).
    val cellsNow by rememberUpdatedState(cells)
    val brushNow by rememberUpdatedState(activeBrush)
    // The live drag preview: the affected block span + whether this sweep erases (red) or adds (blue).
    var dragSpan by remember { mutableStateOf<IntRange?>(null) }
    var dragErase by remember { mutableStateOf(false) }

    Row(Modifier.fillMaxWidth().height(total)) {
        PrefGutter(day.hourMarks, total)
        Box(
            Modifier
                .weight(1f)
                .fillMaxHeight()
                .testTag("pref_block_grid")
                .then(
                    if (enabled) {
                        // The grid is a pure paint canvas: every drag paints (and is CONSUMED, so the
                        // parent verticalScroll never scrolls from a touch on the grid) and a tap toggles
                        // one block. The page is scrolled by dragging the time gutter (or any non-grid
                        // area) instead, which is left unconsumed. This removes the scroll-vs-paint
                        // conflict entirely rather than trying to arbitrate it.
                        Modifier.pointerInput(day.dayIndex) {
                            val slop = viewConfiguration.touchSlop
                            awaitEachGesture {
                                val down = awaitFirstDown(requireUnconsumed = false)
                                val startIdx = idxAt(down.position.y)
                                val startId = cellsNow[startIdx].blockId
                                var dragging = false
                                while (true) {
                                    val event = awaitPointerEvent()
                                    val change = event.changes.firstOrNull { it.id == down.id } ?: break
                                    if (!change.pressed) {
                                        if (!dragging) {
                                            onPaint(startId) // tap toggles a single block
                                        } else {
                                            onEndPaint()
                                        }
                                        dragSpan = null
                                        break
                                    }
                                    if (!dragging && (change.position - down.position).getDistance() > slop) {
                                        // A drag has started: engage paint mode with a haptic tick and the
                                        // live span highlight (blue add / red erase).
                                        dragging = true
                                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                        dragErase = cellsNow[startIdx].brush == brushNow
                                        dragSpan = startIdx..startIdx
                                        onBeginPaint(startId)
                                    }
                                    if (dragging) {
                                        change.consume() // keep the parent scroll from grabbing the grid
                                        val cur = idxAt(change.position.y)
                                        dragSpan = minOf(startIdx, cur)..maxOf(startIdx, cur)
                                        onPaintRange(startId, cellsNow[cur].blockId)
                                    }
                                }
                            }
                        }
                    } else {
                        Modifier
                    },
                ),
        ) {
            Column(Modifier.fillMaxSize()) { cells.forEach { PrefSegment(it) } }
            day.runs.forEach { PrefRunPill(it) }
            dragSpan?.let { span ->
                val hl = if (dragErase) eraseColor else addColor
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(PREF_BLOCK_HEIGHT * (span.last - span.first + 1))
                        .offset(y = PREF_BLOCK_HEIGHT * span.first)
                        .background(hl.copy(alpha = 0.16f), RoundedCornerShape(5.dp))
                        .border(2.dp, hl, RoundedCornerShape(5.dp)),
                )
            }
        }
    }
}

/** The left hour gutter — each label sits on its boundary line (so a fill below it is that hour). */
@Composable
private fun PrefGutter(
    marks: List<PrefHourMark>,
    totalHeight: Dp,
) {
    val c = ShiftTheme.colors
    Box(Modifier.width(PREF_GUTTER_WIDTH).height(totalHeight)) {
        marks.forEach { mark ->
            Text(
                mark.label,
                modifier =
                    Modifier
                        .align(Alignment.TopEnd)
                        .offset(y = (PREF_BLOCK_HEIGHT * mark.boundaryIndex - 8.dp).coerceAtLeast(0.dp))
                        .padding(end = 8.dp),
                color = c.ter,
                fontSize = 12.5.sp,
                fontWeight = FontWeight.Medium,
            )
        }
    }
}

/** One 30-min segment: a bare brush fill with a hour/half-hour top divider + the left axis. */
@Composable
private fun PrefSegment(cell: PrefBlockCell) {
    val c = ShiftTheme.colors
    val style = brushStyle(cell.brush)
    val fill = if (cell.brush == PrefBrush.AVAILABLE) Color.Transparent else style.bg
    val divider = c.divider
    Box(
        Modifier
            .fillMaxWidth()
            .height(PREF_BLOCK_HEIGHT)
            .background(fill)
            .drawBehind {
                drawLine(
                    if (cell.isHourStart) divider else divider.copy(alpha = 0.4f),
                    Offset(0f, 0f),
                    Offset(size.width, 0f),
                    1.dp.toPx(),
                )
                drawLine(divider, Offset(0f, 0f), Offset(0f, size.height), 1.dp.toPx())
            }
            .testTag("pref_block_cell"),
    )
}

/** The single span label centered over a painted run (e.g. "8:00 AM - 12:00 PM"). */
@Composable
private fun BoxScope.PrefRunPill(run: PrefBlockRun) {
    val c = ShiftTheme.colors
    val style = brushStyle(run.brush)
    Box(
        Modifier
            .fillMaxWidth()
            .height(PREF_BLOCK_HEIGHT * run.blockCount)
            .offset(y = PREF_BLOCK_HEIGHT * run.startBlockIndex),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            Modifier
                .clip(RoundedCornerShape(50))
                .background(c.surface)
                .border(1.dp, style.accent.copy(alpha = 0.45f), RoundedCornerShape(50))
                .padding(horizontal = 9.dp, vertical = 3.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            Icon(style.icon, contentDescription = null, tint = style.accent, modifier = Modifier.size(13.dp))
            Text(run.label, color = style.fg, fontSize = 13.sp, fontWeight = FontWeight.Medium)
        }
    }
}

// ── Brush styling (color + icon + text — never color alone) ──────────────────────

private data class BrushStyle(
    val label: String,
    val bg: Color,
    val fg: Color,
    val accent: Color,
    val icon: ImageVector,
)

@Composable
private fun brushStyle(brush: PrefBrush): BrushStyle {
    val c = ShiftTheme.colors
    return when (brush) {
        PrefBrush.AVAILABLE -> BrushStyle("Available", c.surfaceVar, c.sec, c.sec, ShiftIcons.Check)
        PrefBrush.PREFERRED ->
            BrushStyle("Preferred", MaterialTheme.colorScheme.primaryContainer, c.onBlueContainer, c.pickupDot, ShiftIcons.Heart)
        PrefBrush.CANNOT -> BrushStyle("Cannot", c.danger.tint, c.danger.accent, c.danger.accent, ShiftIcons.Ban)
    }
}

private fun PrefBrush.selectorTag(): String =
    when (this) {
        PrefBrush.AVAILABLE -> "pref_brush_available"
        PrefBrush.PREFERRED -> "pref_brush_preferred"
        PrefBrush.CANNOT -> "pref_brush_cannot"
    }
