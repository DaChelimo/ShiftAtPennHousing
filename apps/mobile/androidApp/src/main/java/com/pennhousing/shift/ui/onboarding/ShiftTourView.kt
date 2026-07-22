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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RangeSlider
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
import com.pennhousing.shift.shared.onboarding.ShiftTour
import com.pennhousing.shift.shared.onboarding.ShiftTourStepId
import com.pennhousing.shift.shared.viewmodel.ShiftTourUiState
import com.pennhousing.shift.ui.kit.ButtonSize
import com.pennhousing.shift.ui.kit.ButtonVariant
import com.pennhousing.shift.ui.kit.SegmentedControl
import com.pennhousing.shift.ui.kit.ShiftButton
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.theme.ShiftTheme

/**
 * ShiftTourView (Android) — the Compose port of the interactive "Manage a shift"
 * onboarding tour (see `iosApp/iosApp/ShiftTourView.swift` for the SwiftUI original).
 * The step copy and step-2 summary math live in shared `onboarding/ShiftTour`; the
 * `ShiftTourViewModel` sequences the three steps. This file is rendering only, matching
 * this platform's existing `ui/onboarding/Onboarding.kt` conventions (SharedPreferences
 * for the seen-key store, plain Compose visibility rather than iOS's spring/stagger
 * motion — Android's onboarding overlay is deliberately simpler, and this follows suit).
 */

/** Its OWN seen-key store, separate from the welcome-tour / tips set (mirrors iOS). */
object ShiftTourPrefs {
    private const val PREFS = "onboarding"
    private const val KEY = "shift_tour_seen_keys"

    fun read(context: Context): Set<String> =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getStringSet(KEY, emptySet())?.toSet() ?: emptySet()

    fun write(
        context: Context,
        seen: Set<String>,
    ) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putStringSet(KEY, HashSet(seen)).apply()
    }
}

/** Per-device flag: whether the header "?" has already shown its one-time post-tour pointer. */
object ShiftTourPointerStore {
    private const val PREFS = "onboarding"
    private const val KEY = "shift_tour_pointer_shown"

    fun hasShown(context: Context): Boolean = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY, false)

    fun markShown(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY, true).apply()
    }
}

/**
 * The "?" affordance in the My-Shifts header that replays the tour. Reports its own
 * on-screen bounds via [onPositioned] so the one-time pointer callout can point at the
 * real button without the two composables needing to know each other's layout.
 */
@Composable
fun ShiftTourHelpButton(
    onClick: () -> Unit,
    onPositioned: (Rect) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    Box(
        modifier
            .size(34.dp)
            .onGloballyPositioned { coords -> onPositioned(coords.boundsInRoot()) }
            .clip(CircleShape)
            // ShiftColors has no dedicated "blueContainer" field on Android (unlike the iOS
            // token set); MaterialTheme's own primaryContainer is the closest brand match.
            .background(MaterialTheme.colorScheme.primaryContainer)
            .clickable(onClick = onClick)
            .testTag("shift_tour_help"),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            ShiftIcons.QuestionMark,
            contentDescription = "Replay the shift tour",
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(16.dp),
        )
    }
}

/**
 * The one-time "look here" pointer at the header "?", shown once right after the tour
 * first finishes so the worker learns where it went. Non-blocking (no click handling) and
 * fades on its own timer driven by the caller. [targetRect] is the help button's root-space
 * bounds (from [ShiftTourHelpButton]'s [onPositioned]); renders nothing until known.
 */
