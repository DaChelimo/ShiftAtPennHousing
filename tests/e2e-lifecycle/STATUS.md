# e2e-lifecycle — STATUS ledger

Update this after every chunk (see `PLAN.md` §0). One row per chunk; paste the green-gate
result; record decisions/deviations. This is what a fresh session reads to know reality.

## Chunks

| Chunk                           | Status         | Green-gate result                                                                                                                                                                                                                                                                                                                                   | Session date | Notes / deviations                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S0** Plan + appendix          | ✅ done        | `PLAN.md` + `STATUS.md` written; facts verified against migrations & generated types                                                                                                                                                                                                                                                                | 2026-06-03   | Corrected an explore mis-read: `supabase/tests/` has **27 pgTAP files** (not empty); Playwright green/red is **unresolved** — S1 settles it empirically.                                                                                                                                                                                                                  |
| **S1** Verify baseline          | ✅ done        | `scripts/verify-all.sh` runs to completion; 5 graded layers recorded. **L1 Static ✅ · L2 Vitest ✅ (25 files/561) · L3 Web build ✅ · L4 pgTAP ✅ now 27/27 (997 tests) — was 🔴 4 files/8 subtests at S1, since fixed · L5 Playwright ✅ (15/15)**. See "S1 results" below for per-failure triage + the fix.                                      | 2026-06-03   | Playwright **GREEN** (config/README "TDD-RED" headers are stale). pgTAP red = pre-existing seed contamination from 7439585 (not a regression); **since FIXED** — 4 pgTAP tests made seed-robust. Mobile L6–8 skipped (optional).                                                                                                                                          |
| **S2** Seed + allocator         | ✅ done        | `pnpm e2e:lifecycle:seed` seeds OK; `:seed:check` → **8/8 green**. Non-destructive proof `bash scripts/verify-all.sh` → **OVERALL PASS** (Static ✅ 8 · Vitest ✅ 25/561 · web build ✅ · **pgTAP ✅ 27/997** · Playwright ✅ 15/15).                                                                                                               | 2026-06-03   | 46 `e…` SWs across 13 houses + 4 admins (1 all-house BM builder, 3 HMs); 2912 blocks; 1376 scheduled / 2208 vacant (= 3584 seats); `published_at` flipped. Toolchain: `tsx`+`pg` at root; `tests/` not a workspace pkg. See "S2 results".                                                                                                                                 |
| **S3** Harness + happy path     | ✅ done        | `pnpm e2e:lifecycle` → **5 files / 16 tests green** (01-publish 4 · 02-claim 4 · 03-drop-temporary 3 · 04-drop-permanent 2 · 05-cross-house-pickup 3). Idempotent re-run → 16/16. Clean `db reset`+run → 16/16. Non-destructive: `verify-all` **OVERALL PASS** (Static·Vitest 25/561·web build·pgTAP 27/997·Playwright 15/15) + seed-check **8/8**. | 2026-06-03   | pg + per-test `BEGIN…ROLLBACK` isolation (re-runnable w/o reset). Confirmed `claim_open_shift(uuid,uuid,timestamptz)`. **Deviation:** added an all-house e… SM to `roster.ts` (scenario 4 needs an SM recipient). **Gotcha for S4:** seed skips already-published houses → a foreign Quad publish leaves Quad unallocated; globalSetup now guards this. See "S3 results". |
| **S4** Float / ack / escalation | ⬜ not started | —                                                                                                                                                                                                                                                                                                                                                   | —            | dep: **S3**. Scenarios 6–12 + invariants.                                                                                                                                                                                                                                                                                                                                 |
| **S5** Swaps + reliability      | ⬜ not started | —                                                                                                                                                                                                                                                                                                                                                   | —            | dep: **S3** (S4 for float-swap). Scenarios 13–14 + no-takeback.                                                                                                                                                                                                                                                                                                           |

Legend: ⬜ not started · 🟡 in progress · ✅ done · 🔴 blocked

## Next action

**Start S4 (float / reminders / ack-no-ack-decline / force-trigger / HMOD).** S3 is done; S4 is the
next unblocked chunk (dep: S3). Add scenario files `06-float-automated`…`12-hmod-pin-vs-transfer`
to the **existing** harness and a `float-lookup-bridge.ts` that snapshots DB state into the
`packages/core` float-lookup input (model after `supabase/functions/orchestrator-tick/index.ts`).
Exit gate: `pnpm e2e:lifecycle` passes `01`–`12`.

