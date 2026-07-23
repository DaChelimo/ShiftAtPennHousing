package com.pennhousing.shift.ui.navigation

import androidx.compose.runtime.mutableStateOf
import androidx.navigation3.runtime.NavBackStack
import androidx.navigation3.runtime.NavKey
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The Assistant has no bottom-bar item of its own, so its back button needs somewhere to
 * return to that isn't hardcoded to My Shifts — wherever the worker was before they opened
 * it (the FAB, only reachable from My Shifts, or the More sheet, reachable from anywhere).
 */
class AssistantReturnStateTest {
    private fun navigator(start: ShiftDestination = ShiftDestination.START): ShiftNavigator {
        val state =
            ShiftNavigationState(
                startRoute = start,
                current = mutableStateOf(start),
                backStacks = emptyMap<ShiftDestination, NavBackStack<NavKey>>(),
            )
        return ShiftNavigator(state = state, canLeave = { _, _ -> true }, onBlocked = {})
    }

    @Test
    fun `open captures the current destination before moving to Assistant`() {
        val nav = navigator()
        nav.navigate(ShiftDestination.Swaps)
        val assistantReturn = AssistantReturnState(nav)

        assistantReturn.open()

        assertEquals(ShiftDestination.Assistant, nav.current)
        assertEquals(ShiftDestination.Swaps, assistantReturn.previous)
    }

    @Test
    fun `returnToPrevious navigates back to whatever was captured, not always My Shifts`() {
        val nav = navigator()
        nav.navigate(ShiftDestination.House)
        val assistantReturn = AssistantReturnState(nav)
        assistantReturn.open()

        assistantReturn.returnToPrevious()

        assertEquals(ShiftDestination.House, nav.current)
    }

    @Test
    fun `opening from the start destination returns to the start destination`() {
        val nav = navigator()
        val assistantReturn = AssistantReturnState(nav)

        assistantReturn.open()
        assistantReturn.returnToPrevious()

        assertEquals(ShiftDestination.MyShifts, nav.current)
    }
}
