package com.pennhousing.shift.shared.data

import com.pennhousing.shift.shared.breakclaim.BreakCalendarSeat
import com.pennhousing.shift.shared.breakclaim.BreakCalendarSnapshot
import com.pennhousing.shift.shared.breakclaim.BreakPhase
import com.pennhousing.shift.shared.calendar.calendarWeekBounds
import com.pennhousing.shift.shared.calendar.calendarWeekDates
import com.pennhousing.shift.shared.house.HouseOption
import com.pennhousing.shift.shared.house.HouseScheduleSnapshot
import com.pennhousing.shift.shared.house.HouseSeat
import com.pennhousing.shift.shared.model.AssignmentKind
import com.pennhousing.shift.shared.model.FloatAck
import com.pennhousing.shift.shared.model.House
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.model.OpenFeed
import com.pennhousing.shift.shared.model.OpenShift
import com.pennhousing.shift.shared.model.PendingFloat
import com.pennhousing.shift.shared.model.RecentFloat
import com.pennhousing.shift.shared.model.RecentFloatStatus
import com.pennhousing.shift.shared.network.ClaimOutcome
import com.pennhousing.shift.shared.network.EdgeFunctionClient
import com.pennhousing.shift.shared.network.EdgeResult
import com.pennhousing.shift.shared.notifications.NotificationItem
import com.pennhousing.shift.shared.notifications.notificationFromPayload
import com.pennhousing.shift.shared.shifts.BLOCK
import com.pennhousing.shift.shared.shifts.NEW_YORK
import com.pennhousing.shift.shared.swaps.HandoffWorker
import com.pennhousing.shift.shared.swaps.SwapProposal
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Order
import io.github.jan.supabase.postgrest.rpc
import io.github.jan.supabase.realtime.PostgresAction
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.postgresChangeFlow
import io.github.jan.supabase.realtime.realtime
import kotlin.random.Random
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.conflate
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.flow.shareIn
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.DayOfWeek
import kotlinx.datetime.LocalDate
import kotlinx.datetime.LocalDateTime
import kotlinx.datetime.LocalTime
import kotlinx.datetime.isoDayNumber
import kotlinx.datetime.plus
import kotlinx.datetime.toInstant
import kotlinx.datetime.toLocalDateTime
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
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
     * Scope that owns the shared worker-week subscriptions (cost audit F-02/F-11).
     *
     * SupervisorJob so one collector's failure cannot cancel the others sharing the same
     * upstream. The scope is deliberately never cancelled: the repository lives for the
     * session, and `SharingStarted.WhileSubscribed` already tears the Realtime channel
     * down as soon as the last collector leaves, so there is nothing running in it while
     * the app is idle.
     */
    private val repositoryScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    /**
     * Live shared flows, keyed so two collectors of the same window share one channel.
     *
     * Not synchronized, and that is a constraint rather than an oversight: both call
     * sites are main-thread confined (iOS `ShiftsRootView` is `@MainActor`; Android
     * builds the flow during composition), so [observeWorkerWeek] must be called from the
     * main dispatcher. Collection itself is free to happen anywhere -- only the lookup is
     * confined. If a background caller is ever needed, give this a mutex rather than
     * dropping the sharing.
     */
    private val sharedWorkerWeeks = mutableMapOf<SubscriptionKey, Flow<WorkerSnapshot>>()

    /**
     * Edge-triggered refetch signal (audit F9). Call [WorkerWeekRefresh.request] after a
     * write to reconcile the optimistic move against server truth; Realtime alone cannot,
     * because a seat reassigned away from this worker leaves their RLS scope and emits no
     * event. Full rationale lives on [WorkerWeekRefresh].
     */
    val refresh: WorkerWeekRefresh = WorkerWeekRefresh()

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
    suspend fun claimShift(shift: OpenShift): ClaimOutcome = claimBlocks(shift.blockIds)

    /**
     * Reclaim a shift the worker dropped that is still open → the SAME `claim-shift`
     * Edge Function. `drop_shift` vacates the blocks in place (status → 'vacant') WITHOUT
     * changing their `assignment_id`s, so the dropped-still-open card's `blockIds` are the
     * very `assignment_id`s now sitting vacant in `worker_open_shifts`. Reclaiming is
     * therefore a per-block temporary claim — no separate backend exists or is needed. The
     * server re-applies the same cap / T-2h / FCFS checks; if someone else already took
     * a slot the EF returns `shift_unavailable` and the next snapshot reconciles.
     */
    suspend fun reclaimShift(shift: MyShift): ClaimOutcome = claimBlocks(shift.blockIds)

    /**
     * Claim each block `assignment_id` through the `claim-shift` EF (`claim_type:
     * 'temporary'`), one POST per block — FCFS atomicity is server-side and per-block.
     * A mid-run failure does NOT stop the rest (a partial claim beats none; the next
     * Realtime snapshot reconciles the UI). Returns a [ClaimOutcome] tallying how many
     * blocks landed vs. were rejected (plus the first rejection, for classifying the
     * reason) — so the host can tell full success / partial pickup / total failure apart
     * instead of treating a per-block conflict (e.g. a sub-range overlapping an existing
     * shift) as an outright failure.
     */
    suspend fun claimBlocks(assignmentIds: List<String>): ClaimOutcome {
        var claimed = 0
        var failed = 0
        var firstFailure: EdgeResult? = null
        for (id in assignmentIds) {
            val result =
                edge.invoke(
                    "claim-shift",
                    Json.encodeToString(ClaimShiftRequest(assignmentId = id, claimType = "temporary")),
                )
            if (result.ok) {
                claimed++
            } else {
                failed++
                if (firstFailure == null) firstFailure = result
            }
        }
        return ClaimOutcome(claimed = claimed, failed = failed, firstFailure = firstFailure)
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
     * Claim a coalesced break run per-block (D6 — the live pool is per-30-min-block;
     * `claim_break_shift` keys on one assignment). Mirrors [claimBlocks]: a mid-run
     * failure does not stop the rest; result = first failure, else last success. The
     * last successful response's `projectedHours` is the authoritative meter value —
     * read it with [parseProjectedHours].
     */
    suspend fun claimBreakBlocks(assignmentIds: List<String>): EdgeResult {
        var last = EdgeResult(false, 0, "")
        var firstFailure: EdgeResult? = null
        for (id in assignmentIds) {
            val result = claimBreak(id)
            if (!result.ok && firstFailure == null) firstFailure = result
            if (result.ok) last = result
        }
        return firstFailure ?: last
    }

    /**
     * Break CALENDAR drag claim (Break redesign B3): claim one open seat per dragged
     * 30-min block ("system-assigned lane") in ONE `break-claim` POST carrying the
     * `block_ids`. The EF's `claim_break_blocks` RPC is FCFS + cap + Harnwell-aware and
     * returns exactly the seats it actually claimed — the SERVER-SIDE TRIM. The picker
     * applies the optimistic drag locally, then reconciles to [BreakRangeResult.claimedAssignmentIds].
     */
    suspend fun claimBreakRange(blockIds: List<String>): BreakRangeResult {
        if (blockIds.isEmpty()) return BreakRangeResult(ok = true, claimedAssignmentIds = emptyList())
        val result =
            edge.invoke(
                "break-claim",
                Json.encodeToString(BreakRangeRequest(blockIds = blockIds, claimType = "temporary")),
            )
        if (!result.ok) return BreakRangeResult(ok = false, claimedAssignmentIds = emptyList())
        return BreakRangeResult(ok = true, claimedAssignmentIds = parseClaimedAssignmentIds(result.body))
    }

    /**
     * EVERY float awaiting this worker's acknowledgment (§7.1), closest-start first —
     * the source for the My-Shifts float-request carousel. Reads the bounded
     * `worker_pending_floats` view: one row per pending float with the destination
     * house and the full window (`float_start` / `float_end`), RLS-scoped to the worker
     * (`float_assignments` own-row SELECT + the worker's own destination blocks).
     *
     * This is INDEPENDENT of `worker_my_shifts`, which PostgREST caps at 1000 rows: a
     * worker holding a full semester of 30-minute blocks had the late-inserted float
     * blocks truncated out, so the old lookup returned null and the app fell back to a
     * demo float (the "wrong time" bug). The view is bounded to the handful of pending
     * floats, so it always resolves the exact window.
     */
    suspend fun fetchPendingFloats(userId: String): List<PendingFloat> =
        supabase
            .from(VIEW_PENDING_FLOATS)
            .select {
                filter { eq("user_id", userId) }
                order("float_start", Order.ASCENDING)
            }
            .decodeList<PendingFloatDetailRow>()
            .map { it.toModel() }
            .sortedBy { it.start }

    /**
     * The worker's NEXT (closest-start) pending float as the narrower [FloatAck] the
     * existing ack hero/modal renders, or `null` if none is outstanding. Derived from
     * [fetchPendingFloats] so it shares the robust bounded read.
     */
    suspend fun fetchPendingFloat(userId: String): FloatAck? = fetchPendingFloats(userId).firstOrNull()?.toFloatAck()

    /**
     * The worker's floats RESOLVED within the last 24h (acknowledged / declined / voided)
     * for the collapsible "Recent float requests" section. Reads the bounded
     * `worker_recent_floats` view. Unlike [fetchPendingFloats], that view is NOT
     * security_invoker: a declined/voided float's destination blocks are vacated (no longer
     * the worker's), so an invoker view could not aggregate the window. The view runs as its
     * owner and self-scopes to `fa.user_id = auth.uid()`; the eq filter here is parity belt
     * and suspenders. Unknown statuses are dropped ([toModel] returns null).
     */
    suspend fun fetchRecentFloats(userId: String): List<RecentFloat> =
        supabase
            .from(VIEW_RECENT_FLOATS)
            .select {
                filter { eq("user_id", userId) }
                order("resolved_at", Order.DESCENDING)
            }
            .decodeList<RecentFloatWireRow>()
            .mapNotNull { it.toModel() }

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
     * Acknowledge an off-hours Allied-page ladder alert ("I've called the desk") →
     * the `acknowledge-allied-page` Edge Function (staggered-rollout pilot; migration
     * 20260713000001). Resolves the ladder so no further rung (SM, then desk) fires. The
     * EF verifies the caller actually received the alert for this block. Best-effort +
     * idempotent on terminal state (already acknowledged/resolved).
     */
    suspend fun acknowledgeAlliedPage(blockId: String): EdgeResult =
        edge.invoke(
            "acknowledge-allied-page",
            Json.encodeToString(AlliedPageActionRequest(blockId = blockId)),
        )

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
     * Range: the WHOLE week is bounded server-side — `start_at >= weekStart` AND
     * `end_at <= weekEnd`. The upper bound rides on `end_at` (a DIFFERENT column) on
     * purpose: a second filter on the SAME column is dropped by supabase-kt, so the
     * old code over-fetched from weekStart onward and discarded the tail in Kotlin.
     * Worse, with PostgREST's 1000-row cap that over-fetch returned an ARBITRARY 1000
     * rows of the house's whole future schedule, so a navigated week came back as a
     * scattered partial slice (blocks could not coalesce → tiny chips). Bounding both
     * ends + ordering ASC fetches exactly this week's seats (well under the cap), so
     * contiguous runs survive and render as full-height blocks. Reading the wall clock
     * here is fine (host/data layer).
     */
    suspend fun fetchHouseSchedule(userId: String): HouseScheduleSnapshot? =
        fetchHouseScheduleForWeek(userId, kotlin.time.Clock.System.now())

    /**
     * The home-house grid for the NY week containing [anchor] — the week-navigable form
     * the swap CALENDAR (CALENDAR_REDESIGN.md) pages through so a worker can swap into
     * next week / back to last week. Same read model + RLS + same-column-filter handling
     * as the current-week [fetchHouseSchedule], just bounded by [anchor]'s week. The
     * House tab keeps using the current-week call; only the swap picker pages weeks.
     */
    suspend fun fetchHouseScheduleForWeek(
        userId: String,
        anchor: kotlin.time.Instant,
    ): HouseScheduleSnapshot? {
        val houseId =
            runCatching {
                supabase
                    .from(TABLE_USERS)
                    .select(Columns.list("home_house_id")) { filter { eq("user_id", userId) } }
                    .decodeSingleOrNull<HomeHouseRow>()
                    ?.homeHouseId
            }.getOrNull() ?: return null
        val (weekStart, weekEnd) = calendarWeekBounds(anchor)
        val rows =
            runCatching {
                supabase
                    .from(VIEW_HOUSE_GRID)
                    .select {
                        filter {
                            eq("house_id", houseId)
                            gte("start_at", weekStart.toString())
                            lte("end_at", weekEnd.toString())
                        }
                        order("start_at", Order.ASCENDING)
                    }
                    .decodeList<HouseGridRow>()
            }.getOrNull() ?: return null
        val seats = rows.map { it.toSeat() }
        val houseName = rows.firstOrNull()?.houseName ?: houseId
        val deskPhone = rows.firstOrNull { it.deskPhone != null }?.deskPhone
        return HouseScheduleSnapshot(houseName = houseName, deskPhone = deskPhone, seats = seats, houseId = houseId)
    }

    /**
     * Every house a worker may VIEW in the House tab (2026-06-23 cross-house ruling) —
     * `houses` (id / name / desk_phone), `houses_authenticated_read` RLS. The switcher
     * defaults to the worker's home house but lists them all (read-only). Best-effort:
     * an unreadable result yields an empty list (the tab then shows only the home house).
     */
    suspend fun fetchHouses(): List<HouseOption> =
        runCatching {
            // worker_visible_houses filters to LIVE houses (staggered-launch gate); a
            // dark house never appears in the cross-house switcher during a pilot.
            supabase
                .from(TABLE_WORKER_VISIBLE_HOUSES)
                .select(Columns.list("id", "name", "desk_phone"))
                .decodeList<HouseOptionRow>()
        }.getOrDefault(emptyList())
            .map { HouseOption(id = it.id, name = it.name, deskPhone = it.deskPhone) }
            .sortedBy { it.name }

    /**
     * Staggered-launch gate (rollout): has the signed-in worker's home house gone live yet?
     * Resolves the worker's `home_house_id` (own-row RLS) + its display name (authenticated
     * `houses` read), then delegates to the `house_is_live` RPC (SECURITY DEFINER, folds in
     * the master switch), so a worker at a not-yet-launched house sees the "coming soon"
     * placeholder (named after their house) instead of an empty app.
     * FAIL-OPEN: any unreadable step defaults to live, so a transient error never locks a
     * worker out of an already-launched house (the gate is a soft UX guard, not security).
     */
    suspend fun fetchHomeHouseGate(userId: String): HomeHouseGate {
        val homeHouseId =
            runCatching {
                supabase
                    .from(TABLE_USERS)
                    .select(Columns.list("home_house_id")) { filter { eq("user_id", userId) } }
                    .decodeSingleOrNull<HomeHouseRow>()
                    ?.homeHouseId
            }.getOrNull() ?: return HomeHouseGate(isLive = true, houseName = "your house")
        val houseName =
            runCatching {
                supabase
                    .from(TABLE_HOUSES)
                    .select(Columns.list("name")) { filter { eq("id", homeHouseId) } }
                    .decodeSingleOrNull<LaunchHouseNameRow>()
                    ?.name
            }.getOrNull() ?: homeHouseId
        val isLive =
            runCatching {
                supabase.postgrest
                    .rpc("house_is_live", buildJsonObject { put("p_house_id", homeHouseId) })
                    .decodeAs<Boolean>()
            }.getOrDefault(true)
        return HomeHouseGate(isLive = isLive, houseName = houseName)
    }

    /**
     * Any house's schedule grid for the NY week containing [anchor] (2026-06-23 cross-house
     * ruling) — the owner-rights `house_schedule_grid_any` view, which exposes EVERY house
     * (read visibility only; no write path) so a worker can open a house other than their
     * own. Same projection + same whole-week server-side bound (`start_at >= weekStart`
     * AND `end_at <= weekEnd`, ordered ASC) as the home-house [fetchHouseScheduleForWeek]
     * — so paging weeks fetches exactly that week's seats (no over-fetch, no 1000-row-cap
     * truncation); the [houseId] is supplied by the switcher rather than resolved from the
     * caller's `users` row. Returns null only when the grid can't be read.
     */
    suspend fun fetchHouseGridForWeek(
        houseId: String,
        anchor: kotlin.time.Instant,
    ): HouseScheduleSnapshot? {
        val (weekStart, weekEnd) = calendarWeekBounds(anchor)
        val rows =
            runCatching {
                supabase
                    .from(VIEW_HOUSE_GRID_ANY)
                    .select {
                        filter {
                            eq("house_id", houseId)
                            gte("start_at", weekStart.toString())
                            lte("end_at", weekEnd.toString())
                        }
                        order("start_at", Order.ASCENDING)
                    }
                    .decodeList<HouseGridRow>()
            }.getOrNull() ?: return null
        val seats = rows.map { it.toSeat() }
        val houseName = rows.firstOrNull()?.houseName ?: houseId
        val deskPhone = rows.firstOrNull { it.deskPhone != null }?.deskPhone
        return HouseScheduleSnapshot(houseName = houseName, deskPhone = deskPhone, seats = seats, houseId = houseId)
    }

    /**
     * The cross-house staff-worker directory for the §8.5 hand-off recipient picker —
     * every active worker (`worker_directory`, the owner-rights full-contact view any
     * authenticated worker may read per the 2026-06-12 ruling) tagged with their home
     * house's display name (the `houses` table, `houses_authenticated_read` RLS). Two
     * reads joined in Kotlin: a worker with no home house (e.g. a building manager) is
     * dropped — they staff no house's shifts. Best-effort: an unreadable result yields an
     * empty list (the picker then shows only the demo/My-House fallback). The SERVER stays
     * authoritative for eligibility on create/accept; the pure `buildHandoffDirectory`
     * pre-filter is UX only.
     */
    suspend fun fetchWorkerDirectory(): List<HandoffWorker> {
        // Staffable only: a pseudo-house owns the Allied account, never a recipient.
        val houseNames =
            runCatching {
                supabase
                    .from(TABLE_HOUSES)
                    .select(Columns.list("id", "name")) { filter { eq("is_staffable", true) } }
                    .decodeList<DirectoryHouseRow>()
            }.getOrDefault(emptyList())
                .associate { it.id to it.name }
        val workers =
            runCatching {
                supabase
                    .from(VIEW_WORKER_DIRECTORY)
                    .select(Columns.list("user_id", "name", "home_house_id"))
                    .decodeList<WorkerDirectoryRow>()
            }.getOrDefault(emptyList())
        return workers.mapNotNull { row ->
            val houseId = row.homeHouseId ?: return@mapNotNull null
            val houseName = houseNames[houseId] ?: return@mapNotNull null
            HandoffWorker(
                userId = row.userId,
                name = row.name,
                homeHouseId = houseId,
                homeHouseName = houseName,
            )
        }
    }

    /**
     * The break CALENDAR snapshot (Break redesign B3): the worker's home-house
     * `house_schedule_grid` scoped to the break window [startDate, endDate], plus the
     * live `break_claim_phase`. The grid (security_invoker) is RLS-scoped to the home
     * house and carries `block_id` + `required_headcount` (migration 20260615000001) so
     * the pure picker can address blocks and render coverage. Returns null when the
     * profile/grid can't be read (the caller keeps the demo snapshot).
     *
     * Range: `start_at >= windowStart` is filtered server-side; the inclusive end is
     * enforced in Kotlin (supabase-kt drops a second filter on the same column). Reading
     * the wall clock for the phase is fine (host/data layer).
     */
    /**
     * Host-friendly overload — the androidApp has no direct kotlinx-datetime dependency, so
     * it passes the whole [BreakRepository.ActiveBreak] rather than naming its LocalDate
     * window fields.
     */
    suspend fun fetchBreakCalendarFor(
        userId: String,
        activeBreak: BreakRepository.ActiveBreak,
    ): BreakCalendarSnapshot? =
        fetchBreakCalendar(userId, activeBreak.breakId, activeBreak.breakName, activeBreak.startDate, activeBreak.endDate)

    suspend fun fetchBreakCalendar(
        userId: String,
        breakId: String,
        breakName: String,
        startDate: LocalDate,
        endDate: LocalDate,
    ): BreakCalendarSnapshot? {
        val houseId =
            runCatching {
                supabase
                    .from(TABLE_USERS)
                    .select(Columns.list("home_house_id")) { filter { eq("user_id", userId) } }
                    .decodeSingleOrNull<HomeHouseRow>()
                    ?.homeHouseId
            }.getOrNull() ?: return null
        val windowStart = LocalDateTime(startDate, LocalTime(0, 0)).toInstant(NEW_YORK)
        val windowEndExclusive = LocalDateTime(endDate.plus(1, DateTimeUnit.DAY), LocalTime(0, 0)).toInstant(NEW_YORK)
        val rows =
            runCatching {
                supabase
                    .from(VIEW_HOUSE_GRID)
                    .select {
                        filter {
                            eq("house_id", houseId)
                            gte("start_at", windowStart.toString())
                        }
                    }
                    .decodeList<BreakGridRow>()
            }.getOrNull() ?: return null
        val seats =
            rows
                .map { it.toBreakSeat() }
                .filter { it.start < windowEndExclusive } // inclusive end, client-side (same-column gotcha)
        val phase =
            runCatching {
                supabase.postgrest
                    .rpc(
                        "break_claim_phase",
                        buildJsonObject {
                            put("p_break_id", breakId)
                            put("p_as_of", kotlin.time.Clock.System.now().toString())
                        },
                    ).decodeAs<String>()
            }.getOrNull()
        val houseName = rows.firstOrNull()?.houseName ?: houseId
        return BreakCalendarSnapshot(
            houseName = houseName,
            breakName = breakName,
            phase = BreakPhase.fromWire(phase),
            meUserId = userId,
            seats = seats,
            windowStart = startDate,
            windowEnd = endDate,
        )
    }

    /**
     * Monday (NY) of [now]'s week minus one week, at 00:00 NY — the lower bound of the
     * navigable calendar window (last-week … +4). DST-correct: built from LocalDate
     * arithmetic then converted.
     */
    private fun navigableWindowStart(now: Instant): Instant {
        val date = now.toLocalDateTime(NEW_YORK).date
        val monday = date.plus(-(date.dayOfWeek.isoDayNumber - 1), DateTimeUnit.DAY)
        return LocalDateTime(monday.plus(-7, DateTimeUnit.DAY), LocalTime(0, 0)).toInstant(NEW_YORK)
    }

    /**
     * The worker's week snapshot, scoped to the navigable calendar window
     * [Monday(now) − 1 week, ∞), ascending by start.
     *
     * Why the lower bound + order: PostgREST hard-caps every response at
     * `db-max-rows` (1000). A worker holding a full semester of 30-minute blocks has
     * thousands of `worker_my_shifts` rows, so an UNbounded read returned an arbitrary
     * 1000 of them — and the late-inserted float-destination blocks were truncated out,
     * which is why a freshly-assigned DuBois float never appeared on the personal
     * calendar. Filtering `start_at >= Monday(now) − 7d` and ordering ASCENDING spends
     * the 1000-row budget on the relevant near-future weeks (the calendar navigates
     * last-week … +4), so the current week — and any imminent float in it — always
     * survives. The upper bound is intentionally omitted: a SECOND filter on the same
     * column is dropped by supabase-kt, and ascending + the cap already stops well
     * before the far future for a heavy worker. [now] defaults to the wall clock but
     * the live callers pass the business `now` (the sim-clock) so a time-travelled
     * test window matches the displayed weeks.
     */
    suspend fun fetchWorkerWeek(
        userId: String,
        now: Instant = kotlin.time.Clock.System.now(),
    ): WorkerSnapshot {
        val windowStart = navigableWindowStart(now).toString()
        val myShifts =
            supabase
                .from(VIEW_MY_SHIFTS)
                .select(MY_SHIFT_COLUMNS) {
                    filter {
                        eq("user_id", userId)
                        gte("start_at", windowStart)
                    }
                    order("start_at", Order.ASCENDING)
                }
                .decodeList<MyShiftRow>()
                .map { it.toModel() }
        val openShifts =
            supabase
                .from(VIEW_OPEN_SHIFTS)
                .select(OPEN_SHIFT_COLUMNS) {
                    filter {
                        eq("eligible_user_id", userId)
                        gte("start_at", windowStart)
                    }
                    order("start_at", Order.ASCENDING)
                }
                .decodeList<OpenShiftRow>()
                .map { it.toModel() }
        return WorkerSnapshot(myShifts = myShifts, openShifts = openShifts)
    }

    /**
     * Emits an initial snapshot, then a fresh snapshot on every change to the
     * worker's `shift_block_assignments` (e.g. a float assigned at T-2h). The
     * subscription relies on RLS to scope rows to the authenticated worker. [now]
     * fixes the navigable window (see [fetchWorkerWeek]); the live tree rebuilds the
     * subscription on a sim-clock change, so a fixed window per collection is fine.
     */
    fun observeWorkerWeek(
        userId: String,
        now: Instant = kotlin.time.Clock.System.now(),
    ): Flow<WorkerSnapshot> {
        // Cost audit F-02 + F-11. One SHARED upstream per (userId, now) window, fanned
        // out to every collector, instead of one Realtime channel + one refetch loop per
        // collector.
        //
        // Why this matters: iOS runs TWO collectors of this flow (ContentView's Shifts
        // and Calendar observables). Because the topic carries Random.nextLong(), those
        // were two distinct Realtime connections, each independently refetching on every
        // change — so an iOS client held 2 connections and, with the Calendar's extra
        // fetchPendingSwaps(), issued 5 queries per event where Android issued 2. At 12
        // pilot workers that is 24 concurrent connections instead of 12.
        //
        // shareIn with WhileSubscribed(replayExpiration = 0) is refcounted: the first
        // collector opens the channel, the second joins the SAME emission, and the
        // channel closes once the last collector goes away. replay = 1 means a late
        // second collector renders immediately from the last snapshot instead of forcing
        // a fresh round trip.
        //
        // NOTE the Random.nextLong() topic suffix survives, and must. It is not a leak:
        // supabase.channel() caches by name, so a shared NAME makes the second caller
        // invoke postgresChangeFlow on an already-joined channel, which throws ("You
        // cannot call postgresChangeFlow after joining the channel") and crashed the app
        // right after login. The fix is to share the FLOW, not the topic — there is now
        // only one subscriber per key, so only one topic is ever created.
        // KEY ON THE WINDOW, NOT ON `now`. This is load-bearing and easy to get wrong:
        // `now` comes from SimClock.now(), a MOVING clock, so the Shifts and Calendar
        // collectors call it milliseconds apart and get different Instants. Keying on the
        // raw instant would mint a separate flow per collector and quietly reproduce the
        // exact two-channels-per-user problem this exists to fix.
        //
        // fetchWorkerWeek uses `now` for one thing only -- deriving navigableWindowStart
        // (Monday of last week, 00:00 NY) -- so two collectors microseconds apart want
        // byte-identical data. The window start is stable across a whole week, which
        // makes it the correct identity. A sim-clock jump big enough to move the window
        // yields a new key and a new subscription, which is what should happen.
        val key = SubscriptionKey(userId, navigableWindowStart(now))
        sharedWorkerWeeks[key]?.let { return it }
        val shared =
            rawWorkerWeek(userId, now)
                .shareIn(
                    scope = repositoryScope,
                    started = SharingStarted.WhileSubscribed(replayExpirationMillis = 0),
                    replay = 1,
                )
        sharedWorkerWeeks[key] = shared
        return shared
    }

    // debounce() is still FlowPreview in kotlinx.coroutines. Opted in deliberately: it is
    // the operator this fix needs, it has been stable in practice for years, and the
    // fallback (a hand-rolled timer) would be more code doing the same thing less well.
    @OptIn(kotlinx.coroutines.FlowPreview::class)
    private fun rawWorkerWeek(
        userId: String,
        now: Instant,
    ): Flow<WorkerSnapshot> =
        flow {
            emit(fetchWorkerWeek(userId, now))
            val channel = supabase.channel("worker-shifts-$userId-${Random.nextLong()}")
            val changes =
                channel.postgresChangeFlow<PostgresAction>(schema = "public") {
                    table = "shift_block_assignments"
                }
            channel.subscribe()
            try {
                changes
                    // F-02: the refetch was 1:1 with Realtime events and undebounced,
                    // and each refetch is TWO wide view reads. The write amplifiers make
                    // that dangerous rather than merely wasteful: publish_schedule stamps
                    // a template week across a whole semester, and apply_compiled_season
                    // reconciles every future block row-by-row inside a PL/pgSQL loop —
                    // ~35,000 blocks on current data. Every touched row emits a WAL
                    // record (REPLICA IDENTITY FULL, so the whole old row), which
                    // Realtime decodes, RLS-checks per subscriber and delivers, and each
                    // delivery triggered another full refetch with no backoff. An admin
                    // applying a season during business hours would put the database into
                    // a sustained refetch storm.
                    //
                    // debounce + conflate collapses a bulk write into ONE refetch per
                    // client: debounce waits for the burst to stop, conflate drops
                    // superseded emissions while a refetch is still in flight.
                    //
                    // 500 ms is a product decision (2026-07-26), not an arbitrary
                    // constant: invisible to a human, and well inside the margin for the
                    // thing that must stay prompt — a float landing at T-2h.
                    .map { }
                    // Audit F9: merge the manual refresh signal in alongside Realtime.
                    // A seat reassigned AWAY from this worker leaves their RLS scope, so
                    // postgres_changes delivers no event at all and the optimistic card
                    // would never reconcile. See [WorkerWeekRefresh].
                    .let { realtime -> merge(realtime, refresh.stream) }
                    .debounce(REALTIME_REFETCH_DEBOUNCE_MS)
                    .conflate()
                    .collect { emit(fetchWorkerWeek(userId, now)) }
            } finally {
                runCatching { supabase.realtime.removeChannel(channel) }
            }
        }

    /**
     * Identity of a shared worker-week subscription: same worker, same navigable window.
     * [windowStart] is `navigableWindowStart(now)`, deliberately NOT the raw `now` -- see
     * the note in [observeWorkerWeek].
     */
    private data class SubscriptionKey(val userId: String, val windowStart: Instant)

    // Swap + notification READS and their Realtime channel live in
    // [SwapActivityRepository]. They moved out of this file when swaps gained a live
    // subscription (2026-07-28): this class is the quarantined God class, and the new
    // surface is a self-contained concern with its own channel and refetch signal.
    // The swap WRITES below stay here, next to the other Edge Function calls.

    /**
     * Propose a swap (§8.1-§8.4, D2/D3) → the `create-swap` Edge Function. The
     * SERVER is authoritative for §8 eligibility (the packages/core module),
     * ownership, pending-swap conflicts, break-profile guards and expiry; this
     * just maps the picked proposal to the EF body. A permanent swap names the
     * recurring slot via the same NY-local identity `permanent-drop` uses
     * (house + day-of-week + the span's HH:MM block starts). Best-effort — the
     * UI shows a "proposed" toast and the feed's outgoing entry follows on the
     * next snapshot; a 4xx/409 simply means no request was created.
     */
    suspend fun createSwap(proposal: SwapProposal): EdgeResult {
        val body =
            buildJsonObject {
                put("swap_type", proposal.swapType)
                put("counterparty_user_id", proposal.counterpartyUserId)
                putJsonArray("initiator_assignment_ids") {
                    proposal.initiatorAssignmentIds.forEach { add(it) }
                }
                proposal.counterpartyAssignmentIds?.let { ids ->
                    putJsonArray("counterparty_assignment_ids") { ids.forEach { add(it) } }
                }
                if (proposal.swapType == "permanent_swap") {
                    // A partial permanent swap names only its trimmed span; whole-slot when unset.
                    val slotStart = proposal.recurringSlotStart ?: proposal.initiatorShift.start
                    val slotEnd = proposal.recurringSlotEnd ?: proposal.initiatorShift.end
                    val slot = slotFor(proposal.initiatorShift.house.id, slotStart, slotEnd)
                    putJsonObject("recurring_pattern") {
                        put("house_id", slot.houseId)
                        put("day_of_week", slot.dayOfWeek)
                        putJsonArray("block_start_locals") { slot.blockStartLocals.forEach { add(it) } }
                    }
                }
            }
        return edge.invoke("create-swap", body.toString())
    }

    /**
     * Cancel the worker's own outgoing pending swap (D4) → the `void-swap` Edge
     * Function (`{ swap_id }`; either party may void a pending request — the EF
     * filters to pending + own party, idempotent `not_pending` 409 otherwise).
     */
    suspend fun voidSwap(swapId: String): EdgeResult =
        edge.invoke("void-swap", Json.encodeToString(SwapActionRequest(swapId = swapId)))

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
            // Unique topic per collection (see observeWorkerWeek) so a second collector
            // never calls postgresChangeFlow on an already-joined channel.
            val channel = supabase.channel("worker-notifications-$userId-${Random.nextLong()}")
            val inserts =
                channel.postgresChangeFlow<PostgresAction.Insert>(schema = "public") {
                    table = "notifications"
                }
            channel.subscribe()
            try {
                inserts.collect { action ->
                    action.record.toToast()?.let { emit(it) }
                }
            } finally {
                runCatching { supabase.realtime.removeChannel(channel) }
            }
        }

    private companion object {
        /**
         * Realtime refetch debounce (cost audit F-02). Product decision 2026-07-26:
         * 500 ms is invisible to a human and still well inside the margin for a float
         * landing at T-2h, while collapsing a 35,000-row bulk write into one refetch.
         */
        const val REALTIME_REFETCH_DEBOUNCE_MS = 500L

        /**
         * Explicit column lists for the two hot feeds and the notifications read
         * (cost audit F-12). These were bare `.select()`, i.e. `select *` on wide views,
         * on the path that every Realtime event re-runs. The narrow pattern was already
         * established at SwapActivityRepository's swap reads; it just was not applied
         * consistently.
         *
         * Keep these in sync with [MyShiftRow] / [OpenShiftRow] / [NotificationWireRow]:
         * a column named here but absent from the row type is wasted egress, and a field
         * in the row type but missing here decodes to its default and silently changes
         * behaviour. Every name below is consumed by the corresponding decoder.
         */
        val MY_SHIFT_COLUMNS = Columns.list(
            "id", "house_id", "house_name", "start_at", "end_at", "kind",
            "cross_house", "pending", "break_shift", "dropped_still_open",
        )
        val OPEN_SHIFT_COLUMNS = Columns.list(
            "id", "house_id", "house_name", "start_at", "end_at", "feed",
            "home_house", "weeks_remaining", "desk_covered", "coverage_locked",
        )
        val NOTIFICATION_COLUMNS = Columns.list(
            "notification_id", "type", "payload", "created_at", "acknowledged_at",
        )

        const val VIEW_MY_SHIFTS = "worker_my_shifts"
        const val VIEW_OPEN_SHIFTS = "worker_open_shifts"
        const val VIEW_PENDING_FLOATS = "worker_pending_floats"
        const val VIEW_RECENT_FLOATS = "worker_recent_floats"
        const val TABLE_NOTIFICATIONS = "notifications"
        const val TABLE_FLOAT_ASSIGNMENTS = "float_assignments"
        const val TABLE_USERS = "users"
        const val TABLE_SWAP_REQUESTS = "swap_requests"
        const val VIEW_HOUSE_GRID = "house_schedule_grid"
        const val VIEW_HOUSE_GRID_ANY = "house_schedule_grid_any"
        const val VIEW_WORKER_DIRECTORY = "worker_directory"
        const val TABLE_HOUSES = "houses"
        const val TABLE_WORKER_VISIBLE_HOUSES = "worker_visible_houses"
    }
}

