# Phase 07 — Test Plan: Orchestrator and Escalation Chain

This plan enumerates every test for phase-07, the spec section each test
covers, and the ambiguities surfaced and resolved before implementation.

Phase-07 is the engine that drives escalation: a 1-minute pg_cron tick
scans vacant blocks, evaluates each block's escalation chain against
the current time, fires due-not-yet-fired steps idempotently, and runs
the no-ack trigger for pending floats. The chain steps themselves
(`broadcast`, `float_lookup`, `hmod_notify_allied`) are dispatched to
named handlers. Notifications resolve to HM vs HMOD per the §10.1
working-hours rule.

The phase has three pure-function surfaces and one DB-side surface:

| Surface                                 | Lives in                                                       | Tested with |
| --------------------------------------- | -------------------------------------------------------------- | ----------- |
| Chain-step timing evaluator             | `packages/core/src/orchestrator/evaluate`                      | Vitest      |
| Notification recipient routing          | `packages/core/src/orchestrator/routing`                       | Vitest      |
| No-ack outcome decider                  | `packages/core/src/orchestrator/no-ack`                        | Vitest      |
| `block_step_status` table + idempotency | `supabase/migrations/...` (table already exists from phase-03) | pgTAP       |

The orchestrator's tick LOOP itself (scan vacant blocks, dispatch
handlers, manage transactions) is integration-level glue and is
tested at the pgTAP layer where DB state can be observed end-to-end.
The pure-function tests pin the DECISION logic that the loop calls.

Sources of truth:

- `BEHAVIORAL_SPECIFICATION.md`
  §5.2 (drops, mid-shift drop escalation timing),
  §5.4 (escalation chain — regular vs winter profiles),
  §5.5 (escalation is one-way; fresh-late-drop float lookup
  fires immediately),
  §6.6 #7 (force-trigger decline chain resumption),
  §7.1 (acknowledgment cadence — T-10m deadline; reminders),
  §7.2 (declining a float),
  §7.3 (no-ack trigger — T-15m before float start),
  §10.1 (notification routing rules — HM hours, HMOD hours),
  §10.2 (specific routing cases — worked examples)
- `ARCHITECTURE.md`
  §4.1 (orchestrator scan loop, `block_step_status` table,
  rollback semantics, cleanup),
  §4.2 (chain step implementations — broadcast, float_lookup,
  hmod_notify_allied),
  §4.3 (every-minute tick rationale),
  §4.4 (no-ack trigger — T-15m logic, chain rollback for
  force-triggered floats),
  §4.5 (force-trigger pathway — destination + source-side rows,
  block_step_status pre-marking, rollback procedure,
  source-side reconciliation),
  §4.6 (notification routing — HM/HMOD/[08:00,17:00) boundary)
