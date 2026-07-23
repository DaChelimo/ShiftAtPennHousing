package com.pennhousing.shift.ui.onboarding

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pennhousing.shift.shared.onboarding.NotificationPriming
import com.pennhousing.shift.shared.onboarding.OnboardingTarget
import com.pennhousing.shift.shared.viewmodel.OnboardingUiState
import com.pennhousing.shift.ui.kit.ButtonSize
import com.pennhousing.shift.ui.kit.ButtonVariant
import com.pennhousing.shift.ui.kit.ShiftButton
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.theme.ShiftTheme

/**
 * The persistent "Ask" affordance that surfaces the Assistant beyond the More overflow
 * sheet (BSpec discoverability decision). Sits in the Scaffold's FAB slot on the main
 * tabs; the first-run tour rings it via [OnboardingTarget.ASSISTANT_BUTTON].
 */
@Composable
fun AskAssistantButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier
            .onboardingAnchor(OnboardingTarget.ASSISTANT_BUTTON)
            .testTag("ask_assistant")
            .clip(RoundedCornerShape(percent = 50))
            .background(MaterialTheme.colorScheme.primary)
            .clickable(onClick = onClick)
            .padding(horizontal = 18.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(ShiftIcons.Sparkle, contentDescription = null, tint = Color.White)
        Text("Ask", color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
    }
}

/**
 * Onboarding chrome (Android) — the platform overlay for the shared onboarding logic:
 *   - [OnboardingPrefs] persists the seen-key set (SharedPreferences), mirroring
 *     `ThemePrefs`. These are per-device UX flags, not server state.
 *   - [OnboardingAnchors] + [Modifier.onboardingAnchor] register the on-screen bounds of
 *     the elements the spotlight points at (the five nav items + the Ask button).
 *   - [OnboardingOverlay] draws the dim + spotlight ring + coach-mark card above the
 *     whole scaffold (including the bottom nav), driven by [OnboardingViewModel].
 *
 * The tour steps, tip copy and sequencing all live in shared `onboarding/`; this file is
 * only rendering + persistence, the mobile analogue of the data/UI layer.
 */
object OnboardingPrefs {
    private const val PREFS = "onboarding"
    private const val KEY = "seen_keys"

    fun read(context: Context): Set<String> =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getStringSet(KEY, emptySet())?.toSet() ?: emptySet()

    fun write(
        context: Context,
        seen: Set<String>,
    ) {
        // A fresh mutable copy each write: SharedPreferences retains the exact Set instance,
        // so mutating a previously-stored set would corrupt it.
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putStringSet(KEY, HashSet(seen)).apply()
    }
}

/**
 * Per-device flags for the notification priming card. Shares the `onboarding`
 * SharedPreferences file (these are UX flags, like the seen-keys), but a distinct key so
 * it never collides with the tour's seen-key set.
 */
object NotificationPrefs {
    private const val PREFS = "onboarding"
    private const val RESPONDED = "notif_primer_responded"

    fun hasResponded(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(RESPONDED, false)

    fun markResponded(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(RESPONDED, true).apply()
    }

    /**
     * Whether a POST_NOTIFICATIONS system dialog would actually surface: only on API 33+
     * (the permission is a no-op runtime grant below that) and only while it is not already
     * granted. Note this stays true after a single "Don't allow" until Android stops
     * surfacing the dialog, which is acceptable: the primer's own `hasResponded` flag is the
     * real once-per-install guard.
     */
    fun osCanPrompt(context: Context): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
}

/**
 * The notification priming host (Android). Renders the pre-permission primer once the
 * welcome tour is done ([tourDone]) and the OS would still surface a prompt. Confirm fires
 * the REAL system permission dialog; "Not now" never touches it (so we can re-ask later),
 * and either choice marks the primer responded so it shows at most once. This replaces the
 * cold launch-time request that used to fire in `MainActivity.onCreate`.
 */
@Composable
fun NotificationPrimingHost(tourDone: Boolean) {
    val context = LocalContext.current
    var responded by remember { mutableStateOf(NotificationPrefs.hasResponded(context)) }
    // Recomputed whenever `responded` flips; also reflects a grant made in system settings
    // between compositions.
    val osCanPrompt = remember(responded) { NotificationPrefs.osCanPrompt(context) }
    val launcher =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
            // Whatever the worker chose in the OS dialog, the primer's job is done.
            NotificationPrefs.markResponded(context)
            responded = true
        }
    if (!NotificationPriming.shouldShowPrimer(tourDone = tourDone, osCanPrompt = osCanPrompt, alreadyResponded = responded)) {
        return
    }
    NotificationPrimingCard(
        onConfirm = {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
            } else {
                NotificationPrefs.markResponded(context)
                responded = true
            }
        },
        onDismiss = {
            NotificationPrefs.markResponded(context)
            responded = true
        },
    )
}

