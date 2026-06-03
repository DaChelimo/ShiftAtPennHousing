# Shift@PennHousing — End-to-End Lifecycle Verification · MASTER PLAN

> **Authored 2026-06-03** by the exploration session that holds full context after all 14
> phases. This file is the **source of truth** for the e2e-lifecycle program. It is written
> so a _fresh_ Claude Code session can execute one chunk cold — read it, do the chunk, verify
> green, end. Do **not** re-explore what §2 already establishes; if §2 is wrong, fix §2.
>
> Execution model (chosen by the user): **plan-as-artifact + a fresh session per chunk**, each
> verifying an objective green gate before it ends. The plan is the memory; sessions are
> interchangeable; git + the green gate are the source of truth.

---

## §0. Per-session ritual — READ FIRST, EVERY SESSION

1. Read this file (`PLAN.md`) and `STATUS.md` (the live ledger) **in full**.
2. In `STATUS.md`, find the first chunk **not** marked ✅ whose dependencies are all ✅. That is your chunk.
3. Read **only** the source files your chunk brief (§3) names. Trust §2 for everything else.
4. Implement the chunk.
5. Run the chunk's **exit gate** (a specific command in §3). It must pass. If it cannot, stop and write the blocker into `STATUS.md` — do not fake green.
6. `git add` + commit with the chunk id in the message (e.g. `e2e-lifecycle S2: realistic seed + allocator`).
7. Update `STATUS.md`: mark your chunk ✅, paste the green-gate output, note any deviation/decision, set the **Next action** line.
8. **Stop.** Do not start the next chunk. A new session takes it.

Guardrails: never edit `supabase/seed.sql` or any `a…/b…/c…/d…`-prefixed seed row (those are the phase-13b fixtures other green tests depend on). Never point Supabase at a remote URL. The local stack is already running (`supabase status` to confirm).

---

## §1. Goal & locked decisions

**Goal.** Prove the whole system works end-to-end by (a) running every existing test layer and recording the real state, (b) seeding a realistic all-houses environment, (c) allocating a published schedule with intentional gaps, and (d) driving the full shift lifecycle — claim → drop → cross-house pickup → float (automated + force-triggered) → ack / no-ack / decline → HMOD escalation → swaps — deterministically, asserting state + scheduled notifications at each step. Reliability bar: deterministic and repeatable (CI-able), covering the hard invariants and the fault-tolerant fallbacks.

**Locked decisions (do not relitigate):**

- **Seed is SEPARATE and NON-DESTRUCTIVE.** New `e…`-namespace rows layered on top of the existing config seed. Never mutate/delete the phase-13b Quad fixtures or `supabase/seed.sql`. Config tables (`houses`, `operating_profiles`, `staffing_patterns`, `float_routing`, `system_config`) are shared **read-only** reference — already seeded by `db reset`.
- **Notifications verified DB-observable only.** Assert rows in `notifications` and the output of `pending_notification_deliveries(p_now)`. Do **not** call `dispatch-push` / Firebase.
- **Time is injected, never waited on.** Drive the pure RPCs with explicit `p_now` / `p_as_of`; bypass the `orchestrator-tick` Edge Function (it reads the wall clock). See §2.5.

---

## §2. Reference appendix — established facts (don't re-derive)

### §2.1 Repo & test-layer commands

| Layer                | Command (from repo root)                                                                                | DB?          |
| -------------------- | ------------------------------------------------------------------------------------------------------- | ------------ |
| Static               | `pnpm turbo run lint type-check`                                                                        | no           |
| TS logic (Vitest)    | `pnpm --filter @shift/core test`                                                                        | no           |
| Web build            | `pnpm --filter @shift/web build`                                                                        | no           |
| DB logic (pgTAP)     | `supabase test db`                                                                                      | yes (resets) |
| Web E2E (Playwright) | `pnpm --filter @shift/web e2e`                                                                          | yes (seeded) |
| Mobile shared unit   | `cd apps/mobile && ./gradlew :shared:testAndroidHostTest` (+ iOS `:shared:iosSimulatorArm64Test`)       | no           |
| Mobile build         | `cd apps/mobile && ./gradlew :androidApp:assembleDebug` ; `:shared:linkDebugFrameworkIosSimulatorArm64` | no           |
| Mobile E2E           | `maestro test apps/mobile/maestro/` (needs emulator + installed app)                                    | emulator     |

