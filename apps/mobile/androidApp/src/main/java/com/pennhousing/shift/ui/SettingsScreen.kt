package com.pennhousing.shift.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pennhousing.shift.shared.settings.NotificationChannel
import com.pennhousing.shift.shared.settings.NotificationRowModel
import com.pennhousing.shift.shared.settings.SettingsProfile
import com.pennhousing.shift.shared.settings.THEME_CHOICES
import com.pennhousing.shift.shared.settings.label
import com.pennhousing.shift.shared.viewmodel.SettingsViewModel
import com.pennhousing.shift.ui.kit.SegmentedControl
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.kit.ShiftSwitch
import com.pennhousing.shift.ui.theme.ShiftTheme
import com.pennhousing.shift.ui.theme.ThemePrefs

/**
 * Settings / Profile — Compose UI over the shared [SettingsViewModel]. Rebuilds
 * worker-app.html `SettingsScreen`: the profile card, the Notifications group (only
 * "General updates" / broadcast is user-toggleable), the Appearance theme segmented
 * control, the read-only Hours & limits, and the Account group (Sign out → [onSignOut]).
 * Selector ids match `apps/mobile/maestro/README.md`.
 */
@Composable
fun SettingsTabContent(
    vm: SettingsViewModel,
    onSignOut: () -> Unit,
    // Live host PATCHes `users-broadcast-subscription` with the NEW desired state; demo
    // defaults to no live write (the VM still flips its optimistic local toggle).
    onToggleBroadcast: (Boolean) -> Unit = {},
) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    val c = ShiftTheme.colors
    val context = LocalContext.current

    LazyColumn(
        Modifier.fillMaxSize().background(c.bg).testTag("settings_screen"),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(22.dp),
    ) {
        item { ProfileCard(state.profile) }

        item {
            SettingsGroup("Notifications") {
                state.notifications.forEachIndexed { i, row ->
                    NotificationSettingRow(
                        row,
                        last = i == state.notifications.lastIndex,
                        onToggle = {
                            // Only GENERAL_UPDATES is interactive (the row's `enabled` flag
                            // gates the switch). Flip the optimistic local state, then PATCH
                            // the EF with the resulting (synchronous) subscription value.
                            vm.toggleBroadcast()
                            val subscribed =
                                vm.uiState.value.notifications
                                    .first { it.channel == NotificationChannel.GENERAL_UPDATES }
                                    .on
                            onToggleBroadcast(subscribed)
                        },
                    )
                }
            }
        }

        item {
            SettingsGroup("Appearance") {
                Column(Modifier.padding(horizontal = 14.dp, vertical = 12.dp)) {
                    Text(
                        "Theme",
                        color = c.ink,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Medium,
                        modifier = Modifier.padding(bottom = 10.dp),
                    )
                    SegmentedControl(
                        options = THEME_CHOICES.map { it.label() },
                        selectedIndex = THEME_CHOICES.indexOf(state.theme),
                        onSelect = {
                            val choice = THEME_CHOICES[it]
                            // Re-theme live (VM drives ShiftTheme) and persist so the choice
                            // survives relaunch and seeds the next launch's login chrome.
                            vm.setTheme(choice)
                            ThemePrefs.write(context, choice)
                        },
                        modifier = Modifier.testTag("settings_theme_segmented"),
                    )
                }
            }
        }

        item {
            SettingsGroup("Hours & limits") {
                SettingsRow(icon = ShiftIcons.Tune, tint = MaterialTheme.colorScheme.primary, title = "Weekly soft cap") {
                    CapValue(state.hours.softCapLabel)
                }
                SettingsRow(icon = ShiftIcons.Ban, tint = c.danger.accent, title = "Break-period hard cap", last = true) {
                    CapValue(state.hours.hardCapLabel)
                }
            }
        }

        item {
            SettingsGroup("Account") {
                SettingsRow(
                    icon = ShiftIcons.Person,
                    tint = MaterialTheme.colorScheme.primary,
                    title = "PennKey & security",
                    onClick = {},
                ) {
                    Icon(ShiftIcons.ChevronRight, contentDescription = null, tint = c.outline, modifier = Modifier.size(17.dp))
                }
                SettingsRow(icon = ShiftIcons.Info, tint = c.ter, title = "Help & policy", onClick = {}) {
                    Icon(ShiftIcons.ChevronRight, contentDescription = null, tint = c.outline, modifier = Modifier.size(17.dp))
                }
                SettingsRow(
                    icon = ShiftIcons.Logout,
                    tint = c.danger.accent,
                    title = "Sign out",
                    titleColor = c.danger.accent,
                    last = true,
                    onClick = onSignOut,
                    modifier = Modifier.testTag("settings_sign_out"),
                )
            }
        }

        item {
            Text(
                "Shift@PennHousing · v${state.appVersion}",
                modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                color = c.ter,
                style = ShiftTheme.type.monoId.copy(fontSize = 11.5.sp),
                fontWeight = FontWeight.Normal,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        }
    }
}

