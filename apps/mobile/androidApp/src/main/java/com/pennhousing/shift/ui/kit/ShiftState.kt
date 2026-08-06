package com.pennhousing.shift.ui.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.pennhousing.shift.ui.theme.ShiftColors
import com.pennhousing.shift.ui.theme.ShiftShapes
import com.pennhousing.shift.ui.theme.ShiftTheme

/**
 * Mobile reskin foundation — the **load-bearing** shift-state vocabulary
 * (design-brief §4, worker-app.html `STATE_CFG`). Every shift card / open card /
 * legend row derives its treatment from a [ShiftState]; meaning is always carried
 * by **color + icon + text tag**, never color alone (design-brief §9 / AGENTS
 * hard invariant on the load-bearing colors).
 *
 * The screen layer maps a domain model (`MyShift` / `OpenShift` flags: `kind`,
 * `crossHouse`, `pending`, `breakShift`, `droppedStillOpen`, `feed`) onto one of
 * these — that mapping is a later (screen-reskin) step and is intentionally NOT
 * done here.
 */
enum class ShiftState {
    SCHEDULED,
    FLOAT_OUT,
    PENDING_FLOAT,
    PICKUP_HOME,
    PICKUP_CROSS,
    FLOAT_IN,
    BREAK,
    OPEN,
    PERMANENT,
    UNPICKABLE,
    DROPPED,
    ALLIED,
    ACK,
}

/** Resolved visual treatment for one state (depends on the active [ShiftColors]). */
@Immutable
data class StateVisual(
    val tint: Color, // card background
    val accent: Color?, // border accent + destination-arrow color (null → neutral divider)
    val badgeBg: Color, // house-badge square background
    val badgeFg: Color, // house-badge square initial color
    val tagLabel: String?, // status pill label (null → no pill, e.g. scheduled/open)
    val tagIcon: ImageVector?,
    val tagColor: Color?,
    val dot: Boolean = false, // 8px pickup dot
    val leftBorder: Color? = null, // slate break border
    val dashed: Boolean = false, // open / one-time gap
    val muted: Boolean = false, // unpickable
    val strike: Boolean = false, // dropped (time line-through)
    val showsPending: Boolean = false, // adds the "(Pending)" caution tag
    val prominentBorder: Boolean = false, // full accent border on a plain card body (permanent openings)
    val suppressPill: Boolean = false, // keep tagLabel for the legend but hide the pill on the card
)

/** The per-state config — a 1:1 port of worker-app.html `STATE_CFG`. */
fun ShiftColors.visual(state: ShiftState): StateVisual =
    when (state) {
        ShiftState.SCHEDULED ->
            StateVisual(surface, null, scheduledBadge, ink, null, null, null)
        ShiftState.FLOAT_OUT ->
            StateVisual(floatOut.tint, floatOut.accent, floatOut.badge, floatOut.deep, "Float-out", ShiftIcons.FloatOut, floatOut.deep)
        ShiftState.PENDING_FLOAT ->
            StateVisual(
                floatOut.tint,
                floatOut.accent,
                floatOut.badge,
                floatOut.deep,
                "Float-out",
                ShiftIcons.FloatOut,
                floatOut.deep,
                showsPending = true,
            )
        ShiftState.PICKUP_HOME ->
            StateVisual(surface, null, blueContainerOf(), onBlueContainer, "Picked up", ShiftIcons.Check, pickupDot, dot = true)
        ShiftState.PICKUP_CROSS ->
            StateVisual(floatOut.tint, floatOut.accent, floatOut.badge, floatOut.deep, "Picked up", ShiftIcons.Check, pickupDot, dot = true)
        ShiftState.FLOAT_IN ->
            StateVisual(floatIn.tint, floatIn.accent, floatIn.badge, floatIn.deep, "Float-in", ShiftIcons.FloatIn, floatIn.deep)
        ShiftState.BREAK ->
            StateVisual(
                surface,
                null,
                breakShift.badge,
                breakShift.deep,
                "Break",
                ShiftIcons.Snowflake,
                breakShift.deep,
                leftBorder = breakShift.accent,
            )
        ShiftState.OPEN ->
            StateVisual(surface, null, scheduledBadge, ter, null, null, null, dashed = true)
        ShiftState.PERMANENT ->
            StateVisual(
                surface,
                permanent.accent,
                permanent.badge,
                permanent.deep,
                "Permanent opening",
                ShiftIcons.Refresh,
                permanent.deep,
                prominentBorder = true,
                suppressPill = true,
            )
        ShiftState.UNPICKABLE ->
            StateVisual(surfaceVar, null, unpickBadge, ter, "Unpickable", ShiftIcons.Lock, ter, muted = true)
        ShiftState.DROPPED ->
            StateVisual(surface, null, scheduledBadge, ter, "Dropped (still open)", ShiftIcons.ArrowDown, sec, strike = true)
        ShiftState.ALLIED ->
            StateVisual(allied.tint, allied.accent, allied.badge, allied.deep, "Allied", ShiftIcons.Person, allied.deep)
        ShiftState.ACK ->
            StateVisual(success.tint, success.accent, success.badge, success.deep, "Acknowledged", ShiftIcons.CheckCircle, success.deep)
    }

/** pickup-home badge uses the blue container; mirror the M3 token so [visual] stays non-composable. */
private fun ShiftColors.blueContainerOf(): Color = if (isDark) Color(0xFF0C2C4F) else Color(0xFFE4EDFF)

