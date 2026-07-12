# Adversarial Architecture & Security Review — Findings

**Date:** 2026-07-07
**Branch:** `feat/ui-float-polish` (HEAD `4f8d5bc`)
**Reviewer:** Claude (Fable 5), adversarial principal-engineer pass
**Scope:** RLS/write-path authz, hard-invariant enforcement, spec/code drift, orchestrator architecture, Edge Function security, block atomicity, cross-platform consistency.

> This is a **findings-only** report. Fixes are deliberately out of scope (a separate pass will act on these). Every CRITICAL/HIGH item and the top MEDIUM items were re-verified against source by hand, not taken on an agent's word.

## Method & coverage caveats

Six parallel investigation agents were fanned out (RLS/authz, invariant enforcement, orchestrator/architecture, EF security, block atomicity, doc/spec drift). Three (RLS, invariants, mobile) hit the account session limit before writing final reports; their working notes were recovered from transcripts and their live threads re-verified against code.

**Under-covered area:** the "mobile client reimplements server-authoritative logic" sweep (priority 6) — its agent died almost immediately. The one confirmable data point is that the past client-side T-2h claimability bug is *fixed* (server now emits `coverage_locked`/`desk_covered`). A fresh mobile pass is still warranted.

The single most serious finding (C1) was flagged **independently by two agents** and its full exploit chain was verified.

---

## CRITICAL

### C1. Confused-deputy privilege escalation: `apply_compiled_season` + `set_preference_deadline` trust a caller-supplied actor UUID and are granted to `authenticated`

**Location:**
- `supabase/migrations/20260702000006_apply_compiled_season.sql:121` (authz), `:445` (grant)
- `supabase/migrations/20260703000001_season_preference_deadline.sql:59` (authz), `:111` (grant)

**What it does:** Both functions authorize on a **function parameter** (`p_calling_user_id` / `p_actor_user_id`), not `auth.uid()`, and are `GRANT EXECUTE ... TO authenticated` (reachable via PostgREST `/rpc`).
```sql
-- apply_compiled_season
IF NOT user_is_admin(p_calling_user_id) THEN RAISE EXCEPTION ... insufficient_privilege;
-- set_preference_deadline
IF NOT (user_is_admin(p_actor_user_id) OR EXISTS(SELECT 1 FROM user_roles
        WHERE user_id = p_actor_user_id AND role IN ('sm','hm','bm'))) THEN RAISE ...;
```

**Enabler (makes it practical):** `worker_directory` (`20260612000001_t3b_directory_grid.sql:33-49`, granted to `authenticated`) returns `user_id` for every active user including admins; and `user_is_admin(uuid)` is itself granted to `authenticated` (`20260702000002_admin_role_powers.sql:49`). An attacker enumerates all UUIDs and calls `user_is_admin` on each to identify the admin's, then passes it as the actor.

**What it violates:** The codebase already has two correct patterns these two functions break:
- Worker-scoped RPCs guard the caller param against the JWT: `IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN RAISE` (present in 20260528000009, 20260528000014, 20260601000001, 20260606000002, 20260623000002).
- Admin/people RPCs like `hire_worker` are `GRANT EXECUTE ... TO service_role` **only** (`20260611000004_hire_worker.sql:118`), so only the web server (holding the service key, deriving the actor from the session) can invoke them.

**Failure scenario:** Any authenticated worker POSTs to `/rest/v1/rpc/set_preference_deadline` with `{p_actor_user_id: <enumerated admin uuid>, p_period_id: <readable>, p_preference_deadline: <arbitrary>}` and moves the preference deadline for any period, disrupting the preference/build cycle. The `apply_compiled_season` variant runs `SECURITY DEFINER` (RLS-bypassing) and, with a crafted payload (format is in open-source `packages/core/src/operating-seasons`), can void future blocks, cancel assignments/floats, change headcounts, and close houses. The `set-preference-deadline` Edge Function does not mitigate this — the DB grant makes the EF path bypassable.

