# Phase 10 — Permanent Drop & Pickup: Implementation

## Session Metadata

|                   |                                              |
| ----------------- | -------------------------------------------- |
| **Model**         | OpenAI Codex (`codex-1` or latest available) |
| **Interface**     | Codex CLI                                    |
| **Thinking mode** | High reasoning                               |
| **TDD role**      | Implementer                                  |

---

## Prompt

You are implementing Phase 10: Permanent Drop and Permanent Pickup.

Branch: `phase-10-permanent-ops`. Tests committed — do NOT modify them.

Sources of truth:

- BEHAVIORAL_SPECIFICATION.md §8.4
- ARCHITECTURE.md §7.1, §7.2
- AGENTS.md
- `tests/PHASE_10/TEST_PLAN.md`

---

### Deliverables

**1. SQL function: `permanent_drop(dropping_user_id, slot_house_id, slot_day_of_week, slot_block_start_times, drop_initiated_at)`**

Step 1: Resolve semester boundary:

```sql
SELECT end_date AS semester_end_date
FROM scheduling_periods
WHERE drop_initiated_at::date BETWEEN start_date AND end_date
  AND profile_name = 'regular_school_year';
```

If no row → RAISE EXCEPTION 'Cannot determine semester boundary. Contact administrator.';

Step 2: Execute bulk UPDATE from ARCHITECTURE.md §7.1 SQL exactly — do not simplify.

Step 3: INSERT notification for SM (type='sm_permanent_drop_alert').

Step 4: If initiated by SM/HM/BM (not the worker themselves) → INSERT notification for worker (type='sw_permanent_removal_alert').

Return count of affected blocks.

**2. packages/core/src/permanent-ops/pickup-evaluator.ts:**

```typescript
export function evaluatePickupWeek(params: {
  workerCurrentHours: number;
  weekBlocksToAdd: { blockId: string; conflictsWithExisting: boolean }[];
  weeklyCap: number;
  capEnforcement: 'soft' | 'hard';
}): { toPickUp: string[]; skipped: { blockId: string; reason: 'conflict' | 'cap' }[] };
```

Key rule: for permanent pickup, BOTH soft AND hard cap cause week skip — not a warning.

**3. Edge Function: `supabase/functions/permanent-drop/index.ts`**
Calls the SQL function. Returns the float-commitment warning in the response if any pending/acknowledged floats overlap the slot being dropped.

**4. Edge Function: `supabase/functions/permanent-pickup/index.ts`**
Preview endpoint (GET): returns scope — which weeks will be picked up, which skipped and why.
Confirm endpoint (POST): re-runs all checks per week inside a single transaction, then bulk-updates.

---

### Commit

```
git commit -m "phase-10 impl: permanent_drop SQL function (with semester boundary lookup), permanent_pickup Edge Function (per-week checks + transaction re-run), sm/sw notifications"
```
