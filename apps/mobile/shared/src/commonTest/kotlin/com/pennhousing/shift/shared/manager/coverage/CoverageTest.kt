package com.pennhousing.shift.shared.manager.coverage

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Instant

/**
 * The Allied coverage-request lifecycle (BSpec §5.4a) — the Kotlin mirror of
 * `packages/core/src/coverage/index.ts`.
 *
 * These cases exist to pin the PARITY, not just the Kotlin behaviour: state derivation,
 * the action-required rule, overdue-first ordering, terminal-rung handling, and the
 * note requirement all have a TS twin driving the web Coverage page. If one platform's
 * copy is edited, these tests are the tripwire.
 *
 * Anchor: a coverage window of Wed 2026-01-14, 22:00 to 00:00 ET (a 2-hour empty stretch
 * crossing midnight, which is the realistic shape and also catches naive same-day
 * arithmetic).
 */
class CoverageTest {
    private fun at(iso: String): Instant = Instant.parse(iso)

    private val windowStart = at("2026-01-14T22:00:00-05:00")
    private val windowEnd = at("2026-01-15T00:00:00-05:00")

    private fun request(
        requestId: String = "req-1",
        rung: CoverageRung = CoverageRung.RSM,
        rungFiredAt: Instant = at("2026-01-14T20:00:00-05:00"),
        acknowledgedAt: Instant? = null,
        closedAt: Instant? = null,
        outcome: CoverageOutcome? = null,
        houseId: String = "harnwell",
        start: Instant = windowStart,
        end: Instant = windowEnd,
    ) = CoverageRequest(
        requestId = requestId,
        houseId = houseId,
        houseName = "Harnwell",
        windowStart = start,
        windowEnd = end,
        reason = "escalation_chain",
        currentRung = rung,
        rungFiredAt = rungFiredAt,
        acknowledgedAt = acknowledgedAt,
        closedAt = closedAt,
        outcome = outcome,
    )

    // ----- State derivation. The ORDER of the checks is the load-bearing part. -----

    @Test
    fun unacknowledgedBeforeWindowEndIsAwaitingAck() {
        assertEquals(
            CoverageRequestState.AWAITING_ACK,
            coverageRequestState(request(), at("2026-01-14T21:00:00-05:00")),
        )
    }

    @Test
    fun acknowledgedBeforeWindowEndIsAcknowledged() {
        assertEquals(
            CoverageRequestState.ACKNOWLEDGED,
            coverageRequestState(
                request(acknowledgedAt = at("2026-01-14T21:05:00-05:00")),
                at("2026-01-14T21:10:00-05:00"),
            ),
        )
    }

    @Test
    fun unacknowledgedPastWindowEndIsOverdue() {
        assertEquals(
            CoverageRequestState.OVERDUE,
            coverageRequestState(request(), at("2026-01-15T01:00:00-05:00")),
        )
    }

    /**
     * The case the whole audit trail exists for: someone said "I've got this" and then
     * never recorded what happened. Overdue must beat acknowledged, or this disappears.
     */
    @Test
    fun acknowledgedButNeverClosedGoesOverdue() {
        assertEquals(
            CoverageRequestState.OVERDUE,
            coverageRequestState(
                request(acknowledgedAt = at("2026-01-14T21:05:00-05:00")),
                at("2026-01-15T01:00:00-05:00"),
            ),
        )
    }

    /** Closed wins over everything, including a window long past. */
    @Test
    fun closedStaysClosedPastItsWindow() {
        assertEquals(
            CoverageRequestState.CLOSED,
            coverageRequestState(
                request(
                    acknowledgedAt = at("2026-01-14T21:05:00-05:00"),
                    closedAt = at("2026-01-14T21:20:00-05:00"),
                    outcome = CoverageOutcome.ALLIED_SECURED,
                ),
                at("2026-01-20T12:00:00-05:00"),
            ),
        )
    }

