package com.pennhousing.shift.shared.viewmodel

import androidx.lifecycle.ViewModel
import com.pennhousing.shift.shared.onboarding.CoachMark
import com.pennhousing.shift.shared.onboarding.Onboarding
import com.pennhousing.shift.shared.onboarding.TipTrigger
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * What the onboarding overlay should render right now. [current] null means nothing is
 * showing. When [isTour] is true the overlay draws the welcome-tour chrome (Back / Next /
 * Skip + a [stepIndex] of [stepCount] progress readout; [canGoBack] gates the Back
 * control); when false it is a single dismissible tip. [seen] is the durable set the
 * platform persists whenever it changes.
 */
data class OnboardingUiState(
    val current: CoachMark? = null,
    val isTour: Boolean = false,
    val stepIndex: Int = 0,
    val stepCount: Int = 0,
    val canGoBack: Boolean = false,
    val seen: Set<String> = emptySet(),
)

/**
 * Onboarding ViewModel — a thin, synchronous `StateFlow` wrapper over the pure
 * `onboarding/` definitions, in the [SettingsViewModel] shape (no `viewModelScope`, no
 * clock). It sequences the first-run welcome tour and raises one-time contextual tips;
 * the platform renders the overlay and persists [OnboardingUiState.seen].
 *
 * The seen-key set is injected at construction (read from SharedPreferences / UserDefaults
 * at launch) and grows as the worker finishes/skips the tour and dismisses tips. Only one
 * coach-mark is ever active: a tip is ignored while the tour runs (it re-triggers on the
 * next visit to that surface), and the tour never starts while a tip is up.
 */
class OnboardingViewModel(
    initialSeen: Set<String> = emptySet(),
) : ViewModel() {
    private var seen: Set<String> = initialSeen

    // -1 = the welcome tour is not active; otherwise an index into Onboarding.WELCOME_TOUR.
    private var tourStep: Int = -1

    // The active contextual tip, or null. Mutually exclusive with an active tour.
    private var tip: CoachMark? = null

    private val _uiState = MutableStateFlow(snapshot())
    val uiState: StateFlow<OnboardingUiState> = _uiState.asStateFlow()

    private val tourActive: Boolean
        get() = tourStep in Onboarding.WELCOME_TOUR.indices

    private val current: CoachMark?
        get() = if (tourActive) Onboarding.WELCOME_TOUR[tourStep] else tip

    private fun snapshot(): OnboardingUiState =
        OnboardingUiState(
            current = current,
            isTour = tourActive,
            stepIndex = if (tourActive) tourStep + 1 else 0,
            stepCount = if (tourActive) Onboarding.WELCOME_TOUR.size else 0,
            canGoBack = tourActive && tourStep > 0,
            seen = seen,
        )

    private fun emit() {
        _uiState.value = snapshot()
    }

    /** Begin the first-run welcome tour if it has not run yet and nothing else is showing. */
    fun start() {
        if (Onboarding.shouldShowWelcomeTour(seen) && !tourActive && tip == null) {
            tourStep = 0
            emit()
        }
    }

    /** Advance the welcome tour; finishing the last step completes it. */
    fun next() {
        if (!tourActive) return
        tourStep += 1
        if (!tourActive) finishTour()
        emit()
    }

    /** Step the welcome tour back one; a no-op on the first step (there is nowhere to go). */
    fun back() {
        if (!tourActive || tourStep == 0) return
        tourStep -= 1
        emit()
    }

    /** Skip the rest of the welcome tour (counts as done, so it never fires again). */
    fun skipTour() {
        if (!tourActive) return
        finishTour()
        emit()
    }

    private fun finishTour() {
        tourStep = -1
        seen = seen + Onboarding.WELCOME_DONE_KEY
    }

    /**
     * Replay the welcome tour on demand (e.g. a "Show app tour again" row in Settings).
     * Clears the done-flag and restarts from step one, overriding whatever else is
     * showing (an open tip is dismissed unseen, so it can still surface again later).
     */
    fun replayTour() {
        seen = seen - Onboarding.WELCOME_DONE_KEY
        tip = null
        tourStep = 0
        emit()
    }

    /**
     * Raise the one-time tip for [trigger] if it is due (not seen, welcome tour finished)
     * and nothing else is showing. A no-op otherwise, so callers can fire it freely on
     * every visit to a surface.
     */
    fun triggerTip(trigger: TipTrigger) {
        if (tourActive || tip != null) return
        val due = Onboarding.tipFor(trigger, seen) ?: return
        tip = due
        emit()
    }

    /** Dismiss the current tip and remember it so it does not fire again. */
    fun dismissTip() {
        val shown = tip ?: return
        seen = seen + shown.key
        tip = null
        emit()
    }
}
