package com.pennhousing.shift.shared.data

import com.pennhousing.shift.shared.preferences.PrefBlock
import com.pennhousing.shift.shared.preferences.PrefBrush
import com.pennhousing.shift.shared.preferences.PreferencePeriod
import com.pennhousing.shift.shared.preferences.SubmitPreferencesPayload
import com.pennhousing.shift.shared.network.EdgeFunctionClient
import com.pennhousing.shift.shared.platform.SimClock
import com.pennhousing.shift.shared.shifts.MONTH_SHORT
import com.pennhousing.shift.shared.shifts.NEW_YORK
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Order
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.LocalDate
import kotlinx.datetime.LocalDateTime
import kotlinx.datetime.LocalTime
import kotlinx.datetime.minus
import kotlinx.datetime.plus
import kotlinx.datetime.toInstant
import kotlinx.datetime.toLocalDateTime
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.time.Instant

/**
 * Worker preference submission — the data layer behind the (pure, tested)
 * `PreferencesViewModel`. The mobile analogue of the Edge/HTTP layer the phase-13a
 * test plan scopes out, so it is intentionally untested by kotlin.test; correctness
 * is verified manually against a running backend.
 *
 * READ — [fetchActivePreferencePeriod] assembles the `PreferencePeriod` snapshot the
 * screen paints over, from four worker-readable sources (RLS scopes each to the caller):
 *   * `scheduling_periods` — the active submission window. Worker-readable only since
 *     migration 20260610000001 (FOR SELECT TO authenticated, open-or-published); the
 *     selection mirrors the web oversight (lib/data/preferences.ts): the most recent
 *     UNPUBLISHED period.
 *   * `users` (own row) — the worker's `home_house_id`; preferences are availability
 *     for the home-house schedule, so the grid is that house's blocks.
 *   * `shift_blocks` — ONE representative Mon-Sun week (the week containing the period
 *     start) of the home house's 30-minute blocks. `preferences.block_id` FKs a
 *     concrete dated block, and the design grid is a single week, so the worker paints
 *     that week and submit() upserts those block_ids.
 *   * `preferences` / `period_targets` (own rows) — any already-saved statuses + target
 *     to pre-fill, and whether the worker has already submitted (read-only state).
 *
 * WRITE — [submitPreferences] POSTs the payload `buildSubmitPayload` produced to the
 * phase-04 `submit-preferences` Edge Function (which verifies identity and calls the
 * `submit_preferences` RPC: deadline + array upsert enforced server-side). The POST
 * mirrors [com.pennhousing.shift.shared.platform.PushTokenRegistrar] — a raw Ktor
 * client carrying the worker's bearer token, since the shared Supabase client installs
 * no Functions plugin.
 */
