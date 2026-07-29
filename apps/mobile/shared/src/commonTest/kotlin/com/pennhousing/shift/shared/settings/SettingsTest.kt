package com.pennhousing.shift.shared.settings

import com.pennhousing.shift.shared.viewmodel.SettingsViewModel
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Settings / Profile presentation (shared) — role labels, the avatar monogram, the
 * notification-channel rows (only the broadcast row is user-toggleable), the read-only
 * hours limits, and the theme choices. Pure; no clock, no I/O.
 */
class SettingsTest {
    private val profile =
        SettingsProfile(name = "Andrew P.", email = "andrewp@upenn.edu", role = "sw", homeHouseName = "Harnwell College House")

    // ----- role + monogram -----

    @Test fun role_labels_map_each_role() {
        assertEquals("Student Worker", roleLabel("sw"))
        assertEquals("Shift Manager", roleLabel("sm"))
        assertEquals("House Manager", roleLabel("hm"))
        assertEquals("Building Manager", roleLabel("bm"))
        assertEquals("Staff", roleLabel("unknown"))
        assertEquals("Student Worker", roleLabel("SW")) // case-insensitive
    }

    @Test fun initial_is_first_letter_uppercased() {
        assertEquals("A", initialOf("Andrew P."))
        assertEquals("Q", initialOf("quinn"))
        assertEquals("?", initialOf("   "))
    }

    @Test fun profile_derives_initial_role_and_subtitle() {
        assertEquals("A", profile.initial)
        assertEquals("Student Worker", profile.roleLabel)
        assertEquals("Harnwell College House · Student Worker", profile.subtitle)
    }

    // ----- notification rows -----

    // BSpec §10.1, amended 2026-07-28. The mandatory/configurable split is the RULE, so
    // these pin exactly which channels a worker can silence. Previously the only
    // toggleable row was GENERAL_UPDATES and the shift-opened notification rode on it,
    // a flag that defaults to false, so in practice nobody was told a shift had opened.

    @Test fun a_worker_can_never_silence_a_channel_that_needs_their_answer() {
        val rows = buildNotificationRows(NotificationPreferences(), broadcastSubscribed = true)
        // SHIFT_REMINDERS is deliberately absent: as of 2026-07-28 a worker chooses its
        // lead times and may choose none. A reminder asks nothing of them, unlike a swap
        // request or a float, so silencing it costs only the person who chose to.
        val mandatory =
            listOf(
                NotificationChannel.FLOAT,
                NotificationChannel.SWAP_REQUESTS,
                NotificationChannel.BREAK_SIGNUP,
                NotificationChannel.PREFERENCES,
                NotificationChannel.SCHEDULE_PUBLISHED,
            )
        mandatory.forEach { channel ->
            val row = rows.first { it.channel == channel }
            assertTrue(row.on, "$channel must be on")
            assertFalse(row.interactive, "$channel must not be toggleable")
        }
        // Shown, not hidden: a worker has to be able to SEE that a swap request reaches them.
        assertEquals(NotificationChannel.FLOAT, rows.first().channel)
    }

    @Test fun the_configurable_channels_are_shift_reminders_the_two_open_shift_ones_and_broadcast() {
        val interactive =
            buildNotificationRows(NotificationPreferences(), broadcastSubscribed = true)
                .filter { it.interactive }
                .map { it.channel }
        assertEquals(
            listOf(
                NotificationChannel.SHIFT_REMINDERS,
                NotificationChannel.OPEN_SHIFTS_HOME_HOUSE,
                NotificationChannel.OPEN_SHIFTS_OTHER_HOUSES,
                NotificationChannel.GENERAL_UPDATES,
            ),
            interactive,
        )
    }

    // ----- shift-reminder lead times (2h / 1h / 30m) -----

    @Test fun shift_reminders_default_to_one_hour_alone() {
        // Must match notification_preferences.shift_reminder_offsets and
        // worker_shift_reminder_offsets(): never-opened-Settings equals kept-the-defaults.
        assertEquals(setOf(60), NotificationPreferences().shiftReminderOffsets)
    }

    @Test fun the_three_offered_lead_times_are_longest_first() {
        assertEquals(listOf(120, 60, 30), SHIFT_REMINDER_LEAD_TIMES)
        assertEquals(
            listOf("2 hours before", "1 hour before", "30 minutes before"),
            SHIFT_REMINDER_LEAD_TIMES.map { shiftReminderLabel(it) },
        )
    }

