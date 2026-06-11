package com.pennhousing.shift.shared.data

import com.pennhousing.shift.shared.model.AssignmentKind
import com.pennhousing.shift.shared.model.FloatAck
import com.pennhousing.shift.shared.model.House
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.model.OpenFeed
import com.pennhousing.shift.shared.model.OpenShift
import com.pennhousing.shift.shared.network.EdgeFunctionClient
import com.pennhousing.shift.shared.network.EdgeResult
import com.pennhousing.shift.shared.notifications.NotificationItem
import com.pennhousing.shift.shared.notifications.notificationFromPayload
import com.pennhousing.shift.shared.shifts.NEW_YORK
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.realtime.PostgresAction
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.postgresChangeFlow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.datetime.DayOfWeek
import kotlinx.datetime.isoDayNumber
import kotlinx.datetime.toLocalDateTime
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.time.Instant

/**
 * Phase 13a — the worker-week data layer (commonMain).
 *
 * Sources the [WorkerSnapshot] the (pure, tested) `ShiftsScreenViewModel` renders
 * and keeps it live via Supabase Realtime — the mobile analogue of the Edge/HTTP
 * layer that the phase-13a test plan scopes out ("How … snapshots reach the
 * ViewModel … is NOT covered"). It is intentionally untested by the kotlin.test
 * suite; correctness is verified manually against a running backend.
 *
 * Reads go through two client read-model views that denormalize house + kind for
 * the app — `worker_my_shifts` and `worker_open_shifts` — keyed by the
 * authenticated worker. RLS scopes every row to that worker, so the Realtime
 * subscription needs no explicit server-side user filter: any change the worker
 * can see triggers a refetch (deliverable "no manual refresh").
 */
data class WorkerSnapshot(
    val myShifts: List<MyShift>,
    val openShifts: List<OpenShift>,
)

/** A new `notifications` row, mapped for the in-app toast (deliverable #7). */
data class ToastNotification(
    val title: String,
    val body: String,
)