    /** Exactly at window end is already overdue: the desk is past saving by then. */
    @Test
    fun windowEndBoundaryIsOverdue() {
        assertEquals(CoverageRequestState.OVERDUE, coverageRequestState(request(), windowEnd))
    }

    // ----- Action required drives the banner and the badge. -----

    @Test
    fun awaitingAckAndOverdueAreActionRequired() {
        assertTrue(isActionRequired(request(), at("2026-01-14T21:00:00-05:00")))
        assertTrue(isActionRequired(request(), at("2026-01-15T01:00:00-05:00")))
    }

    /** Someone is handling it, so the banner must stop nagging them while they call Allied. */
    @Test
    fun acknowledgedIsNotActionRequired() {
        assertFalse(
            isActionRequired(
                request(acknowledgedAt = at("2026-01-14T21:05:00-05:00")),
                at("2026-01-14T21:10:00-05:00"),
            ),
        )
    }

    // ----- Missed-coverage incidents. -----

    @Test
    fun deskUnstaffedCloseIsAnIncident() {
        assertTrue(
            isMissedCoverageIncident(
                request(
                    acknowledgedAt = at("2026-01-14T21:05:00-05:00"),
                    closedAt = at("2026-01-15T00:05:00-05:00"),
                    outcome = CoverageOutcome.DESK_UNSTAFFED,
                ),
                at("2026-01-15T02:00:00-05:00"),
            ),
        )
    }

    @Test
    fun alliedSecuredCloseIsNotAnIncident() {
        assertFalse(
            isMissedCoverageIncident(
                request(
                    acknowledgedAt = at("2026-01-14T21:05:00-05:00"),
                    closedAt = at("2026-01-14T21:20:00-05:00"),
                    outcome = CoverageOutcome.ALLIED_SECURED,
                ),
                at("2026-01-15T02:00:00-05:00"),
            ),
        )
    }

    @Test
    fun overdueAndNeverClosedIsAnIncident() {
        assertTrue(isMissedCoverageIncident(request(), at("2026-01-15T01:00:00-05:00")))
    }

    // ----- The rung countdown. -----

    @Test
    fun rungDeadlineIsFiredAtPlusTimeout() {
        assertEquals(
            at("2026-01-14T21:00:00-05:00"),
            rungDeadline(request(rungFiredAt = at("2026-01-14T20:00:00-05:00")), timeoutMinutes = 60),
        )
    }

    /** Acknowledging stops the ladder, so there is no next escalation to count down to. */
    @Test
    fun acknowledgedRequestHasNoRungDeadline() {
        assertNull(
            rungDeadline(request(acknowledgedAt = at("2026-01-14T20:30:00-05:00")), timeoutMinutes = 60),
        )
    }

    @Test
    fun terminalRungHasNoRungDeadline() {
        assertNull(rungDeadline(request(rung = CoverageRung.HMOD), timeoutMinutes = 60))
        assertNull(rungDeadline(request(rung = CoverageRung.ADMIN), timeoutMinutes = 60))
    }

    /**
     * On the terminal rung the card must say nobody is coming, rather than showing a
     * countdown to an escalation that will never happen.
     */
    @Test
    fun terminalRungSaysNoFurtherEscalation() {
        assertEquals(
            "No further escalation",
            rungCountdownLabel(
                request(rung = CoverageRung.HMOD),
                timeoutMinutes = 60,
                now = at("2026-01-14T20:30:00-05:00"),
            ),
        )
    }

    @Test
    fun countdownCountsDownAndThenSaysEscalatingNow() {
        val req = request(rungFiredAt = at("2026-01-14T20:00:00-05:00"))
        assertEquals(
            "Escalates in 45m",
            rungCountdownLabel(req, 60, at("2026-01-14T20:15:00-05:00")),
        )
        assertEquals(
            "Escalates in 1h 30m",
            rungCountdownLabel(req, 120, at("2026-01-14T20:30:00-05:00")),
        )
        assertEquals(
            "Escalating now",
            rungCountdownLabel(req, 60, at("2026-01-14T21:00:00-05:00")),
        )
    }

