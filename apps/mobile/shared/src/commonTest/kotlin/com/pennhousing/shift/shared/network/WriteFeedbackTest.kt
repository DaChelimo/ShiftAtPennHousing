package com.pennhousing.shift.shared.network

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class WriteFeedbackTest {
    // ----- parseServerErrorCode -----

    @Test
    fun parsesErrorField() {
        assertEquals("time_conflict", parseServerErrorCode("""{"error":"time_conflict"}"""))
    }

    @Test
    fun parsesReasonField() {
        assertEquals("not_pending", parseServerErrorCode("""{"voided":false,"reason":"not_pending"}"""))
    }

    @Test
    fun parsesFirstTokenOfRawExceptionMessage() {
        assertEquals("hard_cap_exceeded", parseServerErrorCode("""{"error":"hard_cap_exceeded weekly limit reached"}"""))
    }

    @Test
    fun returnsNullForBlankOrUnparseableBody() {
        assertEquals(null, parseServerErrorCode(""))
        assertEquals(null, parseServerErrorCode("not json"))
        assertEquals(null, parseServerErrorCode("{}"))
    }

    // ----- edgeErrorMessage classification -----

    @Test
    fun transportFailureReadsAsOffline() {
        assertEquals(OFFLINE_WRITE_MESSAGE, edgeErrorMessage(WriteOp.CLAIM, EdgeResult(false, 0, "")))
    }

    @Test
    fun unrecoverable401ReadsAsSessionExpired() {
        assertEquals(SESSION_EXPIRED_MESSAGE, edgeErrorMessage(WriteOp.DROP, EdgeResult(false, 401, "")))
    }

    @Test
    fun overlapErrorIsDescriptive() {
        val msg = edgeErrorMessage(WriteOp.CLAIM, EdgeResult(false, 409, """{"error":"time_conflict"}"""))
        assertEquals("This overlaps a shift you already have.", msg)
    }

    @Test
    fun fcfsLossIsDescriptive() {
        val msg = edgeErrorMessage(WriteOp.CLAIM, EdgeResult(false, 409, """{"error":"shift_unavailable"}"""))
        assertTrue(msg.contains("Someone else"))
    }

    @Test
    fun notPendingIsContextual() {
        val float = edgeErrorMessage(WriteOp.ACK_FLOAT, EdgeResult(false, 200, """{"acknowledged":false,"reason":"not_pending"}"""))
        val swap = edgeErrorMessage(WriteOp.ACCEPT_SWAP, EdgeResult(false, 200, """{"accepted":false,"reason":"not_pending"}"""))
        assertTrue(float.contains("float"))
        assertTrue(swap.contains("swap"))
    }

    @Test
    fun dropPastBlockIsDescriptive() {
        val msg = edgeErrorMessage(WriteOp.DROP, EdgeResult(false, 400, """{"error":"drop_past_block"}"""))
        assertEquals("This shift has already started, so it can't be dropped.", msg)
    }

    @Test
    fun unknownCodeFallsBackToOperationVerb() {
        val msg = edgeErrorMessage(WriteOp.DROP, EdgeResult(false, 400, """{"error":"some_new_code"}"""))
        assertTrue(msg.contains("drop this shift"))
        // Never the old generic network blame.
        assertFalse(msg.contains("reach the server"))
    }

    // ----- claimToast: full / partial / none -----

    @Test
    fun fullClaimShowsSuccessMessage() {
        val toast = claimToast(WriteOp.CLAIM, ClaimOutcome(claimed = 4, failed = 0, firstFailure = null), "Claimed")
        assertEquals("Claimed", toast.message)
        assertFalse(toast.isError)
    }

    @Test
    fun partialClaimIsInformativeNotError() {
        val outcome = ClaimOutcome(claimed = 6, failed = 6, firstFailure = EdgeResult(false, 409, """{"error":"time_conflict"}"""))
        val toast = claimToast(WriteOp.CLAIM, outcome, "Claimed")
        assertFalse(toast.isError)
        assertTrue(toast.message.contains("part of this shift"))
        assertTrue(toast.message.contains("overlaps"))
    }

    @Test
    fun noBlocksClaimedIsClassifiedError() {
        val outcome = ClaimOutcome(claimed = 0, failed = 3, firstFailure = EdgeResult(false, 409, """{"error":"shift_unavailable"}"""))
        val toast = claimToast(WriteOp.CLAIM, outcome, "Claimed")
        assertTrue(toast.isError)
        assertTrue(toast.message.contains("Someone else"))
    }

    @Test
    fun claimOutcomeFlags() {
        assertTrue(ClaimOutcome(2, 0, null).ok)
        assertTrue(ClaimOutcome(1, 1, null).partial)
        assertTrue(ClaimOutcome(0, 2, null).none)
    }
}
