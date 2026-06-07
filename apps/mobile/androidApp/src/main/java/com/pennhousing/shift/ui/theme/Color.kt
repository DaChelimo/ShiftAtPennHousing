package com.pennhousing.shift.ui.theme

import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/*
 * Mobile reskin foundation — color layer.
 *
 * The values here are a 1:1 port of the `--tk-*` design tokens in
 * `apps/mobile/design/worker-app.html` (the visual source of truth), reconciled
 * with the brand spec in `docs/design-brief.md` §4. See
 * `apps/mobile/design/DESIGN_TOKENS.md` for the full table + the load-bearing
 * shift-state legend.
 *
 * Two layers:
 *  1. [ShiftColorScheme] / [DarkShiftColorScheme] — a Material 3 [androidx.compose
 *     .material3.ColorScheme] driving the standard M3 chrome + brand primary.
 *  2. [ShiftColors] — the bespoke, **load-bearing** semantic palette (shift-state
 *     colors, chrome surfaces) that M3's roles do not model. Provided via
 *     [LocalShiftColors] and consumed by the component kit. State color is NEVER
 *     used alone — always color + text tag + icon (design-brief §4 / §9).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Raw token palette — LIGHT (:root in worker-app.html)
// ─────────────────────────────────────────────────────────────────────────────
private object L {
    // Brand / primary
    val blue = Color(0xFF0061FC)
    val bluePressed = Color(0xFF0A4ECB)
    val blueContainer = Color(0xFFE4EDFF)
    val onBlueContainer = Color(0xFF00307E)

    // Neutrals
    val ink = Color(0xFF121622)
    val sec = Color(0xFF545B6B)
    val ter = Color(0xFF828A9A)
    val divider = Color(0xFFE3E6EC)
    val outline = Color(0xFFC8CED9)
    val bg = Color(0xFFF6F7F9)
    val surface = Color(0xFFFFFFFF)
    val surfaceVar = Color(0xFFEDF0F5)

    // Semantic shift states + tints/deeps/badges
    val float = Color(0xFF6E56CF)
    val floatTint = Color(0xFFEEEBFA)
    val floatDeep = Color(0xFF4A3C8F)
    val floatBadge = Color(0xFFE2DCF6)
    val pending = Color(0xFF9A7400)
    val floatIn = Color(0xFF2E8B57)
    val floatInTint = Color(0xFFE4F4EA)
    val floatInDeep = Color(0xFF1E6B40)
    val floatInBadge = Color(0xFFCDEAD8)
    val brk = Color(0xFFC28A1A)
    val brkTint = Color(0xFFF8F1E2)
    val brkDeep = Color(0xFF7C5A12)
    val brkBadge = Color(0xFFF2E7CB)
    val permanent = Color(0xFFD14185)
    val permanentTint = Color(0xFFFBE9F2)
    val permanentDeep = Color(0xFF9E2566)
    val permanentBadge = Color(0xFFF7D6E5)
    val allied = Color(0xFF007D79)
    val alliedTint = Color(0xFFD7F5F4)
    val alliedBadge = Color(0xFFBEEBE9)
    val success = Color(0xFF1E874B)
    val successTint = Color(0xFFDCFBE7)
    val successDeep = Color(0xFF176B3B)
    val ackBadge = Color(0xFFC3F0CE)
    val error = Color(0xFFDA1E28)
    val errorTint = Color(0xFFFFF0F0)
    val errorDeep = Color(0xFFA8151D)
    val unpickBadge = Color(0xFFE0E3EA)

    // Chrome surfaces
    val tabbar = Color(0xDBF6F7F9) // rgba(246,247,249,0.86)
    val scrim = Color(0x52121622) // rgba(18,22,34,0.32)
    val toastBg = Color(0xFF121622)
    val toastFg = Color(0xFFFFFFFF)
    val switchTrack = Color(0xFFE3E6EC)
    val warnSoft = Color(0xFFF4ECD6)
    val floatSoft = Color(0xFFF5F2FC)

    // surfaceContainer ramp (derived; M3 1.4 expects the full set)
    val surfaceContainerLowest = Color(0xFFFFFFFF)
    val surfaceContainerLow = Color(0xFFF8F9FB)
    val surfaceContainer = Color(0xFFF6F7F9)
    val surfaceContainerHigh = Color(0xFFEDF0F5)
    val surfaceContainerHighest = Color(0xFFE7EBF1)
}

// ─────────────────────────────────────────────────────────────────────────────
// Raw token palette — DARK (.theme-dark in worker-app.html)
// ─────────────────────────────────────────────────────────────────────────────
private object D {
    val blue = Color(0xFF0A84FF)
    val bluePressed = Color(0xFF409CFF)
    val blueContainer = Color(0xFF0C2C4F)
    val onBlueContainer = Color(0xFFBBD6FF)

    val ink = Color(0xFFECF0F6)
    val sec = Color(0xFFA7AFBE)
    val ter = Color(0xFF6E7686)
    val divider = Color(0xFF282D38)
    val outline = Color(0xFF3C4350)
    val bg = Color(0xFF0E1116)
    val surface = Color(0xFF171B22)
    val surfaceVar = Color(0xFF232834)

    val float = Color(0xFFB6A4F0)
    val floatTint = Color(0xFF221D31)
    val floatDeep = Color(0xFFD5C9FF)
    val floatBadge = Color(0xFF2E2742)
    val pending = Color(0xFFE0B341)
    val floatIn = Color(0xFF4FC07E)
    val floatInTint = Color(0xFF13271B)
    val floatInDeep = Color(0xFFA6E7BE)
    val floatInBadge = Color(0xFF1C3A27)
    val brk = Color(0xFFE0AE4A)
    val brkTint = Color(0xFF281F12)
    val brkDeep = Color(0xFFF0CE8A)
    val brkBadge = Color(0xFF322816)
    val permanent = Color(0xFFF072AE)
    val permanentTint = Color(0xFF311425)
    val permanentDeep = Color(0xFFFFC2DD)
    val permanentBadge = Color(0xFF3D1C30)
    val allied = Color(0xFF2FC2BB)
    val alliedTint = Color(0xFF0D2A28)
    val alliedBadge = Color(0xFF123B38)
    val success = Color(0xFF4FC07E)
    val successTint = Color(0xFF13271B)
    val successDeep = Color(0xFF8FE0AE)
    val ackBadge = Color(0xFF1C3A27)
    val error = Color(0xFFFF6B6B)
    val errorTint = Color(0xFF311818)
    val errorDeep = Color(0xFFFF9B9B)
    val unpickBadge = Color(0xFF262B35)

    val tabbar = Color(0xD60F1218) // rgba(15,18,24,0.84)
    val scrim = Color(0x8C000000) // rgba(0,0,0,0.55)
    val toastBg = Color(0xFFECF0F6)
    val toastFg = Color(0xFF121622)
    val switchTrack = Color(0xFF3C4350)
    val warnSoft = Color(0xFF2A2414)
    val floatSoft = Color(0xFF1E1A2C)

    val surfaceContainerLowest = Color(0xFF0E1116)
    val surfaceContainerLow = Color(0xFF13171E)
    val surfaceContainer = Color(0xFF171B22)
    val surfaceContainerHigh = Color(0xFF1D222B)
    val surfaceContainerHighest = Color(0xFF232834)
}

// ─────────────────────────────────────────────────────────────────────────────
// Material 3 ColorScheme — standard chrome + brand primary
// ─────────────────────────────────────────────────────────────────────────────
val ShiftColorScheme =
    lightColorScheme(
        primary = L.blue,
        onPrimary = Color.White,
        primaryContainer = L.blueContainer,
        onPrimaryContainer = L.onBlueContainer,
        inversePrimary = D.blue,
        secondary = L.sec,
        onSecondary = Color.White,
        secondaryContainer = L.surfaceVar,
        onSecondaryContainer = L.ink,
        tertiary = L.float,
        onTertiary = Color.White,
        tertiaryContainer = L.floatTint,
        onTertiaryContainer = L.floatDeep,
        background = L.bg,
        onBackground = L.ink,
        surface = L.surface,
        onSurface = L.ink,
        surfaceVariant = L.surfaceVar,
        onSurfaceVariant = L.sec,
        surfaceTint = L.blue,
        surfaceContainerLowest = L.surfaceContainerLowest,
        surfaceContainerLow = L.surfaceContainerLow,
        surfaceContainer = L.surfaceContainer,
        surfaceContainerHigh = L.surfaceContainerHigh,
        surfaceContainerHighest = L.surfaceContainerHighest,
        outline = L.outline,
        outlineVariant = L.divider,
        error = L.error,
        onError = Color.White,
        errorContainer = L.errorTint,
        onErrorContainer = L.errorDeep,
        scrim = L.scrim,
        inverseSurface = L.toastBg,
        inverseOnSurface = L.toastFg,
    )

val DarkShiftColorScheme =
    darkColorScheme(
        primary = D.blue,
        onPrimary = Color(0xFF002A57),
        primaryContainer = D.blueContainer,
        onPrimaryContainer = D.onBlueContainer,
        inversePrimary = L.blue,
        secondary = D.sec,
        onSecondary = Color(0xFF1B1F28),
        secondaryContainer = D.surfaceVar,
        onSecondaryContainer = D.ink,
        tertiary = D.float,
        onTertiary = Color(0xFF241B45),
        tertiaryContainer = D.floatTint,
        onTertiaryContainer = D.floatDeep,
        background = D.bg,
        onBackground = D.ink,
        surface = D.surface,
        onSurface = D.ink,
        surfaceVariant = D.surfaceVar,
        onSurfaceVariant = D.sec,
        surfaceTint = D.blue,
        surfaceContainerLowest = D.surfaceContainerLowest,
        surfaceContainerLow = D.surfaceContainerLow,
        surfaceContainer = D.surfaceContainer,
        surfaceContainerHigh = D.surfaceContainerHigh,
        surfaceContainerHighest = D.surfaceContainerHighest,
        outline = D.outline,
        outlineVariant = D.divider,
        error = D.error,
        onError = Color(0xFF3A0A0A),
        errorContainer = D.errorTint,
        onErrorContainer = D.errorDeep,
        scrim = D.scrim,
        inverseSurface = D.toastBg,
        inverseOnSurface = D.toastFg,
    )

// ─────────────────────────────────────────────────────────────────────────────
// ShiftColors — the load-bearing semantic palette (not modelled by M3 roles)
// ─────────────────────────────────────────────────────────────────────────────

/** One shift-state's four-part treatment: base accent, card tint, deep text, badge tint. */
@Immutable
data class StateColors(
    val accent: Color,
    val tint: Color,
    val deep: Color,
    val badge: Color,
)

