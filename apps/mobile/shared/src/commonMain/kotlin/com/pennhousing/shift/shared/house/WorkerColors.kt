package com.pennhousing.shift.shared.house

/*
 * Per-worker shift colors — the Kotlin mirror of `apps/web/lib/workerColor.ts`.
 *
 * A worker's color is a PURE FUNCTION of their `user_id`, so the same person looks
 * identical on the web Live calendar, the web worker calendar, and the mobile House
 * grid, week after week. Nothing is stored and nothing syncs: each platform computes
 * it locally from the id. The cross-platform contract (palette, hash, rendering
 * rules) is docs/design/worker-colors.md — change the doc AND the TS copy whenever
 * you touch this file, or the two platforms drift.
 *
 * Kept in `commonMain` and expressed as plain ints so it compiles on every KMP
 * target; Compose/SwiftUI convert to their own Color types at the edge.
 */

/**
 * 14 fixed hues, hand-picked to stay distinct and legible on light and dark grounds,
 * as 0xRRGGBB ints (no alpha — the UI layer applies the fill opacity). Order is
 * load-bearing: the hash indexes into it, so re-ordering re-colors every worker.
 */
val WORKER_PALETTE: List<Int> =
    listOf(
        0x2563EB, // 0  blue
        0x0D9488, // 1  teal
        0xDB2777, // 2  pink
        0xEA580C, // 3  orange
        0x7C3AED, // 4  violet
        0x16A34A, // 5  green
        0x0891B2, // 6  cyan
        0xE11D48, // 7  rose
        0xCA8A04, // 8  amber
        0x4F46E5, // 9  indigo
        0x9333EA, // 10 purple
        0x65A30D, // 11 lime
        0xDC2626, // 12 red
        0xC026D3, // 13 fuchsia
    )

/**
 * Palette entries bright enough to need DARK text sitting on them; every other hue
 * takes white. Precomputed once via WCAG relative luminance (the palette is fixed)
 * rather than derived at runtime, matching `WORKER_PALETTE_DARK_TEXT` on web.
 */
private val WORKER_PALETTE_DARK_TEXT: Set<Int> = setOf(3, 8, 11) // orange, amber, lime

private const val CONTRAST_LIGHT = 0xFFFFFF
private const val CONTRAST_DARK = 0x1A1A1A

/**
 * 32-bit signed rolling hash over [userId]'s UTF-16 code units, then a positive
 * modulo into the palette. Kotlin's `Int` multiply already wraps at 32 bits, which
 * is exactly what the web copy forces with `Math.imul(...) | 0` — so both platforms
 * return the same index bit-for-bit for the same id.
 */
fun workerColorIndex(userId: String): Int {
    var h = 0
    for (ch in userId) {
        h = h * 31 + ch.code
    }
    val n = WORKER_PALETTE.size
    return ((h % n) + n) % n
}

/** The worker's full-strength color as 0xRRGGBB. */
fun workerColor(userId: String): Int = WORKER_PALETTE[workerColorIndex(userId)]

/**
 * A legible foreground (0xRRGGBB) for text sitting directly on that worker's
 * full-strength color — the near-opaque card fill. Same table as web.
 */
fun workerContrastText(userId: String): Int =
    if (workerColorIndex(userId) in WORKER_PALETTE_DARK_TEXT) CONTRAST_DARK else CONTRAST_LIGHT

/**
 * True when a grid block should wear its occupant's color: it has a real worker AND
 * its visual state is the default "scheduled" look. Float-in, pending-float and
 * vacant seats KEEP their state colors, because those colors carry meaning (a float
 * must still read as a float) — the same rule the web card applies via
 * `meta.cls === 'sc-scheduled'`.
 */
fun HouseGridBlock.wearsWorkerColor(): Boolean = userId != null && !vacant && !floatIn && !pending
