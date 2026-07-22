package com.pennhousing.shift.shared.data

import com.pennhousing.shift.shared.manager.AssignOutcome
import com.pennhousing.shift.shared.manager.ForceTriggerOutcome
import com.pennhousing.shift.shared.manager.RosterWorker
import com.pennhousing.shift.shared.manager.parseAssignOutcome
import com.pennhousing.shift.shared.manager.parseForceTriggerOutcome
import com.pennhousing.shift.shared.network.EdgeFunctionClient
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Order
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/*
 * SM/HM/BM/RSM manager write surface (BSpec §2.2) — the data layer behind the
 * House-grid "assign to an open seat" action. The mobile analogue of the Edge/HTTP
 * layer the phase-13a test plan scopes out (the pure decision surface lives in
 * `manager/AssignWorker.kt` and IS unit-tested); correctness of the wiring here is
 * verified manually against a running backend.
 *
 * READ — [fetchHouseRoster] lists the assignable workers for a house: the
 * `worker_directory` rows whose `home_house_id` matches (admin_assign_worker refuses a
 * cross-house worker, so only same-house workers are offered). RLS: `worker_directory`
 * is the owner-rights full-contact view any authenticated worker may read (2026-06-12
 * ruling), the same source the hand-off picker uses.
 *
 * WRITE — [assignWorker] POSTs to the token-deriving `admin-assign-worker` Edge
 * Function. Identity (the operator) comes from the bearer token server-side, NEVER the
 * body, so a worker token cannot name another operator. The server owns authorization
 * (own-house only for a plain SM), the hard cap, and the soft-advisory confirm; this
 * layer just classifies the response via [parseAssignOutcome].
 */
class ManagerRepository(
    private val supabase: SupabaseClient,
    private val edge: EdgeFunctionClient = EdgeFunctionClient(),
) {
    /**
     * The workers assignable at [houseId] (its own-house roster), name-sorted. Best-effort:
     * an unreadable result yields an empty list (the picker then shows its empty state).
     */
    suspend fun fetchHouseRoster(houseId: String): List<RosterWorker> =
        runCatching {
            supabase
                .from(VIEW_WORKER_DIRECTORY)
                .select(Columns.list("user_id", "name", "home_house_id")) {
                    filter { eq("home_house_id", houseId) }
                    order("name", Order.ASCENDING)
                }
                .decodeList<WorkerDirectoryRow>()
                .map { RosterWorker(userId = it.userId, name = it.name) }
        }.getOrDefault(emptyList())

    /**
     * Assign [userId] to the open seats [assignmentIds] (a coalesced vacant run from the
     * House grid) → the `admin-assign-worker` Edge Function. [scope] is `this_week` or
     * `permanent`; [override] resends after a [AssignOutcome.NeedsConfirm] to accept the
     * soft advisories. The EF resolves the seat ids to block ids and calls
     * `admin_assign_worker`. Returns the classified [AssignOutcome].
     */
    suspend fun assignWorker(
        assignmentIds: List<String>,
        userId: String,
        scope: String = "this_week",
        override: Boolean = false,
    ): AssignOutcome {
        if (assignmentIds.isEmpty()) return AssignOutcome.Failed
        val body =
            Json.encodeToString(
                AssignWorkerRequest(
                    assignmentIds = assignmentIds,
                    userId = userId,
                    scope = scope,
                    overrideAdvisories = override,
                ),
            )
        val result = edge.invoke("admin-assign-worker", body)
        return parseAssignOutcome(result.ok, result.body)
    }

    /**
     * Force-trigger a float lookup for the vacant run [assignmentIds] at [houseId] →
     * the `force-trigger` Edge Function (BSpec §6.6). The EF derives the initiator from
     * the token and enforces own-house server-side; it resolves the seat ids to block
     * ids (mirrors the assign path). Returns the classified [ForceTriggerOutcome].
     */
    suspend fun forceTrigger(
        houseId: String,
        assignmentIds: List<String>,
    ): ForceTriggerOutcome {
        if (assignmentIds.isEmpty()) return ForceTriggerOutcome.Failed
        val body =
            Json.encodeToString(
                ForceTriggerRequest(destinationHouseId = houseId, assignmentIds = assignmentIds),
            )
        // The EF path is /force-trigger/force-trigger (the function's internal route).
        val result = edge.invoke("force-trigger/force-trigger", body)
        return parseForceTriggerOutcome(result.ok, result.body)
    }

    private companion object {
        const val VIEW_WORKER_DIRECTORY = "worker_directory"
    }
}

/** `force-trigger` request body (§6.6) — mobile sends the run's seat ids to resolve. */
@Serializable
private data class ForceTriggerRequest(
    @SerialName("destination_house_id") val destinationHouseId: String,
    @SerialName("assignment_ids") val assignmentIds: List<String>,
)

/** `admin-assign-worker` request body (§2.2 add-a-worker override). */
@Serializable
private data class AssignWorkerRequest(
    @SerialName("assignment_ids") val assignmentIds: List<String>,
    @SerialName("user_id") val userId: String,
    @SerialName("scope") val scope: String,
    @SerialName("override_advisories") val overrideAdvisories: Boolean,
)
