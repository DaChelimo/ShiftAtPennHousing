package com.pennhousing.shift.shared.house

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Per-worker shift colors — the cross-platform contract in docs/design/worker-colors.md.
 *
 * The load-bearing property is that this Kotlin copy and `apps/web/lib/workerColor.ts`
 * agree for every id, so a worker looks the same on the web calendars and the mobile
 * House grid. The expected indices below were produced by running the TypeScript
 * `workerColorIndex` on these exact strings; if a change here makes one fail, the two
 * platforms have drifted, which is the bug this file exists to catch.
 */
class WorkerColorsTest {
    /** Reference vectors from the TS implementation (uuids in the shape real ids take). */
    private val vectors =
        listOf(
            "" to 0,
            "a" to 13,
            "u-me" to 2,
            "u-maya" to 4,
            "fbb00000-0000-0000-0000-000000000001" to 13,
            "fbb00000-0000-0000-0000-000000000002" to 0,
            "3f2504e0-4f89-11d3-9a0c-0305e82c3301" to 3,
            "00000000-0000-0000-0000-000000000000" to 4,
        )

    /** The JS hash, re-implemented independently here to cross-check the production one. */
    private fun referenceIndex(userId: String): Int {
        var h = 0
        for (ch in userId) h = (h * 31 + ch.code)
        val n = WORKER_PALETTE.size
        return ((h % n) + n) % n
    }

    @Test
    fun matchesTheWebHashOnReferenceVectors() {
        vectors.forEach { (id, expected) ->
            assertEquals(expected, workerColorIndex(id), "index drifted for '$id'")
        }
    }

    @Test
    fun agreesWithAnIndependentReimplementationOfTheHash() {
        listOf("u-bob", "u-priya", "Andrew Chelimo", "9f8e7d6c-1234", "ż-unicode-é").forEach { id ->
            assertEquals(referenceIndex(id), workerColorIndex(id))
        }
    }

    @Test
    fun alwaysLandsInsideThePalette() {
        // A negative intermediate hash must still resolve to a valid index (positive modulo).
        (0 until 500).forEach { i ->
            val idx = workerColorIndex("worker-$i-with-a-fairly-long-identifier")
            assertTrue(idx in WORKER_PALETTE.indices, "out of range: $idx")
        }
    }

    @Test
    fun paletteIsTheFourteenAgreedHues() {
        assertEquals(14, WORKER_PALETTE.size)
        assertEquals(0x2563EB, WORKER_PALETTE.first())
        assertEquals(0xC026D3, WORKER_PALETTE.last())
        assertEquals(WORKER_PALETTE.distinct().size, WORKER_PALETTE.size)
    }

    @Test
    fun isStableForTheSameId() {
        val id = "fbb00000-0000-0000-0000-000000000007"
        assertEquals(workerColor(id), workerColor(id))
        assertEquals(workerColorIndex(id), workerColorIndex(id))
    }

    @Test
    fun brightHuesGetDarkTextEveryOtherHueGetsWhite() {
        // Pick ids that land on the three bright entries (orange 3, amber 8, lime 11).
        val darkTextIds = (0 until 2000).map { "id-$it" }.filter { workerColorIndex(it) in setOf(3, 8, 11) }
        assertTrue(darkTextIds.isNotEmpty())
        darkTextIds.forEach { assertEquals(0x1A1A1A, workerContrastText(it)) }

        val lightTextIds = (0 until 2000).map { "id-$it" }.filter { workerColorIndex(it) !in setOf(3, 8, 11) }
        lightTextIds.take(50).forEach { assertEquals(0xFFFFFF, workerContrastText(it)) }
    }

    // ── Which blocks wear the color (state colors still win where they carry meaning) ──

    private fun block(
        userId: String? = "u-maya",
        vacant: Boolean = false,
        floatIn: Boolean = false,
        pending: Boolean = false,
    ) = HouseGridBlock(
        id = "b",
        assignmentIds = listOf("b"),
        startMin = 8 * 60,
        endMin = 12 * 60,
        lane = 0,
        segmentLanes = 1,
        timeLabel = "08:00 - 12:00",
        workerLabel = "Maya R.",
        workerName = "Maya R.",
        workerPhone = null,
        userId = userId,
        vacant = vacant,
        pending = pending,
        floatIn = floatIn,
        mine = false,
        active = false,
    )

    @Test
    fun scheduledWorkerBlocksWearTheirColor() {
        assertTrue(block().wearsWorkerColor())
    }

    @Test
    fun vacantFloatAndPendingBlocksKeepTheirStateColors() {
        assertFalse(block(userId = null, vacant = true).wearsWorkerColor())
        assertFalse(block(floatIn = true).wearsWorkerColor())
        assertFalse(block(pending = true, floatIn = true).wearsWorkerColor())
    }

    @Test
    fun aBlockWithNoWorkerNeverWearsAColor() {
        assertFalse(block(userId = null).wearsWorkerColor())
    }
}
