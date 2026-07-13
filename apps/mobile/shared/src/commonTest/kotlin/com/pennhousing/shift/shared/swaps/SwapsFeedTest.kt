package com.pennhousing.shift.shared.swaps

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Instant

/**
 * Swaps tab feed (DESIGN docs/swaps-enhancement/DESIGN.md §6) — the Incoming / Outgoing
 * lists, deadline ordering + countdown, the give/get hour computation (direction-aware),
 * one-sided hand-off handling, and the cosmetic co-created grouping. Anchor: now Thu
 * 2026-01-15 12:00 ET.
 */
class SwapsFeedTest {
    private fun at(iso: String): Instant = Instant.parse(iso)

    private val now = at("2026-01-15T12:00:00-05:00")

    private fun swap(
        id: String,
        direction: SwapDirection,
        type: String = "shift_swap",
        created: String = "2026-01-15T11:00:00-05:00",
        expires: String = "2026-01-15T20:00:00-05:00",
        iniStart: String? = "2026-01-16T09:00:00-05:00",
        iniEnd: String? = "2026-01-16T13:00:00-05:00",
        iniBlocks: Int = 8,
        cpStart: String? = "2026-01-17T14:00:00-05:00",
        cpEnd: String? = "2026-01-17T18:00:00-05:00",
        cpBlocks: Int = 8,
        iniHouse: String? = null,
        cpHouse: String? = null,
    ) = PendingSwap(
        swapId = id,
        swapType = type,
        direction = direction,
        otherUserName = "Ben",
        createdAt = at(created),
        expiresAt = at(expires),
        initiatorAssignmentIds = listOf("$id-i"),
        counterpartyAssignmentIds = listOf("$id-c"),
        initiatorStart = iniStart?.let { at(it) },
        initiatorEnd = iniEnd?.let { at(it) },
        initiatorBlocks = iniBlocks,
        initiatorHouseName = iniHouse,
        counterpartyStart = cpStart?.let { at(it) },
        counterpartyEnd = cpEnd?.let { at(it) },
        counterpartyBlocks = cpBlocks,
        counterpartyHouseName = cpHouse,
    )

    @Test fun incoming_is_sorted_soonest_deadline_first() {
        val feed =
            buildSwapsFeed(
                listOf(
                    swap("late", SwapDirection.INCOMING, expires = "2026-01-15T20:00:00-05:00"),
                    swap("soon", SwapDirection.INCOMING, expires = "2026-01-15T14:00:00-05:00"),
                ),
                now,
            )
        assertEquals(listOf("soon", "late"), feed.incoming.map { it.swapId })
    }

    @Test fun every_incoming_type_is_acceptable_and_shows_give_and_get_hours() {
        val feed =
            buildSwapsFeed(
                listOf(
                    swap("t", SwapDirection.INCOMING, type = "shift_swap"),
                    swap("p", SwapDirection.INCOMING, type = "permanent_swap", expires = "2026-01-20T15:00:00-05:00"),
                ),
                now,
            )
        assertTrue(feed.incoming.all { it.acceptable })
        val t = feed.incoming.single { it.swapId == "t" }
        // INCOMING: you give YOUR shift (counterparty span = 4h), you get THEIRS (initiator span = 4h).
        assertEquals("4h", t.give?.hours)
        assertEquals("4h", t.get?.hours)
        // Time slot is the hero — present + computed for both sides.
        assertEquals("14:00 - 18:00", t.give?.timeRange) // counterparty span (mine)
        assertEquals("09:00 - 13:00", t.get?.timeRange) // initiator span (theirs)
        assertNotNull(t.give?.dayLabel)
        assertEquals("Needs your response", t.directionLabel)
        assertEquals("Permanent swap", feed.incoming.single { it.swapId == "p" }.typeLabel)
    }

    @Test fun each_side_carries_the_house_it_is_worked_at_direction_aware() {
        // Their shift is floated to Quad; mine sits at Harnwell. INCOMING: get = theirs (Quad),
        // give = mine (Harnwell). The acceptor sees the float destination, not the home house.
        val feed =
            buildSwapsFeed(
                listOf(swap("h", SwapDirection.INCOMING, iniHouse = "Quad", cpHouse = "Harnwell")),
                now,
            )
        val row = feed.incoming.single()
        assertEquals("Quad", row.get?.houseName)
        assertEquals("Harnwell", row.give?.houseName)
    }

