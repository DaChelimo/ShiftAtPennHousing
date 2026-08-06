package com.pennhousing.shift.ui.house

import androidx.compose.ui.graphics.Color
import com.pennhousing.shift.ui.theme.mixedWithWhite
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

/**
 * Pins the house-grid recede maths to the values iOS produces, so the two platforms cannot
 * drift into rendering the same worker's seat differently. The reference numbers below were
 * computed from the iOS implementation (`Color.mixedWithWhite` in Theme/ShiftTheme.swift +
 * the `houseOther*` constants in ContentView.swift), which is a plain per-channel sRGB mix.
 *
 * This is the same guard `WorkerColorsTest` applies to the worker palette: a colour rule
 * that exists twice is a colour rule that silently drifts.
 */
class HouseRecedeParityTest {
    private fun assertChannels(
        actual: Color,
        r: Float,
        g: Float,
        b: Float,
    ) {
        val d = listOf(abs(actual.red - r), abs(actual.green - g), abs(actual.blue - b)).max()
        assertTrue("expected ($r, $g, $b) got (${actual.red}, ${actual.green}, ${actual.blue})", d < 0.002f)
    }

    @Test
    fun `the recede constants match iOS`() {
        assertTrue(abs(HOUSE_OTHER_WHITE_MIX - 0.72f) < 1e-6f)
        assertTrue(abs(HOUSE_OTHER_FINAL_ALPHA - 0.9f) < 1e-6f)
        assertEquals(Color(0xFF1F2430), HOUSE_RECEDED_INK)
    }

    @Test
    fun `a receded worker fill is the sRGB white mix, not a perceptual one`() {
        // #5B4BC4 at 0.72 white. Compose's own lerp lands on (0.800, 0.804, 0.949) here,
        // which is what this test exists to keep out.
        assertChannels(Color(0xFF5B4BC4).mixedWithWhite(HOUSE_OTHER_WHITE_MIX), 0.8199f, 0.8024f, 0.9352f)
    }

    @Test
    fun `mixing preserves alpha and clamps its amount`() {
        // Tolerance is 8-bit, not float: Compose packs an sRGB Color as 8 bits per channel,
        // so 0.9f round-trips as 229/255 = 0.898039.
        val translucent = Color(0xFF5B4BC4).copy(alpha = 0.9f)
        assertTrue(abs(translucent.mixedWithWhite(0.72f).alpha - translucent.alpha) < 1e-6f)
        assertChannels(Color.Black.mixedWithWhite(2f), 1f, 1f, 1f)
        assertChannels(Color(0xFF5B4BC4).mixedWithWhite(-1f), 0.3569f, 0.2941f, 0.7686f)
    }
}
