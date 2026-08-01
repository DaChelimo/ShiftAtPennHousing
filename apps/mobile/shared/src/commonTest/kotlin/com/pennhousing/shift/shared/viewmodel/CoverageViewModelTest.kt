package com.pennhousing.shift.shared.viewmodel

import com.pennhousing.shift.shared.manager.coverage.CoverageOutcome
import com.pennhousing.shift.shared.manager.coverage.CoverageRequest
import com.pennhousing.shift.shared.manager.coverage.CoverageRequestState
import com.pennhousing.shift.shared.manager.coverage.CoverageRung
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Instant

/**
 * The Respond flow (docs/manager-app/SPEC.md §6.1) — the merged acknowledge-and-close
 * sheet.
 *
 * The behaviour worth protecting here is the merge itself: the manager experiences ONE
 * job, but the two states stay distinct. Opening the sheet must acknowledge (so the ladder
 * stops the instant a human looks at it) while leaving the request OPEN until an outcome is
 * recorded. Several of these cases exist because the obvious "simplification" in either
 * direction loses something real: acknowledge-on-submit lets the ladder keep escalating
 * while the manager is already on the phone, and close-on-open records an outcome nobody
 * knows yet.
 *
 * Anchor: now is Wed 2026-01-14 21:00 ET, inside a 22:00 to 00:00 coverage window.
 */
class CoverageViewModelTest {
    private fun at(iso: String): Instant = Instant.parse(iso)

    private val now = at("2026-01-14T21:00:00-05:00")

    private fun request(
        requestId: String = "req-1",
        acknowledgedAt: Instant? = null,
        closedAt: Instant? = null,
        outcome: CoverageOutcome? = null,
        start: Instant = at("2026-01-14T22:00:00-05:00"),
        end: Instant = at("2026-01-15T00:00:00-05:00"),
    ) = CoverageRequest(
        requestId = requestId,
        houseId = "harnwell",
        houseName = "Harnwell",
        windowStart = start,
        windowEnd = end,
        reason = "escalation_chain",
        currentRung = CoverageRung.RSM,
        rungFiredAt = at("2026-01-14T20:30:00-05:00"),
        acknowledgedAt = acknowledgedAt,
        closedAt = closedAt,
        outcome = outcome,
        deskPhone = "215-555-0100",
    )

    private fun vm(vararg requests: CoverageRequest) = CoverageViewModel(requests.toList(), now)

    // ----- Opening the sheet IS the acknowledgement. -----

    @Test
    fun openingTheSheetAcknowledgesAndReturnsTheIdToWrite() {
        val model = vm(request())
        assertTrue(model.uiState.value.showsBanner)

        val toAck = model.openRespond("req-1")

        assertEquals("req-1", toAck, "the host must be told to write the acknowledgement")
        assertNotNull(model.uiState.value.sheet)
        // The ladder has stopped, so the banner goes away and the badge clears.
        assertFalse(model.uiState.value.showsBanner)
        assertEquals(0, model.uiState.value.badgeCount)
    }

    /** The request stays OPEN and on the list. Acknowledging is not closing. */
    @Test
    fun acknowledgingLeavesTheRequestOpenAndVisible() {
        val model = vm(request())
        model.openRespond("req-1")

        val feed = model.uiState.value.feed
        assertEquals(1, feed.openCount)
        assertEquals(listOf("req-1"), feed.cards.map { it.requestId })
        assertEquals(CoverageRequestState.ACKNOWLEDGED, feed.cards.single().state)
    }

    /**
     * A colleague already picked it up. The sheet still opens, because this manager may
     * still be the one who learns the outcome, but there is nothing to acknowledge.
     */
    @Test
    fun openingAnAlreadyAcknowledgedRequestWritesNoAcknowledgement() {
        val model = vm(request(acknowledgedAt = at("2026-01-14T20:45:00-05:00")))
        val toAck = model.openRespond("req-1")
        assertNull(toAck)
        assertNotNull(model.uiState.value.sheet)
    }

    /** An unknown id means somebody closed it out from under us. Not an error. */
    @Test
    fun openingAnUnknownRequestSaysItIsAlreadyHandled() {
        val model = vm(request())
        val toAck = model.openRespond("no-such-request")
        assertNull(toAck)
        assertNull(model.uiState.value.sheet)
        assertEquals("Someone already handled this request.", model.uiState.value.alreadyHandledMessage)
    }

