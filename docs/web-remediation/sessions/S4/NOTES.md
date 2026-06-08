# S4 — Fire a worker (`fire_worker`) · NOTES (outcome)

**Status: DONE & GREEN.** Decision 4 / audit #4. One transactional `fire_worker` RPC that
unwinds _every_ obligation of a fired worker per BSpec §4.5, a pure planner (Vitest), and a
destructive confirm modal (Playwright). Built via the TDD firewall (Lead contract → Test
Author RED → firewalled Implementer → Lead verify/reconcile). The user asked for **very
thorough tests** — the pgTAP suite is the heavy surface (69 assertions, one per §4.5 step in
isolation + a full integration end-state in one fixture).

## Results (full repo gate)

- **pgTAP:** `supabase test db` = **31 files / 1172 tests, Result: PASS**, incl.
  `s4-fire-worker` (**69/69**). No pre-existing reds (the `fix/pgtap-period-overlap`
  seed-overlap + now()-anchor commits this branch carries had already cleared them).
- **Core Vitest:** **647/647** (incl. 14 new `firing` planner cases).
- **Playwright:** `fire-worker.spec.ts` **7/7** (run on `:3100` to dodge a foreign `:3000`
  dev server — see [[project_web_e2e_run_gotchas]]).
- **Gate:** `type-check` 5/5 · `lint` 3/3 · `build` 3/3 (19 routes) clean.

## What shipped

- **Migration** `supabase/migrations/20260606000003_s4_fire_worker.sql` —
  `fire_worker(p_initiator, p_user_id, p_now)` (SECURITY DEFINER, service-role grant). One
  transaction, in order: ① authz (`user_has_house_admin_role` — HM/BM of the worker's home
  house) + worker-exists + **idempotency** (already-inactive ⇒ no-op `{fired:false,
already_inactive:true}`); ② **explicit swap void** by user (first, so its ROW_COUNT is the
  accurate `swaps_voided` — the seat-vacate trigger would otherwise void them before a
  later count); ③ **float void** (pending **and** acknowledged) — reopen each destination
  `vacant/temporary_drop`, restore each source seat to the worker (`scheduled`), roll the
  destination block's `broadcast`/`float_lookup` premarks → `rolled_back`, clean up
  force-trigger compensation rows, float → `voided`; ④ **in-progress** block vacated directly
  (`drop_shift`'s `drop_past_block` guard would reject a started block) + (below
  `required_headcount`) a `block_step_status(float_lookup,'fired')` row and **no** `broadcast`
  row (§4.5 "skip the T-3h broadcast, go straight to float lookup"); ⑤ **recurring drop** —
  `permanent_drop_slot` per distinct future `(house, dow, locals)` (now incl. restored float
  sources); ⑥ **non-recurring vacate** — future `claimed` seats → `vacant/temporary_drop`;
  ⑦ `users.is_active = false` (the `prevent_hm_bm_broadcast_subscription` trigger auto-clears
  `broadcast_subscribed`). Reuses `permanent_drop_slot` / the `decline_float` reconciliation
  shape / the swap-void trigger — reimplements none of them.
- **Pure core** `packages/core/src/firing/{types.ts,index.ts}` (+ barrel) — `planFiring`
  decision oracle (recurring vs non-recurring vs in-progress classification, idempotency,
  float/swap void lists, deterministic sorted output). Pure, clock injected via the snapshot.
  **Not** called by the RPC — a parallel tested spec, like S1's `evaluateAdminAssignment`.
