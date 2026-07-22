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
import com.pennhousing.shift.shared.onboarding.OpenClaimTour
import com.pennhousing.shift.shared.onboarding.OpenClaimTourStepId
import com.pennhousing.shift.shared.viewmodel.OpenClaimTourUiState
import com.pennhousing.shift.ui.kit.ButtonSize
import com.pennhousing.shift.ui.kit.ButtonVariant
import com.pennhousing.shift.ui.kit.ShiftButton
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.theme.ShiftTheme

/**
 * OpenClaimTourView (Android) — the Compose port of the interactive "Claim what's open"
 * onboarding tour (see `iosApp/iosApp/OpenClaimTourView.swift` for the SwiftUI original).
 * Its single most important job: workers do not realize an open shift can be claimed
 * PERMANENTLY (a standing weekly pickup), not just once for the week shown. Step 3's copy
 * below uses the real screen's own section-name wording verbatim from the shared
 * `OpenClaimTour` module ("Weekly open shift" / "Permanent opening", "Claim shift" /
 * "Pick up permanently") — do not paraphrase it.
 *
 * The step copy + the summary math live in shared `onboarding/OpenClaimTour`; the
 * `OpenClaimTourViewModel` sequences the three steps. This file is rendering only, matching
 * `ShiftTourView.kt`'s exact shape/conventions (SharedPreferences for the seen-key store,
 * plain Compose visibility rather than iOS's spring/stagger motion — Android's onboarding
 * overlay is deliberately simpler, and this follows suit).
 */

/** Its OWN seen-key store, separate from every other tour's key (mirrors iOS). */
object OpenClaimTourPrefs {
    private const val PREFS = "onboarding"
    private const val KEY = "openclaim_tour_seen_keys"

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
object OpenClaimTourPointerStore {
    private const val PREFS = "onboarding"
    private const val KEY = "openclaim_tour_pointer_shown"

    fun hasShown(context: Context): Boolean = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY, false)

    fun markShown(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY, true).apply()
    }
}

/**
 * The "?" affordance in the Open-Shifts header that replays the tour. Reports its own
 * on-screen bounds via [onPositioned] so the one-time pointer callout can point at the
 * real button without the two composables needing to know each other's layout.
 */
@Composable
fun OpenClaimTourHelpButton(
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
            .testTag("openclaim_tour_help"),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            ShiftIcons.QuestionMark,
            contentDescription = "Replay the open shifts tour",
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(16.dp),
        )
    }
}

/**
 * The one-time "look here" pointer at the header "?", shown once right after the tour
 * first finishes so the worker learns where it went. Non-blocking (no click handling) and
 * fades on its own timer driven by the caller. [targetRect] is the help button's root-space
 * bounds (from [OpenClaimTourHelpButton]'s [onPositioned]); renders nothing until known.
 */
@Composable
fun OpenClaimTourPointerCallout(
    targetRect: Rect?,
    modifier: Modifier = Modifier,
) {
    if (targetRect == null) return
    Box(modifier.fillMaxSize().testTag("openclaim_tour_pointer")) {
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
 * The tour overlay — the sample open-shift card the worker sees (step 1, with the My House /
 * Others sub-tabs and the Claim button), the part-or-all range pick over the sample shift's
 * blocks (step 2), and the weekly-vs-permanent scope flip that changes the live summary
 * wording under it (step 3), paired with a coach card carrying the step copy and
 * Skip/Back/Next controls.
 */
@Composable
fun OpenClaimTourOverlay(
    state: OpenClaimTourUiState,
    onNext: () -> Unit,
    onBack: () -> Unit,
    onSkip: () -> Unit,
    onDismissOutside: () -> Unit = onSkip,
) {
    val step = state.step ?: return
    val c = ShiftTheme.colors
    val scrim = if (c.isDark) Color(0xD1000000) else Color(0x9E101622)
    // Tapping the scrim dismisses the tour, except on the AMOUNT step where the sample
    // range slider needs the full card area to itself -- a stray tap while dragging must
    // not lose the worker's place.
    val dismissible = step.id != OpenClaimTourStepId.AMOUNT

    // Step-1 sub-tab selection (decorative). Step-2 range state and step-3 scope toggle
    // (functional; drive the shared live summary lines). Defaults mirror
    // OpenClaimTour.DEFAULT_FROM_BLOCK/TO_BLOCK/DEFAULT_PERMANENT. Fresh every time this
    // composable mounts (the overlay is only composed while the tour is active, matching
    // iOS's per-appearance @State).
    var subTab by remember { mutableIntStateOf(0) }
    var from by remember { mutableIntStateOf(OpenClaimTour.DEFAULT_FROM_BLOCK) }
    var to by remember { mutableIntStateOf(OpenClaimTour.DEFAULT_TO_BLOCK) }
    var permanent by remember { mutableStateOf(OpenClaimTour.DEFAULT_PERMANENT) }
    val blockCount = OpenClaimTour.SAMPLE_BLOCK_COUNT

    Box(
        Modifier
            .fillMaxSize()
            .background(scrim)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = { if (dismissible) onDismissOutside() },
            )
            .testTag("openclaim_tour"),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier.widthIn(max = 460.dp).fillMaxWidth().padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            stage(
                stepId = step.id,
                subTab = subTab,
                onSubTab = { subTab = it },
                from = from,
                to = to,
                blockCount = blockCount,
                onRange = { f, t -> from = f; to = t },
                permanent = permanent,
                onScope = { permanent = it },
            )
            coachCard(state, onNext = onNext, onBack = onBack, onSkip = onSkip)
        }
    }
}