**Severity: CRITICAL. Confidence: high (exploit chain verified end-to-end).**

---

## HIGH

### H1. `worker_open_shifts` is an owner-rights view granted to `anon` with no `auth.uid()` filter → unauthenticated data disclosure

**Location:** `supabase/migrations/20260627000001_coverage_conditional_pickup_lock.sql:246-333`

**What it does:** The view has no `WITH (security_invoker = true)` (runs owner-rights, bypasses RLS) and `CROSS JOIN candidate_users` (every active `sw`/`sm`/`hm`) with no internal `WHERE eligible_user_id = auth.uid()`. It is `GRANT SELECT ... TO anon` (`:333`).

**Verified as the outlier, not house style:** `worker_my_shifts` and `worker_pending_floats` are `security_invoker` (RLS returns nothing for anon); `worker_recent_floats` is owner-rights but self-filters `WHERE fa.user_id = auth.uid()` (empty for anon). Only `worker_open_shifts` is owner-rights *and* unfiltered *and* anon-granted.

**Failure scenario:** Anyone holding the public anon key (embedded in the shipped mobile app and web bundle) GETs `/rest/v1/worker_open_shifts` with no login and receives every currently-open shift (house, date, time, all 13 houses) cross-joined with every active worker's `user_id` and `home_house_id`. The security model here rests on RLS; an owner-rights anon grant defeats it. (Names/phones are not exposed — those need the authenticated-only `worker_directory` — but internal UUIDs, home-house mapping, and the full department vacancy schedule are.)

**Severity: HIGH. Confidence: high (verified).**

### H2. `process_float_lookup_assignment` re-checks source rows by status only, never by `user_id` → swap-accept race silently steals a worker's hours

**Location:** `supabase/migrations/20260623000002_float_source_seat_reopen.sql:186-197`

**What it does:** The source lock re-check is `WHERE assignment_id = ANY(p_source_assignment_ids) AND status IN ('scheduled','claimed') FOR UPDATE` — no `AND user_id = p_worker_id`. `accept_swap` transfers ownership by mutating `user_id` on the same rows while `status` stays `'scheduled'` (`20260617000002_handoff_constraints_accept.sql:147-153`).

**Failure scenario:** The orchestrator snapshots worker W holding source rows S1..S4. Before the RPC commits, worker V accepts a swap taking those blocks (rows now `user_id=V, status='scheduled'`). The RPC's source re-check still passes (status unchanged) → it flips **V's** rows to `pending_float_out` under W's float and reopens V's seat. W is floated in without giving up hours; V loses theirs when W acknowledges. `accept_swap`'s own backstop re-checks `user_id` — the asymmetry is the bug. Same omission in `force_trigger_float` (`:311-325`). Window is snapshot→RPC within one tick.

**Severity: HIGH (data corruption / silent hours theft). Confidence: high (verified).**

---

## MEDIUM

### M1. `process_float_lookup_assignment` lacks the competing-`pending_float_in` guard that `force_trigger_float` has → concurrent-tick double-float

**Location:** guard present in `force_trigger_float` at `20260623000002_float_source_seat_reopen.sql:296-309` ("1b — no competing pending float-in"); absent in `process_float_lookup_assignment`.

**What it does:** There is no tick-level mutex (cron `net.http_post` is fire-and-forget; a >60s post-downtime tick overlaps the next). Two ticks claiming `float_lookup` on different head-blocks of the same multi-seat desk (Quad/Harnwell) can each pass their own per-row vacancy re-check and assign two floaters to a desk that needed one — two notifications, two vacated source seats. No unique/exclusion constraint on `shift_block_assignments` prevents two present-status rows for one block.

**Severity: MEDIUM (requires tick overlap). Confidence: high (verified).**

### M2. `dispatch-push` marks a mandatory notification delivered even when every FCM send failed → silent push loss

**Location:** `supabase/functions/dispatch-push/index.ts:155-187`

