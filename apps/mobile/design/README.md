# Worker App — Design Reference (Claude Design exports)

Drop the **self-contained HTML bundles** exported from Claude Design here. These are
the **visual source of truth** for the worker mobile app (Compose on Android, SwiftUI
on iOS). They are **reference specs, not shipped code** — the app is native; nothing
here is bundled into the build or rendered in a WebView.

## What goes here

One self-contained `.html` per design tab from Claude Design (the standalone bundle —
**not** the "Save as PDF" output). Keep the exact exported file; do not hand-edit.

Suggested naming (rename to match your tabs):

| File | Screens it covers |
|------|-------------------|
| `worker-app.html`        | Full bundle, if Claude Design exported everything as one |
| `01-my-shifts.html`      | My Shifts (Scheduled · Picked-up · Dropped) + Drop sheet |
| `02-open-shifts.html`    | Open Shifts (My House / Other Houses) + Claim flow |
| `03-float-ack.html`      | Float Acknowledgment (Pending / Acked / Declined / Deadline) |
| `04-updates.html`        | Updates / notifications + pending-float entry point |
| `05-preferences.html`    | Preferences painting + Break claim |
| `06-calendar.html`       | Personal calendar |
| `07-login-settings.html` | Login + Settings/Profile |

## How these get implemented

1. Extract a reconciled `DESIGN_TOKENS` spec (color/type/spacing/radii/motion) from the
   CSS → generate the Compose theme (`Color.kt` / `Type.kt` / `Theme.kt`) + SwiftUI
   equivalents. Typography commits to **IBM Plex** (Sans + Mono) with Dynamic Type +
   tabular figures wired up.
2. Rebuild each screen in idiomatic Compose + SwiftUI to match the bundle.
3. **Reskin vs. build:** screens that already exist (My Shifts, Open Shifts + Claim,
   Float ack) bind to the existing shared ViewModels (`ShiftsScreenViewModel`,
   `AckDeclineViewModel`) + Supabase repository from Phase 13a — a reskin. New screens
   (Preferences, Break claim, Calendar) get UI **plus** new ViewModel/repository wiring.
4. **Preserve the selector contract:** every Maestro `testTag` (Android) /
   `accessibilityIdentifier` (iOS) from `apps/mobile/maestro/README.md` must survive the
   reskin so the E2E flows keep passing.
5. Verify: `:shared` compile (incl. iOS), `:androidApp:assembleDebug`, link the iOS
   framework, run Maestro, render on the emulator (android-cli) to diff against these.

HTML→native is a faithful **translation** (exact tokens/layout) expressed in Material 3
(Android) / HIG (iOS) components — not a literal port.