/**
 * The bespoke palette consumed by the component kit. Mirrors the `--tk-*` tokens
 * that have no Material 3 equivalent. Resolve the per-state treatment with
 * [ShiftColors.state]; render it with a [com.pennhousing.shift.ui.kit.StatePill]
 * (color + icon + text — never color alone).
 */
@Immutable
data class ShiftColors(
    val isDark: Boolean,
    // brand extras
    val bluePressed: Color,
    val onBlueContainer: Color,
    // neutrals (for direct, non-M3 use)
    val ink: Color,
    val sec: Color,
    val ter: Color,
    val divider: Color,
    val outline: Color,
    val bg: Color,
    val surface: Color,
    val surfaceVar: Color,
    // shift states
    val floatOut: StateColors,
    val floatIn: StateColors,
    val permanent: StateColors,
    val allied: StateColors,
    val breakShift: StateColors,
    val success: StateColors,
    val danger: StateColors,
    val pending: Color,
    val pickupDot: Color,
    val unpickBadge: Color,
    val scheduledBadge: Color,
    // chrome
    val tabbar: Color,
    val scrim: Color,
    val toastBg: Color,
    val toastFg: Color,
    val switchTrack: Color,
    val warnSoft: Color,
    val floatSoft: Color,
    // skeleton shimmer ramp
    val skeletonA: Color,
    val skeletonB: Color,
)

