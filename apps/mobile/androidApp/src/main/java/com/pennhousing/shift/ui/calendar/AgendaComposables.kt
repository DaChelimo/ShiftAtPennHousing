package com.pennhousing.shift.ui.calendar

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pennhousing.shift.shared.calendar.AgendaSwapMark
import com.pennhousing.shift.shared.calendar.CalendarAgendaItem
import com.pennhousing.shift.shared.calendar.CalendarDayHeader
import com.pennhousing.shift.shared.shifts.MyShiftRow
import com.pennhousing.shift.ui.common.toKitState
import com.pennhousing.shift.ui.house.durationLabel
import com.pennhousing.shift.ui.kit.DurationChip
import com.pennhousing.shift.ui.kit.HouseBadge
import com.pennhousing.shift.ui.kit.InFlightPill
import com.pennhousing.shift.ui.kit.ShiftCard
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.theme.ShiftTheme

/** Renders one agenda row: the NOW divider or a shift card (shared by Day + Week views). */
@Composable
internal fun AgendaItemRow(
    item: CalendarAgendaItem,
    onShiftClick: (String) -> Unit = {},
    onSwapClick: (String) -> Unit = {},
    onPendingSwapClick: (String) -> Unit = {},
) {
    val now = item.nowLabel
    val shift = item.shift
    if (now != null) {
        NowLine(now)
    } else if (shift != null) {
        val mark = item.swap
        AgendaShiftCard(
            shift,
            item.active,
            past = item.past,
            swap = mark,
            // INCOMING swap → accept/decline popup; OUTGOING swap → the "swap pending"
            // notice (cancel / keep waiting); no swap → the normal drop/swap sheet.
            onClick = {
                when {
                    mark == null -> onShiftClick(shift.id)
                    mark.incoming -> onSwapClick(mark.swapId)
                    else -> onPendingSwapClick(mark.swapId)
                }
            },
        )
    }
}

/** "Today · Jun 3" + a "2 shifts · 6h" summary. */
@Composable
internal fun DayHeaderRow(header: CalendarDayHeader) {
    val c = ShiftTheme.colors
    Row(
        Modifier.fillMaxWidth().padding(start = 18.dp, end = 18.dp, top = 6.dp, bottom = 10.dp),
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(header.title, color = c.ink, fontSize = 17.sp, fontWeight = FontWeight.Bold)
            Text("· ${header.dateLabel}", color = c.ter, fontSize = 15.sp, fontWeight = FontWeight.Medium)
            if (header.closed) {
                // §3.4/§11.3 — the home house is closed this date.
                Text(
                    "Closed",
                    color = c.sec,
                    fontSize = 11.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier =
                        Modifier
                            .clip(RoundedCornerShape(50))
                            .background(c.surfaceVar)
                            .padding(horizontal = 8.dp, vertical = 2.dp)
                            .testTag("calendar_closed_chip"),
                )
            }
        }
        header.summary?.let { Text(it, style = ShiftTheme.type.monoTime.copy(fontSize = 13.sp), color = c.sec) }
    }
}

/** The live "NOW · HH:mm" agenda divider (red dot + label + rule) — today only. */
@Composable
internal fun NowLine(label: String) {
    val c = ShiftTheme.colors
    Row(
        Modifier.fillMaxWidth().padding(vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Box(Modifier.size(9.dp).clip(RoundedCornerShape(50)).background(c.danger.accent))
        Text(
            label,
            style = ShiftTheme.type.monoTime.copy(fontSize = 12.sp, fontWeight = FontWeight.SemiBold),
            color = c.danger.accent,
        )
        Box(
            Modifier
                .weight(1f)
                .height(1.5.dp)
                .clip(RoundedCornerShape(2.dp))
                .background(c.danger.accent.copy(alpha = 0.45f)),
        )
    }
}

@Composable
internal fun AgendaShiftCard(
    row: MyShiftRow,
    active: Boolean,
    past: Boolean = false,
    swap: AgendaSwapMark? = null,
    onClick: (() -> Unit)? = null,
) {
    // A drop or swap on this shift is in flight: the card stays exactly where it is and
    // says what is happening, instead of leaving the calendar before the server has
    // agreed it is gone. It also refuses a tap, so a second drop cannot be started.
    if (row.busy) {
        ShiftCard(
            state = row.state.toKitState(),
            houseInitial = row.houseInitial,
            timeLabel = row.timeLabel,
            modifier = Modifier.alpha(if (past) 0.55f else 1f).testTag("calendar_shift_card_busy"),
            houseName = row.houseName,
            destination = row.destination,
            durationLabel = row.durationLabel,
            meta = row.busyNote,
            action = { InFlightPill(row.busyLabel.orEmpty()) },
        )
        return
    }
    if (swap == null) {
        ShiftCard(
            state = row.state.toKitState(),
            houseInitial = row.houseInitial,
            timeLabel = row.timeLabel,
            // A fully-passed shift is rendered slightly inactive (greyed); future and
            // in-progress shifts stay at full strength.
            modifier = Modifier.alpha(if (past) 0.55f else 1f).testTag("calendar_shift_card"),
            houseName = row.houseName,
            destination = row.destination,
            durationLabel = row.durationLabel,
            active = active,
            onClick = onClick,
        )
        return
    }
    // A shift with a pending swap gets a distinct tinted card: orange for an INCOMING
    // request (tap to respond), brand-blue for an OUTGOING one you proposed (just a marker).
    val c = ShiftTheme.colors
    val incoming = swap.incoming
    val accent = if (incoming) c.pending else MaterialTheme.colorScheme.primary
    val tint = if (incoming) c.warnSoft else MaterialTheme.colorScheme.primary.copy(alpha = 0.10f)
    val shape = RoundedCornerShape(14.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .alpha(if (past) 0.55f else 1f)
            .clip(shape)
            .background(tint)
            .border(1.dp, accent.copy(alpha = 0.55f), shape)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .testTag("calendar_shift_card_swap"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        HouseBadge(row.houseInitial, c.surface, c.ink)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(row.timeLabel, color = c.ink, style = ShiftTheme.type.monoTime)
                DurationChip(row.durationLabel)
            }
            row.houseName?.let { Text(it, color = c.sec, fontSize = 13.5.sp, fontWeight = FontWeight.Medium) }
        }
        Row(
            Modifier.clip(RoundedCornerShape(50)).background(c.surface).padding(horizontal = 9.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Icon(
                if (incoming) ShiftIcons.Bell else ShiftIcons.Refresh,
                contentDescription = null,
                tint = accent,
                modifier = Modifier.size(13.dp),
            )
            Text(if (incoming) "Swap request" else "Swap pending", color = accent, fontSize = 11.sp, fontWeight = FontWeight.Medium)
        }
    }
}

// ===================================================================
// House tab — §11.4 home-house schedule + contact lookup (T3b).
// ===================================================================
