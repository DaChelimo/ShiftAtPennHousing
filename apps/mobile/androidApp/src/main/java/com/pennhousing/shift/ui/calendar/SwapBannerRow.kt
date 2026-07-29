package com.pennhousing.shift.ui.calendar

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
    // Same two colours the tinted agenda cards use, so the banner and the card a worker
    // taps through to read as one thing: pending-amber for "answer this", brand-blue for
    // "we are waiting on them".
    val accent = if (awaitingYou) c.pending else MaterialTheme.colorScheme.primary
    val tint = if (awaitingYou) c.warnSoft else MaterialTheme.colorScheme.primary.copy(alpha = 0.10f)
    val shape = RoundedCornerShape(14.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(tint)
            .border(1.dp, accent.copy(alpha = 0.55f), shape)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .testTag(if (awaitingYou) "swap_banner_incoming" else "swap_banner_outgoing"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(
            if (awaitingYou) ShiftIcons.Bell else ShiftIcons.Refresh,
            contentDescription = null,
            tint = accent,
            modifier = Modifier.size(16.dp),
        )
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(entry.title, color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            Text(entry.detail, color = c.sec, fontSize = 12.5.sp)
        }
        Text(
            entry.actionLabel,
            color = accent,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            modifier =
                Modifier
                    .clip(RoundedCornerShape(50))
                    .background(c.surface)
                    .padding(horizontal = 10.dp, vertical = 5.dp),
        )
    }
}