- `AGENTS.md` — broadcast-subscription guard (phase 02 note), no
  hours cap on float (hard invariant #4), block-atomicity invariant
  #5, time zone invariant #6.

Test files (all Vitest unless noted, pure TypeScript, no Supabase):

- `packages/core/tests/phase-07/fixtures.ts` — shared types +
  factories (chain builders, step-status snapshots, block/time
  anchors)
- `packages/core/tests/phase-07/escalation-timing.test.ts` —
  evaluator unit tests: offset evaluation, "skip past steps" rule,
  rolled-back row semantics, boundary at exactly T-2h, one-way
  escalation, fresh-late-drop vs rolled-back distinction
- `packages/core/tests/phase-07/notification-routing.test.ts` —
  HM vs HMOD routing, [08:00, 17:00) boundary inclusive/exclusive,
  weekend handling, cross-boundary cases from §10.2 worked examples
- `packages/core/tests/phase-07/no-ack-trigger.test.ts` —
  full no-ack state machine: ack/decline wins; automated vs
  force-triggered branches; source-side reconciliation outcomes
  (restore vs displace); rollback-step list; always-HMOD at T-15m
- `supabase/tests/phase-07-block-step-status.sql` — pgTAP:
  schema, PK (block_id, step_name), ON CONFLICT DO NOTHING
  idempotency, rolled_back-as-not-yet-processed observable behavior,
  enum labels, RLS, cascade on shift_blocks delete

---

## The Function Contracts (TDD-first)

The implementation goes in `packages/core/src/orchestrator/`. Until
the implementation lands, every test fails at the module import — the
intended TDD-red state matching phase-06's pattern.

### Chain-step timing evaluator

```ts
// packages/core/src/orchestrator/types.ts
export type ChainStepName = string;

export type BlockStepStatusValue = 'fired' | 'completed_via_force_trigger' | 'rolled_back';

export type ChainStep = {
  stepName: ChainStepName;
  offsetMinutes: number; // negative for pre-block; e.g., -180 for T-3h
  trigger?: 'on_float_failure';
};

export type EvaluateChainStepsInput = {
  blockStartAt: Date;
  now: Date;
  chain: ChainStep[]; // chain order (typically ascending temporal offset)
  stepStatus: Record<ChainStepName, BlockStepStatusValue>;
};

export type ChainStepEvaluation = {
  stepName: ChainStepName;
  trigger?: 'on_float_failure';
};

// packages/core/src/orchestrator/evaluate.ts
export function evaluateChainSteps(input: EvaluateChainStepsInput): ChainStepEvaluation[];
```

`evaluateChainSteps` is PURE: no I/O, no clock, no random. Given the
block's start time, the current time, the profile's chain, and the
existing `block_step_status` rows for the block, it returns — in
chain order — the steps that should fire on THIS tick. The caller
(orchestrator handler chain) iterates the result, invokes each step's
handler, and writes the `fired` row inside the handler's transaction.
Steps with `trigger='on_float_failure'` are RETURNED by the evaluator
when reached; the handler's job is to suppress the fire if
`float_lookup` ran successfully this tick.

### Notification recipient routing

```ts
// packages/core/src/orchestrator/routing.ts
export type NotificationRecipient = 'hm' | 'hmod';

export type ResolveNotificationRecipientInput = {
  now: Date;
  blockStartAt: Date;
};

export function resolveNotificationRecipient(
  input: ResolveNotificationRecipientInput,
): NotificationRecipient;
```

Returns the ROLE to notify (the caller resolves the role to a
specific user via `hmod_rotor` and `hm_leave`). All time math is in
America/New_York per AGENTS hard invariant #6.

### No-ack outcome decider

```ts
// packages/core/src/orchestrator/no-ack.ts
export type SourceSideAtTriggerTime =
  | { kind: 'automated' }
  | { kind: 'force_triggered_still_vacant' }
  | { kind: 'force_triggered_claimed_by_other' }
  | { kind: 'force_triggered_covered_by_allied' };

export type DecideNoAckActionInput = {
  triggerAt: Date; // typically floatStartAt - 15min
  floatStartAt: Date;
  acknowledgedAt: Date | null;
  declinedAt: Date | null;
  initiatedBy: 'automated' | 'force_triggered';
  sourceSideAtTriggerTime: SourceSideAtTriggerTime;
};

export type SourceSideAction =
  | { type: 'none' }
  | { type: 'restore_floater_original_assignment' }
  | { type: 'mark_floater_displaced' };

export type NoAckOutcome =
  | { kind: 'skip'; reason: 'acknowledged' | 'declined' }
  | {
      kind: 'void_and_reescalate';
      voidFloat: true;
      addToFloatExclusions: true;
      destinationToVacant: true;
      rolledBackSteps: ('broadcast' | 'float_lookup')[];
      sourceSideAction: SourceSideAction;
      escalationNextStep: 'hmod_notify_allied';
    };

export function decideNoAckAction(input: DecideNoAckActionInput): NoAckOutcome;
```

The function is PURE: it inspects the snapshot the caller assembled
and returns the action set. The caller executes the action set in a
single DB transaction so the source-side state at decision time and
the source-side state at write time are identical (via SELECT FOR
UPDATE on the relevant assignment rows).

---

## Pinned Decisions

The behavioral spec and architecture document leave several
implementation choices implicit. The decisions below are pinned by
the test suite — the implementation MUST match them, and any future
reinterpretation requires updating both the tests and this plan.

| #   | Topic                                                                                             | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | "Offset reached" boundary                                                                         | A chain step's offset is reached iff `now >= blockStartAt + offsetMs`. Strict inequality at exactly the offset means INCLUSIVE — firing at exactly T-2h fires `float_lookup`. The "T-2h cutoff" for claims (BSpec §5.3: "T-2 hour for that shift has not yet passed") is the same instant from the opposite direction: claims succeed strictly before T-2h, the chain fires AT and after T-2h.                                                                                                                                                | BSpec §5.4 step 2: "any claim attempt strictly after T-2 hours fails. If a claim is in progress at exactly T-2 hours, it fails." Combined with the orchestrator's per-minute tick, the inclusive boundary ensures every block reaches the chain at most one minute late. Tested in `escalation-timing.test.ts` (boundary block: tick at offset-1ms vs at offset-0 vs at offset+1ms).                                                                                                                                                                                      |
| 2   | "Skip past steps" — `rolled_back` semantics                                                       | A step with `status='rolled_back'` AND offset in the past is SKIPPED by the evaluator (not re-fired). A step with `status='rolled_back'` AND offset in the future is treated as not-yet-processed (will fire normally when its offset is reached). This distinguishes the rolled-back case (broadcast/float_lookup were already logically attempted via force-trigger) from a fresh-late-drop case (no rows; chain advances to the latest-reached step).                                                                                      | ARCH §4.4 emphasis: "the orchestrator will not re-fire `broadcast` or `float_lookup` (their offsets are in the past per the spec's 'skip past steps' rule)." ARCH §4.1 says `rolled_back` is "not yet processed" for eligibility — but the chain-progression rule then prunes past offsets. The two rules compose. BSpec §6.6 #7 first bullet covers the offset-in-future case ("If T-3h has not yet been reached, the broadcast fires at T-3h normally").                                                                                                                |
| 3   | "Skip past steps" — fresh-late-drop semantics                                                     | When NO row exists for a step AND its offset is past AND a STRICTLY-LATER step in the chain also has its offset past with no row, the evaluator skips the earlier step. Steps at the SAME offset are not "strictly later"; same-offset later steps do NOT cause skip. For the regular profile's `float_lookup` (-2h) and `hmod_notify_allied` (-2h, trigger=on_float_failure), `float_lookup` is NOT skipped when `hmod_notify_allied`'s offset is reached, because they share the same offset.                                               | BSpec §5.5: "if the gap is within 2 hours of start, float lookup fires immediately; otherwise the standard T-3h/T-2h chain applies." A gap created at T-1h has both broadcast(-3h) and float_lookup(-2h) in the past; spec says fire `float_lookup`, not broadcast. Strict-later-offset prevents broadcast from firing. Same-offset preservation prevents `float_lookup` from being skipped by `hmod_notify_allied`'s peer offset. Tested in `escalation-timing.test.ts` ("fresh drop within 2h of block start").                                                         |
| 4   | `trigger='on_float_failure'` evaluator semantics                                                  | The evaluator INCLUDES a `trigger='on_float_failure'` step in the result whenever the step's offset is reached and it has no `fired`/`completed_via_force_trigger` row. The TRIGGER CONDITION is enforced by the orchestrator's handler chain, NOT by the evaluator. The handler suppresses the `hmod_notify_allied` write when `float_lookup` ran successfully this tick (a floater was assigned).                                                                                                                                           | Keeps the evaluator stateless w.r.t. handler outcomes. ARCH §4.2 ("If no floater is found, the step fails, and the orchestrator immediately fires the next chain step (`hmod_notify_allied`)") describes the handler-side trigger logic. The evaluator's job is to return time-eligible candidates; the handler decides what actually executes.                                                                                                                                                                                                                           |
| 5   | Stale blocks (`blockStartAt <= now`) — evaluator return                                           | The evaluator returns an EMPTY array when `now >= blockStartAt`. The orchestrator's tick should not scan blocks whose start time has passed (the chain offsets are all relative-to-start and have all expired). In-progress incidents are an operational concern handled out-of-band by HMOD direct calendar inspection.                                                                                                                                                                                                                      | The prompt explicitly flags this as ambiguous. Spec is silent. Pinning to "skip stale" rather than "fire HMOD even though we're past start" matches the orchestrator's lookahead-window framing in ARCH §4.1 ("blocks start within a relevant lookahead window... the next 3 hours plus a small buffer"). The HMOD step normally fires AT T-2h; if it didn't fire by then, the gap was created post-T-2h and HMOD fired at gap-creation time (mid-shift-drop §5.2 last bullet, fresh-late-drop §5.5). After the block starts, nothing the orchestrator can do is on-time. |
| 6   | Lookahead window upper bound                                                                      | The orchestrator scans blocks with `blockStartAt > now AND blockStartAt <= now + lookaheadMs`. `lookaheadMs` is the largest \|offsetMinutes\| in any active profile's chain, PLUS a buffer. For the regular profile (offsets -180, -120, -120), `lookaheadMs = 3h 30min`. The lookahead is a property of the chain configuration, not a separate constant.                                                                                                                                                                                    | ARCH §4.1 says "the next 3 hours plus a small buffer." The buffer absorbs orchestrator tick-skew and partial-success scenarios. Computing from the chain's max offset means a profile change (e.g., adding a T-4h pre-warning step) automatically widens the scan without configuration churn. The lookahead is a tick concern, not an evaluator concern; the evaluator is tested on individual block decisions.                                                                                                                                                          |
| 7   | Orchestrator tick idempotency mechanism                                                           | Two concurrent ticks racing on the same `(block_id, step_name)` are made idempotent by `INSERT INTO block_step_status (...) VALUES (...) ON CONFLICT (block_id, step_name) DO NOTHING RETURNING block_id`. The handler runs the side-effect (sending notifications, invoking float lookup, etc.) ONLY when the INSERT returns a row. The losing tick's INSERT returns zero rows and the handler is a no-op. This requires the side-effect to be inside the same transaction as the INSERT.                                                    | ARCH §4.1 PK is `(block_id, step_name)`; ARCH §1.3 mandates idempotency. Standard pg_cron pattern. Tested in `phase-07-block-step-status.sql` (concurrent INSERTs; second INSERT returns no row).                                                                                                                                                                                                                                                                                                                                                                         |
| 8   | `rolled_back` re-fire mechanism                                                                   | When a `rolled_back` row exists and the orchestrator determines the step is eligible to fire (per pinned #2's "offset in future" case), the handler UPDATEs the row in place — `status='fired'`, `fired_at=NOW()`, `updated_at=NOW()` — rather than INSERTing a new row. The PK prevents duplicate rows. The `fired_at` timestamp reflects the ACTUAL fire (not the original force-trigger time).                                                                                                                                             | Preserves the (block_id, step_name) PK. Allows the orchestrator to log the actual fire moment for diagnostics. Tested in `phase-07-block-step-status.sql` ("re-fire after rollback updates row in place").                                                                                                                                                                                                                                                                                                                                                                |
| 9   | HM-vs-HMOD routing — boundary semantics                                                           | HM hours are `[08:00, 17:00)` America/New_York, Monday–Friday. At EXACTLY 08:00:00 NY-local on a weekday, the boundary is INCLUSIVE (HM hours). At EXACTLY 17:00:00 NY-local on a weekday, the boundary is EXCLUSIVE (HMOD hours). Both `now` and `blockStartAt` are evaluated against this rule; HM is returned ONLY when both fall within HM hours AND both are on weekdays.                                                                                                                                                                | ARCH §4.6 explicit: "A notification firing at exactly 08:00 is within HM hours; one firing at exactly 17:00 is within HMOD hours." BSpec §10.1 explicit: "Monday-Friday, [08:00, 17:00)." Tested in `notification-routing.test.ts` ("boundary at exactly 08:00", "boundary at exactly 17:00", "Saturday/Sunday", and the four §10.2 worked examples).                                                                                                                                                                                                                     |
| 10  | HM-vs-HMOD routing — block-date weekday determination                                             | A "weekday" is determined by the NY-local DATE of the moment in question. A Sunday-night drop for a Monday 08:00 block: `now` is Sunday (weekend → HMOD); `blockStartAt` is Monday (weekday → HM hours). Routing returns HMOD (because `now` is outside HM working window). Per BSpec §10.2 ("A drop happens at 23:00 on a Tuesday for a shift starting Wednesday at 08:00"), the T-2h-evaluation moment governs.                                                                                                                             | ARCH §4.6 step 3: "If current time is within HM working hours … AND the block start time is within HM working hours AND the block's date is a weekday → … HM." All three must hold. Test `notification-routing.test.ts` covers each conjunct individually and together.                                                                                                                                                                                                                                                                                                   |
| 11  | No-ack decider — ack/decline race precedence                                                      | If `acknowledgedAt` is non-null at decision time, the decider returns `{ kind: 'skip', reason: 'acknowledged' }`. If `declinedAt` is non-null, `{ kind: 'skip', reason: 'declined' }`. If both are non-null (pathological), `acknowledgedAt` wins (ack comes first in any rational workflow; the decline handler should have already voided the float). The caller MUST hold a row lock on `float_assignments` during the decider call to prevent TOCTOU races with the worker's ack/decline action.                                          | Spec §7.2 / §7.3 are silent on the both-set case. Acknowledged-wins matches the "soft ack" intent. Tested in `no-ack-trigger.test.ts` ("acknowledged wins skip", "declined wins skip", "both set — acknowledged wins").                                                                                                                                                                                                                                                                                                                                                   |
| 12  | No-ack decider — `escalationNextStep` is always HMOD                                              | When the decider returns `void_and_reescalate`, `escalationNextStep` is ALWAYS `'hmod_notify_allied'`. The decider does NOT return broadcast/float_lookup — at T-15m before float_start, T-2h relative to the destination block has always passed (since float_start equals destination block_start_at). The "skip past steps" rule guarantees the chain has only HMOD as the live step.                                                                                                                                                      | ARCH §4.4 emphasis: "T-2h is always already past at trigger time — the gap always goes directly to HMOD-for-Allied, regardless of whether the original float was automated or force-triggered." BSpec §7.3 explicit. Tested in `no-ack-trigger.test.ts` ("automated no-ack → HMOD", "force-trigger no-ack → HMOD", every variant).                                                                                                                                                                                                                                        |
| 13  | No-ack decider — `rolledBackSteps` is empty for automated                                         | For `initiatedBy='automated'` floats, `rolledBackSteps` is `[]`. Only `force_triggered` floats had `broadcast` and `float_lookup` pre-marked as `completed_via_force_trigger`; only those rows need rolling back. The automated float's `block_step_status` rows are already in `fired` status (the chain ran normally to create the float assignment) and do NOT roll back on no-ack — re-firing `float_lookup` would reproduce the same assignment.                                                                                         | ARCH §4.5 only describes pre-marking for the force-trigger pathway. ARCH §4.4 "Note on chain rollback" only describes rolling back force-triggered chain rows. The automated case has no rows in `completed_via_force_trigger`; nothing to roll back. Tested in `no-ack-trigger.test.ts` ("automated no-ack — rolledBackSteps is empty").                                                                                                                                                                                                                                 |
| 14  | No-ack decider — `rolledBackSteps` for force-triggered is `['broadcast', 'float_lookup']` exactly | For `initiatedBy='force_triggered'` floats, `rolledBackSteps` is the array `['broadcast', 'float_lookup']` in that order. `hmod_notify_allied` is NOT in the list (it was deliberately not pre-marked by the force-trigger handler per ARCH §4.5). The list is deterministic — same order on every call — even though the rollback's effect on the chain is order-insensitive (both rows become `rolled_back` in the same transaction).                                                                                                       | ARCH §4.5 explicit on the two pre-marked steps. Listing them deterministically lets test assertions use array equality. Tested in `no-ack-trigger.test.ts`.                                                                                                                                                                                                                                                                                                                                                                                                               |
| 15  | No-ack decider — source-side reconciliation outcomes                                              | For `initiatedBy='force_triggered'`: <br>• `force_triggered_still_vacant` → `sourceSideAction = { type: 'restore_floater_original_assignment' }` <br>• `force_triggered_claimed_by_other` → `{ type: 'mark_floater_displaced' }` <br>• `force_triggered_covered_by_allied` → `{ type: 'mark_floater_displaced' }` <br>For `initiatedBy='automated'`: `{ type: 'none' }`. Automated floats have no source-side reassignment (the floater's original source row stayed `scheduled`; only the destination block's row was created/transitioned). | ARCH §4.5 "Source-side reconciliation on decline" explicit on the three cases for force-triggered. Automated floats per ARCH §5.2 don't pre-create source-side gap rows (only the destination side is modified). Tested in `no-ack-trigger.test.ts` (each branch).                                                                                                                                                                                                                                                                                                        |
| 16  | Float-exclusion window for no-ack                                                                 | When the decider returns `addToFloatExclusions: true`, the caller writes a `float_exclusions` row with `window_start_at = floatStartAt`, `window_end_at = <derived from float's destination blocks: latest block_start_at + 30 min>`, `destination_house_id = <float's destination house>`, `reason = 'no_acknowledgment'`. The decider does not return these values (they live in DB columns); it just signals the intent to add an exclusion. The window-derivation rule is enforced in pgTAP, not in the pure decider.                     | BSpec §6.1 ("overlap" exclusion semantics) + ARCH §3.8 (`float_exclusions` table) + pinned-decision #6 from phase-06 (overlap is block-level, not point-level). The phase-06 algorithm reads these exclusions as input; the phase-07 handler writes them. Decider stays pure by only signaling intent.                                                                                                                                                                                                                                                                    |
| 17  | Concurrent ticks observe `rolled_back` rows consistently                                          | When tick A rolls back a step row (no-ack handler, inside its transaction) and tick B begins reading the same block's status moments later, tick B sees `rolled_back`. The PK and read-committed isolation provide this guarantee. Tick B's evaluator returns `hmod_notify_allied`; tick B's handler INSERTs the `hmod_notify_allied` row with ON CONFLICT DO NOTHING. Tick A also tries to INSERT `hmod_notify_allied` (as the no-ack handler's terminal step). Only one INSERT wins.                                                        | ARCH §4.1 "rollback write happens inside the same transaction as the float status flip." Standard ON CONFLICT idempotency for the terminal HMOD step. Tested in `phase-07-block-step-status.sql` ("no-ack rollback + orchestrator scan race").                                                                                                                                                                                                                                                                                                                            |
| 18  | Winter profile chain (no `float_lookup` step)                                                     | The winter profile's chain `[broadcast(-3h), hmod_notify_allied(-2h)]` has no `float_lookup` step. The evaluator handles a chain of any length and any step names. When `hmod_notify_allied` has NO `trigger` field (winter), the evaluator returns it like any other step. The handler fires it unconditionally (no `on_float_failure` check, because there's no `float_lookup` to fail).                                                                                                                                                    | BSpec §5.4 "Winter Break Profile" explicit. The handler distinguishes trigger vs no-trigger; the evaluator does not. Tested in `escalation-timing.test.ts` ("winter profile: broadcast then HMOD; no float lookup").                                                                                                                                                                                                                                                                                                                                                      |
| 19  | "Multiple due steps in one tick" — return order                                                   | When the orchestrator missed a tick and multiple steps' offsets become reached at the same scan (e.g., tick at T-1h with no rows: broadcast(-3h) and float_lookup(-2h) both qualify modulo skip rules), the evaluator returns them in CHAIN ORDER (the chain array's order). The handler iterates in this order so broadcast fires before float_lookup. After the skip-past-steps rule prunes broadcast (because float_lookup's offset is also past), the evaluator returns `[float_lookup, hmod_notify_allied]` only.                        | Determinism + chain semantic. Tested in `escalation-timing.test.ts` ("missed tick — multiple steps eligible").                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 20  | Chain step status `fired` vs `completed_via_force_trigger`                                        | The evaluator treats `fired` and `completed_via_force_trigger` IDENTICALLY (the step is done, do not re-fire). They differ only in PROVENANCE for diagnostics and for force-trigger rollback eligibility (which is a handler concern, not an evaluator concern). The pgTAP tests verify that an attempt to INSERT a duplicate row on a `completed_via_force_trigger` row is a no-op (PK conflict).                                                                                                                                            | ARCH §4.5 design intent: pre-marked rows suppress re-firing the same way `fired` rows do. Tested in `escalation-timing.test.ts` ("completed_via_force_trigger blocks re-fire").                                                                                                                                                                                                                                                                                                                                                                                           |

---

## Test File Coverage Map

### `escalation-timing.test.ts` (Vitest)

| Surface                                                                 | Cases | Pinned decisions exercised |
| ----------------------------------------------------------------------- | ----- | -------------------------- |
| Offset reached — strict-inequality boundary at exactly T-2h             | 4     | #1                         |
| Future offsets — evaluator returns empty                                | 2     | #1                         |
| Empty chain / empty stepStatus                                          | 2     | #4                         |
| `fired` row blocks re-fire                                              | 2     | #20                        |
| `completed_via_force_trigger` row blocks re-fire                        | 2     | #20                        |
| `rolled_back` row + offset in future → fires at offset                  | 2     | #2                         |
| `rolled_back` row + offset in past → skipped                            | 3     | #2                         |
| Fresh-late drop within 2h: broadcast skipped, float_lookup fires        | 3     | #3, #4                     |
| Fresh-late drop within 30m: float_lookup fires (skip via same-offset)   | 2     | #3                         |
| Force-trigger no-ack rollback @ T-15m: only HMOD remains                | 3     | #2, #3, #4                 |
| Missed tick — multiple steps due, order is chain order                  | 2     | #19                        |
| Winter profile chain — broadcast → HMOD, no float_lookup                | 3     | #18                        |
| Trigger='on_float_failure' included in result regardless of prior steps | 3     | #4                         |
| Stale block (`now >= blockStartAt`) — evaluator returns empty           | 3     | #5                         |
| Block exactly at `now` — evaluator returns empty                        | 1     | #5                         |
| Same-offset peers don't trigger skip                                    | 2     | #3                         |
| Strictly-later offset triggers skip                                     | 2     | #3                         |

**Total: ~41 cases.**

### `notification-routing.test.ts` (Vitest)

| Surface                                                              | Cases |
| -------------------------------------------------------------------- | ----- |
| Now ∈ [08:00, 17:00) Mon–Fri + block ∈ [08:00, 17:00) Mon–Fri → HM   | 4     |
| Boundary: now = 08:00:00 NY exactly (weekday) → HM (inclusive)       | 1     |
| Boundary: now = 17:00:00 NY exactly (weekday) → HMOD (exclusive)     | 1     |
| Boundary: blockStartAt = 08:00 weekday → HM-hours qualifying         | 1     |
| Boundary: blockStartAt = 17:00 weekday → outside HM hours → HMOD     | 1     |
| Now = 07:59:59 (one second before 08:00) → HMOD                      | 1     |
| Now = 16:59:59 (one second before 17:00) → HM                        | 1     |
| Block start = 16:30 (last HM half-hour) → HM-qualifying              | 1     |
| Block date is Saturday → HMOD (weekend)                              | 1     |
| Block date is Sunday → HMOD                                          | 1     |
| Now is Saturday but block is Monday morning → HMOD                   | 1     |
| Now is Friday 17:30 (after HM hours) + block Monday morning → HMOD   | 1     |
| §10.2 worked example: Tue 23:00 drop, Wed 08:00 block → HMOD at T-2h | 1     |
| §10.2 worked example: Tue 23:00 drop, Wed 15:00 block → HM at T-2h   | 1     |
| §10.2 worked example: Wed 14:00 drop, Wed 22:00 block → HMOD at T-2h | 1     |
| §10.2 worked example: Sat 15:00 drop, Sun 14:00 block → HMOD         | 1     |
| Now = 12:00 weekday + block = 18:00 weekday (block outside HM)       | 1     |
| Now = 12:00 weekday + block = 12:00 weekday (both inside HM)         | 1     |
| Now = 00:00 weekday (midnight) + block = 09:00 weekday → HMOD        | 1     |
| Now = 12:00 Saturday + block = 12:00 Saturday → HMOD                 | 1     |
| DST sanity — boundary tests cross spring forward / fall back         | 2     |

**Total: ~24 cases.**

### `no-ack-trigger.test.ts` (Vitest)

| Surface                                                                          | Cases | Pinned decisions exercised |
| -------------------------------------------------------------------------------- | ----- | -------------------------- |
| `acknowledgedAt` non-null → skip(reason: 'acknowledged')                         | 2     | #11                        |
| `declinedAt` non-null → skip(reason: 'declined')                                 | 2     | #11                        |
| Both non-null → skip(reason: 'acknowledged') wins                                | 1     | #11                        |
| Automated + neither set → void, exclusions, vacant, []rollbacks, no-source, HMOD | 1     | #12, #13, #15              |
| Force-trigger + still_vacant → restore source-side                               | 1     | #12, #14, #15              |
| Force-trigger + claimed_by_other → displace                                      | 1     | #15                        |
| Force-trigger + covered_by_allied → displace                                     | 1     | #15                        |
| Force-trigger — `rolledBackSteps == ['broadcast','float_lookup']` exactly        | 3     | #14                        |
| `escalationNextStep === 'hmod_notify_allied'` for ALL void cases                 | 4     | #12                        |
| Pure-function determinism — same input → same output                             | 1     | —                          |
| Input mutation safety — input object not mutated by function                     | 1     | —                          |
| Boundary: triggerAt < floatStartAt (sanity)                                      | 1     | —                          |

**Total: ~19 cases.**

### `phase-07-block-step-status.sql` (pgTAP)

| Surface                                                                  | Cases |
| ------------------------------------------------------------------------ | ----- |
| Table exists, columns exist, types correct                               | 8     |
| PK is `(block_id, step_name)`                                            | 2     |
| Enum `block_step_status_enum` has all three labels                       | 2     |
| `block_id` FK to `shift_blocks` with `ON DELETE CASCADE`                 | 2     |
| NOT NULL constraints (block_id, step_name, status, fired_at, updated_at) | 5     |
| Default `fired_at = now()`                                               | 1     |
| Default `updated_at = now()`                                             | 1     |
| RLS enabled                                                              | 1     |
| Service-role bypass policy exists                                        | 1     |
| INSERT ON CONFLICT DO NOTHING — first insert succeeds                    | 1     |
| INSERT ON CONFLICT DO NOTHING — second insert is no-op                   | 2     |
| UPDATE rolled_back row in place (re-fire)                                | 2     |
| Concurrent INSERTs — exactly one wins (separate connections)             | 2     |
| Cascade on shift_blocks delete                                           | 1     |
| `fired` ≠ `completed_via_force_trigger` for diagnostics                  | 1     |

**Total: ~32 assertions.**

---

## What This Phase Does NOT Cover

Phase-07 tests the orchestrator's DECISION SURFACES (which steps fire,
which role to notify, what to do on no-ack). It does NOT test:

