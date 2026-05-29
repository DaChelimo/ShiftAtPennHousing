# Checkpoint Audit — Phases 0–7

**Scope:** Verification audit of Shift@PennHousing against `BEHAVIORAL_SPECIFICATION.md` (BSpec) and `ARCHITECTURE.md` (ARCH), covering Phases 0–7, prior to Phase 8 (force-trigger endpoint).
**Method:** Spec-first, read-only. Both specs read in full; per-phase code/migrations/tests audited against the 17 audit dimensions. Phases 0, 1, 3, 4 were audited by parallel sub-agents; Phases 2, 5, 6, 7 were audited directly in-thread (after the sub-agent batch hit session limits). End-to-end happy-path and adversarial-path traces (Stage C) and the test-suite cross-cut (Stage D) were folded into the per-phase reads.
**Canonical source on conflict:** spec (per user instruction). Spec-vs-spec and spec-vs-prompt conflicts are recorded as open questions.
**Hard rule honored:** no code, migration, or test was modified. This is the audit only.

---

## 1. Executive Summary

### Findings by severity (normalized across the whole audit)

| Severity     | Count | Notes                                                                                                                                                       |
| ------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Critical** | 6     | Authorization bypasses, a publish path that always fails, and a systematically wrong hours-cap computation.                                                 |
| **High**     | 17    | Float-algorithm under-coverage, HMOD mis-routing, tested-but-not-deployed orchestrator code, a cross-phase reminder regression, a never-added FK, and more. |
| **Medium**   | 24    | Schema-invariant gaps, missing constraints, partial behaviors, RLS-untested-at-runtime, enum-vs-text drift.                                                 |
| **Low**      | 21    | Defensive-coding gaps, naming, dead re-exports, over-strict validators.                                                                                     |
| **Nit**      | 14    | Cosmetic, doc, and style items.                                                                                                                             |

(Counts are approximate where related findings cluster; every finding below is enumerated individually per the "do not collapse" rule.)

### Highest-risk themes

1. **`SECURITY DEFINER` functions are world-executable.** Multiple RPCs (`generate_blocks_for_date`, `publish_schedule`, `submit_preferences`) lack `REVOKE … FROM PUBLIC`. Any authenticated JWT can invoke them, and several act on behalf of arbitrary users or mutate global calendar state. The Phase 7 RPCs got this right (they `REVOKE`/`GRANT`); the earlier phases did not. This is the single most dangerous theme.

2. **The hours cap — the system's core financial control — is computed wrong.** `effective_weekly_cap` resolves the default cap from the _single day of the block being claimed_, not from the _week's days_ (BSpec §9.3 mandates one cap per week), and it never consults `break_periods`, so spring-fling weeks are mis-capped. Boundary/straddling weeks get inconsistent caps. The tests mask this by always installing an explicit override.

3. **Tested code is not the deployed code (Phase 7).** The entire `packages/core/src/orchestrator/` and `escalation/` TypeScript layer is exercised by the Phase 7 vitest suite but **not imported by the production orchestrator Edge Function**, which reimplements chain evaluation inline and delegates routing/no-ack to SQL RPCs. The SQL routing has real bugs (Monday-08:00 handoff, leave date-anchoring) that the routing tests cannot catch because they test the parallel TS implementation.

4. **Compounding cross-phase regressions.** Phase 4 redefined Phase 2's `user_has_house_admin_role` to include `sm`, silently widening SM authority across every RLS policy that uses it. Phase 7 redefined Phase 4's `send_preference_reminders` and dropped the role filter entirely, so BMs and pure-HMs now receive reminders they cannot act on. Earlier-phase defects propagate forward exactly as the audit brief warned.

5. **The float algorithm under-covers in multi-run gaps.** The source loop abandons a source as soon as no worker covers the _largest_ uncovered run, even when a worker could cover a _smaller_ run — contradicting BSpec §6.2 ("until no more eligible workers … can cover **any** remaining consecutive runs of at least 2 blocks"). Coverage that floaters could provide is sent to Allied instead.

6. **The float-eligibility conflict gates are dead.** The orchestrator snapshot builder hardcodes `hasConflictingFloat: false` and `hasConflictingCrossHousePickup: false`, so the algorithm's BSpec §6.1 overlap checks never fire. Currently masked by the source-query status filter, but a contract violation and a latent double-book.

### Go / No-Go recommendation for Phase 8

**NO-GO** until the Critical findings and the Phase-8-adjacent High findings are remediated. Phase 8 (force-trigger) builds directly on: the float lookup algorithm (F-06-001 under-coverage; F-07-009 dead conflict gates), the no-ack / source-side reconciliation path (correct in the current `process_no_ack_float`, but it has **no acknowledge/decline counterpart** — F-07-010, so every force-triggered pending float can only ever no-ack), the HMOD routing helpers (F-07-001/002/003 routing bugs), and `block_step_status` rollback (correct). Shipping Phase 8 on top of these would compound the defects further. The authorization holes (F-03-001, F-04-001, F-04-002) are independently release-blocking regardless of Phase 8.

---

## 2. Findings by Phase

> Severity legend: **Critical** (data/authz integrity, or a whole behavior class broken) · **High** (spec-violating behavior with a realistic trigger) · **Medium** (latent/edge correctness, missing invariant) · **Low** (defensive/structural) · **Nit** (cosmetic/doc).

### Phase 0 — Foundation

**F-00-001 · High** _(recalibrated from sub-agent "Critical" — blocks Phase 13, not Phase 8)_ — **KMP module is `androidApp`+`shared`, not `composeApp`; CI invokes the spec'd-wrong module.**

- Category: Spec↔Code / Cross-phase consistency.
- Spec: "`./gradlew :composeApp:assembleDebug` succeeds (Android)" — `prompts/phase-00-foundation/01-implementation.md:126`.
- Code: `apps/mobile/settings.gradle.kts:3-4` (`include(":androidApp")`, `include(":shared")`); `.github/workflows/ci.yml:90,108`.
- Description: The cloned JetBrains template uses the legacy two-module layout; the spec names `composeApp`. AGENTS.md's expect/actual guidance assumes one app module.
- Failure scenario: Phase 13a developer follows AGENTS.md / docs and runs `:composeApp:assembleDebug` — task doesn't exist.
- Remediation: Either restructure into a single `composeApp` module, or amend the spec + AGENTS.md + Phase 13 prompts to the `:androidApp:`/`:shared:` layout and record the decision.
- Blast radius: Phase 13a, AGENTS.md conventions, `docs/dev-setup.md`.

**F-00-002 · High** — **iOS bundle id / app name / Gradle root still carry template branding `com.myapplication.MyApplication`.**

- Category: Spec↔Code / Dead code.
- Spec: "update `composeApp/build.gradle.kts`: applicationId → com.pennhousing.shift" — `prompts/phase-00-foundation/01-implementation.md:118`.
- Code: `apps/mobile/iosApp/Configuration/Config.xcconfig:2-3`; `apps/mobile/androidApp/src/androidMain/res/values/strings.xml:2`; `apps/mobile/settings.gradle.kts:1`; `MainActivity.kt` package `com.myapplication`.
- Failure scenario: first signed iOS build registers `com.myapplication.MyApplication`.
- Remediation: set `BUNDLE_ID`/`APP_NAME`/`rootProject.name` and the Kotlin package to project values.
- Blast radius: App Store identity, code-signing, analytics.

**F-00-003 · Medium** — **Template `apps/mobile/README.md` steers contributors to `kmp.jetbrains.com`, which AGENTS.md forbids.** Remediation: replace/delete. (`apps/mobile/README.md:1-11`; contradicts `AGENTS.md:49`.)

**F-00-004 · Low** — **`apps/mobile/readme_images/` (~1.5 MB of template marketing PNGs) retained.** Dead weight in every clone. Remediation: delete.

**F-00-005 · Low** — **`apps/mobile/LICENSE.txt` is the template's Apache-2.0 at the wrong scope** (no repo-root LICENSE). Clarify project licensing.

**F-00-006 · Low** — **`apps/mobile/cleanup.sh` template script retained**; contains `rm -rf` paths meaningful only at clone time. Remediation: delete.

