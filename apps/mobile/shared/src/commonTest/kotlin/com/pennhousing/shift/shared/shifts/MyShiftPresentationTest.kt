package com.pennhousing.shift.shared.shifts

import com.pennhousing.shift.shared.model.AssignmentKind
import com.pennhousing.shift.shared.model.House
import com.pennhousing.shift.shared.model.MyShift
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.time.Instant

/**
 * My Shifts presentation logic (shared) — the pure card-state mapping + NY-anchored
 * time/day/duration formatting that the Compose + SwiftUI cards render verbatim.
 * Fixtures pin explicit America/New_York offsets (EST -05:00 / EDT -04:00) so the
 * DST behaviour is unambiguous (AGENTS invariant #6).
 */
class MyShiftPresentationTest {
    private fun at(iso: String): Instant = Instant.parse(iso)

    private val harnwell = House("harnwell", "Harnwell")
    private val quad = House("quad", "Quad")

    private fun shift(
        kind: AssignmentKind,
        house: House = harnwell,
        crossHouse: Boolean = false,
        pending: Boolean = false,
        breakShift: Boolean = false,
        droppedStillOpen: Boolean = false,
    ) = MyShift(
        id = "s",
        house = house,
        start = at("2026-01-15T09:00:00-05:00"),
        end = at("2026-01-15T13:00:00-05:00"),
        kind = kind,
        crossHouse = crossHouse,
        pending = pending,
        breakShift = breakShift,
        droppedStillOpen = droppedStillOpen,
    )

    // ----- card state mapping -----

    @Test fun scheduled_is_scheduled() = assertEquals(MyShiftCardState.SCHEDULED, myShiftCardState(shift(AssignmentKind.SCHEDULED)))

    @Test fun float_out_is_float_out() =
        assertEquals(MyShiftCardState.FLOAT_OUT, myShiftCardState(shift(AssignmentKind.FLOAT_OUT, quad, crossHouse = true)))

    @Test fun pending_float_escalates() =
        assertEquals(
            MyShiftCardState.PENDING_FLOAT,
            myShiftCardState(shift(AssignmentKind.FLOAT_OUT, quad, crossHouse = true, pending = true)),
        )

    @Test fun temp_pickup_home() = assertEquals(MyShiftCardState.PICKUP_HOME, myShiftCardState(shift(AssignmentKind.TEMP_PICKUP)))

    @Test fun temp_pickup_cross() =
        assertEquals(MyShiftCardState.PICKUP_CROSS, myShiftCardState(shift(AssignmentKind.TEMP_PICKUP, quad, crossHouse = true)))

    @Test fun permanent_pickup_is_pickup() =
        assertEquals(
            MyShiftCardState.PICKUP_HOME,
            myShiftCardState(shift(AssignmentKind.PERMANENT_PICKUP)),
        )

    @Test fun break_shift_is_break() =
        assertEquals(MyShiftCardState.BREAK_SHIFT, myShiftCardState(shift(AssignmentKind.SCHEDULED, breakShift = true)))

    @Test fun dropped_wins_over_everything() =
        assertEquals(
            MyShiftCardState.DROPPED,
            myShiftCardState(shift(AssignmentKind.TEMP_PICKUP, quad, crossHouse = true, droppedStillOpen = true)),
        )

    // ----- formatting (DST-anchored) -----

    @Test fun block_time_is_ny_local_in_winter() = assertEquals("21:00", formatBlockTime(at("2026-01-15T21:00:00-05:00")))

    @Test fun block_time_is_ny_local_in_summer() = assertEquals("21:00", formatBlockTime(at("2026-07-15T21:00:00-04:00")))

    @Test fun block_time_converts_from_utc_to_ny() = assertEquals("16:00", formatBlockTime(at("2026-01-15T21:00:00Z")))

    @Test fun time_range_uses_en_dash() =
        assertEquals(
            "09:00 - 13:00",
            formatTimeRange(at("2026-01-15T09:00:00-05:00"), at("2026-01-15T13:00:00-05:00")),
        )

    @Test fun day_label_is_dow_month_day() = assertEquals("Thu · Jan 15", formatDayLabel(at("2026-01-15T12:00:00-05:00")))

    @Test fun duration_whole_hours() = assertEquals("4h", formatDuration(at("2026-01-15T09:00:00-05:00"), at("2026-01-15T13:00:00-05:00")))

    @Test fun duration_hours_and_minutes() =
        assertEquals("2h 30m", formatDuration(at("2026-01-15T09:00:00-05:00"), at("2026-01-15T11:30:00-05:00")))

    @Test fun duration_minutes_only() =
        assertEquals(
            "30m",
            formatDuration(at("2026-01-15T09:00:00-05:00"), at("2026-01-15T09:30:00-05:00")),
        )

    @Test fun hours_whole() = assertEquals("14h", formatHours(14.0))

    @Test fun hours_fraction() = assertEquals("14.5h", formatHours(14.5))

    @Test fun weekly_summary_soft_cap() {
        val s = weeklyHoursSummary(14.0)
        assertEquals("14h", s.current)
        assertEquals("of 20h soft cap", s.capLabel)
    }

    @Test fun weekly_summary_break_hard_cap() = assertEquals("of 40h hard cap", weeklyHoursSummary(30.0, breakProfile = true).capLabel)

    // ----- row builder -----

    @Test fun row_for_scheduled_shows_house_not_destination() {
        val r = shift(AssignmentKind.SCHEDULED).toRow()
        assertEquals(MyShiftCardState.SCHEDULED, r.state)
        assertEquals("Harnwell", r.houseName)
        assertNull(r.destination)
        assertEquals("H", r.houseInitial)
        assertEquals("09:00 - 13:00", r.timeLabel)
        assertEquals("4h", r.durationLabel)
    }

    @Test fun row_for_float_out_shows_destination_not_house() {
        val r = shift(AssignmentKind.FLOAT_OUT, quad, crossHouse = true).toRow()
        assertEquals("Quad", r.destination)
        assertNull(r.houseName)
        assertEquals("Q", r.houseInitial)
    }

    @Test fun row_for_cross_pickup_shows_destination() {
        val r = shift(AssignmentKind.TEMP_PICKUP, quad, crossHouse = true).toRow()
        assertEquals(MyShiftCardState.PICKUP_CROSS, r.state)
        assertEquals("Quad", r.destination)
    }
}