/**
 * The priming card itself: a scrim + centered card explaining WHY alerts matter, with a
 * primary "Turn on alerts" and a quiet "Not now". Styled to match the onboarding coach-mark
 * card. The scrim swallows taps, so the worker must make an explicit choice.
 */
@Composable
private fun NotificationPrimingCard(
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    val c = ShiftTheme.colors
    val scrim = if (c.isDark) Color(0xC4000000) else Color(0x99101622)
    Box(
        Modifier
            .fillMaxSize()
            .background(scrim)
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = {})
            .testTag("notification_primer"),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier
                .widthIn(max = 420.dp)
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .clip(RoundedCornerShape(18.dp))
                .background(c.surface)
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(NotificationPriming.TITLE, color = c.ink, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
            Text(NotificationPriming.BODY, color = c.sec, fontSize = 15.sp)
            ShiftButton(
                text = NotificationPriming.CONFIRM,
                onClick = onConfirm,
                variant = ButtonVariant.Filled,
                size = ButtonSize.Sm,
                fullWidth = true,
                modifier = Modifier.padding(top = 6.dp).testTag("notification_primer_confirm"),
            )
            ShiftButton(
                text = NotificationPriming.DISMISS,
                onClick = onDismiss,
                variant = ButtonVariant.Text,
                size = ButtonSize.Sm,
                fullWidth = true,
                modifier = Modifier.testTag("notification_primer_dismiss"),
            )
        }
    }
}

/** The live bounds (root coordinates, px) of each spotlight target, filled as they lay out. */
class OnboardingAnchors {
    private val bounds = androidx.compose.runtime.mutableStateMapOf<OnboardingTarget, Rect>()

    fun report(
        target: OnboardingTarget,
        rect: Rect,
    ) {
        bounds[target] = rect
    }

    fun boundsOf(target: OnboardingTarget): Rect? = bounds[target]
}

val LocalOnboardingAnchors = compositionLocalOf<OnboardingAnchors?> { null }

/**
 * Report this element's bounds as the anchor for [target] so the spotlight can ring it.
 * Reads the current registry from [LocalOnboardingAnchors]; a null registry (e.g. in a
 * preview with no provider) makes it a no-op.
 */
fun Modifier.onboardingAnchor(target: OnboardingTarget): Modifier =
    composed {
        val anchors = LocalOnboardingAnchors.current
        if (anchors == null) {
            this
        } else {
            onGloballyPositioned { coords -> anchors.report(target, coords.boundsInRoot()) }
        }
    }

/**
 * The spotlight + coach-mark overlay. Renders nothing when no coach-mark is active.
 * Placed as the top-most child of the root Box so it dims and overlays the entire
 * scaffold, bottom nav included.
 */
