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

All fixtures live in `helpers.ts` (`SEED`). Password for every user: `abc123`.
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

## S1 — Live-calendar admin override (web-remediation, audit #1) — route `/calendar`

`admin-override.spec.ts` is **TDD-first / RED**: the shift detail panel still shows
the disabled "Read-only in this build" notice instead of a live worker-picker, so
each flow fails at its first missing `override-*` selector. An HM/SM may **assign /
reassign / remove** a worker on a published block, **this-week vs permanent**, with
a **soft-constraint confirm**. Behavioral source: `BEHAVIORAL_SPECIFICATION.md` §4.3
(Phase-3 post-publish override) + §11.1. Pinned decisions + the full contract:
`docs/web-remediation/sessions/S1/TEST_PLAN.md`. The pure validator is unit-pinned
in `packages/core/tests/s1-admin-override/admin-override.test.ts`; the authoritative
RPC behavior in `supabase/tests/s1-admin-override.sql`. Seed is **Quad-only** — the
Harnwell-training + cross-house rejections are pgTAP-only.

| testid                                                   | Meaning                                                                                            |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `override-section`                                       | The override section in the shift detail panel (replaces the read-only notice; sm/hm/bm of house). |
| `override-worker-select`                                 | The worker-picker (block-house roster; `<select>` with worker names as option labels).             |
| `override-scope-week` / `override-scope-permanent`       | The This-week / Permanent scope toggle (checkable controls).                                       |
| `override-submit`                                        | Assign / reassign the chosen worker.                                                               |
| `override-remove`                                        | Remove the worker from an occupied seat.                                                           |
| `override-advisory-confirm` / `override-advisory-accept` | The advisory-confirm modal (cannot / opted-out / over-soft-cap / over-target) + its accept.        |
| `override-success`                                       | Post-write confirmation.                                                                           |

A card's detail panel is opened by clicking the card (`role=dialog` named "Shift
detail"); cards are selected by their visible text — a worker's name for an occupied
seat, or "Open shift" for a vacant/gap card (no new per-card testid is required).

**S1 seed contract.** The live calendar renders cards only from **published** Quad
blocks that have `shift_block_assignments` rows. The S1 seed must therefore publish
a Quad week — Monday **`SEED.overrideWeek` (2026-06-08)** — holding at minimum:

- a **vacant** Quad seat (renders an "Open shift" card) → assign / scope / advisory targets;
- an **occupied** Quad seat staffed by **`SEED.overrideIncumbent` (Cara Quad)** → reassign / remove targets.

`SEED.overrideAdvisoryWorker` (**Fred Quad**, opted-out) triggers the advisory-confirm
modal when assigned. Reuses the phase-13b Quad actors (`hmQuad`/`smQuad` authorized,
`alice` an SW who cannot reach the manager calendar). Re-seed (`supabase db reset`)
between runs.

## S4 — Fire a worker (web-remediation, audit #4) — route `/admin/people`

`fire-worker.spec.ts` is **TDD-first / RED**: the People roster still renders a
**disabled** Fire button (`title="Fire a worker — no backing RPC in this build
(flagged)"`) under a "Read-only roster in this build" notice, so each flow fails at
its first missing `people-fire-*` / `fire-confirm*` selector. An HM/BM may **fire** a
worker from the roster — one transactional action that vacates every shift, voids
floats, deactivates the account, and escalates any mid-shift gap (§4.5). Behavioral
source: `BEHAVIORAL_SPECIFICATION.md` §4.5 (firing) + §2.3/§2.6 (people-admin is
HM/BM-only). Pinned decisions + the full contract:
`docs/web-remediation/sessions/S4/TEST_PLAN.md` (PIN 4 = the modal testids). The pure
planner is unit-pinned in `packages/core/tests/firing/fire-planner.test.ts`; the
authoritative RPC behavior **and all the seat/float/swap unwinding** is in
`supabase/tests/s4-fire-worker.sql`. The e2e asserts only the **modal + Active→Inactive**
transition (the harness can't run the float-lookup algorithm and the page shows no
seat detail) — the thorough unwinding is pgTAP-only, like S2.

