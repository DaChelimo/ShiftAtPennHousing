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
import androidx.compose.material3.Checkbox
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
import com.pennhousing.shift.shared.settings.NotificationPreferences
import com.pennhousing.shift.shared.settings.NotificationRowModel
import com.pennhousing.shift.shared.settings.SHIFT_REMINDER_LEAD_TIMES
import com.pennhousing.shift.shared.settings.SettingsProfile
import com.pennhousing.shift.shared.settings.THEME_CHOICES
import com.pennhousing.shift.shared.settings.label
import com.pennhousing.shift.shared.settings.shiftReminderLabel
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
    // Persist the two configurable open-shift channels (BSpec §10.1). Called with the
    // WHOLE preference set, because the RPC upserts both columns at once.
    onToggleNotification: (NotificationPreferences) -> Unit = {},
    // Restart the first-run welcome tour on demand — the way back in for a worker who
    // skipped it or just wants a refresher.
    onReplayTour: () -> Unit = {},
    // Restart the interactive "Manage a shift" tour on demand (navigates to My Shifts first).
    onReplayShiftTour: () -> Unit = {},
    // Restart the four other interactive Tier-3 tours on demand, each navigating to its own
    // tab first. The swap-composer tour has no tab of its own — its replay navigates to My
    // Shifts and PRIMES the tour, which then actually fires the next time the worker reaches
    // the swap page inside the manage-shift sheet (mirrors iOS's onReplaySwapTour comment).
    onReplayPreferencesTour: () -> Unit = {},
    onReplayBreakTour: () -> Unit = {},
    onReplaySwapTour: () -> Unit = {},
    onReplayHouseGridTour: () -> Unit = {},
    onReplayOpenClaimTour: () -> Unit = {},
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
                        // The shift-reminder row carries its three lead-time checkboxes
                        // underneath. They ARE the control: the row's switch is a shortcut
                        // for "all off" / "back to the default".
                        leadTimes =
                            if (row.channel == NotificationChannel.SHIFT_REMINDERS) {
                                vm.shiftReminderOffsets
                            } else {
                                null
                            },
                        onToggleLeadTime = { minutes ->
                            vm.toggleShiftReminder(minutes)?.let(onToggleNotification)
                        },
                        onToggle = {
                            // Three interactive rows now (BSpec §10.1): the two open-shift
                            // channels, which persist through `set_notification_preferences`,
                            // and GENERAL_UPDATES, which still goes through its own Edge
                            // Function. Everything else is mandatory and its switch is
                            // disabled, so this branch is never reached for those.
                            when (row.channel) {
                                NotificationChannel.GENERAL_UPDATES -> {
                                    vm.toggleBroadcast()
                                    val subscribed =
                                        vm.uiState.value.notifications
                                            .first { it.channel == NotificationChannel.GENERAL_UPDATES }
                                            .on
                                    onToggleBroadcast(subscribed)
                                }
                                else -> vm.toggleNotification(row.channel)?.let(onToggleNotification)
                            }
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
                    icon = ShiftIcons.Refresh,
                    tint = MaterialTheme.colorScheme.primary,
                    title = "Replay app tour",
                    onClick = onReplayTour,
                    modifier = Modifier.testTag("settings_replay_tour"),
                ) {
                    Icon(ShiftIcons.ChevronRight, contentDescription = null, tint = c.outline, modifier = Modifier.size(17.dp))
                }
                SettingsRow(
                    icon = ShiftIcons.QuestionMark,
                    tint = MaterialTheme.colorScheme.primary,
                    title = "Replay shift tour",
                    onClick = onReplayShiftTour,
                    modifier = Modifier.testTag("settings_replay_shift_tour"),
                ) {
                    Icon(ShiftIcons.ChevronRight, contentDescription = null, tint = c.outline, modifier = Modifier.size(17.dp))
                }
                SettingsRow(
                    icon = ShiftIcons.QuestionMark,
                    tint = MaterialTheme.colorScheme.primary,
                    title = "Replay preferences tour",
                    onClick = onReplayPreferencesTour,
                    modifier = Modifier.testTag("settings_replay_preferences_tour"),
                ) {
                    Icon(ShiftIcons.ChevronRight, contentDescription = null, tint = c.outline, modifier = Modifier.size(17.dp))
                }
                SettingsRow(
                    icon = ShiftIcons.QuestionMark,
                    tint = MaterialTheme.colorScheme.primary,
                    title = "Replay break tour",
                    onClick = onReplayBreakTour,
                    modifier = Modifier.testTag("settings_replay_break_tour"),
                ) {
                    Icon(ShiftIcons.ChevronRight, contentDescription = null, tint = c.outline, modifier = Modifier.size(17.dp))
                }
                SettingsRow(
                    icon = ShiftIcons.QuestionMark,
                    tint = MaterialTheme.colorScheme.primary,
                    title = "Replay swap tour",
                    onClick = onReplaySwapTour,
                    modifier = Modifier.testTag("settings_replay_swap_tour"),
                ) {
                    Icon(ShiftIcons.ChevronRight, contentDescription = null, tint = c.outline, modifier = Modifier.size(17.dp))
                }
                SettingsRow(
                    icon = ShiftIcons.QuestionMark,
                    tint = MaterialTheme.colorScheme.primary,
                    title = "Replay house grid tour",
                    onClick = onReplayHouseGridTour,
                    modifier = Modifier.testTag("settings_replay_housegrid_tour"),
                ) {
                    Icon(ShiftIcons.ChevronRight, contentDescription = null, tint = c.outline, modifier = Modifier.size(17.dp))
                }
                SettingsRow(
                    icon = ShiftIcons.QuestionMark,
                    tint = MaterialTheme.colorScheme.primary,
                    title = "Replay open shifts tour",
                    onClick = onReplayOpenClaimTour,
                    modifier = Modifier.testTag("settings_replay_openclaim_tour"),
                ) {
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
                "SHIFT · v${state.appVersion}",
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
            Box(
                Modifier
                    .fillMaxWidth()
                    .padding(start = 57.dp)
                    .height(1.dp)
                    .background(c.divider),
            )
        }
    }
}