**F-00-007 · Medium** — **`tests/PHASE_PLAN.md` numbering is stale and contradicts reality.** Category: Doc drift. It labels Phase 04="Float System", 05="Claim & Swap", 06="Pickup", **07="Notifications"** — but the implemented phases are 04=schedule-builder, 05=feed-claim, 06=float-algorithm, **07=orchestrator** (`prompts/README.md:33-49`). A reader looking for push/FCM code in the Phase 07 migrations will be misled. Remediation: regenerate from `prompts/README.md` or delete.

**F-00-008 · Medium** — **`ktlint` Gradle plugin never added** despite spec requiring it (`prompts/phase-00-foundation/01-implementation.md:143`); zero Kotlin style enforcement at any layer. Also no `*.kt` entry in `lint-staged`.

**F-00-009 · Medium** — **Playwright and Maestro never installed** despite spec "install but do not write tests yet" (`prompts/phase-00-foundation/01-implementation.md:28`). Phases 13a/13b will start without scaffolding.

**F-00-010 · Medium** — **ESLint major-version split:** root `eslint@^8.57` (legacy `.eslintrc.json`) vs `apps/web` `eslint@^9` (flat config). `lint-staged` runs root v8 against staged `apps/web` files → undefined behavior. (`package.json:23`, `apps/web/package.json:22`.)

**F-00-011 · Low** — **CI `test-supabase` has no Docker image caching / `db reset`** before `supabase test db`; first run on each PR pulls ~500 MB and is exposed to Docker Hub rate limits. (`.github/workflows/ci.yml:55-72`.)

**F-00-012 · Low** — **`supabase/config.toml` `project_id = "Shift_PennHousing"`** is an `@`-sanitized derived value; set it explicitly to match `package.json` name.

**F-00-013 · Low** — **`packages/core/src/float-lookup/*.js` build artifacts are committed alongside `*.ts`.** (Tracked in git.) Cross-ref **F-06-006**. Remediation: remove tracked `.js` from `src/`, gitignore emit, build to `dist/`.

**F-00-014..017 · Nit** — create-next-app marketing assets in `apps/web/public/`; `layout.tsx` title "Create Next App"; `.prettierignore` blanket-excludes Kotlin (correct, but combined with F-00-008 leaves Kotlin unformatted); `turbo.json` `test` depends on `^build` (redundant for the smoke test). (`apps/web/public/*.svg`, `apps/web/app/layout.tsx:15-18`, `.prettierignore:6-7`, `turbo.json:10-14`.)

---

### Phase 1 — Config Layer

**F-01-001 · Critical** _(recalibrated from sub-agent "High")_ — **`weekly_cap_overrides.hours_cap` accepts arbitrary integers; the `IN (20,40)` CHECK was deliberately dropped.**

- Category: Spec↔Code / Schema correctness.
- Spec: "The HM/BM may set a week to **either 20 (soft, overridable) or 40 (hard, not overridable)**." — `BEHAVIORAL_SPECIFICATION.md:798` (§9.3).
- Code: `supabase/migrations/20260527000002_weekly_cap_drop_hours_check.sql:6-7` drops `weekly_cap_overrides_hours_cap_check`; `supabase/tests/phase-01-schema.sql:509-517` asserts the constraint is _absent_, locking in the regression.
- Failure scenario: `INSERT … hours_cap = 99` succeeds; `effective_weekly_cap` returns 99 and admits a worker at 98 h.
- Remediation: re-add `CHECK (hours_cap IN (20,40))` in a new forward migration; flip the test to assert presence.
- Blast radius: Phase 5 cap enforcement; all cap-admin UI.

**F-01-002 · High** — **No constraint couples `hours_cap` to `cap_enforcement` (20⇔soft, 40⇔hard).** `(20,'hard')` / `(40,'soft')` are insertable. Spec pairs them (BSpec §9.3:798, §9.3:808-810). Remediation: `CHECK ((hours_cap=20 AND cap_enforcement='soft') OR (hours_cap=40 AND cap_enforcement='hard'))`. (`20260526000006_weekly_cap_overrides.sql:9-10`.)

**F-01-003 · High** — **`scheduling_periods.profile_name` is not pinned to `'regular_school_year'`.** ARCH §2.10: "always 'regular_school_year'" (`ARCHITECTURE.md:334,347`). The FK admits `winter_break`/`short_break`, which would feed the permanent-drop boundary algorithm (ARCH §7.1) bogus data. Remediation: `CHECK (profile_name='regular_school_year')`. (`20260526000011_scheduling_periods.sql:8`.)

**F-01-004 · Medium** — **`system_config` seed omits keys ARCH §3.10 / Appendix B name** (`claim_phase_open/alert/close_offset_days`, mandatory ack reminder offsets). The test asserts exactly the 11 seeded keys as "all required," locking the incomplete set. Note: per ARCH §3.10 the broadcast/float/HMOD offsets legitimately live in `operating_profiles` instead — see open question Q2. (`supabase/seed.sql:242-253`, `phase-01-schema.sql:496-506`.)

