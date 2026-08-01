package com.pennhousing.shift.ui.calendar

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pennhousing.shift.shared.swaps.SwapBanner
import com.pennhousing.shift.shared.swaps.SwapBannerEntry
import com.pennhousing.shift.shared.swaps.SwapBannerTone
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.theme.ShiftTheme

/**
 * The always-visible pending-swap banner at the top of My Shifts (BSpec §10.1).
 *
 * A pending swap used to be visible ONLY as a tint on the affected shift card, which
 * meant a request needing an answer could sit on a day the worker never scrolled to. Both
 * directions now surface here, above the week, whatever week is being viewed:
 * "someone is waiting on you" (actionable, first) and "you are waiting on someone".
 *
 * Tapping a row opens the same surface the tinted card does: the accept/decline decision
 * for an incoming swap, the cancel-or-keep-waiting notice for an outgoing one.
 */
@Composable
internal fun SwapBannerColumn(
    banner: SwapBanner,
    onIncoming: (String) -> Unit,
    onOutgoing: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (banner.isEmpty) return
    Column(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .testTag("swap_banner"),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        banner.entries.forEach { entry ->
            SwapBannerCard(
                entry = entry,
                onClick = {
                    if (entry.tone == SwapBannerTone.AWAITING_YOU) onIncoming(entry.swapId) else onOutgoing(entry.swapId)
                },
            )
        }
    }
}

@Composable
private fun SwapBannerCard(
    entry: SwapBannerEntry,
    onClick: () -> Unit,
) {
    val c = ShiftTheme.colors
    val awaitingYou = entry.tone == SwapBannerTone.AWAITING_YOU
    // Only the actionable row (someone needs YOUR answer) carries a color signal, in
    // brand blue — the app's one "take action" hue everywhere else (never orange/amber,
    // which reads as a caution state elsewhere in the shift-state legend). The outgoing
    // row is purely informational, so it stays fully neutral instead of borrowing a
    // second accent — that contrast in weight is what tells the two rows apart, not a
    // second color.
    //
    // Both rows share the same swap (exchange-arrows) icon, so the glyph reads as "this
    // is a swap" rather than "this is a notification" (a bell implies something else).
    val shape = RoundedCornerShape(14.dp)
    val borderColor = if (awaitingYou) MaterialTheme.colorScheme.primary.copy(alpha = 0.45f) else c.divider
    val chipBg = if (awaitingYou) MaterialTheme.colorScheme.primary.copy(alpha = 0.14f) else c.surfaceVar
    val iconTint = if (awaitingYou) MaterialTheme.colorScheme.primary else c.ter
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(c.surface)
            .border(1.dp, borderColor, shape)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .testTag(if (awaitingYou) "swap_banner_incoming" else "swap_banner_outgoing"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            Modifier
                .size(30.dp)
                .clip(RoundedCornerShape(9.dp))
                .background(chipBg),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                ShiftIcons.Refresh,
                contentDescription = null,
                tint = iconTint,
                modifier = Modifier.size(16.dp),
            )
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(entry.title, color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            Text(entry.detail, color = c.sec, fontSize = 12.5.sp)
        }
        // Incoming needs an answer, so its action is a solid blue pill. Outgoing is
        // informational and gets a quiet neutral outline: the weight of the control tells
        // the worker which of the two rows is actually theirs to act on.
        Text(
            entry.actionLabel,
            color = if (awaitingYou) Color.White else c.sec,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            modifier =
                Modifier
                    .clip(RoundedCornerShape(50))
                    .then(
                        if (awaitingYou) {
                            Modifier.background(MaterialTheme.colorScheme.primary)
                        } else {
                            Modifier.border(1.dp, c.outline, RoundedCornerShape(50))
                        },
                    ).padding(horizontal = if (awaitingYou) 12.dp else 11.dp, vertical = 5.dp),
        )
    }
}
