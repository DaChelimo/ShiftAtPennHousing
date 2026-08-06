package com.pennhousing.shift.ui.theme

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.Density
import androidx.core.view.WindowCompat

/**
 * Mobile reskin foundation — the theme entry point.
 *
 * Wraps Material 3 with the brand [ShiftColorScheme] (NOT Android's wallpaper
 * dynamic color — the brand owns the palette), [ShiftTypography] (IBM Plex), and
 * [ShiftShapesM3]; and provides the load-bearing [ShiftColors] + mono
 * [ShiftTypeExtras] via CompositionLocals. Read the extras through the [ShiftTheme]
 * accessor object, e.g. `ShiftTheme.colors.floatOut.accent` / `ShiftTheme.type.monoTimeHero`.
 *
 * This is the single composable every worker screen wraps with (replacing the
 * bare `MaterialTheme {}` the Phase-13a screens shipped with).
 */
// App-wide font bump (2026-07): the whole app read as shrunk on a large phone (iPhone 17 Pro
// Max feedback, ported to Android for parity). Matches the ratio of the nav-bar label bump
// the user confirmed they liked (10.5sp -> 11.5sp = 1.095x). Applied once here, via a scaled
// `LocalDensity.fontScale`, so it reaches EVERY `sp` size app-wide — both `ShiftTypography`
// and the hundreds of inline `fontSize = X.sp` literals across screens — without editing them
// individually. `sp` sizes are density.fontScale-relative by design (that's how Android
// Dynamic Type / a11y font scaling already works), so this composes correctly with the
// system font-size setting instead of fighting it.
private const val APP_FONT_SCALE = 1.1f

@Composable
fun ShiftTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colorScheme = if (darkTheme) DarkShiftColorScheme else ShiftColorScheme
    val shiftColors = if (darkTheme) DarkShiftColors else LightShiftColors
    val scaledDensity = LocalDensity.current.let { Density(it.density, it.fontScale * APP_FONT_SCALE) }

    // Status/navigation bar ICON tint must follow the IN-APP theme, not the OS one.
    // `enableEdgeToEdge()` (MainActivity) defaults to SystemBarStyle.auto, whose
    // detectDarkMode reads Configuration.uiMode — i.e. the SYSTEM appearance. With the app
    // on Dark while the phone is on Light, the bars stayed in their light-background mode
    // and the clock / battery / signal icons rendered near-black on our dark chrome. Driving
    // the appearance flags off `darkTheme` here (the same flag the palette resolves from)
    // ties them to whatever the worker picked in Settings, and re-fires on every theme
    // change because this composable recomposes with the new value. iOS never had the bug:
    // its bar style rides the SwiftUI color scheme, which is already the in-app choice.
    val view = LocalView.current
    if (!view.isInEditMode) {
        val window = (view.context.findActivity())?.window
        if (window != null) {
            SideEffect {
                WindowCompat.getInsetsController(window, view).apply {
                    isAppearanceLightStatusBars = !darkTheme
                    isAppearanceLightNavigationBars = !darkTheme
                }
            }
        }
    }

    CompositionLocalProvider(
        LocalShiftColors provides shiftColors,
        LocalShiftTypeExtras provides ShiftTypeExtras(),
        LocalDensity provides scaledDensity,
    ) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = ShiftTypography,
            shapes = ShiftShapesM3,
            content = content,
        )
    }
}

/**
 * The Activity behind a composition's view, unwrapping ContextThemeWrappers. Null under a
 * preview / non-Activity host, where there is no window to tint.
 */
private tailrec fun Context.findActivity(): Activity? =
    when (this) {
        is Activity -> this
        is ContextWrapper -> baseContext.findActivity()
        else -> null
    }

/** Convenience accessors for the bespoke token layers, mirroring `MaterialTheme.*`. */
object ShiftTheme {
    val colors: ShiftColors
        @Composable @ReadOnlyComposable
        get() = LocalShiftColors.current

    val type: ShiftTypeExtras
        @Composable @ReadOnlyComposable
        get() = LocalShiftTypeExtras.current
}
