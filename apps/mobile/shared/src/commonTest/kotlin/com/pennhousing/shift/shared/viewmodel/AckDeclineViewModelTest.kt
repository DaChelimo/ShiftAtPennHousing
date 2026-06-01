package com.pennhousing.shift.shared.viewmodel

import com.pennhousing.shift.shared.ack.ACK_DEADLINE_LEAD_MINUTES
import com.pennhousing.shift.shared.ack.AckPhase
import com.pennhousing.shift.shared.ack.ackDeadline
import com.pennhousing.shift.shared.ack.canRespondToFloat
import com.pennhousing.shift.shared.ack.isPastAckDeadline
import com.pennhousing.shift.shared.model.FloatAck
import com.pennhousing.shift.shared.model.House
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.time.Instant

/**
 * Phase 13a — Float ack/decline modal ViewModel (shared, commonMain) — TDD-RED.
 *
 * Pins the acknowledgment-deadline logic of the float ack/decline modal
 * (BEHAVIORAL_SPECIFICATION.md §7.1/§7.2). The deadline is T-10m before the float
 * start (the same constant phase-12's notification cadence uses,
 * ACK_DEADLINE_LEAD_MINUTES = 10); the worker may acknowledge or decline only
 * strictly before it.
 *
 * Production symbols are defined by the phase-13a contract (tests/PHASE_13a/
 * TEST_PLAN.md) and do not exist yet — TDD-red until the worker-mobile shared
 * logic lands. `now` is injected, never read from a system clock, so the deadline
 * boundary is deterministic (the project's no-Date.now() rule).
 */
class AckDeclineViewModelTest {
    private fun at(iso: String): Instant = Instant.parse(iso)

    private val quad = House("quad", "Quad")
    private val floatStart = at("2026-01-15T18:00:00-05:00")
    private val deadline = at("2026-01-15T17:50:00-05:00") // floatStart − 10m
    private val float = FloatAck(floatId = "f1", destinationHouse = quad, floatStart = floatStart)

    private fun vm(now: Instant) = AckDeclineViewModel(float = float, now = now)

    // ----- Pure deadline math (§7.1). -----

    @Test
    fun ackDeadlineIs10MinutesBeforeFloatStart() {
        assertEquals(deadline, ackDeadline(floatStart))
    }

    @Test
    fun ackDeadlineLeadIs10Minutes() {
        assertEquals(10, ACK_DEADLINE_LEAD_MINUTES)
    }

    @Test
    fun canRespondOnlyStrictlyBeforeTheDeadline() {
        assertTrue(canRespondToFloat(floatStart, at("2026-01-15T17:49:00-05:00"))) // before
        assertFalse(canRespondToFloat(floatStart, deadline)) // exactly at deadline
        assertFalse(canRespondToFloat(floatStart, at("2026-01-15T17:51:00-05:00"))) // after
    }

    @Test
    fun isPastDeadlineIsInclusiveOfTheDeadlineInstant() {
        assertFalse(isPastAckDeadline(floatStart, at("2026-01-15T17:49:59-05:00")))
        assertTrue(isPastAckDeadline(floatStart, deadline))
    }

    // ----- Modal state (§7.1/§7.2). -----

    @Test
    fun floatNotificationSurfacesAPendingModal() {
        // §7: float assigned → immediate notification → ack/decline modal appears.
        val s = vm(now = at("2026-01-15T12:00:00-05:00")).uiState.value
        assertEquals(AckPhase.PENDING, s.phase)
        assertTrue(s.modalVisible)
        assertTrue(s.canRespond)
        assertEquals(deadline, s.deadline)
        assertEquals("Quad", s.destinationHouse.name)
        assertEquals(floatStart, s.floatStart)
    }

    @Test
    fun acknowledgingBeforeTheDeadlineReachesTheSuccessState() {
        val m = vm(now = at("2026-01-15T12:00:00-05:00"))
        val ok = m.acknowledge(now = at("2026-01-15T12:01:00-05:00"))
        assertTrue(ok)
        val s = m.uiState.value
        assertEquals(AckPhase.ACKNOWLEDGED, s.phase)
        assertFalse(s.canRespond) // terminal — no further response
    }