@Composable
private fun ProfileCard(profile: SettingsProfile) {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(c.surface)
            .border(1.dp, c.divider, RoundedCornerShape(16.dp))
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(
            Modifier.size(52.dp).clip(CircleShape).background(Brush.linearGradient(listOf(Color(0xFF2F6BFF), Color(0xFF0061FC)))),
            contentAlignment = Alignment.Center,
        ) {
            Text(profile.initial, color = Color.White, fontSize = 21.sp, fontWeight = FontWeight.SemiBold)
        }
        Column(Modifier.weight(1f)) {
            Text(profile.name, color = c.ink, fontSize = 17.sp, fontWeight = FontWeight.Bold)
            Text(profile.subtitle, color = c.sec, fontSize = 13.sp, modifier = Modifier.padding(top = 1.dp))
        }
        Icon(ShiftIcons.ChevronRight, contentDescription = null, tint = c.outline, modifier = Modifier.size(18.dp))
    }
}

/** A rounded surface card with an uppercase group title (worker-app.html `Group`). */
@Composable
private fun SettingsGroup(
    title: String,
    content: @Composable () -> Unit,
) {
    val c = ShiftTheme.colors
    Column {
        Text(
            title.uppercase(),
            color = c.sec,
            fontSize = 12.5.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 0.05.em,
            modifier = Modifier.padding(start = 6.dp, bottom = 8.dp),
        )
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(c.surface)
                .border(1.dp, c.divider, RoundedCornerShape(16.dp)),
        ) {
            content()
        }
    }
}

/** One settings row (worker-app.html `SettingsRow`): a tinted icon tile + title (+ sub) + trailing. */
@Composable
private fun SettingsRow(
    icon: ImageVector,
    tint: Color,
    title: String,
    modifier: Modifier = Modifier,
    sub: String? = null,
    last: Boolean = false,
    titleColor: Color? = null,
    onClick: (() -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    val c = ShiftTheme.colors
    Column(modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(13.dp),
        ) {
            Box(
                Modifier.size(30.dp).clip(RoundedCornerShape(8.dp)).background(tint.copy(alpha = 0.14f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(17.dp))
            }
            Column(Modifier.weight(1f)) {
                Text(title, color = titleColor ?: c.ink, fontSize = 15.sp, fontWeight = FontWeight.Medium)
                if (sub != null) Text(sub, color = c.ter, fontSize = 12.5.sp, modifier = Modifier.padding(top = 1.dp))
            }
            trailing?.invoke()
        }
        if (!last) {
            Box(Modifier.fillMaxWidth().padding(start = 57.dp).height(1.dp).background(c.divider))
        }
    }
}

@Composable
private fun NotificationSettingRow(
    row: NotificationRowModel,
    last: Boolean,
    onToggle: () -> Unit,
) {
    val c = ShiftTheme.colors
    val (icon, tint) = notificationVisual(row.channel)
    SettingsRow(icon = icon, tint = tint, title = row.title, sub = row.sub, last = last) {
        ShiftSwitch(
            checked = row.on,
            onCheckedChange = { onToggle() },
            enabled = row.interactive,
            modifier = if (row.channel == NotificationChannel.GENERAL_UPDATES) Modifier.testTag("settings_broadcast_toggle") else Modifier,
        )
    }
}

@Composable
private fun notificationVisual(channel: NotificationChannel): Pair<ImageVector, Color> {
    val c = ShiftTheme.colors
    return when (channel) {
        NotificationChannel.FLOAT -> ShiftIcons.FloatOut to c.floatOut.accent
        NotificationChannel.SHIFT_REMINDERS -> ShiftIcons.Clock to c.breakShift.accent
        NotificationChannel.SCHEDULE_PUBLISHED -> ShiftIcons.Calendar to MaterialTheme.colorScheme.primary
        NotificationChannel.GENERAL_UPDATES -> ShiftIcons.Bell to c.ter
    }
}

/** A mono cap value (e.g. "20h") for the Hours & limits rows. */
@Composable
private fun CapValue(label: String) {
    Text(
        label,
        style = ShiftTheme.type.monoId.copy(fontSize = 14.sp),
        color = ShiftTheme.colors.sec,
        fontWeight = FontWeight.SemiBold,
    )
}