class WorkerShiftsRepository(
    private val supabase: SupabaseClient,
    private val edge: EdgeFunctionClient = EdgeFunctionClient(),
) {
    /**
     * Drop a single occurrence of [shift] this week → the phase-05 `drop-shift` Edge
     * Function (`drop_type: 'temporary'`). The block's `assignment_id` is the worker-read
     * model row id; the EF's `drop_shift` RPC reattributes it to a vacant slot. Best-effort
     * (the UI flips its optimistic local state regardless); `EdgeResult.ok` reports the 2xx.
     *
     * One `MyShift` is one 30-minute block (invariant #5), so this drops exactly one
     * contiguous occurrence — `assignment_ids` is the single-element array the EF requires.
     */
    suspend fun dropShift(shift: MyShift): EdgeResult = dropShift(shift.id)

    /**
     * Drop a single 30-minute block by its `assignment_id` → the `drop-shift` Edge
     * Function (`drop_type: 'temporary'`). The id is the worker-read model row id; the
     * EF's `drop_shift` RPC reattributes it to a vacant slot. This string-keyed overload
     * is reused for break drops — a claimed break shift's `worker_my_shifts` row id IS
     * its block `assignment_id`, exactly what `drop-shift` keys on (there is no
     * break-specific drop RPC; confirmed). Best-effort; `EdgeResult.ok` reports the 2xx.
     */
    suspend fun dropShift(assignmentId: String): EdgeResult {
        val body =
            Json.encodeToString(
                DropShiftRequest(
                    assignmentIds = listOf(assignmentId),
                    dropType = "temporary",
                ),
            )
        return edge.invoke("drop-shift", body)
    }

    /**
     * Drop the recurring slot [shift] sits in → the `permanent-drop` Edge Function, which
     * releases it as a permanent opening. The EF identifies the slot by house + NY-local
     * day-of-week (Sun=0) + the block's HH:MM start (invariant #6); `dropping_user_id` is
     * omitted so the EF defaults it to the authenticated worker (self-initiated path).
     */
    suspend fun permanentDrop(shift: MyShift): EdgeResult {
        val local = shift.start.toLocalDateTime(NEW_YORK)
        // The EF maps weekday names through ['Sun','Mon',…], so Sunday is index 0 and
        // Monday…Saturday are 1…6 (kotlinx `isoDayNumber`, with Sunday folded to 0).
        val dayOfWeek = if (local.dayOfWeek == DayOfWeek.SUNDAY) 0 else local.dayOfWeek.isoDayNumber
        val hh = local.hour.toString().padStart(2, '0')
        val mm = local.minute.toString().padStart(2, '0')
        val body =
            Json.encodeToString(
                PermanentDropRequest(
                    houseId = shift.house.id,
                    dayOfWeek = dayOfWeek,
                    blockStartLocals = listOf("$hh:$mm"),
                ),
            )
        return edge.invoke("permanent-drop", body)
    }

    /**
     * Claim an open shift → the phase-05 `claim-shift` Edge Function (`claim_type:
     * 'temporary'`). The open-shift feed row id IS the vacant block's `assignment_id`
     * (worker_open_shifts exposes `assignment_id::text AS id`), which is exactly what
     * the EF's `claim_open_shift` RPC keys on. Best-effort (the UI flips its optimistic
     * local move regardless); `EdgeResult.ok` reports the 2xx.
     *
     * The SERVER is authoritative for the hours-cap, the T-2h cutoff, cross-house
     * eligibility (Harnwell training constraint — invariant #1) and FCFS conflict
     * resolution; the client cap/claimable gating stays a pre-check only. One feed row
     * is one 30-minute block (invariant #5); permanent pickup (`claim_type:
     * 'permanent'`) is out of scope here (the EF returns 501).
     */
    suspend fun claimShift(shift: OpenShift): EdgeResult =
        edge.invoke(
            "claim-shift",
            Json.encodeToString(ClaimShiftRequest(assignmentId = shift.id, claimType = "temporary")),
        )

    /**
     * Reclaim a shift the worker dropped that is still open → the SAME `claim-shift`
     * Edge Function. `drop_shift` vacates the block in place (status → 'vacant') WITHOUT
     * changing its `assignment_id`, so the dropped-still-open `MyShift.id` is the very
     * `assignment_id` now sitting vacant in `worker_open_shifts`. Reclaiming is therefore
     * a temporary claim keyed on that id — no separate backend exists or is needed. The
     * server re-applies the same cap / T-2h / FCFS checks; if someone else already took
     * the slot the EF returns `shift_unavailable` and the next snapshot reconciles.
     */
    suspend fun reclaimShift(shift: MyShift): EdgeResult =
        edge.invoke(
            "claim-shift",
            Json.encodeToString(ClaimShiftRequest(assignmentId = shift.id, claimType = "temporary")),
        )

    /**
     * Claim a break shift from the pool → the phase-11 `break-claim` Edge Function. The
     * request body matches `claim-shift` exactly — `{ assignment_id, claim_type:
     * 'temporary' }` — where [assignmentId] is the vacant break block's `worker_open_shifts`
     * row id (= its block `assignment_id`, what the EF's `claim_break_shift` RPC keys on).
     * Best-effort (the picker flips its optimistic local claim regardless); `EdgeResult.ok`
     * reports the 2xx.
     *
     * The SERVER is authoritative for the 40h break HARD cap and the Harnwell training
     * constraint (invariant #1 — no non-Harnwell worker may claim a Harnwell break shift);
     * the client meter/gating is a pre-check only. One pool row is one 30-minute block
     * (invariant #5); timestamps are NY `timestamptz` (invariant #6).
     */
    suspend fun claimBreak(assignmentId: String): EdgeResult =
        edge.invoke(
            "break-claim",
            Json.encodeToString(ClaimShiftRequest(assignmentId = assignmentId, claimType = "temporary")),
        )

    /**
     * The worker's CURRENT pending float, mapped to the pure [FloatAck] the ack/decline
     * modal renders, or `null` if none is outstanding. Worker-readable end-to-end:
     * `float_assignments` has an own-row SELECT policy (`user_id = auth.uid()`), and the
     * destination house + float start come from the worker's own `pending_float_in`
     * blocks (`worker_my_shifts`, kind `float_out`, `pending = true`), which are
     * RLS-scoped to the worker.
     *
     * Resolution: read the single `status = 'pending'` float row for `float_id` +
     * `destination_assignment_ids`, then pick the earliest pending float-out block among
     * those ids for the destination house and float start. A float already
     * acked/declined server-side simply has no `pending` row → `null` (terminal state is
     * resolved by the absence of a pending float, matching the modal's idempotent phase
     * machine).
     */
    suspend fun fetchPendingFloat(userId: String): FloatAck? {
        val float =
            supabase
                .from(TABLE_FLOAT_ASSIGNMENTS)
                .select {
                    filter {
                        eq("user_id", userId)
                        eq("status", "pending")
                    }
                }
                .decodeList<PendingFloatRow>()
                .firstOrNull() ?: return null

        val destinationIds = float.destinationAssignmentIds.toSet()
        if (destinationIds.isEmpty()) return null

        // The destination blocks live in the worker's own pending float-out rows; pick
        // the earliest by start to anchor the hero's "Starts in" + destination house.
        val destinationBlock =
            fetchWorkerWeek(userId).myShifts
                .asSequence()
                .filter { it.id in destinationIds }
                .minByOrNull { it.start } ?: return null

        return FloatAck(
            floatId = float.floatId,
            destinationHouse = destinationBlock.house,
            floatStart = destinationBlock.start,
        )
    }

    /**
     * Acknowledge the worker's pending float → the `acknowledge-float` Edge Function,
     * a thin worker-authenticated wrapper over the service-role-only `acknowledge_float`
     * RPC (migration 20260528000014; the RPC is GRANTed to service_role only, so it
     * cannot be called from the worker's JWT through PostgREST). The worker's own ack is
     * the one legitimate manual action permitted under no-takeback (invariant #3).
     * Best-effort (the modal flips its optimistic local phase regardless); idempotent —
     * a non-pending float resolves to `{ acknowledged: false, reason: 'not_pending' }`.
     */
    suspend fun acknowledgeFloat(floatId: String): EdgeResult =
        edge.invoke("acknowledge-float", Json.encodeToString(FloatActionRequest(floatId = floatId)))

    /**
     * Decline the worker's pending float → the `decline-float` Edge Function (same shape
     * as [acknowledgeFloat]; wraps the service-role-only `decline_float` RPC). Declining
     * reopens the destination block as the original gap and restores the floater home —
     * the worker's own decline is a legitimate manual action under no-takeback
     * (invariant #3). Best-effort + idempotent on terminal state.
     */
    suspend fun declineFloat(floatId: String): EdgeResult =
        edge.invoke("decline-float", Json.encodeToString(FloatActionRequest(floatId = floatId)))

    suspend fun fetchWorkerWeek(userId: String): WorkerSnapshot {
        val myShifts =
            supabase
                .from(VIEW_MY_SHIFTS)
                .select { filter { eq("user_id", userId) } }
                .decodeList<MyShiftRow>()
                .map { it.toModel() }
        val openShifts =
            supabase
                .from(VIEW_OPEN_SHIFTS)
                .select { filter { eq("eligible_user_id", userId) } }
                .decodeList<OpenShiftRow>()
                .map { it.toModel() }
        return WorkerSnapshot(myShifts = myShifts, openShifts = openShifts)
    }

    /**
     * Emits an initial snapshot, then a fresh snapshot on every change to the
     * worker's `shift_block_assignments` (e.g. a float assigned at T-2h). The
     * subscription relies on RLS to scope rows to the authenticated worker.
     */
    fun observeWorkerWeek(userId: String): Flow<WorkerSnapshot> =
        flow {
            emit(fetchWorkerWeek(userId))
            val channel = supabase.channel("worker-shifts-$userId")
            val changes =
                channel.postgresChangeFlow<PostgresAction>(schema = "public") {
                    table = "shift_block_assignments"
                }
            channel.subscribe()
            changes.collect { emit(fetchWorkerWeek(userId)) }
        }

    /**
     * The worker's notification history for the Updates feed (§10.1). A plain SELECT
     * over the worker's own `notifications` rows (RLS-scoped); the pure
     * `buildUpdatesFeed` groups them. `urgent`/`floatId` are left unset — the live
     * pending-float linkage is a separate query (see the `AckDeclineViewModel` TODO),
     * so today the urgent entry comes from the demo/ack path, not this list.
     */
    suspend fun fetchNotifications(userId: String): List<NotificationItem> =
        supabase
            .from(TABLE_NOTIFICATIONS)
            .select { filter { eq("recipient_user_id", userId) } }
            .decodeList<NotificationWireRow>()
            .map { it.toModel() }

    /** Live new-notification stream for the top-of-screen toast (§10.1, deliverable #7). */
    fun observeNotifications(userId: String): Flow<ToastNotification> =
        flow {
            val channel = supabase.channel("worker-notifications-$userId")
            val inserts =
                channel.postgresChangeFlow<PostgresAction.Insert>(schema = "public") {
                    table = "notifications"
                }
            channel.subscribe()
            inserts.collect { action ->
                action.record.toToast()?.let { emit(it) }
            }
        }

    private companion object {
        const val VIEW_MY_SHIFTS = "worker_my_shifts"
        const val VIEW_OPEN_SHIFTS = "worker_open_shifts"
        const val TABLE_NOTIFICATIONS = "notifications"
        const val TABLE_FLOAT_ASSIGNMENTS = "float_assignments"
    }
}

