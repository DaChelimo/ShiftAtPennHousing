package com.pennhousing.shift.shared.shifts

import com.pennhousing.shift.shared.model.House
import com.pennhousing.shift.shared.model.OpenFeed
import com.pennhousing.shift.shared.model.OpenShift
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.time.Instant

/**
 * Open Shifts presentation logic (shared) — the pure OPEN/UNPICKABLE/PERMANENT card
 * mapping, the row builder, and the claim-sheet hours meter that both front ends
 * render verbatim. Fixtures pin explicit America/New_York offsets (EST -05:00) and a
 * fixed `now` so the T-2h cutoff (§5.4) is unambiguous (AGENTS invariant #6). Anchor
 * dates: 2026-01-15 is a Thursday, 2026-01-21 a Wednesday.
 */
class OpenShiftPresentationTest {
    private fun at(iso: String): Instant = Instant.parse(iso)

    private val harnwell = House("harnwell", "Harnwell")
    private val quad = House("quad", "Quad")

    // Thursday 2026-01-15, 08:00 ET.
    private val now = at("2026-01-15T08:00:00-05:00")

    private fun open(
        feed: OpenFeed = OpenFeed.WEEKLY,
        house: House = harnwell,
        start: String = "2026-01-15T14:00:00-05:00",
        end: String = "2026-01-15T16:00:00-05:00",
        homeHouse: Boolean = true,
        weeksRemaining: Int? = null,
    ) = OpenShift(
        id = "o",
        house = house,
        start = at(start),
        end = at(end),
        feed = feed,
        homeHouse = homeHouse,
        weeksRemaining = weeksRemaining,
    )

    // ----- card state mapping -----

    @Test fun weekly_far_out_is_open() = assertEquals(OpenShiftCardState.OPEN, openShiftCardState(open(), now))

    @Test fun weekly_within_two_hours_is_unpickable() =
        assertEquals(
            OpenShiftCardState.UNPICKABLE,
            // starts 09:00 → 1h out (< T-2h) → not claimable.
            openShiftCardState(open(start = "2026-01-15T09:00:00-05:00", end = "2026-01-15T11:00:00-05:00"), now),
        )

    @Test fun exactly_two_hours_out_is_unpickable() =
        assertEquals(
            OpenShiftCardState.UNPICKABLE,
            // starts 10:00 → exactly T-2h → NOT claimable (§5.4 / decision #7).
            openShiftCardState(open(start = "2026-01-15T10:00:00-05:00", end = "2026-01-15T12:00:00-05:00"), now),
        )

    @Test fun permanent_is_permanent_even_when_imminent() =
        assertEquals(
            OpenShiftCardState.PERMANENT,
            // a permanent opening is never locked by the per-occurrence T-2h cutoff.
            openShiftCardState(open(feed = OpenFeed.PERMANENT_OPENING, start = "2026-01-15T09:00:00-05:00"), now),
        )

    @Test fun resolve_open_state_is_pure() {
        assertEquals(OpenShiftCardState.PERMANENT, resolveOpenState(OpenFeed.PERMANENT_OPENING, claimable = true))
        assertEquals(OpenShiftCardState.OPEN, resolveOpenState(OpenFeed.WEEKLY, claimable = true))
        assertEquals(OpenShiftCardState.UNPICKABLE, resolveOpenState(OpenFeed.WEEKLY, claimable = false))
    }

    // ----- row builder -----

    @Test fun row_for_open_weekly_offers_claim() {
        val r = open().toRow(claimable = true)
        assertEquals(OpenShiftCardState.OPEN, r.state)
        assertEquals("Harnwell", r.houseName)
        assertEquals("H", r.houseInitial)
        assertEquals("14:00 - 16:00", r.timeLabel)
        assertEquals("Thu · Jan 15", r.dayLabel)
        assertEquals("2h", r.durationLabel)
        assertNull(r.meta)
        assertEquals("Claim", r.actionLabel)
    }

