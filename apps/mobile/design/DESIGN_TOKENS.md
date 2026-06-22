# Worker App — Design Tokens & Foundation Contract

The canonical token + component reference for the **Shift@PennHousing worker mobile
app** reskin. Every screen reskin (Compose + SwiftUI) binds to the names here.

- **Visual source of truth:** `apps/mobile/design/worker-app.html` (`--tk-*` tokens).
- **Semantic reference:** `docs/design-brief.md` §4 (the load-bearing state colors).
- **Type:** IBM Plex Sans (UI) + IBM Plex Mono (times / durations / IDs / numbers),
  bundled on both platforms; SF Pro / Roboto are the graceful fallback.
- **Platforms:** Android = Material 3 (brand color scheme, **not** wallpaper dynamic
  color). iOS = Apple HIG. Light **and** full dark on both.

> Color is **load-bearing but never used alone** — every shift state is
> color **+ text tag + icon** (design-brief §4 / §9). Pills/cards enforce this.

## Where the foundation lives

| Layer | Android (Compose) | iOS (SwiftUI) |
| ----- | ----------------- | ------------- |
| Color | `androidApp/.../ui/theme/Color.kt` (`ShiftColorScheme` + `ShiftColors`) | `iosApp/iosApp/Theme/ShiftTheme.swift` (`ShiftColors`) |
| Type | `ui/theme/Type.kt` (`ShiftTypography` + `ShiftTypeExtras`) | `Theme/ShiftTheme.swift` (`ShiftFont` / `ShiftType`) |
| Shape / tokens | `ui/theme/Shape.kt`, `Tokens.kt` | `Theme/ShiftTheme.swift` (`Radii` / `Spacing` / `Dims` / `Motion`) |
| Theme entry | `ui/theme/Theme.kt` (`ShiftTheme { }`) | resolve via `@Environment(\.colorScheme)` + `ShiftColors.resolve` |
| Icons | `ui/kit/ShiftIcons.kt` (stroked `ImageVector`s) | `Theme/ShiftTheme.swift` (`ShiftIcons` → SF Symbols) |
| Components | `ui/kit/*.kt` | `iosApp/iosApp/Kit/*.swift` |
| Catalog (`@Preview`/`#Preview`) | `ui/kit/Gallery.kt` | `Kit/ShiftGallery.swift` |
| Fonts | `androidApp/src/main/res/font/ibm_plex_*` | `iosApp/iosApp/Fonts/IBMPlex*` (+ `Info.plist UIAppFonts`) |

## 1. Color tokens

`ShiftColorScheme` (M3 `ColorScheme`) drives standard chrome + brand primary;
`ShiftColors` carries the bespoke semantics M3 has no role for. Same hexes on both
platforms.

### Brand & neutrals

| Token | Light | Dark | Notes |
| ----- | ----- | ---- | ----- |
| blue (primary) | `#0061FC` | `#0A84FF` | Shift Blue; M3 `primary` |
| blue pressed | `#0A4ECB` | `#409CFF` | press/active state |
| blue container | `#E4EDFF` | `#0C2C4F` | tonal button / pickup badge / `primaryContainer` |
| on-blue-container | `#00307E` | `#BBD6FF` | text on container |
| ink | `#121622` | `#ECF0F6` | body text / `onSurface` (cool near-black) |
| sec | `#545B6B` | `#A7AFBE` | secondary text |
| ter | `#828A9A` | `#6E7686` | tertiary / meta |
| divider | `#E3E6EC` | `#282D38` | hairline / `outlineVariant` |
| outline | `#C8CED9` | `#3C4350` | borders / `outline` |
| bg | `#F6F7F9` | `#0E1116` | canvas / `background` |
| surface | `#FFFFFF` | `#171B22` | cards / `surface` |
| surface-var | `#EDF0F5` | `#232834` | `surfaceVariant` |

### Semantic shift-state palette (accent / tint / deep / badge)