/** One `worker_directory` row — the §8.5 hand-off recipient pool (active workers). */
@Serializable
internal data class WorkerDirectoryRow(
    @SerialName("user_id") val userId: String,
    val name: String,
    @SerialName("home_house_id") val homeHouseId: String? = null,
)

/** A `houses` row → the home-house display name for the directory (grouping label). */
@Serializable
internal data class DirectoryHouseRow(
    val id: String,
    val name: String,
)

/** A `houses` row for the House-tab switcher (id / name / desk phone). */
@Serializable
internal data class HouseOptionRow(
    val id: String,
    val name: String,
    @SerialName("desk_phone") val deskPhone: String? = null,
)

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
    // The contact-card fields (20260722000001). The occupant's HOME house, which is not
    // the grid's `house_name` (the desk being staffed) whenever they're a float-in.
    @SerialName("worker_email") val workerEmail: String? = null,
    @SerialName("worker_home_house_id") val workerHouseId: String? = null,
    @SerialName("worker_home_house_name") val workerHouseName: String? = null,
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
        workerEmail = workerEmail,
        workerHouseName = workerHouseName,
        workerHouseId = workerHouseId,
    )

/** A `house_schedule_grid` row for the break calendar (carries block_id + required_headcount). */
@Serializable
internal data class BreakGridRow(
    val id: String,
    @SerialName("house_name") val houseName: String,
    @SerialName("start_at") val startAt: String,
    @SerialName("end_at") val endAt: String,
    val status: String,
    @SerialName("block_id") val blockId: String,
    @SerialName("required_headcount") val requiredHeadcount: Int = 1,
    @SerialName("user_id") val userId: String? = null,
    @SerialName("worker_name") val workerName: String? = null,
)

