package com.pennhousing.shift.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pennhousing.shift.shared.preferences.PrefBlockCell
import com.pennhousing.shift.shared.preferences.PrefBrush
import com.pennhousing.shift.shared.preferences.PrefWeekCell
import com.pennhousing.shift.shared.preferences.PrefWeekStrip
import com.pennhousing.shift.shared.preferences.PREF_BRUSH_ORDER
import com.pennhousing.shift.shared.preferences.PreferenceBanner
import com.pennhousing.shift.shared.preferences.PrefBannerTone
import com.pennhousing.shift.shared.preferences.TargetMeter
import com.pennhousing.shift.shared.viewmodel.PreferencesViewModel
import com.pennhousing.shift.ui.kit.BannerTone
import com.pennhousing.shift.ui.kit.ButtonSize
import com.pennhousing.shift.ui.kit.EmptyState
import com.pennhousing.shift.ui.kit.ShiftBanner
import com.pennhousing.shift.ui.kit.ShiftButton
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.theme.ShiftTheme

/**
 * Preference submission (the tri-state paint grid + target weekly hours) — Compose UI
 * over the shared [PreferencesViewModel]. Rebuilds worker-app.html `PreferenceScreen`
 * with the canonical kit: the context eyebrow, the deadline banner, a Mon–Sun strip,
 * the target-hours stepper card, the Available/Preferred/Cannot brush selector, the
 * 2-column block grid (tap to paint), and the bottom submit bar. Read-only once
 * submitted. Selector ids match `apps/mobile/maestro/README.md`.
 */
@Composable
fun PreferencesTabContent(vm: PreferencesViewModel) {
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
                enabled = !state.submitted,
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
                BrushSelector(state.brush, enabled = !state.submitted, onSelect = vm::setBrush)
                if (!state.submitted) {
                    Text(
                        "Tap a block to paint it for the selected day",
                        color = c.ter,
                        fontSize = 12.sp,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                Text("${state.day.title}", color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                BlockGrid(state.day.cells, enabled = !state.submitted, onPaint = vm::paint)
                Box(Modifier.height(8.dp))
            }
        }

        if (!state.submitted) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .background(c.surface)
                    .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 14.dp),
            ) {
                ShiftButton(
                    text = "Submit preferences",
                    onClick = vm::submit,
                    modifier = Modifier.fillMaxWidth().testTag("submit_preferences_button"),
                    size = ButtonSize.Lg,
                    fullWidth = true,
                )
            }
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

/** Mon–Sun strip: weekday letter, a date pill (selected fill), and a "painted" dot. */
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
    Column(
        modifier
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .testTag("pref_day_cell")
            .padding(vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(cell.dayLetter, color = c.ter, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
        Box(
            Modifier
                .size(34.dp)
                .clip(RoundedCornerShape(50))
                .background(if (cell.selected) blue else Color.Transparent),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                cell.dateLabel,
                color = if (cell.selected) Color.White else c.ink,
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium,
            )
        }
        Box(Modifier.size(5.dp).clip(RoundedCornerShape(50)).background(if (cell.painted) blue else Color.Transparent))
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
        Icon(style.icon, contentDescription = null, tint = if (on) style.fg else c.ter, modifier = Modifier.size(17.dp))
        Text(style.label, color = if (on) style.fg else c.sec, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold)
    }
}

/** The 2-column block grid — each cell shows its time + state icon; tap to paint. */
@Composable
private fun BlockGrid(
    cells: List<PrefBlockCell>,
    enabled: Boolean,
    onPaint: (String) -> Unit,
) {
    Column(Modifier.fillMaxWidth().testTag("pref_block_grid"), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        cells.chunked(2).forEach { pair ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                pair.forEach { cell -> BlockCellView(cell, enabled, Modifier.weight(1f)) { onPaint(cell.blockId) } }
                if (pair.size == 1) Box(Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun BlockCellView(
    cell: PrefBlockCell,
    enabled: Boolean,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    val c = ShiftTheme.colors
    val style = brushStyle(cell.brush)
    val border = if (cell.brush == PrefBrush.AVAILABLE) c.divider else style.accent.copy(alpha = 0.33f)
    Row(
        modifier
            .height(30.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(style.bg)
            .border(1.dp, border, RoundedCornerShape(8.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .testTag("pref_block_cell")
            .padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(cell.timeLabel, style = ShiftTheme.type.monoId.copy(fontSize = 11.5.sp), color = style.fg)
        if (cell.brush != PrefBrush.AVAILABLE) {
            Icon(style.icon, contentDescription = null, tint = style.accent, modifier = Modifier.size(12.dp))
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