val LightShiftColors =
    ShiftColors(
        isDark = false,
        bluePressed = L.bluePressed,
        onBlueContainer = L.onBlueContainer,
        ink = L.ink,
        sec = L.sec,
        ter = L.ter,
        divider = L.divider,
        outline = L.outline,
        bg = L.bg,
        surface = L.surface,
        surfaceVar = L.surfaceVar,
        floatOut = StateColors(L.float, L.floatTint, L.floatDeep, L.floatBadge),
        floatIn = StateColors(L.floatIn, L.floatInTint, L.floatInDeep, L.floatInBadge),
        permanent = StateColors(L.permanent, L.permanentTint, L.permanentDeep, L.permanentBadge),
        allied = StateColors(L.allied, L.alliedTint, L.allied, L.alliedBadge),
        breakShift = StateColors(L.brk, L.brkTint, L.brkDeep, L.brkBadge),
        success = StateColors(L.success, L.successTint, L.successDeep, L.ackBadge),
        danger = StateColors(L.error, L.errorTint, L.errorDeep, L.errorTint),
        pending = L.pending,
        pickupDot = L.blue,
        unpickBadge = L.unpickBadge,
        scheduledBadge = L.surfaceVar,
        tabbar = L.tabbar,
        scrim = L.scrim,
        toastBg = L.toastBg,
        toastFg = L.toastFg,
        switchTrack = L.switchTrack,
        warnSoft = L.warnSoft,
        floatSoft = L.floatSoft,
        skeletonA = Color(0xFFECEFF3),
        skeletonB = Color(0xFFF4F6F9),
    )

