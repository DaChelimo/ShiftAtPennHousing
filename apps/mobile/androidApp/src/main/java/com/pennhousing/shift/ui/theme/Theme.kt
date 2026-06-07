package com.pennhousing.shift.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable

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
@Composable
fun ShiftTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colorScheme = if (darkTheme) DarkShiftColorScheme else ShiftColorScheme
    val shiftColors = if (darkTheme) DarkShiftColors else LightShiftColors

    CompositionLocalProvider(
        LocalShiftColors provides shiftColors,
        LocalShiftTypeExtras provides ShiftTypeExtras(),
    ) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = ShiftTypography,
            shapes = ShiftShapesM3,
            content = content,
        )
    }
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
