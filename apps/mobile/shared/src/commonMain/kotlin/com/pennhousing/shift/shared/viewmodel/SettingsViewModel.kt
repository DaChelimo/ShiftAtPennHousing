package com.pennhousing.shift.shared.viewmodel

import androidx.lifecycle.ViewModel
import com.pennhousing.shift.shared.settings.NotificationChannel
import com.pennhousing.shift.shared.settings.NotificationPreferences
import com.pennhousing.shift.shared.settings.NotificationRowModel
import com.pennhousing.shift.shared.settings.SettingsProfile
import com.pennhousing.shift.shared.settings.ThemeChoice
import com.pennhousing.shift.shared.settings.buildNotificationRows
import com.pennhousing.shift.shared.settings.toggled
import com.pennhousing.shift.shared.settings.withShiftReminderToggled
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class SettingsUiState(
    val profile: SettingsProfile,
    val notifications: List<NotificationRowModel>,
    val theme: ThemeChoice,
    val appVersion: String,
)

/**
 * Settings / Profile ViewModel — a thin `StateFlow` wrapper over the pure `settings/`
 * builders, in the [CalendarViewModel] shape (synchronous, no `viewModelScope`). The
 * profile snapshot + app version are injected; the broadcast subscription and the
 * theme are the only mutable state. No clock is read.
 *
 * [toggleBroadcast] is optimistic-local (mirroring the Shifts screen's claim/drop) —
 * the real write is the `users-broadcast-subscription` Edge Function, a data-layer
 * concern. Sign-out is the host's job (it calls `AuthGateway.signOut` + routes to
 * login), so it is a UI callback, not a VM action.
 */
class SettingsViewModel(
    private val profile: SettingsProfile,
    broadcastSubscribed: Boolean,
    private val appVersion: String,
    notificationPreferences: NotificationPreferences = NotificationPreferences(),
) : ViewModel() {
    private var broadcast: Boolean = broadcastSubscribed
    private var theme: ThemeChoice = ThemeChoice.SYSTEM
    private var prefs: NotificationPreferences = notificationPreferences

    private val _uiState = MutableStateFlow(snapshot())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()

    private fun snapshot(): SettingsUiState =
        SettingsUiState(
            profile = profile,
            notifications = buildNotificationRows(prefs, broadcast),
            theme = theme,
            appVersion = appVersion,
        )

    fun toggleBroadcast() {
        broadcast = !broadcast
        _uiState.value = snapshot()
    }

    /**
     * Flip one of the two configurable open-shift channels. A mandatory channel is a
     * no-op here as well as disabled in the UI, so a stray call can never silence one.
     * Returns the preferences to PERSIST (the host calls `set_notification_preferences`),
     * or null when [channel] is not configurable.
     */
    fun toggleNotification(channel: NotificationChannel): NotificationPreferences? {
        val next = prefs.toggled(channel)
        if (next == prefs) return null
        prefs = next
        _uiState.value = snapshot()
        return next
    }

    /**
     * Tick or untick ONE shift-reminder lead time (2h / 1h / 30m). Returns the
     * preferences to persist, or null if [offsetMinutes] is not one the app offers.
     * Unticking the last one is allowed: none is a supported choice.
     */
    fun toggleShiftReminder(offsetMinutes: Int): NotificationPreferences? {
        val next = prefs.withShiftReminderToggled(offsetMinutes)
        if (next == prefs) return null
        prefs = next
        _uiState.value = snapshot()
        return next
    }

    /** The lead times currently ticked, for the checkbox row. */
    val shiftReminderOffsets: Set<Int> get() = prefs.shiftReminderOffsets

    fun setTheme(choice: ThemeChoice) {
        theme = choice
        _uiState.value = snapshot()
    }
}