    /**
     * The at-least-once delivery case: the push carried a request that has since been
     * closed on web. Tapping it must resolve to "already handled", never re-acknowledge.
     */
    @Test
    fun openingAClosedRequestSaysItIsAlreadyHandled() {
        val model =
            vm(
                request(
                    acknowledgedAt = at("2026-01-14T20:40:00-05:00"),
                    closedAt = at("2026-01-14T20:50:00-05:00"),
                    outcome = CoverageOutcome.ALLIED_SECURED,
                ),
            )
        assertNull(model.openRespond("req-1"))
        assertNull(model.uiState.value.sheet)
        assertNotNull(model.uiState.value.alreadyHandledMessage)
    }

    /** A failed acknowledge write must bring the banner back. Never silently silence a page. */
    @Test
    fun revertingAFailedAcknowledgeRestoresTheBanner() {
        val model = vm(request())
        model.openRespond("req-1")
        assertFalse(model.uiState.value.showsBanner)

        model.revertAcknowledge("req-1")

        assertTrue(model.uiState.value.showsBanner)
        assertEquals(1, model.uiState.value.badgeCount)
    }

    // ----- Recording the outcome. -----

    @Test
    fun confirmingAlliedSecuredClosesTheRequestAndLeavesTheList() {
        val model = vm(request())
        model.openRespond("req-1")
        model.selectOutcome(CoverageOutcome.ALLIED_SECURED)

        val intent = model.submitClose()

        assertNotNull(intent)
        assertEquals("req-1", intent.requestId)
        assertEquals(CoverageOutcome.ALLIED_SECURED, intent.outcome)
        assertNull(intent.note)
        assertNull(model.uiState.value.sheet)
        assertTrue(model.uiState.value.feed.isEmpty)
    }

    /** Nothing to submit until an outcome is chosen. */
    @Test
    fun submittingWithNoOutcomeChosenDoesNothing() {
        val model = vm(request())
        model.openRespond("req-1")
        assertNull(model.submitClose())
        assertNotNull(model.uiState.value.sheet, "the sheet stays open")
    }

    /**
     * `desk_unstaffed` is the incident row. An unexplained one is useless later, so the
     * button stays disabled until there is a note. The RPC enforces this too; this is the
     * fail-fast so the manager is not told "note_required" after a round trip.
     */
    @Test
    fun deskUnstaffedCannotBeSubmittedWithoutANote() {
        val model = vm(request())
        model.openRespond("req-1")
        model.selectOutcome(CoverageOutcome.DESK_UNSTAFFED)

        assertTrue(model.uiState.value.sheet!!.noteRequired)
        assertFalse(model.uiState.value.sheet!!.canSubmit)
        assertNull(model.submitClose())

        // Whitespace is not a note.
        model.updateNote("   ")
        assertFalse(model.uiState.value.sheet!!.canSubmit)

        model.updateNote("Allied had no one available.")
        assertTrue(model.uiState.value.sheet!!.canSubmit)
        val intent = model.submitClose()
        assertNotNull(intent)
        assertEquals("Allied had no one available.", intent.note)
    }

    @Test
    fun otherOutcomesNeedNoNote() {
        listOf(
            CoverageOutcome.ALLIED_SECURED,
            CoverageOutcome.COVERED_INTERNALLY,
            CoverageOutcome.NO_LONGER_NEEDED,
        ).forEach { outcome ->
            val model = vm(request())
            model.openRespond("req-1")
            model.selectOutcome(outcome)
            assertFalse(model.uiState.value.sheet!!.noteRequired, "$outcome should not need a note")
            assertTrue(model.uiState.value.sheet!!.canSubmit, "$outcome should be submittable")
        }
    }

    @Test
    fun revertingAFailedCloseRestoresTheRequestExactly() {
        val model = vm(request())
        model.openRespond("req-1")
        model.selectOutcome(CoverageOutcome.ALLIED_SECURED)
        val intent = model.submitClose()!!
        assertTrue(model.uiState.value.feed.isEmpty)

        model.revertClose(intent)

        val feed = model.uiState.value.feed
        assertEquals(1, feed.openCount)
        // Back to ACKNOWLEDGED, not to unacknowledged. The acknowledgement was its own
        // write and it succeeded; only the close failed. So the request returns to the list
        // still demanding an outcome, and the banner stays off because a human is on it.
        // Reverting to unacknowledged here would re-page a manager who is already calling
        // Allied.
        assertEquals(CoverageRequestState.ACKNOWLEDGED, feed.cards.single().state)
        assertFalse(feed.showsBanner)
    }

