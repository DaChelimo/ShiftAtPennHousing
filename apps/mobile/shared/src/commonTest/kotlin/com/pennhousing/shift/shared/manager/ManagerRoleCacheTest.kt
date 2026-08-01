package com.pennhousing.shift.shared.manager

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The remembered app shape (docs/manager-app/SPEC.md §5.1).
 *
 * Two properties carry the whole feature and both are tested here:
 *
 *   1. A cache HIT reproduces the SAME capabilities the server would have derived, so a manager
 *      opens straight into the manager app with no flip.
 *   2. Every failure mode resolves to HoldSplash, never to a guess. A wrong guess is the exact
 *      bug this cache exists to remove, so "corrupt entry" must cost a slow launch and never a
 *      wrong one.
 */
class ManagerRoleCacheTest {
    private val hmShape =
        CachedRoleShape(
            userId = "user-1",
            homeHouseId = "harnwell",
            roles = listOf(ManagerRole("hm", "harnwell"), ManagerRole("sw", null)),
        )

    // ----- Round trip. -----

    @Test
    fun aShapeSurvivesARoundTrip() {
        assertEquals(hmShape, decodeRoleShape(encodeRoleShape(hmShape)))
    }

    @Test
    fun aWorkerWithNoRolesRoundTrips() {
        val shape = CachedRoleShape("user-2", "quad", emptyList())
        assertEquals(shape, decodeRoleShape(encodeRoleShape(shape)))
    }

    @Test
    fun aHouseAgnosticRoleRoundTripsWithANullScope() {
        val shape = CachedRoleShape("user-3", "rodin", listOf(ManagerRole("admin", null)))
        val decoded = decodeRoleShape(encodeRoleShape(shape))!!
        assertNull(decoded.roles.single().scopeHouseId)
        assertTrue(decoded.capabilities().isAdmin)
    }

    /**
     * The point of caching the ROLES rather than a boolean: the cached shape must derive to
     * exactly what the server-read shape derives to, through the same function.
     */
    @Test
    fun cachedCapabilitiesMatchTheServerDerivedOnes() {
        val fromServer = managerCapabilitiesOf(hmShape.roles, hmShape.homeHouseId)
        val fromCache = decodeRoleShape(encodeRoleShape(hmShape))!!.capabilities()
        assertEquals(fromServer, fromCache)
        assertTrue(fromCache.hasCoverage)
        assertTrue(fromCache.isScheduleAdmin)
    }

    @Test
    fun anSmShapeRebuildsAsOwnHouseOnly() {
        val sm = CachedRoleShape("user-4", "quad", listOf(ManagerRole("sm", "quad")))
        val caps = decodeRoleShape(encodeRoleShape(sm))!!.capabilities()
        assertTrue(caps.hasManagerSurface)
        assertFalse(caps.hasCoverage)
        assertFalse(caps.canBuildForHouse("harnwell"))
    }

    // ----- Resolution: hit versus miss. -----

    @Test
    fun aHitForTheSameUserDrawsImmediately() {
        val resolution = resolveRoleShape(hmShape, userId = "user-1")
        val used = assertIs<RoleShapeResolution.UseCached>(resolution)
        assertTrue(used.capabilities.hasCoverage)
    }

    @Test
    fun noCacheHoldsTheSplash() {
        assertIs<RoleShapeResolution.HoldSplash>(resolveRoleShape(null, userId = "user-1"))
    }

    /**
     * A shared phone, or a manager who signed out and a worker who signed in. Inheriting the
     * previous person's shape would show a worker a Coverage tab, which is both wrong and
     * alarming.
     */
    @Test
    fun aCacheForAnotherUserIsAMissNotAnInheritedShape() {
        assertIs<RoleShapeResolution.HoldSplash>(resolveRoleShape(hmShape, userId = "somebody-else"))
    }

    // ----- Every malformed entry must resolve to HoldSplash, never to a guess. -----

    @Test
    fun absentOrBlankStorageDecodesToNull() {
        assertNull(decodeRoleShape(null))
        assertNull(decodeRoleShape(""))
        assertNull(decodeRoleShape("   "))
    }

    @Test
    fun aWrongVersionDecodesToNull() {
        val encoded = encodeRoleShape(hmShape)
        assertNull(decodeRoleShape(encoded.replaceFirst("v1", "v0")))
    }

    @Test
    fun aTruncatedEntryDecodesToNull() {
        assertNull(decodeRoleShape("v1|user-1|harnwell"))
        assertNull(decodeRoleShape("v1|user-1"))
        assertNull(decodeRoleShape("v1"))
    }

    @Test
    fun anExtraFieldDecodesToNull() {
        assertNull(decodeRoleShape("v1|user-1|harnwell|hm:harnwell|junk"))
    }

    @Test
    fun aBlankUserIdDecodesToNull() {
        assertNull(decodeRoleShape("v1||harnwell|hm:harnwell"))
    }

    /**
     * A blank role name would derive silently to "no manager surface" — the SAFE answer, but it
     * would draw a worker app for a manager and hide the corruption. Reject and ask the server.
     */
    @Test
    fun aBlankRoleNameDecodesToNull() {
        assertNull(decodeRoleShape("v1|user-1|harnwell|:harnwell"))
        assertNull(decodeRoleShape("v1|user-1|harnwell|hm:harnwell,:quad"))
    }

    @Test
    fun garbageDecodesToNull() {
        assertNull(decodeRoleShape("not a shape at all"))
    }

    // ----- Write-through only on a real change. -----

    /**
     * The common launch must do no write, and must yield an IDENTICAL capabilities value, or the
     * navigation re-keys on `startRoute` and rebuilds its back stacks for nothing.
     */
    @Test
    fun anUnchangedShapeIsNotRewritten() {
        assertFalse(shouldRewriteRoleShape(hmShape, hmShape))
        assertEquals(hmShape.capabilities(), hmShape.copy().capabilities())
    }

    @Test
    fun aPromotionIsRewritten() {
        val promoted = hmShape.copy(roles = listOf(ManagerRole("rsm", "harnwell")))
        assertTrue(shouldRewriteRoleShape(hmShape, promoted))
    }

    @Test
    fun aRevokedRoleIsRewritten() {
        val demoted = hmShape.copy(roles = listOf(ManagerRole("sw", null)))
        assertTrue(shouldRewriteRoleShape(hmShape, demoted))
        assertFalse(demoted.capabilities().hasCoverage)
    }

    @Test
    fun aHouseTransferIsRewritten() {
        val moved = hmShape.copy(homeHouseId = "rodin", roles = listOf(ManagerRole("hm", "rodin")))
        assertTrue(shouldRewriteRoleShape(hmShape, moved))
        assertEquals("rodin", moved.capabilities().adminHouseId)
    }

    @Test
    fun aFirstEverWriteIsRewritten() {
        assertTrue(shouldRewriteRoleShape(null, hmShape))
    }
}
