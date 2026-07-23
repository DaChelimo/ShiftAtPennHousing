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
import com.pennhousing.shift.shared.onboarding.OnboardingTarget
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.onboarding.onboardingAnchor
import com.pennhousing.shift.ui.theme.ShiftTheme

/** A bottom-bar item: which destination it selects and how it is labelled and found. */
private data class BarItem(
    val destination: ShiftDestination,
    val icon: ImageVector,
    val label: String,
    val tag: String,
    val anchor: OnboardingTarget,
)

private val BAR_ITEMS =
    listOf(
        BarItem(ShiftDestination.MyShifts, ShiftIcons.Calendar, "My Shifts", "tab_my_shifts", OnboardingTarget.MY_SHIFTS_TAB),
        BarItem(ShiftDestination.OpenShifts, ShiftIcons.Plus, "Open", "tab_open_shifts", OnboardingTarget.OPEN_TAB),
        BarItem(ShiftDestination.House, ShiftIcons.Building, "House", "tab_house", OnboardingTarget.HOUSE_TAB),
        BarItem(ShiftDestination.Swaps, ShiftIcons.Refresh, "Swaps", "tab_swaps", OnboardingTarget.SWAPS_TAB),
    )

/**
 * The Material 3 bottom navigation bar (BEHAVIORAL_SPECIFICATION §5.6). Four frequent
 * destinations — My Shifts, Open, House, Swaps — plus a "More" item that opens the
 * overflow sheet for the rest (Updates, Preferences, Break shifts, Settings). The unread
 * dot rides on "More" since Updates now lives inside it. Selectors: `tab_my_shifts` /
 * `tab_open_shifts` / `tab_house` / `tab_swaps`, plus `tab_more`.
 */
@Composable
internal fun ShiftBottomNav(
    current: ShiftDestination,
    hasUnread: Boolean,
    onSelect: (ShiftDestination) -> Unit,
    onMore: () -> Unit,
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
        BAR_ITEMS.forEach { item ->
            NavigationBarItem(
                selected = current == item.destination,
                onClick = { onSelect(item.destination) },
                icon = { Icon(item.icon, contentDescription = null) },
                label = { Text(item.label, maxLines = 1) },
                colors = colors,
                modifier = Modifier.testTag(item.tag).onboardingAnchor(item.anchor),
            )
        }
        NavigationBarItem(
            // Lit for the episodic destinations that live behind the sheet. Assistant is
            // reachable from the sheet but deliberately does not light this up.
            selected = current in ShiftDestination.MORE_SELECTS,
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
            modifier = Modifier.testTag("tab_more").onboardingAnchor(OnboardingTarget.MORE_TAB),
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
