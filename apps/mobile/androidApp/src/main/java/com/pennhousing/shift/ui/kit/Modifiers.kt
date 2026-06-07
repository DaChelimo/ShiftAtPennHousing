package com.pennhousing.shift.ui.kit

import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

// Mobile reskin foundation — shared draw/layout modifiers for the kit.

/** A dashed rounded-rect border — the one-time-gap / open-shift treatment (§4). */
fun Modifier.dashedBorder(
    color: Color,
    cornerRadius: Dp = 16.dp,
    strokeWidth: Dp = 1.5.dp,
    dashOn: Dp = 5.dp,
    dashOff: Dp = 4.dp,
): Modifier =
    this.drawBehind {
        val sw = strokeWidth.toPx()
        drawRoundRect(
            color = color,
            topLeft = Offset(sw / 2f, sw / 2f),
            size = Size(size.width - sw, size.height - sw),
            cornerRadius = CornerRadius(cornerRadius.toPx()),
            style = Stroke(width = sw, pathEffect = PathEffect.dashPathEffect(floatArrayOf(dashOn.toPx(), dashOff.toPx()))),
        )
    }

/**
 * Press-feedback scale (design: button 0.97, card 0.985). Reads [source]'s pressed
 * state and scales without recomposition jitter. Pair with the component's
 * `interactionSource`.
 */
@Composable
fun Modifier.pressScale(
    source: InteractionSource,
    scale: Float,
): Modifier {
    val pressed by source.collectIsPressedAsState()
    val s = if (pressed) scale else 1f
    return this.graphicsLayer {
        scaleX = s
        scaleY = s
    }
}
