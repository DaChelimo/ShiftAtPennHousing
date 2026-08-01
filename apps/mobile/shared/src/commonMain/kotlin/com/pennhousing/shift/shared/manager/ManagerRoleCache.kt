package com.pennhousing.shift.shared.manager

/*
 * The remembered app shape (docs/manager-app/SPEC.md §5.1) — how the app knows, before any
 * network call, whether to draw a worker's tabs or a manager's.
 *
 * THE PROBLEM THIS SOLVES. Capabilities come from `user_roles`, which is a network read. Without
 * a cache, every cold launch renders the WORKER shape first (that is the safe default while the
 * read is in flight) and then re-shapes the navigation when the roles arrive. For a manager that
 * is a visible flip of the bottom bar and the start destination on every single launch. The
 * launch splash sometimes hides it, but only by luck: the profile read races the week read, and
 * on a slow connection the splash drops first.
 *
 * These roles change on the order of once a year. Re-deriving them from the network before we are
 * allowed to draw anything is the wrong trade.
 *
 * THIS IS A UI CACHE AND NEVER AN AUTHORIZATION DECISION. Read that again before extending it.
 * Nothing here is a security boundary: it decides which tabs to draw, and every manager write
 * still goes through an RPC or Edge Function that re-checks authorization from the bearer token
 * server-side. So the worst case for a STALE cache is a control that appears and then gets
 * refused by the server, which is a cosmetic bug. The worst case for treating it as authority
 * would be privilege escalation by editing a preferences file on a rooted phone. Never let a
 * cached value stand in for a server check, and never send it to the server.
 *
 * WHY IT STORES ROLES RATHER THAN A BOOLEAN. Capabilities are DERIVED (see
 * [managerCapabilitiesOf]) and the derivation rules mirror SQL predicates that will change. If
 * this cached `hasCoverage = true` instead, there would be two independent implementations of
 * those rules and they would drift. Caching the INPUTS and re-deriving keeps exactly one
 * definition of what a role can do.
 *
 * KEYED BY USER. A cache entry names the user it was written for. A different person signing in
 * on the same phone is a MISS, not an inherited shape, and signing out clears it outright.
 */

/** The cached shape, exactly as much as [managerCapabilitiesOf] needs to rebuild capabilities. */
data class CachedRoleShape(
    val userId: String,
    val homeHouseId: String,
    val roles: List<ManagerRole>,
) {
    /** Rebuild capabilities through the ONE derivation function. */
    fun capabilities(): ManagerCapabilities = managerCapabilitiesOf(roles, homeHouseId)
}

/**
 * How the launch should resolve the app shape.
 *
 * The distinction that matters is [HoldSplash] versus [UseCached]: a cache HIT may draw
 * immediately and reconcile silently, while a MISS must not guess, because guessing is exactly
 * the flip this cache exists to remove. On a miss the launch splash is already on screen, so
 * waiting there costs the user nothing they can see, and it happens once per sign-in rather than
 * once per launch.
 */
sealed interface RoleShapeResolution {
    /**
     * Draw with these capabilities NOW. A background reconcile still runs and writes through, so
     * a genuine role change lands on the next launch at the latest.
     */
    data class UseCached(val capabilities: ManagerCapabilities) : RoleShapeResolution

    /** No usable cache. Keep the splash up until the role read completes, then cache it. */
    data object HoldSplash : RoleShapeResolution
}

/**
 * Decide how to open the app for [userId], given whatever was cached.
 *
 * A cache entry for a DIFFERENT user is treated as absent rather than as an error: it is the
 * normal state of a shared phone, or of a manager who signed out and a worker who signed in.
 */
fun resolveRoleShape(
    cached: CachedRoleShape?,
    userId: String,
): RoleShapeResolution =
    if (cached != null && cached.userId == userId) {
        RoleShapeResolution.UseCached(cached.capabilities())
    } else {
        RoleShapeResolution.HoldSplash
    }

/**
 * Serialize a shape for storage. Deliberately a tiny flat string rather than JSON: it is read on
 * the launch path before the first frame, and this format needs no parser and no schema.
 *
 * `v1|userId|homeHouseId|role:scope,role:scope`, with an empty scope for a house-agnostic role.
 */
fun encodeRoleShape(shape: CachedRoleShape): String {
    val roles = shape.roles.joinToString(",") { "${it.role}:${it.scopeHouseId ?: ""}" }
    return listOf(VERSION, shape.userId, shape.homeHouseId, roles).joinToString(FIELD_SEP.toString())
}

/**
 * Parse a stored shape, or null when it is absent, from an older format, or malformed in any way.
 *
 * EVERY failure mode returns null, which means "hold the splash and ask the server". That is the
 * right default for a cache: a corrupt entry costs one slower launch, whereas guessing at a
 * half-parsed entry could draw the wrong app. A version bump is a deliberate cache invalidation,
 * so bumping [VERSION] is how you force every client to re-read from the server once.
 */
fun decodeRoleShape(raw: String?): CachedRoleShape? {
    if (raw == null || raw.isBlank()) return null
    val parts = raw.split(FIELD_SEP)
    if (parts.size != 4) return null
    val (version, userId, homeHouseId, rolesRaw) = parts
    if (version != VERSION) return null
    if (userId.isBlank()) return null
    val roles =
        if (rolesRaw.isBlank()) {
            emptyList()
        } else {
            rolesRaw.split(',').map { entry ->
                val name = entry.substringBefore(':')
                val scope = entry.substringAfter(':', missingDelimiterValue = "")
                // A blank role name would derive silently to "no manager surface", which is the
                // safe answer but hides a corrupt entry. Reject instead, so the launch asks the
                // server rather than drawing a worker app for a manager.
                if (name.isBlank()) return null
                ManagerRole(role = name, scopeHouseId = scope.ifBlank { null })
            }
        }
    return CachedRoleShape(userId = userId, homeHouseId = homeHouseId, roles = roles)
}

/**
 * Should the freshly-read shape be written back?
 *
 * Only when it actually differs, so the common launch does no write at all. This also keeps the
 * in-memory [ManagerCapabilities] value IDENTICAL across the reconcile when nothing changed,
 * which is what stops the navigation from re-keying on `startRoute` and rebuilding its back
 * stacks for no reason.
 */
fun shouldRewriteRoleShape(
    cached: CachedRoleShape?,
    fresh: CachedRoleShape,
): Boolean = cached != fresh

/**
 * Bump to invalidate every stored entry (e.g. after changing what capabilities a role grants, so
 * clients cannot keep deriving from a shape that predates the change).
 */
private const val VERSION = "v1"
private const val FIELD_SEP = '|'