    @Test
    fun decliningBeforeTheDeadlineVoidsTheFloat() {
        // §7.2: declining is a distinct action that immediately voids the float.
        val m = vm(now = at("2026-01-15T12:00:00-05:00"))
        val ok = m.decline(now = at("2026-01-15T12:05:00-05:00"))
        assertTrue(ok)
        val s = m.uiState.value
        assertEquals(AckPhase.DECLINED, s.phase)
        assertFalse(s.canRespond)
    }

    @Test
    fun aPendingFloatLoadedAfterTheDeadlineShowsDeadlinePassedAndIsDisabled() {
        // §7.1: after the deadline the modal is disabled, "deadline passed".
        val s = vm(now = at("2026-01-15T17:55:00-05:00")).uiState.value
        assertEquals(AckPhase.DEADLINE_PASSED, s.phase)
        assertFalse(s.canRespond)
        assertTrue(s.modalVisible) // still shown, just disabled
    }

    @Test
    fun refreshFlipsAPendingModalToDeadlinePassedAtTheDeadline() {
        val m = vm(now = at("2026-01-15T17:00:00-05:00"))
        assertEquals(AckPhase.PENDING, m.uiState.value.phase)
        m.refresh(now = deadline)
        assertEquals(AckPhase.DEADLINE_PASSED, m.uiState.value.phase)
        assertFalse(m.uiState.value.canRespond)
    }

    @Test
    fun acknowledgeIsRejectedAtOrAfterTheDeadline() {
        val m = vm(now = at("2026-01-15T17:00:00-05:00"))
        val ok = m.acknowledge(now = at("2026-01-15T17:51:00-05:00"))
        assertFalse(ok)
        assertEquals(AckPhase.DEADLINE_PASSED, m.uiState.value.phase)
    }

    @Test
    fun declineIsRejectedAfterTheDeadline() {
        val m = vm(now = at("2026-01-15T17:00:00-05:00"))
        val ok = m.decline(now = at("2026-01-15T18:00:00-05:00"))
        assertFalse(ok)
        assertEquals(AckPhase.DEADLINE_PASSED, m.uiState.value.phase)
    }

    @Test
    fun acknowledgeIsIdempotentOnceTerminal() {
        val m = vm(now = at("2026-01-15T12:00:00-05:00"))
        assertTrue(m.acknowledge(now = at("2026-01-15T12:01:00-05:00")))
        assertFalse(m.acknowledge(now = at("2026-01-15T12:02:00-05:00"))) // already acknowledged
        assertEquals(AckPhase.ACKNOWLEDGED, m.uiState.value.phase)
    }

    @Test
    fun anAcknowledgedFloatStaysAcknowledgedEvenAfterTheDeadlinePasses() {
        // A terminal success must not silently degrade to "deadline passed".
        val m = vm(now = at("2026-01-15T12:00:00-05:00"))
        m.acknowledge(now = at("2026-01-15T12:01:00-05:00"))
        m.refresh(now = at("2026-01-15T19:00:00-05:00")) // long past the deadline
        assertEquals(AckPhase.ACKNOWLEDGED, m.uiState.value.phase)
    }

    @Test
    fun acknowledgeSucceedsOneSecondBeforeTheDeadline() {
        val m = vm(now = at("2026-01-15T17:49:00-05:00"))
        assertTrue(m.uiState.value.canRespond)
        assertTrue(m.acknowledge(now = at("2026-01-15T17:49:59-05:00")))
        assertEquals(AckPhase.ACKNOWLEDGED, m.uiState.value.phase)
    }

    @Test
    fun acknowledgeFailsExactlyAtTheDeadline() {
        val m = vm(now = deadline)
        assertFalse(m.uiState.value.canRespond)
        assertFalse(m.acknowledge(now = deadline))
        assertEquals(AckPhase.DEADLINE_PASSED, m.uiState.value.phase)
    }
}
