package com.pennhousing.shift.shared.manager

/**
 * One assignable worker in a house roster (BSpec §2.2 add-a-worker picker). The picker
 * lists the house's own workers by name; the server stays authoritative on eligibility
 * and the soft-cap / target advisories at assign time, so no hours figure is carried
 * here (an honest per-worker "hours remaining" needs a cross-house weekly aggregate the
 * grid does not have; the confirm-step advisory covers the over-target case instead).
 */
data class RosterWorker(
    val userId: String,
    val name: String,
)
