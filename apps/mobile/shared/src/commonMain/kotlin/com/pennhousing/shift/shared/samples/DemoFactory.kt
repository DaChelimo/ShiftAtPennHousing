package com.pennhousing.shift.shared.samples

import com.pennhousing.shift.shared.breakclaim.BreakClaimSnapshot
import com.pennhousing.shift.shared.data.ProfileSnapshot
import com.pennhousing.shift.shared.model.FloatAck
import com.pennhousing.shift.shared.notifications.NotificationItem
import com.pennhousing.shift.shared.notifications.withPendingFloatEntry
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

    /**
     * Live ack/decline VM from the worker's real pending [float] — supplies `now` here
     * so iOS need not construct a `kotlin.time.Instant` across the Swift bridge (mirrors
     * [ackViewModel] for the demo path). Android builds the live VM inline in
     * `MainActivity`; iOS calls this from `AckObservable.activateLive`.
     */
    fun ackViewModel(float: FloatAck): AckDeclineViewModel = AckDeclineViewModel(float, now())

    fun updatesViewModel(): UpdatesViewModel {
        val now = now()
        return UpdatesViewModel(DemoData.notifications(now), now)
    }

    /**
     * Live Updates VM from the worker's real `notifications` rows — supplies `now`
     * here so iOS need not construct a `kotlin.time.Instant` across the Swift bridge
     * (mirrors [updatesViewModel] for the demo path). Android builds the live VM
     * inline in `MainActivity`; iOS calls this from `UpdatesObservable.activateLive`.
     */
    fun updatesViewModel(notifications: List<NotificationItem>): UpdatesViewModel = UpdatesViewModel(notifications, now())

    /**
     * Live Updates VM that also guarantees the worker's current pending [float] (from
     * `fetchPendingFloat`) is reachable in the feed — `withPendingFloatEntry` synthesizes
     * the urgent `pending_float_notification` entry if no real `notifications` row already
     * references it. A null [float] is the plain feed. iOS calls this from
     * `UpdatesObservable.activateLive`; Android applies the same merge inline in `MainActivity`.
     */
    fun updatesViewModel(
        notifications: List<NotificationItem>,
        float: FloatAck?,
    ): UpdatesViewModel =
        UpdatesViewModel(
            withPendingFloatEntry(
                items = notifications,
                pendingFloatId = float?.floatId,
                pendingFloatStart = float?.floatStart,
                destinationHouseName = float?.destinationHouse?.name,
            ),
            now(),
        )

    fun calendarViewModel(): CalendarViewModel {
        val now = now()
        return CalendarViewModel(DemoData.snapshot(now).myShifts, now)
    }

    fun preferencesViewModel(): PreferencesViewModel = PreferencesViewModel(DemoData.preferencePeriod(now()))

    fun breakClaimViewModel(): BreakClaimViewModel = BreakClaimViewModel(breakClaimSnapshot())

    /** The demo break-claim snapshot — the iOS host overlays live context onto it. */
    fun breakClaimSnapshot(): BreakClaimSnapshot = DemoData.breakClaim(now())

    fun settingsViewModel(): SettingsViewModel =
        SettingsViewModel(DemoData.settingsProfile(), DemoData.DEMO_BROADCAST_SUBSCRIBED, DemoData.DEMO_APP_VERSION)

    /**
     * Live Settings VM from the worker's real profile + live broadcast subscription
     * (own `users` / `user_roles` + `houses`, all RLS-readable) — mirrors the demo
     * [settingsViewModel]. The app version stays the build constant. Android builds the
     * live VM inline in `MainActivity`; iOS calls this from `SettingsObservable.activateLive`.
     */
    fun settingsViewModel(snapshot: ProfileSnapshot): SettingsViewModel =
        SettingsViewModel(snapshot.profile, snapshot.broadcastSubscribed, DemoData.DEMO_APP_VERSION)

    val demoWeeklyHours: Double get() = DemoData.DEMO_WEEKLY_HOURS
}
