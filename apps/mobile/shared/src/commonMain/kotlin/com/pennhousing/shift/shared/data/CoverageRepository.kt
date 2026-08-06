package com.pennhousing.shift.shared.data

import com.pennhousing.shift.shared.manager.coverage.CoverageOutcome
import com.pennhousing.shift.shared.manager.coverage.CoverageRequest
import com.pennhousing.shift.shared.manager.coverage.CoverageRung
import com.pennhousing.shift.shared.manager.coverage.DEFAULT_RUNG_TIMEOUT_MINUTES
import com.pennhousing.shift.shared.network.EdgeFunctionClient
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.realtime.PostgresAction
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.postgresChangeFlow
import io.github.jan.supabase.realtime.realtime
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.conflate
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.random.Random
import kotlin.time.Instant

/*
 * Allied coverage-request data layer for manager mode (BSpec §5.4a;
 * docs/manager-app/SPEC.md §6.1 / §7).
 *
 * The mobile analogue of the Edge/HTTP layer the phase-13a test plan scopes out, so it is
 * intentionally untested by kotlin.test; the decisions live in
 * `manager/coverage/Coverage.kt` and `viewmodel/CoverageViewModel.kt`, which ARE tested.
 * Correctness of the wiring here is verified against a running backend.
 *
 * READ — `allied_coverage_requests`, whose SELECT policy is already scoped to
 * `user_can_build_schedule(house_id)` plus an admin clause. The client therefore does NOT
 * filter by house: it renders what RLS returned, exactly as every other read in this app
 * does. `houses` supplies the display name and the desk phone (authenticated read).
 *
 * WRITE — the `allied-coverage` Edge Function, because
 * `acknowledge_allied_coverage_request` / `close_allied_coverage_request` are granted to
 * `service_role` only. The function derives the acting manager from the bearer token, so
 * nothing here sends a user id.
 *
 * NOT OFFLINE-QUEUED, DELIBERATELY. Unlike the worker write paths, an acknowledgement is
 * never handed to `PendingWriteStore`. A queued acknowledgement that never reaches the
 * server would silence this manager's own banner while the ladder keeps escalating and the
 * desk keeps heading for empty. Every method here reports failure to the caller, which
 * reverts the optimistic move and keeps alerting.
 */
