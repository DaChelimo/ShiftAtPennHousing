package com.pennhousing.shift.ui.theme

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.runtime.Immutable
import androidx.compose.ui.unit.dp

/*
 * Mobile reskin foundation — spacing, dimensions, elevation, and motion tokens
 * extracted from `worker-app.html`. These are device-independent constants (not
 * theme-scoped), so plain objects rather than CompositionLocals.
 */

/** Spacing scale — 4dp base with a 2dp half-step (design-brief 8px grid, mobile-tuned). */
@Immutable
object Spacing {
    val xxs = 2.dp
    val xs = 4.dp
    val s = 6.dp
    val m = 8.dp
    val l = 12.dp
    val xl = 16.dp
    val xxl = 20.dp
    val xxxl = 24.dp

    /** Canonical screen side margin. */
    val screen = 16.dp

    /** Card inset (worker-app.html: `13px 14px`). */
    val cardPadH = 14.dp
    val cardPadV = 13.dp

    /** Gap between stacked list items inside a section. */
    val listGap = 8.dp

    /** Gap between major sections. */
    val sectionGap = 24.dp
}

/** Component dimensions + the reusable atoms. */
@Immutable
object Dimens {
    // Buttons / touch targets (worker-app.html `Btn`).
    val buttonHeightSm = 34.dp
    val buttonHeightMd = 44.dp
    val buttonHeightLg = 52.dp
    val minTouchTarget = 48.dp // M3 minimum interactive size

    // Borders.
    val hairline = 1.dp
    val outlineStroke = 1.5.dp
    val focusRing = 2.dp
    val breakBorder = 4.dp // slate left border on a break card
    val cardAccentRing = 2.dp // selected-card blue ring

    // Atoms.
    val pickupDot = 8.dp
    val houseBadge = 40.dp
    val avatar = 36.dp
    val iconButton = 36.dp

    // Icon sizes.
    val iconTag = 13.dp
    val iconSm = 16.dp
    val icon = 18.dp
    val iconLg = 20.dp
    val iconNav = 29.dp
    val iconEmptyState = 26.dp

    // Bottom-sheet grabber.
    val grabberWidth = 36.dp
    val grabberHeight = 5.dp

    // iOS-style switch (rendered natively, but sized to match the design).
    val switchWidth = 51.dp
    val switchHeight = 31.dp
    val switchThumb = 27.dp

    // Bottom nav.
    val navBarHeight = 64.dp
}

/** Elevation (dp) approximating the `--elev-*` box-shadows. */
@Immutable
object Elevation {
    val level1 = 1.dp // resting card (--elev-1)
    val level2 = 6.dp // raised / selected (--elev-2)
    val sheet = 16.dp // bottom sheet (--elev-sheet)
}

/**
 * Motion tokens. Durations in ms; easings reproduce the two named curves from the
 * export: the iOS sheet/dialog curve and the success-pop overshoot. Micro-motion
 * sits in the brief's 120-160ms band.
 */
@Immutable
object Motion {
    const val PRESS_MS = 120
    const val STATE_MS = 160
    const val TOGGLE_MS = 180
    const val FADE_MS = 200
    const val DIALOG_MS = 260
    const val SHEET_MS = 300
    const val SUCCESS_MS = 420
    const val SKELETON_MS = 1400

    /** Press feedback scale (design: button 0.97, card 0.985). */
    const val PRESS_SCALE_BUTTON = 0.97f
    const val PRESS_SCALE_CARD = 0.985f

    /** iOS sheet/dialog present curve: cubic-bezier(0.32, 0.72, 0, 1). */
    val SheetEasing: Easing = CubicBezierEasing(0.32f, 0.72f, 0f, 1f)

    /** Success-pop overshoot: cubic-bezier(0.34, 1.56, 0.64, 1). */
    val OvershootEasing: Easing = CubicBezierEasing(0.34f, 1.56f, 0.64f, 1f)
}
