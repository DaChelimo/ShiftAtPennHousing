# S2 — Force-trigger float · TEST_PLAN (behavior contract + pinned decisions)

Decision 2 / audit #2 ("best method"). Wire the **already-built, tested** force-trigger
backend into the Coverage monitor: from a gap, an SM/HM invokes the float lookup early →
pending floater(s) assigned, or routed to HMOD-for-Allied when no candidate, or a clear
"non-floating profile" note during winter break.

Spec: brief §6.3/§6.5; BSpec §6.6 (force-triggered float), §5.4 (escalation), §6.1 (float
direction — enforced in the backend). This doc is the session source of truth.

> **Firewall:** the Implementer gets §§1–4 + the file allowlist; it must NOT open any test
> file (`packages/core/tests/**`, `apps/web/e2e/**`). §5 is for the Test Author. Failures are
> relayed as behavioral paraphrases.

## 0. The backend already exists (do NOT rebuild it)

- `force_trigger_float` RPC (pgTAP-tested, phase-08) + the **`force-trigger` Edge Function**
  (`supabase/functions/force-trigger/index.ts`) do the whole job: validate → `findFloaters`
  (packages/core) → `force_trigger_float` per floater → `process_hmod_notify_allied_step` per
  no-floater block. **The caller supplies only `{ destination_house_id, block_ids }`.**
- EF request: `POST {SUPABASE_URL}/functions/v1/force-trigger/force-trigger`, bearer = the
  **signed-in user's** access token (the EF derives the initiator from it; the service-role key
  will NOT work). Body `{ destination_house_id, block_ids }`.
- EF responses:
  - 200 `{ ok:true, floatAssignmentIds: string[], alliedNotifications: {blockId,claimed}[], forcedAt }`
  - 403/409 `{ error:'force_trigger_rejected', reason }` — reasons incl. `unauthorized_initiator`,
    `float_not_enabled` (non-floating/winter profile), `block_not_vacant`, …
  - 400 bad input · 401 auth · 500 `{ error:'force_trigger_failed', detail }`.

## 1. Scope (pinned)