@Composable
fun ShiftTourPointerCallout(
    targetRect: Rect?,
    modifier: Modifier = Modifier,
) {
    if (targetRect == null) return
    val c = ShiftTheme.colors
    Box(modifier.fillMaxSize().testTag("shift_tour_pointer")) {
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
 * The tour overlay — the sample My-Shifts card the worker sees (step 1), does the
 * part-or-all range pick on (step 2), and watches land in Open/Swaps (step 3), paired
 * with a coach card carrying the step copy and Skip/Back/Next controls.
 */
@Composable
fun ShiftTourOverlay(
    state: ShiftTourUiState,
    onNext: () -> Unit,
    onBack: () -> Unit,
    onSkip: () -> Unit,
) {
    val step = state.step ?: return
    val c = ShiftTheme.colors
    val scrim = if (c.isDark) Color(0xC4000000) else Color(0x99101622)

    // Step-2 interactive state. Defaults mirror ShiftTour.DEFAULT_FROM_BLOCK/TO_BLOCK
    // (18:00 to 20:00). Fresh every time this composable mounts (the overlay is only
    // composed while the tour is active, matching iOS's per-appearance @State).
    var from by remember { mutableIntStateOf(ShiftTour.DEFAULT_FROM_BLOCK) }
    var to by remember { mutableIntStateOf(ShiftTour.DEFAULT_TO_BLOCK) }
    var permanent by remember { mutableStateOf(false) }
    val blockCount = ShiftTour.SAMPLE_BLOCK_COUNT

    Box(
        Modifier
            .fillMaxSize()
            .background(scrim)
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = {})
            .testTag("shift_tour"),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier.widthIn(max = 460.dp).fillMaxWidth().padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            stage(step.id, from, to, permanent, blockCount, onRange = { f, t -> from = f; to = t }, onScope = { permanent = it })
            coachCard(state, onNext = onNext, onBack = onBack, onSkip = onSkip)
        }
    }
}

@Composable
private fun stage(
    stepId: ShiftTourStepId,
    from: Int,
    to: Int,
    permanent: Boolean,
    blockCount: Int,
    onRange: (Int, Int) -> Unit,
    onScope: (Boolean) -> Unit,
) {
    val c = ShiftTheme.colors
    val dropped = stepId == ShiftTourStepId.DESTINATION
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(22.dp))
            .background(c.surface)
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        if (!dropped) {
            sampleCard(highlighted = stepId == ShiftTourStepId.MANAGE)
            if (stepId == ShiftTourStepId.MANAGE) chipsRow()
            if (stepId == ShiftTourStepId.AMOUNT) amountControls(from, to, permanent, blockCount, onRange, onScope)
        } else {
            // Step 3: the card has "landed" — dim it to show it left the agenda.
            Box(Modifier.fillMaxWidth()) { sampleCard(highlighted = false, dimmed = true) }
        }
        mockNav(highlightOpen = dropped)
    }
}

@Composable
private fun sampleCard(
    highlighted: Boolean,
    dimmed: Boolean = false,
) {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(c.bg)
            .border(if (highlighted) 2.dp else 0.dp, MaterialTheme.colorScheme.primary, RoundedCornerShape(16.dp))
            .padding(14.dp)
            .testTag("shift_tour_sample_card"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier.size(40.dp).clip(RoundedCornerShape(11.dp)).background(c.surfaceVar),
            contentAlignment = Alignment.Center,
        ) {
            Text("H", color = if (dimmed) c.ter else c.ink, fontSize = 17.sp, fontWeight = FontWeight.Bold)
        }
        Column(Modifier.weight(1f)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("16:00 to 20:00", color = if (dimmed) c.ter else c.ink, fontSize = 15.sp)
                Box(Modifier.clip(RoundedCornerShape(6.dp)).background(c.surfaceVar).padding(horizontal = 6.dp, vertical = 2.dp)) {
                    Text("4h", color = c.sec, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                }
            }
            Text(ShiftTour.SAMPLE_HOUSE, color = c.sec, fontSize = 13.5.sp)
        }
        Icon(ShiftIcons.ChevronRight, contentDescription = null, tint = c.outline, modifier = Modifier.size(14.dp))
    }
}

