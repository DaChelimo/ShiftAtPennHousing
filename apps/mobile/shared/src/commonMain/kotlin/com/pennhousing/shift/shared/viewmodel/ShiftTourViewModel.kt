package com.pennhousing.shift.shared.viewmodel

import androidx.lifecycle.ViewModel
import com.pennhousing.shift.shared.onboarding.ShiftTour
import com.pennhousing.shift.shared.onboarding.ShiftTourStep
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * What the interactive "Manage a shift" tour should render right now. [active] false means
 * nothing is showing. [step] is the current step's copy (null when inactive); [stepIndex]
 * is 1-based over [stepCount]; [canGoBack] gates the Back control; [isLastStep] flips the
 * primary button from Next to Done. [seen] is the durable set the platform persists.
 *
 * The step-2 interactive state (the range + one-time/permanent scope) lives natively per
 * platform for smooth slider binding; it is not modeled here. The pure summary math it
 * needs is in `ShiftTour` (`summaryLine` / `durationLabel` / `timeLabel`).
 */
data class ShiftTourUiState(
    val active: Boolean = false,
    val step: ShiftTourStep? = null,
    val stepIndex: Int = 0,
    val stepCount: Int = ShiftTour.STEP_COUNT,
    val canGoBack: Boolean = false,
    val isLastStep: Boolean = false,
    val seen: Set<String> = emptySet(),
)

/**
 * ShiftTour ViewModel — a thin, synchronous `StateFlow` wrapper over the pure `ShiftTour`
 * definitions, in the same shape as `OnboardingViewModel` (no `viewModelScope`, no clock).
 * It sequences the three steps and owns the seen-flag; the platform renders the overlay,
 * drives the step-2 controls, and persists [ShiftTourUiState.seen].
 *
 * This tour is independent of every other tour: it has its OWN seen-key
 * store on each platform (so persisting one never clobbers the other). The host auto-starts
 * it the first time the worker lands on My Shifts, and re-opens it
 * from the My-Shifts help button or the Settings row.
 */
class ShiftTourViewModel(
    initialSeen: Set<String> = emptySet(),
) : ViewModel() {
    private var seen: Set<String> = initialSeen

    // -1 = not active; otherwise an index into ShiftTour.STEPS.
    private var step: Int = -1

    private val _uiState = MutableStateFlow(snapshot())
    val uiState: StateFlow<ShiftTourUiState> = _uiState.asStateFlow()

    private val active: Boolean
        get() = step in ShiftTour.STEPS.indices

    private fun snapshot(): ShiftTourUiState =
        ShiftTourUiState(
            active = active,
            step = if (active) ShiftTour.STEPS[step] else null,
            stepIndex = if (active) step + 1 else 0,
            stepCount = ShiftTour.STEP_COUNT,
            canGoBack = active && step > 0,
            isLastStep = active && step == ShiftTour.STEPS.lastIndex,
            seen = seen,
        )

    private fun emit() {
        _uiState.value = snapshot()
    }

    /**
     * Begin the tour if it has not run yet and it is not already showing. A no-op once the
     * worker has finished or skipped it, so the host can call it freely on every My-Shifts
     * landing (mirrors `OnboardingViewModel.start`).
     */
    fun autoStart() {
        if (ShiftTour.shouldAutoShow(seen) && !active) {
            step = 0
            emit()
        }
    }

    /**
     * Re-open the tour on demand (the My-Shifts help button, or the Settings row), even
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
        seen = seen + ShiftTour.DONE_KEY
    }
}