**What actually exists** (verified 2026-06-03, correcting an earlier mis-read):

- **27 pgTAP files** in `supabase/tests/` (`phase-01-schema.sql` … `phase-13b-leave-submit-and-return.sql`). `supabase test db` runs them. The dir is **not** empty.
- **25 Vitest files** in `packages/core/tests/` (phases 02–14).
- **Playwright**: `apps/web/e2e/{schedule-builder,hm-leave,cap-modification}.spec.ts` + `helpers.ts`. (Memory says green; the static read guessed "TDD-red" — **settle this empirically in S1, do not assume**.)
- **Maestro**: 4 flows in `apps/mobile/maestro/`.
- **18 Edge Functions** in `supabase/functions/` (incl. `orchestrator-tick`, `force-trigger`, `create-swap`, `accept-swap`, `claim-shift`, `break-claim`, `drop-shift`, `permanent-drop`, `permanent-pickup`, `dispatch-push`, `modify-weekly-cap`).
- **52 migrations**, latest `20260601000004_phase_14_admin_extras.sql`.

Local stack (from `supabase status`): URL `http://127.0.0.1:54321`; DB `postgresql://postgres:postgres@127.0.0.1:54322/postgres`; service key is the **Secret** key shown by `supabase status` (new `sb_secret_…` format — works as the supabase-js key). Read keys at runtime from `supabase status -o env` (do **not** hardcode).

### §2.2 Houses & config (already seeded by `db reset`)

13 houses: `harnwell`, `quad`, `house-03`…`house-13`. Operating window all houses/days **08:00–24:00** (32 × 30-min blocks). Headcounts (regular_school_year & short_break): **harnwell 2, quad 3, single-staff 1**. Winter break: harnwell only (1), all others closed.

3 operating profiles: `regular_school_year` (cap 20 **soft**, `sm_built`, **float_enabled**), `winter_break` (cap 40 **hard**, `claim_based`, float **off**), `short_break` (cap 40 hard, `claim_based`, **float_enabled**). Escalation chain for float-enabled profiles: `broadcast` @ −3h, `float_lookup` @ −2h, `hmod_notify_allied` @ −2h on float failure.

Float routing (regular & short break): **Quad → all 11 single-staff houses** (precedence 1); **Harnwell → all houses** (precedence 2). Winter break: zero routing rows.

Relevant `system_config`: `ack_deadline_offset_minutes=10`, `no_ack_trigger_offset_minutes=5`, `min_float_chunk_blocks=2`, `float_retention_days=14`, `shift_block_minutes=30`, `hm_working_hours=08:00–17:00`, `shift_swap_expiry_anchor=T-3h`, `float_swap_expiry_hours=24`, `permanent_swap_expiry_days=7`, `project_administrator_user_id=a0000000-…-00000000000b`.

### §2.3 Lifecycle RPC signatures (verified against migrations)

Call via supabase-js `.rpc('name', {args})` with the **service-role** client. Where a function was redefined (`CREATE OR REPLACE`), the **authoritative** (latest) definition is noted — its signature is the one below.

