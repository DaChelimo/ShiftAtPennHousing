package com.pennhousing.shift.ui.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pennhousing.shift.ui.theme.ShiftTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/**
 * Regression cover for [ShiftBottomSheet]'s `overlay` slot.
 *
 * The swap-composer tour used to be passed through `content`, i.e. INSIDE the sheet's
 * scrolling body, where the height constraint is infinite: its `fillMaxSize()` scrim
 * collapsed to the height of its own two cards, so it dimmed a band across the middle of the
 * composer while the header and everything below it stayed at full contrast. The slot exists
 * so a scrim covers the whole sheet, and this pins that.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34], qualifiers = "w411dp-h891dp")
class SheetOverlaySlotTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun `an overlay fills the sheet rather than collapsing to its own content`() {
        composeRule.setContent {
            ShiftTheme {
                ShiftBottomSheet(
                    onDismiss = {},
                    title = "Propose a swap",
                    overlay = {
                        // A short scrim, exactly like a tour's: it must NOT end up 120dp tall.
                        Box(Modifier.fillMaxSize().background(Color.Black).testTag("test_overlay")) {
                            Box(Modifier.fillMaxWidth().height(120.dp))
                        }
                    },
                ) {
                    // Body taller than the sheet, so it scrolls (the tour's old host).
                    Column(Modifier.fillMaxWidth().testTag("test_body")) {
                        repeat(12) { Box(Modifier.fillMaxWidth().height(120.dp)) }
                    }
                }
            }
        }

        val overlay = composeRule.onNodeWithTag("test_overlay").fetchSemanticsNode().boundsInRoot
        val title = composeRule.onNodeWithText("Propose a swap").fetchSemanticsNode().boundsInRoot
        val ownContentPx = with(composeRule.density) { 120.dp.toPx() }

        // Hosted in the scrolling body it measured 120dp -- its own content. Filling the sheet
        // it is multiples of that.
        assertTrue(
            "overlay ${overlay.height}px collapsed to its own content (${ownContentPx}px)",
            overlay.height > ownContentPx * 3,
        )
        // ...and it starts at or above the sheet header, so nothing on the sheet is left
        // undimmed above the scrim.
        assertTrue(
            "overlay top ${overlay.top} should be at or above the header top ${title.top}",
            overlay.top <= title.top,
        )
    }
}
