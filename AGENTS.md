# Shift@PennHousing — Agent Briefing

This file is read by Claude Code and Codex at session start.
It supplements but does not replace BEHAVIORAL_SPECIFICATION.md and ARCHITECTURE.md.

## Source of Truth Hierarchy

1. BEHAVIORAL_SPECIFICATION.md — what the system must do
2. ARCHITECTURE.md — how the schema and code enforce it
3. This file — repo conventions and agent guardrails
4. Test names — behavioral checklist (do not infer behavior from test bodies)

## Working Style — Ask Clarifying Questions First

Clarifying questions are essential here, not optional. When a request is ambiguous,
under-specified, or touches anything critical (behavioral invariants, data model, money/
hours, user-facing copy, irreversible changes), STOP and ask before proceeding — prefer
asking too many questions over proceeding on assumptions. It is far better to confirm
scope, trigger conditions, exact wording, and which surfaces/platforms are affected up
front than to build the wrong thing confidently. Surface the ambiguity, propose options
with a recommendation, and let the user decide. Proceeding "with a lot of ignorance" on
critical things is the failure mode to avoid.

## Hard Invariants (Behavioral §1.2, §1.5; Architecture §1.5)

1. **Harnwell training constraint**: no worker whose home_house != Harnwell may staff the
   Harnwell desk under any mechanism (scheduled, claimed, floated, picked up, force-triggered).
   Enforce in code at every assignment write point — not only in config tables.

