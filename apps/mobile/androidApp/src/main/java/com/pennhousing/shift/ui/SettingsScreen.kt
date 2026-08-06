package com.pennhousing.shift.ui

import androidx.compose.animation.animateContentSize
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pennhousing.shift.shared.platform.openUrl
import com.pennhousing.shift.shared.settings.NotificationChannel
import com.pennhousing.shift.shared.settings.NotificationPreferences
import com.pennhousing.shift.shared.settings.NotificationRowModel
import com.pennhousing.shift.shared.settings.OPEN_SHIFTS_GROUP_SUB
import com.pennhousing.shift.shared.settings.OPEN_SHIFTS_GROUP_TITLE
import com.pennhousing.shift.shared.settings.PRIVACY_POLICY_URL
import com.pennhousing.shift.shared.settings.SHIFT_REMINDER_LEAD_TIMES
import com.pennhousing.shift.shared.settings.SettingsProfile
import com.pennhousing.shift.shared.settings.TERMS_OF_SERVICE_URL
import com.pennhousing.shift.shared.settings.THEME_CHOICES
import com.pennhousing.shift.shared.settings.alwaysOnNotificationsLabel
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
 * worker-app.html `SettingsScreen`, redesigned 2026-08-06 (BSpec §10.1):
 *  - Notifications splits into what a worker can actually change (shift reminders, the
 *    merged open-shifts card, general updates) and a collapsed "Always-on notifications"
 *    disclosure for the five mandatory channels, so the mandatory rows stop competing
 *    for attention with the ones a worker can act on.
 *  - The Account group is Sign out only; PennKey & security, Help & policy, and the six
 *    tour-replay rows are gone (each tour already has its own "?" entry point on its
 *    own tab header, so nothing is lost by dropping the Settings duplicate).
 *  - Privacy policy / Terms of service are plain text links to the guide site, above
 *    the version string.
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
) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    val c = ShiftTheme.colors
    val context = LocalContext.current
    val configurable = state.notifications.filter { it.interactive }
    val alwaysOn = state.notifications.filter { !it.interactive }

    LazyColumn(
        Modifier.fillMaxSize().background(c.bg).testTag("settings_screen"),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(22.dp),
    ) {
        item { ProfileCard(state.profile) }

        item {
            SettingsGroup("Notifications") {
                configurable.forEachIndexed { i, row ->
                    // The two open-shift channels render as ONE merged card (a header plus
                    // two switch rows); only emit it once, on the first of the pair, and
                    // skip the second so it does not also render as a peer row.
                    if (row.channel == NotificationChannel.OPEN_SHIFTS_OTHER_HOUSES) return@forEachIndexed
                    if (row.channel == NotificationChannel.OPEN_SHIFTS_HOME_HOUSE) {
                        val otherHouses = configurable.first { it.channel == NotificationChannel.OPEN_SHIFTS_OTHER_HOUSES }
                        OpenShiftsSettingRow(
                            homeHouse = row,
                            otherHouses = otherHouses,
                            onToggle = { channel -> vm.toggleNotification(channel)?.let(onToggleNotification) },
                        )
                        return@forEachIndexed
                    }
                    NotificationSettingRow(
                        row,
                        last = i == configurable.lastIndex,
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
                            // GENERAL_UPDATES still goes through its own Edge Function; the
                            // rest through `set_notification_preferences`. Everything not
                            // in `configurable` is mandatory and disabled, so this branch is
                            // never reached for those.
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
                AlwaysOnNotificationsDisclosure(alwaysOn)
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
            Row(
                Modifier.fillMaxWidth().padding(top = 4.dp),
                horizontalArrangement = Arrangement.Center,
            ) {
                Text(
                    "Privacy policy",
                    color = c.sec,
                    fontSize = 12.sp,
                    modifier =
                        Modifier
                            .clickable { openUrl(PRIVACY_POLICY_URL) }
                            .testTag("settings_privacy_policy_link"),
                )
                Text("  ·  ", color = c.outline, fontSize = 12.sp)
                Text(
                    "Terms of service",
                    color = c.sec,
                    fontSize = 12.sp,
                    modifier =
                        Modifier
                            .clickable { openUrl(TERMS_OF_SERVICE_URL) }
                            .testTag("settings_terms_of_service_link"),
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
                textAlign = TextAlign.Center,
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
        // No trailing chevron: this card has never opened anything on tap, and the arrow
        // read as a dead end (2026-08-06). Tapping the row does nothing today.
    }
}

/**
 * The merged "Open shift notifications" card: one header (title + [OPEN_SHIFTS_GROUP_SUB])
 * over two independent switch rows, "At my house" and "At other houses" — the same
 * disclosure shape [SHIFT_REMINDERS] uses for its lead-time checkboxes, so a worker reads
 * one concept ("a shift opened up") with two toggles rather than two unrelated peer rows.
 */
@Composable
private fun OpenShiftsSettingRow(
    homeHouse: NotificationRowModel,
    otherHouses: NotificationRowModel,
    onToggle: (NotificationChannel) -> Unit,
) {
    val c = ShiftTheme.colors
    Column {
        Row(
            Modifier.fillMaxWidth().padding(start = 14.dp, end = 14.dp, top = 12.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(13.dp),
        ) {
            Box(
                Modifier.size(30.dp).clip(RoundedCornerShape(8.dp)).background(c.pickupDot.copy(alpha = 0.14f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(ShiftIcons.Building, contentDescription = null, tint = c.pickupDot, modifier = Modifier.size(17.dp))
            }
            Column {
                Text(OPEN_SHIFTS_GROUP_TITLE, color = c.ink, fontSize = 15.sp, fontWeight = FontWeight.Medium)
                Text(OPEN_SHIFTS_GROUP_SUB, color = c.ter, fontSize = 12.5.sp, modifier = Modifier.padding(top = 1.dp))
            }
        }
        listOf(homeHouse, otherHouses).forEach { row ->
            Row(
                Modifier.fillMaxWidth().padding(start = 57.dp, end = 14.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(row.title, color = c.ink, fontSize = 13.5.sp, modifier = Modifier.weight(1f))
                ShiftSwitch(
                    checked = row.on,
                    onCheckedChange = { onToggle(row.channel) },
                    modifier =
                        Modifier.testTag(
                            if (row.channel == NotificationChannel.OPEN_SHIFTS_HOME_HOUSE) {
                                "settings_open_home_toggle"
                            } else {
                                "settings_open_other_toggle"
                            },
                        ),
                )
            }
        }
        Box(
            Modifier
                .fillMaxWidth()
                .padding(start = 57.dp)
                .height(1.dp)
                .background(c.divider),
        )
    }
}

/**
 * The five mandatory notification rows (float, swap requests, break sign-up,
 * preferences, schedule published), collapsed behind a disclosure so they do not compete
 * with the rows a worker can actually change. Shown, never hidden entirely: a worker can
 * still see that a swap request will always reach them, just one tap away instead of
 * always on screen.
 */
@Composable
private fun AlwaysOnNotificationsDisclosure(rows: List<NotificationRowModel>) {
    val c = ShiftTheme.colors
    var expanded by remember { mutableStateOf(false) }
    Column(Modifier.animateContentSize()) {
        Row(
            Modifier
                .fillMaxWidth()
                .clickable { expanded = !expanded }
                .padding(horizontal = 14.dp, vertical = 12.dp)
                .testTag("settings_always_on_disclosure"),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                alwaysOnNotificationsLabel(rows.size),
                color = c.sec,
                fontSize = 13.sp,
                modifier = Modifier.weight(1f),
            )
            Icon(
                ShiftIcons.ChevronRight,
                contentDescription = if (expanded) "Collapse" else "Expand",
                tint = c.outline,
                modifier = Modifier.size(15.dp).rotate(if (expanded) 90f else 0f),
            )
        }
        if (expanded) {
            rows.forEachIndexed { i, row ->
                NotificationSettingRow(row, last = i == rows.lastIndex, onToggle = {})
            }
        }
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
