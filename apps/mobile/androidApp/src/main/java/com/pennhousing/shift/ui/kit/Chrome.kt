package com.pennhousing.shift.ui.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.pennhousing.shift.ui.theme.Dimens
import com.pennhousing.shift.ui.theme.Elevation
import com.pennhousing.shift.ui.theme.ShiftTheme

/** The gradient avatar (worker-app.html `Avatar`) — 36dp circle, blue gradient. */
@Composable
fun Avatar(
    initial: String,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
) {
    val gradient = Brush.linearGradient(listOf(Color(0xFF2F6BFF), Color(0xFF0061FC)))
    Box(
        modifier
            .size(Dimens.avatar)
            .clip(CircleShape)
            .background(gradient)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        Text(initial.take(1).uppercase(), color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
    }
}

/** A round top-bar icon button (worker-app.html `IconBtn`) with an optional count badge. */
@Composable
fun ShiftIconButton(
    icon: ImageVector,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    contentDescription: String? = null,
    badgeCount: Int = 0,
) {
    Box(modifier) {
        Box(
            Modifier
                .size(Dimens.iconButton)
                .shadow(Elevation.level1, CircleShape)
                .clip(CircleShape)
                .background(ShiftTheme.colors.surface)
                .clickable(onClick = onClick),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = contentDescription, tint = ShiftTheme.colors.ink, modifier = Modifier.size(Dimens.iconLg))
        }
        if (badgeCount > 0) {
            CountBadge(badgeCount, Modifier.align(Alignment.TopEnd).offset(x = 3.dp, y = (-3).dp))
        }
    }
}

/**
 * The brand large-title top bar (worker-app.html `AppHeader`): optional blue
 * context eyebrow, a 30sp large title, trailing [actions] + an avatar. This is the
 * M3 top-bar idiom expressed with the design's large-title anatomy.
 */
@Composable
fun ShiftTopBar(
    title: String,
    modifier: Modifier = Modifier,
    context: String? = null,
    avatarInitial: String? = null,
    onAvatar: (() -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
) {
    val c = ShiftTheme.colors
    Column(
        modifier
            .fillMaxWidth()
            .background(c.bg)
            .padding(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Column(Modifier.weight(1f)) {
                if (context != null) {
                    Text(context, color = MaterialTheme.colorScheme.primary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                }
                Text(title, color = c.ink, fontSize = 30.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.02).em, maxLines = 1)
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                actions()
                if (avatarInitial != null) Avatar(avatarInitial, onClick = onAvatar)
            }
        }
    }
}

/** A bottom-nav destination. */
@Immutable
data class ShiftNavItem(
    val label: String,
    val icon: ImageVector,
    val badge: Int = 0,
)

/** The 4 worker destinations (My Shifts · Open · Calendar · Updates). */
val WorkerNavItems: List<ShiftNavItem> =
    listOf(
        ShiftNavItem("My Shifts", ShiftIcons.List),
        ShiftNavItem("Open", ShiftIcons.Plus),
        ShiftNavItem("Calendar", ShiftIcons.Calendar),
        ShiftNavItem("Updates", ShiftIcons.Bell),
    )

/**
 * The Material 3 [NavigationBar] (Material You active-indicator pill) carrying the
 * 4 worker tabs, tinted with the brand. The translucent `tabbar` surface mirrors
 * the design; the M3 indicator is the deliberate Android-chrome counterpart to the
 * flat iOS tab bar.
 */
@Composable
fun ShiftBottomNav(
    items: List<ShiftNavItem>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    NavigationBar(
        modifier = modifier,
        containerColor = ShiftTheme.colors.tabbar,
        tonalElevation = 0.dp,
    ) {
        items.forEachIndexed { i, item ->
            NavigationBarItem(
                selected = i == selectedIndex,
                onClick = { onSelect(i) },
                icon = {
                    BadgedBox(
                        badge = {
                            if (item.badge > 0) {
                                Badge(containerColor = ShiftTheme.colors.danger.accent, contentColor = Color.White) {
                                    Text(if (item.badge > 99) "99+" else item.badge.toString())
                                }
                            }
                        },
                    ) {
                        Icon(item.icon, contentDescription = item.label, modifier = Modifier.size(Dimens.iconNav))
                    }
                },
                label = { Text(item.label, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold, maxLines = 1) },
                colors =
                    NavigationBarItemDefaults.colors(
                        selectedIconColor = MaterialTheme.colorScheme.primary,
                        selectedTextColor = MaterialTheme.colorScheme.primary,
                        indicatorColor = MaterialTheme.colorScheme.primaryContainer,
                        unselectedIconColor = ShiftTheme.colors.ter,
                        unselectedTextColor = ShiftTheme.colors.ter,
                    ),
            )
        }
    }
}
