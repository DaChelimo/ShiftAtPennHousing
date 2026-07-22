package com.pennhousing.shift.shared.manager

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/*
 * Force-trigger a float lookup (BSpec §6.6) — the PURE classifier behind the
 * House-grid "get coverage now" action on a vacant run. An SM/HM/BM/RSM asks the
 * system to run the float lookup immediately for a known gap, ahead of the standard
 * escalation timing. The repository POSTs the vacant run's seat ids to the existing
 * `force-trigger` Edge Function (identity from the token, own-house enforced
 * server-side); this layer classifies the response for a toast.
 */
sealed interface ForceTriggerOutcome {
    /** The lookup ran. [floatCount] floats were assigned; the rest routed to Allied. */
    data class Triggered(val floatCount: Int) : ForceTriggerOutcome

    /** The server refused (e.g. the block is not vacant, or it is within two hours). */
    data class Rejected(val reason: String, val message: String) : ForceTriggerOutcome

    /** Network error or an unparseable response. */
    data object Failed : ForceTriggerOutcome
}

/** House-style copy for a force-trigger rejection `reason` (no em or en dashes). */
private fun rejectionMessage(reason: String): String =
    when (reason) {
        "unauthorized_initiator" -> "You can only force coverage for your own house."
        "block_not_vacant" -> "That seat is already covered."
        "block_has_pending_float_in" -> "A floater is already on the way for that seat."
        "within_two_hours" -> "That shift is within two hours and can no longer be force covered."
        "empty_block_set" -> "Select an open seat first."
        else -> "Coverage could not be started. Refresh and try again."
    }

/**
 * Classify the `force-trigger` Edge Function response. [ok] is the HTTP 2xx flag; [body]
 * is the raw JSON. Success envelope: `{ ok: true, floatAssignmentIds: [...] }`.
 * Rejection: `{ error: "force_trigger_rejected", reason: "<reason>" }`. Pure and total.
 */
fun parseForceTriggerOutcome(
    ok: Boolean,
    body: String,
    json: Json = Json { ignoreUnknownKeys = true },
): ForceTriggerOutcome {
    if (!ok) {
        val reason =
            runCatching {
                json.parseToJsonElement(body).jsonObject["reason"]?.jsonPrimitive?.content
            }.getOrNull()
        return if (reason != null) {
            ForceTriggerOutcome.Rejected(reason, rejectionMessage(reason))
        } else {
            ForceTriggerOutcome.Failed
        }
    }
    return runCatching {
        val obj = json.parseToJsonElement(body).jsonObject
        val count = obj["floatAssignmentIds"]?.jsonArray?.size ?: 0
        ForceTriggerOutcome.Triggered(count)
    }.getOrDefault(ForceTriggerOutcome.Failed)
}
