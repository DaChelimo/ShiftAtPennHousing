package com.pennhousing.shift.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.runtime.Immutable
import androidx.compose.ui.unit.dp

/**
 * Mobile reskin foundation — shape layer. Radii are the `--r-*` tokens from
 * `worker-app.html`: card 16, sheet 28 (top), button 12, chip pill (full).
 */
val ShiftShapesM3 =
    Shapes(
        extraSmall = RoundedCornerShape(6.dp), // duration chip
        small = RoundedCornerShape(10.dp), // small button
        medium = RoundedCornerShape(12.dp), // default button / menu
        large = RoundedCornerShape(16.dp), // card
        extraLarge = RoundedCornerShape(28.dp), // bottom sheet
    )

/** Named shapes for the component kit (so each component matches the design exactly). */
@Immutable
object ShiftShapes {
    val card = RoundedCornerShape(16.dp)
    val sheet = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)
    val button = RoundedCornerShape(12.dp)
    val buttonSmall = RoundedCornerShape(10.dp)
    val houseBadge = RoundedCornerShape(11.dp)
    val durationChip = RoundedCornerShape(6.dp)
    val toast = RoundedCornerShape(14.dp)
    val banner = RoundedCornerShape(14.dp)
    val segmentTrack = RoundedCornerShape(10.dp)
    val segmentThumb = RoundedCornerShape(8.dp)
    val pill = RoundedCornerShape(percent = 50) // chip / tag / countdown — fully round
}
