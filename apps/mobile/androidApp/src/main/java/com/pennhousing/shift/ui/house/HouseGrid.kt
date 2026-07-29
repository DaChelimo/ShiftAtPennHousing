package com.pennhousing.shift.ui.house

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pennhousing.shift.shared.house.HouseGridBlock
import com.pennhousing.shift.shared.house.HouseGridDay
import com.pennhousing.shift.shared.house.wearsWorkerColor
import com.pennhousing.shift.shared.house.workerColor
import com.pennhousing.shift.shared.house.workerContrastText
import com.pennhousing.shift.ui.theme.ShiftTheme
import com.pennhousing.shift.ui.theme.mixedWithWhite

/** A worker's full-strength colour plus the legible foreground that sits on it. */
internal data class WorkerTint(
    val color: Color,
    val onColor: Color,
)

internal fun rgb(hex: Int): Color = Color(0xFF000000L or hex.toLong())

/**
 * This block's occupant colour, or null when the block must keep its STATE colour
 * (vacant / float-in / pending) or carries no worker. The hash + palette live in the
 * shared module so they match `apps/web/lib/workerColor.ts` exactly.
 */
internal fun HouseGridBlock.workerColorOrNull(): WorkerTint? {
    val uid = userId ?: return null
    if (!wearsWorkerColor()) return null
    return WorkerTint(rgb(workerColor(uid)), rgb(workerContrastText(uid)))
}

// ── House grid layout constants (design `HouseScheduleScreen`) ──────────────────
internal val HOUSE_RAIL_W = 42.dp

internal val HOUSE_HEADER_H = 46.dp

internal val HOUSE_PX_PER_HOUR = 46.dp

internal val HOUSE_LANE_W = 92.dp

internal val HOUSE_LANE_GAP = 4.dp

internal val HOUSE_COL_PAD = 6.dp

internal val HOUSE_COL_GAP = 6.dp

/*
 * How OTHER workers' seats recede on the house grid so mine is findable at a glance.
 *
 * They recede by being MIXED TOWARD WHITE, not by having their alpha cut. Lowering alpha
 * only looks like lightening on a light background; over the app's dark surfaces the same
 * move reads as a dim glow, and it quietly invalidates the foreground colour that was
 * chosen for contrast against the full-strength fill (light-on-vivid text going illegible
 * once the fill is diluted toward a dark ground). Mixing toward white lands in the same
 * place in either theme, so receded text can use one fixed dark ink instead of the
 * per-block `fg`.
 *
 * These mirror iOS's `houseOtherWhiteMix` / `houseOtherFinalAlpha` / `houseRecededInk`
 * in ContentView.swift; keep the two platforms in step (see AGENTS.md, cross-platform
 * parity) or the same grid recedes differently on each.
 */

/** How much white is mixed into a receded seat's fill and rail. 0 = untouched, 1 = white. */
internal const val HOUSE_OTHER_WHITE_MIX = 0.72f

/**
 * A final, gentle alpha on the already-lightened fill so it settles into the grid instead
 * of glaring off a dark background. Kept high: the recede is the mix, not this.
 */
internal const val HOUSE_OTHER_FINAL_ALPHA = 0.9f

/**
 * The single ink every receded seat's text uses. Fixed (not per-block) because the
 * white-mixed fill is always light, in either theme, so one dark ink always reads.
 */
internal val HOUSE_RECEDED_INK = Color(0xFF1F2430)

/**
 * The grid: a frozen left [HouseTimeRail] + horizontally-scrolling day columns, with a
 * frozen day-header row above. The header row and the body share one horizontal
 * `ScrollState` (so they scroll sideways together); the rail lives inside the vertical
 * scroll but outside the horizontal one, so it stays put when the days scroll sideways
 * — the load-bearing requirement.
 */
