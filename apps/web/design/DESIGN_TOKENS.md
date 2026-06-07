# Design tokens & component contract — Admin web

The reconciled token system + shared component layer for the HM/SM admin web app,
ported faithfully from `admin-web.html` (the visual source of truth) and the brand
spec in `docs/design-brief.md`. **This is the contract every screen reskin references.**

> **Foundation status:** tokens, the global UI Shell, and the shared component
> layer are built. Feature screens (calendar, coverage, inbox, people, hours,
> reskins of builder/leave/rotor/cap/config) are **not** reskinned yet.

---

## 0. Architecture reconciliation (read first)

The brief and READMEs say "IBM Carbon Design System." The shipped app
(`apps/web`) has **no `@carbon/react` dependency** — it is **Tailwind CSS v4** with
a near-default starter. The design export is likewise **hand-authored CSS** that
reproduces Carbon's v11 tokens, not the React library.

**Decision:** the foundation reproduces Carbon's visual language as a
**CSS-custom-property token layer + plain component classes** in
[`app/globals.css`](../app/globals.css), consumed by thin React components in
[`components/ui/`](../components/ui). We did **not** introduce `@carbon/react`:
that would be a rebuild (re-doing every tested page in a new component model),
violating the reskin guardrail and risking the test contracts. Tailwind v4 stays
and coexists; its `dark:` variant is wired to our `data-theme` toggle.

---

## 1. Theming mechanism

- Two themes: **light (primary)** and a **Carbon Gray-100 dark** theme.
- Switched by the **`data-theme="light" | "dark"`** attribute on `<html>`.
- Applied **pre-paint** by an inline script in [`app/layout.tsx`](../app/layout.tsx)
  reading `localStorage['shift-theme']` (default light) — no flash, no hydration
  mismatch (`suppressHydrationWarning`).
- Toggled from the UI Shell header. The toggle flips the attribute; the shell
  reads it via `useSyncExternalStore` + a `MutationObserver` (no setState-in-effect).
- Tailwind's `dark:` variant is redefined to follow `[data-theme="dark"]`
  (`@custom-variant dark` in `globals.css`), so legacy `dark:` utilities on
  not-yet-reskinned pages track the in-app toggle.
- **Chrome (header + side nav) stays dark in both themes** (Carbon UI Shell).

Fonts: **IBM Plex Sans** (UI) + **IBM Plex Mono** (times / IDs), self-hosted via
`next/font/google` in `layout.tsx`, exposed as `--font-ibm-plex-sans|mono` and
mapped to `--font-sans|mono` through Tailwind's `@theme`.

---

## 2. Color tokens

CSS variables in `:root` (light) / `[data-theme="dark"]` (dark overrides). Use the
variables, never raw hex, in screen code.

### Brand / interactive

| Token                    | Light       | Use                                            |
| ------------------------ | ----------- | ---------------------------------------------- |
| `--brand`                | `#0061FC`   | Primary buttons, links, active nav, focus      |
| `--brand-hover`          | `#0050D6`   | Hover                                          |
| `--brand-active`         | `#0043B3`   | Pressed                                        |
| `--brand-subtle-bg`      | `#EDF3FF`   | Selected rows, drag highlight (dark: blue α)   |
| `--brand-subtle-border`  | `#D0DFFF`   | Border on subtle surfaces                      |
| `--focus`                | `#0061FC`   | Focus ring (`:focus-visible`, 2px)             |

### Neutrals (light → dark)

