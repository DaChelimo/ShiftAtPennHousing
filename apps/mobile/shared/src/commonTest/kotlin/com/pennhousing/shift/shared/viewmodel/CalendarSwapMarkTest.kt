package com.pennhousing.shift.shared.viewmodel

import com.pennhousing.shift.shared.model.AssignmentKind
import com.pennhousing.shift.shared.model.House
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.swaps.PendingSwap
import com.pennhousing.shift.shared.swaps.SwapDirection
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Instant

/**
 * Calendar pending-swap marks — a My-Shifts card whose blocks are in a pending swap is
 * flagged (incoming = actionable popup, outgoing = marker only), and [CalendarViewModel.decisionFor]
 * resolves an incoming card's popup (and refuses an outgoing one).
 */
class CalendarSwapMarkTest {
    private fun at(iso: String): Instant = Instant.parse(iso)

    private val quad = House("quad", "Quad")
    private val now = at("2026-01-15T12:00:00-05:00") // Thursday (index 3)
    private val myShift =
        MyShift(
            id = "sh1",
            house = quad,
            start = at("2026-01-15T14:00:00-05:00"),
            end = at("2026-01-15T16:00:00-05:00"),
            kind = AssignmentKind.SCHEDULED,
            blockIds = listOf("c1", "c2"),
        )

    private fun pending(direction: SwapDirection) =
        PendingSwap(
            swapId = "s1",
            swapType = "shift_swap",
            direction = direction,
            otherUserName = "Ben",
            createdAt = at("2026-01-15T10:00:00-05:00"),
            expiresAt = at("2026-01-15T11:00:00-05:00"),
            // The worker's own side must hold the shift's blocks: initiator side when
            // OUTGOING, counterparty side when INCOMING.
            initiatorAssignmentIds = if (direction == SwapDirection.OUTGOING) listOf("c1", "c2") else listOf("i1", "i2"),
            counterpartyAssignmentIds = if (direction == SwapDirection.INCOMING) listOf("c1", "c2") else listOf("o1", "o2"),
            initiatorStart = at("2026-01-20T09:00:00-05:00"),
            initiatorEnd = at("2026-01-20T11:00:00-05:00"),
            initiatorBlocks = 4,
            counterpartyStart = at("2026-01-15T14:00:00-05:00"),
            counterpartyEnd = at("2026-01-15T16:00:00-05:00"),
            counterpartyBlocks = 4,
        )

    @Test
    fun incoming_swap_flags_the_card_and_opens_a_decision() {
        val vm = CalendarViewModel(listOf(myShift), now, pendingSwaps = listOf(pending(SwapDirection.INCOMING)))
        vm.selectDay(3)
        val item = vm.uiState.value.agenda.items.first { it.shift != null }
        assertNotNull(item.swap)
        assertEquals("s1", item.swap!!.swapId)
        assertTrue(item.swap!!.incoming)
        assertNotNull(vm.decisionFor("s1")) // tapping opens the accept/decline popup
    }

    @Test
    fun outgoing_swap_marks_the_card_but_has_no_decision() {
        val vm = CalendarViewModel(listOf(myShift), now, pendingSwaps = listOf(pending(SwapDirection.OUTGOING)))
        vm.selectDay(3)
        val item = vm.uiState.value.agenda.items.first { it.shift != null }
        assertNotNull(item.swap)
        assertFalse(item.swap!!.incoming) // outgoing = marker only
        assertNull(vm.decisionFor("s1")) // you can't accept your own proposal here
    }

    @Test
    fun outgoing_swap_taps_into_a_pending_notice_not_the_drop_sheet() {
        val vm = CalendarViewModel(listOf(myShift), now, pendingSwaps = listOf(pending(SwapDirection.OUTGOING)))
        vm.selectDay(3)
        val notice = vm.pendingSwapNoticeFor("s1")
        assertNotNull(notice) // tapping an outgoing-swap card opens the "pending" card
        assertEquals("Swap pending", notice.title)
        assertEquals("s1", notice.swapId)
    }

    @Test
    fun incoming_swap_has_no_pending_notice() {
        val vm = CalendarViewModel(listOf(myShift), now, pendingSwaps = listOf(pending(SwapDirection.INCOMING)))
        vm.selectDay(3)
        assertNull(vm.pendingSwapNoticeFor("s1")) // incoming uses the accept/decline popup instead
    }

    @Test
    fun cancelling_an_outgoing_swap_untints_the_card() {
        val vm = CalendarViewModel(listOf(myShift), now, pendingSwaps = listOf(pending(SwapDirection.OUTGOING)))
        vm.selectDay(3)
        assertNotNull(vm.uiState.value.agenda.items.first { it.shift != null }.swap)
        vm.resolveSwap("s1") // "Cancel swap" path → optimistic removal
        assertNull(vm.uiState.value.agenda.items.first { it.shift != null }.swap)
        assertNull(vm.pendingSwapNoticeFor("s1"))
    }

    @Test
    fun no_pending_swap_leaves_the_card_unmarked() {
        val vm = CalendarViewModel(listOf(myShift), now)
        vm.selectDay(3)
        val item = vm.uiState.value.agenda.items.first { it.shift != null }
        assertNull(item.swap)
    }
}
