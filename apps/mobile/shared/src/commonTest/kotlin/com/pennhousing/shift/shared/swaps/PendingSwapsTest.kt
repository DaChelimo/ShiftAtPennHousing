package com.pennhousing.shift.shared.swaps

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Instant

/**
 * Pending-swap presentation — the worker's own side resolution ([PendingSwap.myAssignmentIds])
 * and the incoming-swap accept/decline popup ([buildSwapDecision]): both swap halves for a
 * symmetric swap, one half for a one-sided hand-off, and the permanent note. NY-anchored.
 */
class PendingSwapsTest {
    private fun at(iso: String): Instant = Instant.parse(iso)

    private fun swap(
        type: String,
        direction: SwapDirection,
        iniIds: List<String>,
        cpIds: List<String>,
        iniStart: String? = null,
        iniEnd: String? = null,
        iniBlocks: Int = 0,
        cpStart: String? = null,
        cpEnd: String? = null,
        cpBlocks: Int = 0,
        iniHouse: String? = null,
        cpHouse: String? = null,
    ) = PendingSwap(
        swapId = "s1",
        swapType = type,
        direction = direction,
        otherUserName = "Ben",
        createdAt = at("2026-01-15T12:00:00-05:00"),
        expiresAt = at("2026-01-19T18:30:00-05:00"),
        initiatorAssignmentIds = iniIds,
        counterpartyAssignmentIds = cpIds,
        initiatorStart = iniStart?.let { at(it) },
        initiatorEnd = iniEnd?.let { at(it) },
        initiatorBlocks = iniBlocks,
        initiatorHouseName = iniHouse,
        counterpartyStart = cpStart?.let { at(it) },
        counterpartyEnd = cpEnd?.let { at(it) },
        counterpartyBlocks = cpBlocks,
        counterpartyHouseName = cpHouse,
    )

    @Test
    fun my_assignment_ids_follow_direction() {
        val out = swap("shift_swap", SwapDirection.OUTGOING, iniIds = listOf("i1"), cpIds = listOf("c1"))
        val inc = swap("shift_swap", SwapDirection.INCOMING, iniIds = listOf("i1"), cpIds = listOf("c1"))
        assertEquals(listOf("i1"), out.myAssignmentIds) // I'm the initiator
        assertEquals(listOf("c1"), inc.myAssignmentIds) // I'm the counterparty
    }

    @Test
    fun shift_swap_decision_shows_both_give_and_get_hours() {
        val d =
            buildSwapDecision(
                swap(
                    "shift_swap", SwapDirection.INCOMING,
                    iniIds = listOf("i1", "i2"), cpIds = listOf("c1", "c2"),
                    iniStart = "2026-01-20T09:00:00-05:00", iniEnd = "2026-01-20T13:00:00-05:00", iniBlocks = 8,
                    cpStart = "2026-01-17T14:00:00-05:00", cpEnd = "2026-01-17T18:00:00-05:00", cpBlocks = 8,
                ),
            )
        assertEquals("Swap request", d.title)
        assertEquals("Shift swap", d.typeLabel)
        assertTrue(d.intro.contains("Ben"))
        assertNotNull(d.giveLabel) // my shift (counterparty side)
        assertNotNull(d.getLabel) // their shift (initiator side)
        assertTrue(d.getLabel!!.contains("4h"))
        assertTrue(d.giveLabel!!.contains("4h"))
        assertFalse(d.permanent)
        assertTrue(d.respondBy.contains("18:30"))
    }

    @Test
    fun decision_surfaces_the_house_each_side_is_worked_at_including_a_float_destination() {
        // The proposer's shift was floated to Quad; the worker's own is at home (Harnwell).
        // Accepting must not silently relocate the worker, so each side carries its real desk.
        val d =
            buildSwapDecision(
                swap(
                    "shift_swap", SwapDirection.INCOMING,
                    iniIds = listOf("i1"), cpIds = listOf("c1"),
                    iniStart = "2026-01-20T09:00:00-05:00", iniEnd = "2026-01-20T13:00:00-05:00", iniBlocks = 8,
                    cpStart = "2026-01-17T14:00:00-05:00", cpEnd = "2026-01-17T18:00:00-05:00", cpBlocks = 8,
                    iniHouse = "Quad", cpHouse = "Harnwell",
                ),
            )
        assertEquals("Quad", d.getHouse) // where you'd actually work — the float destination
        assertEquals("Harnwell", d.giveHouse) // the desk you'd give up
    }

    @Test
    fun decision_house_is_null_on_an_empty_side() {
        // A hand-off TO me: I give nothing, so giveHouse stays null even if a name leaks through.
        val d =
            buildSwapDecision(
                swap(
                    "handoff", SwapDirection.INCOMING,
                    iniIds = listOf("i1"), cpIds = emptyList(),
                    iniStart = "2026-01-20T09:00:00-05:00", iniEnd = "2026-01-20T13:00:00-05:00", iniBlocks = 8,
                    iniHouse = "Quad", cpHouse = "Harnwell",
                ),
            )
        assertEquals("Quad", d.getHouse)
        assertNull(d.giveHouse) // counterpartyBlocks == 0 → no give side, no house
    }

