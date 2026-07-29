package com.pennhousing.shift.shared.shifts

import com.pennhousing.shift.shared.model.AssignmentKind
import com.pennhousing.shift.shared.model.House
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.model.OpenFeed
import com.pennhousing.shift.shared.model.OpenShift
import com.pennhousing.shift.shared.model.PendingWriteKind
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Instant

/**
 * In-flight write projection (2026-07-28) — the replacement for the optimistic claim /
 * drop / swap moves.
 *
 * The bug being pinned: `claim-shift` is one POST per 30-minute block, so a 4h claim
 * committed as 8 separate writes and each one refetched the week. The worker watched the
 * card assemble under an already-shown success toast. These tests assert that while the
 * write is in flight the tapped card is held WHOLE and the half-written rows are hidden.
 */
class PendingWritesTest {
    private fun at(iso: String): Instant = Instant.parse(iso)

    private val harnwell = House("harnwell", "Harnwell")

    /** The eight 30-minute seats of a 16:00-20:00 shift, as the read models return them. */
    private fun blockIds(n: Int = 8): List<String> = (0 until n).map { "b$it" }

    private fun openBlock(
        index: Int,
        homeHouse: Boolean = true,
    ): OpenShift =
        OpenShift(
            id = "b$index",
            house = harnwell,
            start = at("2026-07-28T16:00:00-04:00").plus(kotlin.time.Duration.parse("${index * 30}m")),
            end = at("2026-07-28T16:30:00-04:00").plus(kotlin.time.Duration.parse("${index * 30}m")),
            feed = OpenFeed.WEEKLY,
            homeHouse = homeHouse,
        )

    private fun myBlock(index: Int): MyShift =
        MyShift(
            id = "b$index",
            house = harnwell,
            start = at("2026-07-28T16:00:00-04:00").plus(kotlin.time.Duration.parse("${index * 30}m")),
            end = at("2026-07-28T16:30:00-04:00").plus(kotlin.time.Duration.parse("${index * 30}m")),
            kind = AssignmentKind.TEMP_PICKUP,
        )

    /** The coalesced card the worker actually tapped: the whole 16:00-20:00 span. */
    private val tappedCard =
        OpenShift(
            id = "b0",
            house = harnwell,
            start = at("2026-07-28T16:00:00-04:00"),
            end = at("2026-07-28T20:00:00-04:00"),
            feed = OpenFeed.WEEKLY,
            homeHouse = true,
            blockIds = blockIds(),
        )

    private val claimInFlight =
        PendingWrite(
            token = "CLAIM:b0",
            kind = PendingWriteKind.CLAIM,
            blockIds = blockIds().toSet(),
            card = tappedCard,
        )

    @Test
    fun `no in-flight writes leaves both feeds untouched`() {
        val open = listOf(openBlock(0), openBlock(1))
        val mine = listOf(myBlock(4))
        assertEquals(open, pendingAwareOpenShifts(open, emptyList()))
        assertEquals(mine, pendingAwareMyShifts(mine, emptyList()))
    }

    @Test
    fun `a claim in flight holds its card at the full span while blocks are consumed`() {
        // Mid-write: three of the eight seats have already been claimed, so the open feed
        // only still carries the other five. Without this projection the card would render
        // as 17:30-20:00 and keep shrinking.
        val remaining = (3 until 8).map { openBlock(it) }
        val projected = pendingAwareOpenShifts(remaining, listOf(claimInFlight))

        assertEquals(1, projected.size, "the five remaining seats collapse into the held card")
        val card = projected.single()
        assertEquals(at("2026-07-28T16:00:00-04:00"), card.start)
        assertEquals(at("2026-07-28T20:00:00-04:00"), card.end)
        assertEquals(PendingWriteKind.CLAIM, card.busyKind)
    }

    @Test
    fun `a claim in flight hides the seats that have already landed in My Shifts`() {
        // The other half of the same moment: three seats now exist as the worker's, which
        // is exactly the block-by-block assembly the worker complained about.
        val landed = (0 until 3).map { myBlock(it) }
        assertEquals(emptyList(), pendingAwareMyShifts(landed, listOf(claimInFlight)))
    }

