package com.pennhousing.shift.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.scrollBy
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
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import kotlinx.coroutines.isActive
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.atStartOfDayIn
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Instant
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
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
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
 * bare colored segments, one label per painted run — drag the grid to paint a range, tap
 * for one block, and drag the left time gutter to SCROLL; see [PrefTimeline]), and a
 * Submit/Discard bar that appears only when there are unsaved edits. Editable until the
 * deadline; read-only only once it has passed. Selector ids match
 * `apps/mobile/maestro/README.md`.
 */
@Composable
fun PreferencesTabContent(
    vm: PreferencesViewModel,
    onSubmit: () -> Unit = vm::submit,
    onDiscard: () -> Unit = vm::revert,
    /** Manager-only (BSpec §4.2): set this period's submission deadline (year, month 1..12, day). */
    onSetDeadline: ((Int, Int, Int) -> Unit)? = null,
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

        // The scroll state and the viewport's on-screen bounds are hoisted so the paint canvas can
        // drive edge auto-scroll: once a paint drag reaches the top/bottom of this viewport it
        // scrolls itself just far enough to keep extending the range. `onGloballyPositioned` sits
        // BEFORE `verticalScroll` so it measures the visible viewport box, not the scrolled content.
        val gridScroll = rememberScrollState()
        var viewportTop by remember { mutableFloatStateOf(0f) }
        var viewportBottom by remember { mutableFloatStateOf(0f) }
        Column(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .onGloballyPositioned {
                    val bounds = it.boundsInRoot()
                    viewportTop = bounds.top
                    viewportBottom = bounds.bottom
                }
                .verticalScroll(gridScroll)
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (state.canSetDeadline && onSetDeadline != null) {
                DeadlineSetterCard(
                    currentDeadline = state.deadlineChip,
                    maxDate = state.deadlineMaxDate,
                    onSet = onSetDeadline,
                )
            }

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
                    scroll = gridScroll,
                    viewportTop = { viewportTop },
                    viewportBottom = { viewportBottom },
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
 * Manager-only (SM/HM/BM/RSM, BSpec §4.2) card to set the preference-submission deadline
 * for the active period. Shows the current deadline (or a "not set" placeholder) and opens
 * a date picker bounded to the period start ([maxDate]); the server re-validates. Only
 * rendered when the ViewModel reports `canSetDeadline`, so a plain worker never sees it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DeadlineSetterCard(
    currentDeadline: String?,
    maxDate: LocalDate?,
    onSet: (Int, Int, Int) -> Unit,
) {
    val c = ShiftTheme.colors
    var showPicker by remember { mutableStateOf(false) }
    val maxMillis = maxDate?.atStartOfDayIn(TimeZone.UTC)?.toEpochMilliseconds()

    Column(
        Modifier
            .fillMaxWidth()
            .border(1.dp, c.divider, RoundedCornerShape(12.dp))
            .padding(14.dp)
            .testTag("pref_deadline_card"),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("Submission deadline", color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
        Text(
            currentDeadline ?: "No deadline set for this period.",
            color = c.sec,
            fontSize = 13.sp,
        )
        ShiftButton(
            text = "Set deadline",
            onClick = { showPicker = true },
            modifier = Modifier.testTag("pref_set_deadline"),
            variant = ButtonVariant.Outlined,
            size = ButtonSize.Md,
        )
    }

    if (showPicker) {
        val pickerState =
            rememberDatePickerState(
                initialSelectedDateMillis = maxMillis,
                selectableDates =
                    object : SelectableDates {
                        override fun isSelectableDate(utcTimeMillis: Long): Boolean =
                            maxMillis == null || utcTimeMillis <= maxMillis
                    },
            )
        DatePickerDialog(
            onDismissRequest = { showPicker = false },
            confirmButton = {
                ShiftButton(
                    text = "Save",
                    onClick = {
                        pickerState.selectedDateMillis?.let { millis ->
                            val date = Instant.fromEpochMilliseconds(millis).toLocalDateTime(TimeZone.UTC).date
                            onSet(date.year, date.monthNumber, date.dayOfMonth)
                        }
                        showPicker = false
                    },
                    modifier = Modifier.testTag("pref_deadline_confirm"),
                    size = ButtonSize.Md,
                )
            },
            dismissButton = {
                ShiftButton(
                    text = "Cancel",
                    onClick = { showPicker = false },
                    variant = ButtonVariant.Outlined,
                    size = ButtonSize.Md,
                )
            },
        ) {
            DatePicker(state = pickerState)
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

// How close to the edge of the visible timeline a paint drag must get before the grid starts
// scrolling itself, and the fastest it will go (per frame, so ~60x that per second). Deliberately
// gentle: edge auto-scroll exists only to let ONE drag reach off-screen blocks, and an over-eager
// edge zone turns every drag that ends low on the screen into a runaway scroll. Mirrors iOS's
// `autoScrollZone` / `autoScrollMaxStep`; keep the two in step.
private val PREF_AUTO_SCROLL_ZONE = 64.dp
private val PREF_AUTO_SCROLL_MAX_STEP = 9.dp

/**
 * The selected day's vertical timeline: hours in a left gutter (on the dividing lines),
 * bare colored 30-min segments (no per-cell text), and ONE label pill per painted run.
 *
 * The gesture model is SPLIT rather than arbitrated: the shift grid is a pure paint canvas that
 * NEVER scrolls, and the page is scrolled from the left time gutter (which has no pointerInput)
 * instead. Dragging on the grid paints a contiguous range; a single tap toggles one block. While
 * dragging, the affected span is outlined and tinted LIVE: accent blue when the drag is adding the
 * active brush, red when it is erasing (dragging back over blocks already painted in that same
 * mode). The add-vs-erase operation is decided by the block the drag starts on (see
 * [PreferencesViewModel.beginPaintDrag]).
 *
 * The one exception to "never scrolls" is edge auto-scroll: a drag that reaches the top/bottom of
 * the viewport scrolls it just far enough to keep going, because lifting to scroll and starting a
 * second drag cannot express one continuous span. [scroll] and the viewport bounds are the host's.
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
    scroll: ScrollState,
    viewportTop: () -> Float,
    viewportBottom: () -> Float,
) {
    val cells = day.cells
    if (cells.isEmpty()) return
    val total = PREF_BLOCK_HEIGHT * cells.size
    val density = LocalDensity.current
    val blockPx = with(density) { PREF_BLOCK_HEIGHT.toPx() }
    val autoScrollZonePx = with(density) { PREF_AUTO_SCROLL_ZONE.toPx() }
    val autoScrollMaxPx = with(density) { PREF_AUTO_SCROLL_MAX_STEP.toPx() }
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

    // ── Edge auto-scroll state, shared between the pointer loop and the frame loop below ──
    // The grid's own top in root coords, so a pointer position can be compared to the viewport.
    var gridTopInRoot by remember { mutableFloatStateOf(0f) }
    // Signed px-per-frame; 0 = the finger is not in an edge zone. The pointer loop writes it, the
    // frame loop reads it fresh every frame, so HOLDING at the edge keeps scrolling with no further
    // pointer events (which is the whole point: the finger is stationary while content moves).
    var autoScrollStep by remember { mutableFloatStateOf(0f) }
    var autoScrolling by remember { mutableStateOf(false) }
    // The finger's y in GRID-local coords. Real pointer events reset it; auto-scroll ticks advance
    // it by however much actually scrolled, because a stationary finger covers a new block once the
    // content slides underneath it.
    val dragLocalY = remember { mutableFloatStateOf(0f) }
    var dragStartIdx by remember { mutableIntStateOf(0) }

    LaunchedEffect(autoScrolling) {
        if (!autoScrolling) return@LaunchedEffect
        while (isActive) {
            withFrameNanos { }
            val step = autoScrollStep
            if (step == 0f) continue
            val consumed = scroll.scrollBy(step)
            if (consumed == 0f) continue // at the end of the timeline; keep waiting, don't spin out
            dragLocalY.floatValue += consumed
            val cur = idxAt(dragLocalY.floatValue)
            dragSpan = minOf(dragStartIdx, cur)..maxOf(dragStartIdx, cur)
            onPaintRange(cellsNow[dragStartIdx].blockId, cellsNow[cur].blockId)
        }
    }

    Row(Modifier.fillMaxWidth().height(total)) {
        PrefGutter(day.hourMarks, total)
        Box(
            Modifier
                .weight(1f)
                .fillMaxHeight()
                .testTag("pref_block_grid")
                .onGloballyPositioned { gridTopInRoot = it.positionInRoot().y }
                .then(
                    if (enabled) {
                        // The grid is a pure paint canvas: every move is CONSUMED from the down
                        // onwards, so the parent verticalScroll can never accumulate touch slop from
                        // a touch that landed on the grid. Consuming only AFTER slop (the previous
                        // shape) left a race the scroll could win on the first post-slop event, which
                        // is exactly how an in-grid drag ended up scrolling the page instead of
                        // painting. The page is scrolled from the time gutter, which is left
                        // unconsumed. A tap still toggles one block.
                        Modifier.pointerInput(day.dayIndex) {
                            val slop = viewConfiguration.touchSlop
                            awaitEachGesture {
                                val down = awaitFirstDown(requireUnconsumed = false)
                                down.consume()
                                val startIdx = idxAt(down.position.y)
                                val startId = cellsNow[startIdx].blockId
                                var dragging = false
                                while (true) {
                                    val event = awaitPointerEvent()
                                    val change = event.changes.firstOrNull { it.id == down.id } ?: break
                                    change.consume() // unconditional: the grid owns this pointer
                                    if (!change.pressed) {
                                        if (!dragging) {
                                            onPaint(startId) // tap toggles a single block
                                        } else {
                                            onEndPaint()
                                        }
                                        dragSpan = null
                                        autoScrollStep = 0f
                                        autoScrolling = false
                                        break
                                    }
                                    if (!dragging && (change.position - down.position).getDistance() > slop) {
                                        // A drag has started: engage paint mode with a haptic tick and the
                                        // live span highlight (blue add / red erase).
                                        dragging = true
                                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                        dragErase = cellsNow[startIdx].brush == brushNow
                                        dragSpan = startIdx..startIdx
                                        dragStartIdx = startIdx
                                        onBeginPaint(startId)
                                        autoScrolling = true
                                    }
                                    if (dragging) {
                                        dragLocalY.floatValue = change.position.y
                                        val cur = idxAt(change.position.y)
                                        dragSpan = minOf(startIdx, cur)..maxOf(startIdx, cur)
                                        onPaintRange(startId, cellsNow[cur].blockId)
                                        // Re-arm (or stand down) edge auto-scroll from where the
                                        // finger now sits relative to the visible viewport.
                                        val fingerRootY = gridTopInRoot + change.position.y
                                        val fromBottom = viewportBottom() - fingerRootY
                                        val fromTop = fingerRootY - viewportTop()
                                        autoScrollStep = when {
                                            fromBottom < autoScrollZonePx ->
                                                autoScrollMaxPx *
                                                    (1f - fromBottom.coerceAtLeast(0f) / autoScrollZonePx)
                                            fromTop < autoScrollZonePx ->
                                                -autoScrollMaxPx *
                                                    (1f - fromTop.coerceAtLeast(0f) / autoScrollZonePx)
                                            else -> 0f
                                        }
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
    // Tagged because the gutter is a CONTROL, not decoration: it is the screen's scroll handle
    // (the grid beside it consumes its own drags), so tests need to be able to drag it.
    Box(Modifier.width(PREF_GUTTER_WIDTH).height(totalHeight).testTag("pref_time_gutter")) {
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
