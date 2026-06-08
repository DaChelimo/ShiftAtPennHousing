# S4 — Fire a worker (`fire_worker`) · TEST_PLAN (behavior contract + pinned decisions)

Decision 4 / audit #4. **The tests are the point** (user: "Fire (thorough tests)"). One
transactional RPC that unwinds _every_ obligation of a fired worker per BSpec §4.5, plus a
pure planner (unit surface) and a destructive confirm modal (e2e surface).

Run via the **TDD firewall** (PLAN.md "How to run a session"):

1. **Lead (this file).** Behavior contract = `should …` lines (→ test names) + pinned
   interfaces. No assertion code.
2. **Test Author (subagent).** Writes the suites RED (pgTAP-heavy + Vitest planner +
   Playwright modal). May read all code. Outputs test names + run commands.
3. **Implementer (subagent — FIREWALLED).** Receives this contract + the allowlist. **MUST
   NOT open any test file** (`supabase/tests/**`, `packages/core/tests/**`,
   `apps/web/e2e/**`) or `supabase/seed.sql`. Builds migration + planner + web. Hands back.
4. **Lead.** Run suites; relay failures as behavioral paraphrases (never assertion source);
   reconcile; invariant re-check; repo gate; commit.

---

## Spec sources (authoritative)

- **BEHAVIORAL_SPECIFICATION.md §4.5** — Firing semantics (the multi-step contract):
  in-progress vacate→escalate; recurring→permanent drop; non-recurring→vacate; floats
  voided + re-lookup excluding the worker; deactivate. "Mechanically equivalent to a
  permanent drop applied across every shift the worker owns, plus deactivation."
- **§5.4** escalation chain (T-3h broadcast → T-2h float lookup → HMOD/Allied);
  **§5.5** drop-while-floating (destination re-lookup skipping broadcast; home headcount
  check); **§6.1–6.4** float eligibility + no-takeback + the `is_active` gate;
  **§6.6** force-trigger (the "skip broadcast → straight to float lookup" sibling pattern);
  **§8.1/§8.4** swaps + permanent drop/pickup (the reuse mechanics).
