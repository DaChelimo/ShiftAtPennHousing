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

    @Test fun only_general_updates_is_interactive_and_binds_broadcast() {
        val on = buildNotificationRows(broadcastSubscribed = true)
        assertEquals(4, on.size)
        val updates = on.first { it.channel == NotificationChannel.GENERAL_UPDATES }
        assertTrue(updates.interactive)
        assertTrue(updates.on)
        // the other three are always-on / disabled (no per-category opt-out backing)
        val others = on.filter { it.channel != NotificationChannel.GENERAL_UPDATES }
        assertTrue(others.all { it.on && !it.interactive })
        assertEquals(NotificationChannel.FLOAT, on.first().channel)
    }

    @Test fun general_updates_reflects_broadcast_off() {
        val off = buildNotificationRows(broadcastSubscribed = false)
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
