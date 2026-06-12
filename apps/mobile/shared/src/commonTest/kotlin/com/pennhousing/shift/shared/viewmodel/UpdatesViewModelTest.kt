package com.pennhousing.shift.shared.viewmodel

import com.pennhousing.shift.shared.notifications.NotificationCategory
import com.pennhousing.shift.shared.notifications.NotificationItem
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.time.Instant

/**
 * UpdatesViewModel mark-all-read (T2-8) — the optimistic local clear the demo path uses
 * and the live host fires the `mark_notification_read` RPC behind. The grouping itself is
 * tested in `NotificationsTest`; here we pin the unread→read transition + idempotency.
 * Anchor: now is Thu 2026-01-15 20:00 ET; one earlier (Mon) item exercises both groups.
 */
class UpdatesViewModelTest {
    private fun at(iso: String): Instant = Instant.parse(iso)

    private val now = at("2026-01-15T20:00:00-05:00")

    private fun item(
        id: String,
        createdAt: String,
        unread: Boolean,
    ) = NotificationItem(
        id = id,
        category = NotificationCategory.INFO,
        title = "t-$id",
        body = "b-$id",
        createdAt = at(createdAt),
        unread = unread,
    )

    private fun vm(items: List<NotificationItem>) = UpdatesViewModel(items, now)

    @Test fun initial_state_reports_unread_count_across_both_groups() {
        val vm =
            vm(
                listOf(
                    item("a", "2026-01-15T18:00:00-05:00", unread = true),
                    item("b", "2026-01-15T19:00:00-05:00", unread = false),
                    item("c", "2026-01-12T09:00:00-05:00", unread = true), // earlier (Mon)
                ),
            )
        assertEquals(2, vm.uiState.value.unreadCount)
        assertTrue(vm.uiState.value.hasUnread)
        assertEquals(setOf("a", "c"), vm.unreadIds().toSet())
    }

    @Test fun mark_all_read_flips_unread_count_to_zero_and_returns_unread_ids() {
        val vm =
            vm(
                listOf(
                    item("a", "2026-01-15T18:00:00-05:00", unread = true),
                    item("b", "2026-01-15T19:00:00-05:00", unread = false),
                    item("c", "2026-01-12T09:00:00-05:00", unread = true),
                ),
            )
        val marked = vm.markAllRead()
        assertEquals(setOf("a", "c"), marked.toSet()) // only the formerly-unread ids
        assertEquals(0, vm.uiState.value.unreadCount)
        assertFalse(vm.uiState.value.hasUnread)
        assertTrue(vm.unreadIds().isEmpty())
    }

    @Test fun mark_all_read_preserves_grouping_and_rows_just_clears_dots() {
        val vm =
            vm(
                listOf(
                    item("a", "2026-01-15T18:00:00-05:00", unread = true),
                    item("c", "2026-01-12T09:00:00-05:00", unread = true),
                ),
            )
        vm.markAllRead()
        val feed = vm.uiState.value.feed
        // Same partition (today/earlier) and ids — only the unread flags changed.
        assertEquals(listOf("a"), feed.today.map { it.id })
        assertEquals(listOf("c"), feed.earlier.map { it.id })
        assertTrue(feed.today.none { it.unread })
        assertTrue(feed.earlier.none { it.unread })
    }

    @Test fun mark_all_read_is_idempotent_when_nothing_is_unread() {
        val vm = vm(listOf(item("a", "2026-01-15T18:00:00-05:00", unread = false)))
        assertFalse(vm.uiState.value.hasUnread)
        assertTrue(vm.markAllRead().isEmpty())
        assertEquals(0, vm.uiState.value.unreadCount)
        // A second call still returns nothing.
        assertTrue(vm.markAllRead().isEmpty())
    }

    @Test fun second_mark_all_read_after_clearing_returns_empty() {
        val vm = vm(listOf(item("a", "2026-01-15T18:00:00-05:00", unread = true)))
        assertEquals(listOf("a"), vm.markAllRead())
        assertTrue(vm.markAllRead().isEmpty()) // already read → no-op
        assertEquals(0, vm.uiState.value.unreadCount)
    }

    @Test fun empty_feed_has_no_unread_and_mark_all_is_noop() {
        val vm = vm(emptyList())
        assertTrue(vm.uiState.value.feed.isEmpty)
        assertFalse(vm.uiState.value.hasUnread)
        assertTrue(vm.markAllRead().isEmpty())
    }

    // ----- incoming swap resolution (T3a) -----

    @Test fun resolve_swap_removes_the_actionable_entry_and_keeps_the_rest() {
        val swapEntry =
            item("n-swap", "2026-01-15T18:00:00-05:00", unread = true).copy(swapId = "s-1", swapAcceptable = true)
        val other = item("a", "2026-01-15T17:00:00-05:00", unread = true)
        val vm = vm(listOf(swapEntry, other))
        assertEquals(2, vm.uiState.value.feed.today.size)
        vm.resolveSwap("s-1")
        val rows = vm.uiState.value.feed.today
        assertEquals(listOf("a"), rows.map { it.id })
        assertTrue(rows.none { it.swapId != null })
    }

    @Test fun resolve_swap_is_idempotent_for_unknown_ids() {
        val vm = vm(listOf(item("a", "2026-01-15T17:00:00-05:00", unread = false)))
        val before = vm.uiState.value
        vm.resolveSwap("nope")
        assertEquals(before, vm.uiState.value)
    }
}
