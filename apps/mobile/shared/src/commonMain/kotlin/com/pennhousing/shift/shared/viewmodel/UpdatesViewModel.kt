package com.pennhousing.shift.shared.viewmodel

import androidx.lifecycle.ViewModel
import com.pennhousing.shift.shared.notifications.NotificationItem
import com.pennhousing.shift.shared.notifications.UpdatesFeed
import com.pennhousing.shift.shared.notifications.buildUpdatesFeed
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.time.Instant

data class UpdatesUiState(
    val feed: UpdatesFeed,
)

/**
 * Phase 13a — the Updates-tab ViewModel (§10.1 personal notifications + the §7
 * pending-float entry). A thin `StateFlow` wrapper over the pure [buildUpdatesFeed],
 * in the [MainViewModel] / [ShiftsScreenViewModel] shape: it constructs and emits
 * synchronously (no `viewModelScope`), so it runs on the JVM host without an Android
 * runtime. `now` is the screen's load instant, injected once (decision #17).
 *
 * The data layer (`WorkerShiftsRepository.fetchNotifications`) builds the snapshot;
 * this ViewModel only groups it. There is no "mark read" action — workers have no
 * UPDATE policy on `notifications`, so the unread flag is read-only.
 */
class UpdatesViewModel(
    notifications: List<NotificationItem>,
    now: Instant,
) : ViewModel() {
    private val _uiState = MutableStateFlow(UpdatesUiState(buildUpdatesFeed(notifications, now)))
    val uiState: StateFlow<UpdatesUiState> = _uiState.asStateFlow()
}
