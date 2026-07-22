package com.pennhousing.shift.shared.manager

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class AssignWorkerTest {
    @Test
    fun assignedResultReportsCount() {
        val body = """{"ok":true,"result":{"needs_confirm":false,"assigned_count":8,"scope":"this_week","advisories":[]}}"""
        assertEquals(AssignOutcome.Assigned(8), parseAssignOutcome(ok = true, body = body))
    }

    @Test
    fun needsConfirmSurfacesDistinctAdvisories() {
        val body =
            """{"ok":true,"result":{"needs_confirm":true,"advisories":[{"kind":"soft_cap"},{"kind":"over_target"},{"kind":"soft_cap"}]}}"""
        val outcome = parseAssignOutcome(ok = true, body = body)
        assertTrue(outcome is AssignOutcome.NeedsConfirm)
        assertEquals(
            listOf(AssignAdvisory.SOFT_CAP, AssignAdvisory.OVER_TARGET),
            (outcome as AssignOutcome.NeedsConfirm).advisories,
        )
    }

    @Test
    fun unknownAdvisoryKindDoesNotCrash() {
        val body = """{"ok":true,"result":{"needs_confirm":true,"advisories":[{"kind":"future_kind"}]}}"""
        val outcome = parseAssignOutcome(ok = true, body = body)
        assertEquals(listOf(AssignAdvisory.UNKNOWN), (outcome as AssignOutcome.NeedsConfirm).advisories)
    }

    @Test
    fun rejectionCarriesReasonAndFriendlyMessage() {
        val body = """{"error":"assign_rejected","reason":"not_authorized"}"""
        val outcome = parseAssignOutcome(ok = false, body = body)
        assertTrue(outcome is AssignOutcome.Rejected)
        assertEquals("not_authorized", (outcome as AssignOutcome.Rejected).reason)
        assertEquals("You can only manage your own house.", outcome.message)
    }

    @Test
    fun rejectionWithoutReasonIsFailed() {
        assertEquals(AssignOutcome.Failed, parseAssignOutcome(ok = false, body = "Internal Server Error"))
    }

    @Test
    fun unparseableSuccessBodyIsFailed() {
        assertEquals(AssignOutcome.Failed, parseAssignOutcome(ok = true, body = "not json"))
    }

    @Test
    fun missingResultEnvelopeIsFailed() {
        assertEquals(AssignOutcome.Failed, parseAssignOutcome(ok = true, body = """{"ok":true}"""))
    }

    @Test
    fun advisoryMessagesHaveNoDashes() {
        AssignAdvisory.entries.forEach { advisory ->
            assertTrue(
                advisory.message.none { it == '—' || it == '–' },
                "advisory ${advisory.name} message must not contain em or en dashes",
            )
        }
    }
}
