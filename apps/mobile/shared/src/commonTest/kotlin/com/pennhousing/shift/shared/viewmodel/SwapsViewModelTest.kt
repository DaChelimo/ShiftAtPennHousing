package com.pennhousing.shift.shared.viewmodel

import com.pennhousing.shift.shared.swaps.PendingSwap
import com.pennhousing.shift.shared.swaps.SwapDirection
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.time.Instant

/**
 * SwapsViewModel (DESIGN docs/swaps-enhancement/DESIGN.md §6) — the Incoming/Outgoing
 * tab state and the optimistic accept/decline (incoming) + cancel (outgoing) removals.
 * Independent legs: resolving one row never touches another. Anchor: now 2026-01-15 12:00 ET.
 */
class SwapsViewModelTest {
    private fun at(iso: String): Instant = Instant.parse(iso)

    private val now = at("2026-01-15T12:00:00-05:00")

    private fun swap(
        id: String,
        direction: SwapDirection,
    ) = PendingSwap(
        swapId = id,
        swapType = "shift_swap",
        direction = direction,
        otherUserName = "Ben",
        createdAt = at("2026-01-15T11:00:00-05:00"),
        expiresAt = at("2026-01-15T20:00:00-05:00"),
        initiatorAssignmentIds = listOf("$id-i"),
        counterpartyAssignmentIds = listOf("$id-c"),
        initiatorStart = at("2026-01-16T09:00:00-05:00"),
        initiatorEnd = at("2026-01-16T13:00:00-05:00"),
        initiatorBlocks = 8,
        counterpartyStart = at("2026-01-17T14:00:00-05:00"),
        counterpartyEnd = at("2026-01-17T18:00:00-05:00"),
        counterpartyBlocks = 8,
    )

    private fun vm(
        pending: List<PendingSwap> =
            listOf(
                swap("in-1", SwapDirection.INCOMING),
                swap("in-2", SwapDirection.INCOMING),
                swap("out-1", SwapDirection.OUTGOING),
            ),
    ) = SwapsViewModel(pending, now)

    @Test fun initial_state_defaults_to_all_with_counts() {
        val vm = vm()
        assertEquals(SwapsTab.ALL, vm.uiState.value.selectedTab)
        assertEquals(3, vm.uiState.value.allCount) // 2 incoming + 1 outgoing, merged
        assertEquals(2, vm.uiState.value.incomingCount)
        assertEquals(1, vm.uiState.value.outgoingCount)
    }

    @Test fun select_tab_moves_selection_without_changing_data() {
        val vm = vm()
        vm.selectTab(SwapsTab.OUTGOING)
        assertEquals(SwapsTab.OUTGOING, vm.uiState.value.selectedTab)
        assertEquals(2, vm.uiState.value.incomingCount)
    }

    @Test fun resolve_incoming_removes_only_that_row() {
        val vm = vm()
        vm.resolveIncoming("in-1")
        assertEquals(listOf("in-2"), vm.uiState.value.feed.incoming.map { it.swapId })
        assertEquals(1, vm.uiState.value.outgoingCount) // outgoing untouched
    }

    @Test fun cancel_outgoing_removes_only_that_leg() {
        val vm =
            vm(
                listOf(
                    swap("in-1", SwapDirection.INCOMING),
                    swap("in-2", SwapDirection.INCOMING),
                    swap("out-1", SwapDirection.OUTGOING),
                    swap("out-2", SwapDirection.OUTGOING),
                ),
            )
        vm.cancelOutgoing("out-1")
        assertEquals(listOf("out-2"), vm.uiState.value.feed.outgoing.map { it.swapId })
        assertEquals(2, vm.uiState.value.incomingCount) // incoming untouched
    }

    @Test fun resolve_and_cancel_are_idempotent_for_unknown_ids() {
        val vm = vm()
        val before = vm.uiState.value
        vm.resolveIncoming("nope")
        vm.cancelOutgoing("nope")
        assertEquals(before, vm.uiState.value)
        assertTrue(vm.uiState.value.incomingCount == 2)
    }
}
