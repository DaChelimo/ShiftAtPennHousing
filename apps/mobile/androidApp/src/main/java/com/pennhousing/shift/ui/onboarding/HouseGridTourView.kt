package com.pennhousing.shift.ui.onboarding

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pennhousing.shift.shared.onboarding.HouseGridTour
import com.pennhousing.shift.shared.onboarding.HouseGridTourStepId
import com.pennhousing.shift.shared.viewmodel.HouseGridTourUiState
import com.pennhousing.shift.ui.kit.ButtonSize
import com.pennhousing.shift.ui.kit.ButtonVariant
import com.pennhousing.shift.ui.kit.ShiftButton
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.theme.ShiftTheme

/**
 * HouseGridTourView (Android) — the Compose port of the interactive "House grid"
 * onboarding tour (see `iosApp/iosApp/HouseGridTourView.swift` for the SwiftUI original).
 * The step copy + sample-grid content live in shared `onboarding/HouseGridTour`; the
 * `HouseGridTourViewModel` sequences the three steps. This file is rendering only,
 * mirroring `ShiftTourView.kt`'s exact shape (SharedPreferences seen-key store, plain
 * Compose visibility rather than iOS's spring/stagger motion). Unlike `ShiftTourUiState`,
 * the shared `HouseGridTourUiState` models no live-interactive step data of its own — the
 * switcher/week-nav (step 2) and the tap targets (steps 1/3) are simple local Compose
 * state here, per the shared module's own doc comment.
 */

/** Its OWN seen-key store, separate from every other tour's (mirrors iOS). */
object HouseGridTourPrefs {
    private const val PREFS = "onboarding"
    private const val KEY = "housegrid_tour_seen_keys"

    fun read(context: Context): Set<String> =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getStringSet(KEY, emptySet())?.toSet() ?: emptySet()

    fun write(
        context: Context,
        seen: Set<String>,
    ) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putStringSet(KEY, HashSet(seen)).apply()
    }
}

/** Per-device flag: whether the House-tab header "?" has already shown its one-time post-tour pointer. */
object HouseGridTourPointerStore {
    private const val PREFS = "onboarding"
    private const val KEY = "housegrid_tour_pointer_shown"

    fun hasShown(context: Context): Boolean = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY, false)

    fun markShown(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY, true).apply()
    }
}

/**
 * The "?" affordance in the House-tab header that replays the tour. Reports its own
 * on-screen bounds via [onPositioned] so the one-time pointer callout can point at the
 * real button without the two composables needing to know each other's layout.
 */
@Composable
fun HouseGridTourHelpButton(
    onClick: () -> Unit,
    onPositioned: (Rect) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    Box(
        modifier
            .size(34.dp)
            .onGloballyPositioned { coords -> onPositioned(coords.boundsInRoot()) }
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.primaryContainer)
            .clickable(onClick = onClick)
            .testTag("housegrid_tour_help"),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            ShiftIcons.QuestionMark,
            contentDescription = "Replay the house grid tour",
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(16.dp),
        )
    }
}

/**
 * The one-time "look here" pointer at the header "?", shown once right after the tour
 * first finishes so the worker learns where it went. Non-blocking (no click handling) and
 * fades on its own timer driven by the caller. [targetRect] is the help button's root-space
 * bounds (from [HouseGridTourHelpButton]'s [onPositioned]); renders nothing until known.
 */
