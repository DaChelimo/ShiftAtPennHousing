package com.pennhousing.shift.shared.samples

import com.pennhousing.shift.shared.data.WorkerSnapshot
import com.pennhousing.shift.shared.model.AssignmentKind
import com.pennhousing.shift.shared.model.FloatAck
import com.pennhousing.shift.shared.model.House
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.model.OpenFeed
import com.pennhousing.shift.shared.model.OpenShift
import com.pennhousing.shift.shared.notifications.NotificationCategory
import com.pennhousing.shift.shared.notifications.NotificationItem
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
        val myShifts =
            listOf(
                MyShift("pk-1", quad, now + 2.days, now + 2.days + 2.hours, AssignmentKind.TEMP_PICKUP, crossHouse = true),
                MyShift("sc-1", harnwell, now + 1.days, now + 1.days + 2.hours, AssignmentKind.SCHEDULED),
                MyShift("pp-1", harnwell, now + 3.days, now + 3.days + 2.hours, AssignmentKind.PERMANENT_PICKUP),
            )
        val openShifts =
            listOf(
                OpenShift("hw-1", harnwell, now + 1.days, now + 1.days + 2.hours, OpenFeed.WEEKLY, homeHouse = true),
                OpenShift(
                    "hp-1",
                    harnwell,
                    now + 2.days,
                    now + 2.days + 2.hours,
                    OpenFeed.PERMANENT_OPENING,
                    homeHouse = true,
                    weeksRemaining = 6,
                ),
                OpenShift("qw-1", quad, now + 1.days, now + 1.days + 2.hours, OpenFeed.WEEKLY, homeHouse = false),
            )
        return WorkerSnapshot(myShifts = myShifts, openShifts = openShifts)
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
}