    @Test
    fun acknowledgedRequestShowsNoCountdown() {
        assertNull(
            rungCountdownLabel(
                request(acknowledgedAt = at("2026-01-14T20:30:00-05:00")),
                60,
                at("2026-01-14T20:40:00-05:00"),
            ),
        )
    }

    /** An unrecognised rung must never promise an escalation we cannot make. */
    @Test
    fun unknownRungResolvesToTerminal() {
        assertEquals(CoverageRung.HMOD, CoverageRung.fromWire("something_new"))
        assertEquals(CoverageRung.HMOD, CoverageRung.fromWire(null))
        assertTrue(CoverageRung.fromWire("nonsense").isTerminal)
    }

    // ----- The window label. The 30-minute-fallback regression must not return. -----

    /**
     * Migration 20260729000010's header records the live bug: a dropped `block_end_at`
     * made every alert render as a 30-minute window. The label must use the request row's
     * own end, so a 2-hour window across midnight reads as 22:00 to 00:00.
     */
    @Test
    fun windowLabelUsesTheRequestsOwnEndAcrossMidnight() {
        assertEquals("Wed · Jan 14, 22:00 to 00:00", coverageWindowLabel(request()))
    }

    @Test
    fun windowHoursMeasuresTheWholeStretch() {
        assertEquals(2.0, coverageWindowHours(request()), 0.001)
        assertEquals(
            4.0,
            coverageWindowHours(
                request(
                    start = at("2026-01-14T20:00:00-05:00"),
                    end = at("2026-01-15T00:00:00-05:00"),
                ),
            ),
            0.001,
        )
    }

    // ----- Ordering: overdue first, then soonest window. -----

    @Test
    fun feedPutsOverdueFirstThenSoonestWindow() {
        val now = at("2026-01-15T01:00:00-05:00")
        val overdue = request(requestId = "overdue", start = windowStart, end = windowEnd)
        val soon =
            request(
                requestId = "soon",
                start = at("2026-01-15T02:00:00-05:00"),
                end = at("2026-01-15T04:00:00-05:00"),
            )
        val later =
            request(
                requestId = "later",
                start = at("2026-01-15T08:00:00-05:00"),
                end = at("2026-01-15T10:00:00-05:00"),
            )
        val feed = buildCoverageFeed(listOf(later, soon, overdue), 60, now)
        assertEquals(listOf("overdue", "soon", "later"), feed.cards.map { it.requestId })
    }

    @Test
    fun mostOverdueSortsAboveLessOverdue() {
        val now = at("2026-01-15T06:00:00-05:00")
        val veryOverdue =
            request(
                requestId = "very",
                start = at("2026-01-14T18:00:00-05:00"),
                end = at("2026-01-14T20:00:00-05:00"),
            )
        val slightlyOverdue = request(requestId = "slightly", start = windowStart, end = windowEnd)
        val feed = buildCoverageFeed(listOf(slightlyOverdue, veryOverdue), 60, now)
        assertEquals(listOf("very", "slightly"), feed.cards.map { it.requestId })
    }

    /** Closed requests leave the mobile list entirely; the incident report lives on web. */
    @Test
    fun feedDropsClosedRequests() {
        val now = at("2026-01-14T21:30:00-05:00")
        val closed =
            request(
                requestId = "closed",
                acknowledgedAt = at("2026-01-14T21:00:00-05:00"),
                closedAt = at("2026-01-14T21:10:00-05:00"),
                outcome = CoverageOutcome.ALLIED_SECURED,
            )
        val feed = buildCoverageFeed(listOf(closed, request(requestId = "open")), 60, now)
        assertEquals(listOf("open"), feed.cards.map { it.requestId })
        assertEquals(1, feed.openCount)
    }