class CoverageRepository(
    private val supabase: SupabaseClient,
    private val edge: EdgeFunctionClient = EdgeFunctionClient(),
) {
    /**
     * Every coverage request this manager may see, newest window first. Closed requests are
     * included: the pure `buildCoverageFeed` drops them, and reading them lets an open sheet
     * discover that a colleague closed the request out from under it.
     *
     * Best-effort: an unreadable result yields an empty list, which the Coverage tab renders
     * as its "All clear" empty state. That is the one place this is slightly dangerous, so
     * it is worth being explicit: a READ failure and a genuinely quiet night look the same
     * to the manager. The banner and badge are driven by the same data, so a silent read
     * failure cannot manufacture a false alarm, only a missed one, and the push notification
     * is the independent path that still fires. Do not add a retry loop here; the Realtime
     * subscription and the pull-to-refresh both re-enter this method.
     */
    suspend fun fetchCoverageRequests(): List<CoverageRequest> =
        runCatching {
            val rows =
                supabase
                    .from(TABLE_COVERAGE_REQUESTS)
                    .select(
                        Columns.list(
                            "request_id",
                            "house_id",
                            "window_start_at",
                            "window_end_at",
                            "reason",
                            "current_rung",
                            "rung_fired_at",
                            "acknowledged_at",
                            "closed_at",
                            "outcome",
                        ),
                    )
                    .decodeList<CoverageRequestRow>()
            if (rows.isEmpty()) return emptyList()

            val houses = fetchHouses(rows.map { it.houseId }.distinct())
            rows.map { row ->
                val house = houses[row.houseId]
                CoverageRequest(
                    requestId = row.requestId,
                    houseId = row.houseId,
                    // Fall back to the id rather than dropping the request: a missing join
                    // row must never hide a desk that is about to go empty.
                    houseName = house?.name ?: row.houseId,
                    windowStart = Instant.parse(row.windowStartAt),
                    windowEnd = Instant.parse(row.windowEndAt),
                    reason = row.reason,
                    currentRung = CoverageRung.fromWire(row.currentRung),
                    rungFiredAt = Instant.parse(row.rungFiredAt),
                    acknowledgedAt = row.acknowledgedAt?.let { Instant.parse(it) },
                    closedAt = row.closedAt?.let { Instant.parse(it) },
                    outcome = CoverageOutcome.fromWire(row.outcome),
                    deskPhone = house?.deskPhone,
                )
            }
        }.getOrDefault(emptyList())

    private suspend fun fetchHouses(houseIds: List<String>): Map<String, HouseRow> =
        runCatching {
            supabase
                .from(TABLE_HOUSES)
                .select(Columns.list("id", "name", "desk_phone")) {
                    filter { isIn("id", houseIds) }
                }
                .decodeList<HouseRow>()
                .associateBy { it.id }
        }.getOrDefault(emptyMap())

    /**
     * A live stream of the coverage snapshot: the current list, then a fresh read on any
     * change to `allied_coverage_requests`.
     *
     * NO SERVER-SIDE FILTER on the subscription, matching the worker paths: RLS already
     * scopes the rows, and the version-variable `postgresChangeFlow` filter DSL is a known
     * trap. The topic carries a random suffix because `supabase.channel()` caches by name,
     * and calling `postgresChangeFlow` on an already-joined channel throws.
     *
     * The debounce is much shorter than the worker week's 500ms. A coverage request is the
     * one thing in this system that must not feel laggy: the ladder advances on a timer and
     * a manager watching the screen should see an escalation land. There is also no bulk
     * writer against this table (no publish, no season apply), so the refetch storm the
     * worker path defends against does not exist here. 150ms only coalesces the
     * open-then-notify pair that arrives as two events.
     */
    @OptIn(FlowPreview::class)
    fun coverageStream(): Flow<List<CoverageRequest>> =
        flow {
            emit(fetchCoverageRequests())
            val channel = supabase.channel("allied-coverage-${Random.nextLong()}")
            val changes =
                channel.postgresChangeFlow<PostgresAction>(schema = "public") {
                    table = TABLE_COVERAGE_REQUESTS
                }
            channel.subscribe()
            try {
                changes
                    .map { }
                    .debounce(REALTIME_DEBOUNCE_MS)
                    .conflate()
                    .collect { emit(fetchCoverageRequests()) }
            } finally {
                runCatching { supabase.realtime.removeChannel(channel) }
            }
        }

    /**
     * The configured ladder cadence, for the card countdown. Falls back to the documented
     * defaults when the lookup fails: a slightly stale countdown beats a Coverage tab that
     * will not render.
     */
    suspend fun fetchLadderCadence(): LadderCadence {
        val result = edge.invoke("allied-coverage/context", "{}")
        if (!result.ok) return LadderCadence()
        return runCatching {
            val parsed = LENIENT_JSON.decodeFromString<LadderCadenceRow>(result.body)
            LadderCadence(
                rungTimeoutMinutes = parsed.rungTimeoutMinutes,
                reminderMinutes = parsed.reminderMinutes,
            )
        }.getOrDefault(LadderCadence())
    }

    /**
     * "I am handling this" — stops the ladder and the reminders. Fired the moment the
     * Respond sheet opens.
     *
     * Returns [CoverageWriteResult.Ok] on success, [CoverageWriteResult.AlreadyHandled] when
     * the request was closed or acknowledged elsewhere (a normal outcome under at-least-once
     * delivery, not an error), and [CoverageWriteResult.Failed] on anything else, which the
     * caller must treat as "still unhandled" and revert.
     */
    suspend fun acknowledge(requestId: String): CoverageWriteResult {
        val body = Json.encodeToString(AcknowledgeRequest(requestId = requestId))
        val result = edge.invoke("allied-coverage/acknowledge", body)
        if (!result.ok) return CoverageWriteResult.Failed
        return runCatching {
            val parsed = LENIENT_JSON.decodeFromString<AcknowledgeResponse>(result.body)
            if (parsed.acknowledged) CoverageWriteResult.Ok else CoverageWriteResult.AlreadyHandled
        }.getOrDefault(CoverageWriteResult.Failed)
    }

    /**
     * "Here is what actually happened" — records the outcome and closes the request. The
     * only way a request leaves the active list.
     *
     * [note] is required for [CoverageOutcome.DESK_UNSTAFFED]; the Edge Function and the RPC
     * both enforce that, so a missing note surfaces as [CoverageWriteResult.Failed] rather
     * than a silent success.
     *
     * [assignSelf] only means anything for [CoverageOutcome.COVERED_INTERNALLY]: it is what
     * distinguishes the Respond sheet's "I can cover it" action (assigns the ACTING manager
     * to the request's vacant blocks) from the generic "Covered internally" outcome row
     * (records the outcome only; the schedule is left as-is, since it is not necessarily this
     * manager who covered it).
     */
    suspend fun close(
        requestId: String,
        outcome: CoverageOutcome,
        note: String?,
        assignSelf: Boolean = false,
    ): CoverageWriteResult {
        val body =
            Json.encodeToString(
                CloseRequest(requestId = requestId, outcome = outcome.wire, note = note, assignSelf = assignSelf),
            )
        val result = edge.invoke("allied-coverage/close", body)
        if (!result.ok) return CoverageWriteResult.Failed
        return runCatching {
            val parsed = LENIENT_JSON.decodeFromString<CloseResponse>(result.body)
            if (parsed.closed) CoverageWriteResult.Ok else CoverageWriteResult.AlreadyHandled
        }.getOrDefault(CoverageWriteResult.Failed)
    }

    private companion object {
        const val TABLE_COVERAGE_REQUESTS = "allied_coverage_requests"
        const val TABLE_HOUSES = "houses"
        const val REALTIME_DEBOUNCE_MS = 150L
        val LENIENT_JSON = Json { ignoreUnknownKeys = true }
    }
}