    /**
     * The other rollback order: the acknowledge write failed, and then the close failed
     * too. Reverting both must leave the request fully unhandled, banner and all, because
     * nothing landed server-side.
     */
    @Test
    fun revertingBothWritesLeavesTheRequestFullyUnhandled() {
        val model = vm(request())
        model.openRespond("req-1")
        model.selectOutcome(CoverageOutcome.ALLIED_SECURED)
        val intent = model.submitClose()!!

        model.revertClose(intent)
        model.revertAcknowledge("req-1")

        val feed = model.uiState.value.feed
        assertEquals(CoverageRequestState.AWAITING_ACK, feed.cards.single().state)
        assertTrue(feed.showsBanner)
    }

    // ----- "Not yet" keeps the request open. -----

    @Test
    fun dismissingWithoutAnOutcomeKeepsTheRequestOpen() {
        val model = vm(request())
        model.openRespond("req-1")
        model.dismissSheet()

        assertNull(model.uiState.value.sheet)
        val feed = model.uiState.value.feed
        assertEquals(1, feed.openCount)
        assertEquals(CoverageRequestState.ACKNOWLEDGED, feed.cards.single().state)
        // Acknowledged, so no banner, but it is still there demanding an outcome.
        assertFalse(feed.showsBanner)
    }

    // ----- Refresh from Realtime. -----

    @Test
    fun refreshReplacesTheSnapshot() {
        val model = vm(request())
        model.refresh(listOf(request(), request(requestId = "req-2")))
        assertEquals(2, model.uiState.value.feed.openCount)
        assertEquals(2, model.uiState.value.badgeCount)
    }

    /**
     * The open sheet's request was closed elsewhere while the manager was looking at it.
     * The sheet must close rather than let them record an outcome on somebody else's
     * resolved request.
     */
    @Test
    fun refreshClosesAnOpenSheetWhoseRequestWasResolvedElsewhere() {
        val model = vm(request())
        model.openRespond("req-1")
        assertNotNull(model.uiState.value.sheet)

        model.refresh(
            listOf(
                request(
                    acknowledgedAt = at("2026-01-14T20:40:00-05:00"),
                    closedAt = at("2026-01-14T21:05:00-05:00"),
                    outcome = CoverageOutcome.COVERED_INTERNALLY,
                ),
            ),
        )

        assertNull(model.uiState.value.sheet)
        assertNotNull(model.uiState.value.alreadyHandledMessage)
        assertTrue(model.uiState.value.feed.isEmpty)
    }

    @Test
    fun refreshKeepsAnOpenSheetWhoseRequestStillExists() {
        val model = vm(request())
        model.openRespond("req-1")
        model.refresh(listOf(request(acknowledgedAt = now), request(requestId = "req-2")))

        assertNotNull(model.uiState.value.sheet)
        assertEquals("req-1", model.uiState.value.sheet!!.card.requestId)
    }

    @Test
    fun clearingTheAlreadyHandledMessageDismissesIt() {
        val model = vm(request())
        model.openRespond("missing")
        assertNotNull(model.uiState.value.alreadyHandledMessage)
        model.clearAlreadyHandled()
        assertNull(model.uiState.value.alreadyHandledMessage)
    }

    // ----- The badge counts what needs a human, overdue included. -----

    @Test
    fun overdueRequestsStillCountTowardTheBadge() {
        val model =
            CoverageViewModel(
                listOf(
                    request(
                        requestId = "overdue",
                        start = at("2026-01-14T18:00:00-05:00"),
                        end = at("2026-01-14T20:00:00-05:00"),
                    ),
                ),
                now,
            )
        assertEquals(1, model.uiState.value.badgeCount)
        assertEquals(CoverageRequestState.OVERDUE, model.uiState.value.feed.cards.single().state)
    }

    /**
     * An acknowledged request that has since gone overdue is action-required AGAIN: nobody
     * recorded what happened and the window is gone.
     */
    @Test
    fun acknowledgedThenOverdueBecomesActionRequiredAgain() {
        val model =
            CoverageViewModel(
                listOf(
                    request(
                        acknowledgedAt = at("2026-01-14T19:00:00-05:00"),
                        start = at("2026-01-14T18:00:00-05:00"),
                        end = at("2026-01-14T20:00:00-05:00"),
                    ),
                ),
                now,
            )
        assertEquals(1, model.uiState.value.badgeCount)
        assertTrue(model.uiState.value.showsBanner)
    }

    @Test
    fun deskPhoneReachesTheSheetSoTheCallActionCanDial() {
        val model = vm(request())
        model.openRespond("req-1")
        assertEquals("215-555-0100", model.uiState.value.sheet!!.card.deskPhone)
    }
}
