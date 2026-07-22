package com.pennhousing.shift.shared.manager

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/*
 * SM/HM/BM/RSM add-a-worker override (BSpec §2.2 / §4.4) — the PURE decision surface
 * behind the House-grid "assign to an open seat" action, the mobile analogue of the
 * web builder's Phase-2 override card. No I/O: the repository POSTs to the
 * `admin-assign-worker` Edge Function and hands the raw response here to interpret.
 *
 * The server (admin_assign_worker RPC) is authoritative for authorization (own-house
 * only for a plain SM), the same-house constraint, the non-overridable HARD cap, and
 * the SOFT-advisory two-step confirm. This layer only classifies the response so the
 * UI can either complete, show the confirm dialog, or surface a friendly rejection.
 */

/** A soft advisory the operator may override by re-submitting with `override = true`. */
enum class AssignAdvisory {
    /** Assigning pushes the worker over the weekly hours cap (soft, overridable). */
    SOFT_CAP,

    /** Assigning pushes the worker over their stated target hours for the period. */
    OVER_TARGET,

    /** The worker marked "cannot" for this time in their preferences. */
    CANNOT,

    /** The worker opted out of all hours this period ("no hours"). */
    OPTED_OUT,

    /** Any advisory kind the client does not yet recognise (forward-compatible). */
    UNKNOWN,
    ;

    /**
     * The single-line reason shown in the confirm dialog. No em or en dashes (house
     * style): re-punctuate with periods and parentheses.
     */
    val message: String
        get() =
            when (this) {
                SOFT_CAP -> "This puts them over the weekly hours cap."
                OVER_TARGET -> "This puts them over their target hours."
                CANNOT -> "They marked they cannot work this time."
                OPTED_OUT -> "They opted out of hours this period."
                UNKNOWN -> "This needs your confirmation."
            }

    companion object {
        fun fromKind(kind: String): AssignAdvisory =
            when (kind) {
                "soft_cap" -> SOFT_CAP
                "over_target" -> OVER_TARGET
                "cannot" -> CANNOT
                "opted_out" -> OPTED_OUT
                else -> UNKNOWN
            }
    }
}

/** The classified result of an assign attempt. */
sealed interface AssignOutcome {
    /** Committed. [count] block-seats were assigned. */
    data class Assigned(val count: Int) : AssignOutcome

    /**
     * The worker is assignable but tripped one or more soft advisories. The UI shows a
     * confirm dialog; on confirm it re-submits the SAME request with `override = true`.
     */
    data class NeedsConfirm(val advisories: List<AssignAdvisory>) : AssignOutcome

    /**
     * The server refused (e.g. not authorized, worker inactive, cross-house, block
     * already started or float committed). [message] is a short user-facing line.
     */
    data class Rejected(val reason: String, val message: String) : AssignOutcome

    /** Network error or an unparseable response. */
    data object Failed : AssignOutcome
}

/** House-style copy for a server rejection `reason` (no em or en dashes). */
private fun rejectionMessage(reason: String): String =
    when (reason) {
        "not_authorized" -> "You can only manage your own house."
        "user_inactive" -> "That worker is no longer active."
        "cross_house_not_supported" -> "You can only assign workers from this house."
        "block_started", "block_started_slot" -> "That shift has already started."
        "float_committed" -> "That seat is committed to a float and cannot be reassigned."
        "seat_not_assignable" -> "That seat cannot be assigned."
        "block_not_found" -> "That shift could not be found. Refresh and try again."
        else -> "That could not be done. Refresh and try again."
    }

/**
 * Classify the `admin-assign-worker` Edge Function response. [ok] is the HTTP 2xx flag;
 * [body] is the raw JSON string. Pure and total: any parse failure resolves to [Failed]
 * (for a 2xx) or a generic [Rejected] (for a non-2xx that carried no reason), so the UI
 * always has something to show.
 *
 * Success envelope: `{ ok: true, result: { needs_confirm, assigned_count, advisories } }`.
 * Rejection envelope: `{ error: "assign_rejected", reason: "<reason>" }`.
 */
fun parseAssignOutcome(
    ok: Boolean,
    body: String,
    json: Json = Json { ignoreUnknownKeys = true },
): AssignOutcome {
    if (!ok) {
        val reason =
            runCatching {
                json.parseToJsonElement(body).jsonObject["reason"]?.jsonPrimitive?.content
            }.getOrNull()
        return if (reason != null) {
            AssignOutcome.Rejected(reason, rejectionMessage(reason))
        } else {
            AssignOutcome.Failed
        }
    }
    return runCatching {
        val result = json.parseToJsonElement(body).jsonObject["result"]?.jsonObject
            ?: return AssignOutcome.Failed
        val needsConfirm =
            result["needs_confirm"]?.jsonPrimitive?.content?.toBooleanStrictOrNull() ?: false
        if (needsConfirm) {
            AssignOutcome.NeedsConfirm(advisoriesOf(result))
        } else {
            val count =
                result["assigned_count"]?.jsonPrimitive?.content?.toIntOrNull() ?: 0
            AssignOutcome.Assigned(count)
        }
    }.getOrDefault(AssignOutcome.Failed)
}

private fun advisoriesOf(result: JsonObject): List<AssignAdvisory> =
    runCatching {
        result["advisories"]?.jsonArray
            ?.mapNotNull { it.jsonObject["kind"]?.jsonPrimitive?.content }
            ?.map(AssignAdvisory::fromKind)
            ?.distinct()
            ?: emptyList()
    }.getOrDefault(emptyList())
