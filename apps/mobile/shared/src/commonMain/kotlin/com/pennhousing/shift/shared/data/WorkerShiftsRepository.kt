package com.pennhousing.shift.shared.data

import com.pennhousing.shift.shared.calendar.calendarWeekBounds
import com.pennhousing.shift.shared.calendar.calendarWeekDates
import com.pennhousing.shift.shared.house.HouseScheduleSnapshot
import com.pennhousing.shift.shared.house.HouseSeat
import com.pennhousing.shift.shared.model.AssignmentKind
import com.pennhousing.shift.shared.model.FloatAck
import com.pennhousing.shift.shared.model.House
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.model.OpenFeed
import com.pennhousing.shift.shared.model.OpenShift
import com.pennhousing.shift.shared.network.EdgeFunctionClient
import com.pennhousing.shift.shared.network.EdgeResult
import com.pennhousing.shift.shared.notifications.IncomingSwap
import com.pennhousing.shift.shared.notifications.NotificationItem
import com.pennhousing.shift.shared.notifications.notificationFromPayload
import com.pennhousing.shift.shared.shifts.BLOCK
import com.pennhousing.shift.shared.shifts.NEW_YORK
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.rpc
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
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
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
     * Function (`drop_type: 'temporary'`). Best-effort (the UI flips its optimistic
     * local state regardless); `EdgeResult.ok` reports the 2xx.
     *
     * [shift] is the DISPLAYED (coalesced) card: its `blockIds` carry every constituent
     * 30-minute block `assignment_id` (invariant #5), and the EF accepts the whole
     * contiguous run in one `assignment_ids` array (it validates contiguity itself).
     */
    suspend fun dropShift(shift: MyShift): EdgeResult = dropBlocks(shift.blockIds)

    /**
     * Drop a single 30-minute block by its `assignment_id` → the `drop-shift` Edge
     * Function (`drop_type: 'temporary'`). The id is the worker-read model row id; the
     * EF's `drop_shift` RPC reattributes it to a vacant slot. This string-keyed overload
     * is reused for break drops — a claimed break shift's `worker_my_shifts` row id IS
     * its block `assignment_id`, exactly what `drop-shift` keys on (there is no
     * break-specific drop RPC; confirmed). Best-effort; `EdgeResult.ok` reports the 2xx.
     */
    suspend fun dropShift(assignmentId: String): EdgeResult = dropBlocks(listOf(assignmentId))

    /**
     * Drop a contiguous run of blocks (their `assignment_id`s, time-ordered) in ONE
     * `drop-shift` call — the EF takes the full `assignment_ids` array and rejects a
     * non-contiguous run (`drop_not_contiguous`), which a coalesced card (or a §5.2
     * partial sub-range of one) never is.
     */
    suspend fun dropBlocks(assignmentIds: List<String>): EdgeResult {
        val body =
            Json.encodeToString(
                DropShiftRequest(
                    assignmentIds = assignmentIds,
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
        val slot = slotFor(shift.house.id, shift.start, shift.end)
        val body =
            Json.encodeToString(
                PermanentDropRequest(
                    houseId = slot.houseId,
                    dayOfWeek = slot.dayOfWeek,
                    blockStartLocals = slot.blockStartLocals,
                ),
            )
        return edge.invoke("permanent-drop", body)
    }

    /**
     * Dry-run the permanent pickup of [shift]'s recurring slot → the `permanent-pickup`
     * Edge Function GET. Returns the SCOPE (assigned vs skipped weeks) the design's
     * "Picking up N of M weeks · K skipped" confirmation reads, or `null` on any failure
     * (blank URL / transport / non-2xx / unparseable) so the UI can fall back to a plain
     * "Confirm pickup". No DB state changes — the commit is [permanentPickup].
     *
     * The slot is identified exactly as [permanentDrop] does: house + NY-local day-of-week
     * (Sun=0) + the block's HH:MM start (invariant #6), passed as GET query params.
     */
    suspend fun permanentPickupScope(shift: OpenShift): PermanentPickupScope? {
        val slot = shift.toSlot()
        val query =
            "house_id=${slot.houseId}&day_of_week=${slot.dayOfWeek}" +
                "&block_start_locals=${slot.blockStartLocals.joinToString(",")}"
        val result = edge.get("permanent-pickup?$query")
        if (!result.ok) return null
        return runCatching {
            permanentPickupJson.decodeFromString<PermanentPickupResponse>(result.body).scope
        }.getOrNull()
    }

    /**
     * Commit the permanent pickup of [shift]'s recurring slot → the `permanent-pickup`
     * Edge Function POST. This is the REAL permanent-pickup path (the prior `claim-shift`
     * with `claim_type:'permanent'` returns 501). The EF re-evaluates the scope server-side
     * (caps + conflicts, §8.4.3) and commits via `permanent_pickup_slot`, so the client is
     * never authoritative; the POST response carries the committed `scope` (assigned /
     * skipped weeks). Best-effort (the UI keeps its optimistic local move regardless);
     * `EdgeResult.ok` reports the 2xx.
     *
     * Same slot identity as [permanentDrop] / [permanentPickupScope].
     */
    suspend fun permanentPickup(shift: OpenShift): EdgeResult {
        val slot = shift.toSlot()
        val body =
            Json.encodeToString(
                PermanentPickupRequest(
                    houseId = slot.houseId,
                    dayOfWeek = slot.dayOfWeek,
                    blockStartLocals = slot.blockStartLocals,
                ),
            )
        return edge.invoke("permanent-pickup", body)
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
     * resolution; the client cap/claimable gating stays a pre-check only. [shift] is the
     * DISPLAYED (coalesced) card, so each constituent block (invariant #5) is claimed
     * per-block via [claimBlocks] — `claim_open_shift` keys on one `assignment_id`.
     * Permanent pickup goes through the dedicated [permanentPickup] (the
     * `permanent-pickup` EF), NOT this temporary path (`claim-shift` with
     * `claim_type:'permanent'` returns 501).
     */
    suspend fun claimShift(shift: OpenShift): EdgeResult = claimBlocks(shift.blockIds)

    /**
     * Reclaim a shift the worker dropped that is still open → the SAME `claim-shift`
     * Edge Function. `drop_shift` vacates the blocks in place (status → 'vacant') WITHOUT
     * changing their `assignment_id`s, so the dropped-still-open card's `blockIds` are the
     * very `assignment_id`s now sitting vacant in `worker_open_shifts`. Reclaiming is
     * therefore a per-block temporary claim — no separate backend exists or is needed. The
     * server re-applies the same cap / T-2h / FCFS checks; if someone else already took
     * a slot the EF returns `shift_unavailable` and the next snapshot reconciles.
     */
    suspend fun reclaimShift(shift: MyShift): EdgeResult = claimBlocks(shift.blockIds)

    /**
     * Claim each block `assignment_id` through the `claim-shift` EF (`claim_type:
     * 'temporary'`), one POST per block — FCFS atomicity is server-side and per-block.
     * A mid-run failure does NOT stop the rest (a partial claim beats none; the next
     * Realtime snapshot reconciles the UI); the result is the first failure if any
     * block failed, else the last success.
     */
    suspend fun claimBlocks(assignmentIds: List<String>): EdgeResult {
        var last = EdgeResult(false, 0, "")
        var firstFailure: EdgeResult? = null
        for (id in assignmentIds) {
            last =
                edge.invoke(
                    "claim-shift",
                    Json.encodeToString(ClaimShiftRequest(assignmentId = id, claimType = "temporary")),
                )
            if (!last.ok && firstFailure == null) firstFailure = last
        }
        return firstFailure ?: last
    }

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

    /**
     * The Mon..Sun strip indexes of THIS week's dates on which the worker's home house
     * is closed (§3.4/§11.3) — the mobile analogue of the web calendar's "Closed" cells
     * (T2-12c). Resolution: the worker's own `home_house_id` (own-row `users` RLS), then
     * one `house_closure(p_house_id, p_on_date)` call per visible date (SECURITY DEFINER,
     * granted authenticated — `operating_calendar`/`staffing_patterns` are not directly
     * worker-readable). Best-effort: any failure resolves that day to not-closed, and a
     * missing profile to an empty set, so the calendar renders plainly rather than wrongly.
     *
     * Reading the wall clock here is fine — this is the host/data layer; the pure
     * calendar builders receive the indexes as input.
     */
    suspend fun fetchCalendarClosedDays(userId: String): Set<Int> {
        val houseId =
            runCatching {
                supabase
                    .from(TABLE_USERS)
                    .select(Columns.list("home_house_id")) { filter { eq("user_id", userId) } }
                    .decodeSingleOrNull<HomeHouseRow>()
                    ?.homeHouseId
            }.getOrNull() ?: return emptySet()
        return calendarWeekDates(kotlin.time.Clock.System.now())
            .mapIndexedNotNull { index, isoDate ->
                val closed =
                    runCatching {
                        supabase.postgrest
                            .rpc(
                                "house_closure",
                                buildJsonObject {
                                    put("p_house_id", houseId)
                                    put("p_on_date", isoDate)
                                },
                            ).decodeAs<Boolean>()
                    }.getOrDefault(false)
                if (closed) index else null
            }.toSet()
    }

    /**
     * The worker's HOME-house schedule for this NY week (§11.4, T3b) — the
     * `house_schedule_grid` read model (security_invoker: RLS scopes rows to the
     * caller's home house; names/phones ride along via `worker_directory`, the
     * full-contact directory per the 2026-06-12 ruling). Returns null when the
     * profile/grid cannot be read (the caller falls back to the demo snapshot).
     *
     * Range: `start_at >= weekStart` is filtered server-side; the upper bound is
     * enforced in Kotlin — supabase-kt drops a second filter on the SAME column
     * (known gotcha), and the open-ended tail is small. Reading the wall clock
     * here is fine (host/data layer).
     */
    suspend fun fetchHouseSchedule(userId: String): HouseScheduleSnapshot? {
        val houseId =
            runCatching {
                supabase
                    .from(TABLE_USERS)
                    .select(Columns.list("home_house_id")) { filter { eq("user_id", userId) } }
                    .decodeSingleOrNull<HomeHouseRow>()
                    ?.homeHouseId
            }.getOrNull() ?: return null
        val (weekStart, weekEnd) = calendarWeekBounds(kotlin.time.Clock.System.now())
        val rows =
            runCatching {
                supabase
                    .from(VIEW_HOUSE_GRID)
                    .select {
                        filter {
                            eq("house_id", houseId)
                            gte("start_at", weekStart.toString())
                        }
                    }
                    .decodeList<HouseGridRow>()
            }.getOrNull() ?: return null
        val seats =
            rows
                .map { it.toSeat() }
                .filter { it.start < weekEnd } // upper bound enforced client-side (same-column-filter gotcha)
        val houseName = rows.firstOrNull()?.houseName ?: houseId
        val deskPhone = rows.firstOrNull { it.deskPhone != null }?.deskPhone
        return HouseScheduleSnapshot(houseName = houseName, deskPhone = deskPhone, seats = seats)
    }

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

    /**
     * The worker's INCOMING pending swaps (§8.2, T3a) — own `swap_requests` rows where
     * the worker is the counterparty and the swap is still pending (own-row RLS:
     * "users can select own swap requests"). `create-swap` inserts no notification row
     * for the counterparty, so the Updates feed synthesizes entries from these via the
     * pure `withIncomingSwapEntries`.
     */
    suspend fun fetchIncomingSwaps(userId: String): List<IncomingSwap> =
        supabase
            .from(TABLE_SWAP_REQUESTS)
            .select(Columns.list("swap_id", "swap_type", "created_at", "expires_at")) {
                filter {
                    eq("counterparty_user_id", userId)
                    eq("status", "pending")
                }
            }
            .decodeList<SwapRequestRow>()
            .map {
                IncomingSwap(
                    swapId = it.swapId,
                    swapType = it.swapType,
                    createdAt = Instant.parse(it.createdAt),
                    expiresAt = Instant.parse(it.expiresAt),
                )
            }

    /**
     * Accept an incoming TEMPORARY swap (§8.2) → the `accept-swap` Edge Function with a
     * plain `{ swap_id }` (the EF resolves the worker from the JWT and runs the atomic
     * `accept_swap` RPC; expiry/ownership re-checked server-side). Permanent swaps need
     * `affected_assignment_ids` (§8.4 `apply_permanent_swap`) which this minimal slice
     * does not compute — the feed offers Decline only for those. Best-effort (the feed
     * already resolved the entry optimistically); `EdgeResult.ok` reports the 2xx.
     */
    suspend fun acceptSwap(swapId: String): EdgeResult =
        edge.invoke("accept-swap", Json.encodeToString(SwapActionRequest(swapId = swapId)))

    /**
     * Decline an incoming swap → the `reject-swap` Edge Function (`{ swap_id }`; the EF
     * flips the worker's own pending counterparty row to 'rejected' — idempotent, a
     * non-pending swap 409s `not_pending`). Best-effort, mirroring [acceptSwap].
     */
    suspend fun rejectSwap(swapId: String): EdgeResult =
        edge.invoke("reject-swap", Json.encodeToString(SwapActionRequest(swapId = swapId)))

    /**
     * Mark ONE notification read (§10.1) → the `mark_notification_read` RPC. Called DIRECTLY
     * via Postgrest (not an Edge Function): the RPC is `SECURITY DEFINER` and GRANTed to
     * `authenticated` (migration 20260601000001), so the worker's JWT can invoke it through
     * PostgREST. It sets `acknowledged_at = p_now` on the worker's own still-unread row
     * (`auth.uid()` guard + `recipient_user_id = p_user_id`), so the worker's read receipt is
     * a legitimate self-scoped write. Best-effort (the Updates VM flips its optimistic local
     * unread state regardless); idempotent — an already-read / non-existent row returns `false`.
     */
    suspend fun markNotificationRead(
        notificationId: String,
        userId: String,
        now: Instant = kotlin.time.Clock.System.now(),
    ) {
        supabase.postgrest.rpc(
            "mark_notification_read",
            buildJsonObject {
                put("p_notification_id", notificationId)
                put("p_user_id", userId)
                put("p_now", now.toString())
            },
        )
    }

    /**
     * Mark ALL the given unread notifications read by looping [unreadIds] through
     * [markNotificationRead] (the single `mark_notification_read` RPC) — no new backend RPC
     * is introduced (this stays a no-DB change). Each call is independent and best-effort;
     * one transient failure does not block the rest. The optimistic local clear lives in
     * `UpdatesViewModel.markAllRead`; this only persists the receipts. `now` is shared across
     * the batch so every row stamps the same read instant.
     */
    suspend fun markAllRead(
        userId: String,
        unreadIds: List<String>,
        now: Instant = kotlin.time.Clock.System.now(),
    ) {
        unreadIds.forEach { id ->
            runCatching { markNotificationRead(id, userId, now) }
        }
    }

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
        const val TABLE_USERS = "users"
        const val TABLE_SWAP_REQUESTS = "swap_requests"
        const val VIEW_HOUSE_GRID = "house_schedule_grid"
    }
}

/** One `house_schedule_grid` row (T3b wire shape) → [HouseSeat]. */
@Serializable
internal data class HouseGridRow(
    val id: String,
    @SerialName("house_name") val houseName: String,
    @SerialName("desk_phone") val deskPhone: String? = null,
    @SerialName("start_at") val startAt: String,
    @SerialName("end_at") val endAt: String,
    val status: String,
    @SerialName("is_float") val isFloat: Boolean = false,
    @SerialName("user_id") val userId: String? = null,
    @SerialName("worker_name") val workerName: String? = null,
    @SerialName("worker_phone") val workerPhone: String? = null,
)

internal fun HouseGridRow.toSeat(): HouseSeat =
    HouseSeat(
        id = id,
        start = Instant.parse(startAt),
        end = Instant.parse(endAt),
        vacant = status.equals("vacant", ignoreCase = true),
        pending = status.equals("pending_float_in", ignoreCase = true),
        floatIn = status.equals("floated_in", ignoreCase = true) || status.equals("pending_float_in", ignoreCase = true),
        userId = userId,
        workerName = workerName,
        workerPhone = workerPhone,
    )

/** The worker's own pending counterparty `swap_requests` row (T3a wire shape). */
@Serializable
internal data class SwapRequestRow(
    @SerialName("swap_id") val swapId: String,
    @SerialName("swap_type") val swapType: String,
    @SerialName("created_at") val createdAt: String,
    @SerialName("expires_at") val expiresAt: String,
)

/** The worker's own `home_house_id` (own-row `users` RLS) — for the closed-day lookup. */
@Serializable
internal data class HomeHouseRow(
    @SerialName("home_house_id") val homeHouseId: String,
)

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

/** `accept-swap` / `reject-swap` request — the incoming swap id (T3a minimal slice). */
@Serializable
private data class SwapActionRequest(
    @SerialName("swap_id") val swapId: String,
)

/** `permanent-drop` request — the recurring slot, by house + NY-local day + HH:MM start. */
@Serializable
private data class PermanentDropRequest(
    @SerialName("house_id") val houseId: String,
    @SerialName("day_of_week") val dayOfWeek: Int,
    @SerialName("block_start_locals") val blockStartLocals: List<String>,
)

/** `permanent-pickup` POST request — the same recurring-slot identity as the drop. */
@Serializable
private data class PermanentPickupRequest(
    @SerialName("house_id") val houseId: String,
    @SerialName("day_of_week") val dayOfWeek: Int,
    @SerialName("block_start_locals") val blockStartLocals: List<String>,
)

/**
 * A recurring slot identity (house + NY-local day-of-week + HH:MM block starts), the shape
 * `permanent-drop` and `permanent-pickup` both key on. The EF maps weekday names through
 * ['Sun','Mon',…], so Sunday is index 0 and Monday…Saturday are 1…6 (kotlinx `isoDayNumber`,
 * with Sunday folded to 0). Timestamps are NY `timestamptz` (invariant #6).
 */
internal data class RecurringSlot(
    val houseId: String,
    val dayOfWeek: Int,
    val blockStartLocals: List<String>,
)

/**
 * The slot identity for the [start, end) span: one NY-local HH:MM entry per 30-minute
 * block (invariant #5) — a coalesced multi-block card names its WHOLE recurring slot,
 * not just its first block. Block iteration is duration arithmetic on instants
 * (invariant #6); each start is formatted NY-local independently, so a span is
 * labelled correctly even across a DST transition.
 */
internal fun slotFor(
    houseId: String,
    start: Instant,
    end: Instant,
): RecurringSlot {
    val firstLocal = start.toLocalDateTime(NEW_YORK)
    val dayOfWeek = if (firstLocal.dayOfWeek == DayOfWeek.SUNDAY) 0 else firstLocal.dayOfWeek.isoDayNumber
    val blockStartLocals =
        generateSequence(start) { it + BLOCK }
            .takeWhile { it < end }
            .map { blockStart ->
                val local = blockStart.toLocalDateTime(NEW_YORK)
                val hh = local.hour.toString().padStart(2, '0')
                val mm = local.minute.toString().padStart(2, '0')
                "$hh:$mm"
            }
            .toList()
            .ifEmpty {
                val hh = firstLocal.hour.toString().padStart(2, '0')
                val mm = firstLocal.minute.toString().padStart(2, '0')
                listOf("$hh:$mm")
            }
    return RecurringSlot(houseId = houseId, dayOfWeek = dayOfWeek, blockStartLocals = blockStartLocals)
}

private fun OpenShift.toSlot(): RecurringSlot = slotFor(house.id, start, end)

/**
 * The `permanent-pickup` GET/POST response envelope — `{ scope }` on GET, `{ ...data, scope }`
 * on POST. Only `scope` is read here (the design's N-of-M confirmation); the POST's RPC
 * `data` fields are ignored (the next Realtime snapshot is authoritative for the week).
 */
@Serializable
private data class PermanentPickupResponse(
    val scope: PermanentPickupScope,
)

/**
 * The pickup SCOPE returned by the `permanent-pickup` EF (the pure `evaluatePermanentPickup`
 * result): how many semester weeks the recurring slot covers, and how each resolves against
 * the worker's caps + existing shifts (§8.4.3). The design reads `totalWeeksInScope` (M),
 * `weeksFullyAssigned + weeksPartiallyAssigned` (N picked up), and `weeksSkipped` (K skipped).
 * Extra wire fields the UI does not surface are ignored (`ignoreUnknownKeys`).
 */
@Serializable
data class PermanentPickupScope(
    @SerialName("totalWeeksInScope") val totalWeeksInScope: Int = 0,
    @SerialName("weeksFullyAssigned") val weeksFullyAssigned: Int = 0,
    @SerialName("weeksPartiallyAssigned") val weeksPartiallyAssigned: Int = 0,
    @SerialName("weeksSkipped") val weeksSkipped: Int = 0,
) {
    /** Weeks the pickup takes at least one occurrence in — the "N" in "N of M weeks". */
    val weeksPickedUp: Int get() = weeksFullyAssigned + weeksPartiallyAssigned
}

private val permanentPickupJson = Json { ignoreUnknownKeys = true }

private fun JsonObject.toToast(): ToastNotification? {
    val title = this["title"]?.jsonPrimitive?.content ?: return null
    val body = this["body"]?.jsonPrimitive?.content ?: this["message"]?.jsonPrimitive?.content ?: ""
    return ToastNotification(title = title, body = body)
}
