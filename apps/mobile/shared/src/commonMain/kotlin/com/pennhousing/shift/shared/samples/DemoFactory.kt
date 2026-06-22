package com.pennhousing.shift.shared.samples

import com.pennhousing.shift.shared.breakclaim.BreakCalendarSnapshot
import com.pennhousing.shift.shared.breakclaim.noBreakCalendar
import com.pennhousing.shift.shared.data.ProfileSnapshot
import com.pennhousing.shift.shared.data.WorkerSnapshot
import com.pennhousing.shift.shared.shifts.weeklyHours
import com.pennhousing.shift.shared.house.HouseScheduleSnapshot
import com.pennhousing.shift.shared.model.FloatAck
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.notifications.IncomingSwap
import com.pennhousing.shift.shared.notifications.NotificationItem
import com.pennhousing.shift.shared.swaps.HandoffWorker
import com.pennhousing.shift.shared.swaps.PendingSwap
import com.pennhousing.shift.shared.notifications.withIncomingSwapEntries
import com.pennhousing.shift.shared.notifications.withPendingFloatEntry
import com.pennhousing.shift.shared.viewmodel.AckDeclineViewModel
import com.pennhousing.shift.shared.viewmodel.BreakCalendarViewModel
import com.pennhousing.shift.shared.viewmodel.CalendarViewModel
import com.pennhousing.shift.shared.viewmodel.HouseScheduleViewModel
import com.pennhousing.shift.shared.viewmodel.PreferencesViewModel
import com.pennhousing.shift.shared.viewmodel.SettingsViewModel
import com.pennhousing.shift.shared.viewmodel.ShiftsScreenViewModel
import com.pennhousing.shift.shared.viewmodel.SwapCalendarViewModel
import com.pennhousing.shift.shared.viewmodel.SwapsViewModel
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

    /**
     * Live Shifts VM from a real [WorkerSnapshot] (D8 — iOS read parity with the
     * Android `LiveShiftsRoot`). Supplies `now` Kotlin-side; iOS rebuilds it per
     * Realtime emission of `observeWorkerWeek`.
     */
    fun shiftsViewModel(snapshot: WorkerSnapshot): ShiftsScreenViewModel {
        val now = now()
        return ShiftsScreenViewModel(snapshot.myShifts, snapshot.openShifts, now)
    }

    /** The live "This week — Xh" total for [snapshot] (D8; pure `weeklyHours`). */
    fun weeklyHoursFor(snapshot: WorkerSnapshot): Double = weeklyHours(snapshot.myShifts, now())

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
    ): UpdatesViewModel = updatesViewModel(notifications, float, emptyList())

    /**
     * Live Updates VM that additionally surfaces the worker's INCOMING pending swaps as
     * deep-link mirrors (DESIGN §6) — `withIncomingSwapEntries` synthesizes one urgent
     * mirror per leg from the `swap_requests` rows `fetchIncomingSwaps` returns
     * (`create-swap` writes no counterparty notification row); tapping a mirror opens the
     * Swaps tab. Outgoing swaps are NOT mirrored into Updates — they live in the Swaps
     * tab's Outgoing list (see [swapsViewModel]). iOS calls this from
     * `UpdatesObservable.activateLive`; Android applies the same merge in `MainActivity`.
     */
    fun updatesViewModel(
        notifications: List<NotificationItem>,
        float: FloatAck?,
        swaps: List<IncomingSwap>,
    ): UpdatesViewModel =
        UpdatesViewModel(
            withIncomingSwapEntries(
                items =
                    withPendingFloatEntry(
                        items = notifications,
                        pendingFloatId = float?.floatId,
                        pendingFloatStart = float?.floatStart,
                        destinationHouseName = float?.destinationHouse?.name,
                    ),
                swaps = swaps,
            ),
            now(),
        )

    /** The demo Swaps tab — the enriched pending swaps (give/get hours + deadline). */
    fun swapsViewModel(): SwapsViewModel {
        val now = now()
        return SwapsViewModel(DemoData.pendingSwaps(now), now)
    }

    /**
     * Live Swaps VM from the worker's enriched pending swaps (DESIGN §6) — both directions
     * with each side's span, from `worker_pending_swaps`. Supplies `now` Kotlin-side (no
     * Instant across the Swift bridge).
     */
    fun swapsViewModel(pendingSwaps: List<PendingSwap>): SwapsViewModel = SwapsViewModel(pendingSwaps, now())

    /**
     * Calendar swap VM (CALENDAR_REDESIGN.md) seeded with the tapped shift as the pinned
     * "give" — the My-Shifts-card entry. Supplies `now` Kotlin-side (no Instant across the
     * Swift bridge); the host feeds per-week housemate seats via `setWeekSeats`. Pass the
     * full week's `myShifts` to also offer other own shifts as the give (standalone entry).
     */
    fun swapCalendarViewModel(
        giveShift: MyShift,
        meUserId: String,
        breakProfile: Boolean = false,
        // Own assignment ids already in a pending swap — filtered out of the give pool so an
        // already-pending shift can't be re-offered (the server would reject it).
        pendingGiveAssignmentIds: Set<String> = emptySet(),
    ): SwapCalendarViewModel =
        SwapCalendarViewModel(listOf(giveShift), meUserId, now(), breakProfile, giveShift.id, pendingGiveAssignmentIds)

    /**
     * The demo cross-house staff-worker directory for the §8.5 hand-off recipient picker
     * (live: `WorkerShiftsRepository.fetchWorkerDirectory`). Exposed here so SwiftUI seeds
     * the demo picker without reaching into `DemoData` across the bridge.
     */
    fun workerDirectory(): List<HandoffWorker> = DemoData.workerDirectory()

    fun calendarViewModel(): CalendarViewModel {
        val now = now()
        return CalendarViewModel(DemoData.snapshot(now).myShifts, now)
    }

    /** Demo calendar VM seeded with demo pending swaps — the My-Shifts swap indicators + popup. */
    fun calendarViewModelWithSwaps(): CalendarViewModel {
        val now = now()
        return CalendarViewModel(DemoData.snapshot(now).myShifts, now, emptySet(), DemoData.pendingSwaps(now))
    }

    fun houseScheduleViewModel(): HouseScheduleViewModel {
        val now = now()
        return HouseScheduleViewModel(DemoData.houseSchedule(now), now, meUserId = DemoData.DEMO_ME_USER_ID)
    }

    /** The demo Harnwell roster for a navigated week — the House tab's week-nav data source. */
    fun houseWeekSeats(anchor: Instant): List<com.pennhousing.shift.shared.house.HouseSeat> =
        DemoData.houseWeekSeats(anchor, DemoData.DEMO_ME_USER_ID)

    /**
     * Live house-schedule VM from the worker's real `house_schedule_grid` snapshot
     * (§11.4, T3b) — supplies `now` Kotlin-side (no Instant across the Swift
     * bridge). iOS calls this from `HouseObservable.activateLive`; Android builds
     * the live VM inline in `MainActivity`.
     */
    fun houseScheduleViewModel(
        snapshot: HouseScheduleSnapshot,
        meUserId: String? = null,
    ): HouseScheduleViewModel = HouseScheduleViewModel(snapshot, now(), meUserId)

    /**
     * Calendar VM with the worker's LIVE closed-house days (§3.4/§11.3, T2-12c) —
     * the Mon..Sun indexes from `WorkerShiftsRepository.fetchCalendarClosedDays`.
     * Supplies `now` Kotlin-side (no `kotlin.time.Instant` across the Swift bridge).
     */
    fun calendarViewModel(closedDayIndexes: Set<Int>): CalendarViewModel {
        val now = now()
        return CalendarViewModel(DemoData.snapshot(now).myShifts, now, closedDayIndexes)
    }

    /** Live calendar VM from a real week snapshot + closed days (D8 — iOS read parity). */
    fun calendarViewModel(
        snapshot: WorkerSnapshot,
        closedDayIndexes: Set<Int>,
    ): CalendarViewModel = CalendarViewModel(snapshot.myShifts, now(), closedDayIndexes)

    /** Live calendar VM + closed days + the worker's pending swaps (My-Shifts swap indicators). */
    fun calendarViewModel(
        snapshot: WorkerSnapshot,
        closedDayIndexes: Set<Int>,
        pendingSwaps: List<PendingSwap>,
    ): CalendarViewModel = CalendarViewModel(snapshot.myShifts, now(), closedDayIndexes, pendingSwaps)

    fun preferencesViewModel(): PreferencesViewModel = PreferencesViewModel(DemoData.preferencePeriod(now()))

    /** The demo break CALENDAR VM (Break redesign) — supplies `now` Kotlin-side. */
    fun breakCalendarViewModel(): BreakCalendarViewModel = BreakCalendarViewModel(DemoData.breakCalendar(now()), now())

    /**
     * The "no break scheduled" VM the LIVE build uses when there is no active break — the
     * honest replacement for the demo calendar (whose fake ids make claims silently fail).
     * iOS calls this from `BreakCalendarObservable` when `fetchActiveBreak` resolves to none.
     */
    fun emptyBreakCalendarViewModel(): BreakCalendarViewModel =
        BreakCalendarViewModel(noBreakCalendar(meUserId = null, now = now()), now())

    /**
     * Live break-calendar VM from the worker's real grid snapshot + active break id +
     * §4.4 opt-out — `now` Kotlin-side (no Instant across the Swift bridge). iOS calls this
     * from `BreakCalendarObservable.activateLive`; Android builds it inline in MainActivity.
     */
    fun breakCalendarViewModel(
        snapshot: BreakCalendarSnapshot,
        breakId: String?,
        optedOut: Boolean,
    ): BreakCalendarViewModel = BreakCalendarViewModel(snapshot, now(), breakId, optedOut)

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