// ----- Wire rows (the client read-model views) → pure domain models. -----

@Serializable
internal data class MyShiftRow(
    val id: String,
    @SerialName("house_id") val houseId: String,
    @SerialName("house_name") val houseName: String,
    @SerialName("start_at") val startAt: String,
    @SerialName("end_at") val endAt: String,
    val kind: String,
    @SerialName("cross_house") val crossHouse: Boolean = false,
    val pending: Boolean = false,
    @SerialName("break_shift") val breakShift: Boolean = false,
    @SerialName("dropped_still_open") val droppedStillOpen: Boolean = false,
)

@Serializable
internal data class OpenShiftRow(
    val id: String,
    @SerialName("house_id") val houseId: String,
    @SerialName("house_name") val houseName: String,
    @SerialName("start_at") val startAt: String,
    @SerialName("end_at") val endAt: String,
    val feed: String,
    @SerialName("home_house") val homeHouse: Boolean,
    @SerialName("weeks_remaining") val weeksRemaining: Int? = null,
)

private fun MyShiftRow.toModel(): MyShift =
    MyShift(
        id = id,
        house = House(houseId, houseName),
        start = Instant.parse(startAt),
        end = Instant.parse(endAt),
        kind = parseAssignmentKind(kind),
        crossHouse = crossHouse,
        pending = pending,
        breakShift = breakShift,
        droppedStillOpen = droppedStillOpen,
    )

