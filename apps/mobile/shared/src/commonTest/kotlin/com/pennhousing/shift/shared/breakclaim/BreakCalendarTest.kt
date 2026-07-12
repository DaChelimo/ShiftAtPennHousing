package com.pennhousing.shift.shared.breakclaim

import kotlinx.datetime.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Instant

/**
 * Break CALENDAR drag/trim/coverage (Break redesign B2) — the tested heart. All seats sit
 * on Fri 2029-11-23 (EST -05:00); the shown week is Mon 2029-11-19 → Fri = index 4. The
 * break window is 2029-11-19 .. 2029-11-25 so the Friday is in-window.
 */
class BreakCalendarTest {
    private fun at(iso: String): Instant = Instant.parse(iso)
    private val me = "me"
    private val mon = LocalDate.parse("2029-11-19")
    private val friIndex = 4

    /** A block's seats: the first [occupants] fill it (scheduled), the rest are vacant. */
    private fun block(
        blockId: String,
        startIso: String,
        required: Int = 1,
        occupants: List<Pair<String, String>> = emptyList(),
    ): List<BreakCalendarSeat> {
        val start = at(startIso)
        return (0 until required).map { i ->
            val occ = occupants.getOrNull(i)
            BreakCalendarSeat(
                id = "$blockId-s$i",
                blockId = blockId,
                start = start,
                end = start + 30.minutes,
                status = if (occ != null) "scheduled" else "vacant",
                requiredHeadcount = required,
                userId = occ?.first,
                workerName = occ?.second,
            )
        }
    }

    private fun snap(
        seats: List<BreakCalendarSeat>,
        phase: BreakPhase = BreakPhase.CLAIM_WINDOW,
        cap: Double = 40.0,
    ): BreakCalendarSnapshot =
        BreakCalendarSnapshot(
            houseName = "Quad",
            breakName = "Winter Break",
            phase = phase,
            meUserId = me,
            seats = seats,
            windowStart = LocalDate.parse("2029-11-19"),
            windowEnd = LocalDate.parse("2029-11-25"),
            cap = cap,
        )

    private fun day(s: BreakCalendarSnapshot) = buildBreakCalendarDay(s, mon, friIndex)

    // ── coverage ────────────────────────────────────────────────────────────
    @Test fun coverage_counts_filled_of_required_and_open_capacity() {
        val s = snap(block("q9", "2029-11-23T09:00:00-05:00", required = 3, occupants = listOf("u1" to "Ann")))
        val cov = day(s).blocks.single()
        assertEquals(3, cov.requiredHeadcount)
        assertEquals(1, cov.filled)
        assertEquals(2, cov.open)
        assertFalse(cov.full)
        assertEquals("1 / 3", cov.coverageLabel)
    }

    @Test fun a_block_at_required_headcount_is_full() {
        val s = snap(block("r1", "2029-11-23T09:00:00-05:00", required = 1, occupants = listOf("u1" to "Ann")))
        assertTrue(day(s).blocks.single().full)
    }

    @Test fun highlight_lane_picks_the_open_seat_nearest_the_finger() {
        // Both seats open → the column under the finger highlights.
        val open2 = day(snap(block("q", "2029-11-23T09:00:00-05:00", required = 2))).blocks.single()
        assertEquals(0, open2.highlightLane(0))
        assertEquals(1, open2.highlightLane(1))
        // Half-full (occupied left-packed) → the single open seat highlights regardless of finger.
        val half = day(snap(block("q", "2029-11-23T09:00:00-05:00", required = 2, occupants = listOf("u1" to "Ann")))).blocks.single()
        assertEquals(1, half.highlightLane(0))
        assertEquals(1, half.highlightLane(1))
        // Full → nothing to highlight.
        val full = day(snap(block("q", "2029-11-23T09:00:00-05:00", required = 2, occupants = listOf("u1" to "Ann", "u2" to "Bea")))).blocks.single()
        assertEquals(null, full.highlightLane(0))
    }

    // ── single-staff drag ─────────────────────────────────────────────────────
    @Test fun drag_over_all_vacant_single_staff_blocks_claims_them_all_as_one_segment() {
        val s =
            snap(
                block("b0", "2029-11-23T08:00:00-05:00") +
                    block("b1", "2029-11-23T08:30:00-05:00") +
                    block("b2", "2029-11-23T09:00:00-05:00"),
            )
        val plan = planBreakDrag(s, day(s), 0, 2)
        assertEquals(listOf("b0", "b1", "b2"), plan.claimableBlockIds)
        assertEquals(1, plan.claimedSegments.size)
        assertEquals("08:00 - 09:30", plan.claimedSegments.single().rangeLabel)
        assertTrue(plan.trimmedSegments.isEmpty())
        assertEquals("Claimed 08:00 - 09:30", plan.message)
    }

