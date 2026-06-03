# e2e-lifecycle — STATUS ledger

Update this after every chunk (see `PLAN.md` §0). One row per chunk; paste the green-gate
result; record decisions/deviations. This is what a fresh session reads to know reality.

## Chunks

| Chunk                           | Status         | Green-gate result                                                                                                                                                                                                                                                                                                                                   | Session date | Notes / deviations                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **S0** Plan + appendix          | ✅ done        | `PLAN.md` + `STATUS.md` written; facts verified against migrations & generated types                                                                                                                                                                                                                                                                | 2026-06-03   | Corrected an explore mis-read: `supabase/tests/` has **27 pgTAP files** (not empty); Playwright green/red is **unresolved** — S1 settles it empirically.                                                                                                                                                                                                                       |
| **S1** Verify baseline          | ✅ done        | `scripts/verify-all.sh` runs to completion; 5 graded layers recorded. **L1 Static ✅ · L2 Vitest ✅ (25 files/561) · L3 Web build ✅ · L4 pgTAP ✅ now 27/27 (997 tests) — was 🔴 4 files/8 subtests at S1, since fixed · L5 Playwright ✅ (15/15)**. See "S1 results" below for per-failure triage + the fix.                                      | 2026-06-03   | Playwright **GREEN** (config/README "TDD-RED" headers are stale). pgTAP red = pre-existing seed contamination from 7439585 (not a regression); **since FIXED** — 4 pgTAP tests made seed-robust. Mobile L6–8 skipped (optional).                                                                                                                                               |
| **S2** Seed + allocator         | ✅ done        | `pnpm e2e:lifecycle:seed` seeds OK; `:seed:check` → **8/8 green**. Non-destructive proof `bash scripts/verify-all.sh` → **OVERALL PASS** (Static ✅ 8 · Vitest ✅ 25/561 · web build ✅ · **pgTAP ✅ 27/997** · Playwright ✅ 15/15).                                                                                                               | 2026-06-03   | 46 `e…` SWs across 13 houses + 4 admins (1 all-house BM builder, 3 HMs); 2912 blocks; 1376 scheduled / 2208 vacant (= 3584 seats); `published_at` flipped. Toolchain: `tsx`+`pg` at root; `tests/` not a workspace pkg. See "S2 results".                                                                                                                                      |
| **S3** Harness + happy path     | ✅ done        | `pnpm e2e:lifecycle` → **5 files / 16 tests green** (01-publish 4 · 02-claim 4 · 03-drop-temporary 3 · 04-drop-permanent 2 · 05-cross-house-pickup 3). Idempotent re-run → 16/16. Clean `db reset`+run → 16/16. Non-destructive: `verify-all` **OVERALL PASS** (Static·Vitest 25/561·web build·pgTAP 27/997·Playwright 15/15) + seed-check **8/8**. | 2026-06-03   | pg + per-test `BEGIN…ROLLBACK` isolation (re-runnable w/o reset). Confirmed `claim_open_shift(uuid,uuid,timestamptz)`. **Deviation:** added an all-house e… SM to `roster.ts` (scenario 4 needs an SM recipient). **Gotcha for S4:** seed skips already-published houses → a foreign Quad publish leaves Quad unallocated; globalSetup now guards this. See "S3 results".      |
| **S4** Float / ack / escalation | ✅ done        | `pnpm e2e:lifecycle` → **12 files / 34 tests green** (01–05 S3 + **06 4 · 07 2 · 08 2 · 09 2 · 10 2 · 11 1 · 12 5** = 18 new). Clean `db reset`+run → 34/34 (all houses allocated). Non-destructive: `verify-all` **OVERALL PASS** (Static·Vitest 25/561·web build·pgTAP 27/997·Playwright 15/15) + seed-check **8/8**.                             | 2026-06-03   | `float-lookup-bridge.ts` replicates `orchestrator-tick`'s snapshot→`findFloaters`→`process_float_lookup_assignment` via raw `pg`. No migrations / no edits to existing harness files. Traps confirmed: reminder type is `ack_reminder` (kind `float_ack_reminder`); no-ack dest = `temporary_drop` (NOT displaced — that's the force-trigger source branch). See "S4 results". |
| **S5** Swaps + reliability      | ⬜ not started | —                                                                                                                                                                                                                                                                                                                                                   | —            | dep: **S3** (S4 for float-swap). Scenarios 13–14 + no-takeback.                                                                                                                                                                                                                                                                                                                |

