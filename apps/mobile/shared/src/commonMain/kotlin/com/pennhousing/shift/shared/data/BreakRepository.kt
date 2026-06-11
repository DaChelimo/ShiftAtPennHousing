package com.pennhousing.shift.shared.data

import com.pennhousing.shift.shared.breakclaim.BreakContextCopy
import com.pennhousing.shift.shared.breakclaim.breakContextCopy
import com.pennhousing.shift.shared.shifts.NEW_YORK
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Order
import kotlinx.datetime.LocalDate
import kotlinx.datetime.toLocalDateTime
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlin.time.Clock

/**
 * Live break context — the data layer behind the break-claim screen's descriptive copy
 * (T2-2a). The mobile analogue of the Edge/HTTP layer the phase-13a test plan scopes
 * out, so it is intentionally untested by kotlin.test; correctness is verified manually
 * against a running backend (the pure derivation it calls — `breakContextCopy` — IS
 * unit-tested).
 *
 * READ — [fetchActiveBreakContext] reads the active break row from `break_periods`,
 * worker-readable since migration 20260611000002 (FOR SELECT TO authenticated). The
 * "active/relevant" break is the soonest break that has not yet ended ([asOf] ≤
 * end_date), ordered by start_date ascending — the one whose claim window is open or
 * imminent. The break NAME + window + the "only Harnwell open" eyebrow are then derived
 * by [breakContextCopy] (the live-vs-derivable logic). The claimable POOL itself is
 * still demo-backed — surfacing live `worker_open_shifts` break rows is a larger wiring,
 * deferred. There is no per-worker scoping: a break period is not owned by a worker.
 */
class BreakRepository(
    private val supabase: SupabaseClient,
) {

    /**
     * The live descriptive copy for the active break, or null when there is no current
     * or upcoming break period (the caller keeps the demo copy). "Today" is the current
     * America/New_York calendar date (invariant #6); rows ending on/after it are
     * candidates. The clock read lives here in the (untested) data layer, never in the
     * pure `breakContextCopy` it calls.
     */
    suspend fun fetchActiveBreakContext(): BreakContextCopy? {
        val asOf = Clock.System.now().toLocalDateTime(NEW_YORK).date
        val candidates =
            supabase
                .from("break_periods")
                .select(Columns.list("break_name", "break_type", "start_date", "end_date")) {
                    filter { gte("end_date", asOf.toString()) }
                    order("start_date", Order.ASCENDING)
                }
                .decodeList<BreakPeriodRow>()
        val active = candidates.firstOrNull() ?: return null
        return breakContextCopy(
            breakName = active.breakName,
            breakType = active.breakType,
            startDate = LocalDate.parse(active.startDate),
            endDate = LocalDate.parse(active.endDate),
        )
    }
}

// ----- Wire row → pure input. -----

@Serializable
private data class BreakPeriodRow(
    @SerialName("break_name") val breakName: String,
    @SerialName("break_type") val breakType: String,
    @SerialName("start_date") val startDate: String,
    @SerialName("end_date") val endDate: String,
)