| State token | Accent (L → D) | Tint (L → D) | Deep (L → D) | Badge (L → D) |
| ----------- | -------------- | ------------ | ------------ | ------------- |
| float (out) | `#6E56CF` → `#B6A4F0` | `#EEEBFA` → `#221D31` | `#4A3C8F` → `#D5C9FF` | `#E2DCF6` → `#2E2742` |
| float-in | `#2E8B57` → `#4FC07E` | `#E4F4EA` → `#13271B` | `#1E6B40` → `#A6E7BE` | `#CDEAD8` → `#1C3A27` |
| permanent | `#D14185` → `#F072AE` | `#FBE9F2` → `#311425` | `#9E2566` → `#FFC2DD` | `#F7D6E5` → `#3D1C30` |
| allied | `#007D79` → `#2FC2BB` | `#D7F5F4` → `#0D2A28` | — | `#BEEBE9` → `#123B38` |
| break (slate) | `#3F6079` → `#93ADC9` | `#E8EDF3` → `#19232F` | `#2C4256` → `#C6D7E8` | `#D6E0EB` → `#28384A` |
| success / ack | `#1E874B` → `#4FC07E` | `#DCFBE7` → `#13271B` | `#176B3B` → `#8FE0AE` | `#C3F0CE` → `#1C3A27` |
| error | `#DA1E28` → `#FF6B6B` | `#FFF0F0` → `#311818` | `#A8151D` → `#FF9B9B` | — |
| pending (orange) | `#BD5B1C` → `#EFA268` | (uses `warn-soft` bg) | | |
| pickup dot | `#0061FC` → `#0A84FF` | 8px filled dot | | |
| unpick badge | `#E0E3EA` → `#262B35` | muted | | |

### Chrome surfaces

| Token | Light | Dark |
| ----- | ----- | ---- |
| tabbar | `rgba(246,247,249,.86)` | `rgba(15,18,24,.84)` |
| scrim | `rgba(18,22,34,.32)` | `rgba(0,0,0,.55)` |
| toast bg / fg | `#121622` / `#FFFFFF` | `#ECF0F6` / `#121622` |
| switch track | `#E3E6EC` | `#3C4350` |
| warn-soft (pending/countdown bg) | `#FAEADF` | `#2B1F15` |
| skeleton ramp | `#ECEFF3` → `#F4F6F9` | `#1E232C` → `#272D38` |

## 2. The load-bearing shift-state legend (the contract)

Each state = **card tint + (border accent | left/dashed treatment) + a `StatePill`
(icon + text)**. This is the `ShiftState` enum (both platforms) and the reusable
`StateLegend`.

| `ShiftState` | Card | Tag (label · icon) | Special |
| ------------ | ---- | ------------------ | ------- |
| `SCHEDULED` | white surface, divider border | _none_ | — |
| `FLOAT_OUT` | purple tint, accent border | "Float-out" · arrow-out | destination shown |
| `PENDING_FLOAT` | purple tint | "Float-out" + **orange "Pending"** · clock | — |
| `PICKUP_HOME` | white surface | "Picked up" · check | **8px pickup dot** |
| `PICKUP_CROSS` | purple tint | "Picked up" · check | **pickup dot** + destination |
| `FLOAT_IN` | green tint, accent border | "Float-in" · arrow-in | home house shown |
| `BREAK` | white surface | "Break" · snowflake | **4px slate left border** |
| `OPEN` | white surface | _none_ | **dashed outline** |
| `PERMANENT` | magenta tint, accent border | "Permanent opening" · refresh | weeks-remaining meta |
| `UNPICKABLE` | surface-var | "Unpickable" · lock | **muted (0.72)** |
| `DROPPED` | white surface | "Dropped — still open" · arrow-down | **time strikethrough** |
| `ALLIED` | teal tint, accent border | "Allied" · person | — |
| `ACK` | green tint, accent border | "Acknowledged" · check-circle | — |

Card border rule: dashed (`OPEN`) → `outline` 1.5px dashed; has accent → accent @
22% 1px; else `divider` 1px. Selected/active → 2px blue ring + raised shadow.

## 3. Typography

IBM Plex Sans (400/500/600/700) + IBM Plex Mono (400/500/600). Sizes are `sp`
(Android) / points with `relativeTo:` Dynamic Type styles (iOS) → scale with the
user's font setting. Mono carries **tabular figures + slashed zero** (`tnum, zero`).