@Composable
fun OnboardingOverlay(
    state: OnboardingUiState,
    anchors: OnboardingAnchors,
    onNext: () -> Unit,
    onBack: () -> Unit,
    onSkip: () -> Unit,
    onDismissTip: () -> Unit,
) {
    val coach = state.current ?: return
    val c = ShiftTheme.colors
    val density = LocalDensity.current

    // The element to ring, if this step points at one and we know where it is yet.
    val ring: Rect? =
        if (coach.target == OnboardingTarget.NONE) {
            null
        } else {
            anchors.boundsOf(coach.target)?.let { r ->
                val pad = with(density) { 6.dp.toPx() }
                Rect(r.left - pad, r.top - pad, r.right + pad, r.bottom + pad)
            }
        }

    val scrim = if (c.isDark) Color(0xC4000000) else Color(0x99101622)
    val radiusPx = with(density) { 14.dp.toPx() }
    val ringStrokePx = with(density) { 2.dp.toPx() }
    val onTap: () -> Unit = { if (state.isTour) onNext() else onDismissTip() }

    BoxWithConstraints(Modifier.fillMaxSize().testTag("onboarding_overlay")) {
        // Dim everything but the ring. Four bands around the hole (no blend modes, so it is
        // robust across GPUs); a full-screen rect when there is nothing to spotlight.
        Canvas(Modifier.fillMaxSize()) {
            if (ring == null) {
                drawRect(scrim)
            } else {
                val w = size.width
                val h = size.height
                drawRect(scrim, topLeft = Offset(0f, 0f), size = Size(w, ring.top))
                drawRect(scrim, topLeft = Offset(0f, ring.bottom), size = Size(w, h - ring.bottom))
                drawRect(scrim, topLeft = Offset(0f, ring.top), size = Size(ring.left, ring.height))
                drawRect(scrim, topLeft = Offset(ring.right, ring.top), size = Size(w - ring.right, ring.height))
                drawRoundRect(
                    color = Color.White.copy(alpha = 0.9f),
                    topLeft = Offset(ring.left, ring.top),
                    size = Size(ring.width, ring.height),
                    cornerRadius = CornerRadius(radiusPx, radiusPx),
                    style = Stroke(width = ringStrokePx),
                )
            }
        }

        // Tapping the dim advances the tour / dismisses a tip -- but ONLY on steps with no
        // spotlighted target (centered welcome/tip cards). A step that rings a real,
        // interactive element (a tab, the Ask button) gets NO tap catcher anywhere: not a
        // full-screen one (that swallows every tap, including ones meant for the real
        // element beneath) and not a hole-punched one either (matching the ring's exact
        // on-screen hole to the real element's true hit-testable frame proved fragile --
        // small discrepancies between the anchor-position geometry and the rendered frame
        // left the real element still unreachable at its edges). With no catcher at all,
        // the real element is always simply itself, fully tappable; the worker advances via
        // the card's own Skip/Next/Done, or by directly using the highlighted control.
        if (ring == null) {
            Box(
                Modifier
                    .fillMaxSize()
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onTap),
            )
        }

        // The coach-mark card. Bottom-anchored above the ring when it points at a target,
        // centered otherwise (welcome + tips). The gap below the card is computed from the
        // ring's OWN position (maxHeight - ring.top), not a flat guess for "the nav bar" —
        // a fixed guess undershoots for a target that floats higher up the screen (like the
        // Ask FAB), letting the card visually and HIT-TESTABLY overlap the very element it
        // spotlights, so a tap meant for that element lands on the card's own Next/Done
        // instead.
        val alignment = if (ring != null) Alignment.BottomCenter else Alignment.Center
        val bottomGap =
            ring?.let { r -> (maxHeight - with(density) { r.top.toDp() } + 12.dp).coerceAtLeast(12.dp) } ?: 24.dp
        Column(
            Modifier
                .align(alignment)
                .fillMaxWidth()
                .padding(start = 20.dp, end = 20.dp, top = 24.dp, bottom = bottomGap),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(
                Modifier
                    .widthIn(max = 420.dp)
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(18.dp))
                    .background(c.surface)
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(coach.title, color = c.ink, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                Text(coach.body, color = c.sec, fontSize = 15.sp)
                if (state.isTour) {
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
                        )
                        Text(
                            "${state.stepIndex} of ${state.stepCount}",
                            color = c.ter,
                            fontSize = 13.sp,
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            if (state.canGoBack) {
                                ShiftButton(
                                    text = "Back",
                                    onClick = onBack,
                                    variant = ButtonVariant.Outlined,
                                    size = ButtonSize.Sm,
                                )
                            }
                            ShiftButton(
                                text = if (state.stepIndex >= state.stepCount) "Done" else "Next",
                                onClick = onNext,
                                variant = ButtonVariant.Filled,
                                size = ButtonSize.Sm,
                            )
                        }
                    }
                } else {
                    ShiftButton(
                        text = "Got it",
                        onClick = onDismissTip,
                        variant = ButtonVariant.Filled,
                        size = ButtonSize.Sm,
                        fullWidth = true,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                }
            }
        }
    }
}