| Operation                       | RPC                               | Args (verified)                                                                                                                                                                                                | Authoritative migration |
| ------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Generate blocks (1 day)         | `generate_blocks_for_date`        | `(target_date date)` → `(blocks_inserted int, assignments_inserted int)`                                                                                                                                       | `20260527000004`        |
| Generate blocks (range)         | `generate_blocks_for_range`       | `(start_date date, end_date date)` → same                                                                                                                                                                      | `20260527000004`        |
| Publish schedule                | `publish_schedule`                | `(p_period_id uuid)` _(also `(p_period_id,p_published_by)` and per-house `(…,p_house_id)`)_ → `int`                                                                                                            | `20260528000010`        |
| Claim (regular yr, open shifts) | `claim_open_shift`                | **confirm sig** (`rg "FUNCTION claim_open_shift" supabase/migrations`)                                                                                                                                         | phase 05/06             |
| Claim (break FCFS)              | `claim_break_shift`               | `(p_assignment_id uuid, p_user_id uuid, p_as_of timestamptz)` → `uuid`                                                                                                                                         | `20260531000002`        |
| Drop (temporary)                | `drop_shift`                      | `(p_assignment_ids uuid[], p_user_id uuid, p_as_of timestamptz=now())` → `(dropped_assignment_ids uuid[], short_notice_warning bool, direct_hmod_notification bool)`                                           | `20260528000020`        |
| Drop (permanent)                | `permanent_drop_slot`             | `(p_dropping_user_id uuid, p_house_id text, p_day_of_week int, p_block_start_locals text[], p_drop_initiated_at timestamptz, p_operator_user_id uuid=NULL)` → `jsonb`                                          | `20260531000001`        |
| Cross-house / permanent pickup  | `permanent_pickup_slot`           | `(p_picking_user_id uuid, p_assigned_block_ids uuid[], p_skipped_block_ids uuid[]=ARRAY[]::uuid[])` → `jsonb`                                                                                                  | `20260531000001`        |
| Automated float assign          | `process_float_lookup_assignment` | `(p_worker_id uuid, p_source_house_id text, p_source_assignment_ids uuid[], p_destination_assignment_ids uuid[], p_destination_house_id text, p_now timestamptz, p_retention_days int=14)` → `jsonb`           | **`20260601000002`**    |
| Force-trigger float             | `force_trigger_float`             | `(p_initiator_user_id uuid, p_worker_id uuid, p_source_house_id text, p_source_assignment_ids uuid[], p_destination_assignment_ids uuid[], p_destination_house_id text, p_now timestamptz=now(), …)` → `jsonb` | **`20260601000002`**    |
| Acknowledge float               | `acknowledge_float`               | `(p_float_id uuid, p_user_id uuid, p_now timestamptz=now())` → `jsonb`                                                                                                                                         | `20260528000014`        |
| Decline float                   | `decline_float`                   | `(p_float_id uuid, p_user_id uuid, p_now timestamptz=now())` → `jsonb`                                                                                                                                         | `20260528000014`        |
| No-ack handler                  | `process_no_ack_float`            | `(p_float_id uuid, p_now timestamptz, p_lookahead_minutes int=15)` → `jsonb`                                                                                                                                   | **`20260528000025`**    |
| HMOD/Allied escalation          | `process_hmod_notify_allied_step` | `(p_block_id uuid, p_house_id text, p_block_start_at timestamptz, p_now timestamptz, p_reason text='escalation_chain')` → `jsonb`                                                                              | **`20260528000025`**    |
| Ack-reminder snapshot           | `snapshot_float_ack_reminders`    | `(p_worker_id uuid, p_destination_assignment_ids uuid[], p_destination_house_id text, p_float_id uuid, p_now timestamptz)` → `int` _(called internally by both float paths)_                                   | `20260601000002`        |
| Accept swap                     | `accept_swap`                     | `(p_swap_id uuid, p_accepting_user_id uuid, p_now timestamptz=now())` → `jsonb`                                                                                                                                | `20260530000001`        |
| Apply permanent swap            | `apply_permanent_swap`            | `(p_swap_id uuid, p_new_owner_user_id uuid, p_affected_assignment_ids uuid[], p_now timestamptz=now())` → `jsonb`                                                                                              | `20260530000001`        |
| Pending notifications (observe) | `pending_notification_deliveries` | `(p_now timestamptz)` → `SETOF notifications`                                                                                                                                                                  | `20260601000001`        |
| Mark notification read          | `mark_notification_read`          | `(p_notification_id uuid, p_user_id uuid, p_now timestamptz)` → `bool`                                                                                                                                         | `20260601000001`        |