| Role (M3 / `ShiftType`) | Size / weight | Use |
| ----------------------- | ------------- | --- |
| displaySmall | 28 / 600 | big numerals / brand |
| headlineLarge | 26 / 700 | float-assignment hero |
| headlineMedium | 22 / 700 | sheet/section hero |
| titleLarge | 19 / 700 | screen title (small) |
| titleMedium | 18 / 600 | card / list titles |
| titleSmall | 16 / 600 | sub-titles |
| bodyLarge | 16 / 400 | body |
| bodyMedium | 15 / 400 | **primary body** (most used) |
| bodySmall | 13 / 400 | secondary |
| labelLarge | 14 / 600 | **button label** |
| labelMedium | 13 / 600 | strong labels |
| labelSmall | 11 / 600 + 0.04em | **uppercase eyebrow** |
| monoTimeHero | 22 / 600 mono | shift-time hero on a card |
| monoTime | 15 / 500 mono | inline times / durations |
| monoId | 12 / 500 mono | IDs / count pills |
| eyebrow | 11 / 600 + 0.05em | when/house uppercase labels |

Large title (top bar) = 30 / 700, tracking −0.02em.

## 4. Shape · spacing · elevation · motion

- **Radii:** card **16**, sheet (top) **28**, button **12** (sm 10), chip/tag/countdown **pill**, duration chip **6**, house badge **11**, toast/banner **14**.
- **Spacing:** 4dp base + 2dp half-step → `2 · 4 · 6 · 8 · 12 · 16 · 20 · 24`. Screen margin **16**; card inset **13×14**; section gap **24**; list gap **8**.
- **Touch targets / heights:** button sm **34** · md **44** · lg **52**; min interactive **48** (Android) / 44pt (iOS).
- **Icon sizes:** tag **13** · small **16** · default **18** · 20 · nav **25**.
- **Elevation:** resting card `elev-1` (soft 1–3px); raised/selected `elev-2`; sheet `elev-sheet`.
- **Motion:** press **120ms** scale (button 0.97 / card 0.985); state 140–160ms; dialog **260ms**; sheet **300ms** on the iOS curve `cubic-bezier(0.32,0.72,0,1)`; success pop **~420ms** overshoot `cubic-bezier(0.34,1.56,0.64,1)`; skeleton shimmer **1.4s**. Honor reduced-motion.

## 5. Component kit (built on both platforms)

Buttons (filled · tonal · outlined · text · destructive · destructive-filled, in
3 sizes) · status `StatePill` + `PendingTag` + `StateLegend` · canonical `ShiftCard`
(+ all 13 state variants) · `OpenShiftCard` · `SectionHeader` / `ShiftSection`
(always-rendering, with empty placeholder) / `KeyValueRow` · `SegmentedControl` ·
switch (M3 `Switch` / native `Toggle`) · bottom sheet (`ModalBottomSheet` /
`.sheet`+detents+grabber) + confirm + alert dialog · large-title top bar + bottom
nav (M3 `NavigationBar` / `TabView` tab bar) · icon button + count badge · gradient
avatar · toast · urgent banner · countdown chip · skeleton loaders · empty states ·
atoms (8px **pickup dot**, **slate break border**, **deadline countdown chip**,
duration chip, house badge).

The **native chrome difference** is intentional: Android = M3 `NavigationBar`
(Material-You active-indicator pill) + M3 modal sheet; iOS = `TabView` tab bar +
large title + `.sheet` with grabber/detents.

## 6. Screen inventory (existing vs new) + data-availability flags

Foundation builds **none** of these screens — this is the classification for the
later reskin/build steps. "Existing" = reskin over the shipped Phase-13a ViewModels;
"New" = presentation + wiring **over existing data only** (never invent backend).

