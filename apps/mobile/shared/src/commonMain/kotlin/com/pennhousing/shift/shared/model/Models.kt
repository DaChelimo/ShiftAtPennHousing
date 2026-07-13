package com.pennhousing.shift.shared.model

import kotlin.time.Instant

/**
 * Phase 13a — worker-app domain models (PURE data, no I/O, no clock).
 *
 * These are the snapshot the Shifts screen renders (BEHAVIORAL_SPECIFICATION.md
 * §5.6) and the float a worker acknowledges (§7). They carry the §11.2
 * personal-calendar treatment flags (`crossHouse`, `pending`, `breakShift`,
 * `droppedStillOpen`) that drive the card styling, but the colors/borders
 * themselves are a rendering concern — see tests/PHASE_13a/TEST_PLAN.md.
 *
 * All instants are `kotlin.time.Instant` (the modern instant type;
 * `kotlinx.datetime.Instant` is deprecated in 0.7.x). They are timestamptz
 * moments — every shift start/end sits on a 30-minute block boundary
 * (AGENTS hard invariant #5) and is reasoned about in America/New_York
 * (invariant #6).
 */
data class House(
    val id: String,
    val name: String,
)

/**
 * How the worker relates to a shift this week — drives the My-Shifts section
 * (§5.6 Tab 1) and the §11.2 personal-calendar treatment.
 */
enum class AssignmentKind { SCHEDULED, PERMANENT_PICKUP, TEMP_PICKUP, FLOAT_OUT }

data class MyShift(
    val id: String,
    val house: House,
    val start: Instant, // 30-min block boundary (invariant #5)
    val end: Instant,
    val kind: AssignmentKind,
    val crossHouse: Boolean = false, // pickup/float at a non-home house → destination shown (§11.2)
    val pending: Boolean = false, // force-triggered float not yet acked → "(Pending)" (§11.2)
    val breakShift: Boolean = false, // short/winter break shift → slate border (§11.2)
    val droppedStillOpen: Boolean = false, // personally dropped this week, still unclaimed (§5.6 #2)
    // The constituent 30-min block assignment_ids, in time order. A raw read-model row
    // is one block (the default); a coalesced card carries every merged block id so
    // drop/claim can target all — or a sub-range — of the underlying blocks.
    val blockIds: List<String> = listOf(id),
)

enum class MyShiftsSection { PICKED_UP, DROPPED, SCHEDULED }

enum class OpenFeed { WEEKLY, PERMANENT_OPENING }

data class OpenShift(
    val id: String,
    val house: House,
    val start: Instant,
    val end: Instant,
    val feed: OpenFeed,
    val homeHouse: Boolean, // true → Tab 2; false → Tab 3
    val weeksRemaining: Int? = null, // permanent openings only (§5.1)
    // The constituent vacant 30-min block assignment_ids, in time order (see MyShift.blockIds).
    val blockIds: List<String> = listOf(id),
    // How many IDENTICAL concurrent openings this card stands for. A multi-staff house
    // (e.g. the Quad) can have several desks vacant for the same span; coalescing threads
    // them into separate lanes, then groups lanes with the same (start,end) into one card
    // with count = #lanes ("2 open"). [blockIds] carries ONE representative lane, so a
    // claim/partial-claim consumes exactly one desk and the next snapshot re-coalesces to
    // count − 1. Always ≥ 1 (a single opening).
    val count: Int = 1,
    // Server-authoritative claimability inputs (BEHAVIORAL_SPECIFICATION §5.4/§5.5).
    // The client consumes these instead of re-deriving the T-2h cutoff itself.
    //   deskCovered   — a sibling REAL worker {scheduled,claimed,floated_in,pending_float_in}
    //                   is still on this block, so the seat stays claimable within T-2h.
    //   coverageLocked — the block's one-way coverage lock is set: unpickable from here on,
    //                   even if a floater/Allied later fills the desk.
    val deskCovered: Boolean = false,
    val coverageLocked: Boolean = false,
)

data class FloatAck(
    val floatId: String,
    val destinationHouse: House,
    val floatStart: Instant,
)

/**
 * A float assignment awaiting THIS worker's acknowledgment (§7.1) — the source for
 * the My-Shifts float-request carousel AND the ack hero. Unlike [FloatAck] it carries
 * the full destination WINDOW (start AND end) so the card can show "18:00 - 20:00",
 * not just a start. Resolved from the bounded `worker_pending_floats` view, so it is
 * immune to the personal-calendar read's 1000-row cap.
 */
data class PendingFloat(
    val floatId: String,
    val destinationHouse: House,
    val start: Instant, // 30-min block boundary (invariant #5)
    val end: Instant, // last block start + 30m
    val blockCount: Int,
) {
    /** The narrower ack model the existing hero/modal renders. */
    fun toFloatAck(): FloatAck = FloatAck(floatId, destinationHouse, start)
}

/** How a [RecentFloat] resolved — drives the recent-section status chip + copy. */
enum class RecentFloatStatus {
    /** Worker acknowledged it (status `acknowledged`) — they are covering the desk. */
    ACCEPTED,

    /** Worker explicitly declined it (status `declined`). */
    DECLINED,

    /** The response window passed unanswered and the system voided it (status `voided`, no-ack). */
    EXPIRED,
}

/**
 * A float that has RESOLVED for this worker within the last 24h (§7.1/§7.2) — the source
 * for the collapsible "Recent float requests" section under the carousel. Active floats
 * (still respondable) live in [PendingFloat] / the carousel; this is purely a de-emphasized
 * record so a resolved card does not linger in the prominent zone with no way to dismiss it.
 *
 * Resolved from the bounded `worker_recent_floats` view. The destination blocks of a
 * declined/expired float are vacated (no longer the worker's), so the view reads as the
 * view owner and self-scopes to `fa.user_id = auth.uid()`.
 */
data class RecentFloat(
    val floatId: String,
    val destinationHouse: House,
    val start: Instant,
    val end: Instant,
    val status: RecentFloatStatus,
    /** When it resolved (acknowledged_at / declined_at / no_ack_at) — orders the list. */
    val resolvedAt: Instant,
)
