# S1 — Admin override · TEST_PLAN (behavior contract + pinned decisions)

Decision 1 / audit #1 ("Correct, L"). Make the live-calendar inline override real: an
HM/SM can **assign / reassign / remove** a worker on a published block, **this-week-only
vs permanent**, with a **soft-constraint confirm**. Also the backend post-publish edits rely on.

Spec: BSpec §4.3 (Phase-3 override), §11.1, §1.2/§1.5 (invariants), §9.3 (caps), §4.5;
brief §6.1. This doc is the source of truth for the session; it pins the ambiguous calls.

> **Firewall:** the **Implementer** receives §§1–4 below (scope, decisions, architecture,
> behavior contract) and the **file allowlist** — but **must not open any test file**
> (`supabase/tests/**`, `packages/core/tests/**`, `apps/web/e2e/**`). §5 (test plan) is for
> the **Test Author** only. Failures are relayed to the implementer as behavioral paraphrases.

---

## 1. Scope (pinned)

**IN:**

- **Same-house** override only: the operator assigns/removes a worker whose `home_house_id`
  equals the block's house, on that house's blocks. (The calendar is per-house.)
- Three ops: **assign** (fill a vacant seat), **reassign** (replace the worker on an occupied
  non-float seat = vacate incumbent + seat new, atomically), **remove** (vacate a seat).
- Two scopes: **this_week** (the clicked occurrence/span only) and **permanent** (the clicked
  occurrence + every future in-semester occurrence of the same `(house, NY-DOW, NY-time)` slot).
- Soft-constraint **confirm** (override-advisories) for `cannot` / opted-out / over-soft-cap / over-target.

**OUT (deferred — flag, do not fake):**

- **Cross-house** manual placement (placing a worker from another house = pickup/float
  semantics). The worker-picker is filtered to the block-house roster; the RPC rejects a
  cross-house target with `cross_house_not_supported`. Follow-up session.
- **Float-committed seats** (`floated_in` / `floated_out` / `pending_float_in` /
  `pending_float_out`): direct override is rejected with `float_committed`; the admin uses the
  float decline/void controls instead. (Avoids float-reconciliation/no-takeback complexity here.)