    @Test fun outgoing_give_get_is_flipped_relative_to_incoming() {
        // OUTGOING: you give YOUR shift (initiator span), you get the counterparty's.
        val feed = buildSwapsFeed(listOf(swap("o", SwapDirection.OUTGOING)), now)
        val row = feed.outgoing.single()
        assertFalse(row.acceptable)
        assertEquals("4h", row.give?.hours) // initiator span (mine)
        assertEquals("4h", row.get?.hours) // counterparty span (theirs)
        assertEquals("Waiting on Ben", row.directionLabel)
    }

    @Test fun handoff_to_me_gives_nothing_back() {
        // INCOMING hand-off, I receive: counterparty span empty → I give nothing.
        val feed =
            buildSwapsFeed(
                listOf(swap("h", SwapDirection.INCOMING, type = "handoff", cpStart = null, cpEnd = null, cpBlocks = 0)),
                now,
            )
        val row = feed.incoming.single()
        assertNull(row.give) // nothing back
        assertEquals("4h", row.get?.hours) // I receive their shift
        assertEquals("Hand-off", row.typeLabel)
    }

    @Test fun deadline_is_a_humanized_countdown() {
        val feed = buildSwapsFeed(listOf(swap("x", SwapDirection.INCOMING, expires = "2026-01-15T17:00:00-05:00")), now)
        val row = feed.incoming.single()
        assertEquals("Expires in 5h", row.deadline)
        assertTrue(row.deadlineUrgent) // 5h < 6h threshold
    }

    @Test fun expired_swaps_say_expired_and_are_not_urgent() {
        val feed = buildSwapsFeed(listOf(swap("x", SwapDirection.INCOMING, expires = "2026-01-15T11:00:00-05:00")), now)
        val row = feed.incoming.single()
        assertEquals("Expired", row.deadline)
        assertFalse(row.deadlineUrgent)
    }

    @Test fun co_created_outgoing_legs_share_a_group_and_singletons_do_not() {
        val feed =
            buildSwapsFeed(
                listOf(
                    swap("a", SwapDirection.OUTGOING, created = "2026-01-15T11:30:00-05:00", expires = "2026-01-16T11:30:00-05:00"),
                    swap("b", SwapDirection.OUTGOING, created = "2026-01-15T11:30:00-05:00", expires = "2026-01-16T11:30:00-05:00"),
                    swap("solo", SwapDirection.OUTGOING, type = "float_swap", created = "2026-01-15T09:00:00-05:00", expires = "2026-01-16T09:00:00-05:00"),
                ),
                now,
            )
        val grouped = feed.outgoing.filter { it.swapId == "a" || it.swapId == "b" }
        assertEquals(2, grouped.size)
        assertEquals(1, grouped.map { it.groupId }.toSet().size)
        assertTrue(grouped.all { it.groupId != null && it.groupSize == 2 })
        val solo = feed.outgoing.single { it.swapId == "solo" }
        assertNull(solo.groupId)
        assertEquals(1, solo.groupSize)
    }

    @Test fun all_merges_both_directions_soonest_deadline_first() {
        val feed =
            buildSwapsFeed(
                listOf(
                    swap("in-late", SwapDirection.INCOMING, expires = "2026-01-15T22:00:00-05:00"),
                    swap("out-soon", SwapDirection.OUTGOING, expires = "2026-01-15T14:00:00-05:00"),
                ),
                now,
            )
        assertEquals(2, feed.allCount)
        assertEquals(listOf("out-soon", "in-late"), feed.all.map { it.swapId })
        assertFalse(feed.all.single { it.swapId == "out-soon" }.incoming)
        assertTrue(feed.all.single { it.swapId == "in-late" }.incoming)
    }

    @Test fun empty_feed_is_empty() {
        val feed = buildSwapsFeed(emptyList(), now)
        assertTrue(feed.isEmpty)
        assertEquals(0, feed.allCount)
    }
}
