package com.pennhousing.shift.ui.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue

/**
 * The Assistant has no bottom-bar item of its own — it opens from the My-Shifts FAB or the
 * More sheet, from whichever destination the worker was on — so its back button needs
 * somewhere to return to that isn't always My Shifts. [open] captures the destination right
 * before the move, since `current` is already [ShiftDestination.Assistant] by the time the
 * Assistant's own header renders and could no longer supply it.
 */
internal class AssistantReturnState(private val nav: ShiftNavigator) {
    var previous: ShiftDestination by mutableStateOf(ShiftDestination.MyShifts)
        private set

    fun open() {
        previous = nav.current
        nav.navigate(ShiftDestination.Assistant)
    }

    fun returnToPrevious() {
        nav.navigate(previous)
    }
}

@Composable
internal fun rememberAssistantReturnState(nav: ShiftNavigator): AssistantReturnState =
    remember(nav) { AssistantReturnState(nav) }