- **The pg_cron schedule itself** — that's `cron.schedule(...)`
  setup, validated via supabase-side smoke tests in phase-08.
- **End-to-end orchestrator → handler → DB writes** — pgTAP tests
  in phase-08 will exercise the SQL functions that wrap the
  pure-function decision surfaces. The handlers are thin glue.
- **Notification delivery** (push/email/SMS) — phase-09. This
  phase ends at "a notification row was generated for user X."
- **Force-trigger endpoint** — phase-08. Phase-07 tests assume the
  force-trigger handler has already correctly pre-marked
  `block_step_status` rows; the test cases exercise the
  evaluator/decider given those rows.
- **Drop-shift → re-escalation** — phase-05 (already covered) +
  phase-08 integration tests.
- **Permanent drop / permanent pickup** — phase-08 (BSpec §8.4).

---

## Why TDD-Red

Phase-06 demonstrated the TDD-red pattern: tests import from a
not-yet-existing module path; tests fail at import; the
implementation lands in a follow-up commit and tests turn green.
Phase-07 follows the same pattern. Until
`packages/core/src/orchestrator/` is implemented, every Vitest test
fails at the first import line. The pgTAP test runs against the
existing schema (`block_step_status` already exists from phase-03)
and tests OBSERVABLE behavior — most assertions pass against the
existing schema; the few that target ON CONFLICT idempotency and
re-fire UPDATE patterns describe SQL invariants the orchestrator's
SQL helpers MUST satisfy.