    @Test
    fun `an unrelated shift is untouched by a claim in flight`() {
        val other = myBlock(0).copy(id = "other", blockIds = listOf("other"))
        val projected = pendingAwareMyShifts(listOf(other), listOf(claimInFlight))
        assertEquals(listOf(other), projected)
        assertNull(projected.single().busyKind)
    }

    @Test
    fun `a drop in flight keeps the shift visible and marks it busy`() {
        // A drop must NOT remove the card: until the server agrees, the worker still holds
        // the shift, and showing it gone is the same lie as showing a claim that has not
        // landed.
        val mine = listOf(myBlock(0), myBlock(1))
        val drop = PendingWrite("DROP:b0", PendingWriteKind.DROP, setOf("b0"))
        val projected = pendingAwareMyShifts(mine, listOf(drop))

        assertEquals(2, projected.size)
        assertEquals(PendingWriteKind.DROP, projected[0].busyKind)
        assertNull(projected[1].busyKind, "only the dropped seat is busy")
    }

    @Test
    fun `a drop in flight contributes no open-feed card and hides its half-written rows`() {
        // The server vacates seats one at a time; those rows must not trickle into the open
        // feed while the drop is still running.
        val partial = listOf(openBlock(0))
        val drop = PendingWrite("DROP:b0", PendingWriteKind.DROP, setOf("b0"))
        assertEquals(emptyList(), pendingAwareOpenShifts(partial, listOf(drop)))
    }

    @Test
    fun `a swap in flight marks the offered shift busy`() {
        val mine = listOf(myBlock(0))
        val swap = PendingWrite("SWAP:b0", PendingWriteKind.SWAP, setOf("b0"))
        assertEquals(PendingWriteKind.SWAP, pendingAwareMyShifts(mine, listOf(swap)).single().busyKind)
    }

    @Test
    fun `a drop outranks a swap on the same seat`() {
        val mine = listOf(myBlock(0))
        val writes =
            listOf(
                PendingWrite("SWAP:b0", PendingWriteKind.SWAP, setOf("b0")),
                PendingWrite("DROP:b0", PendingWriteKind.DROP, setOf("b0")),
            )
        assertEquals(PendingWriteKind.DROP, pendingAwareMyShifts(mine, writes).single().busyKind)
    }

    @Test
    fun `a busy card offers no action and says what is happening`() {
        val row = tappedCard.copy(busyKind = PendingWriteKind.CLAIM).toRow(claimable = true)
        assertTrue(row.busy)
        assertNull(row.actionLabel, "tapping again would fire a second set of per-block writes")
        assertEquals(pendingWriteLabel(PendingWriteKind.CLAIM), row.busyLabel)
        assertEquals(pendingWriteNote(PendingWriteKind.CLAIM), row.busyNote)
    }

    @Test
    fun `a settled card is unchanged`() {
        val row = tappedCard.toRow(claimable = true)
        assertFalse(row.busy)
        assertEquals("Claim", row.actionLabel)
        assertNull(row.busyLabel)
    }

    @Test
    fun `a busy run never merges into its settled neighbour`() {
        // Coalescing keys on busyKind, so a drop on the first half of a run leaves two
        // cards rather than painting the whole run as busy.
        val run = (0 until 4).map { myBlock(it) }
        val drop = PendingWrite("DROP", PendingWriteKind.DROP, setOf("b0", "b1"))
        val cards = coalesceMyShifts(pendingAwareMyShifts(run, listOf(drop)))

        assertEquals(2, cards.size)
        assertEquals(PendingWriteKind.DROP, cards[0].busyKind)
        assertNull(cards[1].busyKind)
    }

    @Test
    fun `pending write copy never contains an em or en dash`() {
        // AGENTS.md non-negotiable: surfaced copy uses plain punctuation.
        PendingWriteKind.entries.forEach { kind ->
            listOf(pendingWriteLabel(kind), pendingWriteNote(kind)).forEach { copy ->
                assertFalse(copy.contains('—'), "em dash in: $copy")
                assertFalse(copy.contains('–'), "en dash in: $copy")
            }
        }
    }
}