**F-01-005 · High** — **`hmod_rotor.hmod_user_id` FK was deferred to Phase 2 and never added.** See **F-02-001** (the omission is Phase 2's). The Phase 1 migration comment promises "FK added in phase-2" (`20260526000007_hmod_rotor.sql:10`); generated types show `hmod_rotor.Relationships: []`. Arbitrary/typo'd/fired user ids sit unvalidated → Phase 7 HMOD resolution dereferences them.

**F-01-006 · Medium** — **`operating_profiles` lacks the "claim_phase fields null iff `sm_built`" CHECK** (ARCH §2.2:113-115). Remediation: add the paired CHECK. (`20260526000002_operating_profiles.sql:19-22`.)

**F-01-007 · Medium** — **`hmod_rotor` has no "hmod_user_id holds hm/bm role" enforcement** (ARCH §2.6:234). Requires a trigger against `user_roles` (post-Phase-2). Not present anywhere.

**F-01-008 · Medium** — **`staffing_patterns.block_headcounts` and `operating_profiles.escalation_chain` have no JSON-shape validation.** A malformed array silently breaks the Phase 3 generator / Phase 7 dispatcher (a `"float_lockup"` typo no-ops the float step). Remediation: array-shape CHECKs. (`20260526000004:14`, `20260526000002:18`.) _(Two findings: F-01-008a staffing, F-01-008b escalation_chain.)_

**F-01-009 · Medium** — **No date-range overlap exclusion on `break_periods` / `scheduling_periods`** (BSpec §3.1 "no overlaps and no ambiguity"; ARCH §2.9:318). Overlapping rows make the spring-fling cap derivation and the permanent-drop boundary lookup non-deterministic. Remediation: `EXCLUDE USING gist (daterange(...) WITH &&)` (needs `btree_gist`). _(Two findings: F-01-009a break_periods, F-01-009b scheduling_periods.)_

**F-01-010 · Low** — **`hm_leave` permits `replacement_user_id = user_id` (self-replacement).** The active-replacement trigger (added Phase 2) checks active-ness but not self-reference; a 0-length cycle only trips the depth-10 path. Remediation: `CHECK (user_id <> replacement_user_id)`. (`20260526000008_hm_leave.sql:11-15`.)

**F-01-011 · Medium** — **pgTAP suite has no negative-path coverage for any CHECK/enum and no actual RLS-deny test.** It asserts structure (tables/columns/types/FK existence/`relrowsecurity=true`) but never that a bad insert is rejected or that a non-service role is blocked (tests run as table owner; no `FORCE ROW LEVEL SECURITY`). Remediation: add `throws_ok` per constraint and `SET ROLE authenticated` deny tests. (`phase-01-schema.sql`.)

**F-01-012 · Nit** — `plan(175)` vs 177 actual assertions (`phase-01-schema.sql:6`). Fix to 177.

**F-01-013 · Nit** — `modified_at DEFAULT now()` columns have no UPDATE trigger to refresh them (`weekly_cap_overrides`, `ack_cadence_config`, `system_config`); they drift on UPDATE.

**F-01-014 · Low** — `houses.id`/`profile_name` (`text`) admit empty/whitespace/mixed-case values; no format CHECK. Case-variant `'Harnwell'` would silently break the Harnwell training invariant. (`20260526000001_houses.sql:5-6`.)

**F-01-015 · Low** — `weekly_cap_overrides.week_start_date` and `hmod_rotor.week_start_date` are not constrained to Mondays (BSpec §9.2:784, ARCH §2.6:233); a Tuesday key silently never matches lookups. Remediation: `CHECK (EXTRACT(ISODOW …)=1)`.

**F-01-016 · Low** — `system_config.value_type='enum'` carries no enum-membership metadata, and `config_key`/`time_of_day`/`enum` values are unvalidated `text`. Typo'd keys are silently ignored by the cache loader. (`20260526000012`, `seed.sql:247-251`.)

**F-01-017 · Nit** — `[Phase 01]` AGENTS.md notes never record the two follow-up migrations (tri-state ack flags; dropped cap CHECK). Doc drift.

**F-01-018 · Low** — Seed leaves `operating_calendar`, `break_periods`, `scheduling_periods` empty; every downstream phase must hand-roll calendar fixtures. (Consistent with the prompt, but forces duplicated fixtures.)

---

### Phase 2 — Users & Roles

**F-02-001 · High** — **`hmod_rotor.hmod_user_id` FK promised by Phase 1 was never added by Phase 2.**

- Category: Schema correctness / Cross-phase consistency.
- Spec: "hmod_user_id (foreign key to users; must hold hm or bm role)" — `ARCHITECTURE.md:233-234`.
- Code: Phase 2 `20260527000003_users_roles.sql:59-71` adds FKs for `hm_leave.user_id`, `hm_leave.replacement_user_id`, `ack_cadence_config.modified_by`, `weekly_cap_overrides.modified_by` — but **not** `hmod_rotor.hmod_user_id`. Confirmed by grep: no migration references an `hmod_rotor` FK.
- Failure scenario: an HMOD rotor row with a typo'd or deactivated user id passes silently; Phase 7 `resolve_hmod_on_duty` returns a non-existent user → urgent Allied notification mis-routed or dropped.
- Remediation: add `ALTER TABLE hmod_rotor ADD CONSTRAINT … FOREIGN KEY (hmod_user_id) REFERENCES users(user_id)` (mirroring the `weekly_cap_overrides.modified_by` FK Phase 2 did add).
- Blast radius: Phase 7 HMOD routing; F-07-001/002/003.

**F-02-002 · High** — **`isEligibleForSwapCounterparty` excludes HMs, and a passing test asserts the exclusion — with no spec basis.**

- Category: Spec↔Code / Test correctness.
- Spec: §13 "Housing Managers (HM) can do everything an SM can do for their home house" and SMs "Initiate shift swaps, float swaps, and permanent shift swaps with other workers" (`BEHAVIORAL_SPECIFICATION.md:927,918`); §2.3 HMs hold and pick up shifts. No §8 text excludes HMs from swaps.
- Code: `packages/core/src/eligibility/index.ts:126-128` returns `hm_excluded_from_swap_counterparties`; `packages/core/tests/phase-02/role-eligibility.test.ts:237-243` asserts it, with the comment "the float-exclusion pattern extends here" — an unsanctioned inference.
- Failure scenario: an HM who works a shift cannot be a swap counterparty when Phase 9 ships, contradicting §13.
- Remediation: drop the HM exclusion from `isEligibleForSwapCounterparty` (BM exclusion stays), and fix the test. Confirm intent (open question Q-P2).
- Blast radius: deferred to Phase 9 (swaps), but locked in by a green test now.

**F-02-003 · Medium** — **A custom operator `<@ (name[], text[])` and its function exist in the production migration solely to support pgTAP tests.**

- Category: Dead code / Cross-phase consistency.
- Code: `20260527000003_users_roles.sql:6-26` defines `name_array_contained_by_text_array` + `CREATE OPERATOR <@`. Grep shows zero production use; the only consumers are `phase-02/03/04/07` pgTAP files. This pollutes the production schema and creates a hidden cross-phase coupling (the Phase 3/4/7 test suites silently depend on a Phase 2 migration's operator).
- Remediation: move the helper into a test-only fixture, or replace the test's array comparison with `@>`/`<@` on same-typed arrays (cast `attname::text`).

**F-02-004 · Medium** — **TOCTOU race in `enforce_bm_worker_role_exclusion`.** Two concurrent transactions inserting `bm` and `sw` for the same user each pass the `EXISTS` check (neither sees the other's uncommitted row) and both commit, violating the BM/worker exclusion. No advisory lock / serializable isolation / exclusion constraint. (`20260527000003:121-175`.) Likelihood low (admin-driven), but a real invariant breach.

**F-02-005 · Medium** — **RLS SELECT policies on `users`/`user_roles` are never behaviorally tested.** pgTAP runs as the table owner with no `FORCE ROW LEVEL SECURITY`, so "house admins can select house users" etc. are asserted to _exist_ but never exercised for actual row filtering. (Mirrors F-01-011.) (`phase-02-users.sql:149-156`.)

**F-02-006 · Medium** — **The `users-broadcast-subscription` Edge Function has no automated test.** Its auth check, self-only 403, HM/BM 403, and boolean validation are untested; only the DB trigger backstop is tested. (`supabase/functions/users-broadcast-subscription/index.ts`.)

**F-02-007 · Low** — **`packages/core/src/users/eligibility.ts` is a one-line re-export shim** (`export * from '../eligibility/index.js'`) consumed only by the Phase 2 test, reconciling a test-contract/location mismatch (AGENTS.md says canonical = `eligibility/index.ts`). Harmless indirection.

**F-02-008 · Low** — **`isEligibleForScheduleRoster` is implemented but untested** (the role-eligibility suite covers only 4 of 5 predicates). (`eligibility/index.ts:137`.)

**F-02-009 · Low** — **`user_roles` scope CHECK allows `role='sw'` with a non-null `scope_house_id`** (the CHECK is `role='sw' OR …`). An sw with a scope is meaningless per ARCH §3.1. Remediation: `(role='sw' AND scope_house_id IS NULL) OR (…)`. (`20260527000003:50-54`.)

**F-02-010 · Low** — **`users.email` has no UNIQUE constraint;** two rows can share an email. (`20260527000003:31`.)

**F-02-011 · Nit** — The EF returns the DB-trigger HM/BM rejection as HTTP 400 (`index.ts:116`) while its own pre-check returns 403 for the same condition — inconsistent status.

**F-02-012 · Nit** — `clear_broadcast_subscription_on_admin_role` is a BEFORE trigger doing a side-effecting UPDATE on `users`; works (same txn) but an AFTER trigger is more idiomatic. (`20260527000003:177-196`.)

---

### Phase 3 — Blocks & Calendar

**F-03-001 · Critical** — **`generate_blocks_for_date` / `generate_blocks_for_range` are `SECURITY DEFINER` with no `REVOKE … FROM PUBLIC`.**

- Category: RLS / RPC security.
- Spec: ARCH §1.1 "Service-role bypasses all RLS (for Edge Functions and orchestrator)" — the generation function is service-role-only by intent; the Phase 7 RPCs all `REVOKE`/`GRANT` (`20260528000003:235`, etc.).
- Code: `20260527000004_shift_blocks_calendar_generation.sql:139-278` — both functions `SECURITY DEFINER`, no `REVOKE`. Postgres grants `EXECUTE` to `PUBLIC` by default.
- Failure scenario: any authenticated (or `anon`) JWT runs `SELECT generate_blocks_for_range('2030-01-01','2030-12-31')` and materializes hundreds of thousands of rows, bypassing RLS via the definer context.
- Remediation: `REVOKE ALL ON FUNCTION … FROM PUBLIC; GRANT EXECUTE … TO service_role;` for both.
- Blast radius: global calendar integrity, storage, every downstream phase.

**F-03-002 · High** — **`user_has_house_admin_role` silently changes meaning between Phase 3 and Phase 4.** The Phase 3 `shift_block_assignments` admin SELECT policy calls it; Phase 2 defined it as HM/BM-only; Phase 4 `CREATE OR REPLACE`s it to add `sm`. So the Phase 3 policy's semantics mutate retroactively at the Phase 4 migration with no signal at the policy site. See cross-phase **X-2**. (`20260527000004:114-132`; `20260527000005:6-23`.)

**F-03-003 · High** — **No INSERT/UPDATE/DELETE RLS policies on `shift_block_assignments`.** With RLS enabled and only SELECT policies, all non-service-role writes are denied by default — contradicting the prompt's "permissive write … tighten in phase-05" and BSpec §4.3/§4.5/§5.2 (SM live overrides, worker drops). Currently masked because Phase 4/5/6/7 write via service-role RPCs, defeating the in-DB authorization model the spec describes. Remediation: add scoped write policies, or document service-role-only and defer worker-write policies explicitly. (`20260527000004:101-132`.)

**F-03-004 · Medium** — **`shift_block_assignments` has no CHECK correlating `status` with `user_id` nullability** (ARCH §3.2: "null if covered by allied or vacant"). `(status='scheduled', user_id=NULL)` and `(status='vacant', user_id=<uuid>)` are both insertable; a Phase 4–7 write bug would be silently accepted. Remediation: `CHECK ((status IN ('vacant','allied'))=(user_id IS NULL))`. _(Two findings F-03-004a/b for the two directions.)_ (`20260527000004:44-64`.)

**F-03-005 · Medium** — **No CHECK that `parent_float_id IS NOT NULL` iff `is_float`** (ARCH §3.2). `(is_float=false, parent_float_id=<uuid>)` is insertable. Remediation: paired CHECK. (`20260527000004:53`.)

**F-03-006 · Low** — AGENTS.md prescribes **three** SELECT policies (own / home-house / house-admin); the migration combines home-house+house-admin into one `USING … OR …` policy (functionally equivalent; OR'd by Postgres). Auditability nit; the test asserts only one policy by name. (`20260527000004:109-132`, `phase-03-blocks-schema.sql:233-239`.)

**F-03-007 · Low** — **`blocksBetween` (time helper) is implemented and exported but has no test** (`packages/core/src/time/index.ts:48`; absent from `phase-03/time.test.ts`). DST-crossing behavior unverified.

**F-03-008 · Nit** — Enum types are suffixed `_enum` (`shift_status_enum`, `vacancy_origin_enum`) vs the spec's bare names (`shift_status`, `vacancy_origin`). Consistent in-repo; deviates from spec. (`20260527000004:4,15,24`.)

**F-03-009 · Nit** — ARCH §9.1 recommends `(status, block_start_at)` on `shift_block_assignments`, structurally impossible under Approach A (block_start_at lives on `shift_blocks`). The implementation's `(block_id, status)` + `shift_blocks(block_start_at)` is correct; the **doc** is wrong. (`ARCHITECTURE.md:1143`.)

_(Phase 3 strengths confirmed: DST-safe duration-based generation, `shift_end_bound='00:00'`→24:00 handling, 30-min boundary CHECK, multi-headcount per-seat expansion, idempotent `ON CONFLICT DO NOTHING`, exact 8-value status / 6-value vacancy_origin enums.)_

---

### Phase 4 — Schedule Builder

**F-04-001 · Critical** — **`publish_schedule(uuid)` has no enforced authorization; any authenticated user can publish any period.** The single-arg overload passes `NULL` for `p_published_by`, and the auth branch is gated on `p_published_by IS NOT NULL` (`20260527000005:507-520,610-617`). All Phase 4 functions are `SECURITY DEFINER` with no `REVOKE … FROM PUBLIC`. Remediation: `REVOKE`/`GRANT`; require a non-null operator and check role. Blast: flips `published_at` and rewrites `shift_block_assignments` for an entire period.

**F-04-002 · Critical** — **`submit_preferences(p_user_id, …)` is callable as any user.** `SECURITY DEFINER`, no `auth.uid()=p_user_id` check, no `REVOKE` (`20260527000005:423-475`). The EF enforces self-only, but a direct PostgREST RPC call bypasses it. Remediation: `REVOKE`/`GRANT` + identity check.

**F-04-003 · Critical** — **`publish_schedule` refuses any period whose blocks already have `shift_block_assignments` rows — which the Phase 3 generator always creates.** `generate_blocks_for_date` inserts one vacant/`never_assigned` row per seat (`20260527000004:245-253`); `publish_schedule_impl` raises `cannot publish period … with pre-existing live assignments` (`20260527000005:522-532`). The natural flow (generate blocks → SM drafts → publish) **always fails**. The publish test sidesteps it by inserting blocks directly. See open question Q-P4. Remediation: make publish UPSERT/skip pre-existing `vacant`/`never_assigned` rows, or stop the generator from pre-creating them for `regular_school_year`.

**F-04-004 · High** — **Phase 4 redefined Phase 2's `user_has_house_admin_role` to include `sm`,** violating the TEST_PLAN's explicit instruction ("Do NOT extend phase-02's helper to include sm") and silently widening SM authority across `users`, `user_roles`, `shift_blocks`, `shift_block_assignments`, and (later) `float_assignments` RLS. See cross-phase **X-2**. (`20260527000005:6-23`.)

**F-04-005 · High** — **Two divergent Phase-1 grouping implementations; the exported one is untested, the tested one is unreachable from the package root.** `packages/core/src/schedule-builder/phase1-grouping.ts` (`getWorkerSpanGrouping`) is exported via `index.ts` but has no test; `packages/core/src/scheduling/phase1Grouping.ts` (`groupWorkersForSpan`) is what the vitest imports but is not in the barrel. Divergence is invisible. See cross-phase **X-3**.

**F-04-006 · High** — **`submit_preferences` and `send_preference_reminders` have no test coverage.** Atomicity, deadline gate, upsert-merge semantics, opt-out re-submission, and the reminder cron are all unexercised. (`20260527000005`.)

**F-04-007 · Medium** — **The broadcast-subscription Edge Function and `submit_preferences` accept `status='none'`,** which the TEST_PLAN forbids as an application-write value (only preferred/available/cannot). A user could submit all-`none` and appear "submitted." (`supabase/functions/submit-preferences/index.ts:14`.)

**F-04-008 · Medium** — **`publish_schedule` operates on all 13 houses for a period;** BSpec §4.3 implies a per-house SM publish, and `scheduling_periods` has no `house_id`. Combined with F-04-001, the first caller publishes every house's blocks. See open question Q-P4b. (`20260527000005:477-608`.)

**F-04-009 · Medium** — **`submit_preferences` is upsert-merge with no way to delete an individual block preference** (no tombstone, `none` disallowed). Re-submission leaves stale rows. (`20260527000005:452-460`.)

**F-04-010 · Medium** — **No `is_active` enforcement on `draft_block_assignments.user_id` or on preference/period_targets writers** despite ARCH §3.1 listing the schedule-builder roster among `is_active`-filtered pipelines. (`20260527000005:41-49,75-95`.)

**F-04-011 · Low** — `enforce_preference_deadline` fires on DELETE too, blocking legitimate service-role cleanup of aged periods. (`20260527000005:312-340`.)

**F-04-012 · Low** — `notifications.type` was created as `text` in Phase 4 (no enum) — later corrected by Phase 7 (`20260528000002`). Noted for chronology.

**F-04-013 · Nit** — Migration file lacks the `phase_04` prefix used elsewhere; no `COMMENT ON`. The `schedule-builder/phase1-grouping.ts` blocking reason is an opaque concatenated string (`'cannot:b-11:00'`) vs the structured object in the tested variant.

---

### Phase 5 — Feed & Claim

**F-05-001 · Critical** — **`effective_weekly_cap` computes the default cap from the single block-day's profile, not the week's days.**

- Category: Money/float handling / Spec↔Code.
- Spec: "Each calendar week has a single hours cap that applies to that week for all workers across all houses." and "A week straddling regular school year and a 40-hour break … defaults to 40 hours (hard cap), on the safe side." — `BEHAVIORAL_SPECIFICATION.md:788,796` (§9.3).
- Code: `20260527000006_phase_05_feed_claim.sql:106-130` — `LEFT JOIN operating_calendar oc ON oc.date = (p_block_start_at AT TIME ZONE 'America/New_York')::date` resolves the profile of one day, then takes its `default_hours_cap`.
- Failure scenario: a week of Mon–Wed `regular_school_year` + Thu–Sun Thanksgiving `short_break`. A Monday claim resolves to 20-soft; a Thursday claim to 40-hard — two caps in one week. Per §9.3 the whole week must be 40-hard.
- Remediation: compute the cap from all `operating_calendar` rows in the Monday→Sunday window (max-severity rule per §9.3), not from the block's single day.
- Blast radius: every boundary/straddling week; the claim hard-cap gate; permanent-pickup cap checks (Phase 8+).

**F-05-002 · Critical** — **`effective_weekly_cap` never consults `break_periods`, so spring-fling weeks are mis-capped.**

- Category: Money/float handling / Spec↔Code.
- Spec: "A week containing one or more days of spring fling (but no other break) defaults to 20 hours (soft cap)." — `BEHAVIORAL_SPECIFICATION.md:795`; "The default-cap computation … distinguishes spring fling weeks by checking … `break_type = 'spring_fling'`." — `ARCHITECTURE.md:323`.
- Code: `20260527000006:106-130` — no `break_periods` reference at all. Spring fling has profile `short_break` (default 40-hard), so the code returns 40-hard.
- Failure scenario: during spring fling a worker at 40 h is hard-blocked from claiming (code: hard-40) when the policy is soft-20-overridable (they should be permitted with a warning).
- Remediation: join `break_periods` over the week; if any day is `spring_fling` and no 40-h break day is present, return 20-soft.
- Blast radius: all spring-fling weeks.

**F-05-003 · High** — **The hard-cap and soft-cap tests never exercise the default-cap path, masking F-05-001/002.** The hard-cap test installs an explicit `weekly_cap_overrides(40,'hard')` (`phase-05-claim.sql:358-368`); the soft-cap test relies on the no-`operating_calendar`-row final `COALESCE(...,20,'soft')` fallback. No test constructs a straddling or spring-fling week. (Test correctness / coverage.)

**F-05-004 · Medium** — **`drop_shift` cannot drop a `floated_out`/`pending_float_out` row.** Its ownable-status filter is `('scheduled','claimed','floated_in','pending_float_in')` (`20260527000006:344`), so a floating worker's home-floated row can't be dropped — contradicting BSpec §5.2 ("A worker … actively floating may drop their shift") / §5.5. The TODO at lines 361-366 defers float-drop _re-escalation_ to Phase 7, but the drop itself is blocked here. Remediation: include the float-out statuses (and wire re-escalation in Phase 7).

**F-05-005 · Medium** — **`drop_shift` permits vacating blocks whose start is in the past, corrupting the historical calendar.** No lower-bound on droppable `block_start_at` (only the current/future blocks should be droppable per the drop-from-now rounding, §5.2). A worker/buggy client could vacate a shift from weeks ago, erasing the §12 retrospective record. (`20260527000006:335-374`.)

**F-05-006 · Medium** — **`drop_shift` returns `direct_hmod_notification` purely on the gap-start-within-2h test, with no below-required-headcount gating.** BSpec §5.2: "Escalation only fires when the drop leaves the desk below its required headcount … If the desk remains at or above required headcount … no escalation fires." The flag signals direct-HMOD even for an overstaffed-desk drop. (May partly be the orchestrator's job, but the flag is computed wrong.) (`20260527000006:358-359`.)

**F-05-007 · Medium** — **`claim-shift` Edge Function accepts `claim_type='permanent'` but performs a temporary claim.** It calls `claim_open_shift` (single-occurrence) regardless and only echoes `claim_type` (`supabase/functions/claim-shift/index.ts:101-134`). Permanent pickup (ARCH §7.2) is unbuilt; the EF should reject `'permanent'`.

**F-05-008 · Low** — **The soft-cap "warn then proceed" flow is not a server-side gate.** `claim-shift` bundles projection+claim; the claim always commits and the soft-cap warning is returned after the fact (`index.ts:105-134`), so a worker never gets a pre-commit decision point (BSpec §9.3). Acceptable for "soft," but the confirmation semantics are lost.

**F-05-009 · Low** — **`computeWeeklyHours` exists under two divergent signatures.** `scheduling/hours.ts` returns a `HoursDecomposition`; `hours/index.ts` (the package-root export) returns a bare `number`. Same name, different return; the spec-mandated §9.1 decomposition (at-home / floated-out / cross-house-pickup) is hidden behind the non-exported variant. See cross-phase **X-3**.

**F-05-010 · Low** — **`isUuid` regex in `claim-shift`/`drop-shift` rejects valid non-v1–5 UUIDs** (nil, v6/v7/v8). Over-strict; also rejects the test-style `a0000001-0000-0000-…` ids. (`claim-shift/index.ts:28-33`.)

**F-05-011 · Medium** — **Cross-house "unavailable at home / may create a home-side gap" (BSpec §5.3) is not modeled** beyond the time-conflict guard. The "not floatable while on a cross-house pickup" half is handled via `is_cross_house_pickup` in the float algorithm; the home-side-gap half is absent. See open question Q-P5.

_(Phase 5 strengths confirmed: the `occurrence_count`→`weeks_remaining` rename is complete — zero stragglers; the T-2h cutoff uses correct strict `<` semantics with an exact-boundary test; race protection via conditional `UPDATE … WHERE status='vacant'` + RETURNING null-check is correct without needing an explicit `FOR UPDATE`; the cross-house matrix (Harnwell-only restriction) is correct; Monday-NY calendar-week anchoring is correct; the float-out-aware hours counting avoids double-counting.)_

---

### Phase 6 — Float Lookup Algorithm

**F-06-001 · High** — **The source loop abandons a source when no worker covers the _largest_ uncovered run, even if a worker could cover a _smaller_ run.**

- Category: Spec↔Code / State machine.
- Spec: "This continues until no more eligible workers in that source can cover **any** remaining consecutive runs of at least 2 blocks." — `BEHAVIORAL_SPECIFICATION.md:526` (§6.2 #2).
- Code: `packages/core/src/float-lookup/index.ts:208-258` — each `while` iteration fixes `targetRun = getLargestUncoveredRun(...)`; if `chooseCandidateForCurrentRun` returns null (no worker covers ≥2 of the largest run) it `break`s to the next source.
- Failure scenario: after a Tier-3 interior selection leaves runs `[1,2,3]` and `[7,8]`, the largest is `[1,2,3]`; if the only remaining eligible Quad worker covers `[7,8]`, the loop breaks and `[7,8]` is sent to Allied though Quad could cover it.
- Remediation: iterate over _workers'_ largest coverage (worker-centric) or, per source, attempt every remaining run ≥2 before abandoning the source. Add a regression test (interior-hole + non-largest-run-only worker).
- Blast radius: premature Allied procurement; under-utilized float pool; Phase 8 force-trigger uses the same algorithm.

**F-06-002 · Medium** — **`float_assignments.status`, `initiated_by`, and `float_exclusions.reason` use `text + CHECK` instead of Postgres enums.** ARCH §3.4/§3.8 say "enum"; Phases 1–3 use `CREATE TYPE`. Weakens generated TS types (string vs union) and is inconsistent. (`20260528000001:8-14,34`.)

**F-06-003 · Medium** — **No pgTAP test for the Phase 6 migration.** `float_assignments`/`float_exclusions` schema, the uuid[] validation trigger, the `force_triggered_by` CHECK, the `parent_float_id` FK (`ON DELETE SET NULL`), and all RLS policies are untested at the DB layer. Only the pure-TS algorithm is tested.

**F-06-004 · Low** — **The algorithm's BSpec §6.1 float-overlap and cross-house-overlap eligibility gates depend on caller-precomputed booleans** (`hasConflictingFloat`, `hasConflictingCrossHousePickup`), while the exclusion-overlap check is done in-algorithm. The asymmetry means the algorithm cannot validate the caller's computation — and the caller stubs them false (see **F-07-009**).

**F-06-005 · Low** — **`float_assignments` arrays can dangle** if a referenced `shift_block_assignments` row is deleted (the validation trigger fires only on `float_assignments` INSERT/UPDATE). Acceptable per the array design + 14-day cleanup; noted.

**F-06-006 · Low** — **Committed `.js` build artifacts alongside `.ts` in `packages/core/src/float-lookup/`.** Cross-ref **F-00-013**. The tested/edited `.ts` and the stale tracked `.js` can diverge; editors may auto-import the untyped `.js`.

_(Phase 6 strengths confirmed: the global per-source tentative counter (pinned #1) increments unconditionally; the headcount floor `headcount - tentative > 1` correctly leaves ≥1 worker; the three-tier partial-coverage fallback with the first-iteration non-trailing filter (pinned #16) is implemented; the tiebreaker chain (start-align → end-align → arbitrary) narrows candidate sets correctly and the obsolete "ends-within-span" Check 3 is gone; source precedence sorts Quad-before-Harnwell; the Harnwell-destination short-circuit returns empty; no hours-cap field exists in the input; zero Supabase imports.)_

---

### Phase 7 — Orchestrator

**F-07-001 · High** — **`resolve_hmod_on_duty` ignores the Monday-08:00 rotor handoff.**

- Category: Time handling / Notification routing.
- Spec: "HMOD duty rotates on a weekly cadence: each HMOD assignment runs from **Monday 08:00** through the following Monday 07:59." / "Continuously from Friday 17:00 … through Monday 08:00 (exclusive)." — `BEHAVIORAL_SPECIFICATION.md:107,113`.
- Code: `20260528000004:156-183` — `v_week_start_date := date_trunc('week', p_at AT TIME ZONE 'America/New_York')::date` (Monday 00:00) then looks up `hmod_rotor` for that Monday.
- Failure scenario: an event firing Monday 03:00 (still weekend coverage until 08:00) resolves to the _incoming_ week's HMOD instead of the outgoing weekend HMOD → urgent Allied notification mis-routed for the exact weekend window the HMOD exists for.
- Remediation: select the rotor entry whose `[Monday 08:00, next Monday 08:00)` interval contains `p_at` (for `p_at` before Monday 08:00, use the previous week's row).
- Blast radius: all Monday 00:00–08:00 events; F-07 notification correctness.

**F-07-002 · High** — **HMOD leave attribution uses the firing moment's date, not the on-duty interval's start date.**

- Category: Time handling / Notification routing.
- Spec: "HMOD interval transfer is start-date-based … every HMOD on-duty interval whose **start moment** falls on a leave date transfers to the replacement." — `BEHAVIORAL_SPECIFICATION.md:135`; `ARCHITECTURE.md:244-246`.
- Code: `resolve_hm_for_user` (`20260528000004:66-108`) sets `v_leave_date := (p_at AT TIME ZONE NY)::date` and checks leave for that date. For HMOD resolution this should be the interval's start date (e.g., Friday for a Fri-17:00→Mon-08:00 weekend interval).
- Failure scenario: an HMOD on leave Saturday-only still owns the weekend interval (started Friday); an event firing Saturday wrongly resolves to the replacement.
- Remediation: pass the interval-start date (not `p_at`) when resolving HMOD leave.
- Blast radius: weekend/overnight HMOD intervals crossing a leave-date boundary.

**F-07-003 · High** — **Leave resolving to the project administrator (`replacement_user_id = NULL`) drops the notification.** `resolve_hm_for_user` returns NULL when the chain reaches a NULL replacement (`20260528000004:99-106`); the no-ack RPC and `process_hmod_notify_allied_step` skip the insert when the recipient is NULL (`…004:385`, `…007:87-96`). BSpec §2.6 makes the project administrator the guaranteed terminal contact, but `notifications.recipient_user_id` FK-references `users`, which the admin may not be. A coverage gap needing Allied during a fully-delegated-to-admin period produces **no** notification. Remediation: model the project administrator as a notifiable entity (a `users` row or a dedicated channel).

**F-07-004 · High** — **The `orchestrator/` and `escalation/` TypeScript modules are tested but not deployed.**

- Category: Test correctness / Dead code / Cross-phase consistency.
- Code: the orchestrator EF imports only `float-lookup` (`supabase/functions/orchestrator-tick/index.ts:251`) and reimplements `evaluateChainSteps` inline (lines 194-248). It does **not** import `packages/core/src/orchestrator/{evaluate,no-ack,routing}.ts` or `escalation/{notification-router,step-evaluator}.ts`. Yet the Phase 7 vitest targets exactly those: `escalation-timing.test.ts → orchestrator/evaluate.ts`, `notification-routing.test.ts → orchestrator/routing.ts`, `no-ack-trigger.test.ts → orchestrator/no-ack.ts`.
- Failure scenario: `notification-routing.test.ts` validates a TS router while production routing runs in SQL (`is_hm_working_time` + `resolve_hm_for_house` + `resolve_hmod_on_duty`) — so the F-07-001/002/003 routing bugs are invisible to the routing tests. The escalation-timing tests validate `evaluate.ts` while a duplicate inline copy runs in the EF (drift risk).
- Remediation: have the EF import the core modules (or delete the unused TS layer and rely on the SQL RPCs + pgTAP), and route the vitest at the deployed logic. At minimum, port the routing edge cases to the pgTAP `phase-07-hmod-notify-rpc` suite.
- Blast radius: false confidence across three of four Phase 7 vitest files; routing-bug detection.

**F-07-005 · High** — **`buildFloatLookupSnapshot` hardcodes `hasConflictingFloat: false` and `hasConflictingCrossHousePickup: false`,** so the algorithm's BSpec §6.1 "already in an overlapping float" and "on a cross-house pickup" eligibility gates never fire. (`orchestrator-tick/index.ts:570-571`.) Currently masked by the source-query `status IN ('scheduled','claimed')` filter + the `homeHouseId === source.houseId` check, but it is a contract violation and a latent double-book; the source-side `UPDATE` in `process_float_lookup_assignment` has no status guard (unlike the destination's vacancy re-check). Remediation: compute the two flags against the gap window in the snapshot, or add a source-status re-validation under `FOR UPDATE` in the RPC.

**F-07-006 · High** — **Phase 7's redefinition of `send_preference_reminders` dropped the role filter entirely.** The Phase 7 version joins `users ON is_active=true` with no role join (`20260528000002:113-192`), so every active user lacking a `period_targets` row — including BMs (admin-only, cannot submit) and pure-HMs — receives preference reminders. Phase 4's version at least excluded BMs (`role IN ('sw','sm','hm')`). A Phase 7 change regressed Phase 4 behavior. See cross-phase **X-4**. Remediation: filter `role IN ('sw','sm')`.

**F-07-007 · High** _(readiness)_ — **No acknowledge or decline handler exists.** Only the no-ack path (`process_no_ack_float`) is implemented; nothing sets `acknowledged_at`/`declined_at`. Every float — automated or (Phase 8) force-triggered — can therefore only ever no-ack. BSpec §7.1/§7.2 require explicit acknowledge (pending→floated) and decline (void + exclude + reopen). May be scoped to Phase 12/13, but Phase 8's force-trigger creates pending floats that depend on it. See open question Q-P7.

**F-07-008 · Medium** _(readiness)_ — **The acknowledgment cadence (6h/2h/1h/30m/5m reminders) is not scheduled at float-assignment time.** `process_float_lookup_assignment` inserts only a single `personal_shift` notification (`20260528000005:159-180`); ARCH §2.8 requires snapshotting the per-house cadence onto `scheduled_for` reminder rows. Likely Phase 12 scope (notifications), but the snapshot-at-assignment hook belongs in this RPC. Note for Phase 8 readiness.

**F-07-009 · Medium** — **The no-ack RPC marks only the first destination block's `hmod_notify_allied` step,** so a multi-block destination gap can emit multiple HMOD notifications (one from the RPC, others from the normal tick on the remaining blocks). BSpec §10.1 expects one notification with the time window. (`20260528000004:364-400`.)

**F-07-010 · Medium** — **The no-ack RPC records a no-ack as `declined_at = p_now`** (there is no `no_ack_at`); the distinction lives only in `float_exclusions.reason='no_acknowledgment'`. Semantically a no-ack is not a decline. Minor data-model conflation. (`20260528000004:252-255`.)

**F-07-011 · Medium** — **The pg_cron job depends on un-set GUCs `app.supabase_url` / `app.service_role_key`** (`20260528000002:90-102`); if unset the tick silently never runs, and storing the service-role key in a readable GUC is a secret-management concern.

**F-07-012 · Low** — **`is_hm_working_time` is marked `IMMUTABLE` but performs `AT TIME ZONE` conversion** (depends on tzdata) — should be `STABLE`. Could cause incorrect plan caching across tz updates. (`20260528000004:141-152`.)

**F-07-013 · Low** — **`resolve_hm_for_user` depth-10 exhaustion returns NULL silently** instead of the spec's "flag config error, notify the chain + HMOD, route to HMOD" (ARCH §2.7:272). Safety-net path, unlikely to hit. (`20260528000004:84-106`.)

**F-07-014 · Low** — **`expirePendingSwaps` queries the not-yet-existing `swap_requests` table and swallows the error.** Forward/dead code for Phase 9; ARCH §4.1 #5 swap expiry is a no-op until then. Acceptable graceful degradation. (`orchestrator-tick/index.ts:945-964`.)

**F-07-015 · Low** — **Automated floats use `pending_float_in` while ARCH §3.3 describes that status as force-triggered-specific,** leaving ambiguous whether the calendar shows "(Pending)" for automated floats (BSpec §11.1 ties "(Pending)" to force-triggered). Open question Q-P7b. (`20260528000005:138-145`.)

*(Phase 7 strengths confirmed: the three chain-step RPCs are atomic and idempotent (`ON CONFLICT DO NOTHING` + `rolled_back→fired` re-fire); `process_no_ack_float` takes `FOR UPDATE` on the float and is idempotent; the broadcast query correctly omits the role filter per ARCH §4.2; the §4.6 routing condition (HM only when *both* fire-time and block-start are in HM hours) is correct; the `on_float_failure` trigger correctly suppresses `hmod_notify_allied` when a float was assigned; the 1-minute cron + ~3h lookahead matches §4.1/§4.3. The original 003 no-ack bugs (A-1 `total=0` branch, A-2 destination `displaced_decliner`, B-3 missing `FOR UPDATE`, B-1 split notification) are genuinely fixed by 004/005/006/007 — the audit loop worked for those.)*

---

## 3. Cross-Phase Findings

**X-1 · Critical (theme)** — **World-executable `SECURITY DEFINER` RPCs.** F-03-001 (`generate_blocks_for_*`), F-04-001 (`publish_schedule`), F-04-002 (`submit_preferences`) all lack `REVOKE … FROM PUBLIC`. Phase 7's RPCs established the correct pattern (`REVOKE`/`GRANT TO service_role`); Phases 3–4 must be retrofitted. Any authenticated JWT can today materialize the calendar, publish schedules, and write preferences as any user.

**X-2 · High** — **`user_has_house_admin_role` semantics drift between phases.** Phase 2 defines it HM/BM-only; Phase 4 `CREATE OR REPLACE`s it to add `sm` (F-04-004). This retroactively changes Phase 3's `shift_block_assignments` SELECT policy and Phase 6's `float_assignments` policies (F-03-002), granting SMs HM/BM-equivalent visibility/authority the TEST_PLAN explicitly warned against. Fix: revert to HM/BM-only and introduce a separate `user_can_build_schedule` for the schedule-builder.

**X-3 · High** — **Re-export/duplication pattern hides divergence in three modules.** `phase1Grouping` (Phase 4, F-04-005), `crossHousePickup`/`cross-house` and `hours`/`scheduling-hours` (Phase 5, F-05-009): in each case the _tested_ implementation lives in `scheduling/` (or `users/`) and a re-export wrapper is exported from the package root — but for grouping the wrapper is a _different_ implementation, and for hours the wrapper exposes a _different signature_. The pattern (test-contract path ≠ package-API path) recurs from Phase 2 (`users/eligibility.ts`, F-02-007). Consolidate each to a single source of truth.

**X-4 · High** — **Forward regressions via `CREATE OR REPLACE`.** Phase 7 redefining `send_preference_reminders` (F-07-006) and Phase 4 redefining `user_has_house_admin_role` (X-2) both changed earlier-phase behavior with no signal at the original definition site. This is the exact "compounding defect" pattern the audit brief flagged. Recommendation: forbid cross-phase `CREATE OR REPLACE` of a prior phase's function without a migration comment cross-referencing the original and a test pinning the combined behavior.

**X-5 · Medium** — **Enum-vs-text inconsistency.** Phases 1–3 use `CREATE TYPE` enums; Phase 6 uses `text + CHECK` for `float_assignments.status`/`initiated_by` and `float_exclusions.reason` (F-06-002). Standardize on enums for generated-type strength and codebase consistency.

**X-6 · Medium** — **Tested ≠ deployed for the orchestrator.** The Phase 7 vitest validates `packages/core/src/orchestrator/` + `escalation/`, none of which the production EF imports (F-07-004). The deployed logic is the EF's inline `evaluateChainSteps` + the SQL RPCs/helpers. Either wire the core modules into the EF or retarget the tests at the SQL.

**X-7 · Medium** — **`displaced_decliner` semantics.** Introduced for the floater's _source_ seat (ARCH §3.3); Phase 7's original 003 mis-applied it to _destination_ blocks (fixed in 004 — F-07 chronology). Confirm no other code path uses it for a non-source vacancy.

**X-8 · Low** — **The custom `<@` operator (F-02-003) couples four phases' test suites to a Phase 2 production migration.** Removing/relocating it is a cross-phase change.

**Cross-phase consistency that PASSED:** the status enum (8 values) and `vacancy_origin` enum (6 values) are consistent across Phases 3–7; the `occurrence_count→weeks_remaining` rename is complete repo-wide; the Harnwell training invariant is enforced in the float algorithm (Phase 6), the claim handler (Phase 5), and is gated in the cross-house module; the America/New_York zone is used consistently (though duplicated as a literal in ~6 files — minor).

---

## 4. Test Suite Assessment

**Tautologies / tests against non-deployed code:**

- **The Phase 7 vitest suite (3 of 4 files) tests code that does not run in production** (F-07-004/X-6): `escalation-timing`, `notification-routing`, `no-ack-trigger` target `packages/core/src/orchestrator/*`, which the EF neither imports nor uses. The deployed routing/no-ack is SQL; the deployed chain-evaluation is an EF inline copy.
- **The Phase 4 grouping test targets the unreachable implementation** (`scheduling/phase1Grouping.ts`), while the package exports the _untested_ `schedule-builder/phase1-grouping.ts` (F-04-005).

**Green tests masking real bugs:**

- **Phase 5 cap tests** install an explicit `weekly_cap_overrides` row or rely on the no-calendar fallback, so the buggy default-cap computation (F-05-001/002) is never exercised (F-05-003).
- **Phase 2 swap-counterparty test** asserts HM exclusion that the spec does not mandate (F-02-002) — a green test pinning wrong behavior.

**Coverage gaps (spec'd behavior with no failing test):**

- No pgTAP for the Phase 6 migration (float tables, trigger, FK, RLS) — F-06-003.
- `submit_preferences`, `send_preference_reminders`, `publish_schedule` authorization, and the broadcast-subscription EF are untested — F-04-006, F-02-006.
- No negative-path (constraint-rejection) or runtime-RLS-deny tests in Phase 1/2 — F-01-011, F-02-005.
- `blocksBetween`, `isEligibleForScheduleRoster` untested — F-03-007, F-02-008.
- Float-algorithm multi-run-with-uncoverable-largest-run scenario untested — F-06-001.
- HMOD Monday-handoff and leave-anchoring edge cases untested at the deployed (SQL) layer — F-07-001/002.

**Tests that are correct and load-bearing (keep):** Phase 3 DST regression tests (45/50-block resolution); Phase 5 T-2h exact-boundary + race + cross-house-matrix + atomicity + reclaim; Phase 6 chunking/tiebreaker/minimum-chunk/partial-coverage/integration; Phase 7 pgTAP RPC suites (which _do_ test the deployed SQL). The Phase 6 pure-function suite is the strongest in the repo.

---

## 5. Prioritized Remediation Plan

Ordered by risk and dependency. Each item is tagged **[migration]**, **[code]**, or **[test]**.

### Batch A — Release-blocking authorization & data integrity (do first, independent)

1. **[migration]** F-03-001: `REVOKE`/`GRANT` on `generate_blocks_for_date`/`_range`.
2. **[migration]** F-04-001 + F-04-002: `REVOKE`/`GRANT` + identity/role checks on `publish_schedule`, `submit_preferences`. Audit _every_ Phase 3–6 `SECURITY DEFINER` function for the same omission in this pass.
3. **[migration]** F-04-003: resolve the publish-vs-generate conflict (decide: publish UPSERTs over `never_assigned` vacant rows, **or** the generator does not pre-create rows for `regular_school_year`). Requires a design decision (Q-P4).

### Batch B — Hours-cap correctness (single migration, high blast radius)

4. **[migration]** F-05-001 + F-05-002: rewrite `effective_weekly_cap` to compute the default from all `operating_calendar` days in the Monday→Sunday window and to consult `break_periods` for spring-fling. **[migration]** F-01-001 + F-01-002: re-add the `hours_cap IN (20,40)` and the magnitude↔enforcement pairing CHECKs. **[test]** F-05-003: add straddling-week and spring-fling-week cap tests that exercise the default path; flip the F-01-001 test to assert the CHECK.

### Batch C — Orchestrator routing & float correctness (Phase-8-blocking)

5. **[migration]** F-07-001: fix `resolve_hmod_on_duty` for the Monday-08:00 handoff. F-07-002: anchor HMOD leave checks to the interval start date. F-07-003: decide the project-admin notification target.
6. **[code]** F-07-005: compute `hasConflictingFloat`/`hasConflictingCrossHousePickup` in `buildFloatLookupSnapshot` (or add a source-status `FOR UPDATE` re-check in `process_float_lookup_assignment`).
7. **[code]** F-06-001: fix the source loop to try all runs ≥2 before abandoning a source. **[test]** add the interior-hole regression.
8. **[code/test]** F-07-004/X-6: wire the EF to the core orchestrator modules (or delete them and retarget the vitest at the SQL); port routing edge cases into `phase-07-hmod-notify-rpc.sql`.

### Batch D — Cross-phase consistency (sequence after A–C)

9. **[migration]** X-2/F-04-004: revert `user_has_house_admin_role` to HM/BM-only; add `user_can_build_schedule` and re-point the draft policies.
10. **[migration]** F-07-006: restore the `role IN ('sw','sm')` filter in `send_preference_reminders`.
11. **[migration]** F-02-001/F-01-005: add the `hmod_rotor.hmod_user_id` FK (+ the hm/bm-role trigger, F-01-007).
12. **[code]** X-3: collapse the duplicate `phase1Grouping` / `crossHousePickup` / `hours` modules to one source each; expose the §9.1 hours decomposition at the package root.

### Batch E — Schema hardening & missing constraints (one migration, batchable)

13. **[migration]** F-03-004/005 (status↔user_id, parent_float_id↔is_float CHECKs); F-01-003 (scheduling_periods profile); F-01-006 (claim-phase-null CHECK); F-01-008a/b (JSON shape); F-01-009a/b (date-range exclusions); F-06-002 (text→enum for float tables); F-02-009/010, F-01-010/014/015.

### Batch F — Behavioral completeness (Phase-8-adjacent)

14. **[code]** F-05-004 (allow dropping float-out rows); F-05-005 (reject past-block drops); F-05-006 (headcount-gated escalation flag); F-05-007 (reject `claim_type='permanent'`).
15. **[code]** F-07-007/008: build acknowledge/decline handlers and schedule the ack cadence (or formally defer to Phase 12 with a tracked dependency for Phase 8 force-trigger).

### Batch G — Test, docs, hygiene (low risk, anytime)

16. **[test]** F-04-006, F-02-006, F-06-003, F-01-011, F-02-005, F-03-007, F-02-008.
17. **[code/docs]** F-00-001..014 (template hygiene, tooling, CI), F-00-007 (PHASE_PLAN), F-02-003/F-00-013/F-06-006 (test-only operator, committed `.js`), assorted nits.

**Migration batching note:** Batches A, B, C-5, D, E are new forward migrations (do not edit shipped migrations). Batch C-6/7/8 and F are code-only. Most of Batch G is code/test/doc-only. Run the full pgTAP + vitest suite after each batch; Batch B will (correctly) require updating the F-01-001 and cap tests.

---

## 6. Phase 8 Readiness Checklist

Phase 8 (force-trigger endpoint) must not start until **all** of the following are true:

- [ ] **No world-executable mutating RPC.** Every `SECURITY DEFINER` function has `REVOKE … FROM PUBLIC` + explicit `GRANT` (Batch A). _(F-03-001, F-04-001, F-04-002)_
- [ ] **`effective_weekly_cap` is per-week and spring-fling-aware,** with tests exercising straddling and spring-fling weeks. _(F-05-001/002/003, F-01-001/002)_
- [ ] **The float lookup algorithm covers all runs ≥2 per source** (no premature Allied), with a regression test. _(F-06-001)_
- [ ] **The orchestrator snapshot computes the float/cross-house conflict flags** (no stubbed `false`). _(F-07-005)_
- [ ] **HMOD resolution honors the Monday-08:00 handoff and interval-start leave anchoring,** tested at the SQL layer. _(F-07-001/002)_ — Phase 8 force-trigger relies on `resolve_hmod_on_duty` for HMOD authorization (ARCH §6.2).
- [ ] **The deployed orchestrator logic is the tested logic** (EF imports core, or tests target SQL). _(F-07-004/X-6)_
- [ ] **`user_has_house_admin_role` is HM/BM-only;** SM authority is a separate, scoped helper. _(X-2/F-04-004)_ — Phase 8 force-trigger authorizes SM/HM/BM at the destination house.
- [ ] **`hmod_rotor.hmod_user_id` has its FK** (and ideally the hm/bm-role trigger). _(F-02-001/F-01-005/F-01-007)_
- [ ] **A decision is recorded on acknowledge/decline handlers** (F-07-007) and the ack cadence (F-07-008): either built, or explicitly deferred with Phase 8 documented as creating pending floats that can currently only no-ack. — **This is the most important Phase-8-specific gap:** force-trigger's entire value is creating _pending_ floats, and there is no path for a worker to accept one.
- [ ] **The publish flow works end-to-end** (generate → draft → publish) on a real calendar. _(F-04-003)_
- [ ] **`send_preference_reminders` no longer targets BMs/pure-HMs.** _(F-07-006)_
- [ ] **Schema invariants for `shift_block_assignments`** (status↔user_id, parent_float_id↔is_float) are enforced, so Phase 8's force-trigger writes can't produce illegal states. _(F-03-004/005)_

---

## 7. Open Questions (require user adjudication)

- **Q-P2** — Should HMs be eligible swap counterparties? §13 implies yes (HM ⊇ SM ⊇ SW capabilities); the code and a test say no. _(F-02-002)_
- **Q-P4** — Publish-vs-generate (F-04-003): should `publish_schedule` UPSERT over the generator's `never_assigned` vacant rows, or should the generator not pre-create rows for `regular_school_year` dates? **Q-P4b** — Is publish per-house or per-period-all-houses? `scheduling_periods` has no `house_id`. _(F-04-008)_
- **Q-P5** — Does a cross-house pickup need to actively model home-side unavailability / create a home-side gap (BSpec §5.3), or is the time-conflict guard sufficient? _(F-05-011)_
- **Q-P7** — Are acknowledge/decline handlers and the ack cadence (BSpec §7) Phase 7 scope or deferred to Phase 12/13? Phase 8 force-trigger depends on at least acknowledge existing. **Q-P7b** — Should automated (not just force-triggered) pending floats render "(Pending)"? BSpec §11.1 ties the label to force-triggered. _(F-07-007/008/015)_
- **Q-Spec-1 (spec-vs-spec)** — BSpec Appendix A item 3 and ARCH Appendix C item 3 say acknowledgment reminders anchor to a "T-2h acknowledgment deadline," but BSpec §7.1, ARCH §4.4, and ARCH Appendix B all define the deadline as **T-10m before float start**. The body text is internally consistent and is what the (unbuilt) cadence should use; the two appendix items are stale. Confirm the appendices are the errors. _(doc drift, affects F-07-008)_
- **Q-Config-1** — Should the `claim_phase_*_offset_days` keys live in `system_config` (ARCH §3.10 key list) **and** `operating_profiles` (ARCH §2.2), or only the latter? ARCH §3.10 prose says profile-scoped params are _not_ in `system_config`, contradicting its own key list. _(F-01-004)_

---

_End of audit. No code, migrations, or tests were modified. Fixes await explicit user approval per the engagement terms._
