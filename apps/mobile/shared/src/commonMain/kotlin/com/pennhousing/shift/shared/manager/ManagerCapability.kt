package com.pennhousing.shift.shared.manager

/*
 * Who sees which manager surface — the client-side capability model for manager mode
 * (docs/manager-app/SPEC.md §5).
 *
 * CROSS-PLATFORM PARITY. This mirrors `apps/web/lib/auth.ts`, which mirrors the SQL
 * predicates. Three layers, and they must agree:
 *
 *   SQL          user_is_schedule_admin(uid)      user_can_build_schedule(uid, house)
 *   web          isScheduleAdmin(user)            canBuildForHouse(user, houseId)
 *   mobile       ManagerCapabilities.isScheduleAdmin   .canBuildForHouse(houseId)
 *
 * AUTHORIZATION IS SERVER-SIDE AND STAYS SERVER-SIDE. Nothing here is a security
 * boundary. These flags decide which UI to draw, so a manager is not shown a control
 * that will fail; every write still goes through an RPC or Edge Function that re-checks
 * authorization from the bearer token. Never send a role or a capability flag to the
 * server and never let one of these stand in for a server check.
 */

/** A `user_roles` row: the role and the house it is scoped to (null for house-agnostic roles). */
data class ManagerRole(
    val role: String,
    val scopeHouseId: String? = null,
)

/**
 * The signed-in user's manager capabilities, derived from their `user_roles` rows.
 *
 * Build with [managerCapabilitiesOf] rather than constructing directly, so the role-string
 * comparisons live in exactly one place.
 */
data class ManagerCapabilities(
    /** `admin` — the house-agnostic superuser (BSpec §2.7). Holds every power in every house. */
    val isAdmin: Boolean,
    /**
     * The elevated tier: hm / bm / rsm anywhere, plus admin. May EDIT any house's schedule
     * (2026-06-27 cross-house decision), so on mobile this is what unlocks the 13-house
     * switcher and the Coverage tab.
     */
    val isScheduleAdmin: Boolean,
    /** Holds `sm` somewhere. Own-house manager surfaces only, and no Coverage tab. */
    val isStudentManager: Boolean,
    /** Holds `sw`. Managers commonly hold this too, since they work desk shifts. */
    val isWorker: Boolean,
    /**
     * The house this manager administers: the first sm/hm/rsm/bm scope, falling back to
     * their home house. Every SM write is pinned to this.
     */
    val adminHouseId: String,
) {
    /**
     * Does this user get manager mode at all? A pure `sw` does not, and their app must look
     * exactly as it does today.
     */
    val hasManagerSurface: Boolean get() = isScheduleAdmin || isStudentManager

    /**
     * Does this user get the Coverage tab? Only the elevated tier. The Allied ladder never
     * routes to an SM (BSpec §5.4a rungs are RSM, HM, HMOD), so an SM's inbox would be
     * permanently empty and the tab would be a dead end. BSpec §5.4a does permit anyone who
     * can build for the house to acknowledge, but an SM has no path to reach a request, so
     * exposing the control would be theatre. Revisit only on a stakeholder decision.
     */
    val hasCoverage: Boolean get() = isScheduleAdmin

    /**
     * May this user switch houses? The elevated tier may. An SM is pinned to
     * [adminHouseId] for every manager surface. (A plain SM does get read-only cross-house
     * VIEW of the live calendar on web, per the 2026-07-13 ruling, but that is the worker
     * House tab, not the manager overrides, and it is unchanged here.)
     */
    val canSwitchHouse: Boolean get() = isScheduleAdmin

    /**
     * May this user build (assign, remove, force-trigger) at [houseId]? A schedule admin
     * may anywhere; an SM only at their own scoped house. Mirrors `user_can_build_schedule`,
     * which the DB re-checks authoritatively.
     */
    fun canBuildForHouse(houseId: String): Boolean = isScheduleAdmin || adminHouseId == houseId

    /**
     * The house a manager WRITE should target: the viewed house for a schedule admin,
     * otherwise their own.
     *
     * This exists because getting it wrong is a real bug the web side had to fix: a
     * cross-house manager viewing Rodin who taps "assign" must write to RODIN, not to their
     * own house. Route every manager write through this, never through [adminHouseId]
     * directly.
     */
    fun writeHouseId(
        requestedHouseId: String?,
        validHouseIds: List<String>,
    ): String =
        if (isScheduleAdmin && requestedHouseId != null && requestedHouseId in validHouseIds) {
            requestedHouseId
        } else {
            adminHouseId
        }
}

/**
 * Derive capabilities from the user's `user_roles` rows and their home house.
 *
 * [homeHouseId] is the fallback for [ManagerCapabilities.adminHouseId] when no scoped
 * manager role carries a scope, matching web's `adminHouseId`.
 */
fun managerCapabilitiesOf(
    roles: List<ManagerRole>,
    homeHouseId: String,
): ManagerCapabilities {
    val held = roles.map { it.role }.toSet()
    val isAdmin = ROLE_ADMIN in held
    return ManagerCapabilities(
        isAdmin = isAdmin,
        // admin is folded in rather than OR'd at every call site, exactly as web does.
        isScheduleAdmin = isAdmin || held.any { it in SCHEDULE_ADMIN_ROLES },
        isStudentManager = ROLE_SM in held,
        isWorker = ROLE_SW in held,
        adminHouseId =
            roles
                .firstOrNull { it.role in SCOPED_ADMIN_ROLES && it.scopeHouseId != null }
                ?.scopeHouseId
                ?: homeHouseId,
    )
}

/** Role precedence for the Settings profile label (bm > hm > rsm > sm > sw). */
private val ROLE_PRECEDENCE = listOf("admin", "bm", "hm", "rsm", "sm", "sw")

/** The most privileged role held, for display. `sw` when none is present. */
fun highestRoleOf(roles: List<String>): String = ROLE_PRECEDENCE.firstOrNull { it in roles } ?: ROLE_SW

private const val ROLE_ADMIN = "admin"
private const val ROLE_SM = "sm"
private const val ROLE_SW = "sw"

/** hm / bm / rsm: the elevated cross-house schedule tier. `admin` is handled separately. */
private val SCHEDULE_ADMIN_ROLES = setOf("hm", "bm", "rsm")

/** The roles whose `scope_house_id` names the house they administer. */
private val SCOPED_ADMIN_ROLES = setOf("sm", "hm", "bm", "rsm")
