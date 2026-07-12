package com.pennhousing.shift.shared.swaps

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Hand-off recipient directory (§8.5) — the PURE worker-picker the one-sided hand-off
 * uses instead of the swap day-grid. These pin the CLIENT eligibility pre-filter +
 * My-House/Others split + search/group contract; the server (`create-swap` +
 * packages/core) stays authoritative, so this only mirrors `evaluateTransferredSpan`.
 */
class HandoffDirectoryTest {
    private fun w(
        userId: String,
        name: String,
        houseId: String,
        houseName: String,
    ) = HandoffWorker(userId = userId, name = name, homeHouseId = houseId, homeHouseName = houseName)

    // me is home Quad; a worker in each of four houses (incl. Harnwell).
    private val dir =
        listOf(
            w("me", "Me", "quad", "Quad"),
            w("ben", "Ben", "quad", "Quad"),
            w("amy", "Amy", "quad", "Quad"),
            w("cara", "Cara", "harnwell", "Harnwell"),
            w("dee", "Dee", "house-03", "Gregory"),
            w("eli", "Eli", "house-04", "Du Bois"),
        )

    @Test
    fun my_house_is_the_proposers_own_house_flat_and_alphabetised_excluding_me() {
        // A plain (non-Harnwell, non-float) Quad shift — no eligibility constraint.
        val d = buildHandoffDirectory(dir, meUserId = "me", giveHouseId = "quad", giveIsFloat = false)
        assertEquals(listOf("amy", "ben"), d.myHouse.map { it.userId }) // sorted by name, me excluded
        assertEquals(listOf("Du Bois", "Gregory", "Harnwell"), d.others.map { it.houseName }) // grouped + sorted
        assertEquals(3, d.othersCount)
        assertFalse(d.isEmpty)
    }

    @Test
    fun harnwell_give_keeps_only_harnwell_home_recipients() {
        // me is home Harnwell here, so My House = Harnwell; everyone else is filtered out.
        val harnwellDir =
            listOf(
                w("me", "Me", "harnwell", "Harnwell"),
                w("cara", "Cara", "harnwell", "Harnwell"),
                w("ben", "Ben", "quad", "Quad"),
                w("dee", "Dee", "house-03", "Gregory"),
            )
        val d = buildHandoffDirectory(harnwellDir, meUserId = "me", giveHouseId = "harnwell", giveIsFloat = false)
        assertEquals(listOf("cara"), d.myHouse.map { it.userId })
        assertTrue(d.others.isEmpty()) // only Harnwell-home workers may take a Harnwell shift (invariant #1)
    }

    @Test
    fun nonharnwell_float_give_keeps_only_multistaff_float_source_recipients() {
        // A float span at a regular house: only Quad/Harnwell-home workers may receive it.
        val d = buildHandoffDirectory(dir, meUserId = "me", giveHouseId = "house-09", giveIsFloat = true)
        // My House (Quad) eligible; Others = only Harnwell (Gregory + Du Bois are single-staff).
        assertEquals(listOf("amy", "ben"), d.myHouse.map { it.userId })
        assertEquals(listOf("Harnwell"), d.others.map { it.houseName })
        assertEquals(listOf("cara"), d.others.single().workers.map { it.userId })
    }

    @Test
    fun search_filters_only_others_by_worker_or_house_name() {
        val byWorker = buildHandoffDirectory(dir, meUserId = "me", giveHouseId = "quad", giveIsFloat = false, query = "dee")
        assertEquals(listOf("amy", "ben"), byWorker.myHouse.map { it.userId }) // My House untouched by search
        assertEquals(listOf("dee"), byWorker.others.flatMap { g -> g.workers.map { it.userId } })

        val byHouse = buildHandoffDirectory(dir, meUserId = "me", giveHouseId = "quad", giveIsFloat = false, query = "harn")
        assertEquals(listOf("Harnwell"), byHouse.others.map { it.houseName })

        val miss = buildHandoffDirectory(dir, meUserId = "me", giveHouseId = "quad", giveIsFloat = false, query = "zzz")
        assertTrue(miss.others.isEmpty())
        assertEquals(2, miss.myHouse.size) // still shows the home house
    }

    @Test
    fun eligibility_predicate_matches_packages_core_rules() {
        assertFalse(isEligibleHandoffRecipient("quad", giveHouseId = "harnwell", giveIsFloat = false))
        assertTrue(isEligibleHandoffRecipient("harnwell", giveHouseId = "harnwell", giveIsFloat = false))
        assertFalse(isEligibleHandoffRecipient("house-03", giveHouseId = "house-09", giveIsFloat = true))
        assertTrue(isEligibleHandoffRecipient("quad", giveHouseId = "house-09", giveIsFloat = true))
        assertTrue(isEligibleHandoffRecipient("house-03", giveHouseId = "house-09", giveIsFloat = false)) // non-float, non-Harnwell: open
    }

    @Test
    fun unknown_proposer_falls_back_to_grouping_by_the_give_house() {
        // me not in the directory → My House defaults to the give shift's house.
        val d = buildHandoffDirectory(dir, meUserId = "ghost", giveHouseId = "quad", giveIsFloat = false)
        assertEquals(listOf("amy", "ben", "me"), d.myHouse.map { it.userId }.sorted())
    }
}
