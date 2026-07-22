package com.pennhousing.shift.shared.network

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * User-facing classification of best-effort write outcomes (the worker app's toasts).
 *
 * Every privileged write POSTs through [EdgeFunctionClient] and gets back an [EdgeResult]
 * (`ok` / `status` / `body`). Before this module the hosts collapsed every non-2xx into a
 * single generic "Couldn't reach the server" toast — so a worker who claimed a range that
 * partly overlapped an existing shift saw a red FAILURE even though the server happily took
 * the non-overlapping part (the reported bug). This turns the server's machine error codes
 * into descriptive, human messages classified per [WriteOp], and models partial claims as a
 * non-error informative toast.
 *
 * This is PURE logic (no Supabase / Ktor / clock), so it is part of the tested commonMain
 * surface — unlike the data/HTTP layer it feeds. The hosts (Android `MainActivity`, iOS
 * `ContentView`) call [edgeErrorMessage] / [claimToast] instead of hardcoding copy.
 */
enum class WriteOp {
    CLAIM,
    RECLAIM,
    DROP,
    PERMANENT_DROP,
    PERMANENT_PICKUP,
    BREAK_CLAIM,
    BREAK_DROP,
    ACK_FLOAT,
    DECLINE_FLOAT,
    PROPOSE_SWAP,
    ACCEPT_SWAP,
    DECLINE_SWAP,
    CANCEL_SWAP,
    PREFERENCES,
    BROADCAST,
}

/** How long a transient toast stays on screen (ms). Single source of truth for both platforms. */
const val TOAST_DURATION_MS: Long = 5000

/** Shown when the write never reached the server (offline / Edge runtime down): status 0. */
const val OFFLINE_WRITE_MESSAGE: String =
    "Couldn't reach the server, so your change wasn't saved. The service may be down, or you may be offline. Please try again."

/** Shown on a 401 the retry couldn't recover (the worker's session is gone). */
const val SESSION_EXPIRED_MESSAGE: String =
    "Your session expired. Please sign in again."

private val errorJson = Json { ignoreUnknownKeys = true }

/**
 * Whether an `accept-swap` call actually applied. That EF returns HTTP 200 even on a
 * logical no-op (`{ "accepted": false, "reason": "not_pending" }`), so `EdgeResult.ok`
 * (2xx) alone would mis-read a stale/invalidated swap as accepted. Defaults to true when
 * the field is absent so a normal success body (no `accepted` key) still reads as applied.
 */
fun swapAccepted(body: String): Boolean {
    val accepted =
        runCatching {
            errorJson.decodeFromString<JsonObject>(body)["accepted"]?.jsonPrimitive?.content
        }.getOrNull()
    return accepted != "false"
}

/**
 * The server's machine error code from a failed EF/RPC body, or null when absent.
 * Edge Functions return `{ "error": "<code>" }`; the swap accept/reject/void paths return
 * `{ "<verb>": false, "reason": "<code>" }`. A raw Postgres exception surfaces as
 * "<code> some detail words" — keep the first whitespace-delimited token (matching the
 * Edge Functions' own `message.split(/\s+/)[0]` extraction).
 */
internal fun parseServerErrorCode(body: String): String? {
    if (body.isBlank()) return null
    val raw =
        runCatching {
            val obj = errorJson.decodeFromString<JsonObject>(body)
            (obj["error"] ?: obj["reason"] ?: obj["message"])?.jsonPrimitive?.content
        }.getOrNull() ?: return null
    return raw.trim().split(Regex("\\s+")).firstOrNull()?.takeIf { it.isNotBlank() }
}

/**
 * A descriptive, classified message for a FAILED best-effort write — never the old generic
 * "Couldn't reach the server". A transport failure (status 0) reads as offline; a 401 the
 * retry couldn't fix reads as session-expired; otherwise the server's error code is mapped
 * to friendly copy, with a per-[op] fallback for codes we don't recognise.
 */
fun edgeErrorMessage(
    op: WriteOp,
    result: EdgeResult,
): String {
    if (result.status == 0) return OFFLINE_WRITE_MESSAGE
    if (result.status == 401) return SESSION_EXPIRED_MESSAGE
    val code = parseServerErrorCode(result.body)
    return code?.let { messageForCode(op, it) } ?: fallbackMessage(op)
}

/** Friendly copy for a known server error code in the context of [op], or null if unknown. */
private fun messageForCode(
    op: WriteOp,
    code: String,
): String? =
    when (code) {
        // ----- Coverage / claim conflicts (claim-shift, break-claim) -----
        "shift_unavailable" -> "Someone else picked up this shift first."
        "time_conflict" -> "This overlaps a shift you already have."
        "past_t2h_cutoff" -> "This shift locks 2 hours before it starts, so it can no longer be picked up."
        "hard_cap_exceeded" -> "This would put you over your weekly hours limit."
        "cross_house_ineligible", "harnwell_training_required" ->
            "You're not trained to staff this house's desk."
        "user_inactive" -> "Your account isn't active. Contact your manager."
        "break_claim_window_closed" -> "The break sign-up window isn't open right now."
        // ----- Drop (drop-shift) -----
        "empty_drop" -> "Select a shift to drop first."
        "drop_not_owned" -> "You can only drop a shift you currently hold."
        "drop_not_contiguous" -> "Pick a single continuous stretch of time to drop."
        "drop_past_block" -> "This shift has already started, so it can't be dropped."
        // ----- Permanent drop -----
        "semester_boundary_not_found" -> "That date falls outside the current semester."
        "permanent_removal_forbidden" -> "You don't have permission to drop this shift permanently."
        // ----- Swaps (create / accept / reject / void) -----
        "pending_swap_conflict" -> "One of these shifts is already part of a pending swap."
        "permanent_swap_break_profile" -> "Permanent swaps can't include break shifts."
        "assignment_not_found" -> "That shift no longer exists. It may have changed."
        "span_invalidated" -> "One of the shifts in this swap changed, so it can't be completed."
        "initiator_span_not_owned", "counterparty_span_not_owned" ->
            "One of the shifts in this swap is no longer available."
        "not_counterparty" -> "This swap isn't addressed to you."
        "swap_type_invalid", "handoff_requires_exactly_one_span" -> "That swap isn't valid."
        // ----- Context-dependent codes -----
        "not_pending" ->
            when (op) {
                WriteOp.ACK_FLOAT, WriteOp.DECLINE_FLOAT -> "This float request has already been handled."
                else -> "This swap is no longer available."
            }
        else -> null
    }

/** The action verb for [op], used in the generic-but-contextual fallback. */
private fun verb(op: WriteOp): String =
    when (op) {
        WriteOp.CLAIM -> "claim this shift"
        WriteOp.RECLAIM -> "reclaim this shift"
        WriteOp.DROP -> "drop this shift"
        WriteOp.PERMANENT_DROP -> "drop this shift permanently"
        WriteOp.PERMANENT_PICKUP -> "pick up this shift"
        WriteOp.BREAK_CLAIM -> "claim this break shift"
        WriteOp.BREAK_DROP -> "drop this break shift"
        WriteOp.ACK_FLOAT -> "acknowledge this float"
        WriteOp.DECLINE_FLOAT -> "decline this float"
        WriteOp.PROPOSE_SWAP -> "propose this swap"
        WriteOp.ACCEPT_SWAP -> "accept this swap"
        WriteOp.DECLINE_SWAP -> "decline this swap"
        WriteOp.CANCEL_SWAP -> "cancel this swap"
        WriteOp.PREFERENCES -> "save your preferences"
        WriteOp.BROADCAST -> "update your notification setting"
    }

/** Unrecognised-code fallback: still names the action, never blames the network blindly. */
private fun fallbackMessage(op: WriteOp): String =
    when (op) {
        // A swap that fails an unmapped eligibility check is most often an eligibility issue.
        WriteOp.PROPOSE_SWAP, WriteOp.ACCEPT_SWAP ->
            "Couldn't ${verb(op)}. These shifts may not be eligible to trade, so please try again."
        else -> "Couldn't ${verb(op)}. Please try again."
    }

// ---------------------------------------------------------------------------------------
// Partial-claim outcome (claim-shift is per-block; some blocks can land while others fail)
// ---------------------------------------------------------------------------------------

/**
 * The result of claiming a coalesced card block-by-block: how many landed, how many the
 * server rejected, and the first rejection (for classifying the reason). Lets the host
 * tell "all claimed" (success), "some claimed" (informative — NOT an error) and "none
 * claimed" (the real failure) apart, fixing the bug where a partial pickup that overlapped
 * an existing shift was reported as a red failure.
 */
data class ClaimOutcome(
    val claimed: Int,
    val failed: Int,
    val firstFailure: EdgeResult?,
) {
    /** Every requested block landed. */
    val ok: Boolean get() = claimed > 0 && failed == 0

    /** Some blocks landed and some were rejected — a successful pickup of part of the range. */
    val partial: Boolean get() = claimed > 0 && failed > 0

    /** Nothing landed — the only true failure case. */
    val none: Boolean get() = claimed == 0

    companion object {
        /** A claim that never reached the server (offline / nothing requested). */
        fun offline(): ClaimOutcome = ClaimOutcome(claimed = 0, failed = 1, firstFailure = EdgeResult(false, 0, ""))
    }
}

/** A toast decision: the text plus whether it reads as an error (red) or success/info. */
data class WriteToast(
    val message: String,
    val isError: Boolean,
)

/**
 * The toast for a claim/reclaim [outcome]. Full success → [successMessage]; a partial
 * pickup → an informative (non-error) message naming what couldn't be taken and why; no
 * blocks at all → the classified error.
 */
fun claimToast(
    op: WriteOp,
    outcome: ClaimOutcome,
    successMessage: String,
): WriteToast =
    when {
        outcome.ok -> WriteToast(successMessage, isError = false)
        outcome.partial -> WriteToast(claimPartialMessage(outcome), isError = false)
        else -> WriteToast(edgeErrorMessage(op, outcome.firstFailure ?: EdgeResult(false, 0, "")), isError = true)
    }

/** "Claimed part of this shift. The rest <reason>." Reads as a confirmation, not a failure. */
fun claimPartialMessage(outcome: ClaimOutcome): String =
    "Claimed part of this shift. The rest ${claimFailureClause(parseServerErrorCode(outcome.firstFailure?.body ?: ""))}"

/** The tail clause describing why the un-claimed portion of a partial pickup didn't land. */
private fun claimFailureClause(code: String?): String =
    when (code) {
        "time_conflict" -> "overlaps shifts you already have."
        "shift_unavailable" -> "was taken by someone else first."
        "hard_cap_exceeded" -> "would put you over your weekly hours limit."
        "past_t2h_cutoff" -> "locked before you could take it."
        "cross_house_ineligible", "harnwell_training_required" -> "needs training you don't have for that desk."
        else -> "couldn't be picked up."
    }
