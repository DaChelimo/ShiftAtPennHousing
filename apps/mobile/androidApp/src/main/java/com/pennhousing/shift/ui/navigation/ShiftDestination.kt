package com.pennhousing.shift.ui.navigation

import androidx.navigation3.runtime.NavKey
import kotlinx.serialization.Serializable

/**
 * Every root-level surface the app can show, for a worker or a manager.
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

    /**
     * MANAGER ONLY — the Allied coverage inbox (BSpec §5.4a). A manager's start destination,
     * because it is the one surface where a delay means a desk goes empty.
     */
    @Serializable data object Coverage : ShiftDestination

    /**
     * MANAGER ONLY — per-worker weekly hours against the cap for the viewed house
     * (docs/manager-app/SPEC.md §6.5).
     */
    @Serializable data object Hours : ShiftDestination

    companion object {
        /** A worker's start destination: back from anywhere else returns here before exiting. */
        val START: ShiftDestination = MyShifts

        /**
         * The four frequent destinations carrying their own bottom-bar item. The rest are
         * episodic (Preferences once a semester, Break shifts only during breaks) and live
         * behind the "More" sheet.
         */
        val BOTTOM_BAR: List<ShiftDestination> = listOf(MyShifts, OpenShifts, House, Swaps)

        /**
         * A manager's bottom bar. Coverage leads because it is the reason the app rings.
         *
         * Swaps is deliberately absent (managers do not swap shifts) and My Shifts keeps a
         * slot because managers work desk shifts themselves. Hours is the first row of the
         * "More" sheet rather than a fifth bar item: it is a decision-support surface a
         * manager opens while thinking, not one they tap between other tasks. Preferences is
         * absent entirely; managers do not submit shift preferences.
         */
        val MANAGER_BOTTOM_BAR: List<ShiftDestination> = listOf(Coverage, House, OpenShifts, MyShifts)

        /**
         * An SM's bottom bar. Same as a manager's minus Coverage, because the Allied ladder
         * never routes to an SM and the tab would be permanently empty
         * (docs/manager-app/SPEC.md §5).
         */
        val STUDENT_MANAGER_BOTTOM_BAR: List<ShiftDestination> = listOf(MyShifts, OpenShifts, House, Hours)

        /**
         * Destinations that light the "More" item up as selected: the episodic ones, which
         * have no bottom-bar item of their own.
         *
         * [Hours] is here for a manager (whose bar omits it) and NOT for an SM (whose bar
         * includes it). Membership is computed per role by [moreSelects] rather than being a
         * single constant, because a destination that is both in the bar and in MORE_SELECTS
         * lights two items at once.
         */
        val MORE_SELECTS: Set<ShiftDestination> = setOf(Updates, Preferences, BreakShifts, Settings)

        /** Every destination, each of which owns its own back stack. */
        val ALL: Set<ShiftDestination> =
            setOf(
                MyShifts, OpenShifts, House, Swaps, Updates, Preferences, BreakShifts, Settings,
                Coverage, Hours,
            )

        /**
         * The bottom bar for this user. [hasCoverage] and [isStudentManager] come from
         * `ManagerCapabilities`; a plain worker gets exactly today's bar, unchanged.
         */
        fun bottomBarFor(
            hasCoverage: Boolean,
            isStudentManager: Boolean,
        ): List<ShiftDestination> =
            when {
                hasCoverage -> MANAGER_BOTTOM_BAR
                isStudentManager -> STUDENT_MANAGER_BOTTOM_BAR
                else -> BOTTOM_BAR
            }

        /** The start destination for this user: Coverage for a manager, My Shifts otherwise. */
        fun startFor(hasCoverage: Boolean): ShiftDestination = if (hasCoverage) Coverage else MyShifts

        /**
         * Which destinations light the "More" item, given the bar this user has. Anything in
         * the bar is excluded, so no destination ever lights two items.
         */
        fun moreSelects(bar: List<ShiftDestination>): Set<ShiftDestination> =
            (MORE_SELECTS + Hours) - bar.toSet()
    }
}
