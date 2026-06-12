package com.pennhousing.shift.shared.samples

import com.pennhousing.shift.shared.breakclaim.BreakClaimSnapshot
import com.pennhousing.shift.shared.breakclaim.BreakShift
import com.pennhousing.shift.shared.data.WorkerSnapshot
import com.pennhousing.shift.shared.model.AssignmentKind
import com.pennhousing.shift.shared.model.FloatAck
import com.pennhousing.shift.shared.model.House
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.model.OpenFeed
import com.pennhousing.shift.shared.model.OpenShift
import com.pennhousing.shift.shared.notifications.NotificationCategory
import com.pennhousing.shift.shared.notifications.NotificationItem
import com.pennhousing.shift.shared.preferences.PrefBlock
import com.pennhousing.shift.shared.preferences.PrefBrush
import com.pennhousing.shift.shared.preferences.PreferencePeriod
import com.pennhousing.shift.shared.settings.SettingsProfile
import com.pennhousing.shift.shared.shifts.MONTH_SHORT
import com.pennhousing.shift.shared.shifts.NEW_YORK
import com.pennhousing.shift.shared.shifts.roundDownToBlock
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.LocalDate
import kotlinx.datetime.LocalDateTime
import kotlinx.datetime.LocalTime
import kotlinx.datetime.minus
import kotlinx.datetime.plus
import kotlinx.datetime.toInstant
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Duration.Companion.days
import kotlin.time.Duration.Companion.hours
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Instant

/**
 * Phase 13a — a deterministic demo snapshot for both front ends.
 *
 * The worker app's data normally arrives from Supabase ([WorkerShiftsRepository]);
 * this seed lets the screens render — and the Maestro flows run — without a
 * configured backend. Everything is anchored to an injected `now` so the claim
 * cutoff (§5.4) and drop short-notice (§5.2) logic behaves predictably:
 *
 * - the scheduled shift starts a day out → a drop is neither mid-shift nor short
 *   notice (Maestro 03 takes the no-warning path);
 * - the home open shift starts a day out → claimable (well before T-2h), and the
 *   demo weekly hours keep a claim under the soft cap (Maestro 02 no-warning path);
 * - the pending float starts 2h out → its T-10m deadline is ~1h50 away, so the
 *   ack modal is respondable (Maestro 04).
 */
object DemoData {
    private val harnwell = House("harnwell", "Harnwell")
    private val quad = House("quad", "Quad")

    /** A modest current-week hour total so a demo claim stays under the 20h soft cap. */
    const val DEMO_WEEKLY_HOURS: Double = 8.0

    fun snapshot(now: Instant): WorkerSnapshot {
        // Per-block rows on a 30-min grid — the SAME shape the live read models
        // return (one row per block, parity CO). The coalescing layer renders each
        // run as one card, so the screens look exactly as the old hand-built spans
        // did, while the §5.2/§5.3 partial drop/claim selectors work in the demo.
        val base = roundDownToBlock(now)
        val myShifts =
            perBlock(MyShift("pk-1", quad, base + 2.days, base + 2.days + 2.hours, AssignmentKind.TEMP_PICKUP, crossHouse = true)) +
                perBlock(MyShift("sc-1", harnwell, base + 1.days, base + 1.days + 2.hours, AssignmentKind.SCHEDULED)) +
                perBlock(MyShift("pp-1", harnwell, base + 3.days, base + 3.days + 2.hours, AssignmentKind.PERMANENT_PICKUP))
        val openShifts =
            perBlock(OpenShift("hw-1", harnwell, base + 1.days, base + 1.days + 2.hours, OpenFeed.WEEKLY, homeHouse = true)) +
                perBlock(
                    OpenShift(
                        "hp-1",
                        harnwell,
                        base + 2.days,
                        base + 2.days + 2.hours,
                        OpenFeed.PERMANENT_OPENING,
                        homeHouse = true,
                        weeksRemaining = 6,
                    ),
                ) +
                perBlock(OpenShift("qw-1", quad, base + 1.days, base + 1.days + 2.hours, OpenFeed.WEEKLY, homeHouse = false))
        return WorkerSnapshot(myShifts = myShifts, openShifts = openShifts)
    }

