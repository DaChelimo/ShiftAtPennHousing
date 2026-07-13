package com.pennhousing.shift.shared.shifts

import com.pennhousing.shift.shared.model.AssignmentKind
import com.pennhousing.shift.shared.model.House
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.model.OpenFeed
import com.pennhousing.shift.shared.model.OpenShift
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.hours
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Instant

/**
 * Block coalescing (parity CO) — the live read models are one row per 30-minute
 * block (invariant #5), and this layer merges each contiguous same-shift run into
 * ONE displayed card carrying its constituent block `assignment_id`s. Fixtures pin
 * explicit America/New_York offsets (EST -05:00 / EDT -04:00); the DST cases prove
 * contiguity is instant arithmetic, not wall-clock (invariant #6).
 */
class CoalesceTest {
    private fun at(iso: String): Instant = Instant.parse(iso)

    private val harnwell = House("harnwell", "Harnwell")
    private val quad = House("quad", "Quad")

    /** [n] consecutive 30-min blocks starting at [startIso], ids `prefix-0..n-1`. */
    private fun blocks(
        startIso: String,
        n: Int,
        prefix: String = "b",
        house: House = harnwell,
        kind: AssignmentKind = AssignmentKind.SCHEDULED,
        mutate: (MyShift) -> MyShift = { it },
    ): List<MyShift> {
        val start = at(startIso)
        return (0 until n).map { i ->
            mutate(
                MyShift(
                    id = "$prefix-$i",
                    house = house,
                    start = start + (i * 30).minutes,
                    end = start + ((i + 1) * 30).minutes,
                    kind = kind,
                ),
            )
        }
    }

    // ----- MyShift merging -----

    @Test fun contiguous_same_shift_blocks_merge_into_one_card_carrying_all_block_ids() {
        val eightBlocks = blocks("2026-01-15T12:00:00-05:00", 8) // 12:00-16:00
        val merged = coalesceMyShifts(eightBlocks.shuffled())
        assertEquals(1, merged.size)
        val card = merged.single()
        assertEquals("b-0", card.id) // first block's id is the card id
        assertEquals(at("2026-01-15T12:00:00-05:00"), card.start)
        assertEquals(at("2026-01-15T16:00:00-05:00"), card.end)
        assertEquals((0 until 8).map { "b-$it" }, card.blockIds) // time-ordered
    }

    @Test fun a_gap_splits_the_run_into_separate_cards() {
        val first = blocks("2026-01-15T12:00:00-05:00", 2, "a") // 12:00-13:00
        val second = blocks("2026-01-15T14:00:00-05:00", 2, "z") // 14:00-15:00 (13:00-14:00 gap)
        val merged = coalesceMyShifts(first + second)
        assertEquals(2, merged.size)
        assertEquals(listOf("a-0", "a-1"), merged[0].blockIds)
        assertEquals(listOf("z-0", "z-1"), merged[1].blockIds)
    }

    @Test fun adjacent_blocks_at_different_houses_do_not_merge() {
        val mine = blocks("2026-01-15T12:00:00-05:00", 2, "h", house = harnwell)
        val theirs = blocks("2026-01-15T13:00:00-05:00", 2, "q", house = quad)
        assertEquals(2, coalesceMyShifts(mine + theirs).size)
    }

    @Test fun adjacent_blocks_of_different_kinds_do_not_merge() {
        val scheduled = blocks("2026-01-15T12:00:00-05:00", 2, "s", kind = AssignmentKind.SCHEDULED)
        val pickup = blocks("2026-01-15T13:00:00-05:00", 2, "p", kind = AssignmentKind.TEMP_PICKUP)
        assertEquals(2, coalesceMyShifts(scheduled + pickup).size)
    }

    @Test fun treatment_flag_mismatches_split_the_run() {
        // Each §11.2 flag is part of the card's visual identity — a flagged block
        // never merges into an unflagged neighbour.
        val base = "2026-01-15T12:00:00-05:00"
        fun pair(mutateSecond: (MyShift) -> MyShift): Int {
            val a = blocks(base, 1, "a")
            val b = blocks("2026-01-15T12:30:00-05:00", 1, "b", mutate = mutateSecond)
            return coalesceMyShifts(a + b).size
        }
        assertEquals(2, pair { it.copy(pending = true) })
        assertEquals(2, pair { it.copy(breakShift = true) })
        assertEquals(2, pair { it.copy(droppedStillOpen = true) })
        assertEquals(2, pair { it.copy(crossHouse = true) })
        // and the control: an identical neighbour DOES merge
        assertEquals(1, pair { it })
    }

