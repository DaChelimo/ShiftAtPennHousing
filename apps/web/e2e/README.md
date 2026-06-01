# Phase 13b — Admin web E2E (Playwright)

These Playwright specs are **TDD-first / RED**: the SM/HM admin web app does not
implement the schedule builder or HM-leave screens yet (`apps/web` is still the
Next.js scaffold). Each flow fails at its first missing selector. This is the web
analogue of the Maestro flows for the mobile app (`apps/mobile/maestro`) — a
selector + seed contract that the implementation must satisfy to turn green.

Behavioral source of truth: `BEHAVIORAL_SPECIFICATION.md` §4.3 (schedule building —
**desktop only**), §2.3 (HM/BM override powers), §2.6 (HM/BM leave). Pinned test
decisions: `tests/PHASE_13b/TEST_PLAN.md`.

## Files

| File                       | Spec | Covers                                                                                                                                                      |
| -------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schedule-builder.spec.ts` | §4.3 | Phase-1 grouping + blocked-disabled + hours-remaining; assign→draft; over-target warning; Phase-2 advisory roster; publish→worker visibility; desktop-only. |
| `hm-leave.spec.ts`         | §2.6 | SM cannot submit leave; replacement-picker cycle prevention; pre-filled mailto generation.                                                                  |
| `helpers.ts`               | —    | `login`, `gotoScheduleBuilder`, `dragSpan`, `cardGroup`, and the **seed contract** (`SEED`).                                                                |

## How to run (manual — not verifiable from a unit-test host)

```bash
# 1. Local backend with the phase-13b seed (see "Seed contract" below)
supabase start
supabase db reset           # apply migrations + a seed that creates the SEED fixtures

# 2. Install Playwright (first time)
pnpm install
pnpm --filter @shift/web exec playwright install --with-deps chromium

