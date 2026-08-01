# Brand source assets: spiral-S refresh (2026-07-31, refreshed 2026-07-31)

Source of truth for the current mark, replacing the Penn shield crest (2026-07-25/29 pass,
superseded) across web, Android, and iOS. Decision made interactively with the product owner;
this file is the record.

## Provenance

Four finished rasters supplied by the product owner in `docs/design/logo-inspo-v4/` (not
vector; no SVG source):

- `shift_light_2.png` — horizontal lockup: the spiral-S mark (blue gradient, `#2247E7` top
  fading to a dark navy tail) beside a stacked "SHIFT" / "AT PENN" wordmark in black, on a
  white background. Source for both `shield-light*.png` (mark cropped out) and
  `lockup-horizontal-light.png` (used as supplied).
- `shift_dark_2.png` — same horizontal lockup, mark and wordmark both rendered in solid white,
  on a `#0E1116` background (the app's own dark-theme background, so no seam on the splash).
  Source for `shield-dark*.png` and `lockup-horizontal-dark.png`.
- `shift_light_1.png` / `shift_dark_1.png` — the same two treatments in a stacked (mark above
  wordmark) layout instead of horizontal. Not currently used by any surface (every current
  lockup placement is horizontal); kept in `logo-inspo-v4/` in case a stacked context appears
  later, same as the crest pass kept its unused stacked crops.

This superseded a same-day first pass sourced from a single rough sketch
(`docs/design/logo-inspo-v3/rough_sketch.png`) with no supplied dark/wordmark treatments —
the shield-dark, lockup, and app-name pieces of that pass were generated programmatically. This
pass replaces every one of those generated pieces with the product owner's actual supplied art.

None of the four source files carry an alpha channel (all opaque, solid white or `#0E1116`
background) — `shield-light.png`/`shield-dark.png`/`lockup-horizontal-*.png` are produced by
chroma-keying that flat background out and cropping to content, not by copying the source
files directly.

## Files in this folder

| File                            | What it is                                                        | Use                                                             |
| ------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------- |
| `shield-light.png`              | Color mark only, cropped from `shift_light_2.png`, transparent bg | Web header/login mark, light backgrounds (`Logo.tsx` `color`)   |
| `shield-light-2048.png`         | Same, upscaled to 2048px long edge (Lanczos)                      | App icon compositing source (see `build-icons.mjs`)             |
| `shield-dark.png` / `-2048.png` | White mark only, cropped from `shift_dark_2.png`, transparent bg  | Web header/login mark, dark backgrounds (`Logo.tsx` `reversed`) |
| `lockup-horizontal-light.png`   | Full "SHIFT AT PENN" lockup as supplied, chroma-keyed transparent | Mobile splash, light mode                                       |
| `lockup-horizontal-dark.png`    | Full "SHIFT AT PENN" lockup as supplied, chroma-keyed transparent | Mobile splash, dark mode                                        |

The Android adaptive icon (`ic_launcher_foreground` / `ic_launcher_monochrome`) and the iOS
`AppIcon-1024.png` are not pre-baked files in this folder — `build-icons.mjs` composites them
from `shield-light-2048.png` on every run (`crestCanvas` / `whiteSilhouette`), so there is one
source of truth instead of a separately-maintained canvas that can drift from it.

## Decisions locked in with the product owner

- App name is **"SHIFT"** (all caps) everywhere a display name is shown: mobile app name/label
  (Android `app_name`, iOS `PRODUCT_NAME`/widget `CFBundleDisplayName`), web page title, and
  the PWA manifest `name`/`short_name`. This replaces "Shift PennHousing" / "Shift@PennHousing"
  as the user-visible name; internal identifiers (bundle IDs, package names, DB references)
  are unaffected.
- Web header (`Logo.tsx` and every call site): shield **as supplied**, sized to fit. `color`
  (gradient mark) on light backgrounds, `reversed` (white mark) on dark ones, e.g. the nav
  chrome (`#161616`) and the login page's dark brand panel. Next to it: wordmark reads
  **"SHIFT"**, set in Roboto Slab (bold) — live text, independent of the raster lockup below.
- Mobile splash: horizontal "SHIFT AT PENN" lockup exactly as supplied, light and dark variant
  matched to the app's own theme (`Color.kt` light `#F6F7F9` / dark `#0E1116`), so the splash
  background is literally the same color as the first real frame, no flash.
- App icon (Android adaptive icon + iOS AppIcon): mark only, no wordmark, background is opaque
  white/light on both platforms (not dark).
- Scope: this replaces the crest **everywhere**, including the app icon, the mobile in-app
  login-screen mark (Android `ic_login_mark` / iOS `LoginMark.imageset`, consumed by
  `LoginScreen.kt` / `LoginView.swift`), and every other `Logo.tsx` usage (web login,
  forgot-password, etc.) — no surface holds onto the retired crest.

## Centering fix (2026-07-31)

The first (`logo-inspo-v3`) pass had two stray ~1-2px anti-aliasing artifacts a few pixels
inside the top-right and bottom-right corners of the source sketch — invisible to the eye but
just above the chroma-key threshold, so they were included in the alpha bounding box and
stretched the crop rectangle out to the image edges, silently uncentering the mark in every
composited icon. Fixed by extracting the mark via connected-component analysis (the spiral-S
is four disconnected ring shapes, each tens of thousands of pixels; the artifacts were two
components under 100px) and keeping only the real rings before cropping. The `logo-inspo-v4`
source files replacing that sketch don't have this defect (clean supplied art, verified
symmetric margins after crop), but the same connected-component-safe cropping approach is
still what `shield-light`/`shield-dark` are built with.

## Splash lockup pixel density

Unchanged mechanism from the crest pass: `build-icons.mjs`'s `splashLockup()` generates one
slice per Android density bucket (`drawable-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}`, and the
`-night-` equivalents for dark mode) and one `@1x`/`@2x`/`@3x` slice per iOS `LaunchLogo`
appearance, all at the same fixed `SPLASH_HEIGHT_PT` (111pt) both platforms lay the mark out
at — pixel density changes, on-screen footprint does not. Same treatment for the in-app login
mark at `LOGIN_MARK_HEIGHT_PT` (72pt).
