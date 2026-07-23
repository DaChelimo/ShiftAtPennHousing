package com.pennhousing.shift.ui.updates

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pennhousing.shift.shared.notifications.NotificationCategory
import com.pennhousing.shift.shared.notifications.NotificationRow
import com.pennhousing.shift.shared.notifications.UpdatesFeed
import com.pennhousing.shift.ui.common.PageTitle
import com.pennhousing.shift.ui.kit.EmptyState
import com.pennhousing.shift.ui.kit.SectionHeader
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.theme.ShiftTheme

/**
 * The Updates feed (worker-app.html `UpdatesScreen`): Today / Earlier groups of
 * notification rows (shared, tested [com.pennhousing.shift.shared.notifications.buildUpdatesFeed]).
 * The urgent float-assignment row carries the `pending_float_notification` selector and
 * opens the ack hero. Empty → "You're all caught up".
 *
 * T2-8 — a "Mark all read" affordance (the design's AppHeader trailing check, omitted in
 * T1-1) sits in the feed header when [hasUnread]. Tapping it fires [onMarkAllRead], which
 * optimistically clears the unread dots (and, on the live host, loops the worker's unread
 * ids through the `mark_notification_read` RPC). Hidden when nothing is unread.
 */
@Composable
internal fun UpdatesTabContent(
    feed: UpdatesFeed,
    hasUnread: Boolean,
    onOpenAck: () -> Unit,
    onMarkAllRead: () -> Unit,
    onOpenSwaps: () -> Unit = {},
    onAcknowledgeAlliedPage: (String) -> Unit = {},
) {
    Column(Modifier.fillMaxSize().background(ShiftTheme.colors.bg)) {
        PageTitle("Updates")
        if (feed.isEmpty) {
            Column(Modifier.fillMaxWidth().padding(top = 40.dp)) {
                EmptyState(
                    title = "You're all caught up",
                    icon = ShiftIcons.Bell,
                    body = "No new notifications. Float assignments and reminders show up here.",
                )
            }
        } else {
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(22.dp),
            ) {
                if (hasUnread) {
                    item { MarkAllReadHeader(onMarkAllRead) }
                }
                if (feed.today.isNotEmpty()) {
                    item {
                        NotificationGroup("Today", feed.today, onOpenAck, onOpenSwaps, onAcknowledgeAlliedPage)
                    }
                }
                if (feed.earlier.isNotEmpty()) {
                    item {
                        NotificationGroup("Earlier", feed.earlier, onOpenAck, onOpenSwaps, onAcknowledgeAlliedPage)
                    }
                }
            }
        }
    }
}

/** The Updates header trailing affordance — "Mark all read" (worker-app.html AppHeader trailing check). */
@Composable
internal fun MarkAllReadHeader(onMarkAllRead: () -> Unit) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.End,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            Modifier
                .clip(RoundedCornerShape(10.dp))
                .clickable(onClick = onMarkAllRead)
                .testTag("mark_all_read")
                .padding(horizontal = 10.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                ShiftIcons.CheckCircle,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(17.dp),
            )
            Text("Mark all read", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Medium)
        }
    }
}

@Composable
internal fun NotificationGroup(
    title: String,
    rows: List<NotificationRow>,
    onOpenAck: () -> Unit,
    onOpenSwaps: () -> Unit = {},
    onAcknowledgeAlliedPage: (String) -> Unit = {},
) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SectionHeader(title)
        rows.forEach { NotificationCard(it, onOpenAck, onOpenSwaps, onAcknowledgeAlliedPage) }
    }
}

