package com.pennhousing.shift.shared.viewmodel

import androidx.lifecycle.ViewModel
import com.pennhousing.shift.shared.breakclaim.BreakClaimList
import com.pennhousing.shift.shared.breakclaim.BreakClaimSnapshot
import com.pennhousing.shift.shared.breakclaim.buildBreakClaimList
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class BreakClaimUiState(
    val profileContext: String,
    val infoTitle: String,
    val infoBody: String,
    val list: BreakClaimList,
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

    private val _uiState = MutableStateFlow(build())
    val uiState: StateFlow<BreakClaimUiState> = _uiState.asStateFlow()

    private fun build(): BreakClaimUiState =
        BreakClaimUiState(
            profileContext = snapshot.profileContext,
            infoTitle = snapshot.infoTitle,
            infoBody = snapshot.infoBody,
            list = buildBreakClaimList(snapshot, claimedIds),
        )

    fun claim(id: String) {
        claimedIds = claimedIds + id
        _uiState.value = build()
    }

    fun drop(id: String) {
        claimedIds = claimedIds - id
        _uiState.value = build()
    }
}
