package com.pennhousing.shift.shared.viewmodel

import androidx.lifecycle.ViewModel
import com.pennhousing.shift.shared.manager.coverage.CoverageCard
import com.pennhousing.shift.shared.manager.coverage.CoverageFeed
import com.pennhousing.shift.shared.manager.coverage.CoverageOutcome
import com.pennhousing.shift.shared.manager.coverage.CoverageRequest
import com.pennhousing.shift.shared.manager.coverage.DEFAULT_RUNG_TIMEOUT_MINUTES
import com.pennhousing.shift.shared.manager.coverage.buildCoverageFeed
import com.pennhousing.shift.shared.manager.coverage.requiresCloseNote
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.time.Instant

/**
 * The Respond sheet's state, or null when no sheet is open.
 *
 * Opening this sheet IS the acknowledgement (docs/manager-app/SPEC.md §6.1). There is no
 * separate "acknowledge" tap, because the manager's job is one job: I've got this, I'm
 * calling Allied, here is what happened. The ladder must stop the moment they look at it.
 */
data class RespondSheetState(
    val card: CoverageCard,
    /** The chosen outcome, or null while the manager is still on the "Did Allied confirm?" step. */
    val selectedOutcome: CoverageOutcome? = null,
    val note: String = "",
    /** True while a close write is in flight, so the UI can disable the buttons. */
    val submitting: Boolean = false,
) {
    /** `desk_unstaffed` needs a written note. The RPC enforces this too; this is the fail-fast. */
    val noteRequired: Boolean get() = selectedOutcome?.let { requiresCloseNote(it) } == true

    /** May the close button fire? Mirrors `close_allied_coverage_request`'s `note_required` guard. */
    val canSubmit: Boolean
        get() =
            !submitting &&
                selectedOutcome != null &&
                (!noteRequired || note.isNotBlank())
}

data class CoverageUiState(
    val feed: CoverageFeed,
    val sheet: RespondSheetState? = null,
    /**
     * Set when a request the manager tapped turned out to be already closed by somebody
     * else. Delivery is at-least-once and web can close a request from under us, so this is
     * a normal outcome, not an error: the UI says "this is already handled" rather than
     * failing.
     */
    val alreadyHandledMessage: String? = null,
) {
    /** The Coverage tab badge count. */
    val badgeCount: Int get() = feed.actionRequiredCount

    /** The non-dismissable app-wide banner shows only while something is unacknowledged. */
    val showsBanner: Boolean get() = feed.showsBanner
}

/**
 * The Coverage-tab ViewModel (BSpec §5.4a; docs/manager-app/SPEC.md §6.1).
 *
 * A thin `StateFlow` wrapper over the pure `buildCoverageFeed`, in the same shape as
 * [UpdatesViewModel]: it constructs and emits synchronously (no `viewModelScope`), so it
 * runs on the JVM host without an Android runtime. `now` is the screen's load instant,
 * injected once.
 *
 * The optimistic moves here mirror the worker screens' claim/drop pattern: flip local state
 * so the UI responds instantly, hand the caller the ids it needs for the server write, and
 * let the next snapshot reconcile. The server stays authoritative.
 *
 * ONE DELIBERATE ASYMMETRY WITH THE WORKER SCREENS: acknowledgement is NEVER queued
 * offline. The app has a `PendingWriteStore` and it is the wrong tool here. A queued
 * acknowledgement that never reaches the server would silence this manager's own UI while
 * the ladder keeps escalating and the desk keeps heading for empty. If the write fails,
 * [revertAcknowledge] puts the request back in the action-required state so the banner and
 * badge return. Fail loudly, keep alerting.
 */
