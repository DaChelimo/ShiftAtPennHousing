package com.pennhousing.shift.shared.shifts

import com.pennhousing.shift.shared.model.House
import com.pennhousing.shift.shared.model.OpenFeed
import com.pennhousing.shift.shared.model.OpenShift
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Instant

/**
 * Partial claim (§5.3, T2-10 — design-extra) — planning a sub-range claim over a
 * coalesced OPEN card's 30-min blocks: the selected contiguous vacant
 * `assignment_id` run (claimed per-block; FCFS server-side), the covered span the
 * cap meter recomputes from, and the NY labels. Fixtures pin EST -05:00.
 */
class PartialClaimTest {
    private fun at(iso: String): Instant = Instant.parse(iso)

    private val harnwell = House("harnwell", "Harnwell")

    /** A coalesced opening of [n] 30-min blocks from [startIso], blockIds `o-0..n-1`. */
    private fun opening(
        startIso: String,
        n: Int,
        feed: OpenFeed = OpenFeed.WEEKLY,
    ): OpenShift {
        val start = at(startIso)
        return OpenShift(
            id = "o-0",
            house = harnwell,
            start = start,
            end = start + (n * 30).minutes,
            feed = feed,
            homeHouse = true,
            blockIds = (0 until n).map { "o-$it" },
        )
    }

    @Test fun full_range_plans_the_whole_opening() {
        val shift = opening("2026-01-15T15:00:00-05:00", 4)
        val plan = planPartialClaim(shift, 0, 4)
        assertTrue(plan.wholeShift)
        assertEquals(shift.blockIds, plan.blockIds)
        assertEquals(shift.start, plan.claimStart)
        assertEquals(shift.end, plan.claimEnd)
    }

    @Test fun sub_range_selects_the_contiguous_run_with_labels() {
        val shift = opening("2026-01-15T15:00:00-05:00", 8) // 15:00-19:00
        val plan = planPartialClaim(shift, 1, 4) // 15:30-17:00
        assertFalse(plan.wholeShift)
        assertEquals(listOf("o-1", "o-2", "o-3"), plan.blockIds)
        assertEquals(at("2026-01-15T15:30:00-05:00"), plan.claimStart)
        assertEquals(at("2026-01-15T17:00:00-05:00"), plan.claimEnd)
        assertEquals("15:30 - 17:00", plan.rangeLabel)
        assertEquals("1h 30m", plan.durationLabel)
        assertEquals("15:30", plan.claimStartLabel)
        assertEquals("17:00", plan.claimEndLabel)
    }

    @Test fun indexes_clamp_to_a_non_empty_run() {
        val shift = opening("2026-01-15T15:00:00-05:00", 4)
        assertTrue(planPartialClaim(shift, -2, 99).wholeShift)
        assertEquals(listOf("o-3"), planPartialClaim(shift, 3, 1).blockIds)
    }

    @Test fun single_id_span_always_plans_the_whole_opening() {
        val span =
            OpenShift("sp", harnwell, at("2026-01-15T15:00:00-05:00"), at("2026-01-15T17:00:00-05:00"), OpenFeed.WEEKLY, homeHouse = true)
        val plan = planPartialClaim(span, 1, 3)
        assertTrue(plan.wholeShift)
        assertEquals(listOf("sp"), plan.blockIds)
        assertEquals(span.end, plan.claimEnd) // anchors at the SHIFT end
    }

    @Test fun sub_opening_carries_the_selected_run_and_keeps_feed_identity() {
        val shift = opening("2026-01-15T15:00:00-05:00", 8)
        val plan = planPartialClaim(shift, 2, 5)
        val sub = subOpenShiftFor(shift, plan)
        assertEquals("o-2", sub.id) // first selected block — a real vacant assignment id
        assertEquals(plan.claimStart, sub.start)
        assertEquals(plan.claimEnd, sub.end)
        assertEquals(listOf("o-2", "o-3", "o-4"), sub.blockIds)
        assertEquals(OpenFeed.WEEKLY, sub.feed)
        assertTrue(sub.homeHouse)
        assertEquals(shift.house, sub.house)
    }

    @Test fun cap_meter_recomputes_from_the_selected_span() {
        // §5.3: claiming 1.5h of a 4h opening on top of 19h is 20.5h → soft warning,
        // but a 1h selection is exactly 20h → OK. The meter sees only the selection.
        val shift = opening("2026-01-15T15:00:00-05:00", 8)
        val threeBlocks = planPartialClaim(shift, 0, 3)
        val twoBlocks = planPartialClaim(shift, 0, 2)
        assertEquals(
            ClaimCapVerdict.SOFT_CAP_WARNING,
            evaluateClaimCap(19.0, hoursBetween(threeBlocks.claimStart, threeBlocks.claimEnd), WeeklyCap.FALLBACK),
        )
        assertEquals(
            ClaimCapVerdict.OK,
            evaluateClaimCap(19.0, hoursBetween(twoBlocks.claimStart, twoBlocks.claimEnd), WeeklyCap.FALLBACK),
        )
    }
}