Swap **creation** is an Edge Function (`create-swap`), not a pure RPC — POST `/functions/v1/create-swap`, or replicate its INSERT into `swap_requests` directly in the harness (read `supabase/functions/create-swap/index.ts` + `_shared/swap-http.ts`). Other useful RPCs found: `claim_open_shift`, `weekly_open_shifts_feed`, `weekly_feed_for_house`, `permanent_openings_feed`, `break_claim_calendar_pool`, `effective_weekly_cap`, `swap_acceptance_ineligibility_reason`, `resolve_hm_for_house`, `is_project_administrator`, `assignments_outside_regular_school_year`.

### §2.4 Key table columns + enum vocabulary (verified)

- **`shift_block_assignments`**: `assignment_id, block_id, user_id (nullable), status (shift_status_enum), vacancy_origin (vacancy_origin_enum), is_cross_house_pickup bool, is_float bool, parent_float_id (→float_assignments.float_id), source_house_id (→houses.id)`.
- **`shift_blocks`**: `block_id, block_start_at timestamptz, house_id, required_headcount`. Unique on `(house_id, block_start_at)`.
- **`draft_block_assignments`** (allocator output, pre-publish): `draft_assignment_id, block_id, period_id, user_id, created_by`.
- **`float_assignments`**: `float_id, user_id` _(the floater — column is `user_id`, **not** `worker_id`)_, `status (float_status_enum), initiated_by (float_initiated_by_enum), force_triggered_by (nullable), source_assignment_ids uuid[], destination_assignment_ids uuid[], acknowledged_at, declined_at, no_ack_at, expires_for_cleanup_at`.
- **`float_exclusions`**: `user_id, destination_house_id, reason (float_exclusion_reason_enum), window_start_at, window_end_at`.
- **`notifications`**: `notification_id, recipient_user_id` _(column is `recipient_user_id`, **not** `user_id`)_, `type (notification_type), payload jsonb, scheduled_for (nullable), delivered_at (nullable), acknowledged_at`.
- **`preferences`**: PK `(user_id, block_id, period_id)`, `status` ∈ `preferred|available|cannot`.
- **`period_targets`**: PK `(user_id, period_id)`, `target_hours int, opted_out bool`.
- **`users`**: `user_id, name, email, home_house_id, is_active, broadcast_subscribed`. **`user_roles`**: `(user_id, role, scope_house_id)`, role ∈ `sw|sm|hm|bm`.
- **`scheduling_periods`**: `period_id, period_name, profile_name, start_date, end_date, preference_deadline, published_at`.

**Status enums are real Postgres enums** (so they are in the `Enums:` block of `packages/shared/src/database.types.ts`, not inline literals — `\dT+` in psql for the canonical list). Expected values (confirm exact spelling there before asserting):

- `shift_status_enum`: `scheduled, vacant, claimed, floated_in, floated_out, pending_float_in, pending_float_out`.
- `vacancy_origin_enum`: `never_assigned, temporary_drop, permanent_drop, displaced_decliner`.
- `float_status_enum`: `pending, acknowledged, declined, voided`.
- `float_initiated_by_enum`: `automated, force_triggered`.
- `float_exclusion_reason_enum`: `declined, no_acknowledgment`.
- `notification_type`: incl. `personal_shift, hmod_urgent, float_ack_reminder, sm_permanent_drop_alert, sw_permanent_removal_alert, broadcast, swap_request`.

### §2.5 Time-injection model — THE CRUX

Every lifecycle RPC takes an explicit `p_now`/`p_as_of`. The harness **bypasses `orchestrator-tick`** (which reads `new Date()` and has no time param) and calls the same RPCs it calls, marching a chosen "now" forward. For a destination float block starting at **S** (a `timestamptz`):

