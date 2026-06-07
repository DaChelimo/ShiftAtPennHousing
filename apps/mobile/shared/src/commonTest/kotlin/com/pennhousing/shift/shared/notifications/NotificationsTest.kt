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
}