    @Test fun spring_forward_gap_is_contiguous_on_instants() {
        // 2026-03-08: 02:00 EST jumps to 03:00 EDT. Blocks 01:30-02:00 EST and
        // 03:00-03:30 EDT are adjacent INSTANTS (07:00Z boundary) → one 1h card.
        val a = MyShift("dst-a", harnwell, at("2026-03-08T01:30:00-05:00"), at("2026-03-08T03:00:00-04:00"), AssignmentKind.SCHEDULED)
        val b = MyShift("dst-b", harnwell, at("2026-03-08T03:00:00-04:00"), at("2026-03-08T03:30:00-04:00"), AssignmentKind.SCHEDULED)
        val merged = coalesceMyShifts(listOf(a, b))
        assertEquals(1, merged.size)
        assertEquals(1.hours, merged.single().end - merged.single().start)
        assertEquals(listOf("dst-a", "dst-b"), merged.single().blockIds)
    }

    @Test fun fall_back_repeated_hour_merges_by_instant() {
        // 2026-11-01: 01:xx occurs twice (EDT then EST). Three blocks spanning the
        // transition — 01:00 EDT, 01:30 EDT, 01:00 EST — are contiguous instants → 1.5h.
        val s = at("2026-11-01T01:00:00-04:00")
        val blocks =
            (0 until 3).map { i ->
                MyShift("fb-$i", harnwell, s + (i * 30).minutes, s + ((i + 1) * 30).minutes, AssignmentKind.SCHEDULED)
            }
        val merged = coalesceMyShifts(blocks)
        assertEquals(1, merged.size)
        assertEquals(90, (merged.single().end - merged.single().start).inWholeMinutes)
    }

    @Test fun single_span_shift_passes_through_unchanged() {
        // The demo path's hand-built multi-hour spans are single "blocks" here.
        val demo = MyShift("sc-1", harnwell, at("2026-01-15T12:00:00-05:00"), at("2026-01-15T14:00:00-05:00"), AssignmentKind.SCHEDULED)
        assertEquals(listOf(demo), coalesceMyShifts(listOf(demo)))
        assertEquals(listOf("sc-1"), coalesceMyShifts(listOf(demo)).single().blockIds)
    }

    @Test fun result_is_sorted_by_start_across_merge_groups() {
        val late = blocks("2026-01-15T18:00:00-05:00", 2, "late")
        val early = blocks("2026-01-15T08:00:00-05:00", 2, "early", house = quad)
        val merged = coalesceMyShifts(late + early)
        assertEquals(listOf("early-0", "late-0"), merged.map { it.id })
    }

    @Test fun overlapping_rows_are_not_silently_absorbed() {
        // Two rows claiming the same block (a read-model bug) must stay visible.
        val a = MyShift("ov-a", harnwell, at("2026-01-15T12:00:00-05:00"), at("2026-01-15T13:00:00-05:00"), AssignmentKind.SCHEDULED)
        val b = MyShift("ov-b", harnwell, at("2026-01-15T12:30:00-05:00"), at("2026-01-15T13:30:00-05:00"), AssignmentKind.SCHEDULED)
        assertEquals(2, coalesceMyShifts(listOf(a, b)).size)
    }

    // ----- OpenShift merging -----

    private fun openBlocks(
        startIso: String,
        n: Int,
        prefix: String = "o",
        house: House = harnwell,
        feed: OpenFeed = OpenFeed.WEEKLY,
        homeHouse: Boolean = true,
        weeksRemaining: Int? = null,
    ): List<OpenShift> {
        val start = at(startIso)
        return (0 until n).map { i ->
            OpenShift(
                id = "$prefix-$i",
                house = house,
                start = start + (i * 30).minutes,
                end = start + ((i + 1) * 30).minutes,
                feed = feed,
                homeHouse = homeHouse,
                weeksRemaining = weeksRemaining,
            )
        }
    }

    @Test fun contiguous_open_blocks_merge_carrying_all_block_ids() {
        val merged = coalesceOpenShifts(openBlocks("2026-01-15T10:00:00-05:00", 4))
        assertEquals(1, merged.size)
        assertEquals("o-0", merged.single().id)
        assertEquals(2.hours, merged.single().end - merged.single().start)
        assertEquals(listOf("o-0", "o-1", "o-2", "o-3"), merged.single().blockIds)
        assertEquals(1, merged.single().count) // a single opening → no "N open" badge
    }

    @Test fun concurrent_desks_at_a_multi_staff_house_collapse_into_one_card_with_a_count() {
        // The Quad has two desks both vacant 10:00-11:00 (two 30-min blocks each). The
        // read model returns one row per desk-block, so without lane threading these
        // fragment; they must collapse into ONE "2 open" card spanning the full hour,
        // carrying one representative lane's block ids (claiming consumes one desk).
        val deskA = openBlocks("2026-01-15T10:00:00-05:00", 2, "a", house = quad, homeHouse = false)
        val deskB = openBlocks("2026-01-15T10:00:00-05:00", 2, "b", house = quad, homeHouse = false)
        val merged = coalesceOpenShifts(deskA + deskB)
        assertEquals(1, merged.size)
        val card = merged.single()
        assertEquals(2, card.count)
        assertEquals(1.hours, card.end - card.start)
        assertEquals(listOf("a-0", "a-1"), card.blockIds) // representative lane only
    }

