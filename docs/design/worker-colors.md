# Worker colors (cross-platform spec)

**Status:** implemented on web (Live calendar + worker House calendar) AND on mobile
(the House grid, both platforms, 2026-07-22). Any further consumer MUST reproduce this
exactly so the platforms stay in lockstep.

## Goal

Every worker carries one color, derived from their identity, so a person looks the same
on the web Live calendar, the web worker calendar, and the mobile House screen, week after
week. This replaces the old look where every scheduled card was the same neutral surface.
It mirrors the original Google Sheet, where each person had their own color.

## The two rules

1. **Color is a pure function of `user_id`** (the stable uuid), not of name, house, week,
   or position. Same worker id -> same color, everywhere, always. No storage, no DB column,
   no sync surface: each platform computes it locally from the id.
2. **Applied only to worker-held "scheduled" cards.** A card gets the worker color when it
   has a `user_id` AND its visual state is the default _scheduled_ look (scheduled or
   picked-up). Float-in, Allied, vacant/open, and permanent-opening cards KEEP their
   existing state colors, because those colors carry meaning (a float must still read as a
   float). Vacant/open seats keep the neutral hatch.

## The palette

14 fixed colors, hand-picked to stay distinct and legible on both light and dark grounds.
Index into it with the hash below. (Within one house there are rarely more than ~14
workers, so collisions inside a single house view are rare; if they ever become a problem
we can add an optional stored per-worker override later, but the default is this pure hash.)

```
index  hex        rough hue
0      #2563eb    blue
1      #0d9488    teal
2      #db2777    pink
3      #ea580c    orange
4      #7c3aed    violet
5      #16a34a    green
6      #0891b2    cyan
7      #e11d48    rose
8      #ca8a04    amber
9      #4f46e5    indigo
10     #9333ea    purple
11     #65a30d    lime
12     #dc2626    red
13     #c026d3    fuchsia
```

## The hash (must be identical on every platform)

A 32-bit signed rolling hash over the UTF-16 code units of `user_id`, then a positive
modulo into the palette length. Signed 32-bit two's-complement overflow is relied upon, so
it reproduces bit-for-bit in JS and Kotlin.

**TypeScript** (`apps/web/lib/workerColor.ts`):

```ts
export function workerColorIndex(userId: string): number {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = (Math.imul(h, 31) + userId.charCodeAt(i)) | 0; // wrap to signed 32-bit
  }
  const n = WORKER_PALETTE.length;
  return ((h % n) + n) % n; // positive modulo
}
```

**Kotlin** (mobile, to add):

```kotlin
fun workerColorIndex(userId: String): Int {
    var h = 0
    for (c in userId) {
        h = h * 31 + c.code // Int is 32-bit, overflow wraps identically to JS `| 0`
    }
    val n = WORKER_PALETTE.size
    return ((h % n) + n) % n
}
```

`Math.imul` in JS is required (plain `*` loses precision past 2^53); Kotlin `Int` multiply
already wraps at 32 bits, so `h * 31` matches. Both use a positive modulo so a negative hash
still lands in range. Given the same `user_id`, both return the same index.

## Rendering (fill / rail / text)

Given the worker's base color `C` and its precomputed contrast foreground `F` (see below):

- **Fill:** `C` at **90% opacity** over the card's ground.
  Web: `color-mix(in srgb, C 90%, transparent)`. Mobile: `C.copy(alpha = 0.90f)`.
- **Border:** full-strength `C`.
- **Left rail:** a 3px bar in **full-strength** `C` down the card's leading edge.
- **Name:** `F`, the palette entry's precomputed contrast color (`#ffffff` or `#1a1a1a`) so
  it stays legible against the near-opaque fill regardless of theme.
- **Time label:** a blend biased toward `F` with a slice of `C` mixed in, so it keeps a
  colored identity (e.g. green-on-green) without losing contrast
  (web: `color-mix(in srgb, F 75%, C 25%)`).

`F` per palette entry (`workerContrastText` in `apps/web/lib/workerColor.ts`), chosen once
via WCAG relative luminance since the palette is fixed: amber (`#ca8a04`), orange
(`#ea580c`), and lime (`#65a30d`) are bright enough to need dark text (`#1a1a1a`); every
other hue uses white (`#ffffff`). Recompute this table if the palette ever changes.

The same base palette is used in light and dark; because the fill is 90% `C`, it dominates
the theme ground and reads the same in both. Do not maintain a second dark palette.

## Where it lives

- Web palette + hash: `apps/web/lib/workerColor.ts` (single source on web).
- Web application: `apps/web/components/calendar/Grid.tsx` (`ShiftCardEl`) +
  `.scard-worker` rules in `apps/web/components/calendar/calendar.css`.
- Mobile palette + hash: `apps/mobile/shared/.../house/WorkerColors.kt` (the Kotlin
  mirror; `WorkerColorsTest` pins it against reference vectors produced by the TS copy,
  so a drift between the two platforms fails the build rather than shipping).
  `wearsWorkerColor()` there is the shared form of the web's `sc-scheduled` rule.
- Mobile application: the House grid block cell — `HouseGridBlockCell` in
  `apps/mobile/androidApp/.../ui/ShiftsScreen.kt` and `houseBlockView` /
  `WorkerTint` in `apps/mobile/iosApp/iosApp/ContentView.swift`. The same colour also
  tints the contact card's avatar when a block is tapped. `HouseGridBlock` carries the
  occupant's `userId` (added 2026-07-22) so the colour can be computed at render.

## The "mine" ring

Mobile's House grid marks the signed-in worker's own blocks. That emphasis rides ON TOP
of the worker tint rather than replacing it (a brand-coloured ring around a tinted fill),
which is the same composition the web card uses: `.scard-mine`'s outline over
`.scard-worker`'s fill. So "which of these is mine" and "who is this" stay independently
readable.

## Find-mine dimming (mobile House grid, 2026-07-22)

Per-worker colour answers "who is this", but on a full grid it actively hurts the question
a worker asks most: "where am I?" Fourteen saturated hues compete evenly and the ring alone
is too quiet to win. So on the mobile House grid every block that is **not mine** renders at
**50% opacity** (`houseOtherOpacity` on iOS, `HOUSE_OTHER_OPACITY` on Android; keep the two
in step); mine stays at full strength in its own colour.

Two deliberate exclusions:

- **Vacant seats are not dimmed.** An open seat is nobody's card, and for a manager it is the
  actionable affordance on the grid, so it keeps full strength and its dashed outline.
- **Dimming is opacity only.** It composes over the existing fill/rail/ring rules rather than
  replacing them, so state colours (float-in, pending) and the "mine" ring still read exactly
  as specified above, just quieter on other people's blocks.

This applies to the mobile House grid only. The web calendars are denser and are usually read
for "who is on the desk", not "where am I", so they keep every card at full strength.
