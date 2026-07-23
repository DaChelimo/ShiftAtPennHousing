package com.pennhousing.shift.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pennhousing.shift.shared.data.ToastNotification
import com.pennhousing.shift.shared.shifts.weeklyHoursSummary
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.theme.ShiftTheme

@Composable
internal fun SpecTab(
    title: String,
    tag: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Tab(
        selected = selected,
        onClick = onClick,
        modifier = Modifier.testTag(tag),
        text = { Text(title, maxLines = 1) },
    )
}

/** Deliverable #7 — top-of-screen toast for a new Realtime `notifications` row. */
@Composable
internal fun NotificationToast(toast: ToastNotification) {
    Surface(
        color = MaterialTheme.colorScheme.primaryContainer,
        modifier = Modifier.fillMaxWidth().testTag("notification_toast"),
    ) {
        Column(Modifier.padding(12.dp)) {
            Text(toast.title, fontWeight = FontWeight.SemiBold)
            if (toast.body.isNotBlank()) Text(toast.body)
        }
    }
}

@Composable
internal fun ShiftCardColumn(content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) { content() }
}

/** The "This week — 14h of 20h soft cap" summary chip (design My-Shifts header). */
@Composable
internal fun WeekTotalChip(
    weekHours: Double,
    breakProfile: Boolean,
    weekOffset: Int = 0,
    modifier: Modifier = Modifier,
) {
    val c = ShiftTheme.colors
    val summary = remember(weekHours, breakProfile) { weeklyHoursSummary(weekHours, breakProfile) }
    // The label follows the shown week so the hours never read as "this week" when
    // the worker has navigated forward/back.
    val label =
        when {
            weekOffset == 0 -> "This week"
            weekOffset == 1 -> "Next week"
            weekOffset == -1 -> "Last week"
            weekOffset > 1 -> "In $weekOffset weeks"
            else -> "${-weekOffset} weeks ago"
        }
    val mono = ShiftTheme.type.monoTime.copy(fontSize = 13.5.sp)
    Row(
        modifier
            .fillMaxWidth()
            .background(c.surface, RoundedCornerShape(12.dp))
            .border(1.dp, c.divider, RoundedCornerShape(12.dp))
            .padding(horizontal = 13.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(ShiftIcons.Clock, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(17.dp))
        Text(label, color = c.sec, fontSize = 13.5.sp, fontWeight = FontWeight.Medium)
        Spacer(Modifier.weight(1f))
        Text(summary.current, style = mono, color = c.ink)
        Text(summary.capLabel, style = mono.copy(fontWeight = FontWeight.Normal), color = c.ter)
    }
}

/** A page header — the tab's title, top-left, big and near-black (the design's large title). */
@Composable
internal fun PageTitle(
    title: String,
    modifier: Modifier = Modifier,
    // An optional trailing accessory (e.g. the My-Shifts tour help button). Defaults to
    // null so the other 9 call sites of this composable are unaffected.
    trailing: (@Composable () -> Unit)? = null,
) {
    if (trailing == null) {
        Text(
            title,
            modifier = modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 8.dp),
            color = ShiftTheme.colors.ink,
            fontSize = 26.sp,
            fontWeight = FontWeight.Bold,
        )
    } else {
        Row(
            modifier = modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(title, modifier = Modifier.weight(1f), color = ShiftTheme.colors.ink, fontSize = 26.sp, fontWeight = FontWeight.Bold)
            trailing()
        }
    }
}

/** "This week" / "Next week" / … for a week [offset] (0 = current). */
internal fun weekOffsetTitle(offset: Int): String =
    when {
        offset == 0 -> "This week"
        offset == 1 -> "Next week"
        offset == -1 -> "Last week"
        offset > 1 -> "In $offset weeks"
        else -> "${-offset} weeks ago"
    }