| Token              | Light     | Dark      | Use                       |
| ------------------ | --------- | --------- | ------------------------- |
| `--text-primary`   | `#161616` | `#F4F4F4` | Body text, headings       |
| `--text-secondary` | `#6F6F6F` | `#A8A8A8` | Captions, meta            |
| `--text-placeholder`| `#A8A8A8`| `#6F6F6F` | Placeholders              |
| `--surface`        | `#FFFFFF` | `#262626` | Cards                     |
| `--surface-2`      | `#F4F4F4` | `#161616` | App canvas                |
| `--surface-3`      | `#E8E8E8` | `#353939` | Hover / chip fill         |
| `--field` / `--field-hover` | `#F4F4F4` / `#E8E8E8` | `#393939` / `#474747` | Inputs |
| `--border-subtle`  | `#E0E0E0` | `#393939` | Hairlines                 |
| `--border-strong`  | `#8D8D8D` | `#6F6F6F` | Input underline, secondary btn |
| `--cal-day-line`   | `#B8B8B8` | `#525252` | Calendar day-column divider |
| `--overlay`        | `rgba(22,22,22,.5)` | `rgba(0,0,0,.65)` | Modal scrim |

### Chrome (dark in both themes)

`--header-bg #161616` · `--header-border #393939` · `--nav-bg #262626` (dark theme
`#161616`) · `--nav-bg-hover` · `--nav-bg-active` · `--nav-text #C6C6C6` ·
`--nav-text-active #FFFFFF`.

### Status helpers

`--success #24A148` / `--success-bg` · `--warn #F1C21B` / `--warn-bg` ·
`--info #0061FC` / `--info-bg`.

---

## 3. Shift-state palette — LOAD-BEARING

The live calendar encodes coverage **mechanism** in color. **Never color alone** —
every state pairs a color with a **text tag** (and an **icon** where it carries
meaning), for WCAG 2.1 AA. The canonical source is
[`components/ui/shiftState.ts`](../components/ui/shiftState.ts) (`SHIFT_STATES`);
the persistent strip is `<StatusLegend>`; swatch classes are `.lg-*`.

| State (key)             | Tag kind | Tokens (bg / fg / border)                         | Treatment                                  |
| ----------------------- | -------- | ------------------------------------------------- | ------------------------------------------ |
| Scheduled (`scheduled`) | gray     | `--surface` / `--text-primary` / `--border-subtle`| Home worker on their own desk              |
| Float-in (`float-in`)   | green    | `--st-float-bg` / `--st-float-fg #24A148` / `--st-float-bd` | Worker floated in (shows home house) |
| Float-out (`float-out`) | purple   | `--st-out-bg` / `--st-out-fg #8A3FFC` / `--st-out-bd` | Personal calendar: away covering elsewhere |
| Pending (`pending`)     | amber    | base + `--st-pending #B28600` / `--st-pending-bg` | Force-triggered float, not yet acknowledged|
| Allied (`allied`)       | teal     | `--st-allied-bg` / `--st-allied-fg #007D79` / `--st-allied-bd` | External Allied Security        |
| Break (`break`)         | amber    | `--surface` + **golden border `--st-break-bd #F1C21B`** | Short/winter break shift              |
| Open / vacant (`vacant`)| outline  | dashed `--st-vacant-bd #C6C6C6` / `--st-vacant-fg`| One-time coverage gap                      |
| Permanent opening (`permanent`) | magenta | `--st-perm-bg` / `--st-perm-bd #EE5396` / `--st-perm-fg` | Owner permanently dropped recurring slot |
| Over-cap (`over`)       | red      | `--st-danger #DA1E28` / `--st-danger-bg` / `--st-danger-bd` | Over-cap / blocked / urgent (needs Allied) |
| **Cross-house pickup**  | —        | `--st-pickup` (8px `<PickupDot>`)                 | Modifier on green/purple/home cards        |

Dark theme darkens each surface and brightens each foreground for AA (see the
`[data-theme="dark"]` block in `globals.css`).

---

## 4. Type, spacing, radii, elevation, motion

- **Type scale** (utility classes): `.t-display` 28 · `.t-h1` 20 · `.t-h2` 16 ·
  `.t-h3` 14 · `.t-body` 14 · `.t-label` 12/500 · `.t-helper`/`.t-meta` 12
  secondary · `.t-mono` (tabular) · `.t-eyebrow` 11 uppercase.
