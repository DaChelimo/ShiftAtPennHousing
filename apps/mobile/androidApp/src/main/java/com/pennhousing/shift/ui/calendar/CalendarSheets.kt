package com.pennhousing.shift.ui.calendar

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import com.pennhousing.shift.shared.swaps.PendingSwapNotice
import com.pennhousing.shift.shared.swaps.SwapDecision
import com.pennhousing.shift.ui.house.durationLabel
import com.pennhousing.shift.ui.kit.ButtonVariant
import com.pennhousing.shift.ui.kit.DurationChip
import com.pennhousing.shift.ui.kit.ShiftBottomSheet
import com.pennhousing.shift.ui.kit.ShiftButton
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.swaps.SwapHouseLine
import com.pennhousing.shift.ui.theme.ShiftTheme

/**
 * The accept/decline popup for an INCOMING swap, opened by tapping a flagged My-Shifts
 * card. Shows what you give ⇄ what you get (a one-sided hand-off shows only its real
 * half), plus the type and deadline. Reuses the give ⇄ take "deal" layout shape.
 */
@Composable
internal fun SwapDecisionSheet(
    decision: SwapDecision,
    onAccept: () -> Unit,
    onDecline: () -> Unit,
    onDismiss: () -> Unit,
) {
    val c = ShiftTheme.colors
    val primary = MaterialTheme.colorScheme.primary
    ShiftBottomSheet(onDismiss = onDismiss, title = decision.title) {
        Column(
            Modifier.fillMaxWidth().testTag("swap_decision_sheet"),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(decision.intro, color = c.ink, fontSize = 14.sp, modifier = Modifier.weight(1f))
                Text(
                    decision.typeLabel,
                    color = primary,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier
                        .clip(
                            RoundedCornerShape(50),
                        ).background(primary.copy(alpha = 0.12f))
                        .padding(horizontal = 8.dp, vertical = 3.dp),
                )
            }
            Text(decision.respondBy, color = c.sec, fontSize = 12.5.sp)

            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).border(BorderStroke(1.dp, c.divider), RoundedCornerShape(12.dp)),
            ) {
                decision.giveLabel?.let { give ->
                    Column(
                        Modifier.fillMaxWidth().background(c.surfaceVar).padding(horizontal = 14.dp, vertical = 10.dp),
                        verticalArrangement = Arrangement.spacedBy(3.dp),
                    ) {
                        Text("YOU GIVE", color = c.sec, fontSize = 11.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.5.sp)
                        Text(give, color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                        SwapHouseLine(decision.giveHouse, c.sec)
                    }
                }
                decision.getLabel?.let { get ->
                    if (decision.giveLabel != null) Box(Modifier.fillMaxWidth().height(1.dp).background(c.divider))
                    Column(
                        Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp),
                        verticalArrangement = Arrangement.spacedBy(3.dp),
                    ) {
                        Text("YOU GET", color = c.sec, fontSize = 11.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.5.sp)
                        Text(get, color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                        // Where you'd actually work if you accept — the float destination, when floated.
                        SwapHouseLine(decision.getHouse, primary)
                    }
                }
            }
            decision.note?.let { Text(it, color = c.ter, fontSize = 12.5.sp) }

            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                ShiftButton(
                    "Accept",
                    onClick = onAccept,
                    modifier = Modifier.weight(1f).testTag("swap_decision_accept"),
                    fullWidth = true,
                )
                ShiftButton(
                    "Decline",
                    onClick = onDecline,
                    modifier = Modifier.weight(1f).testTag("swap_decision_decline"),
                    variant = ButtonVariant.Outlined,
                    fullWidth = true,
                )
            }
        }
    }
}

/**
 * The "swap pending" notice for a tapped OUTGOING-swap card — shown instead of the drop
 * sheet, since the shift is tied up in a swap the worker proposed (dropping/swapping it
 * would fail server-side with a generic error). Shows the shift clearly (day · date,
 * start-end, duration), explains the wait, and offers Cancel swap / Keep waiting. The
 * corner ✕ (from [ShiftBottomSheet]'s header) and "Keep waiting" both just minimise it.
 */
@Composable
internal fun PendingSwapNoticeSheet(
    notice: PendingSwapNotice,
    onCancelSwap: () -> Unit,
    onDismiss: () -> Unit,
) {
    val c = ShiftTheme.colors
    val accent = MaterialTheme.colorScheme.primary
    ShiftBottomSheet(onDismiss = onDismiss, title = notice.title) {
        Column(
            Modifier.fillMaxWidth().testTag("pending_swap_notice_sheet"),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // The shift itself — day · date on top, the start-end time big, duration chip.
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(accent.copy(alpha = 0.08f))
                    .border(BorderStroke(1.dp, accent.copy(alpha = 0.30f)), RoundedCornerShape(12.dp))
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(notice.dayLabel, color = c.ink, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(notice.timeLabel, color = c.ink, style = ShiftTheme.type.monoTime)
                    DurationChip(notice.durationLabel)
                }
                SwapHouseLine(notice.houseName, accent)
                Row(
                    Modifier
                        .clip(RoundedCornerShape(50))
                        .background(accent.copy(alpha = 0.14f))
                        .padding(horizontal = 8.dp, vertical = 3.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Icon(ShiftIcons.Refresh, contentDescription = null, tint = accent, modifier = Modifier.size(12.dp))
                    Text(notice.typeLabel, color = accent, fontSize = 11.sp, fontWeight = FontWeight.Medium)
                }
            }
            Text(notice.body, color = c.ink, fontSize = 14.sp)
            Text(notice.waitingOn, color = c.sec, fontSize = 12.5.sp)

            ShiftButton(
                notice.keepWaitingLabel,
                onClick = onDismiss,
                modifier = Modifier.fillMaxWidth().testTag("pending_swap_keep_waiting"),
                fullWidth = true,
            )
            ShiftButton(
                notice.cancelLabel,
                onClick = onCancelSwap,
                modifier = Modifier.fillMaxWidth().testTag("pending_swap_cancel"),
                variant = ButtonVariant.Outlined,
                fullWidth = true,
            )
        }
    }
}
