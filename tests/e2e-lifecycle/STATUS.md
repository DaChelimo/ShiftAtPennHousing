# e2e-lifecycle — STATUS ledger

Update this after every chunk (see `PLAN.md` §0). One row per chunk; paste the green-gate
result; record decisions/deviations. This is what a fresh session reads to know reality.

## Chunks

| Chunk                           | Status         | Green-gate result                                                                                                                                                                                                                                             | Session date | Notes / deviations                                                                                                                                                                       |
| ------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S0** Plan + appendix          | ✅ done        | `PLAN.md` + `STATUS.md` written; facts verified against migrations & generated types                                                                                                                                                                          | 2026-06-03   | Corrected an explore mis-read: `supabase/tests/` has **27 pgTAP files** (not empty); Playwright green/red is **unresolved** — S1 settles it empirically.                                 |
| **S1** Verify baseline          | ✅ done        | `scripts/verify-all.sh` runs to completion; 5 graded layers recorded. **L1 Static ✅ · L2 Vitest ✅ (25 files/561) · L3 Web build ✅ · L4 pgTAP 🔴 (4 files / 8 of 916 subtests) · L5 Playwright ✅ (15/15)**. See "S1 results" below for per-failure triage. | 2026-06-03   | Playwright **GREEN** (config/README "TDD-RED" headers are stale). pgTAP red = **pre-existing seed contamination from commit 7439585**, not a regression. Mobile L6–8 skipped (optional). |
| **S2** Seed + allocator         | ⬜ not started | —                                                                                                                                                                                                                                                             | —            | dep: none beyond config seed. Build week **2026-03-02…03-08**; reuse period `c000…0001`; `e…` UUIDs only. **Read the S1 pgTAP note before defining "still pass".**                       |
| **S3** Harness + happy path     | ⬜ not started | —                                                                                                                                                                                                                                                             | —            | dep: **S2**. Scenarios 1–5 + 5a. Confirm `claim_open_shift` sig.                                                                                                                         |
| **S4** Float / ack / escalation | ⬜ not started | —                                                                                                                                                                                                                                                             | —            | dep: **S3**. Scenarios 6–12 + invariants.                                                                                                                                                |
| **S5** Swaps + reliability      | ⬜ not started | —                                                                                                                                                                                                                                                             | —            | dep: **S3** (S4 for float-swap). Scenarios 13–14 + no-takeback.                                                                                                                          |

Legend: ⬜ not started · 🟡 in progress · ✅ done · 🔴 blocked

## Next action

**Start S2 (seed + allocator).** S1 is complete; S2 is the only unblocked chunk (S3–S5 depend on
S2/S3). Before writing S2's exit gate, read **"S1 results → pgTAP"** below: `supabase test db` is
**already 🔴 on this tree** (4 seed-contaminated files), so S2's "`supabase test db` still passes"
must be read as **"no NEW pgTAP failures beyond the S1 baseline of those 4 files"** — do not try to
turn them green inside S2, and do not be alarmed by them.

Each new session: follow `PLAN.md` §0, do exactly one chunk, verify its exit gate, update this
ledger, stop.

## S1 results — verification baseline (2026-06-03)

Command: `bash scripts/verify-all.sh` (graded layers 1–5; mobile 6–8 skipped). The script resets the
**local** DB before each DB layer for determinism, then runs each layer to completion, records
pass/fail, and exits non-zero iff a graded layer failed. Re-runnable / CI-able. Per-layer logs land
in a `mktemp` dir printed at the end.

| #   | Layer                      | Command                                 | Result                                                           |
| --- | -------------------------- | --------------------------------------- | ---------------------------------------------------------------- |
| 1   | Static (lint + type-check) | `pnpm turbo run lint type-check`        | ✅ **PASS** — 8 turbo tasks                                      |
| 2   | TS logic (Vitest)          | `pnpm --filter @shift/core test`        | ✅ **PASS** — **25 files, 561 tests**                            |
| 3   | Web build                  | `pnpm --filter @shift/web build`        | ✅ **PASS** — `next build` clean (9 routes)                      |
| 4   | DB logic (pgTAP)           | `supabase test db`                      | 🔴 **FAIL** — Files=27, Tests=916; **4 files / 8 subtests fail** |
| 5   | Web E2E (Playwright)       | `pnpm --filter @shift/web e2e`          | ✅ **PASS** — **15/15** (25.2s)                                  |
| 6   | Mobile shared unit (JVM)   | `./gradlew :shared:testAndroidHostTest` | ⚪ **SKIP** — optional; `RUN_MOBILE=1` to run                    |
| 7   | Mobile Android build       | `./gradlew :androidApp:assembleDebug`   | ⚪ **SKIP** — optional; `RUN_MOBILE=1` to run                    |
| 8   | Mobile iOS link / Maestro  | `:shared:linkDebug…` / `maestro test`   | ⚪ **SKIP** — manual only (Xcode / emulator)                     |

**Overall: FAIL** (layer 4 only). The S1 exit gate is _accurate recording_, not green-everywhere — met.

### Resolved PLAN open questions

- **Playwright "green vs TDD-red" → GREEN.** All 15 specs pass against the seeded local stack
  (`cap-modification` ×4, `hm-leave` ×3, `schedule-builder` ×8). The "TDD-first / RED" headers in
  `apps/web/playwright.config.ts` and `apps/web/e2e/README.md` are **stale doc** — the UIs landed
  (commits 0cc1e98 / 7439585 / c9acf21). PLAN/memory said "11 Playwright"; it is now **15**
  (`cap-modification.spec.ts` added 4).
- **Vitest phase-14 "TDD-red" → GREEN.** `tests/phase-14/cap-modification.test.ts` (24 tests) passes;
  the impl landed in c9acf21. The "TDD-red" memory note for phase-14 is stale.
- **`supabase test db` does NOT reset/seed.** `--help` confirms it runs pg_prove against the
  _existing_ local DB. §2.1's "yes (resets)" annotation is inaccurate — the seed pgTAP sees comes
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

**Recommended fix (out of S1 scope):** make these 4 pgTAP tests **seed-robust** — isolated dates/ids that
don't collide, or clean the seeded rows in their `BEGIN…ROLLBACK` setup. Do **not** shrink `seed.sql`
(Playwright depends on those fixtures). Flagged as a follow-up task.

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

## Blockers

_(none for S1.)_ Known baseline for downstream: pgTAP has 4 pre-existing seed-contaminated failures
(see "S1 results → pgTAP"). Not blocking — documented so S2+ don't mistake them for new regressions.