**Reuse the S3 harness** (all in `tests/e2e-lifecycle/`):

- `client.ts` — `inTx(fn)` runs a test in `BEGIN…ROLLBACK` (pg superuser, isolated, re-runnable).
  `serviceClient()` + `asUser(email)` (supabase-js) are ready & smoke-tested — use them for S4's
  **RLS-visibility** assertions ("destination SM sees inbound floats", PLAN §2.6 #7). A supabase-js
  call can't join an `inTx` tx → visibility tests operate on committed rows (own setup/teardown).
- `helpers.ts` — `anchors(blockStartAt)` gives DST-safe `{S, dayBefore, tMinus2h, tMinus20m,
tMinus10m}` (compute any other offset in Postgres, never JS); `workerWithRun`, `scheduledRun`,
  `vacantAt`/`anyVacant`, `freeHomeWorker`, `getAssignment(s)`, `permanentDropSeats`,
  `assignmentsForBlocks`, `notificationsFor`, `effectiveCap`, `expectRpcErrorTx` (savepoint-based:
  asserts a raised RPC AND keeps the tx usable for non-mutation checks), `expectAll`.
- `roster.ts` — now also exports `SM` (one e… Site Manager scoped to **all 13 houses**,
  `e.sm@pennhousing.test`). For per-house SM scoping tests, add a house-scoped SM if needed.
- `globalSetup.ts` — verifies stack + runs the idempotent seed + asserts the baseline (published,
  scheduled, **all houses allocated**).

S4 timeline math is in PLAN §2.5 (anchor on a destination float block start S). Quad→single-staff
float routing is live; **Quad must be allocated** — globalSetup now fails loudly if any house is
unallocated (see the gotcha below). Float RPC sigs are in PLAN §2.3 (authoritative migrations
flagged). pgTAP is fully green (27/997); Playwright 15/15 — "still passes" means all-green.

**Gotcha S4 (and any chunk) must respect:** `pnpm e2e:lifecycle:seed` SKIPS already-published
houses (idempotent re-run guard). If a `schedule-builder` Playwright run published **Quad** on the
shared local DB, the seed skips Quad → Quad is unallocated → no float sources for S4. The canonical
entry point is **`supabase db reset && pnpm e2e:lifecycle`** (a clean reset → all 13 e… houses
allocated). `globalSetup` now asserts every house is allocated and fails with this hint if not.

Each new session: follow `PLAN.md` §0, do exactly one chunk, verify its exit gate, update this
ledger, stop.

## S2 results — realistic seed + allocator (2026-06-03)

Deliverables: `tests/e2e-lifecycle/{env,roster,allocate,seed}.ts` + `checks/seed-check.ts` +
`README.md`; root scripts `e2e:lifecycle:seed` / `e2e:lifecycle:seed:check`; root devDeps
`tsx`+`pg`+`@types/pg`. The seed talks to Postgres **directly as the `postgres` superuser** via
`DB_URL` (`pg`) — writes `auth.*` like `seed.sql`, calls the SECURITY DEFINER RPCs, triggers still
fire. One transaction, idempotent (`e…` namespace + `ON CONFLICT DO NOTHING`; publish guarded by
`period_house_publications`). Re-running with no reset is a clean no-op (+0 blocks, 0 drafts, 13
already published).

Environment produced (deterministic — same numbers every run):

| Quantity               | Value                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `e…` SW workers        | **46** (Harnwell 5, Quad 8, each single-staff 3) across **all 13** houses                                       |
| Admins                 | 4 — 1 BM `e.builder@` (holds `(bm, house)` for all 13 → authorized everywhere) + 3 HMs (harnwell/quad/house-03) |
| Build week             | Mon **2026-03-02** … Sun **2026-03-08** (period `c0000000-…-000000000001`)                                      |
| Blocks generated       | **2912** (13 houses × 32 × 7) via `generate_blocks_for_range`                                                   |
| Preferences            | 3268 non-`available` rows (archetype model; `available` left implicit)                                          |
| Drafts → published     | 1376 → **1376 scheduled / 2208 vacant** (= 3584 = Σ headcount·32·7)                                             |
| `published_at`         | flipped (all 13 houses published) — satisfies S3 scenario 1                                                     |
| Worker-days / max load | 172 worker-days, all single 8-block runs; max **32 blocks = 16h** (< 20h cap)                                   |

Allocator: 4 × 4h shift templates (T1 08–12, T2 12–16, T3 16–20, T4 20–24); per (house, day,
template) assign up to `required_headcount` eligible home workers (non-`cannot` across the whole
template, ≤4 shifts/wk, one shift/day). This makes the seed-check invariants hold by construction:
contiguous ≥4-block runs, no over-assignment (publish would reject), never a `cannot`, under the cap.
`house-12`/`house-13` are deliberately thinned (max 2 shifts) but the structural understaffing
(houses open 112h/wk, workers ≤16h) already leaves abundant vacancies for float/escalation material.

Seed-check (exit gate) — `pnpm e2e:lifecycle:seed:check` → **8/8 ✅**: ≥46 workers/13 houses · every
house covered · published scheduled exist · `published_at` set · **0 cannot-violations** · all daily
runs ≥4 blocks · vacancies remain · no worker > 20h.

Side effects (documented in `README.md`): publishing `quad` also gives the seeded **2026-02-02**
fixture blocks their vacant seats (per-house publish loops all in-period blocks) — inert (harness
uses the 2026-03-02…08 week) and wiped by `db reset`, never reaching the phase-13b suites (which
always run post-reset). The verify-all non-destructive proof resets before pgTAP + Playwright, so the
`e…` seed is absent there — proving the new files/scripts/devDeps don't perturb the existing suites.

## S3 results — harness scaffold + happy path (2026-06-03)

Deliverables (all under `tests/e2e-lifecycle/`): `client.ts`, `helpers.ts`, `globalSetup.ts`,
`vitest.config.ts`, scenario files `01-publish` / `02-claim` / `03-drop-temporary` /
`04-drop-permanent` / `05-cross-house-pickup`; root script `pnpm e2e:lifecycle`; root devDeps
`vitest@^1.6.0` + `@supabase/supabase-js@^2.106.2`. Modified S2 files: `roster.ts` (+`SM`),
`env.ts` (+`anonKey`), `seed.ts` (admin log counts by role).

**Exit gate — `pnpm e2e:lifecycle` → 5 files / 16 tests green:**

| File                            | Tests | Covers                                                                                                                                                                          |
| ------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-publish.test.ts`            | 4     | §4-1: published_at + 13 publications; drafts→scheduled (consumed); seats partition 3584=Σ headcount; re-publish guard raises                                                    |
| `02-claim.test.ts`              | 4     | §4-2: same-house claim flips vacant→claimed; soft cap allows >20h claims; **5a** claim of Harnwell by non-Harnwell raises `cross_house_ineligible` (+ control)                  |
| `03-drop-temporary.test.ts`     | 3     | §4-3: advance drop = no flags; short-notice single-staff drop = short_notice + direct_hmod; unowned drop raises                                                                 |
| `04-drop-permanent.test.ts`     | 2     | §4-4: `permanent_drop_slot` → permanent_drop + semester_end + 1 `sm_permanent_drop_alert`; operator drop → `sw_permanent_removal_alert`                                         |
| `05-cross-house-pickup.test.ts` | 3     | §4-5: cross-house `permanent_pickup_slot` claims+flags assigned, skipped→temporary_drop; **5a** Harnwell pickup by non-Harnwell raises `harnwell_training_required` (+ control) |

**Reliability proofs:** re-run with no reset → 16/16 (per-test `BEGIN…ROLLBACK` leaves the baseline
pristine); clean `supabase db reset` → `pnpm e2e:lifecycle` → 16/16 (globalSetup seeds from scratch,
all 13 houses allocated, 1376 scheduled). **Non-destructive proof:** `bash scripts/verify-all.sh` →
**OVERALL PASS** (Static ✅ · Vitest ✅ 25/561 · web build ✅ · pgTAP ✅ 27/997 · Playwright ✅
15/15) and `pnpm e2e:lifecycle:seed:check` → **8/8**.

Design notes / deviations:

- **Isolation = pg + per-test transaction rollback** (not `db reset` per run). `inTx(fn)` opens a
  connection, `BEGIN`, runs the test, always `ROLLBACK`. Only the seed commits; tests never do — so
  the published baseline is shared, order-independent, and re-runnable. supabase-js `serviceClient`
  / `asUser` are built + smoke-tested but **unused by S3** (no RLS-visibility assertion until S4);
  scenarios assert via the pg superuser.
- **Roster gained an all-house `SM`** (`e.sm@…`, 13 `(sm,house)` rows). S2's roster was HM/BM only;
  scenario 4's `sm_permanent_drop_alert` needs an SM recipient, and the only seeded SM (`a…`
  `sm.quad`) is a read-only phase-13b fixture. SM-notification scenarios use **non-quad** houses so
  the e… SM is the sole recipient. seed-check stays 8/8 (SM isn't counted as a worker).
- **Confirmed RPC sigs (live):** `claim_open_shift(uuid,uuid,timestamptz)`; `drop_shift` returns
  `(dropped_assignment_ids, short_notice_warning, direct_hmod_notification)`;
  `permanent_drop_slot(...uuid)` returns `{affected_count, semester_end_date}`;
  `permanent_pickup_slot(uuid,uuid[],uuid[])` returns `{assigned_count, skipped_count}`. Period
  end_date is **2026-05-01** (read dynamically; not hard-coded).
- **Harnwell = headcount 2** bit the first 05 draft: `permanent_drop` vacates only the dropper's
  seat, leaving the co-worker's seat scheduled on the same block. Multi-staff assertions must target
  the specific dropped seats (`permanentDropSeats` helper), not all seats on the block.
- **Quad-skip trap (flagged for S4):** the seed skips already-published houses; a foreign Quad
  publish (Playwright `schedule-builder`) leaves Quad unallocated. Invisible to S3, fatal to S4
  (Quad is the float source). `globalSetup` now asserts every house is allocated and fails with
  `supabase db reset && pnpm e2e:lifecycle:seed` guidance.

## S1 results — verification baseline (2026-06-03)

Command: `bash scripts/verify-all.sh` (graded layers 1–5; mobile 6–8 skipped). The script resets the
**local** DB before each DB layer for determinism, then runs each layer to completion, records
pass/fail, and exits non-zero iff a graded layer failed. Re-runnable / CI-able. Per-layer logs land
in a `mktemp` dir printed at the end.

| #   | Layer                      | Command                                 | Result                                                                               |
| --- | -------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | Static (lint + type-check) | `pnpm turbo run lint type-check`        | ✅ **PASS** — 8 turbo tasks                                                          |
| 2   | TS logic (Vitest)          | `pnpm --filter @shift/core test`        | ✅ **PASS** — **25 files, 561 tests**                                                |
| 3   | Web build                  | `pnpm --filter @shift/web build`        | ✅ **PASS** — `next build` clean (9 routes)                                          |
| 4   | DB logic (pgTAP)           | `supabase test db`                      | 🔴 at S1: Files=27, 916; **4 files/8 subtests** → ✅ **fixed same day → 27/27, 997** |
| 5   | Web E2E (Playwright)       | `pnpm --filter @shift/web e2e`          | ✅ **PASS** — **15/15** (25.2s)                                                      |
| 6   | Mobile shared unit (JVM)   | `./gradlew :shared:testAndroidHostTest` | ⚪ **SKIP** — optional; `RUN_MOBILE=1` to run                                        |
| 7   | Mobile Android build       | `./gradlew :androidApp:assembleDebug`   | ⚪ **SKIP** — optional; `RUN_MOBILE=1` to run                                        |
| 8   | Mobile iOS link / Maestro  | `:shared:linkDebug…` / `maestro test`   | ⚪ **SKIP** — manual only (Xcode / emulator)                                         |

**Overall at S1: FAIL** (layer 4 only; the S1 exit gate is _accurate recording_, not green-everywhere —
met). **pgTAP has since been fixed → the full suite is now green** (see **✅ RESOLVED** below).

### Resolved PLAN open questions

- **Playwright "green vs TDD-red" → GREEN.** All 15 specs pass against the seeded local stack
  (`cap-modification` ×4, `hm-leave` ×3, `schedule-builder` ×8). The "TDD-first / RED" headers in
  `apps/web/playwright.config.ts` and `apps/web/e2e/README.md` are **stale doc** — the UIs landed
  (commits 0cc1e98 / 7439585 / c9acf21). PLAN/memory said "11 Playwright"; it is now **15**
  (`cap-modification.spec.ts` added 4).
- **Vitest phase-14 "TDD-red" → GREEN.** `tests/phase-14/cap-modification.test.ts` (24 tests) passes;
  the impl landed in c9acf21. The "TDD-red" memory note for phase-14 is stale.
- **`supabase test db` does NOT reset/seed.** `--help` confirms it runs pg*prove against the
  \_existing* local DB. §2.1's "yes (resets)" annotation is inaccurate — the seed pgTAP sees comes
  from the preceding `supabase db reset`. The verify script makes this deterministic (reset → test).

### pgTAP failures — triage (all ONE root cause; NOT product regressions, NOT TDD-red)

Root cause: **commit 7439585 expanded `supabase/seed.sql`** with the phase-13b E2E fixtures (Spring-2026
period @ `seed.sql:338`, admin `project_administrator_user_id` @ `seed.sql:393`, four 2026-02-02 Quad
blocks, 11 users/roles). Those rows are **required by the now-green Playwright suite**, but they
**contaminate 4 older pgTAP tests** that assume a clean config-only seed. 7439585 only re-verified
Vitest + Playwright, so this slipped in undetected. The product code is fine; the _new_
`phase-13b-leave-submit-and-return.sql` pgTAP test passes.

| File                               | Fails               | Why (seed collision)                                                                                                                                                                                                            |
| ---------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `phase-03-calendar-generation.sql` | 2/59 (t5, t11)      | Seed pre-inserts 4 Quad 2026-02-02 blocks → `generate_blocks_for_date` `ON CONFLICT DO NOTHING` skips them → 84/28 rows vs the test's clean-slate 96/32.                                                                        |
| `phase-04-preferences.sql`         | 0/79 (aborted)      | Test inserts period `[2026-01-15,2026-05-16)` which overlaps the **seeded** Spring-2026 period `[2026-01-12,2026-05-02)`; `scheduling_periods_no_overlap` raises in setup → "Bad plan".                                         |
| `phase-07-admin-terminal.sql`      | 2/4 (t1–2, aborted) | Test asserts the **"terminal UNSET"** path, but seed sets `project_administrator_user_id`; its own INSERT also duplicates the seeded `system_config_pkey`. (AGENTS §2.6 "seed does not set it" is no longer true on this tree.) |
| `phase-07-hmod-notify-rpc.sql`     | 1/12 (t4)           | `resolve_hm_for_house` returns a **seeded** HM/admin (`a0000000-…-000a`) instead of the test's fixture HM (`e000050a-…-0001`).                                                                                                  |

**✅ RESOLVED (2026-06-03, user-requested follow-up to S1).** All 4 tests made **seed-robust** — each
neutralizes the colliding seeded row(s) inside its own `BEGIN…ROLLBACK` transaction, so
`supabase/seed.sql`, migrations, and app code are **untouched** (only the 4 `supabase/tests/*.sql` files
changed). `supabase test db` is now **27/27 files / 997 tests green**, and Playwright stays **15/15**
(seed intact). The fixes:

- `phase-03-calendar-generation.sql` — before generating, reopen the seeded Spring-2026 period's
  `preference_deadline` (the submission-window trigger gates preference DELETEs — PLAN §2.6 #2) and clear
  the whole 2026-02-02 day (blocks + their seeded prefs), so `generate_blocks_for_date` builds a clean
  32-block day → 96/32 counts hold.
- `phase-04-preferences.sql` — move the test's "Closed Period" to `2026-06-01…2026-08-15` (a gap with no
  seeded period); only its already-passed deadline matters, so the dates are free to change.
- `phase-07-admin-terminal.sql` — `DELETE` the seeded `project_administrator_user_id` config so the
  terminal-UNSET path holds and the test's own terminal INSERT no longer duplicates the PK.
- `phase-07-hmod-notify-rpc.sql` — `DELETE` the seeded Ingrid `('hm','house-03')` role so
  `resolve_hm_for_house` (no `ORDER BY`) resolves the suite's own house-03 HM fixture.

## Decision log

- 2026-06-03 — Execution model: **plan-as-artifact + fresh session per chunk** (user choice).
- 2026-06-03 — Seed: **separate, non-destructive** (`e…` namespace; reuse config seed; never touch phase-13b `a/b/c/d…` rows or `supabase/seed.sql`).
- 2026-06-03 — Notifications verified **DB-observable only** (no Firebase / `dispatch-push`).
- 2026-06-03 (S1) — **Playwright is GREEN (15/15); Vitest GREEN (561); web build + static GREEN.** The
  "TDD-RED" comments in the Playwright config/README are stale and should not be trusted by later chunks.
- 2026-06-03 (S1) — **pgTAP baseline is 🔴 (4 files / 8 subtests)**, root-caused to the phase-13b seed
  expansion (7439585). Treated as a **known baseline**, not a blocker: S2+ gates compare against it
  rather than requiring all-green pgTAP. A separate task should make the 4 tests seed-robust.
- 2026-06-03 (S1) — Verify script **resets the local DB before each DB layer** (deterministic, CI-able);
  `supabase test db` itself does not reset/seed. Local DB only — never a remote URL.
- 2026-06-03 (post-S1, user-requested fix) — **pgTAP seed contamination RESOLVED.** The 4 failing tests
  were made seed-robust via transaction-local cleanup of the colliding seed rows (`seed.sql` untouched).
  `supabase test db` now **27/27 / 997 green**, Playwright still **15/15**. pgTAP is no longer a baseline
  caveat for S2+.
- 2026-06-03 (S2) — **Toolchain:** TS scripts run via `tsx`; the seed/allocator/checker connect to
  Postgres **directly as the `postgres` superuser** (`pg` + `DB_URL`), not supabase-js — needed to write
  `auth.*` and simplest for raw setup (RLS bypassed, triggers still fire). Root devDeps `tsx`+`pg`+
  `@types/pg`. `tests/` is **deliberately not a pnpm workspace package** (`pnpm-workspace.yaml` =
  `packages/*`,`apps/*`), so `turbo run lint/type-check/test` never sees these files. supabase-js +
  `asUser` is deferred to S3 (RLS-visibility scenarios only).
- 2026-06-03 (S2) — **Publish:** only `publish_schedule(uuid, uuid, text)` exists (per-house; the 1-/2-arg
  forms in PLAN §2.3 were dropped by `20260528000010`). One BM builder holds `(bm, house)` for all 13
  houses (user_roles PK allows it) ⇒ authorized `created_by` + publisher everywhere. Publishing all 13
  flips the period-wide `published_at` (desired — S3 scenario 1). Per-house publish loops **all** in-period
  blocks, so it also seats the seeded 2026-02-02 Quad fixture blocks — inert + reset-scoped, never reaches
  the phase-13b suites.
- 2026-06-03 (S2) — **Allocator:** fixed 4×4h shift templates rather than free-form window search, so the
  seed-check invariants (contiguity ≥4, no over-assignment, never-`cannot`, under-cap) hold **by
  construction**. Deterministic; archetypes from `index % 5`; `house-12/13` deliberately thinned.
- 2026-06-03 (S3) — **Isolation = pg + per-test `BEGIN…ROLLBACK`** (not reset-per-run). Tests share the
  committed published baseline and roll back their own mutations → order-independent, re-runnable, no
  destructive reset. supabase-js `serviceClient`/`asUser` built for S4's RLS-visibility tests (a
  supabase-js call can't join the pg tx, so those use committed rows). Harness runs serially in one
  fork (shared stateful DB).
- 2026-06-03 (S3) — **Extended the shared roster with an all-house e… `SM`** (non-destructive, e…
  namespace) for scenario 4's `sm_permanent_drop_alert` recipient; the only seeded SM (`a…` `sm.quad`)
  is a read-only phase-13b fixture. SM-notification scenarios use non-quad houses. seed-check unaffected
  (8/8).
- 2026-06-03 (S3) — **globalSetup applies the seed (not a reset)** per the PLAN brief, then asserts the
  baseline INCLUDING "every house allocated" — catching the seed's skip-already-published-house guard
  colliding with a foreign Quad publish (which would silently starve S4 of float sources). Canonical
  entry point documented as `supabase db reset && pnpm e2e:lifecycle`.

## Blockers

_(none.)_ The pgTAP seed contamination recorded at S1 has been **fixed** (see "S1 results → pgTAP" →
✅ RESOLVED); the full local suite is green — `supabase test db` 27/27 (997 tests), Playwright 15/15.
