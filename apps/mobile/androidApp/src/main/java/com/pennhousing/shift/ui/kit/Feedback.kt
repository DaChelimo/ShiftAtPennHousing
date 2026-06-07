package com.pennhousing.shift.ui.kit

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pennhousing.shift.ui.theme.Dimens
import com.pennhousing.shift.ui.theme.Motion
import com.pennhousing.shift.ui.theme.ShiftShapes
import com.pennhousing.shift.ui.theme.ShiftTheme
import com.pennhousing.shift.ui.theme.Spacing

/** Toast tone → the leading dot color. */
enum class ToastTone { Neutral, Success, Error }

/** The dark snackbar/toast (worker-app.html `Toast`). */
@Composable
fun ShiftToast(
    message: String,
    modifier: Modifier = Modifier,
    tone: ToastTone = ToastTone.Neutral,
    icon: ImageVector? = null,
) {
    val c = ShiftTheme.colors
    val dot =
        when (tone) {
            ToastTone.Success -> c.success.accent
            ToastTone.Error -> c.danger.accent
            ToastTone.Neutral -> c.ink
        }
    Row(
        modifier
            .fillMaxWidth()
            .background(c.toastBg, ShiftShapes.toast)
            .padding(horizontal = 16.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (icon != null) {
            Box(Modifier.size(22.dp).background(dot, RoundedCornerShape(50)), contentAlignment = Alignment.Center) {
                Icon(icon, contentDescription = null, tint = c.toastBg, modifier = Modifier.size(14.dp))
            }
        }
        Text(message, color = c.toastFg, fontSize = 14.5.sp, fontWeight = FontWeight.Medium)
    }
}

/** Banner tone (worker-app.html `Banner`). */
enum class BannerTone { Info, Warning, Error, Success }

/** Inline urgent/info banner with a 4px left accent + icon + title/body + optional action. */
@Composable
fun ShiftBanner(
    title: String,
    modifier: Modifier = Modifier,
    body: String? = null,
    tone: BannerTone = BannerTone.Info,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    val c = ShiftTheme.colors
    val (accent, deep) =
        when (tone) {
            BannerTone.Info -> c.pickupDot to c.onBlueContainer
            BannerTone.Warning -> c.breakShift.accent to c.breakShift.deep
            BannerTone.Error -> c.danger.accent to c.danger.deep
            BannerTone.Success -> c.success.accent to c.success.deep
        }
    val icon =
        when (tone) {
            BannerTone.Info -> ShiftIcons.Info
            BannerTone.Warning -> ShiftIcons.Warning
            BannerTone.Error -> ShiftIcons.Warning
            BannerTone.Success -> ShiftIcons.CheckCircle
        }
    Box(
        modifier
            .fillMaxWidth()
            .clip(ShiftShapes.banner)
            .background(c.surface)
            .border(Dimens.hairline, c.divider, ShiftShapes.banner),
    ) {
        Box(
            Modifier
                .align(Alignment.CenterStart)
                .width(Dimens.breakBorder)
                .fillMaxHeight()
                .background(accent),
        )
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(11.dp),
        ) {
            Icon(icon, contentDescription = null, tint = accent, modifier = Modifier.size(19.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(title, color = deep, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                if (body != null) Text(body, color = c.sec, fontSize = 13.sp, lineHeight = 18.sp)
            }
            if (actionLabel != null && onAction != null) {
                Text(
                    actionLabel,
                    modifier = Modifier.clickable(onClick = onAction).padding(start = 4.dp, top = 2.dp),
                    color = accent,
                    fontSize = 13.5.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
    }
}

/** Deadline countdown urgency tone (worker-app.html `Countdown`). */
enum class CountdownTone { Normal, Urgent, Passed }

/**
 * The deadline countdown chip (§4 atom). The caller supplies the formatted [label]
 * (e.g. "Respond by 20:50 · 04:12") and the [tone] — the foundation never reads a
 * clock, mirroring the pure-decision ethos of the shared layer.
 */
@Composable
fun CountdownChip(
    label: String,
    modifier: Modifier = Modifier,
    tone: CountdownTone = CountdownTone.Normal,
) {
    val c = ShiftTheme.colors
    val (fg, bg) =
        when (tone) {
            CountdownTone.Normal -> c.pending to c.warnSoft
            CountdownTone.Urgent -> c.danger.accent to c.danger.tint
            CountdownTone.Passed -> c.ter to c.surfaceVar
        }
    Row(
        modifier.background(bg, ShiftShapes.pill).padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(ShiftIcons.Clock, contentDescription = null, tint = fg, modifier = Modifier.size(15.dp))
        Text(
            label,
            color = fg,
            fontSize = 13.5.sp,
            fontWeight = FontWeight.SemiBold,
            style = ShiftTheme.type.monoTime.copy(color = fg, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold),
        )
    }
}

/** A small red count badge for icon buttons / nav items. */
@Composable
fun CountBadge(
    count: Int,
    modifier: Modifier = Modifier,
) {
    if (count <= 0) return
    val c = ShiftTheme.colors
    Box(
        modifier
            .background(c.danger.accent, RoundedCornerShape(50))
            .border(1.5.dp, c.bg, RoundedCornerShape(50))
            .padding(horizontal = 5.dp, vertical = 1.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(if (count > 99) "99+" else count.toString(), color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Bold)
    }
}

/** Whole-screen empty state (worker-app.html `EmptyState`). */
@Composable
fun EmptyState(
    title: String,
    icon: ImageVector,
    modifier: Modifier = Modifier,
    body: String? = null,
) {
    val c = ShiftTheme.colors
    Column(
        modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Box(
            Modifier.size(56.dp).background(c.surfaceVar, RoundedCornerShape(18.dp)).padding(bottom = 0.dp),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = c.ter, modifier = Modifier.size(Dimens.iconEmptyState))
        }
        Text(title, color = c.ink, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 14.dp))
        if (body != null) Text(body, color = c.ter, fontSize = 13.5.sp, lineHeight = 19.sp)
    }
}

// ── Skeleton shimmer ─────────────────────────────────────────────────────────

/** The shimmer fill (1.4s) for skeleton placeholders (worker-app.html `.skeleton`). */
@Composable
fun Modifier.shimmer(cornerRadius: Dp = 8.dp): Modifier {
    val c = ShiftTheme.colors
    val transition = rememberInfiniteTransition(label = "shimmer")
    val progress by transition.animateFloatSafe()
    return this.drawBehind {
        val span = size.width * 0.6f
        val startX = -span + (size.width + span) * progress
        drawRoundRect(
            brush = Brush.horizontalGradient(listOf(c.skeletonA, c.skeletonB, c.skeletonA), startX = startX, endX = startX + span),
            cornerRadius = CornerRadius(cornerRadius.toPx()),
            topLeft = Offset.Zero,
            size = Size(size.width, size.height),
        )
    }
}

@Composable
private fun androidx.compose.animation.core.InfiniteTransition.animateFloatSafe() =
    animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(Motion.SKELETON_MS, easing = LinearEasing)),
        label = "shimmerX",
    )

/** A skeleton card that mirrors a [ShiftCard] shell while loading. */
@Composable
fun SkeletonShiftCard(modifier: Modifier = Modifier) {
    val c = ShiftTheme.colors
    Row(
        modifier
            .fillMaxWidth()
            .clip(ShiftShapes.card)
            .background(c.surface)
            .border(Dimens.hairline, c.divider, ShiftShapes.card)
            .padding(horizontal = Spacing.cardPadH, vertical = Spacing.cardPadV),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(Dimens.houseBadge).shimmer(11.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.fillMaxWidth(0.52f).height(14.dp).shimmer())
            Box(Modifier.fillMaxWidth(0.34f).height(11.dp).shimmer())
        }
    }
}
