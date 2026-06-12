package com.pennhousing.shift.shared.viewmodel

import androidx.lifecycle.ViewModel
import com.pennhousing.shift.shared.breakclaim.BreakClaimList
import com.pennhousing.shift.shared.breakclaim.BreakClaimSnapshot
import com.pennhousing.shift.shared.breakclaim.buildBreakClaimList
import com.pennhousing.shift.shared.breakclaim.buildBreakHoursMeter
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class BreakClaimUiState(
    val profileContext: String,
    val infoTitle: String,
    val infoBody: String,
    val list: BreakClaimList,
    // §4.4 — the worker has opted out of break hours for the active break. Mirrors the
    // preferences no-hours opt-out: the list is suppressed (opted-out empty state) and
    // claiming is a no-op while this is true.
    val optedOut: Boolean,
)

/**
 * Break-claim ViewModel — a thin `StateFlow` wrapper over the pure `breakclaim/`
 * builders, in the [CalendarViewModel] shape (synchronous, no `viewModelScope`). The
 * [snapshot] is injected once; the claimed-id set is the only mutable state and each
 * [claim]/[drop] recomputes the list + the 40h hard-cap meter. No clock is read.
 *
 * [claim]/[drop] are optimistic-local (mirroring the Shifts screen's claim/drop):
 * the real `break-claim` / `drop-shift` Edge-Function writes are the (untested)
 * data-layer concern. FCFS contention and the live cap re-check happen server-side.
 */
class BreakClaimViewModel(
    private val snapshot: BreakClaimSnapshot,
) : ViewModel() {
    private var claimedIds: Set<String> = snapshot.initiallyClaimedIds
    private var optedOut: Boolean = snapshot.initiallyOptedOut

    // D6 — the server's authoritative hours projection (the `break-claim` EF's
    // projected_hours). Null until a live claim responds; overrides the local sum.
    private var serverHours: Double? = null

    /** The active break id the §4.4 opt-out targets (null in demo / no current break). */
    val breakId: String? get() = snapshot.breakId

    private val _uiState = MutableStateFlow(build())
    val uiState: StateFlow<BreakClaimUiState> = _uiState.asStateFlow()

    private fun build(): BreakClaimUiState {
        var list = buildBreakClaimList(snapshot, claimedIds, optedOut = optedOut)
        serverHours?.let { hours ->
            // The EF's projection wins over the local sum (it sees the whole week).
            list = list.copy(claimedHours = hours, meter = buildBreakHoursMeter(hours))
        }
        return BreakClaimUiState(
            profileContext = snapshot.profileContext,
            infoTitle = snapshot.infoTitle,
            infoBody = snapshot.infoBody,
            list = list,
            optedOut = optedOut,
        )
    }

    /** D6 — fold the `break-claim` EF's authoritative hours projection into the meter. */
    fun reconcileHours(projectedHours: Double?) {
        if (projectedHours == null) return
        serverHours = projectedHours
        _uiState.value = build()
    }

    /** The constituent block assignment_ids of a pool run (live claims/drops loop them). */
    fun blockIdsFor(id: String): List<String> =
        snapshot.shifts.firstOrNull { it.id == id }?.blockIds ?: listOf(id)

    /**
     * Optimistic local claim. No-op when opted out of break hours (§4.4), when already
     * claimed, or when the worker is at the 40h HARD cap (the UI also disables the Claim
     * action — this guards the programmatic path; the server stays authoritative via
     * `break-claim`'s `hard_cap_exceeded`).
     */
    fun claim(id: String) {
        if (optedOut) return
        if (id in claimedIds) return
        if (_uiState.value.list.meter.atCap) return
        claimedIds = claimedIds + id
        _uiState.value = build()
    }

    fun drop(id: String) {
        claimedIds = claimedIds - id
        _uiState.value = build()
    }

    /**
     * Flip the §4.4 "no break hours" opt-out and return the new state. Optimistic-local
     * (mirroring the preferences no-hours toggle + the claim/drop moves): the live host
     * writes the `break_optouts` own-row (insert on opt-out / delete on opt-in) best-effort
     * via [com.pennhousing.shift.shared.data.BreakRepository.setBreakOptOut]. The list is
     * recomputed so the opted-out empty state shows immediately.
     */
    fun toggleOptedOut(): Boolean {
        optedOut = !optedOut
        _uiState.value = build()
        return optedOut
    }
}