**What it does:** `successCount`/`failureCount` are tallied (`:164-165`) but never inspected; `deliver_notification` (stamps `delivered_at`, ends retries) is called unconditionally (`:181-184`). If all token sends fail (all tokens expired, or an FCM window that errors without throwing), the notification is marked delivered and never retried. AGENTS §12 states §10.1 personal notifications are *mandatory*; the at-least-once design is defeated on the all-fail path. (Inverse: missing `FIREBASE_SERVICE_ACCOUNT_JSON` throws → 500 → infinite once-a-minute retry.)

**Severity: MEDIUM. Confidence: high (verified).**

### M3. Weekly-cap modification authority contradicts across five layers; the RLS backstop is the stalest

- BSPEC §9.3/§13, ARCH §2.5/§12/App-C: "HM or BM only."
- BSPEC §2.3a grants RSM; §2.8 grants the Administrator.
- Web gate: `canModifyWeeklyCap = isHouseAdmin` = hm/rsm/bm/admin (`apps/web/lib/auth.ts:129`).
- Core logic: `packages/core/src/cap-modification/index.ts` allows hm/bm/rsm — no admin.
- **RLS policies: `role IN ('hm','bm')` only** (`20260601000004_phase_14_admin_extras.sql:38-49`) — never updated for rsm or admin. The EF `modify-weekly-cap` gates `.in('role',['hm','bm'])` too.

An RSM whom the web UI presents as authorized is blocked at the RLS/EF layer; core denies the admin a power BSPEC grants. Separately, `weekly_cap_overrides` is keyed on `week_start_date` only (no `house_id`), so any single-house admin flips the cap university-wide — `auth.ts:129` documents this as intentional "campus-wide," but AGENTS' cross-house invariant says cap stays own-house; that contradiction needs an explicit ruling.

**Severity: MEDIUM. Confidence: high (convergent across 3 agents).**

### M4. ARCH and BSPEC still assert the *removed* class-based float allowlist as a hard algorithmic invariant

Per AGENTS invariant #2 (amended 2026-07-02), the "only Quad/Harnwell may source" class allowlist was **removed** from the pure float algorithm (`packages/core/src/float-lookup/eligibility.ts:6-22,127`); summer floating is universal. But ARCH §1.5 (`ARCHITECTURE.md:52`), §1.1 (`:21`), §2.4 (`:221`), §5.2 (`:872`) still state it as "enforced as hard-coded eligibility checks," and BSPEC §1.1 (`:19`), §6.1 (`:600`), §6.2 (`:619`) do too. An agent "restoring the documented invariant" would re-add the class check and break universal summer floating.

**Severity: MEDIUM. Confidence: high.**

### M5. The swap eligibility layer still *implements* that removed allowlist

**Location:** `packages/core/src/swaps/eligibility.ts:41` (`MULTI_STAFF_FLOAT_SOURCE_HOUSE_IDS = new Set(['quad','harnwell'])`), enforced at `:70-81` (`single_staff_cannot_float`); identical DB rule at `20260530000001_phase_09_swaps.sql:281-282`.

**Failure scenario:** In a summer season a single-staff-home worker legitimately holds a float (their multi-staffed summer house sourced it); swapping that float to another single-staff-home worker is wrongly rejected. Over-restriction, not corruption; only bites in summer float-swaps — but it is a live enforcement point the invariant-#2 amendment never reached.

**Severity: MEDIUM. Confidence: high the code carries the old rule; medium it mis-rejects in practice (depends on summer float-swap usage).**

### M6. BSPEC §4.5 (escalation trigger) and §5.1 (pickup cutoff) still document the pre-revision rules

§4.5 (`BEHAVIORAL_SPECIFICATION.md:421`) says escalation fires when a desk drops "below its required headcount" — controlling §5.4 (revised 2026-06-23) and the code (`loadCoveredBlockIds`) fire only at **zero** present. §5.1 (`:452`) states an unconditional clock-only T-2h pickup cutoff, but §5.3 (revised 2026-06-25) made it coverage-conditional. Reimplementing either verbatim reintroduces the over-floating and mis-lock bugs already fixed.