    @Test
    fun handoff_to_me_shows_only_what_i_get_and_a_nothing_back_note() {
        val d =
            buildSwapDecision(
                swap(
                    "handoff", SwapDirection.INCOMING,
                    iniIds = listOf("i1", "i2"), cpIds = emptyList(),
                    iniStart = "2026-01-20T09:00:00-05:00", iniEnd = "2026-01-20T13:00:00-05:00", iniBlocks = 8,
                ),
            )
        assertEquals("Hand-off request", d.title)
        assertNull(d.giveLabel) // I give nothing
        assertNotNull(d.getLabel) // I receive their shift
        assertEquals("They give nothing in return.", d.note)
    }

    @Test
    fun handoff_from_me_shows_only_what_i_give() {
        val d =
            buildSwapDecision(
                swap(
                    "handoff", SwapDirection.INCOMING,
                    iniIds = emptyList(), cpIds = listOf("c1", "c2"),
                    cpStart = "2026-01-17T14:00:00-05:00", cpEnd = "2026-01-17T18:00:00-05:00", cpBlocks = 8,
                ),
            )
        assertEquals("Hand-off request", d.title)
        assertNotNull(d.giveLabel) // they take my shift
        assertNull(d.getLabel) // I get nothing
    }

    @Test
    fun permanent_swap_decision_is_flagged_with_a_term_note() {
        val d =
            buildSwapDecision(
                swap(
                    "permanent_swap", SwapDirection.INCOMING,
                    iniIds = listOf("i1"), cpIds = listOf("c1"),
                    iniStart = "2026-01-20T09:00:00-05:00", iniEnd = "2026-01-20T11:00:00-05:00", iniBlocks = 4,
                    cpStart = "2026-01-17T14:00:00-05:00", cpEnd = "2026-01-17T16:00:00-05:00", cpBlocks = 4,
                ),
            )
        assertTrue(d.permanent)
        assertEquals("Permanent swap", d.typeLabel)
        assertNotNull(d.note)
    }

    // ── Outgoing "swap pending" notice (buildPendingSwapNotice) — the tap target that
    // replaces the drop sheet, since the shift is tied up in a swap the worker proposed. ──

    @Test
    fun pending_notice_shows_the_offered_shift_and_cancel_keep_waiting() {
        val n =
            buildPendingSwapNotice(
                swap(
                    "shift_swap", SwapDirection.OUTGOING,
                    iniIds = listOf("i1", "i2"), cpIds = listOf("c1", "c2"),
                    iniStart = "2026-01-17T14:00:00-05:00", iniEnd = "2026-01-17T18:00:00-05:00", iniBlocks = 8,
                ),
            )
        assertEquals("Swap pending", n.title)
        assertEquals("Shift swap", n.typeLabel)
        // The shift itself — day + date, start–end time, duration — shown clearly.
        assertEquals("Sat · Jan 17", n.dayLabel)
        assertEquals("14:00 – 18:00", n.timeLabel)
        assertEquals("4h", n.durationLabel)
        // The explanation says why it can't be dropped/swapped, and names the other party.
        assertTrue(n.body.contains("Ben"))
        assertTrue(n.body.contains("can't be dropped or swapped"))
        assertTrue(n.waitingOn.contains("18:30")) // the deadline
        assertEquals("Cancel swap", n.cancelLabel)
        assertEquals("Keep waiting", n.keepWaitingLabel)
    }

    @Test
    fun pending_notice_shows_the_house_the_offered_shift_is_worked_at() {
        val n =
            buildPendingSwapNotice(
                swap(
                    "shift_swap", SwapDirection.OUTGOING,
                    iniIds = listOf("i1"), cpIds = listOf("c1"),
                    iniStart = "2026-01-17T14:00:00-05:00", iniEnd = "2026-01-17T18:00:00-05:00", iniBlocks = 8,
                    iniHouse = "DuBois",
                ),
            )
        assertEquals("DuBois", n.houseName) // the worker's own (initiator) side desk
    }

    @Test
    fun pending_notice_reads_handoff_when_one_sided() {
        val n =
            buildPendingSwapNotice(
                swap(
                    "handoff", SwapDirection.OUTGOING,
                    iniIds = listOf("i1", "i2"), cpIds = emptyList(),
                    iniStart = "2026-01-20T09:00:00-05:00", iniEnd = "2026-01-20T13:00:00-05:00", iniBlocks = 8,
                ),
            )
        assertEquals("Hand-off pending", n.title)
        assertEquals("Cancel hand-off", n.cancelLabel)
        assertTrue(n.body.contains("hand this shift off"))
    }

    @Test
    fun pending_notice_for_permanent_swap_mentions_the_term() {
        val n =
            buildPendingSwapNotice(
                swap(
                    "permanent_swap", SwapDirection.OUTGOING,
                    iniIds = listOf("i1"), cpIds = listOf("c1"),
                    iniStart = "2026-01-20T09:00:00-05:00", iniEnd = "2026-01-20T11:00:00-05:00", iniBlocks = 4,
                ),
            )
        assertEquals("Permanent swap", n.typeLabel)
        assertTrue(n.body.contains("rest of the term"))
    }
}
