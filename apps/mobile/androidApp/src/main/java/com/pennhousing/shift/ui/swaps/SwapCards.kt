package com.pennhousing.shift.ui.swaps

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pennhousing.shift.shared.swaps.SwapRow
import com.pennhousing.shift.ui.kit.ButtonVariant
import com.pennhousing.shift.ui.kit.HouseBadge
import com.pennhousing.shift.ui.kit.ShiftButton
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.theme.ShiftTheme

@Composable
internal fun IncomingSwapCard(
    row: SwapRow,
    onAcceptSwap: (String) -> Unit,
    onRejectSwap: (String) -> Unit,
) {
    // Incoming cards carry a left accent stripe so they pop out in the merged All list.
    SwapCardFrame(leftAccent = MaterialTheme.colorScheme.primary) {
        SwapCardHeader(row)
        SwapExchangeRow(row)
        SwapDeadlineRow(row)
        Row(Modifier.fillMaxWidth().padding(top = 2.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ShiftButton(
                "Accept",
                onClick = { onAcceptSwap(row.swapId) },
                modifier = Modifier.weight(1f).testTag("swap_accept_button"),
                fullWidth = true,
            )
            ShiftButton(
                "Decline",
                onClick = { onRejectSwap(row.swapId) },
                modifier = Modifier.weight(1f).testTag("swap_reject_button"),
                variant = ButtonVariant.Outlined,
                fullWidth = true,
            )
        }
    }
}

@Composable
internal fun OutgoingSwapCard(
    row: SwapRow,
    onVoidSwap: (String) -> Unit,
) {
    SwapCardFrame {
        SwapCardHeader(row)
        SwapExchangeRow(row)
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            SwapDeadlineRow(row, Modifier.weight(1f))
            Text(
                "Cancel",
                color = ShiftTheme.colors.danger.accent,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
                modifier =
                    Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .clickable { onVoidSwap(row.swapId) }
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                        .testTag("swap_void_button"),
            )
        }
    }
}

/**
 * Counterparty avatar + name + who-acts-next label ("Needs your response" / "Waiting on
 * Ben") + a small type chip. The label is accented for incoming (you act), muted for outgoing.
 */
@Composable
internal fun SwapCardHeader(row: SwapRow) {
    val c = ShiftTheme.colors
    val primary = MaterialTheme.colorScheme.primary
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        HouseBadge(row.counterpartyName.take(1), c.surfaceVar, c.ink)
        Column(Modifier.weight(1f)) {
            Text(row.counterpartyName, color = c.ink, fontSize = 15.sp, fontWeight = FontWeight.Medium)
            Text(row.directionLabel, color = if (row.incoming) primary else c.sec, fontSize = 11.5.sp, fontWeight = FontWeight.Medium)
        }
        Text(
            row.typeLabel,
            color = c.sec,
            fontSize = 11.sp,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.clip(RoundedCornerShape(50)).background(c.surfaceVar).padding(horizontal = 9.dp, vertical = 3.dp),
        )
    }
}

/** The give ⇄ get block — the decision-critical hours, side by side. */
@Composable
internal fun SwapExchangeRow(row: SwapRow) {
    // A one-directional transfer isn't a swap — drop the give/get split and lead with a single
    // full-width panel that reads "someone wants to give you these hours" / "you're offering …".
    if (row.isOneWayTransfer) {
        SwapTransferPanel(row)
        return
    }
    val c = ShiftTheme.colors
    val primary = MaterialTheme.colorScheme.primary
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        SwapSideBox("You give", row.give, c.surfaceVar, c.sec, Modifier.weight(1f))
        Text("⇄", color = c.sec, fontSize = 16.sp)
        SwapSideBox("You get", row.get, primary.copy(alpha = 0.08f), primary, Modifier.weight(1f))
    }
}

/**
 * The one-directional transfer panel — a single full-width blue block. Leads with the
 * receive/offer headline (never "give nothing / get this"), then the shift's hero time +
 * day + house. Replaces the two-box exchange when nothing is given in return.
 */