@Composable
fun HouseGridTourPointerCallout(
    targetRect: Rect?,
    modifier: Modifier = Modifier,
) {
    if (targetRect == null) return
    Box(modifier.fillMaxSize().testTag("housegrid_tour_pointer")) {
        Column(
            Modifier
                .padding(top = with(androidx.compose.ui.platform.LocalDensity.current) { (targetRect.bottom + 10f).toDp() })
                .align(Alignment.TopEnd)
                .padding(end = 16.dp)
                .widthIn(max = 200.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(MaterialTheme.colorScheme.primary)
                .padding(horizontal = 14.dp, vertical = 10.dp),
        ) {
            Text("Find this again here", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Text("Tap to replay the tour", color = Color.White.copy(alpha = 0.85f), fontSize = 12.sp)
        }
    }
}

/**
 * The tour overlay — a faithful mini House grid (frozen time rail, day-header row, day
 * columns of desk cells) the worker sees across all three steps, gaining a live house
 * switcher + week nav on step 2, paired with a coach card carrying the step copy and
 * Skip/Back/Next controls.
 */
@Composable
fun HouseGridTourOverlay(
    state: HouseGridTourUiState,
    onNext: () -> Unit,
    onBack: () -> Unit,
    onSkip: () -> Unit,
    onDismissOutside: () -> Unit = onSkip,
) {
    val step = state.step ?: return
    val c = ShiftTheme.colors
    val scrim = if (c.isDark) Color(0xC4000000) else Color(0x99101622)

    // None of this tour's three steps carry a drag gesture, so the scrim can always dismiss.
    Box(
        Modifier
            .fillMaxSize()
            .background(scrim)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onDismissOutside,
            )
            .testTag("housegrid_tour"),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier.widthIn(max = 460.dp).fillMaxWidth().padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            stage(step.id)
            coachCard(state, onNext = onNext, onBack = onBack, onSkip = onSkip)
        }
    }
}

@Composable
private fun stage(stepId: HouseGridTourStepId) {
    val c = ShiftTheme.colors

    // Step 2 sample controls (own local state, reset every time this composable is
    // recomposed from scratch since the overlay only mounts while active): the sample
    // house switcher + week nav, both live-tappable.
    val stageHouses = remember { listOf("Harnwell", "Gutmann") }
    val stageWeeks = remember { listOf("Last week", "This week", "Next week") }
    var stageHouseIndex by remember { mutableIntStateOf(0) }
    var stageWeekIndex by remember { mutableIntStateOf(1) }

    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(22.dp))
            .background(c.surface)
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        if (stepId == HouseGridTourStepId.SWITCH_HOUSE) {
            stageHouseHeader(
                house = stageHouses[stageHouseIndex],
                onTap = { stageHouseIndex = (stageHouseIndex + 1) % stageHouses.size },
            )
        }
        sampleGrid(stepId)
        if (stepId == HouseGridTourStepId.SWITCH_HOUSE) {
            stageWeekNav(
                week = stageWeeks[stageWeekIndex],
                onPrev = { stageWeekIndex = (stageWeekIndex - 1).coerceAtLeast(0) },
                onNext = { stageWeekIndex = (stageWeekIndex + 1).coerceAtMost(stageWeeks.size - 1) },
            )
        }
        mockNav(highlightOpen = stepId == HouseGridTourStepId.EMPTY_SEAT)
    }
}

/**
 * The sample house-switcher header card (step 2 only): the house name, tappable, with a
 * chevron. Tapping cycles the sample house so the worker sees it respond, same as the real
 * switcher sheet would.
 */
@Composable
private fun stageHouseHeader(
    house: String,
    onTap: () -> Unit,
) {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(c.bg)
            .clickable(onClick = onTap)
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .testTag("housegrid_tour_stage_house_switcher"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            Modifier.size(32.dp).clip(RoundedCornerShape(9.dp)).background(MaterialTheme.colorScheme.primaryContainer),
            contentAlignment = Alignment.Center,
        ) {
            Text(house.take(1), color = MaterialTheme.colorScheme.primary, fontSize = 15.sp, fontWeight = FontWeight.Bold)
        }
        Text(house, color = c.ink, fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(end = 0.dp))
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
            Icon(
                ShiftIcons.ChevronRight,
                contentDescription = null,
                tint = c.ter,
                modifier = Modifier.size(12.dp),
            )
        }
    }
}

/**
 * The sample bottom week-nav bar (step 2 only): prev / next chevrons + a week label. Both
 * chevrons are live-tappable in the sample.
 */