internal fun BreakGridRow.toBreakSeat(): BreakCalendarSeat =
    BreakCalendarSeat(
        id = id,
        blockId = blockId,
        start = Instant.parse(startAt),
        end = Instant.parse(endAt),
        status = status,
        requiredHeadcount = requiredHeadcount,
        userId = userId,
        workerName = workerName,
    )

/** Result of a [WorkerShiftsRepository.claimBreakRange]: which seats the server truly claimed. */
data class BreakRangeResult(
    val ok: Boolean,
    val claimedAssignmentIds: List<String>,
)

/** `break-claim` drag request — the dragged block ids the EF claims one open seat each. */
@Serializable
private data class BreakRangeRequest(
    @SerialName("block_ids") val blockIds: List<String>,
    @SerialName("claim_type") val claimType: String,
)

/** Parse the `break-claim` drag response `{ claimed: [{ block_id, assignment_id }] }`. */
internal fun parseClaimedAssignmentIds(body: String): List<String> =
    runCatching {
        Json { ignoreUnknownKeys = true }
            .decodeFromString<JsonObject>(body)["claimed"]
            ?.jsonArray
            ?.mapNotNull { it.jsonObject["assignment_id"]?.jsonPrimitive?.content }
            ?: emptyList()
    }.getOrDefault(emptyList())

