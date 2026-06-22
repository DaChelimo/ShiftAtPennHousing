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
)

data class FloatAck(
    val floatId: String,
    val destinationHouse: House,
    val floatStart: Instant,
)