    @Test fun row_for_unpickable_has_no_action_and_locked_meta() {
        val r = open().toRow(claimable = false)
        assertEquals(OpenShiftCardState.UNPICKABLE, r.state)
        assertEquals("Locked — within 2h of start", r.meta)
        assertNull(r.actionLabel)
    }

    @Test fun row_for_permanent_shows_recurring_day_and_weeks() {
        val r = open(
            feed = OpenFeed.PERMANENT_OPENING,
            start = "2026-01-21T16:00:00-05:00",
            end = "2026-01-21T18:00:00-05:00",
            weeksRemaining = 8,
        ).toRow(claimable = true)
        assertEquals(OpenShiftCardState.PERMANENT, r.state)
        assertEquals("Every Wed", r.dayLabel)
        assertEquals("8 weeks remaining", r.meta)
        assertEquals("Pick up", r.actionLabel)
    }

    @Test fun row_for_permanent_without_weeks_has_null_meta() {
        val r = open(feed = OpenFeed.PERMANENT_OPENING, weeksRemaining = null).toRow(claimable = true)
        assertNull(r.meta)
        assertEquals("Pick up", r.actionLabel)
    }

    @Test fun row_count_label_shows_only_when_more_than_one_concurrent_opening() {
        assertNull(open().toRow(claimable = true).countLabel) // single opening → no badge
        val multi = open().copy(count = 3).toRow(claimable = true)
        assertEquals(3, multi.count)
        assertEquals("3 open", multi.countLabel)
    }

    // ----- claim-sheet hours meter -----

    @Test fun meter_under_soft_cap_is_ok() {
        val m = claimMeter(currentWeeklyHours = 8.0, addedHours = 2.0, breakProfile = false)
        assertEquals("10h", m.afterLabel)
        assertEquals("20h", m.capLabel)
        assertEquals(ClaimCapVerdict.OK, m.verdict)
        assertEquals(0.4, m.currentFraction)
        assertEquals(0.5, m.afterFraction)
    }

    @Test fun meter_over_soft_cap_warns() {
        val m = claimMeter(currentWeeklyHours = 19.0, addedHours = 2.0, breakProfile = false)
        assertEquals("21h", m.afterLabel)
        assertEquals(ClaimCapVerdict.SOFT_CAP_WARNING, m.verdict)
    }

    @Test fun meter_break_over_hard_cap_blocks() {
        val m = claimMeter(currentWeeklyHours = 39.0, addedHours = 2.0, breakProfile = true)
        assertEquals("40h", m.capLabel)
        assertEquals(ClaimCapVerdict.HARD_CAP_BLOCKED, m.verdict)
    }

    @Test fun meter_fractions_clamp_to_one() {
        val m = claimMeter(currentWeeklyHours = 30.0, addedHours = 20.0, breakProfile = false)
        assertEquals(1.0, m.afterFraction)
    }

    // ----- permanent-pickup success toast -----

    @Test fun pickup_toast_all_weeks_taken() {
        assertEquals(
            "Picked up 22 of 22 weeks",
            permanentPickupToast(weeksPickedUp = 22, totalWeeks = 22, weeksSkipped = 0),
        )
    }

    @Test fun pickup_toast_some_weeks_skipped() {
        assertEquals(
            "Picked up 20 of 22 weeks · 2 skipped",
            permanentPickupToast(weeksPickedUp = 20, totalWeeks = 22, weeksSkipped = 2),
        )
    }

    @Test fun pickup_toast_single_week_is_singular() {
        assertEquals(
            "Picked up 1 of 1 week",
            permanentPickupToast(weeksPickedUp = 1, totalWeeks = 1, weeksSkipped = 0),
        )
    }

    @Test fun pickup_toast_generic_when_scope_unknown() {
        assertEquals("Picked up — it's now in My Shifts", PICKUP_SUCCESS_TOAST_GENERIC)
    }
}