    /** Split a hand-built span into its 30-min block rows (ids `id.0`, `id.1`, …). */
    private fun perBlock(shift: MyShift): List<MyShift> {
        val n = ((shift.end - shift.start).inWholeMinutes / 30).toInt()
        return (0 until n).map { i ->
            shift.copy(
                id = "${shift.id}.$i",
                start = shift.start + (i * 30).minutes,
                end = shift.start + ((i + 1) * 30).minutes,
                blockIds = listOf("${shift.id}.$i"),
            )
        }
    }

    private fun perBlock(shift: OpenShift): List<OpenShift> {
        val n = ((shift.end - shift.start).inWholeMinutes / 30).toInt()
        return (0 until n).map { i ->
            shift.copy(
                id = "${shift.id}.$i",
                start = shift.start + (i * 30).minutes,
                end = shift.start + ((i + 1) * 30).minutes,
                blockIds = listOf("${shift.id}.$i"),
            )
        }
    }

    fun pendingFloat(now: Instant): FloatAck = FloatAck(floatId = "float-demo", destinationHouse = quad, floatStart = now + 2.hours)

    /**
     * A deterministic Updates feed: the urgent pending-float entry (its `floatId`
     * matches [pendingFloat], so the row opens the same ack hero) + a reminder +
     * a manager removal (Today), then a permanent release + a preferences confirmation
     * (Earlier). Times hang off `now` so the grouping stays stable across launches.
     */
    fun notifications(now: Instant): List<NotificationItem> =
        listOf(
            NotificationItem(
                id = "n-float",
                category = NotificationCategory.FLOAT,
                title = "Float assignment — Quad",
                body = "Cover Quad today. Acknowledge before the T-10m deadline.",
                createdAt = now - 2.minutes,
                unread = true,
                urgent = true,
                floatId = "float-demo",
            ),
            NotificationItem(
                id = "n-reminder",
                category = NotificationCategory.REMINDER,
                title = "Reminder · float starts soon",
                body = "Acknowledge your Quad float.",
                createdAt = now - 15.minutes,
                unread = true,
            ),
            // An incoming pending swap (T3a) — the row offers Accept/Decline; the demo
            // resolves it locally (the live path POSTs accept-swap / reject-swap).
            NotificationItem(
                id = "n-swap",
                category = NotificationCategory.SWAP,
                title = "Swap request — Shift swap",
                body = "A housemate proposed a swap with you. Respond before it expires.",
                createdAt = now - 30.minutes,
                unread = true,
                urgent = true,
                swapId = "swap-demo",
                swapAcceptable = true,
            ),
            NotificationItem(
                id = "n-removed",
                category = NotificationCategory.SHIFT_REMOVED,
                title = "Shift removed by manager",
                body = "Your Fri 12:30–14:00 was removed.",
                createdAt = now - 3.hours,
                unread = false,
            ),
            NotificationItem(
                id = "n-permanent",
                category = NotificationCategory.PERMANENT,
                title = "Permanent slot released",
                body = "Your Wed 16:00–18:00 is now a permanent opening.",
                createdAt = now - 3.days,
                unread = false,
            ),
            NotificationItem(
                id = "n-prefs",
                category = NotificationCategory.PREFERENCES,
                title = "Preferences received",
                body = "Next week's preferences submitted.",
                createdAt = now - 3.days - 2.hours,
                unread = false,
            ),
        )

    // ── Preference submission + Break claim (the NEW ✦ screens) ──────────────────

    private const val DAYS_IN_WEEK = 7
    private const val PREF_BLOCKS_PER_DAY = 32 // 08:00 → 24:00 in 30-min steps

    /** Monday of the week AFTER [now]'s week, NY-anchored — the prefs/break demo anchor. */
    private fun nextWeekMonday(now: Instant): LocalDate {
        val today = now.toLocalDateTime(NEW_YORK).date
        return today.minus(today.dayOfWeek.ordinal, DateTimeUnit.DAY).plus(DAYS_IN_WEEK, DateTimeUnit.DAY)
    }