- **Spacing** (8px base, Carbon): `--sp-1`=2 · `-2`=4 · `-3`=8 · `-4`=12 · `-5`=16 ·
  `-6`=24 · `-7`=32 · `-8`=40 · `-9`=48 · `-10`=64. Layout helpers: `.row`/`.col`,
  `.gap-1..5`, `.grow`, `.wrap`, `.center`, `.between`.
- **Radius:** Carbon-square — `0` on buttons/inputs/cards; `99px` only on pills,
  toggles, dots, avatars; `3–4px` on calendar shift cards.
- **Elevation:** `--shadow-1` (cards) · `--shadow-2` (menus/modals) ·
  `--shadow-panel` (right detail panel).
- **Motion:** `--motion` 130ms · `--ease` `cubic-bezier(0.2,0,0.38,0.9)`. Modal
  `pop` 160ms, panel `slideR` 180ms, toast `slideIn` 160ms.

---

## 5. Component layer — what exists & where

All in [`components/ui/`](../components/ui) (barrel: `components/ui/index.ts`),
plus the global shell.

| Component | File | Notes |
| --------- | ---- | ----- |
| `Icon` (+`ICONS`, `IconName`) | `Icon.tsx` | 16px geometric line set |
| `Button`, `IconButton` | `Button.tsx` | primary/secondary/tertiary/ghost/danger; sm/md/lg |
| `Tag`, `PickupDot` | `Tag.tsx` | status pills (9 kinds) + 8px pickup dot |
| `Avatar` | `Avatar.tsx` | initials |
| `EscalationChip` (+`ESCALATION_STEPS`) | `EscalationChip.tsx` | T-3h → T-2h → Allied; `compact` |
| `Toggle` | `Toggle.tsx` | controlled switch (broadcast-sub hidden for HM/BM at call site) |
| `Field`, `TextInput`, `Select`, `DateInput` | `Field.tsx` | Carbon fields |
| `ComboBox` | `ComboBox.tsx` | searchable dropdown |
| `Modal` | `Modal.tsx` | `danger` variant; Esc/scrim close; split footer |
| `Notification` | `Notification.tsx` | inline + `actionable` (Allied alert) |
| `EmptyState`, `ErrorState` | `EmptyState.tsx` | calm/neutral/error tones |
| `Skeleton` | `Skeleton.tsx` | shimmer loading |
| `Tabs` | `Tabs.tsx` | line tabs + count pills |
| `PageHead` | `PageHead.tsx` | eyebrow/title/sub + actions |
| `Card` | `Card.tsx` | surface card |
| `DataTable` (+`Column`) | `DataTable.tsx` | Carbon table convention; clickable rows |
| `StatusLegend` | `StatusLegend.tsx` | the shift-state legend |
| `ToastProvider`, `useToast` | `Toast.tsx` | transient toasts |
| **`AppShell`** (+`HouseSwitcher`) | `components/AppShell.tsx` | UI Shell: header (hamburger, brand, house switcher, HMOD pill, theme toggle, bell, user menu) + persistent grouped side nav (Operate/Manage/System) |

Shared screen primitives also ported into `globals.css` for upcoming screens:
`.dtable`/`.sortable`, `.meter`, `.statstrip`/`.statcard`, `.seg`, `.kv-list`,
`.legend`/`.lg-*`, style-tile (`.st-*`). The screen-specific blocks (calendar grid,
builder, inbox, coverage, people/leave/rotor/config) remain in `admin-web.html`
and get ported when each screen is reskinned.

**Living reference:** [`/components`](../app/(app)/components/page.tsx) renders the
whole layer in light + dark.

### Side-nav clickability note (test contract)