/** One Updates row (worker-app.html `UpdateRow`). Urgent → float-tint card + left accent + "Action needed". */
@Composable
internal fun NotificationCard(
    row: NotificationRow,
    onOpenAck: () -> Unit,
    onOpenSwaps: () -> Unit = {},
    onAcknowledgeAlliedPage: (String) -> Unit = {},
) {
    val c = ShiftTheme.colors
    val (icon, accent) =
        when (row.category) {
            NotificationCategory.FLOAT -> ShiftIcons.FloatOut to c.floatOut.accent
            NotificationCategory.REMINDER -> ShiftIcons.Warning to c.pending
            NotificationCategory.SHIFT_REMOVED -> ShiftIcons.ArrowDown to c.sec
            NotificationCategory.PERMANENT -> ShiftIcons.Refresh to c.permanent.accent
            NotificationCategory.PREFERENCES -> ShiftIcons.CheckCircle to c.success.accent
            NotificationCategory.SWAP -> ShiftIcons.Refresh to c.floatIn.accent
            NotificationCategory.INFO -> ShiftIcons.Bell to c.pickupDot
            NotificationCategory.ALLIED_PAGE -> ShiftIcons.Warning to c.floatOut.accent
        }
    val shape = RoundedCornerShape(14.dp)
    var box = Modifier.fillMaxWidth().clip(shape).background(if (row.urgent) c.floatSoft else c.surface)
    box = if (row.urgent) box else box.border(1.dp, c.divider, shape)
    if (row.opensAck) box = box.clickable(onClick = onOpenAck).testTag("pending_float_notification")
    // DESIGN §6 — a swap mirror deep-links to the Swaps tab (no inline actions).
    if (row.opensSwaps) box = box.clickable(onClick = onOpenSwaps).testTag("swap_request_notification")

    Box(box) {
        if (row.urgent) {
            Box(
                Modifier
                    .align(Alignment.CenterStart)
                    .width(4.dp)
                    .fillMaxHeight()
                    .background(c.floatOut.accent),
            )
        }
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 13.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(
                Modifier.size(38.dp).clip(RoundedCornerShape(10.dp)).background(accent.copy(alpha = 0.10f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, contentDescription = null, tint = accent, modifier = Modifier.size(19.dp))
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    Text(
                        row.title,
                        modifier = Modifier.weight(1f, fill = false),
                        color = c.ink,
                        fontSize = 14.5.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                    if (row.unread) Box(Modifier.size(7.dp).clip(RoundedCornerShape(50)).background(c.pickupDot))
                }
                if (row.urgent) ActionNeededTag()
                Text(row.body, color = c.sec, fontSize = 13.sp, lineHeight = 18.sp)
                row.ackCountdownLabel?.let { countdown ->
                    // D7 — the §7 T-10m ack deadline, live at feed-load time.
                    Text(
                        countdown,
                        color = c.pending,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.testTag("float_ack_countdown"),
                    )
                }
                if (row.opensSwaps) {
                    // DESIGN §6 — the mirror points to the Swaps tab; actions live there.
                    Text(
                        "Tap to review in Swaps →",
                        color = MaterialTheme.colorScheme.primary,
                        fontSize = 12.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(top = 2.dp),
                    )
                }
                if (row.opensAlliedPage && row.alliedPageBlockId != null) {
                    // Off-hours ladder ack (staggered-rollout pilot): confirm the desk was
                    // called so the ladder stops escalating (responsible worker -> SM -> desk).
                    val blockId = row.alliedPageBlockId!!
                    Box(
                        Modifier
                            .padding(top = 6.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .background(c.floatOut.accent)
                            .clickable { onAcknowledgeAlliedPage(blockId) }
                            .testTag("allied_page_ack")
                            .padding(horizontal = 14.dp, vertical = 9.dp),
                    ) {
                        Text(
                            "I have called the desk",
                            color = c.surface,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
            }
            Text(row.timeLabel, style = ShiftTheme.type.monoId.copy(fontSize = 11.5.sp), color = c.ter)
        }
    }
}

/** The "Action needed" pill on an urgent (float) update — color + icon + text. */
@Composable
internal fun ActionNeededTag() {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .clip(RoundedCornerShape(50))
            .background(c.floatOut.badge)
            .padding(start = 6.dp, top = 3.dp, end = 8.dp, bottom = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(ShiftIcons.Warning, contentDescription = null, tint = c.floatOut.deep, modifier = Modifier.size(13.dp))
        Text("Action needed", color = c.floatOut.deep, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    }
}

// ===================================================================
// Swaps tab (DESIGN docs/swaps-enhancement/DESIGN.md §6) — a dedicated Incoming /
// Outgoing review surface. Incoming offers Accept (temporary) / Decline; Outgoing
// offers Cancel and groups co-created legs (decision 2026-06-15: independent legs).
// ===================================================================