    @Test fun a_worker_can_tick_all_some_or_none() {
        var prefs = NotificationPreferences(shiftReminderOffsets = emptySet())
        SHIFT_REMINDER_LEAD_TIMES.forEach { prefs = prefs.withShiftReminderToggled(it) }
        assertEquals(setOf(120, 60, 30), prefs.shiftReminderOffsets, "all three")

        prefs = prefs.withShiftReminderToggled(60)
        assertEquals(setOf(120, 30), prefs.shiftReminderOffsets, "some")

        SHIFT_REMINDER_LEAD_TIMES.forEach { prefs = prefs.withShiftReminderToggled(it) }
        // Unticking the last one is allowed: none is a supported choice, not an error.
        assertEquals(setOf(60), prefs.shiftReminderOffsets)
        prefs = prefs.withShiftReminderToggled(60)
        assertEquals(emptySet(), prefs.shiftReminderOffsets, "none")
    }

    @Test fun a_lead_time_the_app_does_not_offer_is_ignored() {
        val prefs = NotificationPreferences()
        assertEquals(prefs, prefs.withShiftReminderToggled(45))
    }

    @Test fun the_row_says_off_rather_than_going_blank_when_nothing_is_ticked() {
        // A blank sub-line reads as a loading bug; "Off" reads as a choice.
        assertEquals(
            "Off. You will not be reminded before your shifts.",
            shiftReminderSummary(emptySet()),
        )
        assertEquals("2 hours before, 30 minutes before", shiftReminderSummary(setOf(30, 120)))
    }

    @Test fun the_row_switch_is_a_shortcut_for_all_off_and_back_to_default() {
        val on = NotificationPreferences()
        val off = on.toggled(NotificationChannel.SHIFT_REMINDERS)
        assertEquals(emptySet(), off.shiftReminderOffsets)
        // Back on restores the default rather than an empty set, which would be an "on"
        // row that sends nothing.
        assertEquals(setOf(60), off.toggled(NotificationChannel.SHIFT_REMINDERS).shiftReminderOffsets)
    }

    @Test fun open_shifts_default_on_at_home_and_off_elsewhere() {
        // Must match the notification_preferences column defaults and
        // wants_open_shift_notification: never opening Settings behaves like keeping them.
        val rows = buildNotificationRows(NotificationPreferences(), broadcastSubscribed = false)
        assertTrue(rows.first { it.channel == NotificationChannel.OPEN_SHIFTS_HOME_HOUSE }.on)
        assertFalse(rows.first { it.channel == NotificationChannel.OPEN_SHIFTS_OTHER_HOUSES }.on)
    }

    @Test fun toggling_flips_only_configurable_channels() {
        val prefs = NotificationPreferences()
        assertFalse(prefs.toggled(NotificationChannel.OPEN_SHIFTS_HOME_HOUSE).openShiftsHomeHouse)
        assertTrue(prefs.toggled(NotificationChannel.OPEN_SHIFTS_OTHER_HOUSES).openShiftsOtherHouses)
        // A mandatory channel is a no-op, so a stray call can never silence one.
        assertEquals(prefs, prefs.toggled(NotificationChannel.SWAP_REQUESTS))
        assertEquals(prefs, prefs.toggled(NotificationChannel.FLOAT))
    }

    @Test fun general_updates_reflects_broadcast_off() {
        val off = buildNotificationRows(NotificationPreferences(), broadcastSubscribed = false)
        assertFalse(off.first { it.channel == NotificationChannel.GENERAL_UPDATES }.on)
    }

    // ----- hours + theme -----

    @Test fun hours_limits_use_the_shared_caps() {
        val h = hoursLimits()
        assertEquals("20h", h.softCapLabel)
        assertEquals("40h", h.hardCapLabel)
    }

    @Test fun theme_choices_order_and_labels() {
        assertEquals(listOf(ThemeChoice.SYSTEM, ThemeChoice.LIGHT, ThemeChoice.DARK), THEME_CHOICES)
        assertEquals(listOf("System", "Light", "Dark"), THEME_CHOICES.map { it.label() })
    }

    // ----- ViewModel reducer -----

    @Test fun viewmodel_toggle_broadcast_flips_only_the_updates_row() {
        val vm = SettingsViewModel(profile, broadcastSubscribed = false, appVersion = "2.4.0")
        assertFalse(vm.uiState.value.notifications.first { it.channel == NotificationChannel.GENERAL_UPDATES }.on)
        vm.toggleBroadcast()
        assertTrue(vm.uiState.value.notifications.first { it.channel == NotificationChannel.GENERAL_UPDATES }.on)
        assertEquals("Andrew P.", vm.uiState.value.profile.name) // profile unchanged
    }

    @Test fun viewmodel_set_theme_updates_choice() {
        val vm = SettingsViewModel(profile, broadcastSubscribed = false, appVersion = "2.4.0")
        assertEquals(ThemeChoice.SYSTEM, vm.uiState.value.theme)
        vm.setTheme(ThemeChoice.DARK)
        assertEquals(ThemeChoice.DARK, vm.uiState.value.theme)
        assertEquals("2.4.0", vm.uiState.value.appVersion)
    }
}