The design's nav is an off-screen hamburger drawer. The Playwright e2e clicks
`nav-schedule-builder` **directly** (and at a 390px viewport), so the foundation
renders the side nav as a **persistent grid column, expanded by default** (the
hamburger collapses it). This keeps every nav item on-screen and keyboard/pointer
reachable — idiomatic Carbon, and it preserves the test contract.

---

## 6. Screen inventory & data-availability (for upcoming screens)

Classification of every design screen vs. the existing app, with a data check
(NEW screens may only present **existing** data — never invent backend).
`✓ data exists` = tables/RPCs/views are in the repo; `⚠ FLAG` = the design shows
something with **no backing** — confirm before building, do not fabricate.

| Design screen | Route status | Data check |
| ------------- | ------------ | ---------- |
| Style tile / **Components** | NEW (`/components`, built) | None (presentation) ✓ |
| **Live calendar** (centerpiece) | NEW | Read ✓ (`shift_block_assignments`+`shift_blocks`+`users`; escalation via `block_step_status`). ⚠ **Inline live-override write** (reassign/remove a published block, this-week-vs-permanent) has no dedicated RPC — confirm before wiring. |
| **Shift detail / contact / override panel** | NEW (child of calendar) | Read ✓ (`users.phone`, assignment). Per-worker hours need aggregation (computable). Override write: same ⚠ as calendar. |
| **Coverage & open-shifts** | NEW | Read ✓ (`weekly_feed_for_house`/`weekly_open_shifts_feed`, `permanent_openings_feed`, `float_assignments` ack). Force-trigger ✓ (`force_trigger_float`). ⚠ **"Mark covered / Call Allied" write** has no RPC. |
| **Action inbox** | NEW | Read ✓ (`notifications`); `mark_notification_read` ✓. ⚠ same "mark covered" write. |
| **People / roster** | NEW | Read ✓ (`users`+`user_roles`; hours computable). ⚠ **Hire / Fire writes** have no RPC (create-user / fire-worker). |
| **Hours & cap monitor** | partial (`/admin/cap`,`/admin/hours-cap` exist) | Cap ✓ (`weekly_cap_overrides`, `effective_weekly_cap`). Per-worker hours decomposition: data exists in tables, needs a read-layer query (no admin view yet) — computable, not a gap. |
| **Schedule builder** | EXISTING (`/schedule-builder`) | ✓ (`getBuilderData`, drafts, `publish_schedule`). Reskin only. |
| **Leave** | EXISTING (`/admin/leave`) | ✓ existing = HM/BM **self-leave + delegation + mailto**. ⚠ the design models a different **worker PTO approval queue** (Vacation/Sick/… approve/decline) that does **not** exist — keep the existing leave concept. |
| **HMOD rotor** | EXISTING (`/admin/rotor`) | Core ✓ (`hmod_rotor`, `getRotorData`). ⚠ design extras (incident counts, Allied call-outs, request-swap-from-rotor) are **not** backed. |
| **Config** | EXISTING (`/admin/config`) | ✓ generic `system_config` edit (`getSystemConfig`/`saveSystemConfig`). The specific toggles/sliders map to config keys. |
| **Health** | EXISTING (`/admin/health`) | Tick metrics ✓ (`orchestrator_health`). ⚠ design's **integration-status cards** (SMS/Allied/SSO/SIS) are **not** backed (only the single tick row exists). |
| Dashboard (`/`) | EXISTING | ✓ (`getMyShifts`). |
| SW phone views (shifts/personal-cal/prefs/break/ack) | NEW, secondary | Mostly ✓ against `worker_my_shifts`/`worker_open_shifts` + claim/drop/swap/ack RPCs; out of scope for the desktop admin reskin. |

**Net data flags to resolve before building those writes:** live-calendar inline
override, "Mark covered / Call Allied", People Hire/Fire, the worker-leave-approval
queue, rotor incident/call-out stats, and health integration cards. The **reads**
for every NEW screen are supported by existing tables/views/RPCs.
