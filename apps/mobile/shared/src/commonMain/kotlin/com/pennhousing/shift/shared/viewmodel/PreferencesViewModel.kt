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
import kotlinx.datetime.LocalDate
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
    /** Just the period name (e.g. "SUMMER 2026") — the eyebrow, with the deadline split out. */
    val periodLabel: String,
    /** The deadline rendered as a compact chip (e.g. "Due May 29 23:59"); null if unknown. */
    val deadlineChip: String?,
    val banner: PreferenceBanner,
    /** The screen is read-only ONLY once the deadline has passed (submitting no longer locks). */
    val readOnly: Boolean,
    /** A submission already exists this period — drives banner copy + the discard baseline. */
    val hasSubmitted: Boolean,
    /** The current edits differ from the last-saved state (initial period rows or last submit). */
    val isDirty: Boolean,
    /** Show the submit button: first time (never submitted) or whenever there are unsaved edits. */
    val showSubmit: Boolean,
    /** Show the discard button: only when there are unsaved edits to revert. */
    val showDiscard: Boolean,
    /** "Save changes" when re-submitting edits, else "Submit preferences". */
    val submitLabel: String,
    val optedOut: Boolean,
    val brush: PrefBrush,
    val targetHours: Int,
    val targetMeter: TargetMeter,
    val weekStrip: PrefWeekStrip,
    val day: PrefDayView,
    /** The active period id, for the manager deadline-setter call. */
    val periodId: String,
    /**
     * The signed-in user may set this period's preference-submission deadline (BSpec §4.2,
     * sm/hm/bm). Drives a manager-only control; a plain worker never sees it. The server is
     * authoritative (rejects a non-manager, an already-published period, or a deadline after
     * the period start).
     */
    val canSetDeadline: Boolean,
    /** The latest date the deadline may fall on (the period start); null when unknown. */
    val deadlineMaxDate: LocalDate?,
)

/**
 * Preference-submission ViewModel — a thin `StateFlow` wrapper over the pure
 * `preferences/` builders, in the [CalendarViewModel] shape (synchronous, no
 * `viewModelScope`; runs on the JVM host). The [period] snapshot is injected once
 * and the brush/grid/target/opt-out are the mutable editing state; every emission
 * is recomputed by the pure builders. No clock is read — the period (incl. its
 * deadline label + `deadlinePassed`/`submitted` flags) is supplied by the data layer.
 *
 * EDITABLE UNTIL THE DEADLINE: submitting is NOT final — the worker can re-edit and
 * re-submit until `deadlinePassed`. The only read-only state is the closed window.
 * The VM tracks a "saved" baseline (the period's initial rows, advanced on each
 * [submit]); [isDirty] = the current edits differ from it. [revert] discards back to
 * the baseline. Writes are optimistic-local (mirroring the Shifts screen's claim/drop):
 * the actual `submit-preferences` POST is the host's `onSubmit`/`onSubmitPreferences`.
 */