@Composable
internal fun SwapTransferPanel(row: SwapRow) {
    val c = ShiftTheme.colors
    val primary = MaterialTheme.colorScheme.primary
    val side = row.transferSide
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(primary.copy(alpha = 0.08f))
            .padding(horizontal = 13.dp, vertical = 11.dp)
            .testTag("swap_transfer_panel"),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                row.transferHeadline,
                color = primary,
                fontSize = 12.5.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f),
            )
            if (side != null) {
                Text(side.hours, color = primary, fontSize = 12.5.sp, fontWeight = FontWeight.Medium)
            }
        }
        // The time slot is the hero; fall back to the hours when the time isn't resolved yet.
        Text(side?.timeRange ?: side?.hours ?: "-", color = c.ink, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
        val day = side?.dayLabel
        if (day != null) {
            Text(day, color = c.ink, fontSize = 13.sp, fontWeight = FontWeight.Medium)
        }
        SwapHouseLine(side?.houseName, primary)
    }
}

/** One side of the exchange — the TIME RANGE as the hero, the day beneath, hours a tiny chip. */
@Composable
internal fun SwapSideBox(
    label: String,
    side: com.pennhousing.shift.shared.swaps.SwapSide?,
    bg: androidx.compose.ui.graphics.Color,
    accent: androidx.compose.ui.graphics.Color,
    modifier: Modifier = Modifier,
) {
    val c = ShiftTheme.colors
    Column(
        modifier.clip(RoundedCornerShape(10.dp)).background(bg).padding(horizontal = 11.dp, vertical = 9.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(label.uppercase(), color = accent, fontSize = 10.5.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.4.sp)
            if (side?.timeRange != null) {
                Text(" · ${side.hours}", color = c.ter, fontSize = 10.5.sp, fontWeight = FontWeight.Medium)
            }
        }
        // The time slot is the hero; fall back to hours when the time isn't known yet.
        Text(side?.timeRange ?: side?.hours ?: "-", color = c.ink, fontSize = 17.sp, fontWeight = FontWeight.Medium)
        // The date is decision-critical too — render it as prominently as the house, not squint-small.
        Text(side?.dayLabel ?: if (side == null) "Nothing back" else "", color = c.ink, fontSize = 13.sp, fontWeight = FontWeight.Medium)
        // The house this side is actually worked at (the float destination, if floated) — the
        // acceptor must see it before saying yes; an absent name (older row) just omits the line.
        SwapHouseLine(side?.houseName, accent)
    }
}

/**
 * The desk a swap side is worked at — a building glyph + the house name. Decision-critical
 * (the float destination, not the home house), so it's drawn in the side's accent colour.
 * Renders nothing when the house is unknown (an older read-model row without the column).
 */
@Composable
internal fun SwapHouseLine(
    houseName: String?,
    accent: androidx.compose.ui.graphics.Color,
) {
    if (houseName == null) return
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Icon(ShiftIcons.Building, contentDescription = null, tint = accent, modifier = Modifier.size(13.dp))
        Text(houseName, color = accent, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold)
    }
}

/** Clock + humanized countdown to expiry — tinted orange when the deadline is near. */
@Composable
internal fun SwapDeadlineRow(
    row: SwapRow,
    modifier: Modifier = Modifier,
) {
    val c = ShiftTheme.colors
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Icon(
            ShiftIcons.Clock,
            contentDescription = null,
            tint = if (row.deadlineUrgent) c.pending else c.sec,
            modifier = Modifier.size(15.dp),
        )
        Text(
            row.deadline,
            color = if (row.deadlineUrgent) c.pending else c.sec,
            fontSize = 13.sp,
            fontWeight = if (row.deadlineUrgent) FontWeight.Medium else FontWeight.Normal,
        )
    }
}

/** The shared card frame for a Swaps-tab row; [leftAccent] draws a left stripe (incoming). */
@Composable
internal fun SwapCardFrame(
    leftAccent: androidx.compose.ui.graphics.Color? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val c = ShiftTheme.colors
    val shape = RoundedCornerShape(14.dp)
    Box(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(c.surface)
            .border(1.dp, c.divider, shape)
            .testTag("swap_request_row"),
    ) {
        if (leftAccent != null) {
            Box(
                Modifier
                    .align(Alignment.CenterStart)
                    .width(3.dp)
                    .fillMaxHeight()
                    .background(leftAccent),
            )
        }
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 13.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            content = content,
        )
    }
}

// ===================================================================
// Calendar tab — agenda-first Personal Calendar (current week only).
// ===================================================================
