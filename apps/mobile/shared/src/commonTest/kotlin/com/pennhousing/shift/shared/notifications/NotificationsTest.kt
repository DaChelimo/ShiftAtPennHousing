package com.pennhousing.shift.shared.notifications

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.time.Instant

/**
 * Updates feed presentation (shared) — the Today/Earlier grouping + NY-anchored
 * relative-time labels both front ends render. Fixtures pin explicit America/New_York
 * offsets (EST -05:00). Anchor: now is Thu 2026-01-15 20:00 ET; 2026-01-12 is a Monday.
 */
class NotificationsTest {
    private fun at(iso: String): Instant = Instant.parse(iso)

    private val now = at("2026-01-15T20:00:00-05:00")

    private fun item(
        id: String,
        createdAt: String,
        category: NotificationCategory = NotificationCategory.INFO,
        unread: Boolean = false,
        urgent: Boolean = false,
        floatId: String? = null,
    ) = NotificationItem(
        id = id,
        category = category,
        title = "t-$id",
        body = "b-$id",
        createdAt = at(createdAt),
        unread = unread,
        urgent = urgent,
        floatId = floatId,
    )

    // ----- category mapping (best-effort) -----

    @Test fun category_for_known_types() {
        assertEquals(NotificationCategory.REMINDER, categoryForType("ack_reminder"))
        assertEquals(NotificationCategory.SWAP, categoryForType("swap_request"))
        assertEquals(NotificationCategory.PERMANENT, categoryForType("sw_permanent_removal_alert"))
        assertEquals(NotificationCategory.PERMANENT, categoryForType("sm_permanent_drop_alert"))
    }

    @Test fun generic_and_unknown_types_fall_back_to_info() {
        assertEquals(NotificationCategory.INFO, categoryForType("personal_shift"))
        assertEquals(NotificationCategory.INFO, categoryForType("broadcast"))
        assertEquals(NotificationCategory.INFO, categoryForType("something_new"))
    }

    // ----- relative time -----

    @Test fun time_label_is_clock_time_for_today() = assertEquals("18:36", notificationTimeLabel(at("2026-01-15T18:36:00-05:00"), now))

    @Test fun time_label_is_day_of_week_when_earlier() = assertEquals("Mon", notificationTimeLabel(at("2026-01-12T09:00:00-05:00"), now))

    // ----- feed grouping -----

    @Test fun feed_groups_today_vs_earlier_newest_first() {
        val feed =
            buildUpdatesFeed(
                listOf(
                    item("a", "2026-01-15T18:36:00-05:00"),
                    item("b", "2026-01-15T20:00:00-05:00"),
                    item("c", "2026-01-12T09:00:00-05:00"),
                ),
                now,
            )
        assertEquals(listOf("b", "a"), feed.today.map { it.id }) // newest first
        assertEquals(listOf("c"), feed.earlier.map { it.id })
        assertEquals("18:36", feed.today.first { it.id == "a" }.timeLabel)
        assertEquals("Mon", feed.earlier.first().timeLabel)
        assertFalse(feed.isEmpty)
    }

    @Test fun empty_list_is_empty_feed() {
        val feed = buildUpdatesFeed(emptyList(), now)
        assertTrue(feed.isEmpty)
        assertEquals(0, feed.unreadCount)
    }

    @Test fun unread_count_spans_both_groups() {
        val feed =
            buildUpdatesFeed(
                listOf(
                    item("a", "2026-01-15T18:00:00-05:00", unread = true),
                    item("b", "2026-01-15T19:00:00-05:00", unread = false),
                    item("c", "2026-01-12T09:00:00-05:00", unread = true),
                ),
                now,
            )
        assertEquals(2, feed.unreadCount)
    }

    @Test fun float_item_opens_ack() {
        val r = item(
            "f",
            "2026-01-15T18:00:00-05:00",
            category = NotificationCategory.FLOAT,
            urgent = true,
            floatId = "float-demo",
        ).toRow(now)
        assertTrue(r.opensAck)
        assertTrue(r.urgent)
        assertEquals(NotificationCategory.FLOAT, r.category)
    }

    @Test fun non_float_item_does_not_open_ack() = assertFalse(item("x", "2026-01-15T18:00:00-05:00").toRow(now).opensAck)

    // ----- notificationFromPayload: the live float-linkage mapping (T1-10) -----

    @Test fun float_assigned_payload_maps_to_urgent_openable_float() {
        val n =
            notificationFromPayload(
                id = "n1",
                rawType = "personal_shift",
                payloadKind = "float_assigned",
                floatId = "float-7",
                title = null,
                body = null,
                createdAt = at("2026-01-15T18:00:00-05:00"),
                unread = true,
            )
        assertEquals(NotificationCategory.FLOAT, n.category)
        assertTrue(n.urgent)
        assertEquals("float-7", n.floatId)
        assertTrue(n.toRow(now).opensAck) // the row carries the pending_float_notification selector
    }