    @Test fun drag_over_others_full_blocks_claims_nothing() {
        // Both blocks are fully staffed by someone else → no open capacity to anchor on.
        val s =
            snap(
                block("b0", "2029-11-23T08:00:00-05:00", occupants = listOf("u1" to "Ann")) +
                    block("b1", "2029-11-23T08:30:00-05:00", occupants = listOf("u1" to "Ann")),
            )
        val plan = planBreakDrag(s, day(s), 0, 1)
        assertEquals(BreakDragMode.CLAIM, plan.mode)
        assertFalse(plan.claimable)
        assertFalse(plan.droppable)
    }

    // ── multi-staff fill-any-open-seat ────────────────────────────────────────
    @Test fun drag_over_a_partly_full_multi_staff_block_is_still_claimable() {
        val s = snap(block("q", "2029-11-23T09:00:00-05:00", required = 3, occupants = listOf("u1" to "Ann")))
        val plan = planBreakDrag(s, day(s), 0, 0)
        assertEquals(listOf("q"), plan.claimableBlockIds)
    }

    // ── interior hole: two claimed segments + one trim ────────────────────────
    @Test fun an_interior_full_block_splits_the_claim_and_the_message_reports_both() {
        val s =
            snap(
                block("b0", "2029-11-23T08:00:00-05:00") +
                    block("b1", "2029-11-23T08:30:00-05:00", occupants = listOf("u1" to "Ann")) +
                    block("b2", "2029-11-23T09:00:00-05:00"),
            )
        val plan = planBreakDrag(s, day(s), 0, 2)
        assertEquals(listOf("b0", "b2"), plan.claimableBlockIds)
        assertEquals(2, plan.claimedSegments.size) // 08:00–08:30 and 09:00–09:30
        assertEquals(1, plan.trimmedSegments.size)
        assertEquals(BreakDragSkip.FULL, plan.trimmedSegments.single().reason)
        assertEquals(
            "Claimed 08:00 - 08:30, 09:00 - 09:30 · 08:30 - 09:00 was already full",
            plan.message,
        )
    }

    // ── anchor: a drag that STARTS on my own shift then runs over open capacity ──
    @Test fun a_drag_anchored_on_my_own_shift_claims_the_open_part_from_the_first_open_block() {
        val s =
            snap(
                // block 0: I already hold a seat here (the drag's anchor) → excluded, not claimed.
                block("b0", "2029-11-23T08:00:00-05:00", required = 3, occupants = listOf(me to "You")) +
                    block("b1", "2029-11-23T08:30:00-05:00"),
            )
        val plan = planBreakDrag(s, day(s), 0, 1)
        assertEquals(BreakDragMode.CLAIM, plan.mode)
        assertEquals(listOf("b1"), plan.claimableBlockIds) // only the open part, anchored past b0
        assertTrue(plan.skippedConflictBlockIds.isEmpty()) // the anchor block is not a "conflict"
    }

    // ── DROP: a drag entirely over my own coverage offers to drop it ────────────
    @Test fun a_drag_entirely_over_my_own_shifts_is_a_drop() {
        val mine =
            block("b0", "2029-11-23T08:00:00-05:00").map { it.copy(status = "claimed", userId = me, workerName = "You") } +
                block("b1", "2029-11-23T08:30:00-05:00").map { it.copy(status = "claimed", userId = me, workerName = "You") }
        val s = snap(mine)
        val plan = planBreakDrag(s, day(s), 0, 1)
        assertEquals(BreakDragMode.DROP, plan.mode)
        assertTrue(plan.droppable)
        assertEquals(listOf("b0-s0", "b1-s0"), plan.dropSeatIds)
        assertEquals("08:00 - 09:00", plan.dropLabel)
        assertEquals("Drop your 08:00 - 09:00 shift?", plan.message)
    }

    // ── mixed: own shift then a run of open shifts → claim the open run ─────────
    @Test fun a_drag_from_my_shift_into_open_capacity_claims_from_the_first_open_block() {
        val mineBlock = block("b0", "2029-11-23T08:00:00-05:00").map { it.copy(status = "claimed", userId = me, workerName = "You") }
        val s =
            snap(
                mineBlock +
                    block("b1", "2029-11-23T08:30:00-05:00") +
                    block("b2", "2029-11-23T09:00:00-05:00"),
            )
        val plan = planBreakDrag(s, day(s), 0, 2)
        assertEquals(BreakDragMode.CLAIM, plan.mode)
        assertEquals(listOf("b1", "b2"), plan.claimableBlockIds) // anchored past my b0
    }

