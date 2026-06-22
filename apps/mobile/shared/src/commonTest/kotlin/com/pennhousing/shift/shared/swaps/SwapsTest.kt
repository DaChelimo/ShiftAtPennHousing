package com.pennhousing.shift.shared.swaps

import com.pennhousing.shift.shared.house.HouseSeat
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
 * Swap initiation (§8.1–§8.4, D2/D3) — which proposal kinds a card offers, the
 * counterparty picker derived from the house grid, and the EF proposal mapping.
 * The server stays authoritative for eligibility; these pin the CLIENT contract.
 */
class SwapsTest {
    private fun at(iso: String): Instant = Instant.parse(iso)

    private val harnwell = House("harnwell", "Harnwell")

    private fun myShift(
        kind: AssignmentKind,
        dropped: Boolean = false,
    ) = MyShift(
        id = "m-0",
        house = harnwell,
        start = at("2026-01-15T14:00:00-05:00"),
        end = at("2026-01-15T16:00:00-05:00"),
        kind = kind,
        droppedStillOpen = dropped,
        blockIds = listOf("m-0", "m-1", "m-2", "m-3"),
    )

    private fun seats(
        prefix: String,
        startIso: String,
        n: Int,
        userId: String?,
        name: String? = userId?.let { "W $it" },
        vacant: Boolean = false,
        pending: Boolean = false,
    ): List<HouseSeat> {
        val start = at(startIso)
        return (0 until n).map { i ->
            HouseSeat(
                id = "$prefix-$i",
                start = start + (i * 30).minutes,
                end = start + ((i + 1) * 30).minutes,
                vacant = vacant,
                pending = pending,
                floatIn = pending,
                userId = userId,
                workerName = name,
                workerPhone = null,
            )
        }
    }

    // ----- kinds (§8.1/§8.2/§8.3) -----

    @Test fun scheduled_card_offers_shift_and_permanent_outside_break() {
        assertEquals(listOf(SwapKind.SHIFT, SwapKind.PERMANENT), swapKindsFor(myShift(AssignmentKind.SCHEDULED), breakProfile = false))
        // §8.3 — permanent swaps never apply during break profiles.
        assertEquals(listOf(SwapKind.SHIFT), swapKindsFor(myShift(AssignmentKind.SCHEDULED), breakProfile = true))
    }

    @Test fun float_card_offers_only_a_float_swap_and_pickups_only_shift() {
        assertEquals(listOf(SwapKind.FLOAT), swapKindsFor(myShift(AssignmentKind.FLOAT_OUT), breakProfile = false))
        assertEquals(listOf(SwapKind.SHIFT), swapKindsFor(myShift(AssignmentKind.TEMP_PICKUP), breakProfile = false))
        assertEquals(listOf(SwapKind.SHIFT), swapKindsFor(myShift(AssignmentKind.PERMANENT_PICKUP), breakProfile = false))
    }

    @Test fun dropped_still_open_card_offers_nothing() {
        assertTrue(swapKindsFor(myShift(AssignmentKind.SCHEDULED, dropped = true), breakProfile = false).isEmpty())
    }

    // ----- candidates (the §11.4 house grid → picker) -----

    @Test fun candidates_coalesce_runs_and_exclude_self_vacant_and_pending() {
        val mine = seats("me", "2026-01-15T10:00:00-05:00", 2, userId = "u-me")
        val theirs = seats("a", "2026-01-15T14:00:00-05:00", 4, userId = "u-a")
        val vacant = seats("v", "2026-01-15T18:00:00-05:00", 2, userId = null, name = null, vacant = true)
        val pending = seats("p", "2026-01-15T20:00:00-05:00", 2, userId = "u-p", pending = true)
        val out = swapCandidates(mine + theirs + vacant + pending, excludeUserId = "u-me")
        val candidate = out.single()
        assertEquals("u-a", candidate.userId)
        assertEquals(listOf("a-0", "a-1", "a-2", "a-3"), candidate.seatIds)
        assertEquals("14:00 – 16:00", candidate.timeLabel)
        assertEquals("2h", candidate.durationLabel)
    }