/** The worker's own pending counterparty `swap_requests` row (T3a wire shape). */
@Serializable
internal data class SwapRequestRow(
    @SerialName("swap_id") val swapId: String,
    @SerialName("swap_type") val swapType: String,
    @SerialName("created_at") val createdAt: String,
    @SerialName("expires_at") val expiresAt: String,
)

/** A row of the `worker_pending_swaps` read model (both directions, enriched spans). */
@Serializable
internal data class WorkerPendingSwapRow(
    @SerialName("swap_id") val swapId: String,
    @SerialName("swap_type") val swapType: String,
    val direction: String, // 'incoming' | 'outgoing'
    @SerialName("created_at") val createdAt: String,
    @SerialName("expires_at") val expiresAt: String,
    @SerialName("other_user_name") val otherUserName: String? = null,
    @SerialName("initiator_assignment_ids") val initiatorAssignmentIds: List<String> = emptyList(),
    @SerialName("counterparty_assignment_ids") val counterpartyAssignmentIds: List<String>? = null,
    @SerialName("initiator_start") val initiatorStart: String? = null,
    @SerialName("initiator_end") val initiatorEnd: String? = null,
    @SerialName("initiator_blocks") val initiatorBlocks: Int = 0,
    @SerialName("initiator_house_name") val initiatorHouseName: String? = null,
    @SerialName("counterparty_start") val counterpartyStart: String? = null,
    @SerialName("counterparty_end") val counterpartyEnd: String? = null,
    @SerialName("counterparty_blocks") val counterpartyBlocks: Int = 0,
    @SerialName("counterparty_house_name") val counterpartyHouseName: String? = null,
)