private val PILL_TEXT_SIZE = 12.sp

/**
 * The status pill — icon + text, fully-rounded. The "never color alone" atom.
 * [strong] renders a solid filled pill (accent bg, white text); otherwise a tinted
 * pill (state badge bg, deep text).
 */
@Composable
fun StatePill(
    state: ShiftState,
    modifier: Modifier = Modifier,
    strong: Boolean = false,
) {
    val v = ShiftTheme.colors.visual(state)
    val label = v.tagLabel ?: return
    val icon = v.tagIcon
    val fg = if (strong) Color.White else (v.tagColor ?: ShiftTheme.colors.ink)
    val bg = if (strong) (v.accent ?: ShiftTheme.colors.ink) else v.badgeBg

    Row(
        modifier =
            modifier
                .background(bg, ShiftShapes.pill)
                .padding(start = 6.dp, top = 3.dp, end = 8.dp, bottom = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (icon != null) Icon(icon, contentDescription = null, tint = fg, modifier = Modifier.size(13.dp))
        Text(
            label,
            color = fg,
            fontSize = PILL_TEXT_SIZE,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = (-0.01).em,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** The "(Pending)" caution tag — a force-triggered float not yet acknowledged (§11.2). */
@Composable
fun PendingTag(modifier: Modifier = Modifier) {
    val c = ShiftTheme.colors
    Row(
        modifier =
            modifier
                .background(c.warnSoft, ShiftShapes.pill)
                .padding(start = 6.dp, top = 3.dp, end = 8.dp, bottom = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(ShiftIcons.Clock, contentDescription = null, tint = c.pending, modifier = Modifier.size(13.dp))
        Text("Pending", color = c.pending, fontSize = PILL_TEXT_SIZE, fontWeight = FontWeight.SemiBold)
    }
}

/** One legend entry: the canonical state vocabulary the screens reference. */
@Immutable
data class LegendEntry(
    val state: ShiftState,
    val description: String,
)

/** The default worker state legend (design-brief §4 / worker-app.html `LEGEND`). */
val WorkerStateLegend: List<LegendEntry> =
    listOf(
        LegendEntry(ShiftState.SCHEDULED, "Your normal scheduled shift at your home desk."),
        LegendEntry(ShiftState.FLOAT_OUT, "You're sent to cover another desk. Your hours don't change."),
        LegendEntry(ShiftState.PENDING_FLOAT, "A float assigned but not yet acknowledged."),
        LegendEntry(ShiftState.PICKUP_HOME, "A shift you picked up at your home desk."),
        LegendEntry(ShiftState.PICKUP_CROSS, "A shift you picked up at another desk."),
        LegendEntry(ShiftState.FLOAT_IN, "Someone from another desk is covering here."),
        LegendEntry(ShiftState.BREAK, "A break-period shift (short or winter break)."),
        LegendEntry(ShiftState.OPEN, "An open one-time gap you can claim."),
        LegendEntry(ShiftState.PERMANENT, "A recurring slot whose owner permanently dropped it."),
        LegendEntry(ShiftState.UNPICKABLE, "Past the T-2h cutoff: visible but no longer claimable."),
        LegendEntry(ShiftState.DROPPED, "You dropped this; still open until someone claims it."),
        LegendEntry(ShiftState.ALLIED, "Covered by external Allied Security."),
        LegendEntry(ShiftState.ACK, "A float you've acknowledged."),
    )

/** The reusable state-legend panel — a 30x30 swatch per state + name + meaning. */
@Composable
fun StateLegend(
    modifier: Modifier = Modifier,
    entries: List<LegendEntry> = WorkerStateLegend,
) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        entries.forEach { entry -> LegendRow(entry) }
    }
}

@Composable
private fun LegendRow(entry: LegendEntry) {
    val c = ShiftTheme.colors
    val v = c.visual(entry.state)
    Row(
        Modifier
            .fillMaxWidth()
            .background(c.bg, RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        LegendSwatch(v)
        Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(
                v.tagLabel ?: entry.state.name
                    .lowercase()
                    .replaceFirstChar { it.uppercase() },
                color = c.ink,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Text(entry.description, color = c.ter, fontSize = 11.5.sp, lineHeight = 15.sp)
        }
    }
}

@Composable
private fun LegendSwatch(v: StateVisual) {
    val c = ShiftTheme.colors
    val shape = RoundedCornerShape(8.dp)
    var box =
        Modifier
            .size(30.dp)
            .background(v.tint, shape)
    box =
        when {
            v.dashed -> box.then(Modifier.dashedBorder(c.outline, cornerRadius = 8.dp))
            v.accent != null -> box.border(1.dp, v.accent.copy(alpha = 0.33f), shape)
            else -> box.border(1.dp, c.divider, shape)
        }
    Box(box, contentAlignment = Alignment.Center) {
        when {
            v.dot -> Box(Modifier.size(8.dp).background(c.pickupDot, RoundedCornerShape(50)))
            v.tagIcon != null -> Icon(v.tagIcon, contentDescription = null, tint = v.tagColor ?: c.ink, modifier = Modifier.size(15.dp))
            v.leftBorder != null -> Icon(
                ShiftIcons.Snowflake,
                contentDescription = null,
                tint = v.leftBorder,
                modifier = Modifier.size(15.dp),
            )
        }
    }
}