**IN:** thread real block UUIDs into `CoverageGap`; a `forceTriggerFloat` server action that calls
the EF; the Coverage monitor's per-gap **Force-trigger** button → confirm dialog → result
(pending floater(s) / routed-to-Allied / winter-break gated note / error). Offered **only on
broadcast-stage (vacant) gaps**.
**OUT (flag, don't fake):** any "cancel/revoke float" control (no-takeback); the Allied
"Call Allied / Mark covered" resolution (that's S3); HMOD all-houses coverage aggregation (audit #8).

## 2. Pinned decisions

- **D1 — force-triggerable gaps.** Only a gap at the **broadcast** stage (vacant, pre-float) is
  offered the action (`gap.esc === 'broadcast'`). On `float` (a floater already pending) or
  `allied` gaps the button is **not rendered**. (The EF also rejects non-vacant with
  `block_not_vacant`; the UI must not offer it.)
- **D2 — call the EF, not the RPC.** The action POSTs to the force-trigger EF with the **user's
  session access token** (model: the EF fetch in `lib/actions/leave.ts`). It supplies only
  `{ destination_house_id: gap.houseId, block_ids: gap.blockIds }`. Gate first on
  `canBuildSchedule` + the gap's house == `adminHouseId(me)` (defense-in-depth; the EF re-validates).
- **D3 — outcome mapping.** Map the EF response to a UI outcome via a pure summarizer (D5):
  `floatAssignmentIds.length > 0` → "N pending floater(s) assigned"; `alliedNotifications.length > 0`
  → "No floater found — routed to HMOD for Allied"; BOTH → a combined message; rejection
  `float_not_enabled` → the §6.5 "float lookup is off during this period (winter break)" note;
  other rejections / failures → a readable error.
- **D4 — no-takeback.** No UI revokes a resulting pending float. After success, refresh the
  coverage board so the gap reflects the new pending-float state.
- **D5 — pure summarizer.** `packages/core/src/force-trigger/summary.ts` →
  `summarizeForceTrigger(response)` (pure, Vitest-tested), reused by the action/UI.

## 3. Architecture (shared with implementer)

- **`packages/core/src/force-trigger/summary.ts`** (+ barrel export): `summarizeForceTrigger(res)`
  → discriminated union `{ kind: 'floated'|'allied'|'mixed'|'gated'|'rejected'|'failed';
floaterCount: number; alliedCount: number; reason?: string }`. Input is the parsed EF JSON
  (success or error shape). Pure; no I/O.
- **`apps/web/lib/data/coverage.ts`**: add `blockIds: string[]` to `CoverageGap`. Thread the DB
  `block_id` onto the internal `Atom` (it currently carries only esc/floater) and collect the
  member block UUIDs when a track coalesces into a window (mirror the calendar `blockIds` work).
- **`apps/web/lib/actions/forceTrigger.ts`** (new): `forceTriggerFloat({ houseId, blockIds })
: Promise<ActionResult<ForceTriggerSummary>>`. `'use server'`; gate via `getSessionUser` +
  `canBuildSchedule` + house match; get the session access token (cookie client); `fetch` the EF;
  parse JSON → `summarizeForceTrigger`; `revalidatePath('/coverage')` on a non-error outcome;
  return the summary (or `{ ok:false, error }` for failed/unauthorized).
- **`apps/web/components/coverage/CoverageMonitor.tsx`**: replace the disabled
  "Force-trigger — not wired" button with a live one (only when `gap.esc === 'broadcast'`):
  confirm dialog → call the action → render the outcome (success toast/notification or the gated
  note or an error). Testids: `force-trigger-btn`, `force-trigger-confirm`, `force-trigger-confirm-accept`,
  `force-trigger-result`, `force-trigger-gated`, `force-trigger-error`.
- **Off-limits to the implementer:** `packages/core/tests/**`, `apps/web/e2e/**`, `supabase/**`
  (the backend is done; the Lead handles any e2e seed). No migration, no `gen types`.

## 4. Behavior contract (`should…` — given to implementer; each maps to ≥1 test)

### 4a. `summarizeForceTrigger` (Vitest, pure)

- a response with `floatAssignmentIds: [a]`, `alliedNotifications: []` → `kind:'floated'`, `floaterCount:1`, `alliedCount:0`.
- `floatAssignmentIds: []`, `alliedNotifications: [x]` → `kind:'allied'`, `alliedCount:1`.
- both non-empty → `kind:'mixed'` with both counts.
- `{ error:'force_trigger_rejected', reason:'float_not_enabled' }` → `kind:'gated'`, `reason:'float_not_enabled'`.
- `{ error:'force_trigger_rejected', reason:'unauthorized_initiator' }` → `kind:'rejected'` (or 'failed') carrying the reason.
- `{ error:'force_trigger_rejected', reason:'block_not_vacant' }` → `kind:'rejected'` with the reason.
- `{ error:'force_trigger_failed', detail }` (or 500) → `kind:'failed'`.
- `ok:true` with both arrays empty → a defined, non-crashing outcome (e.g. `kind:'allied'` with 0, or a distinct 'noop'); pin it so the UI has a message.
- pure: same input → same output; no mutation.

### 4b. `CoverageGap.blockIds` (verified via the action/e2e; unit only if a pure builder is extracted)

- a broadcast-stage gap carries the real DB `block_id`s of its member blocks (not the synthetic gap `id`); a coalesced multi-block gap lists all members.

### 4c. Coverage force-trigger UI (Playwright)

- the Force-trigger button is **enabled** on a broadcast-stage (vacant) gap.
- the button is **absent** on a gap already at the float/allied stage.
- clicking it opens a confirm dialog; accepting invokes the lookup.
- when no eligible floater exists, the result shows "routed to HMOD for Allied" (the seed's
  vacant Quad gaps have no eligible source → this is the reliable path).
- (if the seed provides an eligible source) a successful force-trigger shows the pending-floater outcome.
- during a non-floating profile, the action is gated with the winter-break note (button disabled
  or a `force-trigger-gated` result) — exercise via the summarizer if a winter seed is impractical.

## 5. Test plan (Test Author only)

- **Vitest:** `packages/core/tests/s2-force-trigger/summary.test.ts` — one case per §4a. Run
  `pnpm --filter @shift/core test`.
- **Playwright:** `apps/web/e2e/force-trigger.spec.ts` — §4c, model on `cap-modification.spec.ts`
  (auth) + the coverage page; login `SEED.hmQuad`/`smQuad`; the **S1 seed's vacant Quad
  2026-06-08 gaps** are ready-made broadcast gaps with no eligible floater → assert the
  routed-to-Allied path + the button/confirm wiring. Run `supabase db reset` then
  `pnpm --filter @shift/web e2e`.
- **No new pgTAP** — `force_trigger_float` is already covered (phase-08); the EF is Deno (not
  pgTAP-testable). The float-lookup math is covered by `packages/core` findFloaters tests.

## 6. Done = green + real

Repo gate (`type-check`/`lint`/`build`/`test`) + the new Vitest + the coverage Playwright +
invariant re-check (no-takeback: no revoke UI; float-direction is backend-enforced). Update
STATUS.md + write NOTES.md.
