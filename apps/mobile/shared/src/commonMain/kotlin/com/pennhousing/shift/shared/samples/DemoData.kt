package com.pennhousing.shift.shared.samples

import com.pennhousing.shift.shared.breakclaim.BreakCalendarSeat
import com.pennhousing.shift.shared.breakclaim.BreakCalendarSnapshot
import com.pennhousing.shift.shared.breakclaim.BreakPhase
import com.pennhousing.shift.shared.data.WorkerSnapshot
import com.pennhousing.shift.shared.house.HouseOption
import com.pennhousing.shift.shared.house.HouseScheduleSnapshot
import com.pennhousing.shift.shared.house.HouseSeat
import com.pennhousing.shift.shared.model.AssignmentKind
import com.pennhousing.shift.shared.model.FloatAck
import com.pennhousing.shift.shared.model.House
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.model.OpenFeed
import com.pennhousing.shift.shared.model.OpenShift
import com.pennhousing.shift.shared.model.PendingFloat
import com.pennhousing.shift.shared.model.RecentFloat
import com.pennhousing.shift.shared.model.RecentFloatStatus
import com.pennhousing.shift.shared.notifications.IncomingSwap
import com.pennhousing.shift.shared.notifications.NotificationCategory
import com.pennhousing.shift.shared.notifications.NotificationItem
import com.pennhousing.shift.shared.preferences.PrefBlock
import com.pennhousing.shift.shared.preferences.PrefBrush
import com.pennhousing.shift.shared.preferences.PreferencePeriod
import com.pennhousing.shift.shared.settings.SettingsProfile
import com.pennhousing.shift.shared.shifts.MONTH_SHORT
import com.pennhousing.shift.shared.shifts.NEW_YORK
import com.pennhousing.shift.shared.shifts.coalesceMyShifts
import com.pennhousing.shift.shared.shifts.roundDownToBlock
import com.pennhousing.shift.shared.swaps.HandoffWorker
import com.pennhousing.shift.shared.swaps.PendingSwap
import com.pennhousing.shift.shared.swaps.SwapDirection
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
        //
        // My-Shifts cards are anchored to fixed WEEKDAYS of the current (and next) NY
        // week — deterministic regardless of which day the demo/Maestro runs, and so
        // the week-scoped My-Shifts tab (week navigation) reliably shows them in the
        // right week. The next-week pair (`nw-*`) demonstrates future-week navigation.
        val today = now.toLocalDateTime(NEW_YORK).date
        val monday = today.minus(today.dayOfWeek.ordinal, DateTimeUnit.DAY)
        fun dayAt(weekday: Int, hour: Int): Instant = nyInstant(monday.plus(weekday, DateTimeUnit.DAY), hour, 0)
        // Open-shift feeds are week-scoped (the UI filter): the live ones stay anchored a
        // few hours out from `now` so they are reliably claimable (start > T-2h) AND land in
        // the current NY week. A `base - 3h` opening demonstrates the collapsed "Earlier this
        // week" past card; a next-week opening (`nw-*`) demonstrates the week navigator.
        val base = roundDownToBlock(now)
        val myShifts =
            // Current week (Mon = 0 … Sun = 6).
            // A 6h Monday shift — long enough to demo a multi-party split (e.g. give the
            // first 2h to one housemate, the middle 2h to another, the last 2h across two
            // more, each as an independent leg).
            perBlock(MyShift("sc-6h", harnwell, dayAt(0, 12), dayAt(0, 18), AssignmentKind.SCHEDULED)) +
                perBlock(MyShift("sc-1", harnwell, dayAt(2, 12), dayAt(2, 14), AssignmentKind.SCHEDULED)) +
                perBlock(MyShift("pk-1", quad, dayAt(1, 9), dayAt(1, 11), AssignmentKind.TEMP_PICKUP, crossHouse = true)) +
                perBlock(MyShift("pp-1", harnwell, dayAt(4, 20), dayAt(4, 22), AssignmentKind.PERMANENT_PICKUP)) +
                // Next week — only visible after navigating forward a week.
                perBlock(MyShift("nw-pk-1", quad, dayAt(9, 14), dayAt(9, 16), AssignmentKind.TEMP_PICKUP, crossHouse = true)) +
                perBlock(MyShift("nw-sc-1", harnwell, dayAt(10, 12), dayAt(10, 14), AssignmentKind.SCHEDULED))
        val openShifts =
            perBlock(OpenShift("hw-1", harnwell, base + 4.hours, base + 6.hours, OpenFeed.WEEKLY, homeHouse = true)) +
                // A dropped seat on a STILL-STAFFED Harnwell desk (a co-worker remains on):
                // within T-2h yet `deskCovered`, so it stays claimable until block start —
                // the coverage-conditional lock (§5.4/§5.5). Contrast `hw-locked` below.
                perBlock(
                    OpenShift(
                        "hw-covered",
                        harnwell,
                        base + 1.hours,
                        base + 3.hours,
                        OpenFeed.WEEKLY,
                        homeHouse = true,
                        deskCovered = true,
                    ),
                ) +
                // An empty Harnwell desk past its T-2h coverage step: one-way locked → unpickable.
                perBlock(
                    OpenShift(
                        "hw-locked",
                        harnwell,
                        base + 1.hours,
                        base + 2.hours,
                        OpenFeed.WEEKLY,
                        homeHouse = true,
                        coverageLocked = true,
                    ),
                ) +
                perBlock(
                    OpenShift(
                        "hp-1",
                        harnwell,
                        base + 5.hours,
                        base + 7.hours,
                        OpenFeed.PERMANENT_OPENING,
                        homeHouse = true,
                        weeksRemaining = 6,
                    ),
                ) +
                perBlock(OpenShift("qw-1", quad, base + 4.hours, base + 6.hours, OpenFeed.WEEKLY, homeHouse = false)) +
                // Already started earlier today → the collapsed "Earlier this week" past card.
                perBlock(OpenShift("hw-past", harnwell, base - 3.hours, base - 1.hours, OpenFeed.WEEKLY, homeHouse = true)) +
                // Next week (Tue) → only visible after stepping the open-week navigator forward.
                perBlock(OpenShift("nw-hw", harnwell, dayAt(8, 14), dayAt(8, 16), OpenFeed.WEEKLY, homeHouse = true))
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

    private val dubois = House("dubois", "DuBois")

    /**
     * The worker's outstanding float requests for the My-Shifts carousel — two demo
     * floats at different houses/times so the swipe + "next closest" advance and the
     * "all handled" completion are demonstrable (and Maestro-checkable). Closest first.
     */
    fun pendingFloats(now: Instant): List<PendingFloat> {
        // Anchor on a 30-minute boundary so the windows read like real block shifts
        // (e.g. 18:00 – 20:00), not the wall-clock minute the demo happens to load at.
        val base = roundDownToBlock(now)
        return listOf(
            PendingFloat(
                floatId = "float-demo-1",
                destinationHouse = dubois,
                start = base + 2.hours,
                end = base + 4.hours,
                blockCount = 4,
            ),
            PendingFloat(
                floatId = "float-demo-2",
                destinationHouse = harnwell,
                start = base + 5.hours,
                end = base + 7.hours,
                blockCount = 4,
            ),
        )
    }

    fun pendingFloat(now: Instant): FloatAck = pendingFloats(now).first().toFloatAck()

    /**
     * The worker's RESOLVED floats from the last 24h for the collapsible "Recent float
     * requests" section: one of each terminal state so the chips + de-emphasized rows are
     * demonstrable. Most-recent first is handled by the presentation layer.
     */
    fun recentFloats(now: Instant): List<RecentFloat> {
        val base = roundDownToBlock(now)
        return listOf(
            RecentFloat(
                floatId = "recent-expired-1",
                destinationHouse = dubois,
                start = base - 1.hours,
                end = base,
                status = RecentFloatStatus.EXPIRED,
                resolvedAt = now - 8.minutes,
            ),
            RecentFloat(
                floatId = "recent-declined-1",
                destinationHouse = harnwell,
                start = base - 4.hours,
                end = base - 2.hours,
                status = RecentFloatStatus.DECLINED,
                resolvedAt = now - 3.hours,
            ),
            RecentFloat(
                floatId = "recent-accepted-1",
                destinationHouse = dubois,
                start = base - 6.hours,
                end = base - 4.hours,
                status = RecentFloatStatus.ACCEPTED,
                resolvedAt = now - 5.hours,
            ),
        )
    }

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
                title = "Float assignment: Quad",
                body = "Cover Quad today. Acknowledge before the T-10m deadline.",
                createdAt = now - 2.minutes,
                unread = true,
                urgent = true,
                floatId = "float-demo",
                floatStart = now + 2.hours, // matches pendingFloat → live ack countdown (D7)
            ),
            NotificationItem(
                id = "n-reminder",
                category = NotificationCategory.REMINDER,
                title = "Reminder · float starts soon",
                body = "Acknowledge your Quad float.",
                createdAt = now - 15.minutes,
                unread = true,
            ),
            // An incoming pending swap MIRROR (DESIGN §6) — tapping it deep-links to the
            // Swaps tab, where Accept/Decline live. The swapId matches [incomingSwaps].
            NotificationItem(
                id = "n-swap",
                category = NotificationCategory.SWAP,
                title = "Swap request: Shift swap",
                body = "A housemate proposed a swap with you. Review it in Swaps.",
                createdAt = now - 30.minutes,
                unread = true,
                urgent = true,
                swapId = "swap-in-1",
            ),
            NotificationItem(
                id = "n-removed",
                category = NotificationCategory.SHIFT_REMOVED,
                title = "Shift removed by manager",
                body = "Your Fri 12:30-14:00 was removed.",
                createdAt = now - 3.hours,
                unread = false,
            ),
            NotificationItem(
                id = "n-permanent",
                category = NotificationCategory.PERMANENT,
                title = "Permanent slot released",
                body = "Your Wed 16:00-18:00 is now a permanent opening.",
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

    /**
     * The Swaps tab's INCOMING list (DESIGN §6) — pending `swap_requests` where this
     * worker is the counterparty. A temporary shift swap (acceptable in-app) + a
     * permanent swap (accept on the desk/web → Decline only). `swap-in-1` matches the
     * Updates mirror in [notifications].
     */
    fun incomingSwaps(now: Instant): List<IncomingSwap> =
        listOf(
            IncomingSwap(
                swapId = "swap-in-1",
                swapType = "shift_swap",
                createdAt = now - 30.minutes,
                expiresAt = now + 6.hours,
            ),
            IncomingSwap(
                swapId = "swap-in-2",
                swapType = "permanent_swap",
                createdAt = now - 2.hours,
                expiresAt = now + 5.days,
            ),
        )

    /**
     * The Swaps tab's OUTGOING list (DESIGN §6) — pending `swap_requests` this worker
     * initiated. Two legs created in the same minute model a MULTI-PARTY split (decision
     * 2026-06-15: independent legs) so the tab renders the "Proposed together" group, plus
     * one standalone request. The live path fetches these via `fetchOutgoingSwaps`.
     */
    fun outgoingSwaps(now: Instant): List<IncomingSwap> =
        listOf(
            IncomingSwap(
                swapId = "swap-out-1a",
                swapType = "shift_swap",
                createdAt = now - 45.minutes,
                expiresAt = now + 20.hours,
            ),
            IncomingSwap(
                swapId = "swap-out-1b",
                swapType = "shift_swap",
                createdAt = now - 45.minutes,
                expiresAt = now + 20.hours,
            ),
            IncomingSwap(
                swapId = "swap-out-2",
                swapType = "float_swap",
                createdAt = now - 5.hours,
                expiresAt = now + 18.hours,
            ),
        )

    /**
     * Pending swaps that flag My-Shifts cards (worker-app): an INCOMING request on the
     * worker's Wed scheduled shift (tap → accept/decline popup) and an OUTGOING one on the
     * Tue cross-house pickup (just a marker). Derived from the real demo shifts so the
     * assignment ids + times line up with the rendered cards.
     */
    fun pendingSwaps(now: Instant): List<PendingSwap> {
        val mine = coalesceMyShifts(snapshot(now).myShifts).filter { !it.droppedStillOpen }
        fun card(prefix: String) = mine.firstOrNull { it.blockIds.any { id -> id.startsWith("$prefix.") } }
        val incomingMine = card("sc-1") // your Wed scheduled shift — someone wants it
        val outgoingMine = card("pk-1") // your Tue cross-house pickup — you proposed to swap it
        return listOfNotNull(
            incomingMine?.let { mineShift ->
                PendingSwap(
                    swapId = "demo-swap-incoming",
                    swapType = "shift_swap",
                    direction = SwapDirection.INCOMING,
                    otherUserName = "Ben Carter",
                    createdAt = now - 30.minutes,
                    expiresAt = now + 1.days,
                    initiatorAssignmentIds = listOf("ben-1", "ben-2", "ben-3", "ben-4"),
                    counterpartyAssignmentIds = mineShift.blockIds,
                    initiatorStart = now + 3.days,
                    initiatorEnd = now + 3.days + 2.hours,
                    initiatorBlocks = 4,
                    // Ben's shift was floated to Quad — so accepting puts YOU at Quad, not his
                    // home desk. Surfacing this is the whole point (you'd otherwise show up blind).
                    initiatorHouseName = "Quad",
                    counterpartyStart = mineShift.start,
                    counterpartyEnd = mineShift.end,
                    counterpartyBlocks = mineShift.blockIds.size,
                    counterpartyHouseName = mineShift.house.name,
                )
            },
            outgoingMine?.let { mineShift ->
                PendingSwap(
                    swapId = "demo-swap-outgoing",
                    swapType = "shift_swap",
                    direction = SwapDirection.OUTGOING,
                    otherUserName = "Maya Lin",
                    createdAt = now - 45.minutes,
                    expiresAt = now + 20.hours,
                    initiatorAssignmentIds = mineShift.blockIds,
                    counterpartyAssignmentIds = listOf("maya-1", "maya-2", "maya-3", "maya-4"),
                    initiatorStart = mineShift.start,
                    initiatorEnd = mineShift.end,
                    initiatorBlocks = mineShift.blockIds.size,
                    initiatorHouseName = mineShift.house.name,
                    counterpartyStart = now + 4.days,
                    counterpartyEnd = now + 4.days + 2.hours,
                    counterpartyBlocks = 4,
                    counterpartyHouseName = "DuBois",
                )
            },
        )
    }

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
     * A demo break CALENDAR (Break redesign): a Harnwell winter window spanning THREE weeks
     * (so the week pager is exercised), 2 lanes (Harnwell headcount). Each week seeds its
     * Monday + Wednesday with a housemate on an early lane and open capacity to drag-claim;
     * week 0's Monday also carries the worker's own midday run so the meter shows hours.
     * Per-30-min seats — the live `house_schedule_grid` shape.
     */
    fun breakCalendar(now: Instant): BreakCalendarSnapshot {
        val week0Mon = nextWeekMonday(now)
        val required = 2 // Harnwell
        val seats = mutableListOf<BreakCalendarSeat>()
        fun seedDay(
            date: LocalDate,
            tag: String,
            mineRange: IntRange?,
        ) {
            val base = nyInstant(date, 8, 0)
            for (i in 0 until 16) { // 08:00 .. 15:30
                val start = base + (i * 30).minutes
                val end = start + 30.minutes
                val blockId = "bcal-$tag-$i"
                val occupants: List<Pair<String, String>> =
                    when {
                        mineRange != null && i in mineRange -> listOf("demo-me" to "You")
                        i in 0..1 -> listOf("u-maya" to "Maya R.") // 1 of 2 filled
                        else -> emptyList()
                    }
                occupants.forEachIndexed { k, (uid, name) ->
                    seats += BreakCalendarSeat("$blockId-o$k", blockId, start, end, "claimed", required, uid, name)
                }
                repeat(required - occupants.size) { k ->
                    seats += BreakCalendarSeat("$blockId-v$k", blockId, start, end, "vacant", required, null, null)
                }
            }
        }
        for (w in 0 until 3) {
            val mon = week0Mon.plus(w * 7, DateTimeUnit.DAY)
            seedDay(mon, "w${w}mon", if (w == 0) 4..7 else null) // week 0 Monday: my 10:00–12:00 run
            seedDay(mon.plus(2, DateTimeUnit.DAY), "w${w}wed", null)
        }
        return BreakCalendarSnapshot(
            houseName = "Harnwell",
            breakName = "Winter Break",
            phase = BreakPhase.CLAIM_WINDOW,
            meUserId = "demo-me",
            seats = seats,
            windowStart = week0Mon,
            windowEnd = week0Mon.plus(18, DateTimeUnit.DAY), // through Friday of the 3rd week
        )
    }

    // ── House schedule (§11.4, T3b) ──────────────────────────────────────────────

    /** The demo signed-in worker (its desk blocks render as "You" in the grid). */
    const val DEMO_ME_USER_ID = "demo-me"

    /** The demo worker's home house — the House tab's default selection. */
    const val DEMO_HOME_HOUSE_ID = "harnwell"

    /**
     * The pickable houses for the House-tab switcher (2026-06-23 cross-house ruling) —
     * each with a demo desk phone so tap-to-call works in the login-bypass build. Live,
     * this comes from `WorkerShiftsRepository.fetchHouses`.
     */
    fun houses(): List<HouseOption> =
        listOf(
            HouseOption("harnwell", "Harnwell", "+1 215 555 0142"),
            HouseOption("quad", "Quad", "+1 215 555 0150"),
            HouseOption("house-03", "Gregory", "+1 215 555 0163"),
            HouseOption("house-04", "Stouffer", "+1 215 555 0174"),
            HouseOption("house-05", "Du Bois", "+1 215 555 0185"),
            HouseOption("house-06", "Hill", "+1 215 555 0196"),
        )

    /**
     * A deterministic home-house WEEK grid (design `HouseScheduleScreen`): Harnwell, a
     * two-desk house, with a full Mon–Sun roster — named housemates (with phones — the
     * §11.4 contact lookup), the worker's own "You" blocks, a "You · float-in", a pending
     * floater, and open gaps. Per-30-min seats (the live `house_schedule_grid` shape); the
     * pure builder coalesces them and assigns lanes. The current-week snapshot.
     */
    fun houseSchedule(now: Instant): HouseScheduleSnapshot =
        HouseScheduleSnapshot(
            houseName = "Harnwell",
            deskPhone = "+1 215 555 0142",
            seats = houseWeekSeats(now, DEMO_ME_USER_ID),
            houseId = DEMO_HOME_HOUSE_ID,
        )

    /**
     * The deterministic Harnwell roster for the NY week containing [anchor] — the same
     * weekly pattern every week (dated to that week's Monday) so the House tab's week
     * navigation has data to page through in the demo (the live build fetches per week).
     */
    fun houseWeekSeats(
        anchor: Instant,
        meUserId: String,
        isHome: Boolean = true,
    ): List<HouseSeat> {
        val monday = anchor.toLocalDateTime(NEW_YORK).date.let { it.minus(it.dayOfWeek.ordinal, DateTimeUnit.DAY) }
        // Two desks (lane 0 / lane 1) — Harnwell is multi-staff. `who` keys the registry;
        // "open" = vacant. Lanes are authored non-overlapping; the builder re-derives them.
        val week: List<List<HEntry>> =
            listOf(
                // Mon
                listOf(
                    HEntry(0, 8, 12, "maya"), HEntry(0, 12, 16, "me"), HEntry(0, 16, 20, "jordan"), HEntry(0, 20, 24, "sam"),
                    HEntry(1, 8, 14, "bob"), HEntry(1, 14, 20, "steve"), HEntry(1, 20, 24, "priya"),
                ),
                // Tue
                listOf(
                    HEntry(0, 8, 13, "priya"), HEntry(0, 13, 18, "maya"), HEntry(0, 18, 24, "leo"),
                    HEntry(1, 8, 14, "steve"), HEntry(1, 14, 20, "bob"), HEntry(1, 20, 24, "jordan"),
                ),
                // Wed
                listOf(
                    HEntry(0, 8, 12, "jordan"), HEntry(0, 12, 16, "open"), HEntry(0, 16, 20, "me", floatIn = true), HEntry(0, 20, 24, "sam"),
                    HEntry(1, 8, 13, "leo"), HEntry(1, 13, 19, "maya"), HEntry(1, 19, 24, "steve"),
                ),
                // Thu
                listOf(
                    HEntry(0, 8, 14, "leo"), HEntry(0, 14, 20, "priya"), HEntry(0, 20, 24, "maya"),
                    HEntry(1, 8, 12, "me"), HEntry(1, 12, 18, "bob"), HEntry(1, 18, 24, "jordan"),
                ),
                // Fri
                listOf(
                    HEntry(0, 8, 12, "sam"), HEntry(0, 12, 18, "jordan"), HEntry(0, 18, 24, "leo"),
                    HEntry(1, 8, 14, "priya"), HEntry(1, 14, 20, "steve"), HEntry(1, 20, 24, "bob", pending = true),
                ),
                // Sat — Harnwell's band is 08:00–24:00 EVERY day (incl. weekends), headcount 2,
                // so the early/late gaps before the first / after the last booked worker are
                // OPEN seats, not blank — both lanes are filled the whole window.
                listOf(
                    HEntry(0, 8, 10, "open"), HEntry(0, 10, 16, "maya"), HEntry(0, 16, 22, "priya"), HEntry(0, 22, 24, "open"),
                    HEntry(1, 8, 10, "open"), HEntry(1, 10, 17, "leo"), HEntry(1, 17, 24, "sam"),
                ),
                // Sun — same full-band coverage; the uncovered runs surface as Open.
                listOf(
                    HEntry(0, 8, 10, "open"), HEntry(0, 10, 17, "leo"), HEntry(0, 17, 24, "sam"),
                    HEntry(1, 8, 10, "open"), HEntry(1, 10, 16, "open"), HEntry(1, 16, 22, "maya"), HEntry(1, 22, 24, "open"),
                ),
            )
        val seats = mutableListOf<HouseSeat>()
        week.forEachIndexed { dayIdx, entries ->
            val date = monday.plus(dayIdx, DateTimeUnit.DAY)
            entries.forEach { e ->
                val base = LocalDateTime(date, LocalTime(e.sh, 0)).toInstant(NEW_YORK)
                val vacant = e.who == "open"
                val (name, uid, phone) = houseWorker(e.who, meUserId, isHome)
                val blocks = (e.eh - e.sh) * 2
                for (i in 0 until blocks) {
                    seats +=
                        HouseSeat(
                            id = "hw-$dayIdx-${e.lane}-${e.sh}-$i",
                            start = base + (i * 30).minutes,
                            end = base + ((i + 1) * 30).minutes,
                            vacant = vacant,
                            pending = e.pending,
                            floatIn = e.floatIn || e.pending,
                            userId = if (vacant) null else uid,
                            workerName = if (vacant) null else name,
                            workerPhone = if (vacant) null else phone,
                        )
                }
            }
        }
        return seats
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

    // ── Hand-off recipient directory (§8.5, NEW ✦) ──────────────────────────────────
    /**
     * A deterministic cross-house staff-worker directory for the hand-off recipient
     * picker (live: `worker_directory` ∪ `houses`). The demo proposer is `"demo"` (the
     * login-bypass id `SwapCalendarSheet` uses), home house Harnwell — so "My House"
     * lists their Harnwell housemates and "Others" groups every other house. Several
     * houses with ~8 workers each so the grouped, searchable "Others" tab is exercised.
     */
    fun workerDirectory(): List<HandoffWorker> {
        fun house(
            houseId: String,
            houseName: String,
            names: List<String>,
        ): List<HandoffWorker> =
            names.mapIndexed { i, n ->
                HandoffWorker(
                    userId = "dir-$houseId-$i",
                    name = n,
                    homeHouseId = houseId,
                    homeHouseName = houseName,
                )
            }
        return listOf(
            // The demo proposer — their own row makes Harnwell the "My House" tab.
            HandoffWorker(userId = "demo", name = "Andrew P.", homeHouseId = "harnwell", homeHouseName = "Harnwell"),
        ) +
            house("harnwell", "Harnwell", listOf("Maya R.", "Bob L.", "Steve M.", "Jordan K.", "Priya N.", "Devon W.")) +
            house("quad", "Quad", listOf("Alex T.", "Casey D.", "Morgan H.", "Riley S.", "Sam V.", "Taylor B.", "Jamie L.")) +
            house("house-03", "Gregory", listOf("Nina P.", "Omar F.", "Grace L.", "Kofi A.", "Lena M.")) +
            house("house-04", "Stouffer", listOf("Hana Y.", "Diego R.", "Mara C.", "Theo K.", "Ivy N.", "Rashid Q.")) +
            house("house-05", "Du Bois", listOf("Yara S.", "Pablo G.", "Esme T.", "Noah W.", "Aria L.")) +
            house("house-06", "Hill", listOf("Felix B.", "Tara M.", "Otis D.", "Quinn R.", "Beth A.", "Cyrus N."))
    }
}

/** One authored demo desk entry — lane, [sh, eh) hours, and a registry `who` key. */
private class HEntry(
    val lane: Int,
    val sh: Int,
    val eh: Int,
    val who: String,
    val pending: Boolean = false,
    val floatIn: Boolean = false,
)

/**
 * Registry: `who` key → (name, userId, phone). "me" is the signed-in worker — but only
 * in the home house; on another house's demo grid the same slot becomes a regular
 * housemate (no "You" treatment when viewing a house that isn't yours).
 */
private fun houseWorker(
    who: String,
    meUserId: String,
    isHome: Boolean = true,
): Triple<String, String, String?> =
    when (who) {
        "me" -> if (isHome) Triple("You", meUserId, null) else Triple("Devon W.", "u-devon", "+1 215 555 0108")
        "maya" -> Triple("Maya R.", "u-maya", "+1 215 555 0101")
        "bob" -> Triple("Bob L.", "u-bob", "+1 215 555 0103")
        "steve" -> Triple("Steve M.", "u-steve", "+1 215 555 0104")
        "jordan" -> Triple("Jordan K.", "u-jordan", "+1 215 555 0102")
        "priya" -> Triple("Priya N.", "u-priya", "+1 215 555 0105")
        "leo" -> Triple("Leo M.", "u-leo", "+1 215 555 0106")
        "sam" -> Triple("Sam T.", "u-sam", "+1 215 555 0107")
        else -> Triple(who, "u-$who", null)
    }
