package com.pennhousing.shift.shared.swaps

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.days
import kotlin.time.Duration.Companion.hours
import kotlin.time.Instant

/**
 * The My-Shifts swap banner (BSpec §10.1, 2026-07-28).
 *
 * The bug being pinned: a pending swap was visible ONLY as a tint on the affected shift
 * card, so an incoming request sitting on next Saturday was invisible to a worker who
 * opened the app and looked at this week, and an outgoing one had no home-screen
 * representation at all. Both directions now surface, unconditionally, at the top.
 */
class SwapBannerTest {
    private val now = Instant.parse("2026-07-28T12:00:00-04:00")

    private fun swap(
        id: String,
        direction: SwapDirection,
        expiresIn: kotlin.time.Duration = 1.days,
        other: String = "Ben",
        type: String = "shift_swap",
    ): PendingSwap =
        PendingSwap(
            swapId = id,
            swapType = type,
            direction = direction,
            otherUserName = other,
            createdAt = now,
            expiresAt = now + expiresIn,
            initiatorAssignmentIds = listOf("i1"),
            counterpartyAssignmentIds = listOf("c1"),
            initiatorStart = now,
            initiatorEnd = now + 4.hours,
            initiatorBlocks = 8,
            counterpartyStart = now,
            counterpartyEnd = now + 4.hours,
            counterpartyBlocks = 8,
        )

    @Test fun no_pending_swaps_shows_no_banner() {
        assertTrue(buildSwapBanner(emptyList(), now).isEmpty)
    }

    @Test fun an_incoming_swap_says_swap_is_awaiting_your_approval() {
        val entry = buildSwapBanner(listOf(swap("s1", SwapDirection.INCOMING)), now).entries.single()
        assertEquals(SwapBannerTone.AWAITING_YOU, entry.tone)
        assertEquals("Swap awaiting your approval", entry.title)
        assertTrue(entry.detail.contains("Ben"), entry.detail)
        assertTrue(entry.detail.contains("Respond by"), entry.detail)
        assertEquals("Review", entry.actionLabel)
    }

    @Test fun an_outgoing_swap_says_swap_pending() {
        // The state the pilot report says was missing entirely: "swap pending the other
        // person to accept" had nowhere to appear on the home screen.
        val entry = buildSwapBanner(listOf(swap("s1", SwapDirection.OUTGOING)), now).entries.single()
        assertEquals(SwapBannerTone.AWAITING_THEM, entry.tone)
        assertEquals("Swap pending", entry.title)
        assertTrue(entry.detail.contains("Ben"), entry.detail)
        assertTrue(entry.detail.contains("Expires"), entry.detail)
        assertEquals("View", entry.actionLabel)
    }

    @Test fun incoming_ranks_above_outgoing_even_when_it_expires_later() {
        val banner =
            buildSwapBanner(
                listOf(
                    swap("out", SwapDirection.OUTGOING, expiresIn = 1.hours),
                    swap("in", SwapDirection.INCOMING, expiresIn = 2.days),
                ),
                now,
            )
        // What needs an answer from THIS worker comes first; the other row is information.
        assertEquals(listOf("in", "out"), banner.entries.map { it.swapId })
    }

    @Test fun several_incoming_swaps_order_by_soonest_deadline() {
        val banner =
            buildSwapBanner(
                listOf(
                    swap("later", SwapDirection.INCOMING, expiresIn = 2.days),
                    swap("sooner", SwapDirection.INCOMING, expiresIn = 3.hours),
                ),
                now,
            )
        assertEquals(listOf("sooner", "later"), banner.entries.map { it.swapId })
    }

    @Test fun the_awaiting_you_count_drives_the_badge() {
        val banner =
            buildSwapBanner(
                listOf(
                    swap("a", SwapDirection.INCOMING),
                    swap("b", SwapDirection.INCOMING),
                    swap("c", SwapDirection.OUTGOING),
                ),
                now,
            )
        assertEquals(2, banner.awaitingYouCount)
        assertEquals(3, banner.entries.size)
    }

    @Test fun a_lapsed_swap_says_it_ran_out_of_time_rather_than_showing_a_past_deadline() {
        // The expiry sweep runs behind the worker's clock, so a still-pending row can be
        // past its deadline. Showing "Respond by yesterday" reads as a live request.
        val incoming = buildSwapBanner(listOf(swap("s", SwapDirection.INCOMING, expiresIn = -(1.hours))), now)
        assertTrue(incoming.entries.single().detail.contains("run out of time"))
        val outgoing = buildSwapBanner(listOf(swap("s", SwapDirection.OUTGOING, expiresIn = -(1.hours))), now)
        assertTrue(outgoing.entries.single().detail.contains("stays yours"))
    }

    @Test fun a_hand_off_reads_as_a_hand_off_not_a_swap() {
        val entry =
            buildSwapBanner(listOf(swap("s", SwapDirection.INCOMING, type = "handoff")), now).entries.single()
        assertTrue(entry.detail.contains("hand-off"), entry.detail)
        assertFalse(entry.detail.contains(" swap "), entry.detail)
    }

    @Test fun banner_copy_never_contains_an_em_or_en_dash() {
        val banner =
            buildSwapBanner(
                listOf(swap("a", SwapDirection.INCOMING), swap("b", SwapDirection.OUTGOING)),
                now,
            )
        banner.entries.forEach {
            listOf(it.title, it.detail, it.actionLabel).forEach { copy ->
                assertFalse(copy.contains('—'), "em dash in: $copy")
                assertFalse(copy.contains('–'), "en dash in: $copy")
            }
        }
    }
}
