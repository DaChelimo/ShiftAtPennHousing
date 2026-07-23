package com.pennhousing.shift.ui.navigation

import androidx.navigation3.runtime.NavKey
import kotlinx.serialization.Serializable

/**
 * Every root-level surface the worker app can show.
 *
 * Replaces the nine `TAB_*` integer constants this screen used to navigate by. Those
 * carried an invariant no type could check: their values had to match each tab's render
 * position, so a reordered tab row silently underlined the wrong tab. The "More" item also
 * derived its selected state from the ordinal range `TAB_UPDATES..TAB_SETTINGS`, which
 * quietly coupled selection highlighting to declaration order.
 *
 * These are Navigation 3 [NavKey]s, and `@Serializable` because Nav3 persists back stacks
 * across process death by serializing their keys.
 */
@Serializable
sealed interface ShiftDestination : NavKey {
    /** The chronological Personal Calendar (BSpec §5.6). The app's start destination. */
    @Serializable data object MyShifts : ShiftDestination

    /** Open shifts, with the "My House" / "Others" sub-tabs (§5.6 Tabs 2+3). */
    @Serializable data object OpenShifts : ShiftDestination

    /** The house schedule grid (§11.4). */
    @Serializable data object House : ShiftDestination

    /** Incoming / outgoing swap review (swaps DESIGN §6). */
    @Serializable data object Swaps : ShiftDestination

    /** The §10.1 notifications feed. */
    @Serializable data object Updates : ShiftDestination

    /** Shift preferences for the upcoming period (§4). */
    @Serializable data object Preferences : ShiftDestination

    /** The break claim calendar (§4.4). */
    @Serializable data object BreakShifts : ShiftDestination

    @Serializable data object Settings : ShiftDestination

    /** The Desk Assistant chat. */
    @Serializable data object Assistant : ShiftDestination

    companion object {
        /** The start destination: back from anywhere else returns here before exiting. */
        val START: ShiftDestination = MyShifts

        /**
         * The four frequent destinations carrying their own bottom-bar item. The rest are
         * episodic (Preferences once a semester, Break shifts only during breaks) and live
         * behind the "More" sheet.
         */
        val BOTTOM_BAR: List<ShiftDestination> = listOf(MyShifts, OpenShifts, House, Swaps)

        /**
         * Destinations that light the "More" item up as selected: the episodic ones plus
         * [Assistant], since the Assistant is only reachable from the My-Shifts FAB or the
         * More sheet and has no bottom-bar item of its own.
         */
        val MORE_SELECTS: Set<ShiftDestination> = setOf(Updates, Preferences, BreakShifts, Settings, Assistant)

        /** Every destination, each of which owns its own back stack. */
        val ALL: Set<ShiftDestination> =
            setOf(MyShifts, OpenShifts, House, Swaps, Updates, Preferences, BreakShifts, Settings, Assistant)
    }
}
