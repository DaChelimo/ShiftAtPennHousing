package com.pennhousing.shift.ui.kit

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
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pennhousing.shift.ui.theme.Dimens
import com.pennhousing.shift.ui.theme.Elevation
import com.pennhousing.shift.ui.theme.Motion
import com.pennhousing.shift.ui.theme.ShiftShapes
import com.pennhousing.shift.ui.theme.ShiftTheme
import com.pennhousing.shift.ui.theme.Spacing

// ── Atoms ───────────────────────────────────────────────────────────────────

/** The 8px filled pickup dot (§4 reusable atom). */
@Composable
fun PickupDot(
    modifier: Modifier = Modifier,
    size: androidx.compose.ui.unit.Dp = Dimens.pickupDot,
) {
    Box(modifier.size(size).background(ShiftTheme.colors.pickupDot, RoundedCornerShape(50)))
}

/** Tones for the [DurationChip]. */
enum class DurationTone { Neutral, Blue }

/** A small mono duration chip, e.g. "2h" / "30m". */
@Composable
fun DurationChip(
    label: String,
    modifier: Modifier = Modifier,
    tone: DurationTone = DurationTone.Neutral,
) {
    val c = ShiftTheme.colors
    val (bg, fg) =
        when (tone) {
            DurationTone.Neutral -> c.surfaceVar to c.sec
            DurationTone.Blue -> blueContainerColor() to c.onBlueContainer
        }
    Text(
        label,
        modifier = modifier.background(bg, ShiftShapes.durationChip).padding(horizontal = 7.dp, vertical = 2.dp),
        color = fg,
        style = ShiftTheme.type.monoId,
    )
}

/** The leading 40×40 house-initial square on a shift card. */
@Composable
fun HouseBadge(
    initial: String,
    bg: Color,
    fg: Color,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier.size(Dimens.houseBadge).background(bg, ShiftShapes.houseBadge),
        contentAlignment = Alignment.Center,
    ) {
        Text(initial.take(1).uppercase(), color = fg, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
    }
}

// ── The canonical Shift Card ─────────────────────────────────────────────────

/**
 * The one card that renders every shift state (worker-app.html `ShiftCard`).
 * Differentiation is entirely from [state] via [ShiftColors.visual]: tint, accent
 * hairline, badge, the status [StatePill], pickup dot, golden break border, dashed
 * open border, muted/strike modifiers. Pass [action] for a trailing button (Claim
 * / Pick up / Reclaim); otherwise an [onClick] card shows a chevron.
 *
 * Attach a Maestro selector by passing `Modifier.testTag("…")` as [modifier] — it
 * lands on the card root.
 */
@Composable
fun ShiftCard(
    state: ShiftState,
    houseInitial: String,
    timeLabel: String,
    modifier: Modifier = Modifier,
    eyebrow: String? = null,
    houseName: String? = null,
    destination: String? = null,
    durationLabel: String? = null,
    meta: String? = null,
    active: Boolean = false,
    onClick: (() -> Unit)? = null,
    action: (@Composable () -> Unit)? = null,
) {
    val c = ShiftTheme.colors
    val v = c.visual(state)
    val shape = ShiftShapes.card
    val interaction = remember { MutableInteractionSource() }

    var box = modifier.fillMaxWidth()
    // Shadow (skip when muted), then clip, fill, border.
    if (!v.muted) box = box.shadow(if (active) Elevation.level2 else Elevation.level1, shape, clip = false)
    box = box.clip(shape).background(v.tint)
    box =
        when {
            active -> box.border(Dimens.cardAccentRing, c.pickupDot, shape)
            v.dashed -> box.dashedBorder(c.outline, cornerRadius = 16.dp)
            v.accent != null -> box.border(Dimens.hairline, v.accent.copy(alpha = 0.22f), shape)
            else -> box.border(Dimens.hairline, c.divider, shape)
        }
    if (onClick != null) box = box.pressScale(interaction, Motion.PRESS_SCALE_CARD)
    if (v.muted) box = box.alpha(0.72f)

    Box(box) {
        // Golden break left border (4dp), rounded by the card clip.
        if (v.leftBorder != null) {
            Box(
                Modifier
                    .align(Alignment.CenterStart)
                    .width(Dimens.breakBorder)
                    .fillMaxHeight()
                    .background(v.leftBorder),
            )
        }
        Row(
            Modifier
                .fillMaxWidth()
                .then(
                    if (onClick != null) {
                        Modifier.clickableNoRipple(interaction, onClick)
                    } else {
                        Modifier
                    },
                ).padding(horizontal = Spacing.cardPadH, vertical = Spacing.cardPadV),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            HouseBadge(houseInitial, v.badgeBg, v.badgeFg)

            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                if (eyebrow != null) {
                    Text(eyebrow.uppercase(), color = c.sec, style = ShiftTheme.type.eyebrow, maxLines = 1)
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        timeLabel,
                        color = if (v.muted) c.ter else c.ink,
                        style = ShiftTheme.type.monoTime,
                        textDecoration = if (v.strike) TextDecoration.LineThrough else null,
                    )
                    if (durationLabel != null) DurationChip(durationLabel)
                    if (v.dot) PickupDot()
                }
                val hasMeta = houseName != null || destination != null || v.tagLabel != null || v.showsPending
                if (hasMeta) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        if (houseName != null) Text(houseName, color = c.sec, fontSize = 13.5.sp, fontWeight = FontWeight.Medium)
                        if (destination != null) {
                            Text(
                                "→ $destination",
                                color = v.accent ?: c.sec,
                                fontSize = 13.5.sp,
                                fontWeight = FontWeight.Medium,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        if (v.tagLabel != null) StatePill(state)
                        if (v.showsPending) PendingTag()
                    }
                }
                if (meta != null) Text(meta, color = c.ter, fontSize = 12.5.sp)
            }

            if (action != null) {
                action()
            } else if (onClick != null) {
                Icon(ShiftIcons.ChevronRight, contentDescription = null, tint = c.outline, modifier = Modifier.size(Dimens.icon))
            }
        }
    }
}

/**
 * Open-shift card (worker-app.html reuses `ShiftCard`): an [OPEN] / [PERMANENT] /
 * [UNPICKABLE] card with a trailing Claim / Pick-up action. Convenience wrapper so
 * the open-shifts feed reads cleanly.
 */
@Composable
fun OpenShiftCard(
    state: ShiftState,
    houseInitial: String,
    timeLabel: String,
    modifier: Modifier = Modifier,
    eyebrow: String? = null,
    houseName: String? = null,
    meta: String? = null,
    actionLabel: String? = null,
    actionVariant: ButtonVariant = ButtonVariant.Filled,
    onAction: (() -> Unit)? = null,
) {
    ShiftCard(
        state = state,
        houseInitial = houseInitial,
        timeLabel = timeLabel,
        modifier = modifier,
        eyebrow = eyebrow,
        houseName = houseName,
        meta = meta,
        action =
            if (actionLabel != null && onAction != null) {
                { ShiftButton(actionLabel, onAction, variant = actionVariant, size = ButtonSize.Sm) }
            } else {
                null
            },
    )
}

@Composable private fun blueContainerColor() = androidx.compose.material3.MaterialTheme.colorScheme.primaryContainer

/** A clickable with no ripple/indication (the card supplies its own press-scale). */
private fun Modifier.clickableNoRipple(
    interaction: MutableInteractionSource,
    onClick: () -> Unit,
): Modifier =
    this.clickable(
        interactionSource = interaction,
        indication = null,
        onClick = onClick,
    )