- **Web** — `lib/actions/people.ts` (**new**, `fireWorker` server action: `isHouseAdmin` +
  home-house gate, service-client `rpc`, friendly RAISE mapping, `revalidatePath`),
  `components/people/FireWorkerControl.tsx` (**new** client: per-row Fire → destructive
  confirm modal → `router.refresh`), `components/people/PeopleRoster.tsx` (render Fire on
  active rows; removed the "read-only roster" notice; **Hire left disabled — that's S5**).
- **Types** `packages/shared/src/database.types.ts` regenerated (CLI stderr stripped).
- **Seed** `supabase/seed.sql` — an isolated, uniquely-commented **S4 block**: Gabe Quad, a
  dedicated active Quad SW (`gabe.quad@…`, uuid `…000c`), obligation-free so the e2e Fire flow
  is date-robust. Appended as its own block (ON CONFLICT) to avoid churn with S5.
- **Tests** (test-author) — `supabase/tests/s4-fire-worker.sql`,
  `packages/core/tests/firing/fire-planner.test.ts`, `apps/web/e2e/fire-worker.spec.ts`
  (+ `e2e/helpers.ts` `SEED.fireable` + `e2e/README.md` S4 selector/seed contract).

## Lead reconciliations (firewall friction)

1. **`swaps_voided` count (behavioral RED → fix).** The canonical fire reported
   `swaps_voided: 0` though the swap _was_ voided — the `void_pending_swaps_for_vacated_seat`
   trigger voids the swap as the worker's seats vacate (steps ③–⑥), so the explicit
   end-of-function void found nothing left to count. Relayed as a behavioral paraphrase;
   Implementer moved the explicit by-user swap-void to **before** the vacating steps so its
   ROW_COUNT is accurate (the trigger then no-ops on the already-`voided` rows). Re-ran →
   69/69.
2. **Seed-id collision (Lead seed ownership).** The Test Author pinned Gabe at uuid `…000b`,
   which is the **existing project administrator** (also referenced by
   `system_config('project_administrator_user_id')`). Moved Gabe to the free `…000c` in
   `seed.sql` and aligned the two test-file references (the spec's `FIREABLE_ID` constant +
   the `helpers.ts`/README comments) — a fixture-id correction, no assertion weakened.
3. **Test-file lint (import/order).** `fire-planner.test.ts` had a type-import-order error;
   `eslint --fix` reordered it (no assertion change).
4. **Implementer decisions accepted by the suite** (no failure): premark rollback is
   **unconditional** (not gated on `force_triggered`) — correct for firing, since an
   automated float's destination premarks must also re-evaluate after the worker is gone;
   in-progress detection runs after float-restore, so a restored, currently-in-progress home
   source seat is eligible to be the vacated in-progress block (consistent with §4.5/§5.5).

## Invariant re-check (all intact)

1. **Harnwell training** — fire never _places_ a replacement; reopened Harnwell seats await
   the normal pathway (Harnwell float-lookup returns no candidate; cross-house pickup guard).
   pgTAP asserts no non-Harnwell worker is seated on a Harnwell block by the fire.
2. **Float direction** — fire only _voids_ floats, creates none.
3. **No-takeback — WAIVED for firing only** (§4.5 / PLAN invariant #3): voiding
   pending+acknowledged floats here is the sanctioned manual-HR override. The **automated**
   chain (`decline_float`/`process_no_ack_float`) is untouched and still honors no-takeback.
4. **Cap not on float** — N/A (no float created). 5. **30-min blocks** — every vacate is
   whole-block; in-progress uses the 30-min span. 6. **NY tz/DST** — `permanent_drop_slot`
   NY-anchored; planner derives dow/local at `America/New_York`; pgTAP fixtures DST-stable.

## Scope / documented limits (no regression)

- **Actual floater re-assignment** for a reopened destination / the in-progress gap is the
  **TS orchestrator's** job (the float-lookup algorithm isn't callable from a pure-SQL RPC —
  same boundary as force-trigger). fire_worker records the escalation state (reopen + premark
  rollback / `float_lookup` step); the orchestrator-tick assigns the floater. NB
  `evaluateChainSteps` skips already-started blocks, so the in-progress gap's _automated_
  re-coverage is effectively HMOD/Allied out-of-band — a pre-existing orchestrator limit,
  not an S4 regression.
- **Permanent-pickup recurring owners** are stored as `claimed` seats (system read model =
  `temp_pickup`), so firing vacates them per-occurrence to the weekly feed, not as one
  permanent opening — consistent with the read model.
- **e2e scope.** Like S2 (findFloaters is core-tested, not e2e'd), the Playwright asserts only
  the **modal + Active→Inactive** transition; the seat/float/swap unwinding is pgTAP-only
  (the harness can't run the lookup algorithm and the People page shows no seat detail).

## Follow-ups

- **S5 (hire)** shares `lib/actions/people.ts` + `PeopleRoster.tsx` — `fireWorker` is
  self-contained; the disabled Hire button is left untouched for S5 to wire. Coordinate the
  shared files + the `database.types.ts` regenerate-on-merge.
- Consider an audit-log row (who fired whom / when) for the deactivation, mirroring the S1
  override-audit follow-up.
