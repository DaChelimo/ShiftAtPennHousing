package com.pennhousing.shift.ui.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.pennhousing.shift.ui.theme.ShiftShapes
import com.pennhousing.shift.ui.theme.ShiftTheme

/** Uppercase section header with an optional count pill (worker-app.html `SectionLabel`). */
@Composable
fun SectionHeader(
    title: String,
    modifier: Modifier = Modifier,
    count: Int? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    val c = ShiftTheme.colors
    Row(
        modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 0.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                title.uppercase(),
                color = c.sec,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 0.05.em,
            )
            if (count != null) {
                Text(
                    count.toString(),
                    modifier = Modifier.background(c.surfaceVar, ShiftShapes.pill).padding(horizontal = 7.dp, vertical = 1.dp),
                    color = c.ter,
                    style = ShiftTheme.type.monoId,
                )
            }
        }
        trailing?.invoke()
    }
}

/**
 * A My-Shifts–style section that ALWAYS renders its container (attach the Maestro
 * `section_*` testTag via [modifier]) and shows an inline empty placeholder when
 * [isEmpty] — satisfying the selector contract (the section nodes must exist even
 * when empty). Non-empty: renders [content].
 */
@Composable
fun ShiftSection(
    title: String,
    isEmpty: Boolean,
    modifier: Modifier = Modifier,
    count: Int? = null,
    emptyText: String = "None this week",
    content: @Composable () -> Unit,
) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionHeader(title, count = count)
        if (isEmpty) {
            Text(emptyText, color = ShiftTheme.colors.ter, fontSize = 13.5.sp)
        } else {
            content()
        }
    }
}

/** Generic key/value list row (worker-app.html `Row`) — settings & detail rows. */
@Composable
fun KeyValueRow(
    label: String,
    modifier: Modifier = Modifier,
    last: Boolean = false,
    value: String? = null,
    trailing: (@Composable () -> Unit)? = null,
    onClick: (() -> Unit)? = null,
) {
    val c = ShiftTheme.colors
    Column(modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
                .padding(vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(label, color = c.ter, fontSize = 13.5.sp, fontWeight = FontWeight.Medium)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (value != null) Text(value, color = c.ink, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                trailing?.invoke()
            }
        }
        if (!last) HorizontalDivider(color = c.divider, thickness = 1.dp)
    }
}