/** The worker's own `home_house_id` (own-row `users` RLS) — for the closed-day lookup. */
@Serializable
internal data class HomeHouseRow(
    @SerialName("home_house_id") val homeHouseId: String,
)

/** A house display name by id (authenticated `houses` read) — for the launch gate. */
@Serializable
internal data class LaunchHouseNameRow(
    val name: String,
)

/**
 * Result of the staggered-launch home-house gate: whether the worker's home house is live
 * yet, plus its display name for the "coming soon" placeholder.
 */
data class HomeHouseGate(
    val isLive: Boolean,
    val houseName: String,
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
    // Server-authoritative coverage flags (§5.4/§5.5) — see OpenShift.
    @SerialName("desk_covered") val deskCovered: Boolean = false,
    @SerialName("coverage_locked") val coverageLocked: Boolean = false,
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
        deskCovered = deskCovered,
        coverageLocked = coverageLocked,
    )

private fun parseAssignmentKind(raw: String): AssignmentKind =
    when (raw.lowercase()) {
        "permanent_pickup" -> AssignmentKind.PERMANENT_PICKUP
        "temp_pickup" -> AssignmentKind.TEMP_PICKUP
        "float_out" -> AssignmentKind.FLOAT_OUT
        else -> AssignmentKind.SCHEDULED
    }