2. **Float direction rules (config-driven with hard guards; amended 2026-07-02)**: which
   houses may source floats and to which destinations is the period's `float_routing`.
   School-year/breaks keep their fixed seed routing (Quad→11 houses, Harnwell→all). Summer
   floating is UNIVERSAL: the compiler auto-generates all-pairs routing (any open,
   multi-staffed house → any OTHER open house), so there is NO per-season routing table
   (`season_float_routes` was removed) and no routing UI. The class-based allowlist ("only
   Quad/Harnwell may source") was REMOVED from the pure algorithm. Two guards stay hardcoded
   and are never trusted from config: (a) a source desk never drops below one present
   worker — `sourceHasFloor`/`workerBlocksRespectSourceFloor` in
   `packages/core/src/float-lookup/eligibility.ts`, which is what makes a single-staffed
   house unable to source; (b) Harnwell is never a float destination — the short-circuit in
   `float-lookup/index.ts` + the `float_routing` legality trigger (20260702000005). Harnwell
   MAY source. The Harnwell TRAINING invariant (#1) is independent and still enforced at
   every write point. See [[project_admin_operating_seasons_plan]] and docs/operating-seasons/PLAN.md.

3. **No-takeback rule**: once a float is `pending` or `acknowledged`, automated systems may
   not revoke it. Only manual SM/HM/BM override may.

4. **Hours cap is not checked on float assignment.** Floats relocate already-scheduled hours;
   total weekly hours unchanged. Cap checks apply to claim, swap, pickup — never float.

5. **Block atomicity**: every shift operation works in 30-minute blocks on 30-minute boundaries.
   No sub-block operations exist. Ever.

6. **Time zone**: all timestamps are `timestamptz` in America/New_York. Never use naive
   timestamps. Never do wall-clock arithmetic for DST-crossing intervals — use duration arithmetic.

## Conventions

- **Emulator/simulator verification: iOS only, not Android.** When a mobile build requires
  running/verifying on an emulator, use the iOS Simulator (`xcodebuild` + `simctl`, see
  `apps/mobile/iosApp/README.md`), never the Android emulator. Reason: the user runs a
  customized Android Studio setup that can build/launch the Android app independently
  (without AStudio open), and does not want two emulators running concurrently. This
  applies regardless of which platform's source changed, unless the user explicitly asks
  for Android verification.
- **No em dashes in user-facing text.** Any string a user can ever see or that is stored
  for later display — UI copy, button/label/toast/error/empty-state text, notification
  titles/bodies, seeded or migration-stored display strings, anything surfaced on web or
  mobile — must NOT contain an em dash (`—`) or en dash (`–`). Re-punctuate with a period,
  comma, colon, or parentheses as the sentence needs. This applies to BOTH platforms (web +
  mobile) and to stored copy, not just inline literals. Code comments, log lines, and other
  non-surfaced text are exempt (em dashes there are fine and need not be touched).
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
- Commits: one commit per distinct feature/change-set — group only the files that
  ship together (migration + its tests + the code + docs for that feature), and keep
  unrelated features in separate commits. Never bundle multiple distinct features into
  one commit. Use a conventional-commit subject (`type(scope): summary`). When the
  working tree mixes features, stage by path per feature; cross-cutting files
  (shared models, docs) go in the commit of the feature that drives them.
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

- [Phase 00] House names + ids (REAL, set 2026-07-02): the 13 houses are `harnwell`
  (Harnwell), `quad` (Upper Quad), `lower-quad` (Lower Quad), `gregory` (Van Pelt /
  Gregory), `harrison`, `hill`, `kings-court` (Kings Court English), `lauder`, `mayer`,
  `du-bois`, `gutmann`, `radian`, `rodin`. The old placeholder ids `house-03..house-13`
  are GONE. `harnwell` and `quad` ids are LOAD-BEARING (hardcoded in ~10 migrations +
  core float/swap logic for the training constraint + Quad float precedence) — never
  rename them. The other 11 ids are safe data (only referenced in seed + tests). Renamed
  via a mechanical perl pass across seed.sql + supabase/tests + tests/e2e-lifecycle +
  docs/float-testing (2026-07-02); migrations/app code never hardcoded them.
- [Phase 01] Houses: Harnwell (2-staff) and Upper Quad (`quad`, 3-staff) have special
  rules throughout; the other 11 are single-staff by default.
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
  full coverage → leading portion → largest consecutive span (with non-trailing
  filter on the first iteration at each source). Each tier's span must be
  >= `MIN_FLOAT_CHUNK_BLOCKS`. **UPDATED 2026-06-30: `MIN_FLOAT_CHUNK_BLOCKS`
  was lowered 2 → 1** (BSpec §6.2 #4 / §14; ARCH §5.2/§5.3), so single-block
  spans are now absorbed by floats instead of routed to Allied (goal: minimize
  Allied procurement). A block reaches Allied only when NO eligible worker can
  cover it, never merely for being 1 block. The tiering structure is unchanged;
  only the floor moved. `minimum-chunk.test.ts` was rewritten to assert
  single-block absorption. Document any further change to this tiering/floor in
  both `tests/PHASE_06/TEST_PLAN.md` and the header comment on
  `chooseCandidateForCurrentRun`.
- [Allied-cap] **Allied is secured at most 4 hours (8 blocks) per pass**
  (BSpec §5.4 / §14; ARCH §5.2 step 5; stakeholder decision 2026-06-30). The
  pure float algorithm has no gap cap; the ORCHESTRATOR bounds it:
  `orchestrator-tick`'s `loadVacantGap` builds a contiguous vacant gap of at most
  `MAX_ALLIED_COVERAGE_BLOCKS = 8` before snapshotting the algorithm input (query
  window `.lt start + 8*blockMinutes` + a defensive length truncate). So a single
  securing floats/Allied-notifies ≤4h; the remainder stays vacant + claimable and
  re-escalates per block. The per-block chain step (`hmod_notify_allied`) is
  inherently 30-min/fire, so it needs no cap. The no-ack void
  (`process_no_ack_float`) emits ONE Allied notification spanning the whole float,
  which is drawn from the capped gap, so it is transitively ≤4h. Do NOT raise
  loadVacantGap's window without also raising the documented cap.
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
- [Phase 12] Notification delivery is asynchronous: `deliver_pending_notifications`
  enqueues `dispatch-push` calls through pg_net, and the Edge Function re-checks
  `pending_notification_deliveries` before sending so a float acknowledged after
  enqueue is still suppressed. Deployed environments must configure the Postgres
  settings `app.supabase_url` / `app.service_role_key` and the Edge Function secret
  `FIREBASE_SERVICE_ACCOUNT_JSON`. Firebase routes both FCM and APNs device tokens
  (iOS clients must register their Firebase FCM registration token, not a raw APNs
  token; `dispatch-push` does not branch on `push_tokens.platform`).
- [Phase 12] BOTH float-assignment paths must snapshot the ack-reminder cadence
  (BSpec §7.1: reminders fire "whether through automated lookup or force-trigger").
  The cadence logic lives in ONE helper, `snapshot_float_ack_reminders`
  (20260601000002), called by `process_float_lookup_assignment` AND
  `force_trigger_float`. Do not re-inline it — the force-trigger path originally
  omitted it (audit gap). Cadence semantics (ARCH §2.8): a NULL `reminder_6h_offset`
  /`reminder_2h_offset` means the SYSTEM DEFAULT (-6h/-2h), **not** suppression;
  suppression is the separate `reminder_6h_enabled`/`reminder_2h_enabled = false`
  flag. null offset != suppressed.
- [Phase 12] Push delivery is intentionally AT-LEAST-ONCE. The once-a-minute
  `deliver_pending_notifications` cron can re-enqueue an in-flight notification; the
  `dispatch-push` re-check + idempotent `deliver_notification` bound it, but a
  dispatch straddling a minute boundary may push twice. Do NOT "fix" this by stamping
  `delivered_at` before sending — §10.1 personal notifications are mandatory, so a
  rare duplicate is preferable to a lost push.
- [Phase 13a] `@Volatile` in `commonMain` MUST be `kotlin.concurrent.Volatile`
  (import it explicitly). The bare `@Volatile` resolves to `kotlin.jvm.Volatile`,
  which compiles on the Android/JVM target but is an `Unresolved reference` on
  Kotlin/Native — so `:shared:testAndroidHostTest` + `:androidApp:assembleDebug`
  stay green while iOS silently breaks. Always validate shared changes with
  `:shared:compileKotlinIosSimulatorArm64` (fast) before assuming KMP-clean; the
  full `:shared:linkDebugFrameworkIosSimulatorArm64` additionally exercises SKIE's
  Swift export (~50s).
- [Phase 13a] The worker app's pure decision surface
  (`shared/src/commonMain/.../{model,shifts,ack}` + the two thin `viewmodel`
  StateFlow wrappers) is the ONLY tested surface (45 kotlin.test cases on the JVM
  host). Everything else — the Supabase client (`network/`), the `data/`
  repository (Postgrest + Realtime), the `platform/` expect/actual hooks, the
  Compose/SwiftUI screens — is the data/UI layer the test plan scopes out, the
  mobile analogue of the Edge/HTTP layer phases 07–12 excluded. The ViewModels take
  a snapshot + injected `now`; never read a clock inside the tested logic. `claim`
  on `ShiftsScreenViewModel` is an optimistic local move like `drop`/`reclaim`
  (the server write is out of scope) — added for the demo/Maestro UI, not tested.
- [Phase 13a] Firebase is a DEPLOY-TIME config, not committed (mirrors phase-12's
  "deployers configure Firebase"). Android: `firebase-messaging` is a normal dep
  and compiles, but the `com.google.gms.google-services` plugin is intentionally
  NOT applied (no `google-services.json`), so `assembleDebug` is green; FCM-token
  acquisition is wrapped in `runCatching` and no-ops without a default FirebaseApp.
  iOS: `AppDelegate` guards Firebase with `#if canImport(FirebaseMessaging)` so the
  app builds before the SPM package is added. Both POST the _FCM_ token (iOS derives
  it from APNs via Firebase) to `register-push-token`, platform `"android"`/`"ios"`.
- [Phase 13a] supabase-kt is pinned via its BOM (`io.github.jan-tennert.supabase:bom`
  3.1.1) with ktor 3.0.3 engines per platform (OkHttp `androidMain`, Darwin
  `iosMain`); the shared push POST uses a no-arg Ktor `HttpClient()` that resolves
  its engine from the classpath. The Realtime subscription deliberately carries NO
  server-side user filter — RLS scopes rows to the authed worker, and any change
  triggers a refetch ("no manual refresh"); this also dodges the version-variable
  `postgresChangeFlow` filter DSL. App config reaches `commonMain` via the
  `AppConfig` holder (Android `BuildConfig` → it; iOS `Info.plist` → it), NOT a
  `BuildConfig` reference inside `commonMain`.
- [Phase 13a] The Maestro selector contract (`apps/mobile/maestro/README.md`) is
  load-bearing: the My-Shifts section CONTAINERS (`section_picked_up` /
  `_dropped` / `_scheduled`) must always render (with an empty-state placeholder)
  so `01-view-my-shifts` passes when a section is empty, and a 4th **Updates** tab
  (`tab_updates` → `pending_float_notification`) surfaces the float so
  `04-acknowledge-float` can open the ack modal without it auto-covering the screen
  on every launch. Maestro runs against a real emulator/simulator — not verifiable
  from the JVM host; run it manually per the verification checklist.
- [Phase 13a] My-Shifts week navigation: `ShiftsScreenViewModel` carries a
  `weekOffset` (mirrors `CalendarViewModel`) and scopes the My-Shifts tab to the
  shown NY week via `shiftsInWeekOf` (calendar/), so a pickup/drop landing in a
  future week shows under that week. `ShiftsUiState` exposes `weekOffset` /
  `weekRangeLabel` / `weekHours` (the shown week's held hours — the "This week —
  Xh" chip now reads from state, not the host's `currentWeeklyHours`, which still
  feeds the open-shift CLAIM meter since claiming is always current-week). The
  OPEN-shift feeds (Tabs 2/3) are NOT week-scoped. The Android `WeekHeaderCard` /
  `WeekPickerSheet` are shared with Calendar (parameterized tags + optional
  template row); My-Shifts selectors are `myshifts_week_picker_open` /
  `_prev_week` / `_next_week` / `_week_picker_sheet` / `_week_picker_option`
  (flow `09-my-shifts-week.yaml`). DemoData seeds My-Shifts on fixed WEEKDAYS of
  the current+next NY week (deterministic, week-scope-friendly) — open shifts stay
  `now`-relative so they remain claimable. Reminder: the default `assembleDebug` is
  the LIVE build (login screen); use `-PSUPABASE_URL=` for the demo/login-bypass
  build that shows DemoData.
- [RSM] The Residential Services Manager (`user_role_enum` value `rsm`, added by
  20260617000005/…006; BSpec §2.3a) is HM-minus-HMOD. THREE invariants future
  agents must not break: (1) `rsm` is scope-required like sm/hm/bm (the
  `user_roles_scope_required_check` lists it); it joins `user_has_house_admin_role`
  (hm/bm/rsm) and `user_can_build_schedule` (sm/hm/bm/rsm). **NOTE (superseded
  2026-06-27 — see [Cross-house-schedule]):** the original "every write gate is
  STILL scope-matched, so cross-house stays read-only" is NO LONGER true — the
  elevated tier (hm/bm/rsm) now has cross-house *schedule* write. People admin /
  leave / cap stay own-house via the unchanged `user_has_house_admin_role`.
  (2) `rsm` is NEVER HMOD-eligible:
  do NOT add it to `hmod_rotor` population (apps/web/lib/data/rotor.ts stays
  `['hm','bm']`), `resolve_hmod_on_duty`, or the leave HMOD-transfer path. (3)
  In-hours Allied/no-ack notifications route to the RSM, not the HM (BSpec §10.1):
  `process_hmod_notify_allied_step` + `process_no_ack_float` call
  `resolve_rsm_for_house` (target `'rsm'`) in the `is_hm_working_time` branch,
  falling back to `resolve_hmod_on_duty`. Cross-house READ is the additive
  `user_is_rsm(auth.uid())` OR-clause on the shift_block_assignments /
  float_assignments / float_exclusions SELECT policies; the web reads via the
  service client so the switcher (canViewOtherHouses `isRsm`) is the real gate.
  RSM holds shifts like an HM (claim pool + builder roster; excluded from float
  lookup / broadcast / swap-counterparty). Manual-test seed: Diana per house
  (`diana-<house>@upenn.edu`, person_num 11).
- [Coverage] **Coverage floor is ONE worker, not required headcount** (BSpec §5.4,
  revised 2026-06-23). The automated escalation chain (broadcast → float → Allied)
  fires for a block ONLY when the desk would otherwise be EMPTY (zero present). A
  multi-staff desk (Quad 3 / Harnwell 2) with ≥1 worker still on is covered; its
  remaining vacant seats are NOT broadcast/floated/Allied — they stay passively
  claimable in the open-shifts feed. Full headcount is a BUILD-time target only.
  Enforced in `orchestrator-tick/index.ts` via `loadCoveredBlockIds`
  (`PRESENT_STATUSES` = scheduled/claimed/floated_in/pending_float_in/allied):
  `processVacantBlocks` skips covered blocks and `loadVacantGap` excludes them from
  the contiguous gap (so a staffed block also splits the run). This ALSO stops the
  old multi-tick fill-to-headcount loop (each float-in flips a seat to
  pending_float_in → block reads covered next tick). Do NOT revert this to a
  "below required headcount" trigger — that was the over-floating bug (Quad evening
  flooded with floats while a worker was still on the desk). Force-trigger is a
  deliberate manual override and is intentionally NOT gated by this floor.
- [Coverage-lock] **The pickup lock (T-2h unpickable cutoff) is COVERAGE-conditional,
  not clock-only** (BSpec §5.3/§5.4/§5.5, revised 2026-06-25). A vacant seat locks at
  T-2h ONLY when its desk would otherwise be EMPTY at that block (same coverage floor
  as escalation) — a desk that still has a real worker present is NEVER locked and stays
  claimable until `block_start_at`. The old `is_assignment_claimable` /
  `claim_open_shift` (20260527000006) gated purely on `block_start_at > now + 2h`, so a
  drop on a still-staffed multi-staff desk (e.g. double-staffed Harnwell) wrongly locked
  the seat. TWO present-sets, do NOT collapse them: escalation counts `allied` as present
  (stop escalating a desk Allied covers); the pickup lock does NOT count `allied` (a
  secured-Allied window stays LOCKED, never re-opened to pickup) — the "real worker"
  exemption uses {scheduled, claimed, floated_in, pending_float_in}. The lock is ONE-WAY
  per block (§5.5): once an empty desk hits its T-2h step, its seats stay locked even
  after a floater/Allied fills the desk. Recorded via a new `shift_blocks.coverage_locked_at`
  marker set by the orchestrator at the `float_lookup` / `hmod_notify_allied` step (NOT
  `broadcast`, T-3h is still claimable). Claimability is now SERVER-authoritative and
  exposed on the open-shifts read path; clients must consume it, not re-derive T-2h
  (the mobile `CLAIM_CUTOFF_BEFORE_START` / `isClaimable` carried the same clock-only bug).
  IMPLEMENTED 2026-06-27 (migration `20260627000001_coverage_conditional_pickup_lock.sql`):
  `coverage_locked_at` column + `block_has_present_worker()` + one-way `lock_block_coverage()`,
  rewritten `is_assignment_claimable` / `claim_open_shift`, and `worker_open_shifts` emits
  `desk_covered` + `coverage_locked`. orchestrator-tick locks in `floatLookupStep` +
  `hmodNotifyAlliedStep`. Mobile: `OpenShift.deskCovered`/`coverageLocked`, the new
  `isClaimable`, repo wire-row, coalesce merge-key (so blocks of differing claimability
  don't merge), DemoData `hw-covered`/`hw-locked`. Tests: pgTAP phase-05-feed-queries
  §6b + phase-05-claim §14; mobile OpenShiftPresentation/ShiftsScreenViewModel/Coalesce.
  Force-trigger (dormant) does NOT set the marker yet (flagged at impl, left for when it
  ships); §5.5 float-drop immediate re-escalation routes through the same step fns so it
  locks for free once wired.
- [Cross-house-schedule] **The elevated admin tier — HM, BM, RSM — may modify ANY
  house's SCHEDULE** (stakeholder decision 2026-06-27; migration
  `20260627000002_cross_house_schedule_admin.sql`). This REVERSES the old RSM
  "cross-house is read-only" invariant — but ONLY for the schedule. Mechanism: a new
  house-agnostic predicate `user_is_schedule_admin(uid)` (hm/bm/rsm anywhere; mirrors
  `user_is_rsm`), and `user_can_build_schedule` redefined to `(user_is_schedule_admin
  OR sm-scoped-to-house)`. So the gates that already ride `user_can_build_schedule`
  (`publish_schedule` 3-arg, `admin_assign_worker`/`admin_remove_worker`) and the
  draft/preferences/period_targets admin RLS (swapped from `user_has_house_admin_role`
  → `user_is_schedule_admin`) all become cross-house for hm/bm/rsm. **SM is UNCHANGED
  (own-house everywhere); SW unaffected.** THREE invariants future agents must not
  break: (1) `user_has_house_admin_role` is scope-matched FOR hm/bm/rsm — people admin
  (`hire_worker`/`fire_worker`, role grants), HM leave, and weekly cap stay OWN-HOUSE for
  them. Do NOT widen the hm/bm/rsm branch. **(Amended 2026-07-02: the new top-level `admin`
  role is the ONE exception — `user_has_house_admin_role` gained an unconditional
  `user_is_admin()` OR clause, so an admin is people-admin of every house. That widening is
  admin-only; the hm/bm/rsm scope match is untouched.)** (2) SM must never gain cross-house power: the sm branch
  of `user_can_build_schedule` stays `scope_house_id = house`. (3) Web write paths
  must target the VIEWED house, not the admin's own: use `writeHouseId(user, requested,
  validHouseIds)` (pages: schedule-builder, preferences) and `canBuildForHouse(user,
  houseId)` (actions: builder publish, override `authorizeForBlocks`, forceTrigger) in
  `apps/web/lib/auth.ts`; the switcher unlock + `canViewOtherHouses` take an
  `isScheduleAdmin` flag (hm/bm/rsm). The force-trigger EF/validator gained an
  `isScheduleAdmin` initiator flag (`validateForceTrigger`). Mobile is worker-only —
  no admin write surface, unaffected. Tests: `supabase/tests/cross-house-schedule-admin.sql`
  (13) + updated `rsm-role.sql` / `s1-admin-override.sql`; core `force-trigger-validation`
  + `hmod-context`. Hard invariants (Harnwell training, float direction, no-takeback,
  block atomicity, NY tz) are assignment-level and hold regardless of the acting admin.

- [Operating-seasons / admin role] **The `admin` role + admin-authored operating seasons
  ship the summer model** (2026-07-02; docs/operating-seasons/PLAN.md). Architecture:
  admin authors AUTHORING tables (`operating_seasons`, `season_house_windows`,
  `season_float_windows`, `operating_config_audit`; migration 20260702000003, admin-only
  RLS). Float routing is NOT authored: summer floating is universal, auto-generated by the
  compiler (`generateRoutes`: any open multi-staffed house → any other open house, Harnwell
  never a destination). → a PURE TS compiler
  (`packages/core/src/operating-seasons`, exported `compileSeason`) derives one PHASE per
  change-point and one compiled `operating_profiles` row per phase named `s_<slug>_<YYYYMMDD>`
  → `apply_compiled_season` RPC (20260702000006) materializes phases into the EXISTING 4
  runtime config tables and reconciles FUTURE blocks (`block_start_at > app_now()` only).
  So the orchestrator / generator / publish need NO summer special cases. FIVE things future
  agents must not break: (1) the compiler is pure/deterministic — no DB, no clock; temporal
  + calendar-collision guards live in the RPC, not the compiler. (2) `apply_compiled_season`
  dry-run = preview via a rolled-back subtransaction (RAISE SQLSTATE 'PT001' + swallow) so
  preview and apply share IDENTICAL logic — do not fork them. (3) Voiding a block deletes its
  vacant seats + sets occupied → `cancelled_config` + `shift_blocks.voided_at`; this makes
  voided blocks self-excluding on every status-filtered read path. The orchestrator scan +
  `is_assignment_claimable` + both house-grid views add an explicit `voided_at IS NULL`
  guard (20260702000007) as defense-in-depth. (4) Headcount decrease CANCELS the excess occupants
  (revised 2026-07-09, migration 20260702000006 body replaced by 20260709000003 — see
  the [Operating-seasons / band windows] note below); the OLD grandfather-on-decrease
  behavior is gone. The `enforce_block_occupied_headcount` TRIGGER (20260702000005) is
  UNCHANGED and still grandfathering-aware (it only checks writes that INCREASE a block's
  occupied count) — that tolerance is still needed for swaps/drops on a transiently
  over-capacity block; do not revert it to the old unconditional check. (5)
  `scheduling_periods.profile_name` was widened (20260702000006) to admit `s_%` profiles
  (summer is SM-built and needs a period row); the builder reads staffing per-date via
  `operating_calendar`, not the period profile. Web: `/admin/operations` (admin-gated,
  `isAdmin`). Mobile unaffected (worker-only; all filtering is server-side).

- [Operating-seasons / band windows] **A house window carries per-day-type staffing BANDS,
  and downsizing CANCELS excess workers** (2026-07-09; migrations 20260709000002 +
  20260709000003). Two changes future agents must not undo: (1) `season_house_windows` no
  longer has `headcount`/`shift_start`/`shift_end`/`days` — a window is `(house, date range,
  weekday_bands jsonb, weekend_bands jsonb)` where each band is
  `{block_start, block_end, headcount}` (00:00 end = 24:00) and an empty list = closed that
  day type. This lets one window express intraday-varying staffing (e.g. Harnwell single
  05:30-12:00 then double 12:00-00:00 weekdays, double all weekend) and weekday/weekend
  differences without stacking rows, so the `season_house_windows_no_overlap` constraint
  stays date-range-only (one editable window per house per range). The compiler
  (`HouseWindowInput.weekdayBands/weekendBands`, `validateBands`) and the RPC's
  staffing-pattern writer read the bands straight through. The web editor
  (`SeasonEditor.tsx` per-house `BandColumn`) supports in-place EDIT via `saveHouseWindow`
  (insert when no `windowId`, update when present). (2) On a future-block headcount decrease,
  `apply_compiled_season` now CANCELS the excess occupants (no grandfathering) with a fixed
  cut order: external floaters first (`floated_in`/`pending_float_in`), then the shorter
  shift (fewest occupied blocks at that house on that NY date — a per-(worker,house,date)
  rank so the cut is coherent across the overlap), then `assignment_id`. Cancelled workers
  are notified (`shift_cancelled_config`) and inbound floats on a cut seat are voided
  (`float_cancelled_config`), mirroring the house-close path. The `blocks_grandfathered`
  impact counter is retired from the SEASON path (breaks keep their own). This is an admin
  config action, so voiding floats does NOT violate the no-takeback invariant (that governs
  AUTOMATED revocation only). Tests: `packages/core/tests/operating-seasons/compile.test.ts`
  (19), `supabase/tests/apply-compiled-season.sql` (16), schema test bands inserts.