**Severity: MEDIUM. Confidence: high.**

### M7. BSPEC §13 permissions summary + §2.3a / ARCH §3.1 predate RSM, cross-house schedule write, and the Administrator

BSPEC §13 (`:1015-1059`) has no RSM or Administrator entry, says HM powers are "for their home house" (stale — hm/bm/rsm may edit any house's schedule per 20260627000002), and names the HM as primary in-hours escalation recipient (contradicts §10.1, which routes to the RSM). BSPEC §2.3a (`:123`) and ARCH §3.1 (`:440`) still call RSM/HM cross-house access "view-only," reversed 2026-06-27. ARCH §3.1's role enum (`:436`) omits `admin`. The section engineers skim for role gates is wrong on four axes.

**Severity: MEDIUM. Confidence: high.**

### M8. Season desk-hours are never validated for 30-minute alignment (invariant #5)

The `% 30` guard in the compiler runs only for windows that *override* bounds (`packages/core/src/operating-seasons/compile.ts:157-170`); inherit-mode windows skip it, and neither the schema (`20260702000003_operating_seasons_schema.sql:34-35`) nor the web form (`apps/web/components/operations/CreateSeasonForm.tsx:158`, a bare `<input type=time>`) constrains minutes.

**Failure scenario:** Admin authors `08:15`–`20:00` with inherit-mode windows → compile passes → `apply_compiled_season` writes a `08:15` band → `generate_blocks_for_range` violates `shift_blocks_block_start_boundary_check` → the whole apply hard-fails with an opaque `check_violation`. A `17:15` end silently truncates authored coverage instead (integer division in the generator, `20260527000004_shift_blocks_calendar_generation.sql:224-227`).

**Severity: MEDIUM. Confidence: high.**

### M9. ARCH §8.5 "Summer (Deferred Indefinitely)" is flatly false and self-contradicting

`ARCHITECTURE.md:1143,1202-1206` says summer is out of scope and "Harnwell does not float in summer" — the opposite of the shipped rule (admin-authored seasons exist; Harnwell MAY source). The same file's §2.1 describes the built system. An engineer reading §8 concludes the machinery doesn't exist and rebuilds it.

**Severity: MEDIUM. Confidence: high.**

---

## LOW

### L1. Dev-clock / orchestrator server actions gated only by `NODE_ENV`, no role/session check
`apps/web/lib/actions/devClock.ts:15-56,283` — `setSimClock`/`clearSimClock`/`runOrchestratorTick` proceed with `me?.userId ?? null`. In any non-prod deployment reachable over the network, any caller shifts the *global* `app_now()` (drives all escalation/claim/void timing) and forces service-role ticks. Prod unaffected (`isTimeTravelEnabled()` false). Latent prod risk: if the offset ever became nonzero in prod, web `simNow()` short-circuits to real time while the DB uses `app_now()` — silent divergence. **Confidence: high.**

### L2. Push delivery wedges under forward time-travel
Orchestrator stamps `scheduled_for = app_now()` (sim); `dispatch-push` re-checks due-ness with real `new Date()` (`supabase/functions/dispatch-push/index.ts:118`) → `suppressed_or_not_due` → re-enqueued every minute until the real clock catches up. Harness-only, but breaks the exact manual-test loop the sim clock exists for. **Confidence: high.**

### L3. "Configurable" parameters that aren't
`MIN_FLOAT_CHUNK_BLOCKS=1` and `MAX_ALLIED_COVERAGE_BLOCKS=8` are hardcoded consts (`packages/core/src/float-lookup/index.ts:23`, `supabase/functions/orchestrator-tick/index.ts:16`) despite BSPEC §14 / ARCH §8.3 presenting them as admin-tunable `system_config` rows; editing the seeded rows does nothing. Separately, `shift_block_minutes` *is* a live unvalidated `system_config` knob (`orchestrator-tick/index.ts:146`) feeding non-30 arithmetic while the DB hardcodes 30-min blocks and `force-trigger` hardcodes `BLOCK_MINUTES=30` — the two EFs can disagree under one bad config write. **Confidence: high.**

### L4. Raw Postgres error messages returned to clients
~12 EFs return `error.message` verbatim (`register-push-token:84`, `submit-preferences:144`, `create-swap`, `accept-swap`, `permanent-drop:203`, `modify-weekly-cap`, `force-trigger:721`, others) — constraint/column names leaked to authenticated callers. The sanitized `errorCode()` pattern (claim/drop/break/ack) should be normalized across all. **Confidence: high.**

### L5. Mobile session tokens stored unencrypted at rest
supabase-kt default `SettingsSessionManager` persists access+refresh tokens to Android SharedPreferences / iOS NSUserDefaults in plaintext (`apps/mobile/.../network/SupabaseClient.kt:29-33`); no EncryptedSharedPreferences/Keychain. Requires local device compromise. **Confidence: medium.**

### L6. Orchestrator has no failure alerting
The only automated entry point is `cron → net.http_post → EF`, fire-and-forget, no response read, no timeout (`20260528000002_phase_07_orchestrator.sql:90-102`). If the Edge runtime is down (the known silent-write failure mode), orchestration halts with no signal except a stale `orchestrator_health.last_tick_at`. **Confidence: high.**

### L7. All-RPCs-abort path Allied-notifies and one-way-locks a desk a concurrent claim just staffed
`supabase/functions/orchestrator-tick/index.ts:846-866,429` — `hasActiveFloatForBlock` doesn't see a concurrent *claim*, so a staffed desk gets an Allied request and its remaining seats become permanently unpickable. Narrow window. **Confidence: high.**

### L8. Symmetric swap has no hours-cap check anywhere
BSPEC §9.3's "cannot exceed 40h, cannot be overridden" carries no carve-out for the symmetric-swap case (§8.2's retroactive-float exemption isn't restated as sanctioned the way §8.5 handoffs are). May be intended but is unstated. **Confidence: medium.**

---

## Verified clean (checked, no issue)

Identity is always derived from the bearer JWT, never a request-body field, across all worker-facing Edge Functions (including `force-trigger`'s `isScheduleAdmin` flag, derived server-side); no SQL string interpolation anywhere; service-role key is server-only (no `NEXT_PUBLIC_`) and the two system EFs require it; `FIREBASE_SERVICE_ACCOUNT_JSON` is never logged; migration idempotency claims hold (spot-checked `ALTER TYPE ... ADD VALUE IF NOT EXISTS`, `CREATE ... IF NOT EXISTS`, `DROP POLICY IF EXISTS`, guarded cron DO-blocks); the DOA-float / same-tick-no-ack-void logic (commit 66b5fe0) is correct on its stated races; `SET search_path` is present on all real `SECURITY DEFINER` functions; block generation is DST-safe and every write path is guarded by `shift_blocks_block_start_boundary_check`; the Harnwell training constraint is enforced at the table trigger level; the "build snapshot once" rule holds for both `findFloaters` callers; the mobile expired-JWT silent-write bug is handled (`ensureFreshSession` + 401-retry); and the previously-buggy client-side T-2h clock check is now server-authoritative.

---

## Suggested fix order

1. **C1** — unauthenticated-key-to-admin escalation. Fix first.
2. **H1** and **H2** in parallel.
3. **M1 / M2**.
4. Doc-drift cluster (M4, M6, M7, M9) as a single documentation sweep.

## Summary counts

| Severity | Count | IDs |
| --- | --- | --- |
| Critical | 1 | C1 |
| High | 2 | H1, H2 |
| Medium | 9 | M1–M9 |
| Low | 8 | L1–L8 |