    @Test fun permanent_picker_dedupes_to_one_entry_per_person() {
        val runA = seats("a", "2026-01-15T14:00:00-05:00", 2, userId = "u-a")
        val runB = seats("b", "2026-01-16T10:00:00-05:00", 2, userId = "u-a")
        val other = seats("c", "2026-01-15T08:00:00-05:00", 2, userId = "u-c")
        val people = swapPeople(swapCandidates(runA + runB + other, excludeUserId = null))
        assertEquals(2, people.size)
        assertEquals(1, people.count { it.userId == "u-a" })
    }

    // ----- proposal mapping (the create-swap contract) -----

    @Test fun temporary_proposal_carries_both_spans() {
        val candidate = swapCandidates(seats("a", "2026-01-15T14:00:00-05:00", 4, userId = "u-a"), excludeUserId = null).single()
        val p = buildSwapProposal(SwapKind.SHIFT, myShift(AssignmentKind.SCHEDULED), candidate)
        assertEquals("shift_swap", p.swapType)
        assertEquals("u-a", p.counterpartyUserId)
        assertEquals(listOf("m-0", "m-1", "m-2", "m-3"), p.initiatorShift.blockIds)
        assertEquals(candidate.seatIds, p.counterpartyAssignmentIds)
        val f = buildSwapProposal(SwapKind.FLOAT, myShift(AssignmentKind.FLOAT_OUT), candidate)
        assertEquals("float_swap", f.swapType)
    }

    @Test fun permanent_proposal_names_a_person_with_no_counterparty_span() {
        val candidate = swapCandidates(seats("a", "2026-01-15T14:00:00-05:00", 4, userId = "u-a"), excludeUserId = null).single()
        val p = buildSwapProposal(SwapKind.PERMANENT, myShift(AssignmentKind.SCHEDULED), candidate)
        assertEquals("permanent_swap", p.swapType)
        assertNull(p.counterpartyAssignmentIds) // §8.4 — acceptance enumerates server-side
    }

    @Test fun temporary_proposal_defaults_to_the_whole_span() {
        val candidate = swapCandidates(seats("a", "2026-01-15T14:00:00-05:00", 4, userId = "u-a"), excludeUserId = null).single()
        val p = buildSwapProposal(SwapKind.SHIFT, myShift(AssignmentKind.SCHEDULED), candidate)
        assertEquals(listOf("m-0", "m-1", "m-2", "m-3"), p.initiatorAssignmentIds)
        assertEquals(candidate.seatIds, p.counterpartyAssignmentIds)
    }

    // ----- partial selection (§8.1: "any contiguous block run, including partial shifts") -----

    @Test fun span_cells_enumerate_one_per_thirty_minutes() {
        val cells = swapSpanCells(listOf("m-0", "m-1", "m-2", "m-3"), at("2026-01-15T14:00:00-05:00"), at("2026-01-15T16:00:00-05:00"))
        assertEquals(4, cells.size)
        assertEquals(listOf("14:00", "14:30", "15:00", "15:30"), cells.map { it.startLabel })
        assertEquals("16:00", cells.last().endLabel)
        assertEquals("m-2", cells[2].blockId)
    }

    @Test fun plan_swap_span_selects_a_contiguous_sub_range_with_labels() {
        val plan = planSwapSpan(listOf("m-0", "m-1", "m-2", "m-3"), at("2026-01-15T14:00:00-05:00"), at("2026-01-15T16:00:00-05:00"), 0, 2)
        assertEquals(listOf("m-0", "m-1"), plan.blockIds)
        assertEquals("Thu · Jan 15", plan.dayLabel) // day + date shown on each picker
        assertEquals("14:00 – 15:00", plan.rangeLabel)
        assertEquals("1h", plan.durationLabel)
        assertFalse(plan.wholeSpan)
    }

    @Test fun plan_swap_span_full_range_is_whole_span() {
        val plan = planSwapSpan(listOf("m-0", "m-1", "m-2", "m-3"), at("2026-01-15T14:00:00-05:00"), at("2026-01-15T16:00:00-05:00"), 0, 4)
        assertEquals(listOf("m-0", "m-1", "m-2", "m-3"), plan.blockIds)
        assertTrue(plan.wholeSpan)
    }

