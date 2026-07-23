// Per-worker shift colors. A worker's color is a pure function of their user_id,
// so the same person looks identical on the Live calendar, the worker calendar,
// and (once mirrored in Kotlin) the mobile House screen, week after week.
//
// The hash + palette here are the canonical web copy of the cross-platform spec
// in docs/design/worker-colors.md. If you change either, change the doc AND the
// Kotlin mirror so the two platforms stay in lockstep.

// 14 fixed hues, hand-picked to stay distinct and legible on light and dark
// grounds. The same base color is used in both themes; compositing the fill at
// 40% opacity over the theme ground is what adapts it.
export const WORKER_PALETTE = [
  '#2563eb', // blue
  '#0d9488', // teal
  '#db2777', // pink
  '#ea580c', // orange
  '#7c3aed', // violet
  '#16a34a', // green
  '#0891b2', // cyan
  '#e11d48', // rose
  '#ca8a04', // amber
  '#4f46e5', // indigo
  '#9333ea', // purple
  '#65a30d', // lime
  '#dc2626', // red
  '#c026d3', // fuchsia
] as const;

// 32-bit signed rolling hash over user_id's code units, then a positive modulo
// into the palette. Signed 32-bit overflow (Math.imul + `| 0`) is deliberate so
// Kotlin's Int-overflow reproduces the same index bit-for-bit.
export function workerColorIndex(userId: string): number {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = (Math.imul(h, 31) + userId.charCodeAt(i)) | 0;
  }
  const n = WORKER_PALETTE.length;
  return ((h % n) + n) % n;
}

export function workerColor(userId: string): string {
  return WORKER_PALETTE[workerColorIndex(userId)];
}

// Legible foreground for text sitting directly on a worker's full-strength
// color (the near-opaque card fill). Precomputed per palette entry via WCAG
// relative luminance rather than derived at runtime, since the palette is
// fixed: amber/orange/lime are bright enough to need dark text, every other
// hue needs white. Keep in lockstep with docs/design/worker-colors.md and the
// Kotlin mirror if the palette ever changes.
const WORKER_PALETTE_DARK_TEXT: ReadonlySet<number> = new Set([
  8, // ca8a04 amber
  3, // ea580c orange
  11, // 65a30d lime
]);

export function workerContrastText(userId: string): string {
  const idx = workerColorIndex(userId);
  return WORKER_PALETTE_DARK_TEXT.has(idx) ? '#1a1a1a' : '#ffffff';
}
