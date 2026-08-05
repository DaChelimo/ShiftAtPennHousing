package com.pennhousing.shift.shared.viewmodel

import androidx.lifecycle.ViewModel
import com.pennhousing.shift.shared.onboarding.PreferencesTour
import com.pennhousing.shift.shared.onboarding.PreferencesTourStep
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * What the interactive Preferences tour should render right now. [active] false means nothing
 * is showing. [step] is the current step's copy (null when inactive); [stepIndex] is 1-based
 * over [stepCount]; [canGoBack] gates the Back control; [isLastStep] flips the primary button
 * from Next to Done. [seen] is the durable set the platform persists.
 *
 * The step-2 interactive state (which sample blocks are painted, with which brush) and the
 * step-1/step-3 live controls (brush selection, target stepper) live natively per platform for
 * smooth binding; they are not modeled here. The pure formatting math they need is in
 * `PreferencesTour` (`paintSummaryLine` / `durationLabel` / `timeLabel` / `targetLabel` /
 * `targetFraction`).
 */
data class PreferencesTourUiState(
    val active: Boolean = false,
    val step: PreferencesTourStep? = null,
    val stepIndex: Int = 0,
    val stepCount: Int = PreferencesTour.STEP_COUNT,
    val canGoBack: Boolean = false,
    val isLastStep: Boolean = false,
    val seen: Set<String> = emptySet(),
)

/**
 * PreferencesTour ViewModel — a thin, synchronous `StateFlow` wrapper over the pure
 * `PreferencesTour` definitions, in the same shape as `ShiftTourViewModel` (no `viewModelScope`,
 * no clock). It sequences the three steps and owns the seen-flag; the platform renders the
 * overlay, drives the step controls, and persists [PreferencesTourUiState.seen].
 *
 * This tour is independent of `ShiftTour`: it has its OWN seen-key
 * store on each platform (so persisting one never clobbers the others). The host auto-starts it
 * the first time the worker lands on Preferences, and re-opens it from the Preferences help
 * button or the Settings row.
 */
class PreferencesTourViewModel(
    initialSeen: Set<String> = emptySet(),
) : ViewModel() {
    private var seen: Set<String> = initialSeen

    // -1 = not active; otherwise an index into PreferencesTour.STEPS.
    private var step: Int = -1

    private val _uiState = MutableStateFlow(snapshot())
    val uiState: StateFlow<PreferencesTourUiState> = _uiState.asStateFlow()

    private val active: Boolean
        get() = step in PreferencesTour.STEPS.indices

    private fun snapshot(): PreferencesTourUiState =
        PreferencesTourUiState(
            active = active,
            step = if (active) PreferencesTour.STEPS[step] else null,
            stepIndex = if (active) step + 1 else 0,
            stepCount = PreferencesTour.STEP_COUNT,
            canGoBack = active && step > 0,
            isLastStep = active && step == PreferencesTour.STEPS.lastIndex,
            seen = seen,
        )

    private fun emit() {
        _uiState.value = snapshot()
    }

    /**
     * Begin the tour if it has not run yet and it is not already showing. A no-op once the
     * worker has finished or skipped it, so the host can call it freely on every Preferences
     * landing (mirrors `ShiftTourViewModel.autoStart`).
     */
    fun autoStart() {
        if (PreferencesTour.shouldAutoShow(seen) && !active) {
            step = 0
            emit()
        }
    }

    /**
     * Re-open the tour on demand (the Preferences help button, or the Settings row), even after
     * it has been completed. Restarts from step one; does not clear the done-flag on its own
     * (finishing again re-sets it, and a replay in progress simply shows).
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
        seen = seen + PreferencesTour.DONE_KEY
    }
}
