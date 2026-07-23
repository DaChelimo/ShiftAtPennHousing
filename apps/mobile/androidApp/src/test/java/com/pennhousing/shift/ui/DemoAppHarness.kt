package com.pennhousing.shift.ui

import androidx.compose.runtime.Composable
import com.pennhousing.shift.shared.samples.DemoData
import com.pennhousing.shift.shared.viewmodel.AckDeclineViewModel
import com.pennhousing.shift.shared.viewmodel.AssistantViewModel
import com.pennhousing.shift.shared.viewmodel.BreakCalendarViewModel
import com.pennhousing.shift.shared.viewmodel.CalendarViewModel
import com.pennhousing.shift.shared.viewmodel.HouseScheduleViewModel
import com.pennhousing.shift.shared.viewmodel.PreferencesViewModel
import com.pennhousing.shift.shared.viewmodel.SettingsViewModel
import com.pennhousing.shift.shared.viewmodel.ShiftsScreenViewModel
import com.pennhousing.shift.shared.viewmodel.SwapsViewModel
import com.pennhousing.shift.shared.viewmodel.UpdatesViewModel
import kotlin.time.Clock

/**
 * The whole app shell (`ShiftsApp`) wired to the deterministic [DemoData] snapshot — the same
 * ViewModel graph `MainActivity.DemoRoot` builds, minus the persisted-theme read. Lets a screen
 * test drive the REAL Scaffold (bottom nav, FAB slot, tab switching) instead of a hand-rolled
 * stand-in that can drift from it.
 *
 * Pair it with [OnboardingTestState.markAllToursSeen] in a `@Before`, or the first-run overlays
 * will eat every gesture.
 */
@Composable
internal fun DemoShiftsApp() {
    val now = Clock.System.now()
    val snapshot = DemoData.snapshot(now)
    ShiftsApp(
        shiftsVm = ShiftsScreenViewModel(snapshot.myShifts, snapshot.openShifts, now),
        ackVm = AckDeclineViewModel(DemoData.pendingFloat(now), now),
        updatesVm = UpdatesViewModel(DemoData.notifications(now), now),
        swapsVm = SwapsViewModel(DemoData.pendingSwaps(now), now),
        calendarVm = CalendarViewModel(snapshot.myShifts, now, pendingSwaps = DemoData.pendingSwaps(now)),
        houseVm = HouseScheduleViewModel(DemoData.houseSchedule(now), now, meUserId = DemoData.DEMO_ME_USER_ID),
        preferencesVm = PreferencesViewModel(DemoData.preferencePeriod(now)),
        breakCalendarVm = BreakCalendarViewModel(DemoData.breakCalendar(now), now),
        settingsVm =
            SettingsViewModel(
                DemoData.settingsProfile(),
                DemoData.DEMO_BROADCAST_SUBSCRIBED,
                DemoData.DEMO_APP_VERSION,
            ),
        assistantVm = AssistantViewModel(),
        currentWeeklyHours = DemoData.DEMO_WEEKLY_HOURS,
        now = now,
    )
}