```
S − 3h00m   broadcast            (escalation_chain offset −3h)
S − 2h00m   float_lookup         (offset −2h; after this, no SW claims)
            ack_deadline = S − 10m         (ack_deadline_offset_minutes = 10)
reminders scheduled_for (= deadline − {6h,2h,1h,30m,5m}):
   S − 6h10m  (configurable, ack_cadence_config)
   S − 2h10m  (configurable)
   S − 1h10m  (mandatory)
   S − 0h40m  (mandatory)
   S − 0h15m  (mandatory)
S − 15m     no-ack fires         (deadline − no_ack_trigger_offset_minutes=5 ⇒ S−15m);
            call process_no_ack_float(p_now ≥ S−15m)
```

`snapshot_float_ack_reminders` **skips** any reminder whose time ≤ the `p_now` at float creation. So to see all five reminder rows, create the float at `p_now ≤ S − 6h10m`. Assert reminders by querying `notifications WHERE type='float_ack_reminder' AND recipient_user_id=<floater>` and checking `scheduled_for`. Assert "would deliver at time T" via `pending_notification_deliveries(T)`. Acking before the deadline must make the float's still-future reminders disappear from `pending_notification_deliveries` (defensive re-check).

**Float decision** = the pure `packages/core` float-lookup (in `packages/core/src/float-lookup/`) chooses floaters; then `process_float_lookup_assignment` writes them. The reference for how to snapshot DB state into the algorithm's input is `supabase/functions/orchestrator-tick/index.ts` — S4 reads it and replicates the snapshot, rather than calling the Edge Function.

### §2.6 Gotchas (verified or flagged — save yourself the debugging)

1. **`generate_blocks_for_*` needs `operating_calendar` rows** mapping each date → a profile. `supabase/seed.sql` does **not** seed `operating_calendar` (it inserts the 4 Quad blocks manually). S2 must seed `operating_calendar` for the build week (confirm its columns first) **or** insert `shift_blocks` directly.
2. **`preferences` inserts are gated** by a submission-window trigger on `scheduling_periods.preference_deadline`. Use the reopen→insert→reclose pattern (`supabase/seed.sql` lines 337/397 do exactly this: set deadline to a future date, insert, reset).
3. **Period overlap**: do **not** blindly create a second `regular_school_year` period — there may be an overlap/uniqueness constraint. **Recommended**: reuse the existing Spring-2026 period `c0000000-0000-4000-8000-000000000001` as the container and add `e…` workers/blocks/prefs on a **different week** (see §3 S2). Verify constraints before deviating.
4. **Non-destructive**: `e…`-prefixed UUIDs only. Don't touch `a/b/c/d…` rows or `supabase/seed.sql`. After your chunk, the phase-13b Playwright + pgTAP suites must still pass (S2's exit gate checks this).
5. **Column-name traps**: floater is `float_assignments.user_id` (not `worker_id`); notification recipient is `notifications.recipient_user_id` (not `user_id`).
6. **Service role bypasses RLS.** Use it for setup/teardown and most assertions. To test _visibility_ rules (e.g. "the destination SM sees inbound floats"), make a second client authed as that user (anon key + sign-in) — note this only where a scenario asserts visibility.
7. **Hard invariants to assert (negative paths)** — AGENTS.md §Hard Invariants: only `home_house='harnwell'` workers staff Harnwell (any mechanism); single-staff (headcount-1) houses are never float **sources**; Quad never floats **to** Harnwell; once a float is `pending`/`acknowledged` no automated path revokes it (no-takeback) — only manual override; hours cap is **not** checked on float.
8. **Redefined functions**: assert behavior against the **latest** definition (the migration column in §2.3), not the first.

---

## §3. Chunk briefs

Dependency graph: **S1 ∥ S2 → S3 → {S4, S5}**. (S1 independent; S5 shares harness helpers with S3 and uses float state from S4 for the float-swap case.)

### S1 — Verification baseline _(independent; can run first or parallel to S2)_

