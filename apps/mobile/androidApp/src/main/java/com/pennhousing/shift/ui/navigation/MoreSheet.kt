package com.pennhousing.shift.ui.navigation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.pennhousing.shift.shared.manager.ManagerCapabilities
import com.pennhousing.shift.ui.kit.ShiftBottomSheet
import com.pennhousing.shift.ui.kit.ShiftIcons

/**
 * The "More" overflow sheet — episodic destinations (Preferences once a semester, Break
 * shifts only during breaks, Settings rarely). Rows keep the original tab selectors; the
 * Maestro flows open More first, then tap them. Extracted from `ShiftsScreen.kt` (quarantined
 * God class, AGENTS.md §5.2 — do not grow it back).
 */
@Composable
internal fun MoreSheet(
    capabilities: ManagerCapabilities,
    managerBar: List<ShiftDestination>,
    nav: ShiftNavigator,
    onDismiss: () -> Unit,
) {
    ShiftBottomSheet(onDismiss = onDismiss, title = "More") {
        Column(Modifier.testTag("more_sheet"), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            // Manager mode: Hours leads the sheet for a manager whose bar does not carry it
            // (docs/manager-app/SPEC.md §6), and is absent for a plain worker.
            if (capabilities.hasManagerSurface && ShiftDestination.Hours !in managerBar) {
                MoreNavRow("Hours", ShiftIcons.Clock, "tab_hours_more") {
                    onDismiss()
                    nav.navigate(ShiftDestination.Hours)
                }
            }
            MoreNavRow("Updates", ShiftIcons.Bell, "tab_updates") {
                onDismiss()
                nav.navigate(ShiftDestination.Updates)
            }
            // Managers do not submit shift preferences (docs/manager-app/SPEC.md §6).
            if (!capabilities.hasManagerSurface) {
                MoreNavRow("Preferences", ShiftIcons.Heart, "tab_preferences") {
                    onDismiss()
                    nav.navigate(ShiftDestination.Preferences)
                }
            }
            MoreNavRow("Break shifts", ShiftIcons.Snowflake, "tab_break") {
                onDismiss()
                nav.navigate(ShiftDestination.BreakShifts)
            }
            MoreNavRow("Settings", ShiftIcons.Tune, "tab_settings") {
                onDismiss()
                nav.navigate(ShiftDestination.Settings)
            }
        }
    }
}
