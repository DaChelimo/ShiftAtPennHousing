package com.pennhousing.shift.shared.viewmodel

import androidx.lifecycle.ViewModel
import com.pennhousing.shift.shared.preferences.PrefBrush
import com.pennhousing.shift.shared.preferences.PrefDayView
import com.pennhousing.shift.shared.preferences.PrefWeekStrip
import com.pennhousing.shift.shared.preferences.PreferenceBanner
import com.pennhousing.shift.shared.preferences.PreferenceGrid
import com.pennhousing.shift.shared.preferences.PreferencePeriod
import com.pennhousing.shift.shared.preferences.PREF_TARGET_STEP
import com.pennhousing.shift.shared.preferences.SubmitPreferencesPayload
import com.pennhousing.shift.shared.preferences.TargetMeter
import com.pennhousing.shift.shared.preferences.buildPreferenceBanner
import com.pennhousing.shift.shared.preferences.buildPrefDay
import com.pennhousing.shift.shared.preferences.buildPrefWeekStrip
import com.pennhousing.shift.shared.preferences.buildSubmitPayload
import com.pennhousing.shift.shared.preferences.buildTargetMeter
import com.pennhousing.shift.shared.preferences.clampTarget
import com.pennhousing.shift.shared.preferences.initialGrid
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class PreferencesUiState(
    val title: String,
    val contextLabel: String,
    val banner: PreferenceBanner,
    val submitted: Boolean,
    val optedOut: Boolean,
    val brush: PrefBrush,
    val targetHours: Int,
    val targetMeter: TargetMeter,
    val weekStrip: PrefWeekStrip,
    val day: PrefDayView,
)

/**
 * Preference-submission ViewModel — a thin `StateFlow` wrapper over the pure
 * `preferences/` builders, in the [CalendarViewModel] shape (synchronous, no
 * `viewModelScope`; runs on the JVM host). The [period] snapshot is injected once
 * and the brush/grid/target/opt-out are the mutable editing state; every emission
 * is recomputed by the pure builders. No clock is read — the period (incl. its
 * deadline label + `submitted` read-only flag) is supplied by the data layer.
 *
 * Writes are optimistic-local (mirroring the Shifts screen's claim/drop): [submit]
 * builds the `submit-preferences` payload and flips to the read-only submitted state;
 * the actual Edge-Function POST is the (untested) data-layer concern.
 */
class PreferencesViewModel(
    private val period: PreferencePeriod,
) : ViewModel() {
    private var grid: PreferenceGrid = period.initialGrid()
    private var selectedDay: Int = 0
    private var brush: PrefBrush = PrefBrush.PREFERRED
    private var target: Int = clampTarget(period.targetHours, period.capHours)
    private var optedOut: Boolean = period.optedOut
    private var submitted: Boolean = period.submitted

    private val _uiState = MutableStateFlow(snapshot())
    val uiState: StateFlow<PreferencesUiState> = _uiState.asStateFlow()

    private fun snapshot(): PreferencesUiState {
        val context =
            listOfNotNull(period.periodLabel, period.deadlineLabel)
                .joinToString(" · ")
                .uppercase()
        return PreferencesUiState(
            title = "Preferences",
            contextLabel = context,
            banner = buildPreferenceBanner(period.copy(submitted = submitted)),
            submitted = submitted,
            optedOut = optedOut,
            brush = brush,
            targetHours = target,
            targetMeter = buildTargetMeter(target, optedOut, period.capHours),
            weekStrip = buildPrefWeekStrip(period, grid, selectedDay),
            day = buildPrefDay(period, grid, selectedDay),
        )
    }

    fun selectDay(index: Int) {
        selectedDay = index
        _uiState.value = snapshot()
    }

    fun setBrush(value: PrefBrush) {
        if (submitted) return
        brush = value
        _uiState.value = snapshot()
    }

    /** Paint one block with the current brush (no-op when read-only or opted out). */
    fun paint(blockId: String) {
        if (submitted || optedOut) return
        grid = grid.paint(blockId, brush)
        _uiState.value = snapshot()
    }

    fun incrementTarget() {
        if (submitted || optedOut) return
        target = clampTarget(target + PREF_TARGET_STEP, period.capHours)
        _uiState.value = snapshot()
    }

    fun decrementTarget() {
        if (submitted || optedOut) return
        target = clampTarget(target - PREF_TARGET_STEP, period.capHours)
        _uiState.value = snapshot()
    }

    fun toggleOptedOut() {
        if (submitted) return
        optedOut = !optedOut
        _uiState.value = snapshot()
    }

    /** The `submit-preferences` Edge-Function payload for the current edits. */
    fun submitPayload(): SubmitPreferencesPayload = buildSubmitPayload(period, grid, target, optedOut)

    /** Optimistic local submit → the read-only "submitted" state (data-layer POST is TODO). */
    fun submit() {
        if (submitted) return
        submitted = true
        _uiState.value = snapshot()
    }
}
