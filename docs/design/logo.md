# The chevronel — Shift@PennHousing identity

The mark is derived from the University of Pennsylvania shield. Reduced to its
heraldry, that shield is three parts: the **red chief** (the band across the top),
the **navy chevron**, and the **three white plates** riding on it. The books and
the dolphin in the chief are too fine to survive a 16px favicon, so nothing here
is built on them.

A chevron repeated is called a **chevronel**. Ours is two: the shift that just
ended in Penn red above, the shift on the desk now in Penn navy below, carrying
the plates. Penn's chevron was already an arrow and already carried exactly three
counters, which is why the crest takes to this without being distorted.

## Source of truth

Everything derives from `scripts/brand/geometry.mjs`. Nothing about the mark is
drawn by hand anywhere in the repo.

```bash
node scripts/brand/build-icons.mjs
```

That regenerates every asset listed under [Generated assets](#generated-assets).
Outputs are committed; the script exists so the geometry has one home, not so
assets are built on demand. **Edit `geometry.mjs` and re-run — never hand-edit a
generated file.** Each carries a "Do not edit by hand" banner.

`sharp` is resolved out of `apps/web/node_modules` (it is already a web
dependency, used there for KB PDF rendering). There is no separate install.

## Construction

On a 100x100 artboard:

| Property                        | Value                                    |
| ------------------------------- | ---------------------------------------- |
| Arm vector                      | 30 across, 32 down                       |
| Navy band width                 | 14.0                                     |
| Red band width                  | 10.0                                     |
| Apex offset (Δy)                | 25.0                                     |
| Perpendicular gap between bands | 5.099                                    |
| Plate radius                    | 5.2                                      |
| Plate spacing along arm         | 20.0                                     |
| Joins / caps                    | miter (limit 10) / butt                  |
| Mark bounds                     | 70.21 x 69.10, centred at (50.00, 50.24) |
| Bounding radius                 | 43.08                                    |

Two things carry the whole drawing:

1. **Both chevrons share one arm vector.** That is what keeps the gap between them
   constant from the apex all the way to the arm ends. Give them different slopes
   and the gap pinches.
2. **The plates are positioned by arc length along the navy centreline** — one at
   the vertex, one at 20.0 down each arm — never by eye. In the first sketch of
   this mark the apex plate sat 8 units below the centreline vertex and the arm
   plates were ~1.5 off-axis, which read as three discs sliding off the band.

Strokes are resolved to explicit outline polygons in the generator rather than
emitted as stroked paths, because Android `VectorDrawable` has no mask support and
stroke rasterisation differs subtly between renderers. The plates become evenOdd
counter-subpaths, so they are **true holes** on every platform and the mark drops
onto any ground without anyone recolouring three discs.

## Cuts

| Cut       | When              | What changes                                                                                                            |
| --------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `PRIMARY` | 24px and above    | The mark as specified above.                                                                                            |
| `MONO`    | Single-colour use | Red band thins 10 → 7. Without a hue difference, weight contrast has to do all the work of separating the two chevrons. |
| `FAVICON` | 16px              | Plates dropped, both bands thickened (12 / 15), gap opened 5.10 → 7.02.                                                 |

Below about 20px the plates fall under one pixel and the gap starts to close.
**Do not scale the primary mark down to a favicon** — use the favicon cut. It is
the doubled chevron and nothing else, which is the part that was identifying the
app anyway.

## Colour

| Token  | Value     | Note                                    |
| ------ | --------- | --------------------------------------- |
| Navy   | `#011F5B` | Penn Blue, lower chevron                |
| Red    | `#990000` | Penn Red, upper chevron                 |
| Ground | `#F4F3F0` | The paper the mark sits on              |
| Ghost  | `#5B72A8` | Upper chevron when reversed out of navy |

Penn red on Penn navy has no usable contrast, so the reversed cut does not attempt
it: the upper chevron lifts to the muted blue and the lower goes white.

**The mark's palette is deliberately not the UI accent.** The app's accent stays
Shift Blue `#0061FC` on every screen (web `--brand`, Compose `Color.kt`, SwiftUI
`ShiftTheme.swift`, and the two widget token copies). A logo whose colours differ
from the UI accent is normal; do not "reconcile" them without a decision to
re-palette the whole product.

## Generated assets

**Web** (`apps/web`)

- `app/icon.svg` — favicon, the 16px cut. App Router file convention.
- `app/apple-icon.png` — 180px, opaque (iOS composites a transparent touch icon onto black).
- `public/brand/logo.svg`, `logo-mono.svg`, `logo-reversed.svg`, `icon.svg`
- `public/brand/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `og.png`
- `lib/brandPaths.ts` — path data for the inline React mark.

**Android** (`apps/mobile/androidApp/src/main/res`)

- `drawable/ic_launcher_{background,foreground,monochrome}.xml`
- `drawable/ic_brand_mark.xml` — the in-app mark, ground included so it is theme-independent.
- `mipmap-anydpi-v26/ic_launcher{,_round}.xml`
- `mipmap-{m,h,xh,xxh,xxx}dpi/ic_launcher{,_round}.webp` — `minSdk` is 24, so API 24-25 still needs raster mipmaps.

**iOS** (`apps/mobile/iosApp/iosApp`)

- `Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` — opaque; App Store Connect rejects an AppIcon with an alpha channel.
- `Assets.xcassets/AccentColor.colorset` — Shift Blue, per the note above.
- `BrandMarkGeometry.swift` — geometry mirror for the SwiftUI mark.

The adaptive-icon foreground is scaled to 0.7391 so the mark's bounding radius
lands at 31.84 inside the 33dp circle a circular launcher mask shows. Raising it
clips the arm tips on Pixel launchers.

## Rules

- **Clear space**: the height of the red band (10 units) on every side.
- **Never re-space the plates.** They are on the centreline at 20-unit intervals.
- **The red chevron stays thinner.** Equal weights read as a pattern rather than a sequence; the past shift is always the lighter one.
- **No outline, no shadow, no rotation.** The mark is two shapes and three holes. Anything added is the first thing to fail at 24px.
- **The `@` is the only red in the wordmark**, and sits where the name pivots — the job the red chevron does in the mark.

## Consuming it

- **Web**: `components/ui/Logo.tsx` exports `LogoMark`, `Wordmark`, `Logo`. Inline SVG, so the mono variant inherits `currentColor`. Use `variant="reversed"` on the near-black header and the dark login panel.
- **Android**: `painterResource(R.drawable.ic_brand_mark)`, clipped by the caller.
- **iOS**: `BrandMark(size:)` in `LoginView.swift`, drawing from `BrandMarkGeometry`.

## Outstanding

**Penn's shield is a registered trademark and this is a derivative mark.** It
normally needs written sign-off from the university's trademark licensing group
before it appears on a student-facing app or an App Store listing. Send the master
and one mockup before any public release.

Two pre-existing naming inconsistencies, untouched here: Android `app_name` and
iOS `PRODUCT_NAME` are both `Shift PennHousing` while every in-app surface says
`Shift@PennHousing`, and the iOS widget bundle display name is just `Shift`.