| testid                 | Meaning                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `people-fire-<userId>` | The per-row **Fire** button. Rendered **enabled only for `is_active` rows**; absent/disabled on already-inactive rows.                                  |
| `fire-confirm`         | The destructive confirm modal (`role=dialog`). Body copy: "vacates all shifts, voids floats, deactivates account; mid-shift gaps escalate immediately." |
| `fire-confirm-accept`  | Execute the firing.                                                                                                                                     |
| `fire-confirm-cancel`  | Dismiss without firing (nothing changes).                                                                                                               |
| `fire-success`         | Post-fire confirmation toast/notice.                                                                                                                    |

After a successful fire the worker's **Status** cell flips to the existing `Inactive`
tag and the row's Fire button disappears (no re-fire). The "Read-only roster in this
build" `Notification` and the disabled-button `title` are removed/replaced. **Hire
stays disabled — that is S5; do not touch the Hire button.** A non-HM/BM (an SM or
SW) hits the existing `people-unauthorized` gate and never sees a Fire control.

**S4 seed contract.** The Lead adds **`SEED.fireable` (Gabe Quad,
`gabe.quad@pennhousing.test`)** — a dedicated **active Quad SW**, uuid
**`a0000000-0000-4000-8000-00000000000c`** (…000b is the project administrator),
`home_house='quad'`, role `sw`,
`is_active=true`. Intentionally **obligation-free** (no shifts/floats/swaps) so the
fire is a pure deactivate that always succeeds regardless of clock/period (date-robust;
avoids the now()-relative semester-boundary fragility). Authorized actor =
**`SEED.hmQuad`** (existing). Reuses `smQuad`/`alice` as the unauthorized actors.
Re-seed (`supabase db reset`) between runs.

## TB — Test backfill over already-built read screens (Track D / D11)

Unlike the TDD-red specs above, these four are **backfill**: the screens already
ship, so each spec is GREEN against the seeded app and guards the read surface +
authorization + selector contract against regression. All reuse the phase-13b
`SEED` actors and the now-relative S1 fixtures (`SEED.overrideWeek` = the next NY
Monday — the only Quad week with published blocks).

| File                         | Screen / route                             | Covers                                                                                                                                                                                                        |
| ---------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `live-calendar.spec.ts`      | Live calendar — `/calendar`                | The published-week grid (shift + "Open shift" cards, `In 1w` label, week nav); the `calendar-closed-day` selector is dormant on an open week; manager-gated.                                                  |
| `hours-report.spec.ts`       | Hours report — `/admin/hours`              | The decomposition columns (at-home / floated-out / cross-house-pickup), summary strip, the full home-housed roster; manager-gated (`hours-unauthorized`).                                                     |
| `coverage-permanent.spec.ts` | Coverage monitor — `/coverage`             | The board + both feed tabs; the Permanent-openings tab shows a `PermCard` **or** the honest "No permanent openings" empty state; manager-gated.                                                               |
| `config-health.spec.ts`      | Config + Health — `/admin/{config,health}` | Project-admin config value round-trip (edit → save → audit read-back → restore); `config-unauthorized` for an HM; `health-push-card` + four `health-not-configured-*` cards; `health-unauthorized` for an SM. |

Notes on the data dependencies (all deterministic against `seed.sql`):

- **Calendar** renders cards only on `?week=${SEED.overrideWeek}` (the current week
  is empty for Quad). No house closure is seeded anywhere, so the closed-day cell
  asserts the **negative** (absent on an open week); the populated closed path is
  covered by the mobile Maestro `calendar_closed_day` selector + pgTAP.
- **Config** logs in as `SEED.projectAdmin` (`admin@upenn.edu`), the
  `system_config.project_administrator_user_id`. It edits `no_ack_trigger_offset_minutes`
  and **restores** it so the suite leaves `system_config` pristine.
- **Health** authorizes on `isHouseAdmin` OR project-admin, so `hmQuad` passes and
  `smQuad` (an SM, neither) hits `health-unauthorized`.
