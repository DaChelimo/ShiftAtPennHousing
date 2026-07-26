package com.pennhousing.shift.ui.onboarding

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.kit.blockThumbCenterX
import com.pennhousing.shift.ui.theme.Dimens

/**
 * The "drag me" badge a tour's range-slider step rides on its lower handle, wiggling
 * sideways on a loop until the worker actually drags. Principle 4 of
 * `docs/design/interactive-onboarding-pattern.md`: a two-handle range slider is not a
 * convention workers arrive with, so the step primes the affordance instead of hoping it
 * gets discovered.
 *
 * A port of iOS's `dragHintBadge` (ShiftTourView.swift and friends), down to the -26dp
 * wiggle and the 0.9s ease-in-out loop. iOS is the reference; Android had no hint at all.
 *
 * Purely decorative — it installs no pointer handler, so taps and drags fall straight
 * through to the real slider underneath. It carries a [tag] only so a test can prove the
 * hint shows on the step and retires the moment the worker drags.
 *
 * Call from inside the [BoxScope] that also holds the slider, passing that box's width.
 */
@Composable
internal fun BoxScope.RangeSliderDragHint(
    blockIndex: Int,
    blockCount: Int,
    trackWidth: Dp,
    tag: String,
) {
    val transition = rememberInfiniteTransition(label = "range_slider_drag_hint")
    val wiggle by transition.animateFloat(
        initialValue = 0f,
        targetValue = -26f,
        animationSpec = infiniteRepeatable(tween(durationMillis = 900, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "range_slider_drag_hint_offset",
    )
    Box(
        Modifier
            .align(Alignment.CenterStart)
            .offset(x = blockThumbCenterX(blockIndex, blockCount, trackWidth) - BADGE / 2 + wiggle.dp)
            .size(BADGE)
            .shadow(4.dp, CircleShape)
            .background(MaterialTheme.colorScheme.primary, CircleShape)
            .testTag(tag),
        contentAlignment = Alignment.Center,
    ) {
        Icon(ShiftIcons.HandDrag, contentDescription = null, tint = Color.White, modifier = Modifier.size(Dimens.iconSm))
    }
}

private val BADGE = 28.dp
