package com.pennhousing.shift.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.runtime.Immutable
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.pennhousing.shift.R

/**
 * Mobile reskin foundation — typography layer.
 *
 * Commits to **IBM Plex** per the brief: IBM Plex Sans for UI, IBM Plex Mono for
 * times / durations / IDs / numbers. The weights are bundled in
 * `androidApp/src/main/res/font/` (no runtime download). Sizes are `sp`, so they
 * scale with the user's font-size setting (Dynamic Type) automatically; the M3
 * type scale below is the brand ramp extracted from `worker-app.html`.
 *
 * Roboto is the graceful fallback (Compose substitutes it for any missing glyph).
 * Mono/numeric styles enable tabular figures + the Plex slashed zero
 * (`fontFeatureSettings = "tnum, zero"`) to match the design's `'zero' 1`.
 */

val PlexSans =
    FontFamily(
        Font(R.font.ibm_plex_sans_regular, FontWeight.Normal),
        Font(R.font.ibm_plex_sans_medium, FontWeight.Medium),
        Font(R.font.ibm_plex_sans_semibold, FontWeight.SemiBold),
        Font(R.font.ibm_plex_sans_bold, FontWeight.Bold),
    )

val PlexMono =
    FontFamily(
        Font(R.font.ibm_plex_mono_regular, FontWeight.Normal),
        Font(R.font.ibm_plex_mono_medium, FontWeight.Medium),
        Font(R.font.ibm_plex_mono_semibold, FontWeight.SemiBold),
    )

private const val NUM_FEATURES = "tnum, zero" // tabular figures + slashed zero

/** Material 3 type scale, IBM Plex Sans, brand ramp (worker-app.html `TypePanel`). */
val ShiftTypography =
    Typography(
        displaySmall =
            TextStyle(
                fontFamily = PlexSans,
                fontWeight = FontWeight.SemiBold,
                fontSize = 28.sp,
                lineHeight = 34.sp,
                letterSpacing = (-0.01).em,
            ),
        headlineLarge =
            TextStyle(
                fontFamily = PlexSans,
                fontWeight = FontWeight.Bold,
                fontSize = 26.sp,
                lineHeight = 32.sp,
                letterSpacing = (-0.02).em,
            ),
        headlineMedium =
            TextStyle(
                fontFamily = PlexSans,
                fontWeight = FontWeight.Bold,
                fontSize = 22.sp,
                lineHeight = 28.sp,
                letterSpacing = (-0.02).em,
            ),
        headlineSmall =
            TextStyle(
                fontFamily = PlexSans,
                fontWeight = FontWeight.Bold,
                fontSize = 20.sp,
                lineHeight = 26.sp,
                letterSpacing = (-0.01).em,
            ),
        titleLarge =
            TextStyle(
                fontFamily = PlexSans,
                fontWeight = FontWeight.Bold,
                fontSize = 19.sp,
                lineHeight = 24.sp,
                letterSpacing = (-0.01).em,
            ),
        titleMedium =
            TextStyle(
                fontFamily = PlexSans,
                fontWeight = FontWeight.SemiBold,
                fontSize = 18.sp,
                lineHeight = 24.sp,
                letterSpacing = (-0.01).em,
            ),
        titleSmall =
            TextStyle(
                fontFamily = PlexSans,
                fontWeight = FontWeight.SemiBold,
                fontSize = 16.sp,
                lineHeight = 22.sp,
            ),
        bodyLarge =
            TextStyle(
                fontFamily = PlexSans,
                fontWeight = FontWeight.Normal,
                fontSize = 16.sp,
                lineHeight = 24.sp,
            ),
        bodyMedium =
            TextStyle(
                fontFamily = PlexSans,
                fontWeight = FontWeight.Normal,
                fontSize = 15.sp,
                lineHeight = 22.sp,
            ),
        bodySmall =
            TextStyle(
                fontFamily = PlexSans,
                fontWeight = FontWeight.Normal,
                fontSize = 13.sp,
                lineHeight = 18.sp,
            ),
        labelLarge =
            TextStyle(
                fontFamily = PlexSans,
                fontWeight = FontWeight.SemiBold,
                fontSize = 14.sp,
                lineHeight = 18.sp,
            ),
        labelMedium =
            TextStyle(
                fontFamily = PlexSans,
                fontWeight = FontWeight.SemiBold,
                fontSize = 13.sp,
                lineHeight = 16.sp,
            ),
        labelSmall =
            TextStyle(
                fontFamily = PlexSans,
                fontWeight = FontWeight.SemiBold,
                fontSize = 11.sp,
                lineHeight = 14.sp,
                letterSpacing = 0.04.em,
            ),
    )

/**
 * IBM Plex **Mono** styles for times / durations / IDs / numeric values — the
 * roles M3's [Typography] has no slot for. All carry tabular figures + slashed
 * zero. Read via `ShiftTheme.type`.
 */
@Immutable
data class ShiftTypeExtras(
    /** The big shift-time hero on a card, e.g. "21:00 - 23:00" (22/600). */
    val monoTimeHero: TextStyle =
        TextStyle(
            fontFamily = PlexMono,
            fontWeight = FontWeight.SemiBold,
            fontSize = 22.sp,
            lineHeight = 26.sp,
            letterSpacing = (-0.02).em,
            fontFeatureSettings = NUM_FEATURES,
        ),
    /** Inline times / durations (15/500). */
    val monoTime: TextStyle =
        TextStyle(
            fontFamily = PlexMono,
            fontWeight = FontWeight.Medium,
            fontSize = 15.sp,
            lineHeight = 20.sp,
            letterSpacing = (-0.02).em,
            fontFeatureSettings = NUM_FEATURES,
        ),
    /** ID / status pill numerics / counts (12/500). */
    val monoId: TextStyle =
        TextStyle(
            fontFamily = PlexMono,
            fontWeight = FontWeight.Medium,
            fontSize = 12.sp,
            lineHeight = 16.sp,
            fontFeatureSettings = NUM_FEATURES,
        ),
    /** Smallest mono meta / hex / ruler (11/600). */
    val monoMeta: TextStyle =
        TextStyle(
            fontFamily = PlexMono,
            fontWeight = FontWeight.SemiBold,
            fontSize = 11.sp,
            lineHeight = 15.sp,
            fontFeatureSettings = NUM_FEATURES,
        ),
    /** Uppercase eyebrow (when/house labels) — Plex Sans 11/600 + tracking. */
    val eyebrow: TextStyle =
        TextStyle(
            fontFamily = PlexSans,
            fontWeight = FontWeight.SemiBold,
            fontSize = 11.sp,
            lineHeight = 14.sp,
            letterSpacing = 0.05.em,
        ),
)

val LocalShiftTypeExtras = androidx.compose.runtime.staticCompositionLocalOf { ShiftTypeExtras() }
