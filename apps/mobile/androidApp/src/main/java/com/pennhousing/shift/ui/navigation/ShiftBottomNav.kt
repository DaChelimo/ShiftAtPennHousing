package com.pennhousing.shift.ui.navigation

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.theme.ShiftTheme

/** A bottom-bar item: which destination it selects and how it is labelled and found. */
private data class BarItem(
    val destination: ShiftDestination,
    val icon: ImageVector,
    val label: String,
    val tag: String,
)

/**
 * Every bar item this app can render, keyed by destination. The BAR ORDER comes from the
 * caller's list (see `ShiftDestination.bottomBarFor`), not from this map, so a role's bar can
 * be reordered without touching the presentation.
 */
private val BAR_ITEMS =
    mapOf<ShiftDestination, BarItem>(
        ShiftDestination.MyShifts to
            BarItem(ShiftDestination.MyShifts, ShiftIcons.Calendar, "My Shifts", "tab_my_shifts"),
        ShiftDestination.OpenShifts to
            BarItem(ShiftDestination.OpenShifts, ShiftIcons.Plus, "Open", "tab_open_shifts"),
        ShiftDestination.House to
            BarItem(ShiftDestination.House, ShiftIcons.Building, "House", "tab_house"),
        ShiftDestination.Swaps to
            BarItem(ShiftDestination.Swaps, ShiftIcons.Refresh, "Swaps", "tab_swaps"),
        ShiftDestination.Coverage to
            BarItem(ShiftDestination.Coverage, ShiftIcons.Warning, "Coverage", "tab_coverage"),
        ShiftDestination.Hours to
            BarItem(ShiftDestination.Hours, ShiftIcons.Clock, "Hours", "tab_hours"),
    )

/**
 * The Material 3 bottom navigation bar (BEHAVIORAL_SPECIFICATION §5.6; manager variants in
 * docs/manager-app/SPEC.md §6).
 *
 * Four destinations plus a "More" item that opens the overflow sheet for the rest. WHICH four
 * depends on the signed-in user's role, which is why [bar] is a parameter rather than a
 * constant: a worker gets My Shifts / Open / House / Swaps, a manager gets Coverage / House /
 * Open / My Shifts. The unread dot rides on "More" since Updates lives inside it.
 *
 * [coverageBadgeCount] is the count of Allied coverage requests still needing a human. It
 * renders as a NUMBERED badge on the Coverage item rather than a plain dot, because "three
 * desks are about to be empty" is a materially different message from "something happened",
 * and it is the one number in this app a manager must be able to read at a glance.
 *
 * Selectors: `tab_my_shifts` / `tab_open_shifts` / `tab_house` / `tab_swaps` / `tab_coverage`
 * / `tab_hours`, plus `tab_more`.
 */
@Composable
internal fun ShiftBottomNav(
    current: ShiftDestination,
    hasUnread: Boolean,
    onSelect: (ShiftDestination) -> Unit,
    onMore: () -> Unit,
    bar: List<ShiftDestination> = ShiftDestination.BOTTOM_BAR,
    coverageBadgeCount: Int = 0,
) {
    val c = ShiftTheme.colors
    val colors =
        NavigationBarItemDefaults.colors(
            selectedIconColor = MaterialTheme.colorScheme.primary,
            selectedTextColor = MaterialTheme.colorScheme.primary,
            indicatorColor = MaterialTheme.colorScheme.primaryContainer,
            unselectedIconColor = c.sec,
            unselectedTextColor = c.ter,
        )
    NavigationBar(containerColor = c.surface, tonalElevation = 0.dp) {
        bar.mapNotNull { BAR_ITEMS[it] }.forEach { item ->
            val badge = if (item.destination == ShiftDestination.Coverage) coverageBadgeCount else 0
            NavigationBarItem(
                selected = current == item.destination,
                onClick = { onSelect(item.destination) },
                icon = {
                    if (badge > 0) {
                        BadgedBox(badge = { Badge { Text(badge.toString()) } }) {
                            Icon(item.icon, contentDescription = null)
                        }
                    } else {
                        Icon(item.icon, contentDescription = null)
                    }
                },
                label = { Text(item.label, maxLines = 1) },
                colors = colors,
                modifier = Modifier.testTag(item.tag),
            )
        }
        NavigationBarItem(
            // Lit for the episodic destinations that live behind the sheet, minus anything
            // this role's bar already carries (or two items would light at once).
            selected = current in ShiftDestination.moreSelects(bar),
            onClick = onMore,
            icon = {
                if (hasUnread) {
                    BadgedBox(badge = { Badge() }) { Icon(ShiftIcons.MoreHorizontal, contentDescription = null) }
                } else {
                    Icon(ShiftIcons.MoreHorizontal, contentDescription = null)
                }
            },
            label = { Text("More", maxLines = 1) },
            colors = colors,
            modifier = Modifier.testTag("tab_more"),
        )
    }
}

/** One row in the "More" overflow sheet — icon tile + title + chevron. */
@Composable
internal fun MoreNavRow(
    title: String,
    icon: ImageVector,
    tag: String,
    onClick: () -> Unit,
) {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .testTag(tag)
            .padding(horizontal = 6.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(38.dp).clip(RoundedCornerShape(10.dp)).background(c.surfaceVar),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = c.sec, modifier = Modifier.size(20.dp))
        }
        Text(title, color = c.ink, fontSize = 15.5.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
        Icon(ShiftIcons.ChevronRight, contentDescription = null, tint = c.ter, modifier = Modifier.size(18.dp))
    }
}