val DarkShiftColors =
    ShiftColors(
        isDark = true,
        bluePressed = D.bluePressed,
        onBlueContainer = D.onBlueContainer,
        ink = D.ink,
        sec = D.sec,
        ter = D.ter,
        divider = D.divider,
        outline = D.outline,
        bg = D.bg,
        surface = D.surface,
        surfaceVar = D.surfaceVar,
        floatOut = StateColors(D.float, D.floatTint, D.floatDeep, D.floatBadge),
        floatIn = StateColors(D.floatIn, D.floatInTint, D.floatInDeep, D.floatInBadge),
        permanent = StateColors(D.permanent, D.permanentTint, D.permanentDeep, D.permanentBadge),
        allied = StateColors(D.allied, D.alliedTint, D.allied, D.alliedBadge),
        breakShift = StateColors(D.brk, D.brkTint, D.brkDeep, D.brkBadge),
        success = StateColors(D.success, D.successTint, D.successDeep, D.ackBadge),
        danger = StateColors(D.error, D.errorTint, D.errorDeep, D.errorTint),
        pending = D.pending,
        pickupDot = D.blue,
        unpickBadge = D.unpickBadge,
        scheduledBadge = D.surfaceVar,
        tabbar = D.tabbar,
        scrim = D.scrim,
        toastBg = D.toastBg,
        toastFg = D.toastFg,
        switchTrack = D.switchTrack,
        warnSoft = D.warnSoft,
        floatSoft = D.floatSoft,
        skeletonA = Color(0xFF1E232C),
        skeletonB = Color(0xFF272D38),
    )

/** Provided by [com.pennhousing.shift.ui.theme.ShiftTheme]; read via `ShiftTheme.colors`. */
val LocalShiftColors = staticCompositionLocalOf { LightShiftColors }
