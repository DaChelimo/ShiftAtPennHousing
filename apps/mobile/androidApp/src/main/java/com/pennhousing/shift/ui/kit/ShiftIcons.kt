package com.pennhousing.shift.ui.kit

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * Mobile reskin foundation — a curated, dependency-free icon set matching the
 * design's custom 2px-outline 24px-grid glyphs (worker-app.html `ICONS`). Each is
 * a stroked [ImageVector]; render with `Icon(ShiftIcons.X, tint = …)` so the
 * load-bearing "color + icon + text" pairing (design-brief §4/§9) holds.
 *
 * iOS uses the equivalent SF Symbols — see `iosApp/.../Theme/ShiftIcons.swift`.
 * These are hand-authored approximations of the design glyphs; eyeball them on a
 * device when reskinning screens (they are not exercised by the JVM gate).
 */
object ShiftIcons {
    private fun stroked(
        name: String,
        block: PathBuilder.() -> Unit,
    ): ImageVector =
        ImageVector
            .Builder(name = name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
            .apply {
                path(
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = 2f,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                    pathBuilder = block,
                )
            }.build()

    /** Full circle centred at (cx,cy) with radius r, as two half-arcs. */
    private fun PathBuilder.circle(
        cx: Float,
        cy: Float,
        r: Float,
    ) {
        moveTo(cx, cy - r)
        arcTo(r, r, 0f, true, true, cx, cy + r)
        arcTo(r, r, 0f, true, true, cx, cy - r)
    }

    /** Float-out — arrow leaving (↗). */
    val FloatOut: ImageVector =
        stroked("FloatOut") {
            moveTo(7f, 17f)
            lineTo(17f, 7f)
            moveTo(9.5f, 7f)
            lineTo(17f, 7f)
            lineTo(17f, 14.5f)
        }

    /** Float-in — arrow arriving (↙). */
    val FloatIn: ImageVector =
        stroked("FloatIn") {
            moveTo(17f, 7f)
            lineTo(7f, 17f)
            moveTo(14.5f, 17f)
            lineTo(7f, 17f)
            lineTo(7f, 9.5f)
        }

    /** Picked-up / confirmed. */
    val Check: ImageVector =
        stroked("Check") {
            moveTo(5f, 12.5f)
            lineTo(10f, 17.5f)
            lineTo(19.5f, 6.5f)
        }

    /** Acknowledged. */
    val CheckCircle: ImageVector =
        stroked("CheckCircle") {
            circle(12f, 12f, 9f)
            moveTo(8f, 12.2f)
            lineTo(11f, 15.2f)
            lineTo(16f, 8.8f)
        }

    /** Pending — clock. */
    val Clock: ImageVector =
        stroked("Clock") {
            circle(12f, 12f, 8f)
            moveTo(12f, 7.5f)
            lineTo(12f, 12f)
            lineTo(15.5f, 13.5f)
        }

    /** Break — coffee cup. */
    val Coffee: ImageVector =
        stroked("Coffee") {
            moveTo(6.5f, 8.5f)
            lineTo(15.5f, 8.5f)
            lineTo(14.5f, 16.5f)
            lineTo(7.5f, 16.5f)
            close()
            moveTo(15.5f, 10f)
            lineTo(17.5f, 10f)
            arcTo(2.2f, 2.2f, 0f, false, true, 17.5f, 14.4f)
            lineTo(15f, 14.4f)
        }

    /** Permanent opening — recurring arrows. */
    val Refresh: ImageVector =
        stroked("Refresh") {
            moveTo(6f, 11f)
            arcTo(6.5f, 6.5f, 0f, false, true, 17.2f, 8f)
            moveTo(17.5f, 4.5f)
            lineTo(17.5f, 8.2f)
            lineTo(13.8f, 8.2f)
            moveTo(18f, 13f)
            arcTo(6.5f, 6.5f, 0f, false, true, 6.8f, 16f)
            moveTo(6.5f, 19.5f)
            lineTo(6.5f, 15.8f)
            lineTo(10.2f, 15.8f)
        }

    /** Unpickable — lock. */
    val Lock: ImageVector =
        stroked("Lock") {
            moveTo(6f, 11f)
            lineTo(18f, 11f)
            lineTo(18f, 19f)
            lineTo(6f, 19f)
            close()
            moveTo(8.5f, 11f)
            lineTo(8.5f, 8f)
            arcTo(3.5f, 3.5f, 0f, false, true, 15.5f, 8f)
            lineTo(15.5f, 11f)
        }

    /** Dropped — down arrow. */
    val ArrowDown: ImageVector =
        stroked("ArrowDown") {
            moveTo(12f, 5f)
            lineTo(12f, 17f)
            moveTo(7f, 12.5f)
            lineTo(12f, 17.5f)
            lineTo(17f, 12.5f)
        }

    /** Allied — person. */
    val Person: ImageVector =
        stroked("Person") {
            circle(12f, 7.5f, 3.5f)
            moveTo(5.5f, 19.5f)
            arcTo(6.5f, 6.5f, 0f, false, true, 18.5f, 19.5f)
        }

    /** My Shifts — list. */
    val List: ImageVector =
        stroked("List") {
            moveTo(9f, 7f)
            lineTo(19f, 7f)
            moveTo(9f, 12f)
            lineTo(19f, 12f)
            moveTo(9f, 17f)
            lineTo(19f, 17f)
            moveTo(5f, 7f)
            lineTo(5.01f, 7f)
            moveTo(5f, 12f)
            lineTo(5.01f, 12f)
            moveTo(5f, 17f)
            lineTo(5.01f, 17f)
        }

    /** Open — plus. */
    val Plus: ImageVector =
        stroked("Plus") {
            moveTo(12f, 5f)
            lineTo(12f, 19f)
            moveTo(5f, 12f)
            lineTo(19f, 12f)
        }

    val Minus: ImageVector =
        stroked("Minus") {
            moveTo(5f, 12f)
            lineTo(19f, 12f)
        }

    /** Calendar. */
    val Calendar: ImageVector =
        stroked("Calendar") {
            moveTo(5f, 6f)
            lineTo(19f, 6f)
            lineTo(19f, 19f)
            lineTo(5f, 19f)
            close()
            moveTo(8f, 4f)
            lineTo(8f, 7f)
            moveTo(16f, 4f)
            lineTo(16f, 7f)
            moveTo(5f, 10f)
            lineTo(19f, 10f)
        }

    /** Updates — bell. */
    val Bell: ImageVector =
        stroked("Bell") {
            moveTo(8f, 17f)
            lineTo(8f, 11f)
            arcTo(4f, 4f, 0f, false, true, 16f, 11f)
            lineTo(16f, 17f)
            moveTo(6.5f, 17f)
            lineTo(17.5f, 17f)
            moveTo(10.3f, 20f)
            arcTo(1.9f, 1.9f, 0f, false, false, 13.7f, 20f)
        }

    val ChevronRight: ImageVector =
        stroked("ChevronRight") {
            moveTo(9.5f, 5f)
            lineTo(16.5f, 12f)
            lineTo(9.5f, 19f)
        }

    val ChevronLeft: ImageVector =
        stroked("ChevronLeft") {
            moveTo(14.5f, 5f)
            lineTo(7.5f, 12f)
            lineTo(14.5f, 19f)
        }

    val Close: ImageVector =
        stroked("Close") {
            moveTo(6f, 6f)
            lineTo(18f, 18f)
            moveTo(18f, 6f)
            lineTo(6f, 18f)
        }

    /** Warning — triangle + bang. */
    val Warning: ImageVector =
        stroked("Warning") {
            moveTo(12f, 4f)
            lineTo(21f, 19f)
            lineTo(3f, 19f)
            close()
            moveTo(12f, 10f)
            lineTo(12f, 14f)
            moveTo(12f, 16.8f)
            lineTo(12.01f, 16.8f)
        }

    /** Info — circle + i. */
    val Info: ImageVector =
        stroked("Info") {
            circle(12f, 12f, 8f)
            moveTo(12f, 11f)
            lineTo(12f, 16f)
            moveTo(12f, 7.6f)
            lineTo(12.01f, 7.6f)
        }

    /** Phone — for the (future) "Call desk/floater" action. */
    val Phone: ImageVector =
        stroked("Phone") {
            moveTo(7f, 4.5f)
            lineTo(9.5f, 4.5f)
            lineTo(11f, 9f)
            lineTo(8.8f, 10.5f)
            arcTo(9f, 9f, 0f, false, false, 13.5f, 15.2f)
            lineTo(15f, 13f)
            lineTo(19.5f, 14.5f)
            lineTo(19.5f, 17f)
            arcTo(2.5f, 2.5f, 0f, false, true, 17f, 19.5f)
            arcTo(14.5f, 14.5f, 0f, false, true, 4.5f, 7f)
            arcTo(2.5f, 2.5f, 0f, false, true, 7f, 4.5f)
            close()
        }

    /** Tune — sliders (settings / hours limits). */
    val Tune: ImageVector =
        stroked("Tune") {
            moveTo(4f, 8f)
            lineTo(20f, 8f)
            moveTo(4f, 16f)
            lineTo(20f, 16f)
            circle(9f, 8f, 2.4f)
            circle(15f, 16f, 2.4f)
        }

    /** Logout — arrow leaving a door (sign out). */
    val Logout: ImageVector =
        stroked("Logout") {
            moveTo(14f, 5.5f)
            lineTo(6f, 5.5f)
            lineTo(6f, 18.5f)
            lineTo(14f, 18.5f)
            moveTo(11f, 12f)
            lineTo(20f, 12f)
            moveTo(16.5f, 8.5f)
            lineTo(20f, 12f)
            lineTo(16.5f, 15.5f)
        }

    /** Preferred — heart (the preference brush). */
    val Heart: ImageVector =
        stroked("Heart") {
            moveTo(12f, 19.5f)
            curveTo(12f, 19.5f, 4f, 14.5f, 4f, 9f)
            arcTo(3.8f, 3.8f, 0f, false, true, 12f, 7.3f)
            arcTo(3.8f, 3.8f, 0f, false, true, 20f, 9f)
            curveTo(20f, 14.5f, 12f, 19.5f, 12f, 19.5f)
            close()
        }

    /** Cannot — prohibited (the unavailable brush): circle + diagonal slash. */
    val Ban: ImageVector =
        stroked("Ban") {
            circle(12f, 12f, 8f)
            moveTo(6.3f, 6.3f)
            lineTo(17.7f, 17.7f)
        }

    /** Building — a desk/house elsewhere (the cross-house empty state). */
    val Building: ImageVector =
        stroked("Building") {
            moveTo(6f, 20.5f)
            lineTo(6f, 4.5f)
            lineTo(15f, 4.5f)
            lineTo(15f, 20.5f)
            moveTo(4f, 20.5f)
            lineTo(20f, 20.5f)
            moveTo(9f, 8f)
            lineTo(9.01f, 8f)
            moveTo(12f, 8f)
            lineTo(12.01f, 8f)
            moveTo(9f, 12f)
            lineTo(9.01f, 12f)
            moveTo(12f, 12f)
            lineTo(12.01f, 12f)
            moveTo(9f, 20.5f)
            lineTo(9f, 16.5f)
            lineTo(12f, 16.5f)
            lineTo(12f, 20.5f)
        }
}