@Composable
private fun stage(
    stepId: OpenClaimTourStepId,
    subTab: Int,
    onSubTab: (Int) -> Unit,
    from: Int,
    to: Int,
    blockCount: Int,
    onRange: (Int, Int) -> Unit,
    permanent: Boolean,
    onScope: (Boolean) -> Unit,
) {
    val c = ShiftTheme.colors
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(22.dp))
            .background(c.surface)
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        if (stepId == OpenClaimTourStepId.CLAIM) subTabsRow(subTab, onSubTab)

        val buttonLabel = if (stepId == OpenClaimTourStepId.SCOPE && permanent) "Pick up" else "Claim"
        sampleCard(highlighted = stepId == OpenClaimTourStepId.CLAIM, dimmed = false, buttonLabel = buttonLabel)

        if (stepId == OpenClaimTourStepId.AMOUNT) amountControls(from, to, blockCount, onRange)
        if (stepId == OpenClaimTourStepId.SCOPE) scopeControls(permanent, onScope)
    }
}

/**
 * The real My House / Others sub-tab control, live and tappable, exactly as it renders atop
 * the real Open Shifts tab. Tap targets exercise local/decorative state only (a standard
 * segmented control needs no discoverability hint).
 */
@Composable
private fun subTabsRow(
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
) {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .clip(RoundedCornerShape(12.dp))
            .background(c.surfaceVar)
            .padding(4.dp)
            .testTag("openclaim_tour_subtabs"),
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        subTabSegment("My House", selectedIndex == 0, Modifier.weight(1f)) { onSelect(0) }
        subTabSegment("Others", selectedIndex == 1, Modifier.weight(1f)) { onSelect(1) }
    }
}

@Composable
private fun subTabSegment(
    label: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val c = ShiftTheme.colors
    Box(
        modifier
            .clip(RoundedCornerShape(9.dp))
            .background(if (selected) MaterialTheme.colorScheme.primary else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = if (selected) Color.White else c.sec, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
    }
}

/**
 * The sample open-shift card. Lifts (blue ring) in step 1 to draw the eye to the tap target
 * and its Claim button. [buttonLabel] flips to "Pick up" once step 3 has flipped the scope
 * to permanent, mirroring the real claim sheet's own title change.
 */
@Composable
private fun sampleCard(
    highlighted: Boolean,
    dimmed: Boolean,
    buttonLabel: String,
) {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(c.bg)
            .border(if (highlighted) 2.dp else 0.dp, MaterialTheme.colorScheme.primary, RoundedCornerShape(16.dp))
            .padding(14.dp)
            .testTag("openclaim_tour_sample_card"),
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
            Text(OpenClaimTour.SAMPLE_HOUSE, color = c.sec, fontSize = 13.5.sp)
        }
        ShiftButton(
            text = buttonLabel,
            onClick = {},
            variant = ButtonVariant.Filled,
            size = ButtonSize.Sm,
            modifier = Modifier.testTag("openclaim_tour_claim_button"),
        )
    }
}