    // ── hard cap: claims to the cap, trims the tail ───────────────────────────
    @Test fun a_drag_crossing_the_hard_cap_claims_to_the_cap_and_trims_the_rest() {
        val s =
            snap(
                block("b0", "2029-11-23T08:00:00-05:00") +
                    block("b1", "2029-11-23T08:30:00-05:00") +
                    block("b2", "2029-11-23T09:00:00-05:00") +
                    block("b3", "2029-11-23T09:30:00-05:00"),
                cap = 1.0, // only 2 blocks (1h) fit
            )
        val plan = planBreakDrag(s, day(s), 0, 3)
        assertEquals(listOf("b0", "b1"), plan.claimableBlockIds)
        assertEquals(listOf("b2", "b3"), plan.capTrimmedBlockIds)
        assertTrue(plan.capExceeded)
        assertEquals(1.0, plan.projectedHours)
    }

    // ── phase gating ──────────────────────────────────────────────────────────
    @Test fun nothing_is_claimable_before_the_window_opens() {
        val s = snap(block("b0", "2029-11-23T08:00:00-05:00"), phase = BreakPhase.PRE_OPEN)
        val plan = planBreakDrag(s, day(s), 0, 0)
        assertFalse(plan.claimable)
        assertEquals("Claiming isn't open right now", plan.message)
    }

    @Test fun nothing_is_claimable_after_the_window_closes_open_feed() {
        val s = snap(block("b0", "2029-11-23T08:00:00-05:00"), phase = BreakPhase.OPEN_FEED)
        assertFalse(planBreakDrag(s, day(s), 0, 0).claimable)
    }

    // ── optimistic apply / reconcile / drop ───────────────────────────────────
    @Test fun apply_marks_exactly_the_claimable_seats_mine_and_updates_coverage() {
        val s =
            snap(
                block("b0", "2029-11-23T08:00:00-05:00") +
                    block("b1", "2029-11-23T08:30:00-05:00"),
            )
        val plan = planBreakDrag(s, day(s), 0, 1)
        val after = applyBreakDrag(s, plan)
        assertEquals(1.0, after.claimedHours())
        val cov = day(after).blocks
        assertTrue(cov.all { it.mineHere })
    }

    @Test fun reconcile_reverts_a_seat_the_server_did_not_actually_claim() {
        val s =
            snap(
                block("b0", "2029-11-23T08:00:00-05:00") +
                    block("b1", "2029-11-23T08:30:00-05:00"),
            )
        val optimistic = applyBreakDrag(s, planBreakDrag(s, day(s), 0, 1))
        // Server only confirmed b0's seat; b1 was lost (FCFS) → revert b1.
        val reconciled = reconcileBreakClaim(optimistic, setOf("b0-s0"))
        assertEquals(0.5, reconciled.claimedHours())
        assertTrue(reconciled.seats.single { it.id == "b1-s0" }.vacant)
    }

    @Test fun drop_returns_my_seat_to_the_pool() {
        val mine = block("b0", "2029-11-23T08:00:00-05:00").map { it.copy(status = "claimed", userId = me, workerName = "You") }
        val s = snap(mine)
        assertEquals(0.5, s.claimedHours())
        val after = applyBreakDrop(s, setOf("b0-s0"))
        assertEquals(0.0, after.claimedHours())
        assertTrue(after.seats.single().vacant)
    }

    // ── roster coalescing (read-only cards) ───────────────────────────────────
    @Test fun roster_coalesces_a_workers_contiguous_seats_and_flags_mine() {
        val ann =
            block("a0", "2029-11-23T08:00:00-05:00", occupants = listOf("u1" to "Ann")) +
                block("a1", "2029-11-23T08:30:00-05:00", occupants = listOf("u1" to "Ann"))
        val you = block("y0", "2029-11-23T10:00:00-05:00").map { it.copy(status = "claimed", userId = me, workerName = "You") }
        val roster = day(snap(ann + you)).roster
        assertEquals(2, roster.size)
        val annRun = roster.single { it.workerName == "Ann" }
        assertEquals("08:00 - 09:00", annRun.timeLabel)
        assertFalse(annRun.mine)
        assertTrue(roster.single { it.workerName == "You" }.mine)
    }

    // ── week navigation across the window ─────────────────────────────────────
    @Test fun break_weeks_lists_every_monday_intersecting_the_window() {
        assertEquals(1, breakWeeks(LocalDate.parse("2029-11-19"), LocalDate.parse("2029-11-25")).size)
        assertEquals(2, breakWeeks(LocalDate.parse("2029-11-19"), LocalDate.parse("2029-12-02")).size)
    }

    @Test fun phase_from_wire_maps_the_sql_strings() {
        assertEquals(BreakPhase.CLAIM_WINDOW, BreakPhase.fromWire("claim_window"))
        assertEquals(BreakPhase.OPEN_FEED, BreakPhase.fromWire("open_feed"))
        assertEquals(BreakPhase.PRE_OPEN, BreakPhase.fromWire("pre_open"))
        assertEquals(BreakPhase.PRE_OPEN, BreakPhase.fromWire(null))
    }
}