@Composable
private fun stageWeekNav(
    week: String,
    onPrev: () -> Unit,
    onNext: () -> Unit,
) {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .border(1.dp, c.divider, RoundedCornerShape(12.dp))
            .padding(horizontal = 6.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(32.dp)
                .clip(CircleShape)
                .clickable(onClick = onPrev)
                .testTag("housegrid_tour_stage_prev_week"),
            contentAlignment = Alignment.Center,
        ) {
            Icon(ShiftIcons.ChevronLeft, contentDescription = "Previous week", tint = c.sec, modifier = Modifier.size(15.dp))
        }
        Row(
            Modifier.weight(1f),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(ShiftIcons.Calendar, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(15.dp))
            Text(week, color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 6.dp))
        }
        Box(
            Modifier
                .size(32.dp)
                .clip(CircleShape)
                .clickable(onClick = onNext)
                .testTag("housegrid_tour_stage_next_week"),
            contentAlignment = Alignment.Center,
        ) {
            Icon(ShiftIcons.ChevronRight, contentDescription = "Next week", tint = c.sec, modifier = Modifier.size(15.dp))
        }
    }
}

/**
 * A faithful mini House grid: a frozen time rail on the left, a frozen day-header row, and
 * 3 day columns of desk cells, some occupied (a name) and one blank (vacant). The step-1
 * cell shows the sample worker's name; the step-3 cell renders visibly blank.
 */
@Composable
private fun sampleGrid(stepId: HouseGridTourStepId) {
    val c = ShiftTheme.colors
    val dayLabels = HouseGridTour.SAMPLE_DAYS
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(HouseGridTour.SAMPLE_HOUSE, color = c.ter, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        Row(verticalAlignment = Alignment.Top) {
            stageTimeRail()
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                stageDayColumn(dayLabels.getOrElse(0) { "Mon" }, hasWorker = true, stepId = stepId)
                stageDayColumn(dayLabels.getOrElse(1) { "Tue" }, hasWorker = false, stepId = stepId)
                stageDayColumn(dayLabels.getOrElse(2) { "Wed" }, hasWorker = true, stepId = stepId)
            }
        }
    }
}

@Composable
private fun stageTimeRail() {
    val c = ShiftTheme.colors
    Column(
        Modifier
            .width(38.dp)
            .clip(RoundedCornerShape(8.dp))
            .padding(4.dp)
            .testTag("housegrid_tour_stage_rail"),
        horizontalAlignment = Alignment.End,
    ) {
        Text("Time", color = Color.Transparent, fontSize = 9.sp)
        listOf("12:00", "14:00", "16:00").forEach { label ->
            Text(label, color = c.ter, fontSize = 10.sp, modifier = Modifier.padding(top = 6.dp))
        }
    }
}