- **Force-trigger** on a gap (that's S2).

---

## 2. Pinned decisions

- **D1 — timing.** Admin override is an admin power, not a worker claim: it does **not** apply
  the worker T-2h claim cutoff. It **does** reject a block that has already started/past
  (`block_start_at <= now`) — reason `block_started` (escalation/edits never run after start).
- **D2 — hard cap is absolute.** Over the **40h hard** cap = hard block `hard_cap_exceeded`,
  **not** overridable even with `p_override_advisories=true` (BSpec §9.3/§820). Over the **20h
  soft** cap = advisory (overridable).
- **D3 — float-committed seats are out of scope** (see §1 OUT) → hard block `float_committed`.
- **D4 — resulting status.** A successful assign yields `status='claimed'`,
  `vacancy_origin='none'` (mirrors `claim_open_shift` / `permanent_pickup_slot`). Same-house ⇒
  `is_cross_house_pickup=false`, `source_house_id=NULL`, `is_float=false`.
- **D5 — permanent mechanics.** Derive the slot `(house_id, NY-DOW, NY local time-of-day)` from
  the clicked `block_ids`; act on all occurrences with `block_start_at > now`, `<= semester
end_date`, `profile_name='regular_school_year'`. Reuse `permanent_drop_slot`(operator) for
  remove and `permanent_pickup_slot` for assign; reassign-permanent composes drop+pickup in one
  txn. Permanent remove **skips** float-committed occurrences (as `permanent_drop_slot` already does).
- **D6 — remove writes no escalation.** `admin_remove_worker` only vacates the seat
  (this_week → `temporary_drop`; permanent → `permanent_drop`). It writes **no**
  `block_step_status`; the orchestrator tick re-escalates emergently from the vacancy. (It does
  write the people-management alerts for permanent remove — see contract.)
- **D7 — authz.** `canBuildSchedule` (sm/hm/bm) **and** the operator's admin house == the
  block's house. Else reject (`not_authorized`). RPCs are `SECURITY DEFINER`, `REVOKE FROM
PUBLIC`, `GRANT TO service_role`; the web calls via the service client (mirrors
  `publishScheduleAction`).
- **D9 — cap projection (mirror `claim_open_shift`).** Compute the worker's NY calendar week
  (Mon 00:00 → next Mon). Count their existing **counting-status** seats that week
  (`status IN ('scheduled','claimed','floated_in','pending_float_in')`) → `existing`. Read
  `effective_weekly_cap(week)` → `(hours_cap, cap_enforcement)`. Let `added` = newly-assigned
  blocks. If `(existing + added) * 0.5 > hours_cap`: when `cap_enforcement='hard'` → hard block
  `hard_cap_exceeded` (never overridable, D2); when `'soft'` → advisory `soft_cap`.
- **D8 — Harnwell.** Same-house scope means a Harnwell block only ever offers Harnwell-home
  workers, so training is satisfied by construction; the DB trigger remains as the absolute
  backstop and is asserted in pgTAP (defense-in-depth).

---

## 3. Architecture (shared with implementer)

**New pure core** — `packages/core/src/admin-override/{types.ts,index.ts}` (+ barrel line in
`packages/core/src/index.ts`). Pure, Supabase-free, clock injected as `now: Date`. House style:
model on `force-trigger/validation.ts` (discriminated-union result, fixed precedence) and the
`Phase2Advisory` union in `scheduling/scheduleBuilderCard.ts`.

- `evaluateAdminAssignment(input): { ok: true; advisories: AdminAdvisory[] } | { ok: false; hardBlocks: AdminHardBlock[] }`
- `evaluateAdminRemoval(input): { ok: true } | { ok: false; hardBlocks: AdminHardBlock[] }`
- `AdminHardBlock.reason ∈ { 'worker_inactive','hard_cap_exceeded','block_started','float_committed','seat_not_assignable','not_occupied_by_worker','cross_house_not_supported' }`
- `AdminAdvisory` is a discriminated union mirroring `Phase2Advisory`:
  `{ kind: 'cannot'; blockId: string; blockStartAt: Date } | { kind: 'opted_out' } | { kind: 'soft_cap' } | { kind: 'over_target' }`.
- Hard precedence over advisories; reasons are short snake_case literals.

**New RPCs** — one migration `supabase/migrations/<ts>_s1_admin_override.sql`:

- `admin_assign_worker(p_operator_user_id uuid, p_block_ids uuid[], p_user_id uuid, p_scope text, p_override_advisories boolean, p_now timestamptz) RETURNS jsonb`
- `admin_remove_worker(p_operator_user_id uuid, p_block_ids uuid[], p_user_id uuid, p_scope text, p_now timestamptz) RETURNS jsonb`
- Authoritative SQL enforcement of every hard block (RAISE `P0001` snake_case); soft advisories
  gate on `p_override_advisories` — when a soft advisory applies and the flag is false, do **not**
  write; signal `needs_confirm` (return `{needs_confirm:true, advisories:[...]}` jsonb, no RAISE).
  Reuse `effective_weekly_cap`, `permanent_pickup_slot`, `permanent_drop_slot`. Keep the
  `valid_vacancy_origin` constraint satisfied on every write. Then
  `supabase gen types … > packages/shared/src/database.types.ts`.

**Web** — `apps/web`:

- `lib/data/calendar.ts`: add `blockIds: string[]` (+ `startAtIso`, `dateKey`) to `CalShift` and
  populate from the real block rows; add `assignableWorkers` (block-house roster: userId, name,
  roles, isActive, weeklyHours) to `CalendarModel` (copy `lib/data/people.ts` fetch).
- `lib/actions/override.ts`: `assignWorker` / `removeWorker` server actions, `ActionResult`
  shape, `createServiceClient().rpc(...)`, gate on `canBuildSchedule` + house match,
  `revalidatePath('/calendar')`, 2-step confirm (override=false → `needs_confirm` → override=true).
- `components/calendar/ShiftDetailPanel.tsx`: replace the disabled "Read-only in this build"
  block with the live worker-picker + scope toggle (This week / Permanent) + an advisory-confirm
  modal; remove button on an occupied non-float seat.
- New `data-testid`s (add to `apps/web/e2e/README.md` selector table): `override-section`,
  `override-worker-select`, `override-scope-week`, `override-scope-permanent`, `override-submit`,
  `override-remove`, `override-advisory-confirm`, `override-advisory-accept`, `override-success`.

**File allowlist for the Implementer** (edit only these; do **not** open tests):
`packages/core/src/admin-override/*`, `packages/core/src/index.ts`,
`supabase/migrations/<ts>_s1_admin_override.sql`, `packages/shared/src/database.types.ts` (generated),
`apps/web/lib/data/calendar.ts`, `apps/web/lib/actions/override.ts`,
`apps/web/components/calendar/ShiftDetailPanel.tsx`,
`apps/web/components/calendar/HouseCalendar.tsx` (prop threading only),
`apps/web/app/(app)/calendar/page.tsx` (if needed), plus any small CSS for the panel.
**Off-limits to the implementer:** everything under `apps/web/e2e/**`, `packages/core/tests/**`,
`supabase/tests/**` (test-author-owned), and `supabase/seed.sql` (the Lead adds e2e fixtures).

---

## 4. Behavior contract (`should…` — given to implementer; each maps to ≥1 test)

### 4a. Core validator — `evaluateAdminAssignment` / `evaluateAdminRemoval` (Vitest, pure)

- assigning an **inactive** worker → hard block `worker_inactive`.
- assigning over the week's **hard (40h)** cap → hard block `hard_cap_exceeded`, even when
  `overrideAdvisories` is set (hard caps are not overridable).
- assigning to a block whose start `<= now` → hard block `block_started`.
- assigning to a **float-committed** seat (`floated_*`/`pending_float_*`) → hard block `float_committed`.
- assigning to a seat that is not vacant (for fill) and not a reassignable occupied seat → `seat_not_assignable`.
- assigning a worker whose home house ≠ block house → hard block `cross_house_not_supported`.
- assigning a worker marked **`cannot`** for a block → advisory `cannot` (carries the block time).
- assigning an **opted-out** worker → advisory `opted_out`.
- assigning over the week's **soft (20h)** cap → advisory `soft_cap`.
- assigning beyond the worker's **target hours** → advisory `over_target`.
- a worker with **no preference / 'none'** for the span → no advisory, assignable.
- a preferred/available, within-target, within-cap worker → `{ ok: true, advisories: [] }`.
- when both a hard block and an advisory apply → result is `ok:false` with the hard block (precedence).
- removal of a `scheduled`/`claimed` seat occupied by the named worker → `ok:true`.
- removal of a block already started → hard block `block_started`.
- removal of a float-committed seat → hard block `float_committed`.
- removal where the seat isn't occupied by the named worker → `not_occupied_by_worker`.
- the validators are pure: identical input + injected `now` → identical output.

### 4b. RPCs — `admin_assign_worker` / `admin_remove_worker` (pgTAP, authoritative)

**Existence:** both functions exist with the pinned signatures (`has_function`).
**Assign — this_week happy path:**

- assigning a vacant same-house seat sets `status='claimed'`, `user_id=target`,
  `vacancy_origin='none'`, `is_cross_house_pickup=false`, `source_house_id=NULL`.
- reassigning an occupied (non-float) seat vacates the incumbent (no longer on the block) and
  seats the new worker, in one atomic call.
  **Assign — permanent:**
- permanent assign fills every future in-semester occurrence of the slot with the worker
  (`status='claimed'`); past/started and non-matching weeks are untouched.
- after a permanent assign over `permanent_drop` openings, the slot no longer appears in
  `permanent_openings_feed`.
  **Assign — hard rejections (RAISE P0001 + the targeted row is unchanged):**
- a non-Harnwell-home worker onto a Harnwell block is rejected (DB trigger backstop fires even
  via service role) — defense-in-depth.
- an inactive worker is rejected (`user_inactive`).
- an assignment over the **hard** cap is rejected — and is still rejected with
  `p_override_advisories=true`.
- a block already started is rejected (`block_started`).
- a float-committed seat is rejected (`float_committed`).
- a cross-house target is rejected (`cross_house_not_supported`).
  **Assign — soft confirm gating:**
- assigning a `cannot` / opted-out / over-soft-cap worker with `p_override_advisories=false`
  performs **no write** and signals `needs_confirm` with the advisory reasons.
- the same call with `p_override_advisories=true` performs the write.
  **Authz:**
- a non-(sm/hm/bm) operator is rejected (`not_authorized`).
- an sm/hm/bm whose admin house ≠ the block's house is rejected.
  **Remove — this_week:**
- remove sets `status='vacant'`, `vacancy_origin='temporary_drop'`, `user_id=NULL`, cross-house
  fields cleared.
- remove writes **no** `block_step_status` row for the seat.
  **Remove — permanent:**
- permanent remove vacates all future in-semester occurrences → `vacant`/`permanent_drop`;
  current-started/past untouched.
- permanent remove **skips** float-committed occurrences.
- permanent remove writes an `sm_permanent_drop_alert` to the house's SM(s) and an
  `sw_permanent_removal_alert` to the removed worker (operator ≠ worker).
- after permanent remove, the occurrences appear in `permanent_openings_feed`.
  **Remove — rejections:** started/past (`block_started`), float-committed (`float_committed`),
  seat not occupied by the named worker.
  **Atomicity:** a rejected assign or remove leaves every row untouched (whole txn rolls back).

### 4c. Web calendar override (Playwright; seed is Quad-only)

- an HM (and SM) sees the **override section** (worker-picker, not the "Read-only in this build" notice).
- **assign to an open shift:** on a vacant/gap card, pick a worker → submit → the block shows
  that worker (covers the HM's "allocate an open shift to an SW" complaint).
- **reassign:** on an occupied card, change the worker → the block shows the new worker.
- **remove:** on an occupied card, remove → the block shows a vacant/gap card.
- the **This week / Permanent** scope toggle is present and selectable.
- assigning a worker who is opted-out / over-soft-cap / marked-cannot shows an **advisory confirm
  modal**; accepting completes the assignment.
- a Student Worker does not get the override controls (unauthorized / section hidden).
- (Harnwell hard rejection and cross-house rejection are covered in pgTAP, not e2e — seed is Quad-only.)

---

## 5. Test plan (Test Author only — implementer must not read this or the test files)

- **Vitest:** `packages/core/tests/s1-admin-override/admin-override.test.ts` (+ `fixtures.ts`).
  One `it` per §4a line; `describe` blocks cite the BSpec section. Run: `pnpm --filter @shift/core test`.
- **pgTAP:** `supabase/tests/s1-admin-override.sql` (or next `phase-NN`), `BEGIN; SELECT
plan(N); … finish(); ROLLBACK;`. Model on `supabase/tests/phase-10-bulk-ops.sql`: seed
  `auth.users`→`public.users`→`user_roles`→profiles/calendar/period→`shift_blocks`→assignments
  inside the txn; DST-stable anchor via `set_config`; stash jsonb results in a GUC; assert with
  `has_function`/`is`/`throws_ok`. One assertion-cluster per §4b line. Run: `supabase test db`.
- **Playwright:** `apps/web/e2e/admin-override.spec.ts`, model on `schedule-builder.spec.ts` +
  `cap-modification.spec.ts` (negative-auth). Login via `helpers.ts` (`SEED.hmQuad`/`smQuad`,
  SW = `SEED.alice`). One `test` per §4c line. Run: `supabase db reset` then
  `pnpm --filter @shift/web e2e`.

## 6. Done = green + real

Repo gate: `pnpm type-check && pnpm lint && pnpm build && pnpm test` (Vitest) + `supabase test db`
(pgTAP) + `supabase db reset && pnpm --filter @shift/web e2e`. Invariants re-checked (Harnwell
trigger intact; no float-direction regression; no-takeback respected — float seats deferred not
broken; 30-min/timestamptz-NY). Update `STATUS.md` + write `NOTES.md`.