class CoverageViewModel(
    requests: List<CoverageRequest>,
    private val now: Instant,
    private val rungTimeoutMinutes: Int = DEFAULT_RUNG_TIMEOUT_MINUTES,
) : ViewModel() {
    private var requests: List<CoverageRequest> = requests
    private val _uiState = MutableStateFlow(CoverageUiState(feed()))
    val uiState: StateFlow<CoverageUiState> = _uiState.asStateFlow()

    private fun feed(): CoverageFeed = buildCoverageFeed(requests, rungTimeoutMinutes, now)

    private fun emit(
        sheet: RespondSheetState? = _uiState.value.sheet,
        alreadyHandled: String? = _uiState.value.alreadyHandledMessage,
    ) {
        _uiState.value = CoverageUiState(feed(), sheet, alreadyHandled)
    }

    /**
     * Replace the snapshot (a Realtime change, a pull-to-refresh, or the re-fetch that
     * happens when the app is opened from a push).
     *
     * If the request whose sheet is open is no longer present or has been closed elsewhere,
     * the sheet closes and says so, rather than letting the manager record an outcome on a
     * request somebody else already resolved.
     */
    fun refresh(next: List<CoverageRequest>) {
        requests = next
        val openId = _uiState.value.sheet?.card?.requestId
        if (openId == null) {
            emit()
            return
        }
        val stillOpen = feed().cards.firstOrNull { it.requestId == openId }
        if (stillOpen == null) {
            _uiState.value = CoverageUiState(feed(), null, MESSAGE_ALREADY_HANDLED)
        } else {
            emit(sheet = _uiState.value.sheet?.copy(card = stillOpen))
        }
    }

    /**
     * Open the Respond sheet for [requestId] and acknowledge it in the same move.
     *
     * Returns the request id the caller must acknowledge server-side, or null when the
     * request is unknown or already acknowledged (in which case the sheet still opens, so a
     * manager can record the outcome of a request a colleague picked up). Acknowledging is
     * idempotent server-side: `acknowledge_allied_coverage_request` returns
     * `already_acknowledged` rather than failing.
     */
    fun openRespond(requestId: String): String? {
        val target = requests.firstOrNull { it.requestId == requestId }
        if (target == null) {
            _uiState.value = CoverageUiState(feed(), null, MESSAGE_ALREADY_HANDLED)
            return null
        }
        val needsAck = target.acknowledgedAt == null && target.closedAt == null
        if (needsAck) {
            requests = requests.map { if (it.requestId == requestId) it.copy(acknowledgedAt = now) else it }
        }
        val card = feed().cards.firstOrNull { it.requestId == requestId }
        if (card == null) {
            // Closed between snapshot and tap.
            _uiState.value = CoverageUiState(feed(), null, MESSAGE_ALREADY_HANDLED)
            return null
        }
        _uiState.value = CoverageUiState(feed(), RespondSheetState(card = card), null)
        return if (needsAck) requestId else null
    }

    /**
     * Put an optimistic acknowledgement back when the server write failed. The banner and
     * the badge return, because as far as anyone can tell nobody is handling this yet.
     */
    fun revertAcknowledge(requestId: String) {
        requests =
            requests.map {
                if (it.requestId == requestId && it.closedAt == null) it.copy(acknowledgedAt = null) else it
            }
        emit()
    }

    /** The manager picked an outcome on the sheet. */
    fun selectOutcome(outcome: CoverageOutcome) {
        val sheet = _uiState.value.sheet ?: return
        emit(sheet = sheet.copy(selectedOutcome = outcome))
    }

    /** Note text for a `desk_unstaffed` close. */
    fun updateNote(note: String) {
        val sheet = _uiState.value.sheet ?: return
        emit(sheet = sheet.copy(note = note))
    }

    /**
     * "Not yet" — dismiss the sheet WITHOUT closing the request. It stays acknowledged and
     * open, and remains in the list, because an open request never clears itself.
     */
    fun dismissSheet() {
        _uiState.value = CoverageUiState(feed(), null, null)
    }

    fun clearAlreadyHandled() {
        emit(alreadyHandled = null)
    }

    /**
     * Record the outcome and close the request optimistically: it leaves the list and the
     * sheet dismisses.
     *
     * Returns the [CloseIntent] the caller sends to the server, or null when the sheet is
     * not in a submittable state (no outcome chosen, or a `desk_unstaffed` with no note).
     * The caller must call [revertClose] if the write fails.
     */
    fun submitClose(): CloseIntent? {
        val sheet = _uiState.value.sheet ?: return null
        val outcome = sheet.selectedOutcome ?: return null
        if (!sheet.canSubmit) return null
        val requestId = sheet.card.requestId
        val previous = requests.firstOrNull { it.requestId == requestId } ?: return null
        val note = sheet.note.trim().takeIf { it.isNotEmpty() }
        requests =
            requests.map {
                if (it.requestId == requestId) {
                    // Closing implies acknowledgement; the RPC back-stamps `acknowledged_at`
                    // the same way, so a close is safe even when the acknowledge write failed.
                    it.copy(closedAt = now, outcome = outcome, acknowledgedAt = it.acknowledgedAt ?: now)
                } else {
                    it
                }
            }
        _uiState.value = CoverageUiState(feed(), null, null)
        return CloseIntent(requestId = requestId, outcome = outcome, note = note, previous = previous)
    }

    /** Undo an optimistic close when the server write failed. */
    fun revertClose(intent: CloseIntent) {
        requests = requests.map { if (it.requestId == intent.requestId) intent.previous else it }
        emit()
    }

    private companion object {
        const val MESSAGE_ALREADY_HANDLED = "Someone already handled this request."
    }
}

/**
 * What the host needs to send to `close_allied_coverage_request`, plus the row it replaced
 * so a failed write can be rolled back.
 */
data class CloseIntent(
    val requestId: String,
    val outcome: CoverageOutcome,
    val note: String?,
    val previous: CoverageRequest,
)
