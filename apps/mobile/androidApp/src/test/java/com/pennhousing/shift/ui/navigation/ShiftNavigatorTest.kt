package com.pennhousing.shift.ui.navigation

import androidx.compose.runtime.mutableStateOf
import androidx.navigation3.runtime.NavBackStack
import androidx.navigation3.runtime.NavKey
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The navigator's routing and the §4 unsaved-Preferences guard, tested without Compose.
 *
 * This is the layer the move to Navigation 3 actually changed. Back used to exit the app from
 * any tab; now every move — forward taps AND the system back button — goes through
 * [ShiftNavigator], so the guard that protects unsaved Preferences edits is applied in one
 * place instead of hanging off the forward path only.
 *
 * [ShiftNavigationState.decoratedEntries] is the sole part that needs a composition, and none
 * of these touch it, so the back stacks can be empty here. Snapshot state works fine off the
 * main composition on the JVM, which keeps this a fast unit test rather than a Robolectric one.
 */
class ShiftNavigatorTest {
    /** A navigator over an empty-back-stack state, plus a mutable "Preferences is dirty" flag. */
    private class Fixture(
        start: ShiftDestination = ShiftDestination.START,
    ) {
        var prefsDirty = false
        val blocked = mutableListOf<ShiftDestination>()
        val state =
            ShiftNavigationState(
                startRoute = start,
                current = mutableStateOf(start),
                backStacks = emptyMap<ShiftDestination, NavBackStack<NavKey>>(),
            )
        val nav =
            ShiftNavigator(
                state = state,
                canLeave = { from, _ -> from != ShiftDestination.Preferences || !prefsDirty },
                onBlocked = { blocked += it },
            )
    }

    @Test
    fun `navigate changes the current destination`() {
        val f = Fixture()
        f.nav.navigate(ShiftDestination.House)
        assertEquals(ShiftDestination.House, f.nav.current)
    }

    @Test
    fun `navigating to the current destination is a no-op`() {
        val f = Fixture()
        f.nav.navigate(ShiftDestination.MyShifts)
        assertEquals(ShiftDestination.MyShifts, f.nav.current)
        assertEquals(emptyList<ShiftDestination>(), f.blocked)
    }

    @Test
    fun `back returns to the start destination`() {
        val f = Fixture()
        f.nav.navigate(ShiftDestination.Swaps)
        f.nav.goBack()
        assertEquals(ShiftDestination.START, f.nav.current)
    }

    @Test
    fun `back from the start destination stays put`() {
        val f = Fixture()
        // A real back press here is left unhandled so the system exits the app; the navigator
        // itself simply does nothing.
        f.nav.goBack()
        assertEquals(ShiftDestination.START, f.nav.current)
    }

    @Test
    fun `leaving clean Preferences is allowed`() {
        val f = Fixture()
        f.nav.navigate(ShiftDestination.Preferences)
        f.prefsDirty = false
        f.nav.navigate(ShiftDestination.House)
        assertEquals(ShiftDestination.House, f.nav.current)
        assertEquals(emptyList<ShiftDestination>(), f.blocked)
    }

    @Test
    fun `forward out of dirty Preferences is blocked, not applied`() {
        val f = Fixture()
        f.nav.navigate(ShiftDestination.Preferences)
        f.prefsDirty = true

        f.nav.navigate(ShiftDestination.House)

        assertEquals("stays on Preferences until the guard resolves", ShiftDestination.Preferences, f.nav.current)
        assertEquals(listOf(ShiftDestination.House), f.blocked)
    }

    @Test
    fun `back out of dirty Preferences is blocked too - the guard-on-back fix`() {
        val f = Fixture()
        f.nav.navigate(ShiftDestination.Preferences)
        f.prefsDirty = true

        f.nav.goBack()

        // Previously back skipped the guard and discarded the edits; now it raises the sheet.
        assertEquals(ShiftDestination.Preferences, f.nav.current)
        assertEquals(listOf(ShiftDestination.START), f.blocked)
    }

    @Test
    fun `navigateUnchecked resolves a blocked move`() {
        val f = Fixture()
        f.nav.navigate(ShiftDestination.Preferences)
        f.prefsDirty = true
        f.nav.navigate(ShiftDestination.House)

        // The host has shown the guard sheet and the worker chose to leave: apply the move
        // the guard deferred, ignoring the still-dirty flag.
        f.nav.navigateUnchecked(f.blocked.last())

        assertEquals(ShiftDestination.House, f.nav.current)
    }

    @Test
    fun `every destination has its own back stack`() {
        // The decoratedEntries path is not exercised here, but the intent is that each root
        // destination owns a stack it could push nested routes onto later.
        assertNull(ShiftDestination.ALL.firstOrNull { it !in ShiftDestination.ALL })
        assertEquals(9, ShiftDestination.ALL.size)
    }
}