/**
 * A `worker_pending_floats` row — one pending float for the worker, with the
 * destination house and full window aggregated from the destination blocks (RLS-scoped
 * to the worker). Drives the float-request carousel and the ack hero.
 */
@Serializable
internal data class PendingFloatDetailRow(
    @SerialName("float_id") val floatId: String,
    @SerialName("destination_house_id") val houseId: String,
    @SerialName("destination_house_name") val houseName: String,
    @SerialName("float_start") val floatStart: String,
    @SerialName("float_end") val floatEnd: String,
    @SerialName("block_count") val blockCount: Int,
)

private fun PendingFloatDetailRow.toModel(): PendingFloat =
    PendingFloat(
        floatId = floatId,
        destinationHouse = House(houseId, houseName),
        start = Instant.parse(floatStart),
        end = Instant.parse(floatEnd),
        blockCount = blockCount,
    )

/**
 * A `worker_recent_floats` row — one float RESOLVED for the worker in the last 24h, with
 * the destination house, window, terminal status, and resolution time. Drives the recent
 * section. Unknown / non-terminal statuses map to null and are dropped.
 */
@Serializable
internal data class RecentFloatWireRow(
    @SerialName("float_id") val floatId: String,
    @SerialName("destination_house_id") val houseId: String,
    @SerialName("destination_house_name") val houseName: String,
    @SerialName("float_start") val floatStart: String,
    @SerialName("float_end") val floatEnd: String,
    val status: String,
    @SerialName("resolved_at") val resolvedAt: String,
)

