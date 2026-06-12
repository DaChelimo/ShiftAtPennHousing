package com.pennhousing.shift.shared.shifts

import com.pennhousing.shift.shared.model.AssignmentKind
import com.pennhousing.shift.shared.model.House
import com.pennhousing.shift.shared.model.MyShift
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Instant

/**
 * Partial drop (§5.2, T2-11) — planning a sub-range drop over a coalesced card's
 * 30-min blocks: the selected contiguous `assignment_id` run, the resulting gap,
 * the mid-shift "drop from now" index (the spec's 17:51 → 17:30 example), and the
 * short-notice flag anchored to the SELECTED gap start. Fixtures pin explicit
 * America/New_York offsets (EST -05:00).
 */
class PartialDropTest {
    private fun at(iso: String): Instant = Instant.parse(iso)

    private val harnwell = House("harnwell", "Harnwell")

    /** A coalesced card of [n] 30-min blocks from [startIso], blockIds `b-0..n-1`. */
    private fun card(
        startIso: String,
        n: Int,
    ): MyShift {
        val start = at(startIso)
        return MyShift(
            id = "b-0",
            house = harnwell,
            start = start,
            end = start + (n * 30).minutes,
            kind = AssignmentKind.SCHEDULED,
            blockIds = (0 until n).map { "b-$it" },
        )
    }

    private val noon = at("2026-01-15T12:00:00-05:00")

    @Test fun full_range_plans_the_whole_shift() {
        val shift = card("2026-01-15T15:00:00-05:00", 4) // 15:00–17:00
        val plan = planPartialDrop(shift, 0, 4, noon)
        assertTrue(plan.wholeShift)
        assertEquals(shift.blockIds, plan.blockIds)
        assertEquals(shift.start, plan.gapStart)
        assertEquals(shift.end, plan.gapEnd)
    }

    @Test fun middle_range_selects_the_contiguous_sub_run() {
        val shift = card("2026-01-15T15:00:00-05:00", 8) // 15:00–19:00
        val plan = planPartialDrop(shift, 2, 5, noon) // 16:00–17:30
        assertFalse(plan.wholeShift)
        assertEquals(listOf("b-2", "b-3", "b-4"), plan.blockIds)
        assertEquals(at("2026-01-15T16:00:00-05:00"), plan.gapStart)
        assertEquals(at("2026-01-15T17:30:00-05:00"), plan.gapEnd)
        // NY-anchored labels precomputed for both front ends.
        assertEquals("16:00 – 17:30", plan.rangeLabel)
        assertEquals("1h 30m", plan.durationLabel)
        assertEquals("16:00", plan.gapStartLabel)
        assertEquals("17:30", plan.gapEndLabel)
    }

    @Test fun out_of_range_indexes_clamp_to_a_non_empty_run() {
        val shift = card("2026-01-15T15:00:00-05:00", 4)
        val plan = planPartialDrop(shift, -3, 99, noon)
        assertTrue(plan.wholeShift)
        val inverted = planPartialDrop(shift, 3, 1, noon) // to <= from → one block at from
        assertEquals(listOf("b-3"), inverted.blockIds)
    }

    @Test fun single_id_span_always_plans_the_whole_shift() {
        // A hand-built span without per-block ids cannot sub-divide — the partial
        // selector needs real assignment ids to target.
        val span =
            MyShift("sp", harnwell, at("2026-01-15T15:00:00-05:00"), at("2026-01-15T17:00:00-05:00"), AssignmentKind.SCHEDULED)
        val plan = planPartialDrop(span, 1, 3, noon)
        assertTrue(plan.wholeShift)
        assertEquals(listOf("sp"), plan.blockIds)
        assertEquals(span.start, plan.gapStart)
        assertEquals(span.end, plan.gapEnd) // gapEnd anchors at the SHIFT end, not start+30m
    }

    @Test fun mid_shift_drop_from_now_matches_the_spec_example() {
        // §5.2: "A drop initiated at 17:51 of a 15:00–24:00 shift produces a gap of
        // 17:30–24:00" — block index 5, trailing selection to the end.
        val shift = card("2026-01-15T15:00:00-05:00", 18) // 15:00–24:00
        val now = at("2026-01-15T17:51:00-05:00")
        val idx = blockIndexAt(shift, now)
        assertEquals(5, idx)
        val plan = planPartialDrop(shift, idx!!, shift.blockIds.size, now)
        assertEquals(at("2026-01-15T17:30:00-05:00"), plan.gapStart)
        assertEquals(at("2026-01-16T00:00:00-05:00"), plan.gapEnd)
        assertEquals(13, plan.blockIds.size) // blocks 5..17
        assertTrue(plan.shortNotice) // the gap opens 21 min ago — already underway
    }

    @Test fun block_index_is_null_outside_the_shift() {
        val shift = card("2026-01-15T15:00:00-05:00", 4) // 15:00–17:00
        assertNull(blockIndexAt(shift, at("2026-01-15T14:59:00-05:00")))
        assertEquals(0, blockIndexAt(shift, at("2026-01-15T15:00:00-05:00")))
        assertEquals(3, blockIndexAt(shift, at("2026-01-15T16:59:00-05:00")))
        assertNull(blockIndexAt(shift, at("2026-01-15T17:00:00-05:00"))) // end is exclusive
    }

    @Test fun short_notice_anchors_to_the_selected_gap_start_not_the_shift_start() {
        val shift = card("2026-01-15T12:10:00-05:00", 4) // starts in 10 min
        val now = noon
        // Leading selection starts within 20 min → short notice.
        assertTrue(planPartialDrop(shift, 0, 2, now).shortNotice)
        // Trailing selection starts 70 min out → NOT short notice.
        assertFalse(planPartialDrop(shift, 2, 4, now).shortNotice)
    }

    @Test fun sub_shift_carries_the_selected_run_and_keeps_treatment_flags() {
        val shift = card("2026-01-15T15:00:00-05:00", 8).copy(breakShift = true)
        val plan = planPartialDrop(shift, 2, 5, noon)
        val sub = subShiftFor(shift, plan)
        assertEquals("b-2", sub.id) // first selected block — a real assignment id
        assertEquals(plan.gapStart, sub.start)
        assertEquals(plan.gapEnd, sub.end)
        assertEquals(listOf("b-2", "b-3", "b-4"), sub.blockIds)
        assertTrue(sub.breakShift)
        assertEquals(shift.house, sub.house)
    }
}
