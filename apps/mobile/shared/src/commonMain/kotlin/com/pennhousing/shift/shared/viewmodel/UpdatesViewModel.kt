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
) {
    /** Convenience for the header "mark all read" affordance — hidden when there is nothing unread. */
    val unreadCount: Int get() = feed.unreadCount
    val hasUnread: Boolean get() = unreadCount > 0
}

/**
 * Phase 13a — the Updates-tab ViewModel (§10.1 personal notifications + the §7
 * pending-float entry). A thin `StateFlow` wrapper over the pure [buildUpdatesFeed],
 * in the [MainViewModel] / [ShiftsScreenViewModel] shape: it constructs and emits
 * synchronously (no `viewModelScope`), so it runs on the JVM host without an Android
 * runtime. `now` is the screen's load instant, injected once (decision #17).
 *
 * The data layer (`WorkerShiftsRepository.fetchNotifications`) builds the snapshot;
 * this ViewModel groups it AND owns the optimistic "mark all read" move (T2-8): the
 * worker DOES have a path to clear unread — the `mark_notification_read` RPC (granted
 * to `authenticated`) — so the unread dots are no longer purely read-only. [markAllRead]
 * flips every unread item to read locally and emits a regrouped feed; the live host
 * additionally fires the RPC per id (best-effort), the demo path is local-only. Idempotent:
 * a feed with no unread items is left unchanged.
 */
class UpdatesViewModel(
    notifications: List<NotificationItem>,
    private val now: Instant,
) : ViewModel() {
    // Holds the current items so the optimistic mark-all-read can re-derive the feed
    // (the pure grouping is recomputed; `now` stays the injected load instant).
    private var items: List<NotificationItem> = notifications
    private val _uiState = MutableStateFlow(UpdatesUiState(buildUpdatesFeed(items, now)))
    val uiState: StateFlow<UpdatesUiState> = _uiState.asStateFlow()

    /** The still-unread notification ids — the live host loops these through the RPC. */
    fun unreadIds(): List<String> = items.filter { it.unread }.map { it.id }

    /**
     * Optimistically mark every notification read: flip unread → read locally and emit the
     * regrouped feed (so the header affordance hides and the unread dots clear). Returns the
     * ids that were unread BEFORE the flip, for the live host to pass to the RPC; the demo
     * path ignores the return. Idempotent — no-op (and empty return) when nothing was unread.
     */
    fun markAllRead(): List<String> {
        val toMark = items.filter { it.unread }.map { it.id }
        if (toMark.isEmpty()) return emptyList()
        items = items.map { if (it.unread) it.copy(unread = false) else it }
        _uiState.value = UpdatesUiState(buildUpdatesFeed(items, now))
        return toMark
    }
}
