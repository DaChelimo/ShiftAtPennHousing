package com.pennhousing.shift.shared.swaps

/*
 * Hand-off recipient directory (§8.5) — PURE worker-picker logic for the one-sided
 * hand-off flow. A hand-off is NOT a calendar exchange: the worker hands their whole
 * shift to ANOTHER staff worker, who gives nothing back. So the recipient picker is a
 * people directory, not the day-grid `SwapDay` the swap path uses:
 *
 *  - "My House" = staff workers in the worker's OWN home house (a flat list), and
 *  - "Others"   = staff workers in EVERY other house, grouped by house, searchable
 *    (10+ houses × ~8 workers each is too long to scroll blind).
 *
 * Eligibility is filtered HERE so a worker never picks someone the server would reject
 * (the user ruling, 2026-06-17): the receiver must satisfy the same Harnwell-training
 * and float-direction constraints as a swap receiver (BSpec §8.5 → §1.2/§6.1). The
 * server (`create-swap` EF + `packages/core`) stays AUTHORITATIVE and re-checks on
 * create AND accept; this is a UX pre-filter, mirroring `evaluateTransferredSpan` in
 * packages/core/src/swaps/eligibility.ts. No I/O, no clock.
 */

/** Canonical house ids the eligibility rules key on — mirror packages/core/src/swaps/eligibility.ts. */
const val HARNWELL_HOUSE_ID = "harnwell"

/** Houses whose workers may receive a non-Harnwell FLOAT span (multi-staff float sources). */
val MULTI_STAFF_FLOAT_SOURCE_HOUSE_IDS = setOf("quad", "harnwell")

/** One staff worker pickable as a hand-off recipient (a `worker_directory` row + house name). */
data class HandoffWorker(
    val userId: String,
    val name: String,
    val homeHouseId: String,
    val homeHouseName: String,
)

/** A house section of the "Others" tab — its workers, alphabetised. */
data class HandoffHouseGroup(
    val houseId: String,
    val houseName: String,
    val workers: List<HandoffWorker>,
)

/**
 * The hand-off recipient directory split for the picker: the worker's own house as a
 * flat list, and every other house grouped (the "Others" tab, optionally search-filtered).
 */
data class HandoffDirectory(
    val myHouse: List<HandoffWorker>,
    val others: List<HandoffHouseGroup>,
) {
    val isEmpty: Boolean get() = myHouse.isEmpty() && others.isEmpty()
    val othersCount: Int get() = others.sumOf { it.workers.size }
}

/**
 * Can [workerHomeHouseId] receive a hand-off of a shift at [giveHouseId] (a float iff
 * [giveIsFloat])? Mirrors `evaluateTransferredSpan` (packages/core): a Harnwell shift
 * needs a Harnwell-home receiver (invariant #1), and a non-Harnwell FLOAT span needs a
 * multi-staff-float-source receiver (invariant #2 / §6.1). Everything else is eligible;
 * the hours cap is NOT consulted — a hand-off is always cap-exempt (§8.5).
 */
fun isEligibleHandoffRecipient(
    workerHomeHouseId: String,
    giveHouseId: String,
    giveIsFloat: Boolean,
): Boolean {
    if (giveHouseId == HARNWELL_HOUSE_ID && workerHomeHouseId != HARNWELL_HOUSE_ID) return false
    if (giveIsFloat && giveHouseId != HARNWELL_HOUSE_ID && workerHomeHouseId !in MULTI_STAFF_FLOAT_SOURCE_HOUSE_IDS) {
        return false
    }
    return true
}

/**
 * Build the [HandoffDirectory] for the picker. [workers] is the full active directory
 * (`worker_directory` ∪ demo); the proposer [meUserId] is always excluded, and only
 * workers eligible to receive a shift at [giveHouseId] (float iff [giveIsFloat]) survive.
 *
 * The split is by the proposer's OWN home house (looked up from their own directory row;
 * falling back to [giveHouseId] if absent). The "Others" tab is grouped by house (house
 * name A→Z, workers by name) and filtered by [query] (matched against worker name OR house
 * name); the "My House" list is the flat home-house roster and is NOT query-filtered (it is
 * short, and search is an "Others" affordance).
 */
fun buildHandoffDirectory(
    workers: List<HandoffWorker>,
    meUserId: String,
    giveHouseId: String,
    giveIsFloat: Boolean,
    query: String = "",
): HandoffDirectory {
    val meHouseId = workers.firstOrNull { it.userId == meUserId }?.homeHouseId ?: giveHouseId
    val eligible =
        workers
            .asSequence()
            .filter { it.userId != meUserId }
            .filter { isEligibleHandoffRecipient(it.homeHouseId, giveHouseId, giveIsFloat) }
            .toList()

    val myHouse =
        eligible
            .filter { it.homeHouseId == meHouseId }
            .sortedBy { it.name.lowercase() }

    val q = query.trim()
    val others =
        eligible
            .filter { it.homeHouseId != meHouseId }
            .filter { q.isEmpty() || it.name.contains(q, ignoreCase = true) || it.homeHouseName.contains(q, ignoreCase = true) }
            .groupBy { it.homeHouseId }
            .map { (houseId, ws) ->
                HandoffHouseGroup(
                    houseId = houseId,
                    houseName = ws.first().homeHouseName,
                    workers = ws.sortedBy { it.name.lowercase() },
                )
            }
            .sortedBy { it.houseName.lowercase() }

    return HandoffDirectory(myHouse = myHouse, others = others)
}
