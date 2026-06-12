package com.pennhousing.shift.shared.swaps

import com.pennhousing.shift.shared.house.HouseSeat
import com.pennhousing.shift.shared.model.AssignmentKind
import com.pennhousing.shift.shared.model.House
import com.pennhousing.shift.shared.model.MyShift
import kotlin.test.Test
import kotlin.test.assertEquals
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
}