# 3. Run (playwright.config.ts auto-starts `next dev` if nothing serves E2E_BASE_URL)
pnpm --filter @shift/web e2e
```

Like the Maestro flows, these run against a **real, seeded environment** and assume
the baseline state (empty drafts, the period unpublished). Re-seed (`supabase db
reset`) between runs — the publish step is once-per-period (the phase-04 re-publish
guard raises on a second publish).

## Selector contract (`data-testid` unless noted)

The implementation MUST expose these. Worker/replacement **rows are buttons** with an
accessible name equal to the person's display name, so `getByRole('button'|'option',
{ name })` resolves them; "blocked / non-selectable" is a **disabled** button.

### Shell & auth

| testid                                            | Meaning                                    |
| ------------------------------------------------- | ------------------------------------------ |
| `login-email` / `login-password` / `login-submit` | Login form fields + submit.                |
| `app-shell`                                       | Authenticated chrome (visible post-login). |
| `nav-schedule-builder`                            | Nav entry to the builder.                  |

### Schedule builder (§4.3)

| testid                                             | Meaning                                                                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `schedule-builder`                                 | Builder page container.                                                                                                               |
| `schedule-builder-grid`                            | The drag-picker calendar grid (desktop only).                                                                                         |
| `builder-desktop-only-notice`                      | Shown instead of the grid on a non-desktop viewport (§4.3).                                                                           |
| `builder-phase-1` / `builder-phase-2`              | Phase toggle (Preference-Assisted / Manual Override).                                                                                 |
| `block-<YYYY-MM-DD>-<HHMM>`                        | A 30-min calendar cell (NY wall-clock key); shows assignee names.                                                                     |
| `phase1-card`                                      | The Phase-1 side card (appears after a drag).                                                                                         |
| `card-group-preferred` / `-available` / `-blocked` | The three Phase-1 groups.                                                                                                             |
| `worker-hours-remaining`                           | Hours-remaining figure on a card entry (target − assigned).                                                                           |
| `phase2-roster`                                    | The Phase-2 full-roster card (appears after a drag); a list whose `role=listitem` rows each hold a name button + any advisory labels. |
| `over-target-warning` / `over-target-confirm`      | Over-target warning popup + its "continue anyway" button.                                                                             |
| `advisory-confirm` / `advisory-confirm-accept`     | Phase-2 advisory (cannot/opted-out) confirm dialog + accept.                                                                          |
| `publish-button` / `publish-confirm`               | Publish action + confirm.                                                                                                             |
| `schedule-published-badge`                         | Published-state indicator.                                                                                                            |
| `my-shifts`                                        | A worker's own published shifts (worker view).                                                                                        |

### HM/BM leave (§2.6) — route `/admin/leave`

| testid                                | Meaning                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| `leave-unauthorized`                  | Shown to non-HM/BM (e.g. an SM) instead of the form.                                  |
| `hm-leave-form`                       | The leave form (visible only to HM/BM).                                               |
| `leave-start-date` / `leave-end-date` | Leave date range inputs (`<input type="date">`, `YYYY-MM-DD`).                        |
| `replacement-select`                  | Opens the replacement picker; shows the chosen replacement's name.                    |
| `replacement-options`                 | The options listbox; each option is `role=option` named by person.                    |
| `leave-submit`                        | Submit the leave.                                                                     |
| `leave-mailto`                        | Anchor whose `href` is the pre-filled `mailto:` (must match `craft_hm_leave_mailto`). |

## Seed contract

All fixtures live in `helpers.ts` (`SEED`). Password for every user: `test-Password-123`.
House under test: **Quad** (multi-staff, non-Harnwell — no training constraint to
confound grouping). Build week: Monday **2026-02-02** (regular school year, EST).
The period's preference window is closed (prefs locked) and `published_at` is NULL.

**Quad blocks** for the day at 10:00 / 10:30 / 11:00 / 11:30 (cells
`block-2026-02-02-1000…1130`).

**Schedule-builder workers** (home_house = quad, role `sw`), preferences for the four
blocks, plus `period_targets`:

| User       | 10:00     | 10:30     | 11:00     | 11:30     | target | opted_out | Phase-1 group                      |
| ---------- | --------- | --------- | --------- | --------- | ------ | --------- | ---------------------------------- |
| Alice Quad | preferred | available | available | available | 20     | no        | **preferred**                      |
| Ben Quad   | available | available | available | available | 20     | no        | **available**                      |
| Cara Quad  | cannot    | available | available | available | 20     | no        | **blocked** (cannot)               |
| Dana Quad  | —         | —         | —         | —         | (none) | —         | _Phase-2 only_                     |
| Erin Quad  | available | available | available | available | **1**  | no        | available; 2h span over-targets    |
| Fred Quad  | —         | —         | —         | —         | 0      | **yes**   | _Phase-2 only_; opted-out advisory |

- **Sam Quad** (`sm.quad@…`) — the Quad **SM** who builds + publishes.

**HM-leave actors:**

- **Hana Quad** (`hm.quad@…`) — the Quad **HM** going on leave.
- **Bea Quad** (`bm.quad@…`) — the Quad **BM**, the default replacement (§2.6 #1).
- **Ingrid Incoming** (`hm.incoming@…`) — an HM at another house with an **active
  `hm_leave` row naming Hana as her replacement**. Hana is therefore in Ingrid's
  forward chain ⇒ Ingrid is in Hana's **incoming chain** ⇒ excluded from Hana's
  replacement picker (cycle prevention, §2.6).
- **Project Administrator** (`admin@…`) — set as `system_config('project_administrator_user_id')`;
  always a valid terminal replacement, never excluded.

The leave mailto recipients are the Quad SWs' emails (Alice…Fred), so the generated
`href` contains e.g. `alice.quad@pennhousing.test`.

## Phase 14 — System-wide hours-cap modification (§9.3) — route `/admin/hours-cap`

`cap-modification.spec.ts` is **TDD-first / RED**: the cap-modifier admin screen
does not exist yet. HMs/BMs may set any calendar week to 20-soft or 40-hard; the
change is global across all 13 houses, instant, and audit-trailed (ARCH §3.10).
SMs and SWs are blocked. Pinned decisions: `tests/PHASE_14/TEST_PLAN.md`.

| testid                                                                | Meaning                                                                     |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `cap-modifier`                                                        | The cap-modifier page container (visible only to HM/BM).                    |
| `cap-unauthorized`                                                    | Shown to non-HM/BM (an SM or SW) instead of the modifier.                   |
| `cap-week`                                                            | Target-week input (`<input type="date">`, the week's Monday, `YYYY-MM-DD`). |
| `cap-value-20` / `cap-value-40`                                       | The cap selector (20-soft / 40-hard).                                       |
| `cap-notes`                                                           | Audit notes field (ARCH §3.10 `notes` column).                              |
| `cap-submit`                                                          | Apply the modification (instant, no approval).                              |
| `cap-global-notice`                                                   | The "applies to all 13 houses" indicator (§9.3 global scope).               |
| `cap-success`                                                         | Post-submit confirmation.                                                   |
| `cap-audit-modified-by` / `cap-audit-modified-at` / `cap-audit-notes` | Audit-trail readback of the saved `weekly_cap_overrides` row.               |

Reuses the phase-13b SEED fixtures: `hmQuad`/`bmQuad` (authorized), `smQuad` + `alice`
(blocked). Target week is `SEED.date` (2026-02-02, a Monday in the regular school
year → default 20-soft; the HM/BM flows raise it to 40-hard).
