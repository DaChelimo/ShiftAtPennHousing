# Remediation Proposal — Phases 0–7

Companion to [`checkpoint-phases-0-7.md`](checkpoint-phases-0-7.md). This document lists **every proposed fix** with its concrete change, so you can approve or reject each one. Nothing here is implemented yet.

## How to use this document

- **Part 0** is decisions I need from you. Several fixes branch on these, so answer them first.
- Each fix has an **`Approve?`** line. Reply however is easiest — e.g. "approve A1–A4, B all, reject C8, defer G", or annotate inline.
- Severity and the finding ID map back to the audit. Fixes are grouped into the same safe batches (A–G); within a batch they're independent unless a dependency is noted.
- **[migration]** = new forward SQL migration (never edits a shipped migration). **[code]** = TypeScript/Edge Function. **[test]** = test file. **[docs]** = markdown/docs.
- SQL/code shown is the proposed change. Where a function signature is marked _(confirm signature)_ the implementer will read the live definition first.

---

## Decisions — LOCKED (2026-05-28)

### Part 0 answers (from you)

- **D-1:** Keep HMs **excluded** from swap counterparties. → fix **D7 REJECTED**; code is correct, BSpec §13 ambiguity to be annotated. (You will update the audit's F-02-002 to "code correct + spec ambiguous".)
- **D-2:** **Option A** — `publish_schedule` UPSERTs over the generator's `vacant`/`never_assigned` rows; drop the pre-existing-assignments guard. Generator stays the single source of block rows. Drives **A3**.
- **D-3:** **Per-house** publish — add `p_house_id`, authorize caller as SM/HM/BM of that house. Drives **A3**.
- **D-4:** Build `acknowledge_float` + `decline_float` **now** (**F2**); add the ack-cadence **snapshot hook now** in the float-assignment RPC (**F3 = build snapshot now**); defer full ack-cadence _reminder delivery_ to Phase 12.
- **D-5:** **Yes** — any `pending_float_in` shows "(Pending)" regardless of `initiated_by`.
- **D-6:** **Defer + document** cross-house home-side gap creation (F-05-011).
- **D-7:** **`operating_profiles` canonical** for `claim_phase_*_offset_days`; do NOT mirror into `system_config`. Annotate ARCH §3.10 prose.
- **D-8:** **Body canonical (T-10m before float start)**; mark BSpec App. A item 3 / ARCH App. C item 3 as errata. Drives **G8**.

### Delegated judgment calls (decided by Claude, with rationale)

- **A2 sub-decision → LEAVE read-only feeds PUBLIC** (corrected 2026-05-28 after verifying the code). `weekly_open_shifts_feed` / `weekly_feed_for_house` / `is_assignment_claimable` are `SECURITY INVOKER` and the underlying `shift_blocks` / `shift_block_assignments` tables have authenticated-SELECT RLS policies — i.e. these feeds _are_ the intended RLS-protected direct-read API; revoking them would break the design for no security gain. The only DEFINER feeds (`permanent_openings_feed`, `effective_weekly_cap`) expose only vacancy/cap-policy data (non-PII, non-cross-user-private), and `permanent_openings_feed`'s DEFINER is plausibly intentional cross-house visibility. So **A2 revokes only the mutating RPCs** (the genuine act-as-another-user hole); feed-routing hardening is **deferred to Phase 13** when the real client's access pattern is concrete. _(My initial "revoke all feeds" call rested on the false premise that the feeds bypass RLS — withdrawn.)_
- **C3 → C3a** (seed a designated project-administrator `users` row as the terminal of `resolve_hm_for_user`). Rationale: keeps `notifications.recipient_user_id` NOT NULL + FK intact and gives the resolution chain a real terminal; C3b's NULL-recipient special-case would leak through every delivery path.
- **C6 → C6a** (EF imports `evaluateChainSteps` from `packages/core`; delete the inline copy and the unused `orchestrator/{no-ack,routing}.ts` + `escalation/*`; retarget tests at the pgTAP RPC suites; port routing edge cases — now the **Friday** handoff, leave anchoring, 08:00/17:00 boundaries — into `phase-07-hmod-notify-rpc.sql`). Rationale: the SQL RPCs are the deployed, canonical no-ack/routing logic; two sources of truth is exactly the drift the audit flagged (X-3/X-6). Routing edge tests must be rewritten for Friday anyway, so port-and-consolidate now.
- **D12 → ** phase1Grouping: keep the tested `scheduling/phase1Grouping.ts`, delete `schedule-builder/phase1-grouping.ts`. hours: expose the §9.1 decomposition at the package root, remove the name collision. cross-house / users-eligibility: keep the thin re-exports (harmless, low priority).
- **Batch approvals → approve all of A–G**, implemented in the audit's "minimum-to-unblock-Phase-8" order first (A, B, C, D9–D11, E1/E2, F2), then the remainder. Two items carry sub-flags: **D9** (auditor enumerates each affected policy before applying — SM-visibility narrowing) and **G7a** (KMP `composeApp` vs `androidApp`+`shared` naming still needs its own restructure-vs-amend decision; will surface separately).

### Amendment — HMOD duty week is Friday 08:00 → following Friday 08:00 (supersedes Monday 08:00)

Per your critical change, the HMOD **rotation cadence** boundary moves from Monday 08:00 to **Friday 08:00 (inclusive) → following Friday 08:00 (exclusive)**. The HMOD **on-duty hours** (weekday 17:00→midnight; weekend Fri 17:00→Mon 08:00) are unchanged — only _which person_ is on the rotor for a given moment, and the meaning of `hmod_rotor.week_start_date` (now a **Friday**), change. This places the weekend (heaviest duty) at the _start_ of the duty week instead of split across the old Monday handoff.

Mechanical ripple (implemented):

- **C1** reframed: `resolve_hmod_on_duty` now snaps `p_at` (NY-local − 8h) back to the most recent Friday (isodow 5) instead of `date_trunc('week')`. Migration `20260528000008_hmod_friday_boundary.sql`.
- **E7 / F-01-015** rotor half: CHECK on `hmod_rotor.week_start_date` is now **Friday** (`isodow = 5`), not Monday. (`weekly_cap_overrides.week_start_date` keeps its **Monday** anchor — that is the hours/cap week, unrelated to HMOD duty.)
- **C2** (leave anchored to interval start) is unaffected by the cadence change — interval attribution was already "weekend → Friday".
- Spec/docs updated: BSpec §2.5 (and the §appendix summaries) and ARCH §2.6 (+ data-model summaries).
- Test fixture `phase-07-hmod-notify-rpc.sql` re-anchored to a Friday rotor row.

**Reinterpretation requiring your eye (academic-year boundary).** The old academic-year rules assumed the weekend sat at the _end_ of the rotor week. Under Friday anchoring it sits at the _start_, so I adopted this clean generalization (now in BSpec §2.5 / ARCH §2.6): the first rotor week is the Friday 08:00 opening the week that _contains_ the first fall operating date (pre-semester days in that week carry no activity); the last rotor entry is the Friday-anchored week containing the last spring operating date, truncated so no interval runs into summer. If you intended different start/end semantics, flag it — everything else about the change is mechanical.

---

## Part 0 — Decisions I need (answer these first)

### D-1 (Q-P2) — Are HMs eligible swap counterparties?

- **Context:** `isEligibleForSwapCounterparty` excludes HMs and a test asserts it (F-02-002). BSpec §13: HM "can do everything an SM can do," and SMs initiate swaps; §2.3 HMs hold/pick up shifts. No §8 text excludes HMs from swaps.
- **My recommendation: YES — remove the HM exclusion** (BM exclusion stays). Drives fix **D7**.
- **Your decision:** ☐ Remove HM exclusion (recommended) ☐ Keep HMs excluded (I'll update the audit to mark code correct + spec ambiguous) ☐ Other: \_\_\_

### D-2 (Q-P4) — How should publish vs. block-generation be reconciled? (F-04-003)

- **Context:** the Phase 3 generator pre-creates `vacant`/`never_assigned` rows; `publish_schedule` refuses any period that already has assignment rows, so generate→draft→publish always fails.
- **Option A (recommended): publish UPSERTs over the generator's `vacant`/`never_assigned` rows** — copy drafts onto those rows (→ `scheduled`), leave the rest `never_assigned`, drop the "pre-existing assignments" guard. Least disruptive; the generator stays the single source of block rows.
- **Option B:** the generator does **not** pre-create rows for `regular_school_year` dates; publish creates both scheduled and `never_assigned` rows itself (as ARCH §3.9 originally describes). Cleaner conceptually but changes a function used by Phase 3 tests.
- **Your decision:** ☐ Option A (recommended) ☐ Option B ☐ Other: \_\_\_

### D-3 (Q-P4b) — Is `publish_schedule` per-house or per-period-all-houses? (F-04-008)

- **Context:** a single SM is house-scoped (§2.2), but `scheduling_periods` has no `house_id`, and the current function publishes all 13 houses' blocks at once.
- **My recommendation: per-house.** Add a `p_house_id` parameter; publish only that house's blocks/drafts, and authorize the caller as SM/HM/BM of that house. Drives fix **A3**.
- **Your decision:** ☐ Per-house (recommended) ☐ Per-period, all houses (project-admin-only action) ☐ Other: \_\_\_

### D-4 (Q-P7) — Build acknowledge/decline handlers now, or defer? (F-07-007/008)

- **Context:** only the no-ack path exists; nothing sets `acknowledged_at`/`declined_at`, so every float can only no-ack. Phase 8 force-trigger creates pending floats that need an "accept" path.
- **My recommendation: build the `acknowledge_float` + `decline_float` RPCs now** (small, Phase-8-blocking); **defer the full ack-cadence reminder scheduling to Phase 12**, but add the snapshot hook in the float-assignment RPC. Drives fixes **F2 / F3**.
- **Your decision:** ☐ Build ack/decline now + defer cadence (recommended) ☐ Build both now ☐ Defer both to Phase 12 (Phase 8 ships with no accept path — documented) ☐ Other: \_\_\_

### D-5 (Q-P7b) — Do automated (not just force-triggered) pending floats render "(Pending)"? (F-07-015)

- **My recommendation: YES — any `pending_float_in` shows "(Pending)"** regardless of `initiated_by`. Simplest, consistent. (No code change needed now; affects Phase 13 UI + a one-line spec clarification.)
- **Your decision:** ☐ Yes, any pending float (recommended) ☐ Only force-triggered ☐ Other: \_\_\_

### D-6 (Q-P5) — Model cross-house home-side unavailability/gap now, or defer? (F-05-011)

- **Context:** BSpec §5.3 says a cross-house pickup makes the worker unavailable at home and may open a home-side gap. The time-conflict guard + `is_cross_house_pickup` float-exclusion cover the critical cases; the active home-gap creation is unimplemented.
- **My recommendation: defer**, document as a known limitation. Low real-world impact given the conflict guard.
- **Your decision:** ☐ Defer + document (recommended) ☐ Implement home-side gap creation now ☐ Other: \_\_\_

### D-7 (Q-Config-1) — Are `claim_phase_*_offset_days` canonical in `operating_profiles` or `system_config`? (F-01-004)

- **Context:** ARCH §3.10's key list names them as `system_config` keys, but its own prose says profile-scoped params live in `operating_profiles` (where they already are and where the orchestrator reads them).
- **My recommendation: `operating_profiles` is canonical**; do NOT add them to `system_config`. Then F-01-004 reduces to: seed only the genuinely system-wide keys, and annotate the ARCH §3.10 prose. (No spring-fling/cap impact.)
- **Your decision:** ☐ operating_profiles canonical (recommended) ☐ Mirror into system_config too ☐ Other: \_\_\_

### D-8 (Q-Spec-1) — Confirm the acknowledgment-deadline appendices are stale.

- **Context:** BSpec App. A item 3 / ARCH App. C item 3 say reminders anchor to a "T-2h deadline"; the body (§7.1, §4.4, App. B) says **T-10m before float start**. The body is internally consistent.
- **My recommendation: body is canonical (T-10m);** mark the two appendix items as errata. Affects only the (deferred) ack cadence. Drives optional **G-docs** note.
- **Your decision:** ☐ Body canonical, annotate appendices (recommended) ☐ Appendices canonical (re-derive cadence) ☐ Other: \_\_\_

---

## Part 1 — Batch A: Release-blocking authorization & data integrity

### A1 — Lock down `generate_blocks_for_*` (F-03-001 · Critical) **[migration]**

New migration appends:

```sql
REVOKE ALL ON FUNCTION generate_blocks_for_date(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION generate_blocks_for_date(date) TO service_role;
REVOKE ALL ON FUNCTION generate_blocks_for_range(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION generate_blocks_for_range(date, date) TO service_role;
```

Optionally also drop `SECURITY DEFINER` from both (service*role bypasses RLS anyway), per audit Q-03-003. *(confirm signatures.)\_
**Approve?** ☐ yes ☐ no ☐ defer

### A2 — `SECURITY DEFINER` sweep: revoke PUBLIC execute on all mutating/data RPCs (F-04-001/002 + extension · Critical) **[migration]**

The audit's X-1 sweep, enumerated. New migration:

```sql
-- Phase 4
REVOKE ALL ON FUNCTION publish_schedule(uuid) FROM PUBLIC;            -- (confirm signature)
REVOKE ALL ON FUNCTION publish_schedule(uuid, uuid) FROM PUBLIC;      -- (confirm signature)
REVOKE ALL ON FUNCTION publish_schedule_impl(uuid, uuid) FROM PUBLIC; -- (confirm signature)
REVOKE ALL ON FUNCTION submit_preferences(/* exact args */) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION publish_schedule(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION submit_preferences(/* exact args */) TO service_role;

-- Phase 5 (same hole — these take p_user_id and are SECURITY DEFINER with no REVOKE,
-- so any JWT could claim/drop/submit-projection AS ANOTHER USER via direct PostgREST)
REVOKE ALL ON FUNCTION claim_open_shift(uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION drop_shift(uuid[], uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_hours_projection(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_open_shift(uuid, uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION drop_shift(uuid[], uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION claim_hours_projection(uuid, uuid) TO service_role;
```

Read-only feed functions (`weekly_open_shifts_feed`, `weekly_feed_for_house`, `is_assignment_claimable`, `permanent_openings_feed`, `effective_weekly_cap`) are SELECT-only and may stay PUBLIC, **but** I recommend revoking them too and routing feeds through the EF/service-role for consistency — your call:
**Sub-decision:** ☐ Also revoke the read-only feed fns ☐ Leave feeds PUBLIC
**Approve A2?** ☐ yes ☐ no ☐ defer

### A2b — Add identity check inside `submit_preferences` (F-04-002 · Critical) **[migration]**

Even as service-role-only, add defense-in-depth so the EF can't be tricked into a mismatched id:

```sql
-- near the top of submit_preferences body:
IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
  RAISE EXCEPTION 'cannot submit preferences for another user' USING ERRCODE = 'insufficient_privilege';
END IF;
```

(`auth.uid()` is NULL under service_role, so the EF path — which already checks identity — is unaffected.)
**Approve?** ☐ yes ☐ no ☐ defer

### A3 — Fix publish authorization + scope (F-04-001/008 · Critical) **[migration]** — _depends on D-2, D-3_

- Make the single-arg `publish_schedule(uuid)` overload **reject** (or remove it) so a NULL operator can't bypass auth; require `publish_schedule(p_period_id, p_published_by)` with a role check.
- Add the `p_house_id` parameter (if **D-3 = per-house**) and scope the publish to that house; authorize `p_published_by` as SM/HM/BM of `p_house_id` (`user_has_house_admin_role` post-D9, or `user_can_build_schedule`).
- Apply the **D-2** publish-vs-generate resolution (Option A: UPSERT over `never_assigned`; Option B: generator stops pre-creating).
  **Approve?** ☐ yes ☐ no ☐ defer _(I'll bring the exact SQL once D-2/D-3 are answered.)_

---

## Part 2 — Batch B: Hours-cap correctness

### B1 — Rewrite `effective_weekly_cap` to be per-week and spring-fling-aware (F-05-001/002 · Critical) **[migration]**

Proposed (classify each day per §9.3, then take the most-restrictive across the Mon→Sun window):

```sql
CREATE OR REPLACE FUNCTION effective_weekly_cap(
  p_week_start_date date,
  p_block_start_at  timestamptz   -- retained for signature compat; no longer used for the default
) RETURNS TABLE (hours_cap integer, cap_enforcement cap_enforcement_enum)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH days AS (
    SELECT oc.date, oc.profile_name
    FROM operating_calendar oc
    WHERE oc.date BETWEEN p_week_start_date AND (p_week_start_date + 6)
  ),
  classified AS (              -- per-day cap intent per BSpec §9.3
    SELECT
      CASE
        WHEN days.profile_name = 'winter_break' THEN 'hard'
        WHEN EXISTS (SELECT 1 FROM break_periods bp
                     WHERE days.date BETWEEN bp.start_date AND bp.end_date
                       AND bp.break_type IN ('thanksgiving','fall_break','spring_break','winter_break'))
          THEN 'hard'
        ELSE 'soft'           -- regular_school_year AND spring_fling both → soft 20
      END AS day_enforcement
    FROM days
  ),
  agg AS (
    SELECT bool_or(day_enforcement = 'hard') AS any_hard FROM classified
  )
  SELECT
    COALESCE(wco.hours_cap,
             CASE WHEN agg.any_hard THEN 40 ELSE 20 END),
    COALESCE(wco.cap_enforcement,
             CASE WHEN agg.any_hard THEN 'hard' ELSE 'soft' END::cap_enforcement_enum)
  FROM agg
  LEFT JOIN weekly_cap_overrides wco ON wco.week_start_date = p_week_start_date;
$$;
```

Notes: a manual `weekly_cap_overrides` row still wins (correct). Empty week (no calendar rows) → `any_hard=false` → 20 soft; if you'd prefer "no operating days → no cap / reject," say so.
**Approve?** ☐ yes ☐ no ☐ defer

### B2 — Re-add `weekly_cap_overrides` value constraints (F-01-001/002 · Critical/High) **[migration]**

```sql
ALTER TABLE weekly_cap_overrides
  ADD CONSTRAINT weekly_cap_overrides_value_pairing_check
  CHECK ((hours_cap = 20 AND cap_enforcement = 'soft')
      OR (hours_cap = 40 AND cap_enforcement = 'hard'));
```

This supersedes the dropped `IN (20,40)` check (it's strictly stronger). Migration `20260527000002` stays in history; this re-adds correctness forward.
**Approve?** ☐ yes ☐ no ☐ defer

### B3 — Cap tests: exercise the default path (F-05-003/F-01-001 · High) **[test]**

- Add `phase-05-claim.sql` cases that build a **straddling week** (Mon–Wed regular + Thu–Sun Thanksgiving, with matching `operating_calendar` + `break_periods` rows) and assert the Monday claim is hard-40-gated; and a **spring-fling week** asserting 20-soft (claim over 20 succeeds, over 40 with no override still succeeds — soft).
- Flip the F-01-001 schema test to assert the new pairing CHECK **exists**.
  **Approve?** ☐ yes ☐ no ☐ defer

---

## Part 3 — Batch C: Orchestrator routing & float correctness (Phase-8-blocking)

### C1 — Fix HMOD Monday-08:00 handoff (F-07-001 · High) **[migration]**

Replace the `date_trunc('week')` rotor lookup in `resolve_hmod_on_duty` so the rotor week is the one whose **Monday 08:00 → next Monday 08:00** interval contains `p_at`:

```sql
-- inside resolve_hmod_on_duty, replace v_week_start_date computation:
v_week_start_date := (
  date_trunc('week',
    (p_at AT TIME ZONE 'America/New_York') - interval '8 hours'
  )
)::date;
-- subtracting 8h shifts the "week" boundary from Mon 00:00 to Mon 08:00:
-- any moment Mon 00:00–07:59 now maps to the previous Monday's rotor row.
```

**Approve?** ☐ yes ☐ no ☐ defer

### C2 — Anchor HMOD leave to the interval start date (F-07-002 · High) **[migration]**

`resolve_hm_for_user` currently checks leave on `p_at`'s date. For HMOD resolution the leave check must use the **interval's start date**. Cleanest: add an optional `p_interval_start_date date DEFAULT NULL` param; when provided, use it for the leave-date check instead of `p_at::date`. `resolve_hmod_on_duty` computes the interval start (the rotor Monday 08:00, or the relevant weekday 17:00 for overnight intervals) and passes it. HM (weekday) routing keeps using `p_at::date`.

- This needs a small helper to compute the interval start for a given `p_at` (weekday 17:00 intervals → that weekday; weekend Fri 17:00→Mon 08:00 → Friday). I'll bring exact SQL on approval.
  **Approve?** ☐ yes ☐ no ☐ defer

### C3 — Project-administrator notification target (F-07-003 · High) **[migration] + decision**

When leave resolves to NULL (project admin), the urgent notification is currently dropped. Options:

- **C3a (recommended):** seed a designated "project administrator" `users` row (admin-only, `is_active`) and make `resolve_hm_for_user` return it as the terminal instead of NULL; notifications then target it.
- **C3b:** add a `notifications` channel that allows a NULL recipient with a `target='project_admin'` payload + a separate admin delivery path.
  **Decision:** ☐ C3a (recommended) ☐ C3b ☐ Other: \_\_\_
  **Approve fix once decided?** ☐ yes ☐ no ☐ defer

### C4 — Compute the float-conflict flags in the snapshot (F-07-005 · High) **[code]**

In `buildFloatLookupSnapshot` (`orchestrator-tick/index.ts`), replace the hardcoded `hasConflictingFloat: false` / `hasConflictingCrossHousePickup: false` with real per-candidate computation against the gap window:

- `hasConflictingFloat`: candidate has a `float_assignments` row (`status IN ('pending','acknowledged')`) whose destination/source blocks overlap `[gapStart, gapEnd)`.
- `hasConflictingCrossHousePickup`: candidate has a `shift_block_assignments` row with `is_cross_house_pickup = true` overlapping the window.
  Plus **defense-in-depth [migration]**: add a source-status re-check under `FOR UPDATE` in `process_float_lookup_assignment` (abort if a source row is no longer `scheduled`/`claimed`), mirroring the destination vacancy re-check.
  **Approve?** ☐ yes ☐ no ☐ defer

### C5 — Fix float-algorithm multi-run termination (F-06-001 · High) **[code] + [test]**

In `findFloaters` (`float-lookup/index.ts`), the per-source `while` loop must try **every** uncovered run ≥2 before abandoning the source, not just the largest. Proposed: when `chooseCandidateForCurrentRun(targetRun)` returns null, fall back to the next-largest uncovered run; only `break` when no run ≥2 has any eligible worker. Add a regression test (`partial-coverage.test.ts` or `integration.test.ts`): interior hole leaves `[1,2,3]` + `[7,8]`, the only remaining eligible worker covers `[7,8]` → assert `[7,8]` is floated, not sent to Allied.
**Approve?** ☐ yes ☐ no ☐ defer

### C6 — Make the deployed orchestrator logic the tested logic (F-07-004/X-6 · High) **[code] + [test]**

Two viable shapes — pick one:

- **C6a (recommended):** have the EF `import` `evaluateChainSteps` from `packages/core/src/orchestrator/evaluate.ts` (delete the inline copy), and **delete** the unused `orchestrator/{no-ack,routing}.ts` + `escalation/*` modules (the no-ack/routing logic is canonically the SQL RPCs). Retarget `no-ack-trigger.test.ts` / `notification-routing.test.ts` at the pgTAP RPC suites, and **port the routing edge cases** (Monday handoff, leave anchoring, 08:00/17:00 boundaries) into `phase-07-hmod-notify-rpc.sql`.
- **C6b:** keep the TS modules and make the EF call them for routing/no-ack too (larger refactor; duplicates the SQL).
  **Decision:** ☐ C6a (recommended) ☐ C6b ☐ Other: \_\_\_
  **Approve once decided?** ☐ yes ☐ no ☐ defer

---

## Part 4 — Batch D: Cross-phase consistency

### D9 — Revert `user_has_house_admin_role` to HM/BM-only; add `user_can_build_schedule` (X-2/F-04-004/F-03-002 · High) **[migration]**

```sql
CREATE OR REPLACE FUNCTION user_has_house_admin_role(check_user_id uuid, check_house_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM user_roles
                 WHERE user_id = check_user_id AND role IN ('hm','bm')
                   AND scope_house_id = check_house_id);
$$;  -- back to HM/BM only

CREATE OR REPLACE FUNCTION user_can_build_schedule(check_user_id uuid, check_house_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM user_roles
                 WHERE user_id = check_user_id AND role IN ('sm','hm','bm')
                   AND scope_house_id = check_house_id);
$$;
```

Then re-point the policies/queries that legitimately need SM (the `draft_block_assignments` policy, the publish auth in A3) to `user_can_build_schedule`, leaving `users`/`user_roles`/`shift_block_assignments`/`float_assignments` admin policies on the HM/BM-only helper. **Risk:** this narrows SM visibility on some surfaces back to spec — I'll enumerate each affected policy before applying.
**Approve?** ☐ yes ☐ no ☐ defer

### D10 — Restore the role filter in `send_preference_reminders` (X-4/F-07-006 · High) **[migration]**

In the Phase 7 redefinition, change the candidate join from `JOIN users ON users.is_active = true` to additionally require a worker role:

```sql
... JOIN users ON users.is_active = true
    JOIN user_roles ur ON ur.user_id = users.user_id AND ur.role IN ('sw','sm')
... -- then SELECT DISTINCT users.user_id (a worker may hold sw+sm)
```

Excludes BMs and pure-HMs (who can't submit preferences).
**Approve?** ☐ yes ☐ no ☐ defer

### D11 — Add `hmod_rotor.hmod_user_id` FK + role trigger (F-02-001/F-01-005/F-01-007 · High/Medium) **[migration]**

```sql
ALTER TABLE hmod_rotor
  ADD CONSTRAINT hmod_rotor_hmod_user_id_fkey
  FOREIGN KEY (hmod_user_id) REFERENCES users(user_id);

CREATE OR REPLACE FUNCTION enforce_hmod_rotor_role() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_roles
                 WHERE user_id = NEW.hmod_user_id AND role IN ('hm','bm')) THEN
    RAISE EXCEPTION 'HMOD must hold an hm or bm role' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER hmod_rotor_enforce_role
  BEFORE INSERT OR UPDATE OF hmod_user_id ON hmod_rotor
  FOR EACH ROW EXECUTE FUNCTION enforce_hmod_rotor_role();
```

**Approve?** ☐ yes ☐ no ☐ defer (FK and trigger can be approved separately)

### D12 — Collapse the duplicate core modules (X-3/F-04-005/F-05-009/F-02-007 · High/Low) **[code]**

For each pair, keep one source of truth and re-export (or delete) the other; expose the §9.1 hours decomposition at the package root:

- **phase1Grouping:** decide canonical (recommend the _tested_ `scheduling/phase1Grouping.ts`), delete the divergent `schedule-builder/phase1-grouping.ts`, update `index.ts` to export the canonical one. _(This is the one with two real implementations — needs care.)_
- **hours:** make `hours/index.ts` re-export `computeWeeklyHours` (the decomposition version) under a distinct name, or expose the decomposition; remove the name collision.
- **cross-house / users-eligibility:** keep the thin re-exports (harmless) or inline — low priority.
  **Approve?** ☐ yes ☐ no ☐ defer (per-module ok)

---

## Part 5 — Batch E: Schema hardening (batchable into one migration)

### E1 — `shift_block_assignments` invariant CHECKs (F-03-004/005 · Medium) **[migration]**

```sql
ALTER TABLE shift_block_assignments
  ADD CONSTRAINT sba_user_id_matches_status
    CHECK ((status IN ('vacant','allied')) = (user_id IS NULL)),
  ADD CONSTRAINT sba_parent_float_matches_is_float
    CHECK ((is_float = true) = (parent_float_id IS NOT NULL));
```

**Caveat:** existing test fixtures that insert `(status='scheduled', user_id=NULL)` to provoke the `vacancy_origin` CHECK will need a user_id added. I'll flag those.
**Approve?** ☐ yes ☐ no ☐ defer (each CHECK separately ok)

### E2 — `scheduling_periods.profile_name` pinned (F-01-003 · High) **[migration]**

`ALTER TABLE scheduling_periods ADD CONSTRAINT scheduling_periods_profile_check CHECK (profile_name = 'regular_school_year');`
**Approve?** ☐ yes ☐ no ☐ defer

### E3 — `operating_profiles` claim-phase-null CHECK (F-01-006 · Medium) **[migration]**

`CHECK ((scheduling_mode='sm_built' AND claim_phase_open_offset IS NULL AND claim_phase_alert_offset IS NULL AND claim_phase_close_offset IS NULL) OR (scheduling_mode='claim_based' AND claim_phase_open_offset IS NOT NULL AND claim_phase_alert_offset IS NOT NULL AND claim_phase_close_offset IS NOT NULL))`
**Approve?** ☐ yes ☐ no ☐ defer

### E4 — JSON-shape CHECKs on `staffing_patterns.block_headcounts` and `operating_profiles.escalation_chain` (F-01-008a/b · Medium) **[migration]**

Array-typeof + per-element key/Type checks (full SQL on approval). Prevents a `"float_lockup"` typo silently no-opping the float step.
**Approve?** ☐ yes ☐ no ☐ defer

### E5 — Date-range overlap exclusions on `break_periods` / `scheduling_periods` (F-01-009a/b · Medium) **[migration]**

`CREATE EXTENSION IF NOT EXISTS btree_gist;` then `EXCLUDE USING gist (daterange(start_date,end_date,'[]') WITH &&)` (scheduling_periods scoped to `regular_school_year`).
**Approve?** ☐ yes ☐ no ☐ defer

### E6 — Convert Phase 6 `text+CHECK` columns to enums (X-5/F-06-002 · Medium) **[migration]**

Create `float_status_enum`, `float_initiated_by_enum`, `float_exclusion_reason_enum`; `ALTER … TYPE … USING …::enum`; regenerate `database.types.ts`.
**Approve?** ☐ yes ☐ no ☐ defer

### E7 — Smaller schema constraints (Medium/Low, batchable) **[migration]**

- F-02-009: `user_roles` sw-scope CHECK (`(role='sw' AND scope_house_id IS NULL) OR (role IN ('sm','hm','bm') AND scope_house_id IS NOT NULL)`).
- F-02-010: `users.email` UNIQUE.
- F-01-010: `hm_leave` self-replacement CHECK (`user_id <> replacement_user_id OR replacement_user_id IS NULL`).
- F-01-014: `houses.id` / `profile_name` format + non-empty CHECK.
- F-01-015: Monday CHECK on `weekly_cap_overrides.week_start_date` and `hmod_rotor.week_start_date`.
- F-01-013: `set_modified_at()` BEFORE UPDATE trigger on the three `modified_at` tables.
  **Approve?** ☐ approve all ☐ pick: \_\_\_ ☐ no ☐ defer

---

## Part 6 — Batch F: Behavioral completeness (Phase-8-adjacent)

### F1 — Drop-handler corrections (F-05-004/005/006/007 · Medium) **[migration] + [code]**

- **F-05-004:** include `floated_out`/`pending_float_out` in `drop_shift`'s ownable-status filter so a floating worker can drop their home-floated row.
- **F-05-005:** reject dropping blocks whose `block_start_at` is before the current 30-min boundary (no vacating history).
- **F-05-006:** gate `direct_hmod_notification` (and escalation intent) on a below-required-headcount check, not just the 2h time test.
- **F-05-007 [code]:** `claim-shift` EF rejects `claim_type='permanent'` (501/400) until permanent pickup ships.
  **Approve?** ☐ approve all ☐ pick: \_\_\_ ☐ no ☐ defer

### F2 — Acknowledge + decline RPCs (F-07-007 · High) **[migration] + [test]** — _depends on D-4_

If **D-4 = build now:** add `acknowledge_float(p_float_id, p_user_id, p_now)` (pending→acknowledged; `pending_float_in`→`floated_in`, `pending_float_out`→`floated_out`; sets `acknowledged_at`) and `decline_float(p_float_id, p_user_id, p_now)` (reuses the `process_no_ack_float` void+exclude+reconcile+HMOD logic, reason `declined`), both `SECURITY DEFINER` + `REVOKE`/`GRANT` + identity check. Add pgTAP coverage. This unblocks Phase 8's force-trigger accept path.
**Approve?** ☐ yes ☐ no ☐ defer

### F3 — Ack-cadence snapshot hook (F-07-008 · Medium) **[migration]** — _depends on D-4_

If deferring full delivery to Phase 12: add the snapshot of `ack_cadence_config` offsets into `process_float_lookup_assignment` (write the `ack_reminder` `notifications` rows with computed `scheduled_for`, honoring per-house 6h/2h + mandatory 1h/30m/5m and the "skip past-due" rule). Or formally defer with a tracked Phase-12 dependency.
**Approve?** ☐ build snapshot now ☐ defer to Phase 12 (documented) ☐ no

### F4 — No-ack multi-block + `declined_at` semantics (F-07-009/010 · Medium) **[migration]**

- F-07-009: claim `hmod_notify_allied` once per gap (group by contiguous run) rather than per-first-block, so a multi-block destination emits one HMOD notification.
- F-07-010: add a `no_ack_at` column (or a status/reason flag) so a no-ack isn't recorded as `declined_at`.
  **Approve?** ☐ approve both ☐ pick: \_\_\_ ☐ no ☐ defer

---

## Part 7 — Batch G: Tests, docs, hygiene (low risk)

### G1 — Test coverage additions (F-04-006/F-02-006/F-06-003/F-01-011/F-02-005/F-03-007/F-02-008 · Medium/Low) **[test]**

pgTAP for the Phase 6 migration (float tables/trigger/FK/RLS); tests for `submit_preferences`/`send_preference_reminders`/`publish_schedule` auth; negative-path constraint-rejection + runtime RLS-deny tests for Phase 1/2 (`SET ROLE authenticated`); `blocksBetween` + `isEligibleForScheduleRoster` unit tests.
**Approve?** ☐ approve all ☐ pick: \_\_\_ ☐ no ☐ defer

### G2 — Phase 7 cron GUC + `is_hm_working_time` volatility (F-07-011/012 · Medium/Low) **[migration] + ops]**

Document/require `app.supabase_url`/`app.service_role_key` (or move to a safer secret mechanism); mark `is_hm_working_time` `STABLE` not `IMMUTABLE`.
**Approve?** ☐ yes ☐ no ☐ defer

### G3 — `resolve_hm_for_user` depth-10 handling (F-07-013 · Low) **[migration]**

On depth exhaustion, fall back to the on-duty HMOD and emit a config-error notification, instead of returning NULL silently (per ARCH §2.7).
**Approve?** ☐ yes ☐ no ☐ defer

### G4 — Remove test-only operator from production migration (F-02-003 · Medium) **[migration] + [test]**

Relocate `name_array_contained_by_text_array` + `<@` operator out of the schema; rewrite the four pgTAP suites' array comparisons to use built-in operators on cast `text[]`.
**Approve?** ☐ yes ☐ no ☐ defer

### G5 — Remove committed `.js` build artifacts from `src/` (F-00-013/F-06-006 · Low) **[code]**

Untrack `packages/core/src/float-lookup/*.js`, gitignore emitted JS, ensure build targets `dist/`.
**Approve?** ☐ yes ☐ no ☐ defer

### G6 — `tests/PHASE_PLAN.md` regenerate (F-00-007 · Medium) **[docs]**

Rebuild the table from `prompts/README.md` (or delete the file).
**Approve?** ☐ yes ☐ no ☐ defer

### G7 — Phase 0 template hygiene & tooling (F-00-001..014 · High→Nit) **[mixed]**

Bundle (approve individually if you prefer):

- **G7a (High):** resolve KMP module naming `composeApp` vs `androidApp`+`shared` (per D-decision: restructure, or amend spec+AGENTS+Phase13 prompts).
- **G7b (High):** fix iOS bundle id / app name / Gradle root / Kotlin package off `com.myapplication`.
- **G7c (Medium):** add `ktlint` + `*.kt` lint-staged; install Playwright + Maestro scaffolding; resolve ESLint v8/v9 split.
- **G7d (Low/Nit):** delete template `README.md`/`readme_images/`/`LICENSE.txt`/`cleanup.sh`; set `config.toml` project_id; remove create-next-app marketing; CI docker caching.
  **Approve?** ☐ approve G7 all ☐ pick: \_\_\_ ☐ no ☐ defer

### G8 — Spec errata note (D-8 · Nit) **[docs]**

Add an errata line near BSpec App. A item 3 / ARCH App. C item 3 noting the T-10m-before-float-start deadline is canonical.
**Approve?** ☐ yes ☐ no ☐ defer

---

## Part 8 — Quick approval summary (fill this in, or just reply in prose)

| Batch                      | Items                  | Decision     |
| -------------------------- | ---------------------- | ------------ |
| **Decisions**              | D-1…D-8                | answer above |
| **A** (authz/integrity)    | A1, A2, A2b, A3        |              |
| **B** (cap)                | B1, B2, B3             |              |
| **C** (orchestrator/float) | C1, C2, C3, C4, C5, C6 |              |
| **D** (cross-phase)        | D9, D10, D11, D12      |              |
| **E** (schema)             | E1–E7                  |              |
| **F** (behavioral)         | F1, F2, F3, F4         |              |
| **G** (tests/docs/hygiene) | G1–G8                  |              |

**Suggested minimum to unblock Phase 8:** all of **A**, **B**, **C**, plus **D9, D10, D11**, **E1/E2**, and **F2** (per D-4). Everything else can follow.

Once you mark approvals and answer Part 0, I'll implement in batch order (new forward migrations only; run pgTAP + vitest after each batch) and report back.

---

## Implementation status (2026-05-28)

Verified = pgTAP suite (670 tests) and/or vitest (337+ tests) green after `supabase db reset`.

### Done + verified

- **HMOD Friday 08:00 boundary** — migration `20260528000008`, spec/arch, fixture. (also satisfies C1, E7/F-01-015 rotor half.)
- **Batch A** — `20260528000009` (A1 generators locked; A2 mutating RPCs revoked; A2b submit_preferences identity guard) + `20260528000010` (A3 per-house publish, D-2 Option A UPSERT, `period_house_publications`, `user_can_build_schedule`). phase-04-publish rewritten.
- **Batch B** — `20260528000011` (B1 per-week/spring-fling effective_weekly_cap; B2 value-pairing CHECK) + B3 new `phase-05-cap.sql`; fixed flaky phase-05-claim #20 (Monday-anchored as_of) and phase-05-feed-queries #22-23 (day_of_week-scoped assertions).
- **Batch C (SQL)** — `20260528000012` (C2 interval-start leave anchoring + `hmod_interval_start_date`; C3a project-admin notify fallback via system_config; C4 source-status re-check) + C5 `findFloaters` multi-run termination + regression test in `partial-coverage.test.ts`.
- **Batch D (part)** — `20260528000013` (D10 reminder sw/sm role filter; D11 hmod_rotor FK + hm/bm role trigger).

### Remaining (recommend as reviewed units, not blind autonomous edits)

- **C4-TS / C6a** — Edge Function (`orchestrator-tick`): compute snapshot conflict flags; import `evaluateChainSteps` from core, delete inline copy + unused `orchestrator/{no-ack,routing}.ts` + `escalation/*`, retarget the 49 TS tests at pgTAP. Not verifiable by the current owner-role suite.
- **D9** — narrow `user_has_house_admin_role` to hm/bm and re-point ~12 schedule-builder RLS policies to `user_can_build_schedule`. **Blocked on G1** (SET ROLE authenticated tests) to verify RLS correctness; risky to ship unverified.
- **D12** — collapse duplicate core modules (keep tested `scheduling/phase1Grouping.ts`).
- **Batch E** — E1 (sba invariant CHECKs; fixture caveat), E2/E3/E5/E7 constraints (verify each against seed/fixtures first — some may violate existing data), E4 JSON-shape CHECKs, E6 enum conversion + `supabase gen types`.
- **Batch F** — F1 drop-handler corrections; **F2 acknowledge_float/decline_float RPCs (top Phase-8-unblock priority, D-4)**; F3 ack-cadence snapshot hook; F4 no-ack multi-block + no_ack_at.
- **Batch G** — G1 test coverage (incl. RLS-deny tests that unblock D9), G2-G6 hygiene, G7 KMP template restructure, G8 spec errata.

### Update (later 2026-05-28)

- **F2 shipped + verified** — `20260528000014` (acknowledge_float, decline_float; both SECURITY DEFINER + identity check + service-role-only) and new `phase-07-ack-decline.sql` (15 tests). Top Phase-8-unblock item done.
- **E (safe subset) shipped** — `20260528000015` (E2 scheduling_periods profile pin; F-01-015 weekly_cap_overrides Monday CHECK). Suite at **685 pgTAP green**.
- Still remaining: F1/F3/F4; E1/E3/E4/E5/E6 + remaining E7 (per-constraint seed check first); D9 (needs G1 RLS tests); D12; C4-TS + C6a (Edge Function); G.

### Final update — all backend batches complete (2026-05-28)

- **Batch C** fully done incl. C4-TS (snapshot conflict flags) + C6a (EF now imports core `evaluateChainSteps`; dead `orchestrator/{no-ack,routing}` + `escalation/*` removed; routing edge cases ported to `phase-07-routing-edge.sql`).
- **Batch D** fully done incl. D9 (RLS re-point, verified by `phase-04-rls.sql`) + D12 (module dedup).
- **Batch E** fully done (E1-E7, float enums, `database.types.ts` regenerated).
- **Batch F** fully done (F1-F4).
- **Batch G**: G1 (RLS-deny + cap + routing + behavioral + roster/blocks unit tests), G2 (is_hm_working_time STABLE), G3 (satisfied by C3a project-admin terminal — no silent NULL drop), G4 (test-only `<@` operator removed + suites rewritten), G5 (`.js` artifacts untracked + gitignored), G6 (PHASE_PLAN source-of-truth note), G8 (spec errata).
- **Status: pgTAP 711 + vitest 297 + type-check all green.**

**Sole residual — G7 (Phase-0 KMP/mobile template hygiene):** G7d is already clean (config.toml project_id set; template cruft absent). G7a (KMP `composeApp` vs current `androidApp`+`shared` naming) is a decision the audit itself flagged (restructure vs amend spec/AGENTS/Phase-13 prompts) and G7b/c (iOS bundle id, ktlint/Playwright/Maestro, ESLint v8/v9) require a mobile/Gradle + e2e build to verify. These are Phase-13 mobile-scaffolding items and do not affect backend Phase-8 readiness; they need a mobile build environment + the G7a naming decision to close.

### G7 resolved — mobile refactored to `composeApp` (2026-05-28)

Per the G7a decision (**composeApp**) and using the **`android` CLI** (skill `android-cli`) for up-to-date implementations:

- `apps/mobile` rebuilt as a modern Android Jetpack Compose app generated by `android create empty-activity`: single Gradle module **`:composeApp`**, package **`com.pennhousing.shift`**, app name "Shift PennHousing", **AGP 9.0.1 / Kotlin 2.3.20 / Gradle 9.1.0 / version catalog**. Removes the stale `com.myapplication` / "MyApplication" identifiers (G7b) and template cruft (G7d: LICENSE.txt/README.md/cleanup.sh/readme_images).
- **Build-verified:** `./gradlew :composeApp:assembleDebug` → BUILD SUCCESSFUL (debug APK).
- CI (`build-android` → `:composeApp:assembleDebug`), AGENTS.md mobile guidance, and the mobile-scaffolding memory updated to match.
- **Platform change to flag:** the `android` CLI produces Android-only Compose (no Compose-Multiplatform). The old `androidApp`+`shared`+`iosApp` (CMP, pre-Phase-13 boilerplate) were removed and the iOS CI job retired. **iOS is deferred to Phase 13.** BSpec/ARCH still say "Android + iOS ship together" — that platform commitment needs your spec update if iOS is dropped for good.
- G7c (ktlint / Playwright / Maestro / ESLint v8-v9) remains as optional tooling additions; the CLI scaffold ships JUnit/Espresso/Compose-UI test deps.

---

## Post-verification pass (2026-05-29)

Independent re-verification of the remediation (pgTAP re-run = **711 green baseline**, vitest 297, type-check) confirmed the large majority of fixes landed correctly, but found **3 Phase-8 blockers** that were then fixed and verified (suite now **721 pgTAP green**):

1. **F-07-009 fix was incorrect (runtime bug).** `process_no_ack_float` (`20260528000021`) assigned `GET DIAGNOSTICS = ROW_COUNT` into a **boolean**; the multi-block destination gap the fix targets makes ROW_COUNT ≥ 2 → no int8→bool cast → `boolin('2')` error. Fixed in `20260528000025` (integer count + `IF > 0`, matching the `…007` sibling). Regression test added (`phase-07-no-ack-rpc.sql` multi-block scenario).
2. **C3a project-admin terminal was inert.** `system_config('project_administrator_user_id')` was read by two RPCs but never seedable (`value_type_enum` had no `uuid` member) and never set, so leave→NULL urgent notifications were still dropped (re-opening F-07-003). Fixed: `20260528000026` adds the `uuid` value-type; `20260528000025` makes both urgent-notify paths `RAISE WARNING` instead of silently dropping; `phase-07-admin-terminal.sql` proves the configured path routes to `project_admin`. **Deploy requirement** documented in AGENTS.md (every env must set the key to an active admin `user_id`).
3. **D9 over-corrected SM permissions (spec regression).** Reverting `user_has_house_admin_role` to hm/bm-only also removed the destination SM's READ visibility of inbound floats / live schedule, which BSpec §7.1/§10 require. Fixed in `20260528000027` (re-point `float_assignments` / `float_exclusions` / `shift_block_assignments` SELECT to `user_can_build_schedule`; admin over users/roles stays hm/bm-only). `phase-07-sm-float-visibility.sql` proves scoped SM access with no X-2 over-reach.

**Exhaustiveness:** the original audit was strong but not exhaustive — it missed the §7.1 SM-visibility requirement (#3) and understated F-07-009 as no-ack-only. **Deferred (non-blocking, tracked for Phase 8):** NEW-1/NEW-9 the same multi-block HMOD-notification fan-out in the primary tick path (`orchestrator-tick` `processVacantBlocks`, TS — only the no-ack copy was deduped); NEW-6 `effective_weekly_cap` down-classifying an under-populated `short_break` day to soft-20; NEW-8 the 3-arg `resolve_hm_for_user` REVOKE living in a later migration than its definition; F-06-003 float-table schema pgTAP; the B3 F-01-001 test-flip; F3 ack-snapshot skip-past-due/non-default-cadence coverage.

### Mobile: G7 Android-only → multiplatform (2026-05-29) — supersedes the "G7 resolved" section above

The G7 resolution (Android-only `:composeApp`) was reversed per user direction:
`apps/mobile` is now a **Kotlin Multiplatform** project following Google's
Fruitties sample (shared logic + native UI) — `:shared` (commonMain/androidMain/iosMain,
3 iOS targets + SKIE → `Shared` framework) + `:androidApp` (Jetpack Compose) +
`iosApp` (SwiftUI). This re-aligns with BSpec/ARCH "Android + iOS ship together."
Toolchain mirrors Fruitties: AGP 8.13.1 / Kotlin 2.2.21 / Gradle 9.2.1 (down from
the scaffold's AGP 9.0.1 / Kotlin 2.3.20, for SKIE/KMP compatibility). **Build-verified:**
`:androidApp:assembleDebug` → APK; `:shared:testAndroidHostTest` green;
`:shared:linkDebugFrameworkIosSimulatorArm64` → `Shared.framework` (Xcode 26.1). CI gained a
macOS `build-ios` job; AGENTS.md + Phase-0/13a prompts updated. The iosApp `.xcodeproj` /
signing is set up in Xcode (see `apps/mobile/iosApp/README.md`).
