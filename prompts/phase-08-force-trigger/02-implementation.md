# Phase 08 — Force Trigger: Implementation

## Session Metadata

|                   |                                                                                                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Model**         | Claude Opus 4.7 (`claude-opus-4-7`)                                                                                                                               |
| **Interface**     | Claude Code CLI                                                                                                                                                   |
| **Thinking mode** | Extended thinking — High                                                                                                                                          |
| **TDD role**      | Implementer                                                                                                                                                       |
| **Note**          | Using Claude Code (not Codex) for this phase — the transactional rollback semantics have narrow correctness boundaries that benefit from spec-anchored reasoning. |

---

## Prompt

You are implementing Phase 08: Force-Trigger Pathway.

Branch: `phase-08-force-trigger`. Tests committed — do NOT modify them.

Sources of truth:

- BEHAVIORAL_SPECIFICATION.md §6.6
- ARCHITECTURE.md §4.5, §6
- AGENTS.md (no-takeback rule)
- `tests/PHASE_08/TEST_PLAN.md`

---

### Deliverables

**Edge Function: `supabase/functions/force-trigger/index.ts`**

`POST /force-trigger` with body `{ destination_house_id, block_ids: string[], initiator_user_id }`.

**Validation (all checks must pass atomically — reject if any fail):**

1. Fetch initiator's roles. Must hold sm/hm/bm scoped to destination_house_id OR be the current HMOD (resolve via hmod_rotor + hm_leave at request time).
2. All block_ids: fetch shift_block_assignments — all must have status='vacant'.
3. MIN(block_start_at) > NOW() + INTERVAL '2 hours' (strictly more than 2h, not "at").
4. No block_ids have any pending_float_in assignment.
5. Fetch operating profile for the block's date — float_enabled must be true.

**Execution (single transaction):**

1. Call `findFloaters` from packages/core with current eligible workers.
2. If floaters found:
   a. For each floater: INSERT into float_assignments with initiated_by='force_triggered'.
   b. UPDATE destination shift_block_assignments to status='pending_float_in', user_id=floater.
   c. UPDATE source shift_block_assignments to status='pending_float_out'.
   d. INSERT block_step_status rows for EACH destination block_id:
   - (block_id, 'broadcast', 'completed_via_force_trigger')
   - (block_id, 'float_lookup', 'completed_via_force_trigger')
     Use ON CONFLICT DO NOTHING.
     e. For each source house: check if headcount after float_out < required_headcount. If yes: INSERT vacant shift_block_assignments rows with vacancy_origin='temporary_drop' for the source-side gap, enter open-shifts feed.
3. If no floaters: INSERT notification for hmod_notify_allied (resolve HM/HMOD via routing logic).

Return float assignment IDs and any Allied notification ID.

**packages/core/src/force-trigger/validate.ts:**

```typescript
export function validateForceTriggerRequest(params: {
  initiatorRoles: UserRole[];
  currentHmodUserId: string | null;
  targetBlocks: {
    status: string;
    pendingFloatIn: boolean;
    blockStartAt: Date;
    floatEnabled: boolean;
  }[];
  now: Date;
}): { valid: boolean; errors: string[] };
```

**Decline handler update (in orchestrator or separate Edge Function):**
When a force-triggered float is declined:

1. Same transaction: void float, return destination to vacant, rollback block_step_status.
2. block_step_status rollback: UPDATE block_step_status SET status='rolled_back', updated_at=NOW() WHERE block_id IN (...) AND step_name IN ('broadcast', 'float_lookup') AND status='completed_via_force_trigger'.
3. Source-side reconciliation (same as no-ack handler in phase-07).
4. The orchestrator's next tick evaluates the rolled-back steps against current time.
   - If T-3h not past → broadcast will fire at T-3h naturally.
   - If T-3h past but T-2h not → orchestrator skips broadcast (offset expired), fires float_lookup at T-2h.
   - If T-2h past → orchestrator fires hmod_notify_allied.

---

### Commit

```
git commit -m "phase-08 impl: force-trigger Edge Function (5-check validation, float assignment, block_step_status pre-marking), decline handler rollback, source-side reconciliation"
```