private fun RecentFloatWireRow.toModel(): RecentFloat? {
    val mapped =
        when (status) {
            "acknowledged" -> RecentFloatStatus.ACCEPTED
            "declined" -> RecentFloatStatus.DECLINED
            "voided" -> RecentFloatStatus.EXPIRED
            else -> return null
        }
    return RecentFloat(
        floatId = floatId,
        destinationHouse = House(houseId, houseName),
        start = Instant.parse(floatStart),
        end = Instant.parse(floatEnd),
        status = mapped,
        resolvedAt = Instant.parse(resolvedAt),
    )
}

@Serializable
internal data class NotificationWireRow(
    @SerialName("notification_id") val id: String,
    val type: String,
    val payload: JsonObject = JsonObject(emptyMap()),
    @SerialName("created_at") val createdAt: String,
    @SerialName("acknowledged_at") val acknowledgedAt: String? = null,
)

internal fun NotificationWireRow.toNotificationItem(): NotificationItem =
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
        // Off-hours ladder alert (staggered-rollout pilot): `allied_page` rows carry the
        // block to acknowledge + the desk phone to call.
        alliedPageBlockId = payload["block_id"]?.jsonPrimitive?.content,
        deskPhone = payload["desk_phone"]?.jsonPrimitive?.content,
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

/** `acknowledge-allied-page` request — the coverage-locked block to acknowledge. */
@Serializable
private data class AlliedPageActionRequest(
    @SerialName("block_id") val blockId: String,
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

/**
 * The `break-claim` EF response's authoritative weekly-hours projection
 * (`{ ..., currentHours, projectedHours }` — the `claim_hours_projection` RPC),
 * or null when absent/unparseable. The picker meter reconciles to it (D6).
 */
fun parseProjectedHours(body: String): Double? =
    runCatching {
        Json { ignoreUnknownKeys = true }
            .decodeFromString<JsonObject>(body)["projectedHours"]
            ?.jsonPrimitive
            ?.content
            ?.toDoubleOrNull()
    }.getOrNull()

private fun JsonObject.toToast(): ToastNotification? {
    val title = this["title"]?.jsonPrimitive?.content ?: return null
    val body = this["body"]?.jsonPrimitive?.content ?: this["message"]?.jsonPrimitive?.content ?: ""
    return ToastNotification(title = title, body = body)
}