@Composable
private fun NotificationSettingRow(
    row: NotificationRowModel,
    last: Boolean,
    onToggle: () -> Unit,
    // Non-null only for the shift-reminder row: the lead times currently ticked.
    leadTimes: Set<Int>? = null,
    onToggleLeadTime: (Int) -> Unit = {},
) {
    if (leadTimes != null) {
        ShiftReminderSettingRow(row, leadTimes, last, onToggle, onToggleLeadTime)
        return
    }
    NotificationSwitchRow(row, last, onToggle)
}

/**
 * The shift-reminder row: a switch plus the three lead-time checkboxes it governs
 * (BSpec §10.1a, 2026-07-28).
 *
 * Checkboxes rather than a single picker because the choices are not exclusive: a worker
 * may want a 2-hour heads-up AND a 30-minute nudge. All three, some, or none.
 *
 * Unticking the last one is deliberately allowed and is not treated as an error state.
 * The row's summary then reads "Off", so a worker can tell the difference between "no
 * reminders" and "something failed to load".
 */
@Composable
private fun ShiftReminderSettingRow(
    row: NotificationRowModel,
    leadTimes: Set<Int>,
    last: Boolean,
    onToggle: () -> Unit,
    onToggleLeadTime: (Int) -> Unit,
) {
    val c = ShiftTheme.colors
    Column {
        NotificationSwitchRow(row, last = false, onToggle = onToggle)
        Column(
            Modifier
                .fillMaxWidth()
                .padding(start = 52.dp, end = 14.dp, bottom = 12.dp)
                .testTag("settings_shift_reminder_leadtimes"),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            SHIFT_REMINDER_LEAD_TIMES.forEach { minutes ->
                val checked = minutes in leadTimes
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .clickable { onToggleLeadTime(minutes) }
                        .padding(vertical = 6.dp)
                        .testTag("settings_lead_time_$minutes"),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Checkbox(
                        checked = checked,
                        // The whole row is the tap target; the box itself must not also
                        // handle the tap or a tap on it would toggle twice.
                        onCheckedChange = null,
                        modifier = Modifier.size(20.dp),
                    )
                    Text(
                        shiftReminderLabel(minutes),
                        color = if (checked) c.ink else c.sec,
                        fontSize = 14.sp,
                    )
                }
            }
        }
        // Same inset rule the other rows use, so the group reads as one list.
        if (!last) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .padding(start = 57.dp)
                    .height(1.dp)
                    .background(c.divider),
            )
        }
    }
}

@Composable
private fun NotificationSwitchRow(
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
            modifier =
                when (row.channel) {
                    NotificationChannel.GENERAL_UPDATES -> Modifier.testTag("settings_broadcast_toggle")
                    NotificationChannel.OPEN_SHIFTS_HOME_HOUSE -> Modifier.testTag("settings_open_home_toggle")
                    NotificationChannel.OPEN_SHIFTS_OTHER_HOUSES -> Modifier.testTag("settings_open_other_toggle")
                    else -> Modifier
                },
        )
    }
}

@Composable
private fun notificationVisual(channel: NotificationChannel): Pair<ImageVector, Color> {
    val c = ShiftTheme.colors
    return when (channel) {
        NotificationChannel.FLOAT -> ShiftIcons.FloatOut to c.floatOut.accent
        NotificationChannel.SWAP_REQUESTS -> ShiftIcons.Refresh to c.pending
        NotificationChannel.BREAK_SIGNUP -> ShiftIcons.Snowflake to c.breakShift.accent
        NotificationChannel.PREFERENCES -> ShiftIcons.Calendar to c.pickupDot
        NotificationChannel.SHIFT_REMINDERS -> ShiftIcons.Clock to c.breakShift.accent
        NotificationChannel.SCHEDULE_PUBLISHED -> ShiftIcons.Calendar to MaterialTheme.colorScheme.primary
        NotificationChannel.OPEN_SHIFTS_HOME_HOUSE -> ShiftIcons.Building to MaterialTheme.colorScheme.primary
        NotificationChannel.OPEN_SHIFTS_OTHER_HOUSES -> ShiftIcons.Building to c.ter
        NotificationChannel.GENERAL_UPDATES -> ShiftIcons.Bell to c.ter
    }
}
