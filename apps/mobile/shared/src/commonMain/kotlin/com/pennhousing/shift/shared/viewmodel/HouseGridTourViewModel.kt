package com.pennhousing.shift.shared.viewmodel

import androidx.lifecycle.ViewModel
import com.pennhousing.shift.shared.onboarding.HouseGridTour
import com.pennhousing.shift.shared.onboarding.HouseGridTourStep
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * What the interactive "House grid" tour should render right now. [active] false means
 * nothing is showing. [step] is the current step's copy (null when inactive); [stepIndex]
 * is 1-based over [stepCount]; [canGoBack] gates the Back control; [isLastStep] flips the
 * primary button from Next to Done. [seen] is the durable set the platform persists.
 *
 * Unlike `ShiftTourUiState`, this tour has no live-interactive step-2 controls of its
 * own to model here (the switcher/week-nav in step 2 and the tap target in step 1/3 are
 * either standard OS controls or simple pulse/bounce motion the platform drives directly)
 * — kept as simple as the content honestly requires.
 */
data class HouseGridTourUiState(
    val active: Boolean = false,
    val step: HouseGridTourStep? = null,
    val stepIndex: Int = 0,
    val stepCount: Int = HouseGridTour.STEP_COUNT,
    val canGoBack: Boolean = false,
    val isLastStep: Boolean = false,
    val seen: Set<String> = emptySet(),
)

/**
 * HouseGridTour ViewModel — a thin, synchronous `StateFlow` wrapper over the pure
 * `HouseGridTour` definitions, in the same shape as `ShiftTourViewModel` (no
 * `viewModelScope`, no clock). It sequences the three steps and owns the seen-flag; the
 * platform renders the overlay and persists [HouseGridTourUiState.seen].
 *
 * This tour is independent of the welcome tour / contextual tips / every other Tier-3
 * tour: it has its OWN seen-key store on each platform (so persisting one never clobbers
 * another). The host auto-starts it the first time the worker lands on the House tab,
 * and re-opens it from the House-tab help button or the Settings row.
 */
class HouseGridTourViewModel(
    initialSeen: Set<String> = emptySet(),
) : ViewModel() {
    private var seen: Set<String> = initialSeen

    // -1 = not active; otherwise an index into HouseGridTour.STEPS.
    private var step: Int = -1

    private val _uiState = MutableStateFlow(snapshot())
    val uiState: StateFlow<HouseGridTourUiState> = _uiState.asStateFlow()

    private val active: Boolean
        get() = step in HouseGridTour.STEPS.indices

    private fun snapshot(): HouseGridTourUiState =
        HouseGridTourUiState(
            active = active,
            step = if (active) HouseGridTour.STEPS[step] else null,
            stepIndex = if (active) step + 1 else 0,
            stepCount = HouseGridTour.STEP_COUNT,
            canGoBack = active && step > 0,
            isLastStep = active && step == HouseGridTour.STEPS.lastIndex,
            seen = seen,
        )

    private fun emit() {
        _uiState.value = snapshot()
    }

    /**
     * Begin the tour if it has not run yet and it is not already showing. A no-op once the
     * worker has finished or skipped it, so the host can call it freely on every House-tab
     * landing (mirrors `ShiftTourViewModel.autoStart`).
     */
    fun autoStart() {
        if (HouseGridTour.shouldAutoShow(seen) && !active) {
            step = 0
            emit()
        }
    }

    /**
     * Re-open the tour on demand (the House-tab help button, or the Settings row), even
     * after it has been completed. Restarts from step one; does not clear the done-flag on
     * its own (finishing again re-sets it, and a replay in progress simply shows).
     */
    fun replay() {
        step = 0
        emit()
    }

    /** Advance a step; advancing past the last step finishes the tour. */
    fun next() {
        if (!active) return
        step += 1
        if (!active) finish()
        emit()
    }

    /** Step back one; a no-op on the first step. */
    fun back() {
        if (!active || step == 0) return
        step -= 1
        emit()
    }

    /** Skip the rest of the tour (counts as done, so it never auto-fires again). */
    fun skip() {
        if (!active) return
        finish()
        emit()
    }

    private fun finish() {
        step = -1
        seen = seen + HouseGridTour.DONE_KEY
    }
}