Legend: ⬜ not started · 🟡 in progress · ✅ done · 🔴 blocked

## Next action

**Start S5 (swaps + fault-tolerance / reliability).** S3 + S4 are done; S5 is the last unblocked
chunk (dep: S3; uses S4 float state for the float-swap case). Add `13-swaps.test.ts` (shift / float /
permanent swaps; expiry; `swap_acceptance_ineligibility_reason`) and `14-reliability.test.ts`
(no-takeback: a re-tick does NOT revoke a pending/ack'd float; idempotency: re-deliver / re-run a step
→ identical end state; DST: `generate_blocks_for_date('2026-03-08')` yields exactly 32 blocks/house
with EDT-anchored `block_start_at`). Exit gate: `pnpm e2e:lifecycle` passes **all** of `01`–`14`.

**Reuse the S3+S4 harness** (all in `tests/e2e-lifecycle/`):

- `client.ts` — `inTx(fn)` runs a test in `BEGIN…ROLLBACK` (pg superuser, isolated, re-runnable).
  `serviceClient()` + `asUser(email)` (supabase-js, on committed rows) are ready for RLS-visibility
  assertions if S5 needs them (a supabase-js call can't join an `inTx` tx).
- `helpers.ts` — `anchors(blockStartAt)` (DST-safe `{S, dayBefore, tMinus2h, tMinus20m, tMinus10m}`;
  compute any other offset in Postgres, never JS), `workerWithRun`, `scheduledRun`,
  `vacantAt`/`anyVacant`, `freeHomeWorker`, `getAssignment(s)`, `assignmentsForBlocks`,
  `permanentDropSeats`, `notificationsFor`, `effectiveCap`, `expectRpcErrorTx`, `expectAll`.
- `float-lookup-bridge.ts` (**new in S4**) — `planFloat(db, dest, gap)` snapshots DB → pure
  `findFloaters`; `applyPlan(db, plan, pNow)` writes via `process_float_lookup_assignment`;
  `setupAutomatedFloat(db, {dest, date, pNow?})` is the one-call "create a pending automated float"
  (pNow defaults to S−1 day so all 5 reminders are future) returning `{floatId, floater, gap, S,
source/destinationAssignmentIds}` — **use this to set up the float-swap case**. Also
  `manufactureFloatGap` (vacate a single-staff dest seat over a Quad-staffed ≥2 window),
  `consecutiveVacant` (Harnwell no-float gaps), `floatTimes(db, S)` (deadline + 5 reminder instants +
  no-ack threshold, all computed in Postgres).
- `roster.ts` — exports `WORKERS`, `BUILDER`, `HMS`, `SM`, `PROJECT_ADMIN_ID`, `PERIOD_ID`.
- `globalSetup.ts` — verifies stack + idempotent seed + asserts baseline (published, scheduled, **all
  houses allocated**).

Swap RPC sigs are in PLAN §2.3; swap **creation** is the `create-swap` Edge Function (POST) — replicate
its `swap_requests` INSERT in the harness (read `supabase/functions/create-swap/index.ts` +
`_shared/swap-http.ts`) rather than driving the Edge layer, mirroring how S4 bypassed `orchestrator-tick`.
DST week is the build week (2026-03-08 is the spring-forward).

**Gotcha S5 (and any chunk) must respect:** `pnpm e2e:lifecycle:seed` SKIPS already-published houses.
A foreign Quad publish (Playwright `schedule-builder`) leaves Quad unallocated → no float sources. The
canonical entry point is **`supabase db reset && pnpm e2e:lifecycle`** (clean reset → all 13 e… houses
allocated); `globalSetup` asserts every house is allocated and fails with this hint if not.

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

## S4 results — float / ack / escalation (2026-06-03)

Deliverables (all new under `tests/e2e-lifecycle/`): `float-lookup-bridge.ts` + scenario files
`06-float-automated` / `07-reminder-cadence` / `08-ack` / `09-no-ack` / `10-decline` /
`11-force-trigger` / `12-hmod-pin-vs-transfer`. **No migrations; no edits to any existing harness file**
(`client/helpers/roster/seed/globalSetup` untouched) — so the chunk is non-destructive by construction.

**Exit gate — `pnpm e2e:lifecycle` → 12 files / 34 tests green:**

| File                              | Tests | Covers                                                                                                                                                                                                                                                                                                         |
| --------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `06-float-automated.test.ts`      | 4     | §4-6: bridge picks a Quad floater → `process_float_lookup_assignment` sets dest `pending_float_in` / source `pending_float_out` / float `pending`+`automated` / `personal_shift`; **6a** Quad↛Harnwell (short-circuit, 0 assignments), **6b** single-staff never a source, **6c** over-cap worker still floats |
| `07-reminder-cadence.test.ts`     | 2     | §4-7: 5 `ack_reminder` rows at deadline−{6h,2h,1h,30m,5m} (deadline = S−10m); assigning at deadline−2h skips the 2 past-due offsets                                                                                                                                                                            |
| `08-ack.test.ts`                  | 2     | §4-8: `acknowledge_float` → dest `floated_in` / source `floated_out` / `acknowledged`; the float's reminders drop from `pending_notification_deliveries` (rows still stored); re-ack = `not_pending`                                                                                                           |
| `09-no-ack.test.ts`               | 2     | §4-9: `process_no_ack_float`(p_now=S−15m) → `voided` + exclusion `no_acknowledgment` + dest `vacant`/**`temporary_drop`** + source restored + `hmod_urgent` (reason `float_no_acknowledgment`); outside-lookahead = no-op                                                                                      |
| `10-decline.test.ts`              | 2     | §4-10: automated decline → source **restored** to `scheduled`; force-trigger decline w/ a filled source comp-gap → source `vacant`/**`displaced_decliner`**; both exclude `declined`                                                                                                                           |
| `11-force-trigger.test.ts`        | 1     | §4-11: `force_trigger_float` → `pending`+`force_triggered`+`force_triggered_by`; source comp gap materialised + **surfaces in `weekly_open_shifts_feed`**; `personal_shift` w/ `initiated_by`                                                                                                                  |
| `12-hmod-pin-vs-transfer.test.ts` | 5     | §4-12: HMOD chain HM→HMOD→project-admin (all 3 rungs exercised); **12a** project-admin terminal present + unset path RAISE WARNING (claimed, no recipient, no notif, no crash); transfer = lookup-finds-other                                                                                                  |

**Reliability proofs:** clean `supabase db reset` → `pnpm e2e:lifecycle` → **34/34** (globalSetup seeds
from scratch, all 13 houses allocated, 1376 scheduled). Re-run without reset → 34/34 (per-test
`BEGIN…ROLLBACK`). **Non-destructive proof:** `bash scripts/verify-all.sh` → **OVERALL PASS** (Static ✅ ·
Vitest ✅ 25/561 · web build ✅ · pgTAP ✅ 27/997 · Playwright ✅ 15/15) + `e2e:lifecycle:seed:check` → **8/8**.

Design notes / decisions:

- **The bridge replicates `orchestrator-tick`, not the Edge Function.** `float-lookup-bridge.ts`
  re-implements `buildFloatLookupSnapshot` in raw `pg` SQL (window + profile via Postgres, source
  rosters from `float_routing`, conflict flags, exclusions), then imports the **pure** `findFloaters`
  from `packages/core/src/float-lookup/index.js` (the `.js`→`.ts` Vite resolution the green phase-06
  Vitest already relies on) and writes each assignment with `process_float_lookup_assignment` — so a
  scenario drives the exact decision the orchestrator makes, deterministically, in-tx, with injected
  `p_now`. The bridge picks the same Quad floater the algorithm would; tests assert on the algorithm
  output + the RPC's writes.
- **Gap manufacturing is deterministic.** Quad is staffed at 3 across the morning templates every
  build-week day (96 build-week blocks have ≥2 Quad), so `manufactureFloatGap` reliably finds a
  Quad-staffed ≥2 window and vacates one single-staff destination seat to form a 2-block gap. Harnwell
  no-float gaps use `consecutiveVacant`.
- **PLAN §2.4/§2.5 trap confirmed:** the reminder **notification type is `ack_reminder`**; the string
  `float_ack_reminder` is the payload `kind`, not the enum. Asserted on type + `payload->>'kind'`.
- **PLAN §4 wording corrected against the code (§2.6 #8):** scenario 9 says dest →
  "displaced_decliner", but `process_no_ack_float` sets the **destination** to `vacant`/`temporary_drop`;
  `displaced_decliner` is the force-trigger **source** branch (when the materialised comp gap was
  filled). The decline restore-vs-displace split (scenario 10) is likewise: the **automated** path
  always restores the source to `scheduled`; `displaced_decliner` only arises on the force-trigger path
  with a filled comp seat. Both arms tested.
- **HMOD recipient chain exercised in full.** `is_hm_working_time` = Mon–Fri 08:00–16:59 NY. HM rung:
  Harnwell (single HM `e.hm.harnwell`) at a working-hours block + working `p_now`. HMOD rung: insert one
  `hmod_rotor` row whose `week_start_date` is computed with the resolver's **own** formula (so it matches
  any chosen instant) → `resolve_hmod_on_duty` returns `e.hm.quad` at an evening `p_now`. Project-admin
  rung: evening `p_now`, no rotor → terminal `a…000b`. Unset: `DELETE` the config → `RAISE WARNING`,
  `claimed:true`, recipient NULL, **no** `hmod_urgent`, no crash. The empty `hmod_rotor` + no-HM
  single-staff houses make the project-admin fall-through the default for single-staff destinations.
- **6c (cap not checked):** loaded the chosen floater well past the 20h soft cap via direct claims on
  later build-week days (window stays clean) → still selected by the lookup AND assigned by the RPC.

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
- 2026-06-03 (S4) — **Bridge replicates `orchestrator-tick`, not the Edge Function.**
  `float-lookup-bridge.ts` snapshots DB state in raw `pg` SQL (mirroring `buildFloatLookupSnapshot`),
  imports the pure `findFloaters` from `packages/core` (the `.js`→`.ts` Vite resolution phase-06 Vitest
  uses), and writes via `process_float_lookup_assignment` — same decision the deployed orchestrator
  makes, but deterministic + in-tx + injected `p_now` (PLAN §2.5). No migration changes.
- 2026-06-03 (S4) — **Reminder type = `ack_reminder`** (payload `kind = float_ack_reminder`); PLAN
  §2.4/§2.5's "float_ack_reminder" is the kind, not the enum. Verified against the live enum before
  asserting.
- 2026-06-03 (S4) — **Trusted the code over the PLAN §4 labels (§2.6 #8).** No-ack sets the
  **destination** to `temporary_drop` (not displaced_decliner); `displaced_decliner` is the
  force-trigger **source** branch when its materialised comp gap is filled. Decline: automated path
  always restores the source to `scheduled`; displaced arises only on the force-trigger path.
- 2026-06-03 (S4) — **HMOD chain made deterministic.** `hmod_rotor` is empty in the seed (so
  `resolve_hmod_on_duty` → NULL → project-admin terminal `a…000b` for single-staff/evening cases). The
  HMOD rung is exercised by inserting ONE rotor row whose `week_start_date` is computed with the
  resolver's own formula, so it matches any chosen `p_now`. Harnwell has exactly one HM → the HM rung is
  unambiguous. All four outcomes (HM / HMOD / project-admin / unset-warning) asserted.

## Blockers

_(none.)_ The pgTAP seed contamination recorded at S1 has been **fixed** (see "S1 results → pgTAP" →
✅ RESOLVED); the full local suite is green — `supabase test db` 27/27 (997 tests), Playwright 15/15.
