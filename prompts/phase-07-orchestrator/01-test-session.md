# Phase 07 — Orchestrator & Escalation: Test Session

## Session Metadata

|                     |                                                                 |
| ------------------- | --------------------------------------------------------------- |
| **Model**           | Claude Opus 4.7 (`claude-opus-4-7`)                             |
| **Interface**       | Claude Code CLI                                                 |
| **Thinking mode**   | Extended thinking — **MAX**                                     |
| **TDD role**        | Test author — write tests only                                  |
| **Skill to invoke** | `engineering:testing-strategy` then `engineering:system-design` |

---

## Prompt

You are writing tests for Phase 07: Orchestrator and Escalation Chain.

Branch: `phase-07-orchestrator`.

Sources of truth (read in full):

- BEHAVIORAL_SPECIFICATION.md §5.4 (escalation chain)
- BEHAVIORAL_SPECIFICATION.md §7.3 (no-ack trigger)
- BEHAVIORAL_SPECIFICATION.md §10 (notification routing — HM vs HMOD)
- ARCHITECTURE.md §4 (ALL sub-sections — orchestrator, chain steps, no-ack, force-trigger refs)
- ARCHITECTURE.md §4.6 (notification routing logic)
- AGENTS.md

---

### Behavioral surfaces to cover

**pg_cron + dispatcher (happy path):**

- Orchestrator fires every minute
- Scans `shift_block_assignments` with status='vacant' within relevant lookahead window
- For each vacant block, evaluates the escalation chain for its date's profile
- Fires chain steps whose offset has been reached and haven't been fired yet
- Does NOT double-fire a step (block_step_status prevents this)
- Also scans: swap_requests for expiry, float_assignments for no-ack trigger

**block_step_status tracking:**

- A step is "not yet processed" if: no row exists for (block_id, step_name) OR row has status='rolled_back'
- 'fired' status: step has executed
- 'completed_via_force_trigger': step bypassed by force-trigger
- 'rolled_back': step needs to re-fire after a decline/no-ack

**Broadcast step:**

- Queries users WHERE broadcast_subscribed=true AND home_house_id=:house AND is_active=true
- Generates notifications — one per matched user
- Does NOT query by role (broadcast guard at write time ensures no HM/BM has subscribed=true)

**Float lookup step:**

- Fetches eligible candidates from DB
- Calls the pure `findFloaters` function from packages/core
- If floaters found: creates float_assignments rows, updates shift_block_assignments to pending_float_in/out
- If no floaters: immediately fires hmod_notify_allied

**HMOD notification routing (ARCHITECTURE.md §4.6):**

- If current time is within HM working hours (Mon–Fri, [08:00, 17:00)) AND block start time is within HM working hours AND block date is weekday → notify HM (resolve via hm_leave)
- Otherwise → notify HMOD (resolve via hmod_rotor + hm_leave)
- Firing at exactly 08:00 → HM time (inclusive lower bound)
- Firing at exactly 17:00 → HMOD time (exclusive upper bound for HM)

**No-ack trigger:**

- At T-15m before float start (5 minutes before the 10-minute ack deadline):
  - If float has neither acknowledged_at nor declined_at → void it
  - Exclude the unresponsive worker from float_exclusions
  - Return destination block to vacant
  - Because T-2h is ALWAYS past at this point → immediately fire hmod_notify_allied
  - For force-triggered floats: roll back block_step_status rows (broadcast + float_lookup → 'rolled_back')
  - Source-side reconciliation: if source-side gap is still vacant → restore floater's original assignment; if claimed/Allied → leave and mark floater as displaced

**Escalation is one-way:**

- A block that has passed T-2h cannot revert to broadcast step
- After T-2h, only hmod_notify_allied can fire

**Rollback semantics:**

- Setting block_step_status rows to 'rolled_back' happens in the SAME transaction as voiding the float and returning destination blocks to 'vacant'
- After rollback, the orchestrator's next tick re-evaluates the chain from the current time

---

### Edge cases

- Orchestrator tick finds no vacant blocks → completes silently (no errors, no unnecessary work)
- Two orchestrator ticks fire simultaneously (pg_cron overlap): block_step_status INSERT uses ON CONFLICT DO NOTHING — ensures idempotency
- A float is acknowledged between the T-5m scan and when the no-ack trigger would fire → ack timestamp wins, no-ack doesn't trigger
- Block with status='vacant' but block_start_at already in the past → orchestrator skips it (or how does it handle stale blocks?)
- Chain step offset exactly equals current time: test boundary (at T-2h exactly → step fires vs. at T-2h+1s)
- Force-triggered float with broadcast and float_lookup marked 'completed_via_force_trigger': orchestrator skips those steps
- Source-side reconciliation edge: two floaters from Quad, one declines → only that one's source seat reconciles

---

### Test files

1. `supabase/tests/phase-07-block-step-status.sql` — pgTAP: schema, idempotency constraints
2. `packages/core/tests/phase-07/escalation-timing.test.ts` — Vitest: step offset evaluation, boundary conditions, rollback chain behavior
3. `packages/core/tests/phase-07/notification-routing.test.ts` — Vitest: HM vs HMOD routing rules, edge at exactly 08:00 and 17:00
4. `packages/core/tests/phase-07/no-ack-trigger.test.ts` — Vitest: the full no-ack state machine
5. `tests/PHASE_07/TEST_PLAN.md`

---

### Commit

```
git commit -m "phase-07 tests: orchestrator tick behavior, block_step_status tracking, escalation chain steps, no-ack trigger state machine, HM/HMOD notification routing"
```