| # | Screen | Status | Data availability |
| - | ------ | ------ | ----------------- |
| 1 | My Shifts (Picked-up / Dropped / Scheduled) + Updates | **Existing** | ✅ `ShiftsScreenViewModel`, `worker_my_shifts` view. (`dropped_still_open` is hard-coded `false` in the read-model — the "still open" treatment can't be shown yet.) |
| 2 | Open Shifts — My House (weekly + permanent) | **Existing** | ✅ `worker_open_shifts` view |
| 3 | Open Shifts — Other Houses | **Existing** | ✅ same view (cross-house feed) |
| 4 | Float acknowledgment (+ Updates entry) | **Existing** | ✅ `AckDeclineViewModel` (live pending-float feed still TODO; demo today) |
| 5 | Drop / Claim flows (sheets) | **Existing** | ✅ pure `shifts/` decision surface; Edge Functions `drop-shift` / `claim-shift` exist (mobile repo not yet wired — claim/drop are optimistic-local) |
| 6 | Personal calendar (List/Day/Week) | **New** | ⚠️ current-week own-shifts ✅; **arbitrary past/future weeks not exposed** (no date-param view) and there is **no recurring-template entity** (must derive client-side). |
| 7 | Preference submission (paint grid + target hrs) | **New** | ✅ tables (`preferences`, `period_targets`) + RLS + `submit-preferences` EF exist. ⚠️ **`scheduling_periods.preference_deadline` is NOT worker-readable** (no authenticated SELECT) → can't show/pre-gate the deadline; reminder cadence is 5/3/1d, not −24h/−2h. |
| 8 | Break claim picker | **New** | ✅ phase-11 implemented; break openings via `worker_open_shifts`; `break-claim` EF + `break_optouts`. ⚠️ no purpose-built "drop back to pool" RPC (reuse generic `drop-shift`); live 40h cap meter only via EF response, not a standalone read. |
| 9 | Settings / Profile | **New** | ✅ identity (own `users`/`user_roles`, RLS-ok but no view yet), `broadcast_subscribed` toggle, sign out, theme. ⚠️ see blockers below. |
| 10 | Shift detail / "Call desk" + "who's working" | **New** | ⛔ **BLOCKED** — see below. |
| 11 | House schedule ("who's working" grid) | **New** | ⛔ **BLOCKED** — see below. |
| — | Peer-to-peer **Swap** UI | _absent_ | Not in the worker design (drop/claim/pickup only). |

### ⛔ Hard blockers (require NEW backend — OUT OF SCOPE; do not fabricate)

1. **House roster readable by a worker** (screens 10 & 11). `shift_block_assignments`
   RLS lets a plain SW read assignments only at their **own** home house, and
   co-worker **names** are blocked even there (`users` RLS = own row + admin). No
   house-roster view exists. The cross-house "who's working" grid is unbuildable
   without a new SECURITY DEFINER roster view/RPC.
2. **Desk phone number** ("Call {desk}", screen 10). `houses` has **no phone
   column** — zero desk-phone data anywhere.
3. **Floater/worker phone** (§11.4 "call the floater"). `users.phone` exists but RLS
   forbids a worker reading another worker's row.
4. **Per-category notification toggles** (screen 9: shift-reminders,
   schedule-published). No backing columns — only `broadcast_subscribed`
   ("general updates") has storage; float assignments are always-on by spec.

If a later screen needs any of the above, **stop and flag** — do not add tables,
columns, RPCs, or migrations.

## 7. Guardrails (recap)

- This is a **reskin**: do not change shared decision logic, ViewModel state
  shapes/contracts, the data layer (`network/` `data/` `platform/`), or behavior.
- **Preserve every Maestro selector** in `apps/mobile/maestro/README.md`
  (`testTag` / `accessibilityIdentifier`). The My-Shifts section containers
  (`section_picked_up` / `_dropped` / `_scheduled`) must **always render** (use
  `ShiftSection`, which keeps the container + an empty placeholder), and the 4th
  **Updates** tab (`tab_updates`) must remain.
- Green gate (from `apps/mobile`): `./gradlew :shared:testAndroidHostTest`,
  `:androidApp:assembleDebug`, `:shared:compileKotlinIosSimulatorArm64`,
  `:shared:linkDebugFrameworkIosSimulatorArm64`. SwiftUI + Maestro verify on a
  simulator/emulator (not the JVM gate).
