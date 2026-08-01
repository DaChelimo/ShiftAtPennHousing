package com.pennhousing.shift.shared.shifts

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.time.Instant

/**
 * The weekly cap is SERVER config, per week (§5.3 / §14).
 *
 * These exist because the app used to decide the cap itself from two compiled-in
 * constants (soft 20h / break-hard 40h) chosen by a `breakProfile` flag the live host
 * never set. Every worker saw 20h in every season, including a summer season configured
 * at 40h/hard through /admin/operations, and no admin action could change it.
 *
 * The load-bearing cases below are the ones the old client-side derivation could not
 * express AT ALL: a cap that is neither 20 nor 40, and a hard cap on a week that is not
 * a break.
 */
class WeeklyCapTest {
    private fun at(iso: String) = Instant.parse(iso)

    // Jan 2026: Mon 12th, Mon 19th. Summer 2026: Mon Jun 15th.
    private val monJan12 = "2026-01-12"
    private val monJan19 = "2026-01-19"

    private val summerHard40 = WeeklyCap(40.0, CapEnforcement.HARD)
    private val oddCap = WeeklyCap(37.5, CapEnforcement.SOFT)

    // ----- the verdict follows the cap, not a hardcoded pair -----

    @Test fun a_hard_cap_blocks_rather_than_warns() {
        // THE BUG: a summer worker at 39h claiming 2h. Under the old constants this week
        // resolved to soft-20 and merely warned; the server would then refuse the claim.
        assertEquals(ClaimCapVerdict.HARD_CAP_BLOCKED, evaluateClaimCap(39.0, 2.0, summerHard40))
    }

    @Test fun a_40h_week_does_not_warn_at_25h() {
        // THE BUG, the other direction: 25h in a 40h season is unremarkable, but the old
        // fixed 20h soft cap warned every single time, training workers to click through.
        assertEquals(ClaimCapVerdict.OK, evaluateClaimCap(23.0, 2.0, summerHard40))
    }

    @Test fun exactly_at_the_cap_is_not_over_it() {
        // "Over" is strictly greater, at every cap value — not just at 20 and 40.
        assertEquals(ClaimCapVerdict.OK, evaluateClaimCap(35.5, 2.0, oddCap))
        assertEquals(ClaimCapVerdict.SOFT_CAP_WARNING, evaluateClaimCap(36.0, 2.0, oddCap))
    }

    @Test fun a_soft_cap_still_only_warns_however_far_over() {
        assertEquals(ClaimCapVerdict.SOFT_CAP_WARNING, evaluateClaimCap(80.0, 40.0, WeeklyCap.FALLBACK))
    }

    // ----- labels come from the cap -----

    @Test fun the_summary_chip_names_the_actual_cap_and_its_enforcement() {
        assertEquals("of 40h hard cap", weeklyHoursSummary(30.0, summerHard40).capLabel)
        assertEquals("of 37.5h soft cap", weeklyHoursSummary(30.0, oddCap).capLabel)
        assertEquals("of 20h soft cap", weeklyHoursSummary(14.0).capLabel)
    }

    @Test fun the_claim_meter_measures_against_the_weeks_cap() {
        val m = claimMeter(currentWeeklyHours = 20.0, addedHours = 2.0, cap = summerHard40)
        assertEquals("40h", m.capLabel)
        assertEquals("hard cap", m.capEnforcementLabel)
        assertEquals("Puts you over the 40h hard cap", m.overCapTitle)
        // 20/40, not 20/20 — the old meter read as pegged at the limit all summer.
        assertEquals(0.5, m.currentFraction)
        assertEquals(0.55, m.afterFraction)
        assertEquals(ClaimCapVerdict.OK, m.verdict)
    }

    @Test fun a_nonsensical_zero_cap_degrades_instead_of_emitting_nan() {
        // A compiled season could in principle carry a 0 cap. The meter must not put
        // NaN on screen; the verdict is still driven by the real (zero) cap.
        val m = claimMeter(currentWeeklyHours = 4.0, addedHours = 1.0, cap = WeeklyCap(0.0, CapEnforcement.SOFT))
        assertTrue(m.currentFraction in 0.0..1.0)
        assertTrue(m.afterFraction in 0.0..1.0)
        assertEquals(ClaimCapVerdict.SOFT_CAP_WARNING, m.verdict)
    }

    // ----- the schedule resolves the RIGHT week -----

    @Test fun each_week_gets_its_own_cap() {
        // The case that makes per-week lookup necessary rather than a single value: the
        // school year ends and a season with a different cap begins the following Monday.
        val schedule =
            WeeklyCapSchedule.of(
                listOf(
                    Triple(monJan12, 20.0, CapEnforcement.SOFT),
                    Triple(monJan19, 40.0, CapEnforcement.HARD),
                ),
            )
        assertEquals(WeeklyCap.FALLBACK, schedule.capAt(at("2026-01-15T12:00:00-05:00")))
        assertEquals(summerHard40, schedule.capAt(at("2026-01-22T12:00:00-05:00")))
    }

    @Test fun a_sunday_late_evening_belongs_to_the_week_that_started_monday() {
        // NY-anchored Mon..Sun. Sunday Jan 18th 23:30 NY is still the Jan 12th week; get
        // this wrong and every Sunday shows next week's cap.
        val schedule = WeeklyCapSchedule.of(listOf(Triple(monJan12, 33.0, CapEnforcement.SOFT)))
        assertEquals(33.0, schedule.capAt(at("2026-01-18T23:30:00-05:00")).hours)
    }

    @Test fun a_week_the_server_did_not_send_falls_back_rather_than_failing() {
        val schedule = WeeklyCapSchedule.of(listOf(Triple(monJan12, 40.0, CapEnforcement.HARD)))
        assertEquals(WeeklyCap.FALLBACK, schedule.capAt(at("2027-03-03T12:00:00-05:00")))
    }

    @Test fun before_the_first_fetch_every_week_is_the_school_year_default() {
        // Soft, so a pre-load meter can only ever over-warn, never block a claim the
        // server would have allowed.
        val cap = WeeklyCapSchedule.PENDING.capAt(at("2026-06-17T12:00:00-04:00"))
        assertEquals(20.0, cap.hours)
        assertEquals(CapEnforcement.SOFT, cap.enforcement)
    }

    @Test fun enforcement_parsing_defaults_to_soft_for_anything_unexpected() {
        assertEquals(CapEnforcement.HARD, WeeklyCap.enforcementOf("hard"))
        assertEquals(CapEnforcement.HARD, WeeklyCap.enforcementOf("HARD"))
        assertEquals(CapEnforcement.SOFT, WeeklyCap.enforcementOf("soft"))
        assertEquals(CapEnforcement.SOFT, WeeklyCap.enforcementOf(null))
        assertEquals(CapEnforcement.SOFT, WeeklyCap.enforcementOf("something_new"))
    }
}