@Composable
private fun stageDayColumn(
    dayLabel: String,
    hasWorker: Boolean,
    stepId: HouseGridTourStepId,
) {
    val c = ShiftTheme.colors
    Column(
        Modifier.width(74.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(dayLabel, color = c.ter, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            if (hasWorker) {
                stageNameCell()
                stageBlankCell(showAsPulsed = false)
            } else {
                stageBlankCell(showAsPulsed = stepId == HouseGridTourStepId.EMPTY_SEAT)
                stageNameCellShort()
            }
        }
    }
}

/** A staffed desk cell showing the sample worker's name (step 1's highlighted cell). Tappable
 * (a mock no-op, matching the iOS reference which is decorative here). */
@Composable
private fun stageNameCell() {
    val c = ShiftTheme.colors
    var tapped by remember { mutableStateOf(false) }
    Column(
        Modifier
            .width(74.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(MaterialTheme.colorScheme.primaryContainer.copy(alpha = if (tapped) 0.9f else 0.5f))
            .border(if (tapped) 1.5.dp else 0.dp, MaterialTheme.colorScheme.primary, RoundedCornerShape(8.dp))
            .clickable { tapped = !tapped }
            .padding(6.dp)
            .testTag("housegrid_tour_stage_name_cell"),
        verticalArrangement = Arrangement.spacedBy(1.dp),
    ) {
        Text("12:00", color = c.sec, fontSize = 9.sp)
        Text(HouseGridTour.SAMPLE_WORKER_NAME, color = c.ink, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

@Composable
private fun stageNameCellShort() {
    val c = ShiftTheme.colors
    Column(
        Modifier
            .width(74.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(c.surfaceVar)
            .padding(6.dp),
        verticalArrangement = Arrangement.spacedBy(1.dp),
    ) {
        Text("14:00", color = c.sec, fontSize = 9.sp)
        Text("Marcus T.", color = c.ink, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

/**
 * A vacant desk cell: outline (border), no name, matching the real grid's vacant style.
 * Rendered with the pending accent when [showAsPulsed] is true (step 3) to draw the eye to
 * "this is what an empty seat looks like".
 */
@Composable
private fun stageBlankCell(showAsPulsed: Boolean) {
    val c = ShiftTheme.colors
    Box(
        Modifier
            .size(width = 74.dp, height = 38.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(c.surface)
            .border(if (showAsPulsed) 2.dp else 1.5.dp, if (showAsPulsed) c.pending else c.outline, RoundedCornerShape(8.dp))
            .testTag("housegrid_tour_stage_blank_cell"),
    )
}

/**
 * A representative bottom-nav strip matching the real tab bar (My Shifts / Open / House /
 * Swaps / More). House stays visually current (this is the House tab's tour); the Open
 * item gets the pending accent in step 3 to show where a vacant seat gets claimed.
 */
@Composable
private fun mockNav(highlightOpen: Boolean) {
    val c = ShiftTheme.colors
    Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
        navItem("My Shifts", ShiftIcons.Calendar, c.ter)
        navItem("Open", ShiftIcons.Plus, if (highlightOpen) c.pending else c.ter)
        navItem("House", ShiftIcons.Building, MaterialTheme.colorScheme.primary)
        navItem("Swaps", ShiftIcons.Refresh, c.ter)
        navItem("More", ShiftIcons.MoreHorizontal, c.ter)
    }
}

@Composable
private fun navItem(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    tint: Color,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(16.dp))
        Text(label, color = tint, fontSize = 10.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun coachCard(
    state: HouseGridTourUiState,
    onNext: () -> Unit,
    onBack: () -> Unit,
    onSkip: () -> Unit,
) {
    val step = state.step ?: return
    val c = ShiftTheme.colors
    Column(
        Modifier
            .widthIn(max = 460.dp)
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(c.surface)
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(step.kicker, color = MaterialTheme.colorScheme.primary, fontSize = 11.sp, fontWeight = FontWeight.Bold)
        Text(step.title, color = c.ink, fontSize = 19.sp, fontWeight = FontWeight.SemiBold)
        Text(step.body, color = c.sec, fontSize = 15.sp)
        Row(
            Modifier.fillMaxWidth().padding(top = 6.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ShiftButton(
                text = "Skip",
                onClick = onSkip,
                variant = ButtonVariant.Text,
                size = ButtonSize.Sm,
                modifier = Modifier.testTag("housegrid_tour_skip"),
            )
            Text("${state.stepIndex} of ${state.stepCount}", color = c.ter, fontSize = 13.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (state.canGoBack) {
                    ShiftButton(
                        text = "Back",
                        onClick = onBack,
                        variant = ButtonVariant.Outlined,
                        size = ButtonSize.Sm,
                        modifier = Modifier.testTag("housegrid_tour_back"),
                    )
                }
                ShiftButton(
                    text = if (state.isLastStep) "Done" else "Next",
                    onClick = onNext,
                    variant = ButtonVariant.Filled,
                    size = ButtonSize.Sm,
                    modifier = Modifier.testTag("housegrid_tour_next"),
                )
            }
        }
    }
}
