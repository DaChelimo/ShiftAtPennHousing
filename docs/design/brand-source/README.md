# Brand source assets: Penn crest refresh (2026-07-25)

Source of truth for the crest-based rebrand replacing the old generated chevron mark
(`BrandMarkGeometry` / `apps/web/lib/brandPaths`) across web, Android, and iOS. Decisions were
made interactively with the product owner via mockups; this file is the record.

## Provenance

All raster, extracted and cropped from four PNGs the product owner supplied (not vector; there
is no SVG source for the crest). Original files, kept for reference only, don't re-derive from
them without re-cropping:

- `/Users/DaChelimo/Downloads/Shift Images (1)/1.png` (stacked lockup, light) and `2.png`
  (horizontal lockup, light)
- `/Users/DaChelimo/Downloads/Shift Images (2)/2.png` (stacked lockup, dark, white shield
  outline) and `3.png` (horizontal lockup, dark)

## Files in this folder

| File                              | What it is                                                                              | Use                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `shield-light.png`                | Crest only, cropped from `1.png`, transparent bg, native res (~185x210)                 | Small UI use (web header icon)                                        |
| `shield-light-2048.png`           | Same, upscaled to 2048px long edge (Lanczos)                                            | App icon compositing source only                                      |
| `shield-dark.png` / `-2048.png`   | Crest with white outline, cropped from dark `2.png`, transparent                        | Not currently used, kept in case a dark-chrome context needs it later |
| `lockup-horizontal-light.png`     | Full "SHIFT AT PENN" horizontal lockup, light, transparent, from `2.png`                | Mobile splash, light mode                                             |
| `lockup-horizontal-dark.png`      | Full "SHIFT AT PENN" horizontal lockup, dark, transparent, from `3.png`                 | Mobile splash, dark mode                                              |
| `android-adaptive-foreground.png` | Crest centered at 58% width on a transparent 1024x1024 canvas (adaptive icon safe zone) | Android `ic_launcher_foreground`                                      |
| `android-adaptive-monochrome.png` | Same crop, recolored to solid white, alpha-only shape                                   | Android 13+ themed icon (`ic_launcher_monochrome`)                    |
| `ios-appicon-1024.png`            | Crest at 72% width, flattened onto opaque white 1024x1024 (iOS icons can't have alpha)  | iOS `AppIcon-1024.png`                                                |

## Known quality ceiling

The crest crops are natively only ~200x220px (the supplied files were 500x500 canvases with
the crest occupying a small region). Everything above 2048px was upscaled with Lanczos
resampling from that native resolution, not from vector art. It reads fine at normal app icon
and header sizes; it will look soft if anyone tries to blow it up further (e.g. a marketing
banner). If a vector version of the Penn shield surfaces later, regenerate from that instead
and this ceiling goes away.

## Decisions locked in with the product owner

- Web header (`Logo.tsx` and every call site): shield **exactly as supplied**, no recoloring,
  no white-outline treatment, even though the nav chrome background is dark (`#161616`). Next
  to it: wordmark reads **"SHIFT" only** (not "SHIFT AT PENN" / "SHIFT@PENN"), set in
  **Roboto Slab** (bold), not the old chevron `Wordmark` component.
- Mobile splash: horizontal lockup as supplied, light and dark variant matched to the app's own
  theme (`Color.kt` light `#F6F7F9` / dark `#0E1116`), so the splash background is literally the
  same color as the first real frame, no flash.
- App icon (Android adaptive icon + iOS AppIcon): crest only, no wordmark, background is
  opaque white/light on both platforms (not dark), consistent with the crest's native context.
- Scope: this replaces the chevron mark **everywhere**, including the app icon and every other
  `Logo.tsx` usage (login, forgot-password, etc.), not just the header and splash.
