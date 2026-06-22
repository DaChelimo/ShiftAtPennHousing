package com.pennhousing.shift.shared.viewmodel

import androidx.lifecycle.ViewModel
import com.pennhousing.shift.shared.swaps.PendingSwap
import com.pennhousing.shift.shared.swaps.SwapDirection
import com.pennhousing.shift.shared.swaps.SwapProposal
import com.pennhousing.shift.shared.swaps.SwapsFeed
import com.pennhousing.shift.shared.swaps.buildSwapsFeed
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.time.Duration.Companion.days
import kotlin.time.Instant

enum class SwapsTab { ALL, INCOMING, OUTGOING }

data class SwapsUiState(
    val selectedTab: SwapsTab,
    val feed: SwapsFeed,
) {
    val allCount: Int get() = feed.allCount
    val incomingCount: Int get() = feed.incomingCount
    val outgoingCount: Int get() = feed.outgoingCount
}

/**
 * The Swaps-tab ViewModel (DESIGN docs/swaps-enhancement/DESIGN.md §6) — the Incoming /
 * Outgoing review surface. A thin `StateFlow` wrapper over the pure [buildSwapsFeed], fed
 * the worker's enriched [PendingSwap]s (both directions) so every row shows the hours
 * given, the hours received, and the deadline. Synchronous (no `viewModelScope`); `now`
 * is the screen's load instant, injected once.
 *
 * Accept / Decline (incoming) and Cancel (outgoing) are optimistic LOCAL removals — the
 * row leaves its list immediately; the live host fires the `accept-swap` / `reject-swap`
 * / `void-swap` EF best-effort and the next snapshot reconciles. Independent legs: each
 * row resolves on its own, never as a coupled group.
 */
class SwapsViewModel(
    pendingSwaps: List<PendingSwap>,
    private val now: Instant,
    initialTab: SwapsTab = SwapsTab.ALL,
) : ViewModel() {
    private var swaps: List<PendingSwap> = pendingSwaps

    private val _uiState = MutableStateFlow(snapshot(initialTab))
    val uiState: StateFlow<SwapsUiState> = _uiState.asStateFlow()

    private fun snapshot(tab: SwapsTab): SwapsUiState = SwapsUiState(tab, buildSwapsFeed(swaps, now))

    fun selectTab(tab: SwapsTab) {
        _uiState.value = _uiState.value.copy(selectedTab = tab)
    }

    /**
     * Optimistically resolve an INCOMING swap (the worker tapped Accept or Decline): the
     * row leaves the Incoming list. Idempotent — an unknown [swapId] is a no-op.
     */
    fun resolveIncoming(swapId: String) {
        val remaining = swaps.filterNot { it.swapId == swapId && it.direction == SwapDirection.INCOMING }
        if (remaining.size == swaps.size) return
        swaps = remaining
        _uiState.value = snapshot(_uiState.value.selectedTab)
    }

    /**
     * Optimistically cancel (void) an OUTGOING swap leg — the row leaves the Outgoing list.
     * Idempotent — an unknown [swapId] is a no-op.
     */
    fun cancelOutgoing(swapId: String) {
        val remaining = swaps.filterNot { it.swapId == swapId && it.direction == SwapDirection.OUTGOING }
        if (remaining.size == swaps.size) return
        swaps = remaining
        _uiState.value = snapshot(_uiState.value.selectedTab)
    }

    /**
     * Optimistically reflect a just-proposed [proposal] as an OUTGOING leg, so the worker
     * sees it land immediately (the demo's only feedback; the live path refetches to the
     * real, fully-detailed row). The give side comes from the proposal's own shift; the
     * counterparty's time is unknown here, so the "get" side fills in on the live refetch.
     * The synthetic id is deterministic per (counterparty, first block) so a re-add is a no-op.
     */
    fun addOutgoing(proposal: SwapProposal) {
        val syntheticId = "out-${proposal.counterpartyUserId}-${proposal.initiatorAssignmentIds.firstOrNull() ?: ""}"
        if (swaps.any { it.swapId == syntheticId }) return
        swaps =
            swaps +
            PendingSwap(
                swapId = syntheticId,
                swapType = proposal.swapType,
                direction = SwapDirection.OUTGOING,
                otherUserName = "Your housemate",
                createdAt = now,
                expiresAt = now + 1.days,
                initiatorAssignmentIds = proposal.initiatorAssignmentIds,
                counterpartyAssignmentIds = proposal.counterpartyAssignmentIds ?: emptyList(),
                initiatorStart = proposal.initiatorShift.start,
                initiatorEnd = proposal.initiatorShift.end,
                initiatorBlocks = proposal.initiatorAssignmentIds.size,
                counterpartyStart = null,
                counterpartyEnd = null,
                counterpartyBlocks = proposal.counterpartyAssignmentIds?.size ?: 0,
            )
        _uiState.value = snapshot(_uiState.value.selectedTab)
    }
}
