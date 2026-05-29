# Shift@PennHousing — Agent Briefing

This file is read by Claude Code and Codex at session start.
It supplements but does not replace BEHAVIORAL_SPECIFICATION.md and ARCHITECTURE.md.

## Source of Truth Hierarchy

1. BEHAVIORAL_SPECIFICATION.md — what the system must do
2. ARCHITECTURE.md — how the schema and code enforce it
3. This file — repo conventions and agent guardrails
4. Test names — behavioral checklist (do not infer behavior from test bodies)

## Hard Invariants (Behavioral §1.2, §1.5; Architecture §1.5)

1. **Harnwell training constraint**: no worker whose home_house != Harnwell may staff the
   Harnwell desk under any mechanism (scheduled, claimed, floated, picked up, force-triggered).
   Enforce in code at every assignment write point — not only in config tables.

2. **Float direction rules**: 11-single-staff-house workers cannot be float sources, ever.
   Quad workers cannot float to Harnwell. Enforce algorithmically; do not trust float_routing
   table alone.

3. **No-takeback rule**: once a float is `pending` or `acknowledged`, automated systems may
   not revoke it. Only manual SM/HM/BM override may.

4. **Hours cap is not checked on float assignment.** Floats relocate already-scheduled hours;
   total weekly hours unchanged. Cap checks apply to claim, swap, pickup — never float.

5. **Block atomicity**: every shift operation works in 30-minute blocks on 30-minute boundaries.
   No sub-block operations exist. Ever.

6. **Time zone**: all timestamps are `timestamptz` in America/New_York. Never use naive
   timestamps. Never do wall-clock arithmetic for DST-crossing intervals — use duration arithmetic.

## Conventions

- Migrations: pure SQL files in `supabase/migrations/YYYYMMDDHHMMSS_description.sql`.
  Reversible where possible. Idempotent re-application.
- Pure business logic: `packages/core/src/`. Edge Functions are thin wrappers around it.
  packages/core has zero Supabase SDK imports.
- RLS: every new table gets RLS policies in the same migration that creates it.
  Service-role bypasses all RLS (for Edge Functions and orchestrator).
- Tests: pgTAP for DB-layer behavior, Vitest for TypeScript logic.
  Never skip a test because a behavior is "unlikely" — the spec is the truth.
- Mobile: a Kotlin Multiplatform app at `apps/mobile` following Google's
  Fruitties pattern — **shared logic, native UI per platform**: `:shared`
  (commonMain/androidMain/iosMain) holds logic + ViewModels; `:androidApp`
  (Jetpack Compose) and `iosApp` (SwiftUI, consuming the `Shared` framework via
  SKIE) are the front ends. App id `com.pennhousing.shift`; shared namespace
  `com.pennhousing.shift.shared`. AGP 8.13.1 / Kotlin 2.2.21 / Gradle 9.2.1 /
  version catalog. Build Android: `./gradlew :androidApp:assembleDebug`. Link the
  iOS framework (macOS + Xcode): `./gradlew :shared:linkDebugFrameworkIosSimulatorArm64`.
  Shared tests: `:shared:testAndroidHostTest` (JVM) / `:shared:iosSimulatorArm64Test`.
- Mobile scaffolding: the KMP layout (`:shared` + `:androidApp` + `iosApp`) is in
  place. The `android` CLI (skill: `android-cli`) is for emulator/device runs
  only — it does NOT scaffold KMP. The iosApp Xcode project / signing is
  maintained in Xcode (see `apps/mobile/iosApp/README.md`).
- Type generation: after any migration change, run:
  `supabase gen types typescript --local > packages/shared/src/database.types.ts`
- Supabase MCP: configured in `.claude/settings.local.json` (gitignored). When active,
  Claude Code can query the local Postgres directly — use this to validate schema before
  writing migrations. Never point the MCP at the production URL during development.

## Required Local Tools

| Tool           | Purpose                                                        | Install                                                |
| -------------- | -------------------------------------------------------------- | ------------------------------------------------------ |
| `supabase` CLI | Local Postgres, migrations, Edge Functions                     | https://supabase.com/docs/guides/cli                   |
| `android` CLI  | Emulator management, device runs, screen capture (Maestro E2E) | https://developer.android.com/tools/agents/android-cli |
| `pnpm`         | Workspace package manager                                      | `npm install -g pnpm`                                  |
| `node` 20+     | TypeScript toolchain                                           | https://nodejs.org                                     |
| `java` 17+     | Gradle / Android builds                                        | https://adoptium.net                                   |
| `xcode` 15+    | iOS simulator builds (macOS only)                              | Mac App Store                                          |

Note: `android` CLI is for emulator/device operations only; it does not scaffold KMP.
The KMP layout (`:shared` + `:androidApp` + `iosApp`, Fruitties-style) is already in
place (see Conventions above). `xcode` + command-line tools are required to build the
iOS framework and the iosApp.

## Excluded from Agent Reads

- `prompts/` directory — these are human-operated copy-paste prompts.
  The .claudeignore file enforces this. Never read from prompts/.

## What Agents Commonly Get Wrong Here

(This section grows as the project progresses. Append findings at the end of each phase.)

- [Phase 00] TODO: populate as issues arise.

## Phase-Specific Notes

(Append at end of each phase with critical learnings.)

- [Phase 00] House names: 11 single-staff houses use placeholder names House-3 through
  House-13. Real names are a TODO before launch.
- [Phase 01] Houses: Harnwell and Quad have special rules throughout.
  11 single-staff houses use placeholder IDs house-03..house-13 — real names TODO.
- [Phase 01] RLS: all tables have service-role bypass; user-scoped policies come later.
- [Phase 01] staffing_patterns stores compressed jsonb ranges.
  Application layer expands them at read time.