class PreferencesViewModel(
    private val period: PreferencePeriod,
    /** The user holds a schedule-manager role (sm/hm/bm/rsm); enables the deadline-setter. */
    private val isManager: Boolean = false,
) : ViewModel() {
    // The last-saved state — the period's initial rows, advanced on each [submit].
    private var savedGrid: PreferenceGrid = period.initialGrid()
    private var savedTarget: Int = clampTarget(period.targetHours, period.capHours)
    private var savedOptedOut: Boolean = period.optedOut
    private var savedPayload: SubmitPreferencesPayload = buildSubmitPayload(period, savedGrid, savedTarget, savedOptedOut)

    // The live editing state.
    private var grid: PreferenceGrid = savedGrid
    private var selectedDay: Int = 0
    private var brush: PrefBrush = PrefBrush.PREFERRED
    private var target: Int = savedTarget
    private var optedOut: Boolean = savedOptedOut
    private var hasSubmitted: Boolean = period.submitted

    // The operation the ACTIVE paint-drag applies to every block it sweeps, decided once
    // at [beginPaintDrag] from the first block and held for the whole gesture (null between
    // drags). "Decide by drag start": if the drag begins on a block already holding the
    // active brush the whole sweep ERASES (→ AVAILABLE), otherwise it paints the brush.
    private var dragBrush: PrefBrush? = null

    // The ONLY read-only state: the deadline has passed (a late write would be rejected
    // by the RPC anyway). Submitting no longer locks — the worker edits until then.
    private val readOnly: Boolean = period.deadlinePassed

    private val _uiState = MutableStateFlow(snapshot())
    val uiState: StateFlow<PreferencesUiState> = _uiState.asStateFlow()

    private fun currentPayload(): SubmitPreferencesPayload = buildSubmitPayload(period, grid, target, optedOut)

    /** Dirty iff editable AND the flattened edits differ from the last-saved state. */
    private fun computeDirty(): Boolean = !readOnly && currentPayload() != savedPayload

    private fun snapshot(): PreferencesUiState {
        val context =
            listOfNotNull(period.periodLabel, period.deadlineLabel)
                .joinToString(" · ")
                .uppercase()
        val dirty = computeDirty()
        return PreferencesUiState(
            title = "Preferences",
            contextLabel = context,
            periodLabel = period.periodLabel.uppercase(),
            deadlineChip = period.deadlineLabel,
            banner = buildPreferenceBanner(period.copy(submitted = hasSubmitted), dirty),
            readOnly = readOnly,
            hasSubmitted = hasSubmitted,
            isDirty = dirty,
            showSubmit = !readOnly && (dirty || !hasSubmitted),
            showDiscard = !readOnly && dirty,
            // Softer "Save changes" for re-edits (less final than "Submit"), first-time stays "Submit".
            submitLabel = if (hasSubmitted && dirty) "Save changes" else "Submit preferences",
            optedOut = optedOut,
            brush = brush,
            targetHours = target,
            targetMeter = buildTargetMeter(target, optedOut, period.capHours),
            weekStrip = buildPrefWeekStrip(period, grid, selectedDay),
            day = buildPrefDay(period, grid, selectedDay),
            periodId = period.periodId,
            canSetDeadline = isManager,
            deadlineMaxDate = period.startDate,
        )
    }

    fun selectDay(index: Int) {
        selectedDay = index
        _uiState.value = snapshot()
    }

    fun setBrush(value: PrefBrush) {
        if (readOnly) return
        brush = value
        _uiState.value = snapshot()
    }

    /**
     * The brush a gesture STARTING on [blockId] applies: erase (→ AVAILABLE) if the block
     * already holds the active brush, otherwise paint the active brush. This is what makes a
     * second sweep over blocks you already painted (in the same mode) clear them, instead of
     * forcing a trip to the Available brush.
     */
    private fun toggledBrushFor(blockId: String): PrefBrush =
        if (grid.statusOf(blockId) == brush) PrefBrush.AVAILABLE else brush

    /**
     * Tap one block: toggle it between the active brush and AVAILABLE (no-op when read-only
     * or opted out). Tapping a block that already holds the active brush clears it.
     */
    fun paint(blockId: String) {
        if (readOnly || optedOut) return
        grid = grid.paint(blockId, toggledBrushFor(blockId))
        _uiState.value = snapshot()
    }

    /**
     * Begin a paint-drag on [blockId]: decide the whole gesture's operation from this first
     * block (paint vs erase, see [toggledBrushFor]), apply it to the block, and hold it for
     * every [paintRange] until [endPaintDrag]. No-op when read-only or opted out.
     */
    fun beginPaintDrag(blockId: String) {
        if (readOnly || optedOut) return
        val op = toggledBrushFor(blockId)
        dragBrush = op
        grid = grid.paint(blockId, op)
        _uiState.value = snapshot()
    }

    /**
     * Apply the active drag's operation to every block of the selected day between
     * [fromBlockId] and [toBlockId] (inclusive, either order) — the live drag sweep. The
     * operation is the one decided at [beginPaintDrag] (paint or erase); if no drag is in
     * flight it falls back to deciding from [fromBlockId] (direct/programmatic calls). No-op
     * when read-only, opted out, or ids are unknown.
     */
    fun paintRange(
        fromBlockId: String,
        toBlockId: String,
    ) {
        if (readOnly || optedOut) return
        val dayBlocks = period.days.getOrElse(selectedDay) { emptyList() }
        val fromIdx = dayBlocks.indexOfFirst { it.blockId == fromBlockId }
        val toIdx = dayBlocks.indexOfFirst { it.blockId == toBlockId }
        if (fromIdx < 0 || toIdx < 0) return
        val op = dragBrush ?: toggledBrushFor(fromBlockId)
        var g = grid
        for (i in minOf(fromIdx, toIdx)..maxOf(fromIdx, toIdx)) g = g.paint(dayBlocks[i].blockId, op)
        grid = g
        _uiState.value = snapshot()
    }

    /** End the active paint-drag: forget its decided operation so the next drag re-decides. */
    fun endPaintDrag() {
        dragBrush = null
    }

    fun incrementTarget() {
        if (readOnly || optedOut) return
        target = clampTarget(target + PREF_TARGET_STEP, period.capHours)
        _uiState.value = snapshot()
    }

    fun decrementTarget() {
        if (readOnly || optedOut) return
        target = clampTarget(target - PREF_TARGET_STEP, period.capHours)
        _uiState.value = snapshot()
    }

    fun toggleOptedOut() {
        if (readOnly) return
        optedOut = !optedOut
        _uiState.value = snapshot()
    }

    /** The `submit-preferences` Edge-Function payload for the current edits. */
    fun submitPayload(): SubmitPreferencesPayload = currentPayload()

    /**
     * Optimistic local submit — marks the period submitted and re-baselines to the current
     * edits (so [isDirty] clears) WITHOUT locking the screen; the worker can keep editing
     * until the deadline. The actual Edge-Function POST is the (untested) data-layer concern.
     */
    fun submit() {
        if (readOnly) return
        hasSubmitted = true
        savedGrid = grid
        savedTarget = target
        savedOptedOut = optedOut
        savedPayload = currentPayload()
        _uiState.value = snapshot()
    }

    /** Discard unsaved edits — revert the grid/target/opt-out to the last-saved state. */
    fun revert() {
        if (readOnly) return
        grid = savedGrid
        target = savedTarget
        optedOut = savedOptedOut
        _uiState.value = snapshot()
    }
}