class PreferencesRepository(
    private val supabase: SupabaseClient,
    private val edge: EdgeFunctionClient = EdgeFunctionClient(),
) {

    /**
     * The active preference period for [userId], or null when there is no open/published
     * period, no home house, or no blocks for the representative week (the caller falls
     * back to the demo period).
     */
    suspend fun fetchActivePreferencePeriod(userId: String): PreferencePeriod? {
        val homeHouseId =
            supabase
                .from("users")
                .select(Columns.list("home_house_id")) { filter { eq("user_id", userId) } }
                .decodeSingleOrNull<UserHomeRow>()
                ?.homeHouseId ?: return null

        // Most recent unpublished period, else most recent overall — exactly the web
        // oversight's `periods.find(p => p.published_at === null) ?? periods[0]`
        // (lib/data/preferences.ts). Picked in code to avoid an IS NULL filter; RLS
        // (migration 20260610000001) exposes only open-or-published rows.
        val periods =
            supabase
                .from("scheduling_periods")
                .select(
                    Columns.list("period_id", "period_name", "start_date", "preference_deadline", "published_at"),
                ) {
                    order("start_date", Order.DESCENDING)
                }
                .decodeList<SchedulingPeriodRow>()
        val period = periods.firstOrNull { it.publishedAt == null } ?: periods.firstOrNull() ?: return null

        val startDate = LocalDate.parse(period.startDate)
        // Monday on/before the period start; the representative week is [monday, +7d).
        val monday = startDate.minus(startDate.dayOfWeek.ordinal, DateTimeUnit.DAY)
        val weekStart = LocalDateTime(monday, LocalTime(0, 0)).toInstant(NEW_YORK)
        val weekEnd = LocalDateTime(monday.plus(7, DateTimeUnit.DAY), LocalTime(0, 0)).toInstant(NEW_YORK)

        val blocks =
            supabase
                .from("shift_blocks")
                .select(Columns.list("block_id", "block_start_at")) {
                    filter {
                        eq("house_id", homeHouseId)
                        gte("block_start_at", weekStart.toString())
                    }
                    order("block_start_at", Order.ASCENDING)
                }
                .decodeList<ShiftBlockRow>()

        // Group into 7 ascending day-lists (Mon=0 … Sun=6), keeping ONLY the representative
        // week. The upper bound is enforced HERE, not as a second REST filter: two filters
        // on the same column do not both reach PostgREST through the query builder, so the
        // range silently widens to gte-only and the response hits PostgREST's 1000-row cap
        // (which then piles ~31 days into the 7 day buckets). The server-side `gte` scopes
        // the fetch to this period's blocks ascending from its first day, so the week is
        // always at the front of the result; we stop as soon as we pass it.
        val days: List<MutableList<PrefBlock>> = List(7) { mutableListOf() }
        val weekBlockIds = HashSet<String>()
        for (row in blocks) {
            val start = Instant.parse(row.blockStartAt)
            if (start >= weekEnd) break
            val dow = start.toLocalDateTime(NEW_YORK).dayOfWeek.ordinal
            days[dow].add(PrefBlock(blockId = row.blockId, start = start))
            weekBlockIds.add(row.blockId)
        }
        if (weekBlockIds.isEmpty()) return null

        // Pre-fill: this worker's already-saved statuses for the period, limited to the
        // representative week's blocks (other weeks' rows are irrelevant to this grid).
        val initialStatuses =
            supabase
                .from("preferences")
                .select(Columns.list("block_id", "status")) {
                    filter {
                        eq("user_id", userId)
                        eq("period_id", period.periodId)
                    }
                }
                .decodeList<PreferenceRow>()
                .filter { it.blockId in weekBlockIds }
                .mapNotNull { row -> brushFor(row.status)?.let { row.blockId to it } }
                .toMap()

        val target =
            supabase
                .from("period_targets")
                .select(Columns.list("target_hours", "opted_out")) {
                    filter {
                        eq("user_id", userId)
                        eq("period_id", period.periodId)
                    }
                }
                .decodeSingleOrNull<PeriodTargetRow>()

        // Already submitted (web oversight's rule): any preferences row, or a target row.
        val submitted = initialStatuses.isNotEmpty() || target != null

        return PreferencePeriod(
            periodId = period.periodId,
            periodLabel = period.periodName,
            deadlineLabel = period.preferenceDeadline?.let { dueLabel(it) },
            submitted = submitted,
            // D9 (§4.2): a passed deadline locks the never-submitted grid client-side
            // (the submit_preferences RPC rejects late writes server-side regardless).
            deadlinePassed =
                period.preferenceDeadline?.let { Instant.parse(it) < SimClock.now() } ?: false,
            weekStart = monday,
            days = days,
            initialStatuses = initialStatuses,
            targetHours = target?.targetHours ?: 0,
            optedOut = target?.optedOut ?: false,
        )
    }

    /**
     * POST the worker's edits to the `submit-preferences` Edge Function. Returns true on
     * a 2xx. Best-effort: the caller flips the screen to its optimistic "submitted" state
     * regardless (mirroring the Shifts screen's claim/drop), and a failed POST surfaces
     * no row on the web oversight.
     */
    suspend fun submitPreferences(payload: SubmitPreferencesPayload): Boolean {
        val body =
            Json.encodeToString(
                SubmitPreferencesRequest(
                    periodId = payload.periodId,
                    preferences = payload.entries.map { SubmitPreferenceEntry(it.blockId, it.status) },
                    targetHours = payload.targetHours,
                    optedOut = payload.optedOut,
                ),
            )
        return edge.invoke("submit-preferences/preferences", body).ok
    }

    /** DB `preference_status_enum` → brush; `none` (and unknowns) leave the cell default. */
    private fun brushFor(status: String): PrefBrush? =
        when (status.lowercase()) {
            "preferred" -> PrefBrush.PREFERRED
            "cannot" -> PrefBrush.CANNOT
            "available" -> PrefBrush.AVAILABLE
            else -> null
        }

    /** "Due Jun 14 23:00" — the deadline, NY-anchored (invariant #6). */
    private fun dueLabel(deadlineIso: String): String {
        val ldt = Instant.parse(deadlineIso).toLocalDateTime(NEW_YORK)
        val mm = ldt.minute.toString().padStart(2, '0')
        return "Due ${MONTH_SHORT[ldt.month.ordinal]} ${ldt.day} ${ldt.hour}:$mm"
    }
}

// ----- Wire rows → pure inputs. -----

@Serializable
private data class UserHomeRow(
    @SerialName("home_house_id") val homeHouseId: String,
)

@Serializable
private data class SchedulingPeriodRow(
    @SerialName("period_id") val periodId: String,
    @SerialName("period_name") val periodName: String,
    @SerialName("start_date") val startDate: String,
    @SerialName("preference_deadline") val preferenceDeadline: String? = null,
    @SerialName("published_at") val publishedAt: String? = null,
)

@Serializable
private data class ShiftBlockRow(
    @SerialName("block_id") val blockId: String,
    @SerialName("block_start_at") val blockStartAt: String,
)

@Serializable
private data class PreferenceRow(
    @SerialName("block_id") val blockId: String,
    val status: String,
)

@Serializable
private data class PeriodTargetRow(
    @SerialName("target_hours") val targetHours: Int,
    @SerialName("opted_out") val optedOut: Boolean = false,
)

// ----- The `submit-preferences` Edge-Function request body. -----

@Serializable
private data class SubmitPreferencesRequest(
    @SerialName("period_id") val periodId: String,
    val preferences: List<SubmitPreferenceEntry>,
    @SerialName("target_hours") val targetHours: Int,
    @SerialName("opted_out") val optedOut: Boolean,
)

@Serializable
private data class SubmitPreferenceEntry(
    @SerialName("block_id") val blockId: String,
    val status: String,
)