/**
 * Step 2 controls: the real (Material 3) [RangeSlider] over the sample shift's blocks and
 * the live "Covering Xh · start to end" summary recomputed by the shared
 * `OpenClaimTour.summaryLine`.
 */
@Composable
private fun amountControls(
    from: Int,
    to: Int,
    blockCount: Int,
    onRange: (Int, Int) -> Unit,
) {
    val c = ShiftTheme.colors
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("How much can you cover?", color = c.sec, fontSize = 13.sp, fontWeight = FontWeight.Medium)
        RangeSlider(
            value = from.toFloat()..to.toFloat(),
            onValueChange = { r ->
                val newFrom = r.start.toInt().coerceIn(0, blockCount - 1)
                val newTo = r.endInclusive.toInt().coerceIn(newFrom + 1, blockCount)
                onRange(newFrom, newTo)
            },
            valueRange = 0f..blockCount.toFloat(),
            steps = (blockCount - 1).coerceAtLeast(0),
            modifier = Modifier.fillMaxWidth().testTag("openclaim_tour_range"),
        )
        Text(
            OpenClaimTour.summaryLine(fromBlock = from, toBlock = to),
            color = MaterialTheme.colorScheme.primary,
            fontSize = 14.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.testTag("openclaim_tour_summary"),
        )
    }
}

/**
 * Step 3 controls: a two-state scope toggle using the real claim sheet's own wording
 * ("Weekly open shift" claims once; "Permanent opening" repeats every week), plus the live
 * one-line consequence (shared `OpenClaimTour.scopeSummary`, reusing the SAME
 * "openclaim_tour_summary" tag step 2 uses) so the flip's effect is visible immediately.
 * The whole toggle is one tap target (tapping either half flips the scope) — Android's
 * onboarding overlay is deliberately simpler than iOS's two-independently-tappable-pill
 * layout, per this file's header note.
 */
@Composable
private fun scopeControls(
    permanent: Boolean,
    onScope: (Boolean) -> Unit,
) {
    val c = ShiftTheme.colors
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(c.surfaceVar)
                .clickable { onScope(!permanent) }
                .padding(4.dp)
                .testTag("openclaim_tour_scope_toggle"),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            scopePill("Weekly open shift", selected = !permanent, isPermanentPill = false, modifier = Modifier.weight(1f))
            scopePill("Permanent opening", selected = permanent, isPermanentPill = true, modifier = Modifier.weight(1f))
        }
        Text(
            OpenClaimTour.scopeSummary(permanent = permanent),
            color = if (permanent) c.permanent.deep else MaterialTheme.colorScheme.primary,
            fontSize = 14.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.testTag("openclaim_tour_summary"),
        )
    }
}

@Composable
private fun scopePill(
    label: String,
    selected: Boolean,
    isPermanentPill: Boolean,
    modifier: Modifier = Modifier,
) {
    val c = ShiftTheme.colors
    val bg =
        when {
            selected && isPermanentPill -> c.permanent.accent
            selected -> MaterialTheme.colorScheme.primary
            else -> Color.Transparent
        }
    Box(
        modifier.clip(RoundedCornerShape(10.dp)).background(bg).padding(vertical = 9.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = if (selected) Color.White else c.sec, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun coachCard(
    state: OpenClaimTourUiState,
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
                modifier = Modifier.testTag("openclaim_tour_skip"),
            )
            Text("${state.stepIndex} of ${state.stepCount}", color = c.ter, fontSize = 13.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (state.canGoBack) {
                    ShiftButton(
                        text = "Back",
                        onClick = onBack,
                        variant = ButtonVariant.Outlined,
                        size = ButtonSize.Sm,
                        modifier = Modifier.testTag("openclaim_tour_back"),
                    )
                }
                ShiftButton(
                    text = if (state.isLastStep) "Done" else "Next",
                    onClick = onNext,
                    variant = ButtonVariant.Filled,
                    size = ButtonSize.Sm,
                    modifier = Modifier.testTag("openclaim_tour_next"),
                )
            }
        }
    }
}
