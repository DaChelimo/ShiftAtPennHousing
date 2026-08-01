package com.pennhousing.shift.shared.manager

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Manager-mode capability derivation (docs/manager-app/SPEC.md §5) — the mobile mirror of
 * `apps/web/lib/auth.ts`, which mirrors the SQL predicates.
 *
 * These are UI-shaping flags, not a security boundary; the server re-checks every write.
 * What they must not do is DIVERGE from web, because then a manager finds a control on one
 * platform and not the other, or worse, taps a control that the server then refuses.
 *
 * The two invariants most worth protecting:
 *   1. SM never gains cross-house power (root AGENTS.md, cross-house-schedule note #2).
 *   2. A manager write targets the VIEWED house, not the acting manager's own house.
 */
class ManagerCapabilityTest {
    private fun caps(
        vararg roles: Pair<String, String?>,
        homeHouse: String = "harnwell",
    ) = managerCapabilitiesOf(roles.map { ManagerRole(it.first, it.second) }, homeHouse)

    private val allHouses = listOf("harnwell", "quad", "rodin", "lauder")

    // ----- A plain worker sees no manager surface at all. -----

    @Test
    fun plainWorkerHasNoManagerSurface() {
        val worker = caps("sw" to null)
        assertFalse(worker.hasManagerSurface)
        assertFalse(worker.hasCoverage)
        assertFalse(worker.canSwitchHouse)
        assertFalse(worker.isScheduleAdmin)
        assertTrue(worker.isWorker)
    }

    /** No roles at all must not accidentally read as privileged. */
    @Test
    fun noRolesGrantsNothing() {
        val nobody = caps()
        assertFalse(nobody.hasManagerSurface)
        assertFalse(nobody.isScheduleAdmin)
        assertFalse(nobody.isAdmin)
        assertEquals("harnwell", nobody.adminHouseId)
    }

    // ----- The elevated tier: hm / bm / rsm. -----

    @Test
    fun elevatedTierGetsCoverageAndTheSwitcher() {
        listOf("hm", "bm", "rsm").forEach { role ->
            val user = caps(role to "harnwell")
            assertTrue(user.isScheduleAdmin, "$role should be a schedule admin")
            assertTrue(user.hasCoverage, "$role should get the Coverage tab")
            assertTrue(user.canSwitchHouse, "$role should get the house switcher")
        }
    }

    @Test
    fun elevatedTierMayBuildForAnyHouse() {
        val hm = caps("hm" to "harnwell")
        assertTrue(hm.canBuildForHouse("harnwell"))
        assertTrue(hm.canBuildForHouse("rodin"), "cross-house schedule write, decided 2026-06-27")
    }

    /** The whole point of writeHouseId: an HM viewing Rodin edits RODIN. */
    @Test
    fun elevatedTierWritesToTheViewedHouse() {
        val hm = caps("hm" to "harnwell")
        assertEquals("rodin", hm.writeHouseId("rodin", allHouses))
    }

    /** An unrecognised house id must never become a write target. */
    @Test
    fun anInvalidRequestedHouseFallsBackToTheirOwn() {
        val hm = caps("hm" to "harnwell")
        assertEquals("harnwell", hm.writeHouseId("not-a-house", allHouses))
        assertEquals("harnwell", hm.writeHouseId(null, allHouses))
    }

    // ----- SM: own-house only, and no Coverage tab. -----

    @Test
    fun studentManagerGetsManagerSurfaceButNotCoverage() {
        val sm = caps("sm" to "quad", homeHouse = "quad")
        assertTrue(sm.hasManagerSurface)
        assertFalse(sm.hasCoverage, "the Allied ladder never routes to an SM")
        assertFalse(sm.canSwitchHouse)
        assertFalse(sm.isScheduleAdmin)
    }

    @Test
    fun studentManagerMayBuildOnlyTheirOwnHouse() {
        val sm = caps("sm" to "quad", homeHouse = "quad")
        assertTrue(sm.canBuildForHouse("quad"))
        assertFalse(sm.canBuildForHouse("harnwell"), "SM must never gain cross-house power")
    }

    /** An SM is PINNED. Asking to write elsewhere resolves to their own house, not the ask. */
    @Test
    fun studentManagerCannotRedirectAWriteToAnotherHouse() {
        val sm = caps("sm" to "quad", homeHouse = "quad")
        assertEquals("quad", sm.writeHouseId("harnwell", allHouses))
    }

    /** Scope, not home house, is what an SM administers. They can differ. */
    @Test
    fun scopedRoleBeatsHomeHouseForTheAdminHouse() {
        val sm = caps("sm" to "rodin", homeHouse = "harnwell")
        assertEquals("rodin", sm.adminHouseId)
        assertTrue(sm.canBuildForHouse("rodin"))
        assertFalse(sm.canBuildForHouse("harnwell"))
    }

    @Test
    fun anUnscopedRoleFallsBackToTheHomeHouse() {
        val sm = caps("sm" to null, homeHouse = "lauder")
        assertEquals("lauder", sm.adminHouseId)
    }

    // ----- admin is the house-agnostic superuser. -----

    @Test
    fun adminIsAScheduleAdminEverywhere() {
        val admin = caps("admin" to null, homeHouse = "harnwell")
        assertTrue(admin.isAdmin)
        assertTrue(admin.isScheduleAdmin)
        assertTrue(admin.hasCoverage)
        assertTrue(admin.canBuildForHouse("rodin"))
        assertEquals("rodin", admin.writeHouseId("rodin", allHouses))
    }

    // ----- Dual-role managers. Most real managers also work a desk. -----

    @Test
    fun aManagerWhoAlsoWorksADeskKeepsBothCapabilities() {
        val both = caps("hm" to "harnwell", "sw" to null)
        assertTrue(both.isWorker, "they hold shifts, so the worker tabs stay")
        assertTrue(both.hasCoverage)
    }

    /** Holding sm alongside hm must not downgrade the hm reach. */
    @Test
    fun holdingSmAlongsideHmStaysElevated() {
        val both = caps("sm" to "quad", "hm" to "harnwell")
        assertTrue(both.isScheduleAdmin)
        assertTrue(both.canBuildForHouse("rodin"))
    }

    // ----- The display label. -----

    @Test
    fun highestRolePrefersTheMostPrivileged() {
        assertEquals("admin", highestRoleOf(listOf("sw", "sm", "admin")))
        assertEquals("bm", highestRoleOf(listOf("sw", "hm", "bm")))
        assertEquals("hm", highestRoleOf(listOf("sw", "hm", "rsm")))
        assertEquals("rsm", highestRoleOf(listOf("sw", "rsm")))
        assertEquals("sm", highestRoleOf(listOf("sw", "sm")))
        assertEquals("sw", highestRoleOf(listOf("sw")))
        assertEquals("sw", highestRoleOf(emptyList()), "no roles reads as a worker")
    }
}