    /** An Instant at NY-local [hour]:[minute] on [date] (one conversion per day; DST-safe within a day). */
    private fun nyInstant(
        date: LocalDate,
        hour: Int,
        minute: Int,
    ): Instant = LocalDateTime(date, LocalTime(hour, minute)).toInstant(NEW_YORK)

    /**
     * A not-yet-submitted preference period for next week: 7 days × 32 blocks
     * (08:00–24:00), Wednesday pre-painted (mirrors worker-app.html) so the grid +
     * the strip "painted" dot show on launch. The period label + deadline are
     * caller-supplied copy — `scheduling_periods` is not worker-readable (flagged).
     */
    fun preferencePeriod(now: Instant): PreferencePeriod {
        val monday = nextWeekMonday(now)
        val days =
            (0 until DAYS_IN_WEEK).map { d ->
                val dayStart = nyInstant(monday.plus(d, DateTimeUnit.DAY), 8, 0)
                (0 until PREF_BLOCKS_PER_DAY).map { i ->
                    PrefBlock(blockId = "d$d-b$i", start = dayStart + (i * 30).minutes)
                }
            }
        // Wednesday (index 2): 08:00–10:00 Cannot, 12:00–14:00 + 16:00–19:00 Preferred.
        val wednesday = mutableMapOf<String, PrefBrush>()
        (0..3).forEach { wednesday["d2-b$it"] = PrefBrush.CANNOT }
        (8..11).forEach { wednesday["d2-b$it"] = PrefBrush.PREFERRED }
        (16..21).forEach { wednesday["d2-b$it"] = PrefBrush.PREFERRED }
        return PreferencePeriod(
            periodId = "period-demo",
            periodLabel = "Week of ${MONTH_SHORT[monday.month.ordinal]} ${monday.day}",
            deadlineLabel = "Due Fri 17:00",
            submitted = false,
            weekStart = monday,
            days = days,
            initialStatuses = wednesday,
            targetHours = 16,
            optedOut = false,
        )
    }

    /**
     * A demo Winter-Break pool: 4 claimable Harnwell shifts (08–12, 12–16, 16–20,
     * 20–24) on next week's Monday, none yet claimed → all show "Claim", meter 0h/40h.
     * Break name/profile copy is caller-supplied (`break_periods` is not worker-readable
     * — flagged); the T-1d drop cutoff is descriptive (the backend does not enforce it).
     */
    fun breakClaim(now: Instant): BreakClaimSnapshot {
        val day = nextWeekMonday(now)
        fun slot(
            n: Int,
            startHour: Int,
        ) = BreakShift(
            id = "bk-$n",
            house = harnwell,
            start = nyInstant(day, startHour, 0),
            end = nyInstant(day, startHour, 0) + 4.hours,
        )
        return BreakClaimSnapshot(
            profileContext = "WINTER BREAK PROFILE",
            infoTitle = "Winter break — only Harnwell open",
            infoBody = "First-come, first-served · 40h hard cap · drop back to the pool until T-1d.",
            shifts = listOf(slot(1, 8), slot(2, 12), slot(3, 16), slot(4, 20)),
            initiallyClaimedIds = emptySet(),
        )
    }

    // ── Settings / Profile (NEW ✦) ───────────────────────────────────────────────

    const val DEMO_BROADCAST_SUBSCRIBED: Boolean = false
    const val DEMO_APP_VERSION: String = "2.4.0"

    /**
     * A demo identity. Live, this comes from the worker's own `users` row (name/email/
     * home_house_id) + `user_roles` (role) + `houses` (name) — all RLS-readable; the
     * live read is the data-layer TODO (no purpose-built profile view).
     */
    fun settingsProfile(): SettingsProfile =
        SettingsProfile(
            name = "Andrew P.",
            email = "andrewp@upenn.edu",
            role = "sw",
            homeHouseName = "Harnwell College House",
        )
}