    // ----- Counts drive the banner and the badge. -----

    @Test
    fun bannerShowsOnlyWhileSomethingIsUnacknowledged() {
        val now = at("2026-01-14T21:30:00-05:00")
        val unacked = buildCoverageFeed(listOf(request()), 60, now)
        assertTrue(unacked.showsBanner)
        assertEquals(1, unacked.actionRequiredCount)

        val acked =
            buildCoverageFeed(
                listOf(request(acknowledgedAt = at("2026-01-14T21:00:00-05:00"))),
                60,
                now,
            )
        assertFalse(acked.showsBanner)
        assertEquals(0, acked.actionRequiredCount)
        // Still OPEN though: somebody has to record an outcome.
        assertEquals(1, acked.openCount)
    }

    @Test
    fun emptyFeedShowsNoBanner() {
        val feed = buildCoverageFeed(emptyList(), 60, at("2026-01-14T21:00:00-05:00"))
        assertTrue(feed.isEmpty)
        assertFalse(feed.showsBanner)
    }

    // ----- Close-note requirement mirrors the RPC guard. -----

    @Test
    fun onlyDeskUnstaffedRequiresANote() {
        assertTrue(requiresCloseNote(CoverageOutcome.DESK_UNSTAFFED))
        assertFalse(requiresCloseNote(CoverageOutcome.ALLIED_SECURED))
        assertFalse(requiresCloseNote(CoverageOutcome.COVERED_INTERNALLY))
        assertFalse(requiresCloseNote(CoverageOutcome.NO_LONGER_NEEDED))
    }

    // ----- Labels. Surfaced copy, so no em/en dashes anywhere. -----

    @Test
    fun labelsMatchTheWebVocabulary() {
        assertEquals("Residential Services Manager", rungLabel(CoverageRung.RSM))
        assertEquals("Housing Manager", rungLabel(CoverageRung.HM))
        assertEquals("Housing Manager on duty", rungLabel(CoverageRung.HMOD))
        assertEquals("Project administrator", rungLabel(CoverageRung.ADMIN))
        assertEquals("Allied secured", outcomeLabel(CoverageOutcome.ALLIED_SECURED))
        assertEquals("Desk went unstaffed", outcomeLabel(CoverageOutcome.DESK_UNSTAFFED))
    }

    @Test
    fun everySurfacedLabelAvoidsDashes() {
        val copy =
            CoverageRung.entries.map { rungLabel(it) } +
                CoverageOutcome.entries.map { outcomeLabel(it) } +
                CoverageOutcome.entries.map { it.wire } +
                listOf(
                    coverageReasonLabel("escalation_chain"),
                    coverageReasonLabel("float_no_acknowledgment"),
                    coverageReasonLabel("no_floater_found"),
                    coverageReasonLabel("floater_declined"),
                )
        copy.forEach {
            assertFalse(it.contains('—'), "em dash in surfaced copy: $it")
            assertFalse(it.contains('–'), "en dash in surfaced copy: $it")
        }
    }

    @Test
    fun unknownReasonDegradesToReadableText() {
        assertEquals("some new reason", coverageReasonLabel("some_new_reason"))
    }

    @Test
    fun cardCarriesTheFormattedFields() {
        val card = request().toCard(timeoutMinutes = 60, now = at("2026-01-14T20:15:00-05:00"))
        assertEquals("2h", card.hoursLabel)
        assertEquals("Wed · Jan 14, 22:00 to 00:00", card.windowLabel)
        assertEquals("The desk will be empty and no one picked up the shift.", card.reasonLabel)
        assertEquals("Residential Services Manager", card.rungLabel)
        assertEquals("Escalates in 45m", card.countdownLabel)
        assertFalse(card.isTerminalRung)
        assertTrue(card.isActionRequired)
        assertNull(card.outcomeLabel)
    }
}