- [Phase 02] The broadcast_subscribed guard is enforced at both DB trigger level AND
  Edge Function level. The DB trigger is authoritative; the EF layer is UX guard.
- [Phase 02] eligibility functions live in packages/core/src/eligibility/index.ts
  and are used by phases 05, 06, 07. They take UserEligibilityProfile, not DB rows.
- [Phase 03] DST-correct block generation: iterate by adding `interval '30 minutes'`
  to a NY-anchored timestamptz, NOT by enumerating wall-clock minutes and converting.
  Wall-clock iteration silently drops blocks on DST days (spring-forward gap collapses
  to a UNIQUE collision; fall-back ambiguous times resolve to one offset). The correct
  pattern: `(target_date::timestamp + make_interval(mins => start_minute)) AT TIME ZONE
'America/New_York'` for the band start, then `band_start_at + n * interval '30 minutes'`
  for each block. See supabase/migrations/20260527000004\_\*.sql.
- [Phase 03] `shift_end_bound = '00:00'` in `operating_profiles` represents 24:00 of
  the input date (midnight end-of-day), NOT 00:00 of the same day. The generator must
  cast as `input_date + INTERVAL '24 hours'` before iterating; a naive literal reading
  yields zero blocks.
- [Phase 03] The block generator reads bands from `staffing_patterns` and does NOT
  cross-check them against `operating_profiles.shift_start_bound` / `shift_end_bound`.
  Misconfigured staffing rows would generate out-of-band blocks. Profile-bound
  enforcement is admin-tooling concern, not generator concern.
- [Phase 03] `shift_block_assignments` RLS requires THREE select policies that OR
  together: own-assignment (`user_id = auth.uid()`), home-house, and house-admin.
  The own-assignment clause is load-bearing for personal-calendar visibility of
  float-out and cross-house-pickup rows (BEH §11.2) — those rows attach to
  non-home-house blocks and would otherwise be invisible to the worker.
- [Phase 06] The float lookup algorithm (`packages/core/src/float-lookup/`) is a
  PURE FUNCTION — zero Supabase imports, deterministic for a given input. The
  orchestrator (phase 07) snapshots all DB state into `FloatLookupInput` and
  writes the resulting `FloatAssignment[]` rows itself. Do not call the
  algorithm from inside a DB transaction loop; build the snapshot once.
- [Phase 06] Tentative counter is GLOBAL per source (pinned decision #1 in
  `tests/PHASE_06/TEST_PLAN.md`): increment unconditionally after EACH selection,
  regardless of the span's length or block positions. A k-worker source can
  spare exactly k−1 floaters per pass. Hybrid heuristics (e.g., "only count
  2-block selections") look correct against tests with overlapping spans but
  silently over-float when spans are disjoint. The phase-06 audit pass
  removed such a heuristic; do not reintroduce.
- [Phase 06] Partial-coverage fallback is THREE TIERS (pinned decision #16):
  full coverage → leading portion ≥2 blocks → largest consecutive span ≥2
  blocks (with non-trailing filter on the first iteration at each source).
  BSpec §6.2 #5 text describes only the first two; the third tier is required
  by Integration Scenario 9 (interior 1-block hole). Document any change to
  this tiering in both `tests/PHASE_06/TEST_PLAN.md` and the header comment
  on `chooseCandidateForCurrentRun`.
- [Phase 06] `float_assignments.source_assignment_ids` / `destination_assignment_ids`
  are uuid[] columns validated by an INSERT/UPDATE trigger (not by per-row FK,
  which Postgres does not support on array elements). The reverse direction —
  `shift_block_assignments.parent_float_id` → `float_assignments.float_id` —
  IS a true FK, deferrable, ON DELETE SET NULL. Phase 07 must populate both
  sides inside the same transaction (the algorithm returns block ids; the
  caller resolves them to assignment_ids).
- [Phase 06] Hours cap is NOT checked in the float algorithm (BSpec §6.1,
  AGENTS hard invariant #4) and the algorithm input has no cap field by
  design. Floats relocate already-scheduled hours; total weekly hours are
  unchanged. A worker at 39h is still eligible to float. The shared
  `isEligibleForFloatLookup` in `packages/core/src/eligibility/` is a
  separate, broader pre-filter the orchestrator may use; it also does not
  check hours.
- [Phase 07] **Project-administrator terminal (BSpec §2.6) — required deploy
  config.** When an urgent (HMOD-for-Allied) notification resolves past both HM
  and HMOD (e.g. a fully-delegated-to-admin leave window), the terminal contact
  is `system_config('project_administrator_user_id')` (`value_type = 'uuid'`,
  read with `config_value::uuid` by `process_no_ack_float` and
  `process_hmod_notify_allied_step`). **Every deployed environment MUST set it**
  to an active `users.user_id`:
  `INSERT INTO system_config (config_key, config_value, value_type) VALUES
('project_administrator_user_id', '<admin user_id>', 'uuid');`
  `seed.sql` does not set it (the local seed has no users); the pgTAP suite
  exercises the configured path in `phase-07-admin-terminal.sql`. If unset/invalid,
  the urgent notification is logged via `RAISE WARNING` (not silently dropped) and
  no `hmod_urgent` row is created.
- [Phase 07] **Inbound-float visibility is sm/hm/bm, not hm/bm.** The destination
  house's SM sees inbound floats and the live house schedule (BSpec §7.1/§10), so
  the `float_assignments` / `float_exclusions` / `shift_block_assignments` SELECT
  policies use `user_can_build_schedule` (sm/hm/bm). Admin over PEOPLE
  (`users` / `user_roles`) and preference/period-target WRITES stay hm/bm-only
  (`user_has_house_admin_role`). Do not collapse the two helpers.
