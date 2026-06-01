package com.pennhousing.shift.shared.ack

import kotlin.time.Duration.Companion.minutes
import kotlin.time.Instant

/**
 * Phase 13a — float acknowledgment-deadline logic (BEHAVIORAL_SPECIFICATION.md
 * §7.1 / §7.2). PURE: `now` is always injected (the project's no-system-clock
 * rule), so the deadline boundary is deterministic.
 *
 * The acknowledgment deadline is T-10m before the float start — the same lead
 * phase-12's notification cadence measures its reminders from
 * ([ACK_DEADLINE_LEAD_MINUTES] = 10, decision #14). A worker may acknowledge or
 * decline only strictly before the deadline (decision #15).
 */

const val ACK_DEADLINE_LEAD_MINUTES = 10 // matches phase-12 (notification cadence)

enum class AckPhase {
    PENDING,
    ACKNOWLEDGED,
    DECLINED,
    DEADLINE_PASSED,
    ;

    // Convenience flags so the native UIs branch without depending on the
    // bridged enum's case naming (the Swift/SKIE side reads these as Bools).
    val isPending: Boolean get() = this == PENDING
    val isAcknowledged: Boolean get() = this == ACKNOWLEDGED
    val isDeclined: Boolean get() = this == DECLINED
    val isDeadlinePassed: Boolean get() = this == DEADLINE_PASSED
}

fun ackDeadline(floatStart: Instant): Instant = floatStart - ACK_DEADLINE_LEAD_MINUTES.minutes

/** Inclusive of the deadline instant: at exactly the deadline the modal is disabled (decision #15). */
fun isPastAckDeadline(
    floatStart: Instant,
    now: Instant,
): Boolean = now >= ackDeadline(floatStart)

/** Strictly before the deadline: only a response completed before T-10m succeeds (decision #15). */
fun canRespondToFloat(
    floatStart: Instant,
    now: Instant,
): Boolean = now < ackDeadline(floatStart)