    @Test fun plan_swap_span_clamps_empty_or_inverted_ranges_to_one_block() {
        val ids = listOf("m-0", "m-1", "m-2", "m-3")
        val plan = planSwapSpan(ids, at("2026-01-15T14:00:00-05:00"), at("2026-01-15T16:00:00-05:00"), 2, 2)
        assertEquals(listOf("m-2"), plan.blockIds) // [2,2) coerced to [2,3)
    }

    @Test fun partial_proposal_carries_the_selected_sub_spans() {
        val candidate = swapCandidates(seats("a", "2026-01-15T14:00:00-05:00", 4, userId = "u-a"), excludeUserId = null).single()
        val p =
            buildSwapProposal(
                SwapKind.SHIFT,
                myShift(AssignmentKind.SCHEDULED),
                candidate,
                initiatorBlockIds = listOf("m-0", "m-1"),
                counterpartyBlockIds = candidate.seatIds.subList(0, 2),
            )
        assertEquals(listOf("m-0", "m-1"), p.initiatorAssignmentIds)
        assertEquals(listOf("a-0", "a-1"), p.counterpartyAssignmentIds)
    }

    @Test fun permanent_proposal_carries_the_selected_sub_range_no_counterparty_span() {
        val candidate = swapCandidates(seats("a", "2026-01-15T14:00:00-05:00", 4, userId = "u-a"), excludeUserId = null).single()
        val p =
            buildSwapProposal(
                SwapKind.PERMANENT,
                myShift(AssignmentKind.SCHEDULED),
                candidate,
                initiatorBlockIds = listOf("m-2", "m-3"), // §8.3 now supports a PARTIAL permanent swap
            )
        assertEquals(listOf("m-2", "m-3"), p.initiatorAssignmentIds) // only the trimmed blocks transfer each week
        assertNull(p.counterpartyAssignmentIds) // still person-level (no counterparty span)
    }

    @Test fun permanent_proposal_defaults_to_the_whole_slot_when_unsliced() {
        val candidate = swapCandidates(seats("a", "2026-01-15T14:00:00-05:00", 4, userId = "u-a"), excludeUserId = null).single()
        val p = buildSwapProposal(SwapKind.PERMANENT, myShift(AssignmentKind.SCHEDULED), candidate)
        assertEquals(listOf("m-0", "m-1", "m-2", "m-3"), p.initiatorAssignmentIds) // whole slot by default
        assertNull(p.counterpartyAssignmentIds)
    }

    // ----- multi-party = independent legs (decision 2026-06-15) -----

    @Test fun legs_with_disjoint_initiator_blocks_do_not_overlap() {
        val ben = swapCandidates(seats("b", "2026-01-15T14:00:00-05:00", 2, userId = "u-ben"), excludeUserId = null).single()
        val mary = swapCandidates(seats("y", "2026-01-15T14:00:00-05:00", 2, userId = "u-mary"), excludeUserId = null).single()
        val legs =
            listOf(
                SwapLeg(ben, initiatorBlockIds = listOf("m-0", "m-1"), counterpartyBlockIds = ben.seatIds),
                SwapLeg(mary, initiatorBlockIds = listOf("m-2", "m-3"), counterpartyBlockIds = mary.seatIds),
            )
        assertFalse(legsHaveOverlap(legs))
        assertTrue(unallocatedInitiatorBlocks(listOf("m-0", "m-1", "m-2", "m-3"), legs).isEmpty())
    }

    @Test fun overlapping_legs_are_flagged_and_unallocated_tracks_remaining() {
        val ben = swapCandidates(seats("b", "2026-01-15T14:00:00-05:00", 2, userId = "u-ben"), excludeUserId = null).single()
        val mary = swapCandidates(seats("y", "2026-01-15T14:00:00-05:00", 2, userId = "u-mary"), excludeUserId = null).single()
        val legs =
            listOf(
                SwapLeg(ben, initiatorBlockIds = listOf("m-0", "m-1"), counterpartyBlockIds = ben.seatIds),
                SwapLeg(mary, initiatorBlockIds = listOf("m-1", "m-2"), counterpartyBlockIds = mary.seatIds), // shares m-1
            )
        assertTrue(legsHaveOverlap(legs))
        // With only the first leg allocated, m-2/m-3 remain pickable.
        assertEquals(listOf("m-2", "m-3"), unallocatedInitiatorBlocks(listOf("m-0", "m-1", "m-2", "m-3"), legs.subList(0, 1)))
    }

