package com.pennhousing.shift.ui.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pennhousing.shift.ui.theme.ShiftShapes
import com.pennhousing.shift.ui.theme.ShiftTheme

/**
 * iOS-style segmented control (worker-app.html `Segmented`) — used for the
 * My-House/Other-Houses and List/Day/Week toggles. Track in `surfaceVar`, the
 * selected segment lifts to a `surface` thumb with a soft shadow.
 */
@Composable
fun SegmentedControl(
    options: List<String>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = ShiftTheme.colors
    Row(
        modifier
            .fillMaxWidth()
            .background(c.surfaceVar, ShiftShapes.segmentTrack)
            .padding(2.dp)
            .selectableGroup(),
    ) {
        options.forEachIndexed { i, label ->
            val selected = i == selectedIndex
            var seg = Modifier.weight(1f).clip(ShiftShapes.segmentThumb)
            if (selected) seg = seg.shadow(1.dp, ShiftShapes.segmentThumb).background(c.surface, ShiftShapes.segmentThumb)
            seg = seg.clickable { onSelect(i) }.padding(vertical = 7.dp, horizontal = 8.dp)
            Box(seg, contentAlignment = Alignment.Center) {
                Text(
                    label,
                    color = if (selected) c.ink else c.sec,
                    fontSize = 13.5.sp,
                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                    maxLines = 1,
                )
            }
        }
    }
}

/**
 * The brand switch — the Material 3 [Switch] with brand colors (blue track when on,
 * `switchTrack` when off). Android uses the M3 switch idiom; iOS uses a native
 * `Toggle` (see the SwiftUI kit) — that's the intended native-chrome difference.
 */
@Composable
fun ShiftSwitch(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val c = ShiftTheme.colors
    Switch(
        checked = checked,
        onCheckedChange = onCheckedChange,
        modifier = modifier,
        enabled = enabled,
        colors =
            SwitchDefaults.colors(
                checkedThumbColor = Color.White,
                checkedTrackColor = MaterialTheme.colorScheme.primary,
                checkedBorderColor = Color.Transparent,
                uncheckedThumbColor = Color.White,
                uncheckedTrackColor = c.switchTrack,
                uncheckedBorderColor = Color.Transparent,
            ),
    )
}
