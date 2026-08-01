package com.pennhousing.shift.shared.live

import com.pennhousing.shift.shared.breakclaim.noBreakCalendar
import com.pennhousing.shift.shared.manager.ManagerCapabilities
import com.pennhousing.shift.shared.manager.managerCapabilitiesOf
import com.pennhousing.shift.shared.house.HouseScheduleSnapshot
import com.pennhousing.shift.shared.model.FloatAck
import com.pennhousing.shift.shared.model.House
import com.pennhousing.shift.shared.platform.SimClock
import com.pennhousing.shift.shared.preferences.PreferencePeriod
import com.pennhousing.shift.shared.samples.DemoData
import com.pennhousing.shift.shared.settings.SettingsProfile
import com.pennhousing.shift.shared.shifts.NEW_YORK
import com.pennhousing.shift.shared.viewmodel.AckDeclineViewModel
import com.pennhousing.shift.shared.viewmodel.BreakCalendarViewModel
import com.pennhousing.shift.shared.viewmodel.CalendarViewModel
import com.pennhousing.shift.shared.viewmodel.HouseScheduleViewModel
import com.pennhousing.shift.shared.viewmodel.PreferencesViewModel
import com.pennhousing.shift.shared.viewmodel.SettingsViewModel
import com.pennhousing.shift.shared.viewmodel.ShiftsScreenViewModel
import com.pennhousing.shift.shared.viewmodel.SwapsViewModel
import com.pennhousing.shift.shared.viewmodel.UpdatesViewModel
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Duration.Companion.hours
import kotlin.time.Instant

/**
 * EMPTY, live-safe ViewModel seeds for the backend-configured (LIVE) path.
 *
 * The counterpart to [com.pennhousing.shift.shared.samples.DemoFactory]: where that one
 * seeds the login-bypass demo build with a deterministic fake week, this one seeds a
 * signed-in worker's screens with NOTHING until their real data lands.
 *
 * Why this exists (2026-07-28): both hosts used to seed and fall back to `DemoData` on
 * the live path (`liveNotifications ?: DemoData.notifications(now)`, iOS's demo-seeded
 * `@StateObject`s), so for the seconds between launch and the first server read a real
 * worker saw a fabricated week: demo shifts, demo float requests, and demo swaps
 * "awaiting your action". That is indistinguishable from a glitch, and it invites a
 * worker to act on rows that do not exist. A signed-in worker must only ever see their
 * own data or an honest empty/loading state.
 *
 * Rules for anything added here:
 *  - never reference `DemoData` for CONTENT (the app-version constant is the one
 *    exception: it is a build string that merely lives in that file);
 *  - a seed must be inert — nothing actionable, nothing that reads as somebody's shift.
 *
 * Reading the clock here is fine: this is the host layer, not the pure decision surface.
 * `now()` resolves through [SimClock] so a time-travelled dev clock is honoured, exactly
 * like `DemoFactory.now()`.
 */
object LiveDefaults {
    fun now(): Instant = SimClock.now()

    /**
     * No manager surface at all: the shape a plain Student Worker has, and the shape used while
     * the real profile is still loading.
     *
     * Defaulting to unprivileged is the load-bearing part. A failed or in-flight role read must
     * never briefly render manager controls, and it must never be the reason a manager surface
     * appears for somebody who is not one.
     */
    fun plainWorkerCapabilities(): ManagerCapabilities =
        managerCapabilitiesOf(roles = emptyList(), homeHouseId = "")

    /** No shifts and no open feed — the My-Shifts / Open-Shifts tabs render their empty states. */
    fun shiftsViewModel(): ShiftsScreenViewModel = ShiftsScreenViewModel(emptyList(), emptyList(), now())

    /** An empty personal calendar (no shifts, no closed days, no swap marks). */
    fun calendarViewModel(): CalendarViewModel = CalendarViewModel(emptyList(), now())

    /** An empty Updates feed — no notifications, no float entry, no swap mirrors. */
    fun updatesViewModel(): UpdatesViewModel = UpdatesViewModel(emptyList(), now())

    /** An empty Swaps tab — nothing incoming, nothing outgoing. */
    fun swapsViewModel(): SwapsViewModel = SwapsViewModel(emptyList(), now())

    /** An unnamed house with no seats — the House grid renders blank until the real week lands. */
    fun houseScheduleViewModel(meUserId: String? = null): HouseScheduleViewModel =
        HouseScheduleViewModel(emptyHouseSchedule(), now(), meUserId)

    fun emptyHouseSchedule(): HouseScheduleSnapshot =
        HouseScheduleSnapshot(houseName = "", deskPhone = null, seats = emptyList(), houseId = null)

    /** No open preference period: an empty, READ-ONLY week (nothing to paint, nothing to submit). */
    fun preferencesViewModel(isManager: Boolean = false): PreferencesViewModel =
        PreferencesViewModel(emptyPreferencePeriod(), isManager)

    fun emptyPreferencePeriod(): PreferencePeriod =
        PreferencePeriod(
            periodId = "",
            periodLabel = "",
            deadlineLabel = null,
            submitted = false,
            // Read-only, so the empty grid never offers a submit that would land nowhere.
            deadlinePassed = true,
            weekStart = now().toLocalDateTime(NEW_YORK).date,
            days = emptyList(),
            targetHours = 0,
            optedOut = false,
        )

    /** A blank profile card — no fabricated name, email, role or house. */
    fun settingsViewModel(): SettingsViewModel =
        // DEMO_APP_VERSION is the build's version string, not demo CONTENT; both hosts
        // already show it on the live path.
        SettingsViewModel(emptySettingsProfile(), broadcastSubscribed = false, appVersion = DemoData.DEMO_APP_VERSION)

    fun emptySettingsProfile(): SettingsProfile =
        SettingsProfile(name = "", email = "", role = "sw", homeHouseName = "")

    /** The honest "no break scheduled" calendar (never the demo break week). */
    fun breakCalendarViewModel(meUserId: String? = null): BreakCalendarViewModel =
        BreakCalendarViewModel(noBreakCalendar(meUserId, now()), now())

    /**
     * A placeholder ack VM for "no pending float". The hosts need a non-null VM to hold,
     * but nothing routes to the ack surface without a real float: the carousel is empty and
     * no Updates entry links to one. The float start is well in the past so even a forced
     * presentation is past its deadline and cannot be responded to.
     */
    fun ackViewModel(): AckDeclineViewModel {
        val now = now()
        return AckDeclineViewModel(emptyFloatAck(now), now)
    }

    fun emptyFloatAck(now: Instant = now()): FloatAck =
        FloatAck(
            floatId = "",
            destinationHouse = House(id = "", name = ""),
            // Far enough back that `isPastAckDeadline` is unambiguously true.
            floatStart = now - 24.hours,
        )
}
