package com.pennhousing.shift.ui.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember

/**
 * The single entry point for moving between root destinations.
 *
 * Every move goes through [navigate], including back, so a destination that must not be
 * left silently gets one guard rather than one per call site. That matters: the unsaved
 * Preferences guard used to hang off the forward-navigation helper only, so the system
 * back button and the break-window banner both walked out of a dirty Preferences tab and
 * discarded the edits.
 */
internal class ShiftNavigator(
    private val state: ShiftNavigationState,
    private val canLeave: (from: ShiftDestination, to: ShiftDestination) -> Boolean,
    private val onBlocked: (ShiftDestination) -> Unit,
) {
    val current: ShiftDestination get() = state.current

    /**
     * Move to [to], unless the current destination refuses to be left. A refusal hands the
     * requested destination to [onBlocked] so the host can raise its confirmation sheet and
     * later resolve it with [navigateUnchecked].
     */
    fun navigate(to: ShiftDestination) {
        if (to == state.current) return
        if (canLeave(state.current, to)) state.current = to else onBlocked(to)
    }

    /**
     * Back returns to the start destination. Once there, this does nothing and the
     * unhandled back press falls through to the system, exiting the app.
     */
    fun goBack() {
        if (state.current != state.startRoute) navigate(state.startRoute)
    }

    /**
     * Move without consulting the guard. Only for resolving a move the guard already
     * blocked, once the worker has chosen to save or discard.
     */
    fun navigateUnchecked(to: ShiftDestination) {
        state.current = to
    }
}

@Composable
internal fun rememberShiftNavigator(
    state: ShiftNavigationState,
    canLeave: (from: ShiftDestination, to: ShiftDestination) -> Boolean,
    onBlocked: (ShiftDestination) -> Unit,
): ShiftNavigator = remember(state) { ShiftNavigator(state, canLeave, onBlocked) }