    @Test fun float_assigned_without_float_id_is_not_openable() {
        val n =
            notificationFromPayload(
                id = "n2",
                rawType = "personal_shift",
                payloadKind = "float_assigned",
                floatId = null,
                title = null,
                body = null,
                createdAt = at("2026-01-15T18:00:00-05:00"),
                unread = true,
            )
        assertEquals(NotificationCategory.FLOAT, n.category)
        assertFalse(n.urgent)
        assertEquals(null, n.floatId)
        assertFalse(n.toRow(now).opensAck)
    }

    @Test fun non_float_payload_defers_to_category_for_type_and_never_opens_ack() {
        val n =
            notificationFromPayload(
                id = "n3",
                rawType = "ack_reminder",
                payloadKind = null,
                floatId = null,
                title = "Reminder",
                body = "Ack your float",
                createdAt = at("2026-01-15T18:00:00-05:00"),
                unread = false,
            )
        assertEquals(NotificationCategory.REMINDER, n.category)
        assertFalse(n.urgent)
        assertFalse(n.toRow(now).opensAck)
    }

    // ----- withPendingFloatEntry: live-pending-float reachability (T1-10) -----

    @Test fun pending_float_entry_is_synthesized_when_no_row_references_it() {
        val merged =
            withPendingFloatEntry(
                items = listOf(item("a", "2026-01-15T18:00:00-05:00")),
                pendingFloatId = "float-9",
                pendingFloatStart = at("2026-01-15T19:30:00-05:00"),
                destinationHouseName = "Harnwell",
            )
        val synth = merged.single { it.floatId == "float-9" }
        assertEquals(NotificationCategory.FLOAT, synth.category)
        assertTrue(synth.urgent)
        assertTrue(synth.toRow(now).opensAck)
        assertTrue(buildUpdatesFeed(merged, now).today.any { it.opensAck })
    }

    @Test fun pending_float_entry_is_not_duplicated_when_a_row_already_links_it() {
        val existing =
            item(
                "n",
                "2026-01-15T18:00:00-05:00",
                category = NotificationCategory.FLOAT,
                urgent = true,
                floatId = "float-9",
            )
        val merged =
            withPendingFloatEntry(
                items = listOf(existing),
                pendingFloatId = "float-9",
                pendingFloatStart = at("2026-01-15T19:30:00-05:00"),
            )
        assertEquals(1, merged.count { it.floatId == "float-9" })
        assertEquals(1, merged.size)
    }

    @Test fun null_pending_float_leaves_items_unchanged() {
        val items = listOf(item("a", "2026-01-15T18:00:00-05:00"))
        assertEquals(items, withPendingFloatEntry(items, pendingFloatId = null, pendingFloatStart = null))
    }

    // ----- incoming swap entries (§8.2, T3a minimal slice) -----

    private fun swap(
        swapId: String,
        swapType: String,
    ) = IncomingSwap(
        swapId = swapId,
        swapType = swapType,
        createdAt = at("2026-01-15T18:30:00-05:00"),
        expiresAt = at("2026-01-16T18:30:00-05:00"),
    )

    @Test fun incoming_temporary_swap_synthesizes_an_urgent_acceptable_entry() {
        val merged = withIncomingSwapEntries(emptyList(), listOf(swap("s-1", "shift_swap")))
        val entry = merged.single()
        assertEquals(NotificationCategory.SWAP, entry.category)
        assertEquals("s-1", entry.swapId)
        assertTrue(entry.swapAcceptable)
        assertTrue(entry.urgent)
        assertTrue(entry.unread)
        assertEquals("Swap request — Shift swap", entry.title)
        // a float swap is also a plain {swap_id} acceptance
        assertTrue(withIncomingSwapEntries(emptyList(), listOf(swap("s-2", "float_swap"))).single().swapAcceptable)
    }

    @Test fun incoming_permanent_swap_offers_decline_only() {
        // §8.4: a permanent acceptance must enumerate affected assignments — not
        // computed by this slice, so Accept is withheld (Decline remains).
        val entry = withIncomingSwapEntries(emptyList(), listOf(swap("s-3", "permanent_swap"))).single()
        assertEquals("s-3", entry.swapId)
        assertFalse(entry.swapAcceptable)
        assertTrue(entry.urgent)
    }

    @Test fun incoming_swap_entry_is_not_duplicated_when_already_represented() {
        val existing = item("n-s", "2026-01-15T18:00:00-05:00", category = NotificationCategory.SWAP).copy(swapId = "s-1")
        val merged = withIncomingSwapEntries(listOf(existing), listOf(swap("s-1", "shift_swap")))
        assertEquals(1, merged.size)
        assertEquals(1, merged.count { it.swapId == "s-1" })
    }

    @Test fun swap_row_carries_the_action_fields() {
        val entry = withIncomingSwapEntries(emptyList(), listOf(swap("s-1", "shift_swap"))).single()
        val row = entry.toRow(now)
        assertEquals("s-1", row.swapId)
        assertTrue(row.swapAcceptable)
        assertFalse(row.opensAck) // a swap entry never opens the float ack hero
    }
}