- **AGENTS.md** hard invariants (Harnwell training; float direction; **no-takeback —
  _waived for firing_, §4.5 + PLAN invariant #3**; cap-not-on-float; 30-min blocks; NY tz).

---

## Correctness anchor (read before writing anything)

`is_active = true` is already checked on **every** future claim / float-lookup / broadcast
path (BSpec §6.1: "The worker is `is_active = true`"; the claim + broadcast guards likewise).
**So flipping `is_active = false` handles ALL future exclusion for free.** `fire_worker`'s
real job is only:

1. the **already-scheduled** unwinding (future recurring + non-recurring seats), and
2. the **in-progress** urgency branch (vacate the current block, escalate straight to float
   lookup), and
3. voiding **already-committed** floats + swaps (the no-takeback waiver), and
4. setting `is_active = false`.

A fired worker needs **no** new "fired" status anywhere; §4.5: "no separate fired-worker
vacancy state exists." Recurring seats become `permanent_drop` vacancies; non-recurring
become `temporary_drop` vacancies — exactly the existing feeds.

---

## PIN 1 — the RPC signature & return shape (do not deviate)

```sql
CREATE OR REPLACE FUNCTION fire_worker(
  p_initiator uuid,        -- the HM/BM executing the firing
  p_user_id   uuid,        -- the worker being fired
  p_now       timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
-- REVOKE ALL … FROM PUBLIC;  GRANT EXECUTE … TO service_role;
```

**Return (success):**

```json
{
  "fired": true,
  "already_inactive": false,
  "in_progress_escalated": false, // true iff an in-progress block fell below headcount → float_lookup step
  "recurring_seats_dropped": 0, // shift_block_assignments rows permanent-dropped (sum of permanent_drop_slot affected_count)
  "non_recurring_vacated": 0, // future claimed/pickup seats vacated to the weekly feed
  "floats_voided": 0,
  "swaps_voided": 0
}
```

**Return (idempotent no-op — worker already inactive):**

```json
{
  "fired": false,
  "already_inactive": true,
  "in_progress_escalated": false,
  "recurring_seats_dropped": 0,
  "non_recurring_vacated": 0,
  "floats_voided": 0,
  "swaps_voided": 0
}
```

**RAISEs** (snake_case, P0001) — each rolls the whole txn back (atomic):

| reason                                           | when                                                                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `not_authorized`                                 | `p_initiator` is not HM/BM of the worker's home house (`user_has_house_admin_role(p_initiator, victim.home_house_id)` is false) |
| `worker_not_found`                               | `p_user_id` is not a `users` row                                                                                                |
| (propagated, e.g. `semester_boundary_not_found`) | any reused step raises → fire rolls back entirely                                                                               |

**Gate (PIN):** `user_has_house_admin_role(p_initiator, <victim's home_house_id>)` — the
HM/BM-only people-admin helper (NOT `user_can_build_schedule`). People-admin is HM/BM-only
(§2.3/§2.6; S1 NOTES reconciliation #2 / phase-13b D9). Service-role-only grant; the EF/web
action is the sole caller.

---

## PIN 2 — the pure planner (`packages/core/src/firing/`) input & output

> S1's worst bug was an under-specified validator interface (test-author & implementer
> diverged). This section is the contract; conform implementation to the tests if a field is
> still ambiguous at integration. The planner is a **pure decision oracle** — zero Supabase
> imports, deterministic for a given snapshot. It is **NOT called by the RPC**; the RPC
> re-derives equivalently in SQL (parallel impls, like S1's `evaluateAdminAssignment` vs
> `admin_assign_worker`). The planner is the **Vitest** surface; the RPC is the **pgTAP**
> surface.

### INPUT — `FiringSnapshot`

```ts
export type FiringSeatStatus = 'scheduled' | 'claimed'; // the planner classifies ONLY these

export type FiringAssignment = {
  assignmentId: string;
  blockId: string;
  houseId: string;
  blockStartAt: string; // ISO-8601 timestamptz
  dayOfWeek: number; // Postgres DOW: 0=Sun … 6=Sat, NY-local (= EXTRACT(DOW … AT TIME ZONE 'America/New_York'))
  blockStartLocal: string; // 'HH:MM' 24h NY-local (= TO_CHAR(… AT TIME ZONE 'America/New_York','HH24:MI'))
  status: FiringSeatStatus;
  requiredHeadcount: number; // the block's required_headcount
  othersPresentCount: number; // count of OTHER counting-status seats on this block (excludes the fired worker)
};

export type FiringFloat = { floatId: string; status: 'pending' | 'acknowledged' };
export type FiringSwap = { swapId: string };

export type FiringSnapshot = {
  now: string; // ISO-8601
  worker: { userId: string; homeHouseId: string; isActive: boolean };
  assignments: FiringAssignment[]; // the worker's OWN scheduled/claimed seats ONLY
  floats: FiringFloat[]; // pending|acknowledged floats where user_id = worker
  swaps: FiringSwap[]; // pending swaps where worker is initiator OR counterparty
};
```

**Scope note (PIN):** `assignments` carries only `scheduled`/`claimed` seats. The worker's
**float seats** (`floated_in/out`, `pending_float_in/out`) are represented by `floats`, NOT
in `assignments` — their seat-level reconciliation (reopen destination / restore-then-drop
source) is the RPC's SQL job (pgTAP-tested), out of the planner's scope. This keeps the
planner a clean classifier and avoids the float-source reclassification ambiguity.

### OUTPUT — `FiringPlan`

```ts
export type FiringSlot = { houseId: string; dayOfWeek: number; blockStartLocals: string[] };

export type FiringPlan = {
  alreadyInactive: boolean; // worker.isActive === false → true, everything else empty/false
  inProgress: { assignmentId: string; blockId: string; needsEscalation: boolean } | null;
  recurringSlotsToDrop: FiringSlot[]; // grouped distinct slots → one permanent_drop_slot call each
  nonRecurringToVacate: string[]; // assignmentIds
  floatsToVoid: string[]; // floatIds
  swapsToVoid: string[]; // swapIds
  deactivate: boolean; // true unless alreadyInactive
};
```

### Planner rules (PIN — these are the `should` lines for Vitest)

- **Idempotent oracle.** `worker.isActive === false` ⇒ `{ alreadyInactive:true,
inProgress:null, recurringSlotsToDrop:[], nonRecurringToVacate:[], floatsToVoid:[],
swapsToVoid:[], deactivate:false }`. (Nothing to do — a re-fire is a no-op.)
- **In-progress detection.** `inProgress` = the assignment with
  `blockStartAt ≤ now < blockStartAt + 30min` (block atomicity: a block spans exactly 30
  min). `needsEscalation = othersPresentCount < requiredHeadcount`. `null` if none.
  Assume at most one in-progress seat (a worker is one place at a time); if the fixture has
  more, pick the earliest `blockStartAt`.
- **Recurring → permanent drop.** From `status==='scheduled' && blockStartAt > now`
  (strictly future), grouped by `(houseId, dayOfWeek)` into `FiringSlot`s with **sorted,
  distinct** `blockStartLocals`. (= the SM-built recurring schedule; §4.5 "every recurring
  slot … permanently dropped".) The in-progress occurrence is `blockStartAt ≤ now` so it is
  naturally excluded here (§8.4.1 "skips the current occurrence if mid-shift").
- **Non-recurring → vacate.** `nonRecurringToVacate` = `assignmentId` of every
  `status==='claimed' && blockStartAt > now` seat. (= temp claims, claimed break shifts,
  cross-house pickups, and permanent-pickup occurrences — the system's read model treats all
  `claimed` seats as `temp_pickup`; §4.5 "every non-recurring assignment … is vacated.")
- **Floats.** `floatsToVoid` = every `floats[].floatId` (the snapshot is pre-filtered to
  pending|acknowledged).
- **Swaps.** `swapsToVoid` = every `swaps[].swapId`.
- **Deactivate.** `true` (unless `alreadyInactive`).
- **Determinism.** Stable ordering: slots sorted by `(houseId, dayOfWeek)`, locals sorted
  ascending; id lists sorted ascending. (So assertions are order-stable.)

---

## PIN 3 — the escalation-step representation (the in-progress urgency branch)

§4.5: an in-progress block that, on vacating the worker, falls **below required headcount**
"enters float escalation immediately — **skipping the T-3h broadcast and going directly to
float lookup**." This is the §6.6 force-trigger pattern (broadcast bypassed). The orchestrator
(`evaluateChainSteps`) **never escalates an already-started block** (`now ≥ blockStart ⇒ []`),
so `fire_worker` must record the escalation itself.

**PIN — what the RPC writes for an in-progress, below-headcount block:**

- the worker's seat → `status='vacant'`, `vacancy_origin='temporary_drop'`, `user_id=NULL`
  (mirrors `drop_shift`; this is the mid-shift temporary-drop-at-firing).
- **one `block_step_status` row**: `(block_id, step_name='float_lookup', status='fired',
fired_at=p_now, updated_at=p_now)`, `ON CONFLICT (block_id, step_name) DO NOTHING`.
- **NO `broadcast` `block_step_status` row** is written for that block (the broadcast is
  skipped). The pgTAP assertion is exactly: a `float_lookup` step row EXISTS, a `broadcast`
  step row does NOT.

`step_name` values are the established literals (`'broadcast'`, `'float_lookup'`,
`'hmod_notify_allied'`); `status` literal is `'fired'` (the value the broadcast/hmod RPCs use
when a step fires). The RPC does **not** itself run a float lookup (that is the TS
orchestrator algorithm — out of a pure-SQL RPC's reach, exactly as force-trigger's algorithm
lives in the EF); it records that the gap has _entered_ the float-lookup step with broadcast
skipped. **At-or-above headcount** ⇒ NO escalation step at all (the block just re-enters the
weekly feed as a normal open shift — §5.2 below-headcount gate).

---

## PIN 4 — confirm-modal testids (Playwright + the People UI)

Per-row Fire on `/admin/people` (HM/BM only; the page already gates `isHouseAdmin`).

| testid                 | meaning                                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `people-fire-<userId>` | the per-row **Fire** button — rendered **enabled only for `is_active` rows**; absent/disabled on already-inactive rows.                                        |
| `fire-confirm`         | the destructive confirm modal (`role=dialog`). Body copy (spec): "vacates all shifts, voids floats, deactivates account; mid-shift gaps escalate immediately." |
| `fire-confirm-accept`  | execute the firing.                                                                                                                                            |
| `fire-confirm-cancel`  | dismiss without firing (nothing changes).                                                                                                                      |
| `fire-success`         | post-fire confirmation toast/notice.                                                                                                                           |

After a successful fire the worker's **Status** cell flips to the existing `Inactive` tag and
the row's Fire button disappears (no re-fire). The existing "Read-only roster in this build"
`Notification` and the disabled-button `title` are removed/replaced. (Hire stays disabled —
that is S5; do **not** touch the Hire button.)

---

## Behavior Contract — pgTAP (`supabase/tests/s4-fire-worker.sql`) — the heavy surface

One `should` per line → ≥1 named pgTAP assertion. Self-contained fixtures inside
`BEGIN; … ROLLBACK;` (mirror `s1-admin-override.sql`): create houses, a `regular_school_year`
`scheduling_periods` row + matching `operating_calendar`, blocks, users/roles, assignments,
floats, swaps. Anchor on a **DST-stable** future weekday (e.g. a July 2027 Thursday, as S1
does) so every weekly occurrence shares one UTC offset (invariant #6). Use a multi-staff
non-Harnwell house (e.g. `house-05` with `required_headcount ≥ 2`) for headcount cases, plus
`harnwell`/`quad` for the invariant edges.

### A. Existence & shape

- `should expose fire_worker(uuid, uuid, timestamptz) returning jsonb`.
- `should be SECURITY DEFINER, revoked from PUBLIC, granted to service_role`.

### B. Permissions (gate)

- `should reject when initiator is a plain SW (not_authorized)`.
- `should reject when initiator is an SM of the worker's home house (people-admin is HM/BM-only)`.
- `should reject when initiator is an HM of a DIFFERENT house (not_authorized)`.
- `should allow when initiator is the HM of the worker's home house`.
- `should allow when initiator is the BM of the worker's home house`.
- `should reject a non-existent worker (worker_not_found)`.

### C. Future recurring slots → permanent drop

- `should permanent-drop every future occurrence of each recurring (scheduled) slot the worker owns` (status `vacant`, `vacancy_origin='permanent_drop'`).
- `should leave PAST occurrences (block_start_at < now) untouched`.
- `should leave the CURRENT-week occurrence untouched when it is the in-progress/at-start block` (§8.4.1 skip-current).
- `should surface dropped recurring occurrences in the permanent_openings_feed`.
- `should drop recurring occurrences across ≥2 distinct slots (different day-of-week / house) in one call`.
- `should write the sm_permanent_drop_alert for the affected house` (permanent_drop_slot side-effect; operator ≠ worker ⇒ also the sw_permanent_removal_alert is acceptable — assert the SM alert at minimum).

### D. Future non-recurring claims/pickups → vacate (weekly feed, not permanent)

- `should vacate every future claimed seat to vacancy_origin='temporary_drop' (NOT permanent_drop)`.
- `should surface vacated non-recurring occurrences in the weekly_open_shifts_feed when within 30 days`.
- `should NOT place a vacated non-recurring seat in the permanent_openings_feed`.

### E. In-progress block (the urgency branch)

- `should vacate the in-progress block immediately` (status `vacant`, `temporary_drop`).
- `should write a float_lookup block_step_status row (status fired) when vacating drops the desk below required headcount`.
- `should NOT write a broadcast block_step_status row for that in-progress block` (broadcast skipped).
- `should NOT write any escalation step when the desk stays at/above required headcount after vacating` (overstaffed multi-staff desk → normal weekly feed).
- `should report in_progress_escalated=true only in the below-headcount case`.

### F. Floats voided + re-lookup excludes the worker (no-takeback waived)

- `should void a PENDING float held by the worker (status → voided)`.
- `should void an ACKNOWLEDGED float held by the worker (status → voided)` — no-takeback waiver, §4.5.
- `should reopen each voided float's DESTINATION seat as vacant/temporary_drop` (re-enters lookup).
- `should restore the voided float's SOURCE seat to the worker, then permanent-drop it as part of the worker's recurring slots` (end state: source seat `vacant`/`permanent_drop`, not floated_out).
- `should leave the fired worker is_active=false so the standard float-lookup eligibility gate excludes them from any re-lookup` (the "excluded from re-lookup" guarantee — provable via the §6.1 is_active gate).
- `should roll back the destination block's broadcast/float_lookup premarks to rolled_back so the chain re-evaluates` (mirror decline_float step 4).
- `should NOT void a worker's float that is already declined/voided/completed` (only pending|acknowledged).

### G. Swaps voided

- `should void every pending swap where the worker is the INITIATOR (status → voided)`.
- `should void every pending swap where the worker is the COUNTERPARTY (status → voided)`.
- `should leave non-pending swaps (accepted/expired/rejected/voided) untouched`.

### H. Deactivation & future exclusion

- `should set users.is_active=false`.
- `should auto-clear broadcast_subscribed when deactivating a subscribed worker` (the prevent_hm_bm_broadcast_subscription trigger; no check violation).
- `should make the fired worker unclaimable afterward` (a claim attempt for them fails / the is_active gate rejects).
- `should exclude the fired worker from the float-lookup eligibility pool afterward` (is_active gate; the eligibility helper returns false).
- `should not break a published schedule's other workers` (only the fired worker's seats change).

### I. Idempotency

- `should be a safe no-op on an already-inactive worker` (returns already_inactive=true, fired=false; creates NO new vacancies; no duplicate alerts).
- `should not double-drop when fired twice` (second call no-op).

### J. Atomicity (rollback on a raised step)

- `should roll the ENTIRE fire back when a sub-step raises` — e.g. a worker with a recurring
  scheduled seat on a date with **no** `regular_school_year` period ⇒ `permanent_drop_slot`
  raises `semester_boundary_not_found` ⇒ the worker stays `is_active=true`, every seat/float/
  swap is unchanged (no half-fired state). (Test-author may force the raise by any in-function
  failure; the semester-boundary path is the natural one.)

### K. Invariant edges

- `should unwind a Harnwell worker (home_house=harnwell) cleanly` (deactivate + drop; no
  replacement is auto-placed — Harnwell float-lookup returns no candidate by §6.1, so the
  reopened seat simply awaits Allied; assert the seat is vacant + worker inactive, and that
  no non-Harnwell worker is seated on a Harnwell block by the fire).
- `should unwind a worker who is CURRENTLY FLOATED OUT (acknowledged float in progress) cleanly` (the float-void + home-seat handling both apply).

### L. Integration scenario (ONE fixture, assert the ENTIRE end state)

`should fully unwind a worker holding {1 in-progress below-headcount block, ≥2 future
recurring slots, 1 future non-recurring claim, 1 outbound pending float, 1 inbound
acknowledged float, 1 open swap} in a single fire_worker call` — assert in one test:

- the in-progress block is `vacant`/`temporary_drop` **and** has a `float_lookup` step (no `broadcast` step);
- both recurring slots' future occurrences are `vacant`/`permanent_drop` and appear in the permanent openings feed;
- the non-recurring claim is `vacant`/`temporary_drop` (weekly feed, not permanent);
- both floats are `voided`; each destination seat is `vacant`/`temporary_drop`; each source seat ends `vacant`/`permanent_drop` (restored→dropped);
- the swap is `voided`;
- `users.is_active=false`, `broadcast_subscribed=false`;
- the returned jsonb counts match (`in_progress_escalated=true`, the drop/vacate/void counts).

> **"outbound" vs "inbound" float (terminology PIN).** Every float row has exactly one worker
> = `user_id` (the floater); `source_assignment_ids` are that worker's home seats,
> `destination_assignment_ids` the covered house's gap. The fired worker is the **floater** in
> both floats. "Outbound pending" and "inbound acknowledged" simply mean two distinct floats
> the worker holds, one `pending` and one `acknowledged` (optionally to different destination
> houses). Both are found by `float_assignments.user_id = <worker> AND status IN
('pending','acknowledged')` and voided identically.

---

## Behavior Contract — Vitest (`packages/core/tests/firing/…`) — the planner

(Mirror PIN 2 rules. One `should` each, all pure/synchronous.)

- `should return alreadyInactive with an empty plan for an already-inactive worker`.
- `should detect the in-progress block and flag needsEscalation when others < required`.
- `should detect the in-progress block and NOT flag escalation when others ≥ required`.
- `should return null inProgress when no block straddles now`.
- `should group future scheduled seats into recurring slots by (houseId, dayOfWeek) with sorted distinct locals`.
- `should exclude the in-progress (started) occurrence from recurringSlotsToDrop`.
- `should NOT treat a future claimed seat as recurring (it goes to nonRecurringToVacate)`.
- `should list every future claimed seat assignmentId in nonRecurringToVacate`.
- `should ignore PAST seats (blockStartAt < now, not in-progress) entirely`.
- `should list every snapshot float in floatsToVoid and every snapshot swap in swapsToVoid`.
- `should set deactivate=true for an active worker`.
- `should produce deterministic (sorted) output` (stable slot/id ordering).
- `should produce a fully-populated plan for the integration-shaped snapshot` (planner analogue of L, sans the SQL-only float-seat reconciliation).

---

## Behavior Contract — Playwright (`apps/web/e2e/fire-worker.spec.ts`) — the modal

(Real seeded env; `supabase db reset` first. Lead owns the seed fixture — see below.)

- `should show an enabled Fire button on an active worker row for an HM` (`people-fire-<id>`).
- `should open the destructive confirm modal describing the consequences` (`fire-confirm` visible; body mentions vacate / void floats / deactivate / mid-shift escalate).
- `should NOT fire when the modal is cancelled` (`fire-confirm-cancel` → worker stays Active).
- `should fire on confirm and flip the worker's status to Inactive` (`fire-confirm-accept` → `fire-success`, the row Status shows Inactive, the Fire button is gone).
- `should hide/disable Fire on an already-inactive row` (no `people-fire-<id>` enabled for the fired worker).
- `should show the read-only/unauthorized notice to a non-HM/BM` (reuse existing `people-unauthorized`; an SM/SW cannot fire). _(May reuse the existing page gate; assert no Fire button reachable.)_

> The harness can't run the float-lookup algorithm and the People page shows no seat detail,
> so the e2e asserts the **modal + Active→Inactive** transition only; the seat/float/swap
> unwinding is the pgTAP surface (like S2, where findFloaters math is core-tested, not e2e'd).

---

## Reuse surface (Implementer: reuse — do NOT reimplement)

| Need                                     | Reuse                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Future recurring drop                    | **`permanent_drop_slot(p_dropping_user_id, p_house_id, p_day_of_week, p_block_start_locals text[], p_drop_initiated_at, p_operator_user_id)`** — vacates future in-semester occurrences → `permanent_drop`, skips `floated_out/pending_float_out`, writes the SM alert. Call once per `(house, day_of_week)` with that slot's distinct `HH:MI` locals; pass `p_operator_user_id := p_initiator`. Returns `{affected_count}`.       |
| Authorization gate                       | **`user_has_house_admin_role(check_user_id, check_house_id)`** (HM/BM).                                                                                                                                                                                                                                                                                                                                                            |
| Float void / seat reconciliation pattern | **`decline_float` (20260528000014)** — mirror its destination-reopen (`vacant`/`temporary_drop`), source-restore, force-trigger premark rollback, and compensation-row cleanup. fire_worker generalizes it to **pending AND acknowledged**, keyed on `user_id` (not requiring the worker to call), status → `'voided'`.                                                                                                            |
| In-progress vacate shape                 | **`drop_shift` (20260528000020)** — same vacate write (`vacant`/`temporary_drop`, clear cross-house/source fields). NOTE drop_shift's `drop_past_block` guard _rejects_ an already-started block, so fire_worker vacates the in-progress seat **directly** (do not call drop_shift for it).                                                                                                                                        |
| block_step_status literals               | `step_name ∈ {broadcast, float_lookup, hmod_notify_allied}`, `status='fired'` (see PIN 3).                                                                                                                                                                                                                                                                                                                                         |
| Swap void                                | the **`shift_block_assignments_void_pending_swaps` trigger** fires on status→`vacant/floated_out/pending_float_out` and voids touching pending swaps automatically. fire_worker ALSO voids explicitly by user (belt-and-suspenders): `UPDATE swap_requests SET status='voided' WHERE status='pending' AND (initiator_user_id = p_user_id OR counterparty_user_id = p_user_id)` — covers swaps whose seats fire doesn't transition. |
| Deactivation                             | `UPDATE users SET is_active=false WHERE user_id=p_user_id` — the `prevent_hm_bm_broadcast_subscription` BEFORE trigger auto-clears `broadcast_subscribed`.                                                                                                                                                                                                                                                                         |

**Suggested RPC execution order (one txn):** ① authz + worker-exists + idempotency (if
`is_active=false` → return no-op). ② void floats (reopen destinations, restore sources→
scheduled, rollback premarks, status→voided). ③ in-progress vacate + (below-headcount)
float_lookup step. ④ recurring drop (enumerate the worker's FUTURE `scheduled` seats — now
including restored sources — group by (house,dow), `permanent_drop_slot` each). ⑤ non-
recurring vacate (FUTURE `claimed` seats → `vacant/temporary_drop`). ⑥ explicit swap void.
⑦ `is_active=false`. ⑧ return counts. (Floats before recurring so restored source seats are
`scheduled` when ④ enumerates; the swap-void trigger fires throughout as seats vacate.)

---

## Web (Implementer)

- `apps/web/lib/actions/people.ts` (**new**) — `fireWorker({ userId })` server action:
  `'use server'`; gate `isHouseAdmin(me)` **and** the target's `home_house_id ===
adminHouseId(me)` (fail-fast; the RPC re-checks authoritatively); call
  `service.rpc('fire_worker', { p_initiator, p_user_id, p_now })`; map snake_case RAISE
  reasons to friendly copy (reuse the `friendlyMessage` shape from `override.ts`);
  `revalidatePath('/admin/people')`. Returns `ActionResult` (see `actions/builder.ts`).
  _(S5 will add `hireWorker` to this same file — keep `fireWorker` self-contained so the two
  don't collide; do not stub hire.)_
- `apps/web/components/people/PeopleRoster.tsx` — replace the disabled Fire button with the
  enabled per-row `people-fire-<userId>` (active rows only) → `fire-confirm` modal →
  `fire-confirm-accept` calls the action → `fire-success` + `router.refresh()`. Remove the
  "Read-only roster in this build" notice. Leave **Hire** disabled (S5).
- After any migration: `supabase gen types typescript --local >
packages/shared/src/database.types.ts` (strip any leaked CLI stderr — S1 reconciliation #6).
- `apps/web/AGENTS.md`: this Next.js has breaking changes — read `node_modules/next/dist/docs/`
  before writing app code.

---

## Invariant re-check (Lead, before "done")

1. **Harnwell training** — firing never _places_ a replacement; the reopened seat awaits the
   normal pathway. A Harnwell block reopened by firing still only admits Harnwell-home
   workers via the existing guards (float-lookup returns none; cross-house pickup guard).
   pgTAP K asserts no non-Harnwell worker is seated by the fire.
2. **Float direction** — firing voids floats; it does not create any. No direction rule can
   be violated by a void.
3. **No-takeback — WAIVED for firing only.** §4.5 + PLAN invariant #3: "automation can't
   revoke a pending/acknowledged float — but manual SM/HM/BM override can." Firing is the
   manual HR event; voiding ack'd floats here is the _sanctioned_ waiver, not a regression.
   The automated chain still honors no-takeback.
4. **Cap not on float** — N/A (no float assignment is created).
5. **30-min blocks** — every vacate/drop is whole-block; in-progress detection uses the
   30-min span.
6. **NY timestamptz / DST** — `permanent_drop_slot` already iterates NY-anchored; the planner
   derives `dayOfWeek`/`blockStartLocal` at `America/New_York`; fixtures are DST-stable.

---

## Seed fixture (Lead owns — for the Playwright e2e only; pgTAP is self-contained)

Add to `apps/web/e2e/helpers.ts` `SEED` + a uniquely-commented block in `supabase/seed.sql`
(coordinate with any concurrent S5: append-only, distinct ids/comment). The e2e asserts only
the modal + Active→Inactive, so the fixture is intentionally minimal & date-robust:

- **`SEED.fireable`** — a dedicated **active Quad SW** (e.g. `gabe.quad@pennhousing.test`,
  "Gabe Quad", `home_house='quad'`, role `sw`, fixed uuid in a new range). No required
  entanglements (firing a worker with no obligations = pure deactivate, which always succeeds
  regardless of clock/period — avoids the semester-boundary timing fragility the now()-relative
  S1/S2 week introduced). Authorized actor = `SEED.hmQuad` (existing). Re-seed between runs.

This keeps the e2e green deterministically; the thorough unwinding lives in pgTAP.

---

## Out of scope / documented limits (NOTES.md follow-ups)

- **Actual floater re-assignment for the reopened destination / in-progress gap** is the TS
  orchestrator's job (the algorithm is not callable from a pure-SQL RPC — same boundary as
  force-trigger's algorithm living in the EF). fire_worker records the escalation state
  (reopen + premark rollback / float_lookup step); the orchestrator-tick assigns the floater.
  Note: `evaluateChainSteps` skips already-started blocks, so the in-progress gap's automated
  re-coverage is effectively HMOD/Allied out-of-band — flag as a pre-existing orchestrator
  limitation, not an S4 regression.
- **Permanent-pickup recurring owners** are stored as `claimed` seats (system read model =
  `temp_pickup`), so firing vacates them per-occurrence to the weekly feed (not as one
  permanent opening). Consistent with the read model; flag it.
- **float_exclusions** enum is `('declined','no_acknowledgment')` only — firing writes none
  (the `is_active=false` gate is the exclusion); don't shoehorn a 'fired' reason.