/**
 * Step 1 action chips: Drop standalone, then the grouped Swap + Hand off (both open the
 * swap flow in the real sheet). Reuses the icons already used for the real drop/swap
 * affordances elsewhere in the app rather than inventing new ones.
 */
@Composable
private fun chipsRow() {
    val c = ShiftTheme.colors
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        actionChip("Drop", ShiftIcons.FloatOut, c.pending)
        Row(
            Modifier
                .clip(RoundedCornerShape(16.dp))
                .border(1.dp, c.divider, RoundedCornerShape(16.dp))
                .padding(6.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            actionChip("Swap", ShiftIcons.Refresh, c.success.accent)
            actionChip("Hand off", ShiftIcons.Send, MaterialTheme.colorScheme.primary)
        }
    }
}

@Composable
private fun actionChip(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    tint: Color,
) {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .clip(RoundedCornerShape(50))
            .background(c.surface)
            .border(1.dp, c.divider, RoundedCornerShape(50))
            .padding(start = 6.dp, end = 12.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(Modifier.size(22.dp).clip(CircleShape).background(tint), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(12.dp))
        }
        Text(label, color = c.ink, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
    }
}

/**
 * Step 2 controls: the real (Material 3) [RangeSlider] over the sample shift's blocks, a
 * One time / Permanent segmented control, and the live summary line recomputed by the
 * shared `ShiftTour.summaryLine`.
 */
@Composable
private fun amountControls(
    from: Int,
    to: Int,
    permanent: Boolean,
    blockCount: Int,
    onRange: (Int, Int) -> Unit,
    onScope: (Boolean) -> Unit,
) {
    val c = ShiftTheme.colors
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        RangeSlider(
            value = from.toFloat()..to.toFloat(),
            onValueChange = { r ->
                val newFrom = r.start.toInt().coerceIn(0, blockCount - 1)
                val newTo = r.endInclusive.toInt().coerceIn(newFrom + 1, blockCount)
                onRange(newFrom, newTo)
            },
            valueRange = 0f..blockCount.toFloat(),
            steps = (blockCount - 1).coerceAtLeast(0),
            modifier = Modifier.fillMaxWidth().testTag("shift_tour_range"),
        )
        SegmentedControl(
            options = listOf("One time", "Permanent"),
            selectedIndex = if (permanent) 1 else 0,
            onSelect = { onScope(it == 1) },
        )
        Text(
            ShiftTour.summaryLine(fromBlock = from, toBlock = to, permanent = permanent),
            color = MaterialTheme.colorScheme.primary,
            fontSize = 14.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.testTag("shift_tour_summary"),
        )
    }
}

/**
 * A representative bottom-nav strip mirroring the real [ShiftBottomNav] icon set, so the
 * "where it goes" step points at the actual Open tab glyph rather than an approximation.
 */
@Composable
private fun mockNav(highlightOpen: Boolean) {
    val c = ShiftTheme.colors
    Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
        navItem("My Shifts", ShiftIcons.Calendar, c.ter)
        navItem("Open", ShiftIcons.Plus, if (highlightOpen) c.pending else c.ter)
        navItem("House", ShiftIcons.Building, c.ter)
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
    state: ShiftTourUiState,
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
                modifier = Modifier.testTag("shift_tour_skip"),
            )
            Text("${state.stepIndex} of ${state.stepCount}", color = c.ter, fontSize = 13.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (state.canGoBack) {
                    ShiftButton(
                        text = "Back",
                        onClick = onBack,
                        variant = ButtonVariant.Outlined,
                        size = ButtonSize.Sm,
                        modifier = Modifier.testTag("shift_tour_back"),
                    )
                }
                ShiftButton(
                    text = if (state.isLastStep) "Done" else "Next",
                    onClick = onNext,
                    variant = ButtonVariant.Filled,
                    size = ButtonSize.Sm,
                    modifier = Modifier.testTag("shift_tour_next"),
                )
            }
        }
    }
}
