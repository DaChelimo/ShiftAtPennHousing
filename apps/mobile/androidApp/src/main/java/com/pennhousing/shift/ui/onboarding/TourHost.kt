package com.pennhousing.shift.ui.onboarding

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.delay

/**
 * How long the one-time "look here" pointer at a tour's header "?" stays up before it
 * fades on its own.
 */
private const val POINTER_VISIBLE_MS = 4000L

/**
 * The only things that differ between the six interactive tours' hosting: which
 * SharedPreferences keys hold this tour's seen-set and its one-time pointer flag, and
 * whether a given seen-set still warrants auto-opening.
 *
 * Each tour keeps its OWN stores (persisting one must never clobber another), which is
 * why these arrive as function references to that tour's `XTourPrefs` / `XTourPointerStore`
 * rather than being derived from a shared key prefix.
 */
internal class TourWiring(
    val writeSeen: (Context, Set<String>) -> Unit,
    val pointerHasShown: (Context) -> Boolean,
    val pointerMarkShown: (Context) -> Unit,
    val shouldAutoShow: (Set<String>) -> Boolean,
)

/**
 * The per-tour UI state the host owns: where that tour's header "?" is on screen (reported
 * by the button itself, so the callout can point at the real control without the two
 * composables knowing each other's layout), and whether the callout is currently up.
 */
internal class TourHostState {
    var helpRect by mutableStateOf<Rect?>(null)
    var showPointer by mutableStateOf(false)
}

/**
 * Persists a tour's seen-set as it changes. This is the whole host for the swap-composer
 * tour, which neither auto-opens on a tab landing nor owns a root-level pointer (both live
 * inside ManageShiftSheet, since a root overlay would render behind the modal sheet).
 */
@Composable
internal fun rememberTourSeenWriter(
    wiring: TourWiring,
    seen: Set<String>,
) {
    val context = LocalContext.current
    LaunchedEffect(seen) { wiring.writeSeen(context, seen) }
}

/**
 * Hosts one interactive tour: persists its seen-set, auto-opens it the first time
 * [autoStartWhen] becomes true, and after it first finishes raises the one-time pointer at
 * the header "?" so the re-entry point is learned, then fades it.
 *
 * Replaces seven near-identical ~25-line blocks that each repeated these five effects.
 * Tap-outside dismissal deliberately does NOT go through the once-ever pointer gate: the
 * call site sets [TourHostState.showPointer] directly, so a quick tap-away always re-points
 * at the "?" (see the tours section of apps/mobile/AGENTS.md).
 */
@Composable
internal fun rememberTourHost(
    wiring: TourWiring,
    seen: Set<String>,
    active: Boolean,
    autoStartWhen: Boolean,
    onAutoStart: () -> Unit,
): TourHostState {
    val context = LocalContext.current
    val host = remember { TourHostState() }

    rememberTourSeenWriter(wiring, seen)

    LaunchedEffect(autoStartWhen) { if (autoStartWhen) onAutoStart() }

    LaunchedEffect(active) {
        if (!active && !wiring.shouldAutoShow(seen) && !wiring.pointerHasShown(context)) {
            wiring.pointerMarkShown(context)
            host.showPointer = true
        }
    }

    LaunchedEffect(host.showPointer) {
        if (host.showPointer) {
            delay(POINTER_VISIBLE_MS)
            host.showPointer = false
        }
    }

    return host
}