    @Test fun first_free_range_finds_the_first_unallocated_run() {
        // blocks 0..3; legs took 0,1 → first free run is [2,4).
        assertEquals(BlockRange(2, 4), firstFreeRange(4, allocated = setOf(0, 1)))
        // a hole in the middle: 1 taken → first free run is [0,1).
        assertEquals(BlockRange(0, 1), firstFreeRange(4, allocated = setOf(1)))
        // everything taken → null.
        assertNull(firstFreeRange(2, allocated = setOf(0, 1)))
        // nothing taken → the whole span.
        assertEquals(BlockRange(0, 4), firstFreeRange(4, allocated = emptySet()))
    }

    @Test fun build_swap_proposals_emits_one_independent_proposal_per_leg() {
        val ben = swapCandidates(seats("b", "2026-01-15T14:00:00-05:00", 2, userId = "u-ben"), excludeUserId = null).single()
        val mary = swapCandidates(seats("y", "2026-01-15T14:00:00-05:00", 2, userId = "u-mary"), excludeUserId = null).single()
        val legs =
            listOf(
                SwapLeg(ben, initiatorBlockIds = listOf("m-0", "m-1"), counterpartyBlockIds = ben.seatIds),
                SwapLeg(mary, initiatorBlockIds = listOf("m-2", "m-3"), counterpartyBlockIds = mary.seatIds),
            )
        val proposals = buildSwapProposals(SwapKind.SHIFT, myShift(AssignmentKind.SCHEDULED), legs)
        assertEquals(2, proposals.size)
        assertEquals("u-ben", proposals[0].counterpartyUserId)
        assertEquals(listOf("m-0", "m-1"), proposals[0].initiatorAssignmentIds)
        assertEquals("u-mary", proposals[1].counterpartyUserId)
        assertEquals(listOf("m-2", "m-3"), proposals[1].initiatorAssignmentIds)
    }

    /**
     * The user's edge-case scenario (2026-06-16): Alice splits her 6h shift FOUR ways,
     * concurrently — first 2h ↔ Bob's last 2h, middle 2h ↔ Steve's first 2h, 5th hour ↔
     * Tom (Tue), 6th hour ↔ Tom (Fri). Same person (Tom) on two days = two independent legs.
     * Proves the compose accommodates partial sub-ranges + multiple people + same-person-
     * different-day all at once, as DISJOINT independent proposals.
     */
    @Test fun multi_party_split_handles_partial_subranges_and_same_person_two_days() {
        // Alice: 6h = 12 blocks on one day.
        val alice =
            MyShift(
                id = "alice-0",
                house = harnwell,
                start = at("2026-01-19T12:00:00-05:00"),
                end = at("2026-01-19T18:00:00-05:00"),
                kind = AssignmentKind.SCHEDULED,
                blockIds = (0 until 12).map { "a-$it" },
            )
        val bob = swapCandidates(seats("bob", "2026-01-20T08:00:00-05:00", 10, userId = "u-bob"), excludeUserId = null).single() // 5h
        val steve = swapCandidates(seats("steve", "2026-01-20T08:00:00-05:00", 16, userId = "u-steve"), excludeUserId = null).single() // 8h
        val tomTue = swapCandidates(seats("tomT", "2026-01-20T09:00:00-05:00", 2, userId = "u-tom"), excludeUserId = null).single() // 1h Tue
        val tomFri = swapCandidates(seats("tomF", "2026-01-23T09:00:00-05:00", 2, userId = "u-tom"), excludeUserId = null).single() // 1h Fri

        val legs =
            listOf(
                SwapLeg(bob, alice.blockIds.subList(0, 4), bob.seatIds.subList(6, 10)), // first 2h ↔ Bob last 2h
                SwapLeg(steve, alice.blockIds.subList(4, 8), steve.seatIds.subList(0, 4)), // middle 2h ↔ Steve first 2h
                SwapLeg(tomTue, alice.blockIds.subList(8, 10), tomTue.seatIds), // 5th hour ↔ Tom (Tue)
                SwapLeg(tomFri, alice.blockIds.subList(10, 12), tomFri.seatIds), // 6th hour ↔ Tom (Fri)
            )

        // The four legs are DISJOINT (the §8.1 conflict guard requires it) and cover the shift.
        assertFalse(legsHaveOverlap(legs))
        assertTrue(unallocatedInitiatorBlocks(alice.blockIds, legs).isEmpty())

        val proposals = buildSwapProposals(SwapKind.SHIFT, alice, legs)
        assertEquals(4, proposals.size)
        assertEquals(listOf("a-0", "a-1", "a-2", "a-3"), proposals[0].initiatorAssignmentIds)
        assertEquals(listOf("bob-6", "bob-7", "bob-8", "bob-9"), proposals[0].counterpartyAssignmentIds)
        assertEquals("u-steve", proposals[1].counterpartyUserId)
        assertEquals(listOf("steve-0", "steve-1", "steve-2", "steve-3"), proposals[1].counterpartyAssignmentIds)
        // Same person, two different days → two separate legs touching different blocks.
        assertEquals("u-tom", proposals[2].counterpartyUserId)
        assertEquals("u-tom", proposals[3].counterpartyUserId)
        assertEquals(listOf("a-8", "a-9"), proposals[2].initiatorAssignmentIds)
        assertEquals(listOf("a-10", "a-11"), proposals[3].initiatorAssignmentIds)
        assertTrue(proposals[2].counterpartyAssignmentIds != proposals[3].counterpartyAssignmentIds)
    }

