package com.pennhousing.shift.shared.samples

import com.pennhousing.shift.shared.data.WorkerSnapshot
import com.pennhousing.shift.shared.model.AssignmentKind
import com.pennhousing.shift.shared.model.FloatAck
import com.pennhousing.shift.shared.model.House
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.model.OpenFeed
import com.pennhousing.shift.shared.model.OpenShift
import kotlin.time.Duration.Companion.days
import kotlin.time.Duration.Companion.hours
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
}
