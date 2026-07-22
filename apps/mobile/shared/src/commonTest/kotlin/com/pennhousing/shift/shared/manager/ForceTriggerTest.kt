package com.pennhousing.shift.shared.manager

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ForceTriggerTest {
    @Test
    fun triggeredCountsAssignedFloats() {
        val body =
            """{"ok":true,"floatAssignmentIds":["a","b"],"alliedNotifications":[{"blockId":"c","claimed":false}],"forcedAt":"2026-07-13T12:00:00.000Z"}"""
        assertEquals(ForceTriggerOutcome.Triggered(2), parseForceTriggerOutcome(ok = true, body = body))
    }

    @Test
    fun triggeredWithNoFloatsIsZero() {
        val body = """{"ok":true,"floatAssignmentIds":[],"alliedNotifications":[{"blockId":"c","claimed":false}]}"""
        assertEquals(ForceTriggerOutcome.Triggered(0), parseForceTriggerOutcome(ok = true, body = body))
    }

    @Test
    fun rejectionCarriesReasonAndFriendlyMessage() {
        val body = """{"error":"force_trigger_rejected","reason":"within_two_hours"}"""
        val outcome = parseForceTriggerOutcome(ok = false, body = body)
        assertTrue(outcome is ForceTriggerOutcome.Rejected)
        assertEquals("within_two_hours", (outcome as ForceTriggerOutcome.Rejected).reason)
        assertTrue(outcome.message.isNotBlank())
    }

    @Test
    fun rejectionWithoutReasonIsFailed() {
        assertEquals(ForceTriggerOutcome.Failed, parseForceTriggerOutcome(ok = false, body = "Server Error"))
    }

    @Test
    fun unparseableSuccessIsFailed() {
        assertEquals(ForceTriggerOutcome.Failed, parseForceTriggerOutcome(ok = true, body = "not json"))
    }

    @Test
    fun rejectionMessagesHaveNoDashes() {
        val reasons =
            listOf(
                "unauthorized_initiator",
                "block_not_vacant",
                "block_has_pending_float_in",
                "within_two_hours",
                "empty_block_set",
                "something_else",
            )
        reasons.forEach { reason ->
            val outcome = parseForceTriggerOutcome(ok = false, body = """{"reason":"$reason"}""")
            val message = (outcome as ForceTriggerOutcome.Rejected).message
            assertTrue(
                message.none { it == '—' || it == '–' },
                "reason $reason message must not contain em or en dashes",
            )
        }
    }
}