    @Test fun concurrent_desks_of_different_spans_stay_separate_count_one_cards() {
        // Desk A open 10:00-11:00, desk B open only 10:00-10:30. Different spans → two
        // separate count-1 cards, sorted by start then end (the shorter first).
        val deskA = openBlocks("2026-01-15T10:00:00-05:00", 2, "a", house = quad, homeHouse = false)
        val deskB = openBlocks("2026-01-15T10:00:00-05:00", 1, "b", house = quad, homeHouse = false)
        val merged = coalesceOpenShifts(deskA + deskB)
        assertEquals(2, merged.size)
        assertTrue(merged.all { it.count == 1 })
        assertEquals(at("2026-01-15T10:30:00-05:00"), merged[0].end)
        assertEquals(at("2026-01-15T11:00:00-05:00"), merged[1].end)
    }

    @Test fun weekly_and_permanent_feeds_do_not_merge() {
        val weekly = openBlocks("2026-01-15T10:00:00-05:00", 2, "w", feed = OpenFeed.WEEKLY)
        val permanent = openBlocks("2026-01-15T11:00:00-05:00", 2, "p", feed = OpenFeed.PERMANENT_OPENING, weeksRemaining = 6)
        assertEquals(2, coalesceOpenShifts(weekly + permanent).size)
    }

    @Test fun permanent_openings_merge_only_when_weeks_remaining_matches() {
        val six = openBlocks("2026-01-15T10:00:00-05:00", 2, "six", feed = OpenFeed.PERMANENT_OPENING, weeksRemaining = 6)
        val four = openBlocks("2026-01-15T11:00:00-05:00", 2, "four", feed = OpenFeed.PERMANENT_OPENING, weeksRemaining = 4)
        val merged = coalesceOpenShifts(six + four)
        assertEquals(2, merged.size)
        assertTrue(merged.all { it.blockIds.size == 2 })
        // and a same-weeks pair does merge
        val more = openBlocks("2026-01-15T11:00:00-05:00", 2, "more", feed = OpenFeed.PERMANENT_OPENING, weeksRemaining = 6)
        assertEquals(1, coalesceOpenShifts(six + more).size)
        assertEquals(6, coalesceOpenShifts(six + more).single().weeksRemaining)
    }

    @Test fun permanent_opening_recurs_weekly_collapses_to_one_card_keeping_earliest() {
        // A slot dropped for the rest of the semester is vacant on every remaining week:
        // worker_open_shifts returns one block-run per future occurrence (same house, same
        // NY weekday, same HH:MM), so the per-span step yields N identical "EVERY MON
        // 17:00-18:00 · N weeks remaining" cards. They name the SAME recurring slot — collapse
        // to ONE card, keeping the earliest occurrence (pickup re-derives all weeks).
        val mondays =
            listOf(
                "2026-06-22T17:00:00-04:00", // Mon
                "2026-06-29T17:00:00-04:00", // Mon
                "2026-07-06T17:00:00-04:00", // Mon
            ).flatMapIndexed { w, iso ->
                openBlocks(iso, 2, "mon$w", house = quad, feed = OpenFeed.PERMANENT_OPENING, weeksRemaining = 3)
            }
        val merged = coalesceOpenShifts(mondays)
        assertEquals(1, merged.size)
        val card = merged.single()
        assertEquals(at("2026-06-22T17:00:00-04:00"), card.start) // earliest occurrence
        assertEquals(at("2026-06-22T18:00:00-04:00"), card.end)
        assertEquals(3, card.weeksRemaining)
    }

    @Test fun permanent_openings_of_different_slots_stay_separate() {
        // Same house, same week, but two distinct recurring slots (Mon vs Wed) — different
        // recurrence identities → two cards.
        val mon = openBlocks("2026-06-22T17:00:00-04:00", 2, "mon", house = quad, feed = OpenFeed.PERMANENT_OPENING, weeksRemaining = 4)
        val wed = openBlocks("2026-06-24T17:00:00-04:00", 2, "wed", house = quad, feed = OpenFeed.PERMANENT_OPENING, weeksRemaining = 4)
        assertEquals(2, coalesceOpenShifts(mon + wed).size)
    }

    @Test fun open_gap_splits_and_result_sorted_by_start() {
        val a = openBlocks("2026-01-15T14:00:00-05:00", 2, "a")
        val b = openBlocks("2026-01-15T09:00:00-05:00", 2, "b")
        val merged = coalesceOpenShifts(a + b)
        assertEquals(listOf("b-0", "a-0"), merged.map { it.id })
    }
}