    // ----- segmented timeline (locked zones; tap-to-focus clamp) -----

    private val spanStart = at("2026-01-19T12:00:00-05:00")
    private val spanEnd = at("2026-01-19T20:00:00-05:00") // 8h = 16 blocks

    @Test fun enclosing_free_run_spans_to_the_nearest_locked_block() {
        // 16 blocks; 8..12 locked (4-6pm given away). Free runs: [0,8) and [12,16).
        val reserved = setOf(8, 9, 10, 11)
        assertEquals(BlockRange(0, 8), enclosingFreeRun(16, reserved, index = 3)) // tap in the first run
        assertEquals(BlockRange(12, 16), enclosingFreeRun(16, reserved, index = 14)) // tap in the second run
        assertNull(enclosingFreeRun(16, reserved, index = 9)) // tapping a locked block does nothing
        assertNull(enclosingFreeRun(16, reserved, index = 20)) // out of range
    }

    @Test fun build_swap_segments_surfaces_an_interior_locked_gap_as_free_locked_free() {
        // 8h shift, 4-6pm (blocks 8..12) given to Dan, active selection = the first run's 12-4pm.
        val blockIds = (0 until 16).map { "a-$it" }
        val segs =
            buildSwapSegments(
                blockIds,
                spanStart,
                spanEnd,
                reserved = listOf(ReservedRun(BlockRange(8, 12), "Dan")),
                active = BlockRange(0, 8),
            )
        assertEquals(3, segs.size)
        // free+active run, then the locked gap, then the trailing free run.
        assertTrue(segs[0].active && !segs[0].locked)
        assertEquals(BlockRange(0, 8), BlockRange(segs[0].from, segs[0].to))
        assertTrue(segs[1].locked && !segs[1].active)
        assertEquals("Dan", segs[1].note)
        assertEquals(BlockRange(8, 12), BlockRange(segs[1].from, segs[1].to))
        assertFalse(segs[2].locked || segs[2].active) // trailing FREE run, tap-to-focus
        assertNull(segs[2].note)
        assertEquals(BlockRange(12, 16), BlockRange(segs[2].from, segs[2].to))
    }

    @Test fun build_swap_segments_splits_a_free_run_around_an_interior_active_selection() {
        // No locks; active = the middle 2 blocks → free | active | free.
        val blockIds = (0 until 4).map { "a-$it" }
        val segs = buildSwapSegments(blockIds, spanStart, at("2026-01-19T14:00:00-05:00"), reserved = emptyList(), active = BlockRange(1, 3))
        assertEquals(listOf(false, true, false), segs.map { it.active })
        assertEquals(listOf(BlockRange(0, 1), BlockRange(1, 3), BlockRange(3, 4)), segs.map { BlockRange(it.from, it.to) })
    }
}