- **Goal**: one-command "is everything green?", and the **real** current state recorded.
- **Produces**: `scripts/verify-all.sh` (runs §2.1 layers 1–5 in order; mobile layers optional/flagged since they need a toolchain/emulator); a results block pasted into `STATUS.md`.
- **Steps**: write the script (fail-fast, echo each layer's pass/fail + timing); run it; for any **red**, triage (is it environmental, a real regression, or a TDD-red spec?) and record the verdict — especially resolve the Playwright "green vs TDD-red" question (§2.1).
- **Exit gate**: `bash scripts/verify-all.sh` runs to completion and every layer's status is recorded in `STATUS.md` with a one-line triage per failure. (Green-everywhere is the goal but not required to pass the chunk — an _accurately recorded_ state is.)
- **Out of scope**: fixing product bugs; building the harness.

### S2 — Realistic all-houses seed + greedy allocator _(dep: none beyond config seed)_

- **Goal**: a realistic, deterministic, non-destructive environment + a **published** schedule with intentional gaps.
- **Produces**: `tests/e2e-lifecycle/seed.ts` (idempotent; service-role) and `tests/e2e-lifecycle/allocate.ts` (greedy allocator) — or one combined `seed.ts`. A root script `pnpm e2e:lifecycle:seed`.
- **Build week**: **Mon 2026-03-02 … Sun 2026-03-08** (within Spring-2026; clean of the 2026-02-02 phase-13b blocks; the week contains the 2026-03-08 DST spring-forward for S5's DST check). Reuse period `c0000000-…-000000000001`.
- **Workers (recommended, tunable)**: Harnwell 5, Quad 8, each single-staff house 3 → ~46 SWs, all `e…` UUIDs, `home_house_id` = their house (Harnwell training = home_house harnwell). Admin users (minimal): an HM for `quad`, `harnwell`, `house-03`; one BM; reuse seeded `admin@` as project administrator. Create `auth.users` + `auth.identities` + `users` + `user_roles` following `supabase/seed.sql` lines 268–332 as the template.
- **Realistic preference model** (deterministic — derive each worker's archetype from `index % N`, no RNG): archetypes — _MWF-morning_ (classes MWF 09:00–12:00 ⇒ `cannot`; afternoons/eves `preferred`), _TR-heavy_ (TR 09:30–15:00 `cannot`), _evening_ (18:00–24:00 `preferred`), _night-owl_ (21:00–24:00 `preferred`, mornings `cannot`), _weekend_ (Sat/Sun long blocks `preferred`). Defaults: 08:00–09:00 `available`; meals 12:00–13:00 & 18:00–19:00 `available`; otherwise `available`. **Never** leave a house with zero non-`cannot` coverage; **do** leave deliberate thin spots (a couple of single-staff houses understaffed on specific days) so float/escalation has material.
- **Allocator** (greedy contiguous-chunk, deterministic): per (house, day), staff from the house's own home workers; build candidate contiguous windows of **4–8 blocks (2h–4h)** where the worker is non-`cannot` throughout; greedily fill each block's `required_headcount` preferring (longer window, more `preferred` overlap, worker under weekly target), **never** assigning a `cannot` block, leaving a block **vacant** rather than violating the ≥2h-chunk or cannot rules. Stay under the 20h soft cap. Write `draft_block_assignments`, then `publish_schedule(period_id)`.
- **Exit gate**: a checker (`tests/e2e-lifecycle/checks/seed-check.ts`, run via the seed script or a tiny `pnpm e2e:lifecycle:seed:check`) asserts: ≥46 `e…` workers across all 13 houses; published `shift_block_assignments` exist for the build week; **zero** assignment lands on any worker's `cannot` block; every worker's daily assignment is contiguous runs of ≥4 blocks; some vacancies remain. **AND** `supabase test db` + `pnpm --filter @shift/web e2e` still pass (non-destructive proof). Record counts in `STATUS.md`.
- **Out of scope**: any lifecycle operation (claim/drop/float/swap).

### S3 — Harness scaffold + happy-path scenarios _(dep: S2)_

- **Goal**: the runnable harness + the non-float lifecycle.
- **Produces**: a Vitest project at `tests/e2e-lifecycle/` (own `vitest.config.ts`, **excluded** from `pnpm --filter @shift/core test`), a `client.ts` (service-role + a helper to make a user-authed client), shared `helpers.ts` (block/assignment lookups, time math around a block start S, assertion helpers), root script `pnpm e2e:lifecycle` (global setup verifies stack up + applies S2 seed). Scenario files: `01-publish.test.ts`, `02-claim.test.ts`, `03-drop-temporary.test.ts`, `04-drop-permanent.test.ts`, `05-cross-house-pickup.test.ts`.
- **Covers scenarios 1–5 + invariant 5a** (§4). Confirm `claim_open_shift` signature here.
- **Exit gate**: `pnpm e2e:lifecycle` passes for files `01`–`05` (others may not exist yet).
- **Out of scope**: float, ack/escalation, swaps.

### S4 — Float, reminders, ack/no-ack/decline, force-trigger, HMOD _(dep: S3)_

- **Goal**: the float subsystem end-to-end, deterministically.
- **Produces**: `06-float-automated.test.ts`, `07-reminder-cadence.test.ts`, `08-ack.test.ts`, `09-no-ack.test.ts`, `10-decline.test.ts`, `11-force-trigger.test.ts`, `12-hmod-pin-vs-transfer.test.ts`. A `float-lookup-bridge.ts` that snapshots DB state into the `packages/core` float-lookup input (model after `supabase/functions/orchestrator-tick/index.ts`).
- **Covers scenarios 6–12 + invariants 6a–6c, 12a** (§4). Use the §2.5 timeline.
- **Exit gate**: `pnpm e2e:lifecycle` passes `01`–`12`.
- **Out of scope**: swaps; reliability suite.

### S5 — Swaps + fault-tolerance / reliability _(dep: S3; uses S4 float state for float-swap)_

- **Goal**: swaps + the reliability bar.
- **Produces**: `13-swaps.test.ts` (shift / float / permanent; expiry; `swap_acceptance_ineligibility_reason`), `14-reliability.test.ts` (idempotency: re-run a tick step / re-deliver a notification → identical end state; graceful degradation: no-floater → HMOD, project-admin terminal present; DST: `generate_blocks_for_date('2026-03-08')` yields exactly 32 blocks/house with correct EDT-anchored `block_start_at`).
- **Covers scenarios 13–14 + the no-takeback invariant** (§4).
- **Exit gate**: `pnpm e2e:lifecycle` passes all of `01`–`14`. Final state recorded in `STATUS.md` (the program is then complete).
- **Out of scope**: —

---

## §4. Scenario matrix

| #   | Scenario                                         | Spec ref            | Owner | Key assertions                                                                                                                                                                                                           |
| --- | ------------------------------------------------ | ------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Publish a built schedule                         | BSpec §4            | S3    | drafts → `scheduled`; remaining blocks `vacant`/`never_assigned`; `published_at` set                                                                                                                                     |
| 2   | Claim an open shift                              | BSpec §5.4          | S3    | `claim_open_shift` (regular) flips `vacant`→`claimed`, `user_id` set; cap soft-warn surfaced                                                                                                                             |
| 3   | Temporary drop                                   | BSpec §8, §5        | S3    | `drop_shift` → `vacant`/`temporary_drop`; `short_notice_warning` & below-headcount flags correct                                                                                                                         |
| 4   | Permanent drop                                   | BSpec §8.4          | S3    | `permanent_drop_slot` vacates recurring slots through period end; `sm_permanent_drop_alert` row                                                                                                                          |
| 5   | Cross-house pickup                               | BSpec §5.3          | S3    | `permanent_pickup_slot` sets `is_cross_house_pickup`, `source_house_id`; skipped weeks → `temporary_drop`                                                                                                                |
| 5a  | **Invariant**: non-Harnwell rejected at Harnwell | §1.2                | S3    | pickup/claim of a Harnwell block by non-`harnwell`-home worker raises                                                                                                                                                    |
| 6   | Automated float (Quad→single)                    | BSpec §6.2          | S4    | core lookup picks Quad floater; `process_float_lookup_assignment` → `pending`, source `pending_float_out`, dest `pending_float_in`, `personal_shift` notif                                                               |
| 6a  | **Invariant**: Quad ↛ Harnwell                   | §1.2                | S4    | a Harnwell vacancy never yields a Quad floater                                                                                                                                                                           |
| 6b  | **Invariant**: single-staff never a source       | §1.2                | S4    | lookup never selects a headcount-1 house worker as floater                                                                                                                                                               |
| 6c  | **Invariant**: cap not checked on float          | inv #4              | S4    | a 39h worker is still float-eligible                                                                                                                                                                                     |
| 7   | Reminder cadence                                 | BSpec §7.1          | S4    | 5 `float_ack_reminder` rows at deadline−{6h,2h,1h,30m,5m}; past-due skipped                                                                                                                                              |
| 8   | Acknowledge                                      | BSpec §7            | S4    | `acknowledge_float` → dest `floated_in`, source `floated_out`, status `acknowledged`; future reminders drop from `pending_notification_deliveries`                                                                       |
| 9   | No-ack                                           | BSpec §7.3          | S4    | `process_no_ack_float`(p_now≥S−15m) → `voided`, exclusion `no_acknowledgment`, dest `vacant`/`displaced_decliner`, HMOD escalation                                                                                       |
| 10  | Decline + reconciliation                         | BSpec §6.6 #7, §7.2 | S4    | `decline_float` → `declined`, exclusion `declined`; source still vacant ⇒ **restore**; source taken ⇒ **displace** (test both)                                                                                           |
| 11  | Force-trigger                                    | BSpec §6.6          | S4    | `force_trigger_float` pre-T-2h → `pending`, `initiated_by=force_triggered`, `force_triggered_by` set; source gap → open-shifts feed                                                                                      |
| 12  | HMOD pin vs transfer                             | BSpec §5.4, §10.1   | S4    | no-floater ⇒ `hmod_urgent` to HM (in `hm_working_hours`) else HMOD else project-admin terminal; lookup-finds-other ⇒ normal float to a different worker                                                                  |
| 12a | Project-admin terminal present                   | §2.6                | S4/S5 | `system_config.project_administrator_user_id` resolvable; unset path `RAISE WARNING` not crash                                                                                                                           |
| 13  | Swaps                                            | BSpec §8.1–8.3      | S5    | create (`create-swap`)+`accept_swap` transfers ownership; float-swap updates `float_assignments.user_id`; permanent via `apply_permanent_swap`; expiry; ineligibility (Harnwell training / pending float / single-staff) |
| 14  | Reliability                                      | inv #3, §10.1       | S5    | **no-takeback** (re-tick doesn't revoke a pending/ack'd float); **idempotency** (re-deliver → no double-apply); **DST** (32 blocks on 2026-03-08)                                                                        |

---

## §5. Conventions

- **Layout** (all new work under `tests/e2e-lifecycle/`): `seed.ts`, `allocate.ts`, `client.ts`, `helpers.ts`, `float-lookup-bridge.ts`, `vitest.config.ts`, `checks/`, `NN-*.test.ts`. Plus `scripts/verify-all.sh` (S1) at repo root.
- **Root scripts** (add to root `package.json` as chunks land): `e2e:lifecycle:seed`, `e2e:lifecycle:seed:check`, `e2e:lifecycle`.
- **Client**: supabase-js with the service-role key for setup/assert; a helper `asUser(email)` (anon key + password `test-Password-123` convention) only where a scenario asserts RLS visibility.
- **Determinism**: never read the wall clock in a scenario — every RPC gets an explicit `p_now` derived from a scenario-chosen block start `S`. No `Date.now()` in assertions; pass fixed ISO strings.
- **Idempotency**: `seed.ts` must be safe to re-run (upsert / `ON CONFLICT DO NOTHING`, `e…` namespace).
- **Type generation**: if any session changes a migration, run `supabase gen types typescript --local > packages/shared/src/database.types.ts` (AGENTS.md). The harness should _not_ need migration changes — if it seems to, stop and reconsider.
- **Commit per chunk**; keep `STATUS.md` honest.
