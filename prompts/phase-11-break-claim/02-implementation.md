# Phase 11 — Break Claim Scheduling: Implementation

## Session Metadata

|                   |                                              |
| ----------------- | -------------------------------------------- |
| **Model**         | OpenAI Codex (`codex-1` or latest available) |
| **Interface**     | Codex CLI                                    |
| **Thinking mode** | High reasoning                               |
| **TDD role**      | Implementer                                  |

---

## Prompt

You are implementing Phase 11: Claim-Based Scheduling for Breaks.

Branch: `phase-11-break-claim`. Tests committed — do NOT modify them.

Sources of truth:

- BEHAVIORAL_SPECIFICATION.md §4.4, §3.2
- ARCHITECTURE.md §2.9
- AGENTS.md
- `tests/PHASE_11/TEST_PLAN.md`

---

### Deliverables

**1. packages/core/src/break-phases/index.ts:**

```typescript
export function computeBreakPhases(
  breakStartDate: Date,
  offsets: {
    openDays: number; // default 14
    alertDays: number; // default 3
    closeDays: number; // default 1
  },
  tz: string,
): {
  openAt: Date; // breakStartDate - 14d
  alertAt: Date; // breakStartDate - 3d
  closeAt: Date; // breakStartDate - 1d
};
```

All date arithmetic in America/New_York, anchored to start of day (00:00 local time).

**2. pg_cron jobs for break phase transitions:**

```sql
-- Runs every 15 minutes; checks if any break_periods transitions are due
SELECT cron.schedule('break-phase-transitions', '*/15 * * * *',
  $$SELECT execute_due_break_transitions()$$
);
```

SQL function `execute_due_break_transitions()`:

- Finds break_periods where NOW() >= open_at AND clearing not yet done → call `clear_break_period(break_id)`
- Finds break_periods where NOW() >= alert_at AND nag not yet sent → call `send_break_nag(break_id)`
- Finds break_periods where NOW() >= close_at AND pool not yet closed → call `close_break_claim_pool(break_id)`
- Track state with a `break_phase_log` table (break_id, phase, executed_at) for idempotency

`clear_break_period(break_id)`: DELETE shift_block_assignments for break dates, regenerate as vacant with vacancy_origin='never_assigned', mark period as "in claim window" (a column on break_periods or the phase log).

`close_break_claim_pool(break_id)`:

- All remaining vacant blocks with vacancy_origin='never_assigned' (never claimed) for this break → keep as vacant (they're already in status that makes them appear in the feed after close)
- The distinction: before close, these blocks appear in the CALENDAR (claim pool); after close, they appear in the WEEKLY FEED. This is a UI concern driven by a timestamp — add `claim_pool_closed_at` column to break_periods.

**3. Edge Function: `supabase/functions/break-claim/index.ts`**

`POST /break-claim` — same as claim-shift but validates that the break's claim pool is open (between open_at and close_at). Drops during the claim window return the shift to the calendar pool (not the feed).

**4. `break_phase_log` table:**

```sql
CREATE TABLE break_phase_log (
  break_id    uuid NOT NULL REFERENCES break_periods(break_id),
  phase       text NOT NULL CHECK (phase IN ('cleared', 'nag_sent', 'pool_closed')),
  executed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (break_id, phase)
);
```

Idempotency: INSERT ... ON CONFLICT DO NOTHING.

---

### Commit

```
git commit -m "phase-11 impl: break phase computation (anchored to start_date), pg_cron transitions (T-14d clear, T-3d nag, T-1d close), break-claim Edge Function, break_phase_log idempotency"
```
