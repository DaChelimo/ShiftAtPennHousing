package com.pennhousing.shift.ui.onboarding

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.theme.Dimens

// The break tour's chrome: its two SharedPreferences stores, the header "?" that replays it,
// and the one-time pointer callout at that "?". Split out of `BreakTourView.kt` (which is the
// overlay's rendering only) to keep both files inside the size ceiling, mirroring
// `SwapTourChrome.kt`.

/** Its OWN seen-key store, separate from every other tour's (mirrors iOS). */
object BreakTourPrefs {
    private const val PREFS = "onboarding"
    private const val KEY = "break_tour_seen_keys"

    fun read(context: Context): Set<String> =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getStringSet(KEY, emptySet())?.toSet() ?: emptySet()

    fun write(
        context: Context,
        seen: Set<String>,
    ) {
        context
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putStringSet(KEY, HashSet(seen))
            .apply()
    }
}

/** Per-device flag: whether the header "?" has already shown its one-time post-tour pointer. */
object BreakTourPointerStore {
    private const val PREFS = "onboarding"
    private const val KEY = "break_tour_pointer_shown"

    fun hasShown(context: Context): Boolean = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY, false)

    fun markShown(context: Context) {
        context
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY, true)
            .apply()
    }
}

/**
 * The "?" affordance in the Break-calendar header that replays the tour. Reports its own
 * on-screen bounds via [onPositioned] so the one-time pointer callout can point at the real
 * button without the two composables needing to know each other's layout.
 */
@Composable
fun BreakTourHelpButton(
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
            .testTag("break_tour_help"),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            ShiftIcons.QuestionMark,
            contentDescription = "Replay the break calendar tour",
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(Dimens.iconSm),
        )
    }
}

/**
 * The one-time "look here" pointer at the header "?", shown once right after the tour first
 * finishes so the worker learns where it went. Non-blocking (no click handling); [targetRect]
 * is the help button's root-space bounds (from [BreakTourHelpButton]'s [onPositioned]); renders
 * nothing until known.
 */
@Composable
fun BreakTourPointerCallout(
    targetRect: Rect?,
    modifier: Modifier = Modifier,
) {
    if (targetRect == null) return
    Box(modifier.fillMaxSize().testTag("break_tour_pointer")) {
        Column(
            Modifier
                .padding(top = with(LocalDensity.current) { (targetRect.bottom + 10f).toDp() })
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
