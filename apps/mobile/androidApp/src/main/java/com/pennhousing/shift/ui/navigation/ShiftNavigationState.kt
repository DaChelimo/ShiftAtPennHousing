package com.pennhousing.shift.ui.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSerializable
import androidx.compose.runtime.setValue
import androidx.navigation3.runtime.NavBackStack
import androidx.navigation3.runtime.NavEntry
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.rememberDecoratedNavEntries
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.savedstate.compose.serialization.serializers.MutableStateSerializer

/**
 * One back stack per root destination, following Google's multiple-back-stacks recipe
 * (developer.android.com/guide/navigation/navigation-3/recipes/multiple-backstacks).
 *
 * Two things this buys over the `var selectedIndex: Int` it replaces:
 *
 * 1. Each destination keeps its own `SaveableStateHolder`, so leaving the House grid and
 *    coming back restores its scroll position and week selection. The old `when` statement
 *    discarded the whole subtree on every tab switch and rebuilt it from scratch.
 * 2. Real back navigation: back from any destination returns to [ShiftDestination.START],
 *    and only then exits the app.
 *
 * Every destination is top-level today, so each stack holds a single entry. The stacks are
 * what a nested route (a detail screen under House, say) would push onto, so adding one
 * later does not mean restructuring navigation.
 */
internal class ShiftNavigationState(
    val startRoute: ShiftDestination,
    current: MutableState<ShiftDestination>,
    val backStacks: Map<ShiftDestination, NavBackStack<NavKey>>,
) {
    /** The destination currently on screen. */
    var current: ShiftDestination by current

    /**
     * The start destination's entries, plus the current destination's when it is not the
     * start. Keeping the start entry underneath is what makes back resolve to it.
     */
    @Composable
    fun decoratedEntries(entryProvider: (NavKey) -> NavEntry<NavKey>): List<NavEntry<NavKey>> {
        val decorated =
            backStacks.mapValues { (_, stack) ->
                rememberDecoratedNavEntries(
                    backStack = stack,
                    entryDecorators = listOf(rememberSaveableStateHolderNavEntryDecorator()),
                    entryProvider = entryProvider,
                )
            }
        val inUse = if (current == startRoute) listOf(startRoute) else listOf(startRoute, current)
        return inUse.flatMap { decorated[it].orEmpty() }
    }
}

@Composable
internal fun rememberShiftNavigationState(
    startRoute: ShiftDestination = ShiftDestination.START,
    destinations: Set<ShiftDestination> = ShiftDestination.ALL,
): ShiftNavigationState {
    // Serialized rather than plain `remember` so the selected destination survives process
    // death alongside the back stacks themselves. ShiftDestination is a @Serializable sealed
    // hierarchy, so it supplies its own serializer.
    val current =
        rememberSerializable(
            startRoute,
            serializer = MutableStateSerializer(ShiftDestination.serializer()),
        ) { mutableStateOf(startRoute) }

    val backStacks = destinations.associateWith { rememberNavBackStack(it) }

    return remember(startRoute, destinations) {
        ShiftNavigationState(startRoute = startRoute, current = current, backStacks = backStacks)
    }
}
