package com.pennhousing.shift.shared.data

import com.pennhousing.shift.shared.shifts.NEW_YORK
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Count
import io.github.jan.supabase.postgrest.query.Order
import kotlinx.datetime.LocalDate
import kotlinx.datetime.toLocalDateTime
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.time.Clock

/**
 * Live break data — the data layer behind the break CALENDAR screen. The mobile analogue
 * of the Edge/HTTP layer the phase-13a test plan scopes out, so it is intentionally
 * untested by kotlin.test; correctness is verified manually against a running backend.
 *
 * READ — [fetchActiveBreak] reads the active break row from `break_periods`,
 * worker-readable since migration 20260611000002 (FOR SELECT TO authenticated). The
 * "active/relevant" break is the soonest break that has not yet ended ([asOf] ≤
 * end_date), ordered by start_date ascending — the one whose claim window is open or
 * imminent. Its id + name + window scope the break-calendar grid read
 * ([WorkerShiftsRepository.fetchBreakCalendarFor]). There is no per-worker scoping: a
 * break period is not owned by a worker.
 *
 * OPT-OUT (§4.4, T2-2b) — the per-break "no break hours" control, the break analogue of
 * the regular-year no-hours opt-out (`period_targets.opted_out`). The `break_optouts`
 * table (PK `(break_id, user_id)`, only `opted_out_at`) carries NO flag column: the
 * PRESENCE of the worker's own row IS the opt-out. So the write is insert-on-opt-out /
 * delete-on-opt-in (idempotent upsert with `ignoreDuplicates`), and the read is "does my
 * own row exist". Worker RLS already permits select/insert/update/delete of OWN rows
 * (migration 20260531000002:36-59), so these go DIRECTLY through Postgrest — no EF/RPC.
 */
class BreakRepository(
    private val supabase: SupabaseClient,
) {

    /**
     * The active break's identity ([breakId]) + name + window, or null when there is no
     * current/upcoming break. The id is needed to target the §4.4 opt-out at the active
     * break; the window scopes the break-calendar grid read.
     */
    data class ActiveBreak(
        val breakId: String,
        val breakName: String,
        /** The break window (NY calendar dates) — the break-calendar grid read scopes to it. */
        val startDate: LocalDate,
        val endDate: LocalDate,
    )

    /**
     * The active break (id + name + window) — the soonest break that has not yet ended
     * ([asOf] ≤ end_date), ordered by start_date ascending. Returns the [breakId] too so
     * the §4.4 opt-out toggle can target it. Null when there is no current/upcoming break.
     */
    suspend fun fetchActiveBreak(): ActiveBreak? {
        val asOf = Clock.System.now().toLocalDateTime(NEW_YORK).date
        val candidates =
            supabase
                .from("break_periods")
                .select(Columns.list("break_id", "break_name", "start_date", "end_date")) {
                    filter { gte("end_date", asOf.toString()) }
                    order("start_date", Order.ASCENDING)
                }
                .decodeList<BreakPeriodRow>()
        val active = candidates.firstOrNull() ?: return null
        return ActiveBreak(
            breakId = active.breakId,
            breakName = active.breakName,
            startDate = LocalDate.parse(active.startDate),
            endDate = LocalDate.parse(active.endDate),
        )
    }

    /**
     * Whether [userId] has opted out of break hours for [breakId] (§4.4): true when the
     * worker's own `break_optouts` row exists. RLS scopes the read to own rows; we filter
     * on both keys defensively and ask for an exact count.
     */
    suspend fun fetchBreakOptOut(
        userId: String,
        breakId: String,
    ): Boolean {
        val count =
            supabase
                .from("break_optouts")
                .select(Columns.list("user_id")) {
                    filter {
                        eq("break_id", breakId)
                        eq("user_id", userId)
                    }
                    count(Count.EXACT)
                }
                .countOrNull() ?: 0L
        return count > 0L
    }

    /**
     * Set the §4.4 break opt-out for [userId] on [breakId]: insert the own row when
     * [optedOut], delete it when not. Idempotent — re-opting-out is an `ignoreDuplicates`
     * upsert (the PK is `(break_id, user_id)`), re-opting-in deletes a possibly-absent
     * row. `opted_out_at` defaults server-side. Worker RLS allows the own-row write.
     */
    suspend fun setBreakOptOut(
        userId: String,
        breakId: String,
        optedOut: Boolean,
    ) {
        val table = supabase.from("break_optouts")
        if (optedOut) {
            table.upsert(
                buildJsonObject {
                    put("break_id", breakId)
                    put("user_id", userId)
                },
            ) { ignoreDuplicates = true }
        } else {
            table.delete {
                filter {
                    eq("break_id", breakId)
                    eq("user_id", userId)
                }
            }
        }
    }
}

// ----- Wire row → pure input. -----

@Serializable
private data class BreakPeriodRow(
    @SerialName("break_id") val breakId: String,
    @SerialName("break_name") val breakName: String,
    @SerialName("start_date") val startDate: String,
    @SerialName("end_date") val endDate: String,
)
