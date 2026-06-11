package com.pennhousing.shift.shared.viewmodel

import androidx.lifecycle.ViewModel
import com.pennhousing.shift.shared.settings.HoursLimits
import com.pennhousing.shift.shared.settings.NotificationRowModel
import com.pennhousing.shift.shared.settings.SettingsProfile
import com.pennhousing.shift.shared.settings.ThemeChoice
import com.pennhousing.shift.shared.settings.buildNotificationRows
import com.pennhousing.shift.shared.settings.hoursLimits
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class SettingsUiState(
    val profile: SettingsProfile,
    val notifications: List<NotificationRowModel>,
    val theme: ThemeChoice,
    val hours: HoursLimits,
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
) : ViewModel() {
    private var broadcast: Boolean = broadcastSubscribed
    private var theme: ThemeChoice = ThemeChoice.SYSTEM

    private val _uiState = MutableStateFlow(snapshot())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()

    private fun snapshot(): SettingsUiState =
        SettingsUiState(
            profile = profile,
            notifications = buildNotificationRows(broadcast),
            theme = theme,
            hours = hoursLimits(),
            appVersion = appVersion,
        )

    fun toggleBroadcast() {
        broadcast = !broadcast
        _uiState.value = snapshot()
    }

    fun setTheme(choice: ThemeChoice) {
        theme = choice
        _uiState.value = snapshot()
    }
}
