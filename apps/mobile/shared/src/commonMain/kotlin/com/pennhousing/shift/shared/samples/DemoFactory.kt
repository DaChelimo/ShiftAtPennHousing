package com.pennhousing.shift.shared.samples

import com.pennhousing.shift.shared.viewmodel.AckDeclineViewModel
import com.pennhousing.shift.shared.viewmodel.BreakClaimViewModel
import com.pennhousing.shift.shared.viewmodel.CalendarViewModel
import com.pennhousing.shift.shared.viewmodel.PreferencesViewModel
import com.pennhousing.shift.shared.viewmodel.SettingsViewModel
import com.pennhousing.shift.shared.viewmodel.ShiftsScreenViewModel
import com.pennhousing.shift.shared.viewmodel.UpdatesViewModel
import kotlin.time.Clock
import kotlin.time.Instant

/**
 * Phase 13a — convenience constructors so the iOS app builds the demo ViewModels
 * without constructing `kotlin.time.Instant` across the Swift bridge. (The Android
 * app constructs them inline in `MainActivity`; iOS calls these.)
 *
 * Reading the wall clock here is fine — the UI/host layer is allowed to; the
 * no-clock rule applies only to the pure decision surface, which receives `now`
 * as a parameter. [now] is also exposed so SwiftUI can supply the action instant
 * for `acknowledge` / `decline`.
 */
object DemoFactory {
    fun now(): Instant = Clock.System.now()

    fun shiftsViewModel(): ShiftsScreenViewModel {
        val now = now()
        val snapshot = DemoData.snapshot(now)
        return ShiftsScreenViewModel(snapshot.myShifts, snapshot.openShifts, now)
    }

    fun ackViewModel(): AckDeclineViewModel {
        val now = now()
        return AckDeclineViewModel(DemoData.pendingFloat(now), now)
    }

    fun updatesViewModel(): UpdatesViewModel {
        val now = now()
        return UpdatesViewModel(DemoData.notifications(now), now)
    }

    fun calendarViewModel(): CalendarViewModel {
        val now = now()
        return CalendarViewModel(DemoData.snapshot(now).myShifts, now)
    }

    fun preferencesViewModel(): PreferencesViewModel = PreferencesViewModel(DemoData.preferencePeriod(now()))

    fun breakClaimViewModel(): BreakClaimViewModel = BreakClaimViewModel(DemoData.breakClaim(now()))

    fun settingsViewModel(): SettingsViewModel =
        SettingsViewModel(DemoData.settingsProfile(), DemoData.DEMO_BROADCAST_SUBSCRIBED, DemoData.DEMO_APP_VERSION)

    val demoWeeklyHours: Double get() = DemoData.DEMO_WEEKLY_HOURS
}
