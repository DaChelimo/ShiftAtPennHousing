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
import com.pennhousing.shift.ui.TAB_HOUSE
import com.pennhousing.shift.ui.TAB_MY
import com.pennhousing.shift.ui.TAB_OPEN
import com.pennhousing.shift.ui.TAB_SETTINGS
import com.pennhousing.shift.ui.TAB_SWAPS
import com.pennhousing.shift.ui.TAB_UPDATES
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.onboarding.onboardingAnchor
import com.pennhousing.shift.ui.theme.ShiftTheme

/**
 * The Material 3 bottom navigation bar (BEHAVIORAL_SPECIFICATION §5.6). Four frequent
 * destinations — My Shifts, Open, House, Swaps — plus a "More" item that opens the
 * overflow sheet for the rest (Updates, Preferences, Break shifts, Settings). The unread
 * dot rides on "More" since Updates now lives inside it. Selectors: `tab_my_shifts` /
 * `tab_open_shifts` / `tab_house` / `tab_swaps`, plus `tab_more`.
 */
@Composable
internal fun ShiftBottomNav(
    selectedIndex: Int,
    hasUnread: Boolean,
    onSelect: (Int) -> Unit,
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
        NavigationBarItem(
            selected = selectedIndex == TAB_MY,
            onClick = { onSelect(TAB_MY) },
            icon = { Icon(ShiftIcons.Calendar, contentDescription = null) },
            label = { Text("My Shifts", maxLines = 1) },
            colors = colors,
            modifier = Modifier.testTag("tab_my_shifts").onboardingAnchor(OnboardingTarget.MY_SHIFTS_TAB),
        )
        NavigationBarItem(
            selected = selectedIndex == TAB_OPEN,
            onClick = { onSelect(TAB_OPEN) },
            icon = { Icon(ShiftIcons.Plus, contentDescription = null) },
            label = { Text("Open", maxLines = 1) },
            colors = colors,
            modifier = Modifier.testTag("tab_open_shifts").onboardingAnchor(OnboardingTarget.OPEN_TAB),
        )
        NavigationBarItem(
            selected = selectedIndex == TAB_HOUSE,
            onClick = { onSelect(TAB_HOUSE) },
            icon = { Icon(ShiftIcons.Building, contentDescription = null) },
            label = { Text("House", maxLines = 1) },
            colors = colors,
            modifier = Modifier.testTag("tab_house").onboardingAnchor(OnboardingTarget.HOUSE_TAB),
        )
        NavigationBarItem(
            selected = selectedIndex == TAB_SWAPS,
            onClick = { onSelect(TAB_SWAPS) },
            icon = { Icon(ShiftIcons.Refresh, contentDescription = null) },
            label = { Text("Swaps", maxLines = 1) },
            colors = colors,
            modifier = Modifier.testTag("tab_swaps").onboardingAnchor(OnboardingTarget.SWAPS_TAB),
        )
        NavigationBarItem(
            // Secondary destinations now in "More": Updates, Preferences, Break, Settings.
            selected = selectedIndex in TAB_UPDATES..TAB_SETTINGS,
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