/** How a coverage write resolved. */
enum class CoverageWriteResult {
    Ok,

    /**
     * The server said the request was already closed or already acknowledged. Not a failure:
     * a colleague got there first, or a duplicate push replayed. The optimistic local move
     * stands and the next snapshot reconciles.
     */
    AlreadyHandled,

    /** Transport or authorization failure. The caller must revert and keep alerting. */
    Failed,
}

/** The configured ladder intervals (BSpec §14). */
data class LadderCadence(
    val rungTimeoutMinutes: Int = DEFAULT_RUNG_TIMEOUT_MINUTES,
    val reminderMinutes: Int = 15,
)

// ----- Wire rows → pure inputs. -----

@Serializable
private data class CoverageRequestRow(
    @SerialName("request_id") val requestId: String,
    @SerialName("house_id") val houseId: String,
    @SerialName("window_start_at") val windowStartAt: String,
    @SerialName("window_end_at") val windowEndAt: String,
    val reason: String,
    @SerialName("current_rung") val currentRung: String,
    @SerialName("rung_fired_at") val rungFiredAt: String,
    @SerialName("acknowledged_at") val acknowledgedAt: String? = null,
    @SerialName("closed_at") val closedAt: String? = null,
    val outcome: String? = null,
)

@Serializable
private data class HouseRow(
    val id: String,
    val name: String,
    @SerialName("desk_phone") val deskPhone: String? = null,
)

@Serializable
private data class LadderCadenceRow(
    @SerialName("rung_timeout_minutes") val rungTimeoutMinutes: Int = DEFAULT_RUNG_TIMEOUT_MINUTES,
    @SerialName("reminder_minutes") val reminderMinutes: Int = 15,
)

// ----- Edge-Function request / response bodies. -----

@Serializable
private data class AcknowledgeRequest(
    @SerialName("request_id") val requestId: String,
)

@Serializable
private data class AcknowledgeResponse(
    val acknowledged: Boolean = false,
    val reason: String? = null,
)

@Serializable
private data class CloseRequest(
    @SerialName("request_id") val requestId: String,
    val outcome: String,
    val note: String? = null,
    val assignSelf: Boolean = false,
)

@Serializable
private data class CloseResponse(
    val closed: Boolean = false,
    val reason: String? = null,
)
