package com.pennhousing.shift.ui.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.drag
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * A two-thumb range slider over a shift's 30-min blocks — one slider unit per block, so the
 * thumbs snap on 30-minute boundaries. The selected zone `[from, to)` is app blue; the rest
 * of the track is a lighter blue. Drives the same `rangeFrom` / `rangeTo` block indexes the
 * §5.2/§5.3 partial plans use.
 *
 * **This is a port of `iosApp/iosApp/ContentView.swift`'s `BlockRangeSlider`, which is the
 * reference implementation.** Every metric here is that view's: 6dp capsule track, 24dp
 * round white thumbs with a 2dp blue ring and a soft shadow, a 32dp control. It replaced
 * Material 3's stock `RangeSlider`, whose expressive look (16dp bar track, 4x44dp handles,
 * tick dots) read as a different control from the one iOS ships. If you restyle the iOS
 * view, restyle this one; do not "modernise" this one on its own.
 *
 * @param lowerBound the free run's lower clamp; @param upperBound its upper (-1 → blockCount).
 *   As on iOS, the track stays block-ABSOLUTE (0..blockCount) when a run is clamped, so the
 *   selection keeps aligning to wall-clock position rather than rescaling under the worker.
 */
@Composable
fun BlockRangeSlider(
    blockCount: Int,
    from: Int,
    to: Int,
    onRange: (Int, Int) -> Unit,
    modifier: Modifier = Modifier,
    lowerBound: Int = 0,
    upperBound: Int = -1,
) {
    // Android's ShiftColors has no `blue` field (unlike the iOS token set); the brand blue
    // is MaterialTheme's own primary, which resolves to the same #0061FC / #0A84FF pair.
    val blue = MaterialTheme.colorScheme.primary
    // The gesture must read the LIVE from/to without re-keying pointerInput on them: re-keying
    // restarts the handler mid-drag, which cancels the drag on its very first move.
    val liveFrom by rememberUpdatedState(from)
    val liveTo by rememberUpdatedState(to)
    val liveOnRange by rememberUpdatedState(onRange)

    BoxWithConstraints(
        modifier
            .fillMaxWidth()
            .height(HEIGHT)
            .pointerInput(blockCount, lowerBound, upperBound) {
                val thumbPx = THUMB.toPx()
                val hitPx = HIT_RADIUS.toPx()
                val unitPx = ((size.width - thumbPx).coerceAtLeast(1f)) / maxOf(blockCount, 1)
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    val fromPx = thumbPx / 2 + unitPx * liveFrom
                    val toPx = thumbPx / 2 + unitPx * liveTo
                    // The upper thumb wins an overlap, matching the iOS view's z-order (its
                    // `to` thumb is declared last, so SwiftUI hit-tests it first).
                    val draggingFrom =
                        when {
                            abs(down.position.x - toPx) <= hitPx -> false
                            abs(down.position.x - fromPx) <= hitPx -> true
                            else -> return@awaitEachGesture // a press on bare track does nothing, as on iOS
                        }
                    down.consume()
                    val lo = maxOf(lowerBound, 0)
                    val hi = if (upperBound < 0) blockCount else minOf(upperBound, blockCount)
                    drag(down.id) { change ->
                        val snapped = ((change.position.x - thumbPx / 2) / unitPx).roundToInt()
                        if (draggingFrom) {
                            liveOnRange(snapped.coerceIn(lo, liveTo - 1), liveTo)
                        } else {
                            liveOnRange(liveFrom, snapped.coerceIn(liveFrom + 1, hi))
                        }
                        change.consume()
                    }
                }
            },
    ) {
        val span = (maxWidth - THUMB).coerceAtLeast(1.dp)
        val unit = span / maxOf(blockCount, 1)
        val fromX = THUMB / 2 + unit * from.coerceIn(0, blockCount)
        val toX = THUMB / 2 + unit * to.coerceIn(0, blockCount)

        // Not-selected zone — the full track in a lighter blue.
        Box(
            Modifier
                .align(Alignment.CenterStart)
                .fillMaxWidth()
                .height(TRACK)
                .clip(CircleShape)
                .background(blue.copy(alpha = 0.2f)),
        )
        // Selected zone [from, to) — app blue.
        Box(
            Modifier
                .align(Alignment.CenterStart)
                .offset(x = fromX)
                .width(maxOf(toX - fromX, TRACK))
                .height(TRACK)
                .clip(CircleShape)
                .background(blue),
        )
        Thumb(centerX = fromX)
        Thumb(centerX = toX)
    }
}

/** The white, blue-ringed handle (iOS `thumbView`). */
@Composable
private fun androidx.compose.foundation.layout.BoxScope.Thumb(centerX: Dp) {
    Box(
        Modifier
            .align(Alignment.CenterStart)
            .offset(x = centerX - THUMB / 2)
            .size(THUMB)
            .shadow(2.dp, CircleShape)
            .background(Color.White, CircleShape)
            .border(2.dp, MaterialTheme.colorScheme.primary, CircleShape),
    )
}

/** Centre x of the handle for block `index` — the iOS view's own thumb math, shared so a
 * tour's "drag me" badge can ride the real handle instead of approximating it. */
fun blockThumbCenterX(
    index: Int,
    blockCount: Int,
    width: Dp,
): Dp {
    val span = (width - THUMB).coerceAtLeast(1.dp)
    val unit = span / maxOf(blockCount, 1)
    return THUMB / 2 + unit * index.coerceIn(0, maxOf(blockCount, 0))
}

private val THUMB = 24.dp
private val TRACK = 6.dp
private val HEIGHT = 32.dp

/** Slightly wider than the drawn thumb so a fingertip landing just off it still grabs. */
private val HIT_RADIUS = 16.dp