@Composable
internal fun HouseGrid(
    grid: com.pennhousing.shift.shared.house.HouseGridWeek,
    focusDayIndex: Int,
    nowMinOfDay: Int,
    focusKey: String,
    onBlockTap: (HouseGridBlock) -> Unit,
    vacantTappable: Boolean = false,
) {
    val hScroll = rememberScrollState()
    val vScroll = rememberScrollState()
    val density = LocalDensity.current
    val laneCount = grid.laneCount
    val colW = HOUSE_LANE_W * laneCount + HOUSE_LANE_GAP * (laneCount - 1) + HOUSE_COL_PAD * 2
    val gridHeight = HOUSE_PX_PER_HOUR * ((grid.endMin - grid.startMin) / 60f)

    // Scroll to "now" when the shown week contains today (on open / house-switch / week
    // change): the today column comes into view (it may sit at the end of the week) and the
    // body scrolls down to the current hour. Other weeks have no "today" → no auto-scroll.
    LaunchedEffect(focusKey, focusDayIndex, grid.startMin, grid.endMin, grid.laneCount) {
        if (focusDayIndex < 0) return@LaunchedEffect
        val colWpx = with(density) { colW.toPx() }
        val gapPx = with(density) { HOUSE_COL_GAP.toPx() }
        hScroll.animateScrollTo((focusDayIndex * (colWpx + gapPx)).toInt().coerceAtLeast(0))
        val pxPerHour = with(density) { HOUSE_PX_PER_HOUR.toPx() }
        val y = (pxPerHour * ((nowMinOfDay - grid.startMin) / 60f) - pxPerHour).toInt().coerceAtLeast(0)
        vScroll.animateScrollTo(y)
    }

    Column(Modifier.fillMaxSize()) {
        // Frozen day-header row — scrolls sideways with the body, never vertically.
        Row(Modifier.fillMaxWidth().padding(start = 12.dp)) {
            Spacer(Modifier.width(HOUSE_RAIL_W))
            Row(
                Modifier.horizontalScroll(hScroll),
                horizontalArrangement = Arrangement.spacedBy(HOUSE_COL_GAP),
            ) {
                grid.days.forEach { day -> HouseDayHeader(day, colW) }
                Spacer(Modifier.width(8.dp))
            }
        }
        // Body — rail + columns scroll vertically together; columns also scroll sideways.
        Row(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(vScroll)
                .padding(start = 12.dp, top = 2.dp, bottom = 8.dp),
        ) {
            HouseTimeRail(grid.startMin, grid.endMin, gridHeight)
            Row(
                Modifier.horizontalScroll(hScroll),
                horizontalArrangement = Arrangement.spacedBy(HOUSE_COL_GAP),
            ) {
                grid.days.forEach { day ->
                    HouseDayColumn(day, colW, gridHeight, grid.startMin, grid.endMin, onBlockTap, vacantTappable)
                }
                Spacer(Modifier.width(8.dp))
            }
        }
    }
}

/**
 * The 2-hour clock marks (e.g. 06:00, 08:00, …) strictly between [startMin] and [endMin] —
 * shared by the rail's labels and each day column's gridlines.
 */
internal fun houseHourMarks(
    startMin: Int,
    endMin: Int,
): List<Int> {
    val marks = mutableListOf<Int>()
    var h = (startMin / 120 + 1) * 120
    while (h < endMin) {
        marks.add(h)
        h += 120
    }
    return marks
}

internal fun fmtHm(min: Int): String = "${(min / 60).toString().padStart(2, '0')}:${(min % 60).toString().padStart(2, '0')}"

/**
 * The fixed left time rail — frozen during sideways scroll. The top label is the EXACT grid
 * origin (e.g. "05:30" when that's the week's earliest actual shift start, not rounded to an
 * hour), then a label at every 2-hour clock mark, and a final label at the bottom bound.
 */
@Composable
internal fun HouseTimeRail(
    startMin: Int,
    endMin: Int,
    gridHeight: Dp,
) {
    val c = ShiftTheme.colors
    val labels = remember(startMin, endMin) { (listOf(startMin) + houseHourMarks(startMin, endMin) + listOf(endMin)).distinct() }
    Box(Modifier.width(HOUSE_RAIL_W).height(gridHeight).testTag("house_time_rail")) {
        labels.forEach { m ->
            val y = (HOUSE_PX_PER_HOUR * ((m - startMin) / 60f) - 5.dp).coerceAtLeast(0.dp)
            Text(
                fmtHm(m),
                style = ShiftTheme.type.monoId.copy(fontSize = 10.sp),
                color = c.ter,
                modifier = Modifier.align(Alignment.TopEnd).offset(y = y).padding(end = 6.dp),
            )
        }
    }
}