private fun OpenShiftRow.toModel(): OpenShift =
    OpenShift(
        id = id,
        house = House(houseId, houseName),
        start = Instant.parse(startAt),
        end = Instant.parse(endAt),
        feed = if (feed.equals("permanent_opening", ignoreCase = true)) OpenFeed.PERMANENT_OPENING else OpenFeed.WEEKLY,
        homeHouse = homeHouse,
        weeksRemaining = weeksRemaining,
    )

private fun parseAssignmentKind(raw: String): AssignmentKind =
    when (raw.lowercase()) {
        "permanent_pickup" -> AssignmentKind.PERMANENT_PICKUP
        "temp_pickup" -> AssignmentKind.TEMP_PICKUP
        "float_out" -> AssignmentKind.FLOAT_OUT
        else -> AssignmentKind.SCHEDULED
    }

/**
 * The worker's own `float_assignments` row (own-row RLS). Only the fields the pending
 * read needs: `float_id` for the RPC and `destination_assignment_ids` to locate the
 * destination house + float start among the worker's own pending float-out blocks.
 */
@Serializable
internal data class PendingFloatRow(
    @SerialName("float_id") val floatId: String,
    @SerialName("destination_assignment_ids") val destinationAssignmentIds: List<String> = emptyList(),
)

@Serializable
internal data class NotificationWireRow(
    @SerialName("notification_id") val id: String,
    val type: String,
    val payload: JsonObject = JsonObject(emptyMap()),
    @SerialName("created_at") val createdAt: String,
    @SerialName("acknowledged_at") val acknowledgedAt: String? = null,
)

private fun NotificationWireRow.toModel(): NotificationItem =
    notificationFromPayload(
        id = id,
        rawType = type,
        // The float-lookup / force-trigger RPCs stamp `payload.kind = 'float_assigned'`
        // + `payload.float_id`; the pure mapper turns that into the urgent FLOAT entry
        // whose row opens the ack hero (§7).
        payloadKind = payload["kind"]?.jsonPrimitive?.content,
        floatId = payload["float_id"]?.jsonPrimitive?.content,
        title = payload["title"]?.jsonPrimitive?.content,
        body = payload["body"]?.jsonPrimitive?.content ?: payload["message"]?.jsonPrimitive?.content,
        createdAt = Instant.parse(createdAt),
        unread = acknowledgedAt == null,
    )

// ----- Edge-Function request bodies. -----

/** `drop-shift` request — a contiguous run of assignment ids dropped for one week. */
@Serializable
private data class DropShiftRequest(
    @SerialName("assignment_ids") val assignmentIds: List<String>,
    @SerialName("drop_type") val dropType: String,
)

/** `claim-shift` request — the vacant block's assignment id + claim scope (§5.3). */
@Serializable
private data class ClaimShiftRequest(
    @SerialName("assignment_id") val assignmentId: String,
    @SerialName("claim_type") val claimType: String,
)

/** `acknowledge-float` / `decline-float` request — the worker's pending float id. */
@Serializable
private data class FloatActionRequest(
    @SerialName("float_id") val floatId: String,
)

/** `permanent-drop` request — the recurring slot, by house + NY-local day + HH:MM start. */
@Serializable
private data class PermanentDropRequest(
    @SerialName("house_id") val houseId: String,
    @SerialName("day_of_week") val dayOfWeek: Int,
    @SerialName("block_start_locals") val blockStartLocals: List<String>,
)

private fun JsonObject.toToast(): ToastNotification? {
    val title = this["title"]?.jsonPrimitive?.content ?: return null
    val body = this["body"]?.jsonPrimitive?.content ?: this["message"]?.jsonPrimitive?.content ?: ""
    return ToastNotification(title = title, body = body)
}