/** One Mon-Sun header cell (day + date), highlighted when it is today. */
@Composable
internal fun HouseDayHeader(
    day: HouseGridDay,
    colW: Dp,
) {
    val c = ShiftTheme.colors
    val primary = MaterialTheme.colorScheme.primary
    Column(
        Modifier
            .width(colW)
            .height(HOUSE_HEADER_H)
            .clip(RoundedCornerShape(10.dp))
            .background(if (day.isToday) primary.copy(alpha = 0.10f) else Color.Transparent),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(day.dayLabel, color = if (day.isToday) primary else c.ter, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
        Text(
            day.dateLabel,
            style = ShiftTheme.type.monoTime.copy(fontSize = 13.sp),
            color = if (day.isToday) primary else c.ink,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

/** One day column: the surface card + 2-hour gridlines + the lane-placed blocks. */
@Composable
internal fun HouseDayColumn(
    day: HouseGridDay,
    colW: Dp,
    gridHeight: Dp,
    startMin: Int,
    endMin: Int,
    onBlockTap: (HouseGridBlock) -> Unit,
    vacantTappable: Boolean = false,
) {
    val c = ShiftTheme.colors
    Box(
        Modifier
            .width(colW)
            .height(gridHeight)
            .clip(RoundedCornerShape(10.dp))
            .background(c.surface)
            .border(1.dp, c.divider, RoundedCornerShape(10.dp))
            .testTag("house_day_column"),
    ) {
        houseHourMarks(startMin, endMin).forEach { h ->
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(1.dp)
                    .offset(y = HOUSE_PX_PER_HOUR * ((h - startMin) / 60f))
                    .background(c.divider.copy(alpha = 0.6f)),
            )
        }
        day.blocks.forEach { b -> HouseGridBlockCell(b, colW, startMin, day.isToday, onBlockTap, vacantTappable) }
    }
}

/**
 * One positioned desk block, coloured by its state (design `HouseBlock`).
 *
 * Two colour systems, in this order:
 *
 * 1. **Per-worker colour** (docs/design/worker-colors.md) — a plain SCHEDULED seat wears
 *    its occupant's own colour, a pure hash of their `user_id`, so the same person reads
 *    the same here and on the web calendars. Fill is that colour at 90%, the leading rail
 *    and border full strength, the name its precomputed contrast foreground.
 * 2. **State colour** — float-in, pending and vacant seats KEEP their state colours,
 *    because those carry meaning (a float must still read as a float).
 *
 * The "mine" emphasis rides on top of either: my shift TODAY keeps its solid brand ring
 * so it's still the one block that pops, exactly like the web card's `.scard-mine`
 * outline over a worker-tinted fill.
 */
@Composable
internal fun HouseGridBlockCell(
    b: HouseGridBlock,
    colW: Dp,
    startMin: Int,
    isToday: Boolean,
    onTap: (HouseGridBlock) -> Unit,
    vacantTappable: Boolean = false,
) {
    val c = ShiftTheme.colors
    val primary = MaterialTheme.colorScheme.primary
    val onContainer = MaterialTheme.colorScheme.onPrimaryContainer
    val top = HOUSE_PX_PER_HOUR * ((b.startMin - startMin) / 60f)
    val height = (HOUSE_PX_PER_HOUR * ((b.endMin - b.startMin) / 60f) - 3.dp).coerceAtLeast(18.dp)
    // A desk that's never concurrent with another during this run (segmentLanes == 1) collapses
    // to one full-width column instead of a narrow lane next to empty space.
    val collapsed = b.segmentLanes <= 1
    val width = if (collapsed) colW - HOUSE_COL_PAD * 2 else HOUSE_LANE_W
    val x = if (collapsed) HOUSE_COL_PAD else HOUSE_COL_PAD + (HOUSE_LANE_W + HOUSE_LANE_GAP) * b.lane
    // mine + today → solid blue ring (the one block that should pop).
    val emphatic = b.mine && isToday && !b.floatIn
    val wc = b.workerColorOrNull()
    val (bg, accent, fg) =
        when {
            b.vacant -> Triple(c.surface, c.outline, c.ter)
            wc != null -> Triple(wc.color.copy(alpha = 0.90f), wc.color, wc.onColor)
            b.mine && b.floatIn -> Triple(c.floatIn.tint, c.floatIn.accent, c.floatIn.deep)
            b.mine && isToday -> Triple(c.today, primary, onContainer)
            b.mine -> Triple(MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f), primary.copy(alpha = 0.5f), onContainer)
            b.pending -> Triple(c.surfaceVar, c.pending, c.ink)
            b.floatIn -> Triple(c.floatIn.tint, c.floatIn.accent, c.floatIn.deep)
            else -> Triple(c.surfaceVar, c.outline, c.ink)
        }
    // The time label keeps a hint of the worker's hue without losing contrast (web:
    // `color-mix(in srgb, F 75%, C 25%)`); on a state-coloured block it's just `fg`.
    val timeFg = if (wc != null) lerp(fg, wc.color, 0.25f) else fg
    val shape = RoundedCornerShape(8.dp)
    // Everyone else's seats recede so mine is findable at a glance: a grid where every seat
    // wears a saturated colour is pretty but useless for the one question a worker actually
    // asks ("where am I?"). Vacant seats are nobody's card and stay full strength (they're
    // the actionable open-seat affordance for a manager). The recede is a white MIX, not an
    // alpha cut, so receded text switches to one fixed dark ink (see the constants above).
    val receded = !(b.mine || b.vacant)
    val recededBg =
        if (receded) bg.mixedWithWhite(HOUSE_OTHER_WHITE_MIX).copy(alpha = HOUSE_OTHER_FINAL_ALPHA) else bg
    val recededAccent = if (receded) accent.mixedWithWhite(HOUSE_OTHER_WHITE_MIX) else accent
    val displayFg = if (receded) HOUSE_RECEDED_INK else fg
    val displayTimeFg = if (receded) HOUSE_RECEDED_INK.copy(alpha = 0.65f) else timeFg
    val displayPendingFg = if (receded) HOUSE_RECEDED_INK.copy(alpha = 0.8f) else c.pending
    Box(
        Modifier
            .offset(x = x, y = top)
            .width(width)
            .height(height)
            .clip(shape)
            .background(recededBg)
            .then(
                when {
                    b.vacant -> Modifier.dashedBorder(accent, 8.dp)
                    emphatic -> Modifier.border(1.5.dp, primary, shape)
                    wc != null -> Modifier.border(1.dp, recededAccent, shape)
                    else -> Modifier.border(1.dp, recededAccent.copy(alpha = 0.45f), shape)
                },
            ).drawBehind { drawRect(color = recededAccent, size = Size(3.dp.toPx(), size.height)) }
            .clickable(enabled = !b.vacant || vacantTappable) { onTap(b) }
            .padding(start = 7.dp, end = 5.dp, top = 4.dp, bottom = 3.dp)
            .testTag("house_grid_block"),
    ) {
        Column {
            Text(b.timeLabel, style = ShiftTheme.type.monoId.copy(fontSize = 10.5.sp), color = displayTimeFg, maxLines = 1)
            Text(
                b.workerLabel + if (b.mine && b.floatIn) " ·float" else "",
                color = displayFg,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (b.pending) {
                Text("Pending", color = displayPendingFg, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
            }
        }
    }
}

/** A dashed rounded outline (open blocks + the legend's "Open" swatch). */
internal fun Modifier.dashedBorder(
    color: Color,
    cornerRadius: Dp,
): Modifier =
    drawBehind {
        drawRoundRect(
            color = color,
            style = Stroke(width = 1.5.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 4f), 0f)),
            cornerRadius = CornerRadius(cornerRadius.toPx(), cornerRadius.toPx()),
        )
    }

/** "4h" / "30m" / "1h 30m" — the tapped slot's length, read off the grid's own minutes. */
internal fun HouseGridBlock.durationLabel(): String {
    val mins = endMin - startMin
    val h = mins / 60
    val m = mins % 60
    return when {
        h == 0 -> "${m}m"
        m == 0 -> "${h}h"
        else -> "${h}h ${m}m"
    }
}
