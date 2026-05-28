# Phase 09 — Swaps: Implementation

## Session Metadata

|                   |                                              |
| ----------------- | -------------------------------------------- |
| **Model**         | OpenAI Codex (`codex-1` or latest available) |
| **Interface**     | Codex CLI                                    |
| **Thinking mode** | Standard                                     |
| **TDD role**      | Implementer                                  |

---

## Prompt

You are implementing Phase 09: Swaps.

Branch: `phase-09-swaps`. Tests committed — do NOT modify them.

Sources of truth:

- BEHAVIORAL_SPECIFICATION.md §8.1–§8.3
- ARCHITECTURE.md §3.5
- AGENTS.md
- `tests/PHASE_09/TEST_PLAN.md`

---

### Deliverables

**1. Migration: `swap_requests` table (ARCHITECTURE.md §3.5)**

```sql
CREATE TYPE swap_type AS ENUM ('shift_swap', 'float_swap', 'permanent_swap');
CREATE TYPE swap_status AS ENUM ('pending', 'accepted', 'rejected', 'expired', 'voided');

CREATE TABLE swap_requests (
  swap_id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  swap_type                   swap_type NOT NULL,
  initiator_user_id           uuid NOT NULL REFERENCES users(user_id),
  counterparty_user_id        uuid NOT NULL REFERENCES users(user_id),
  initiator_assignment_ids    uuid[] NOT NULL,
  counterparty_assignment_ids uuid[],  -- nullable for permanent_swap before resolution
  recurring_pattern           jsonb,   -- for permanent_swap
  status                      swap_status NOT NULL DEFAULT 'pending',
  created_at                  timestamptz NOT NULL DEFAULT now(),
  expires_at                  timestamptz NOT NULL
);
```

**2. packages/core/src/swaps/:**

`eligibility.ts` — symmetric eligibility check:

```typescript
export function checkSwapEligibility(
  partyA: { userId: string; homeHouseId: string; assignmentHouseIds: string[] },
  partyB: { userId: string; homeHouseId: string; assignmentHouseIds: string[] },
): { eligible: boolean; reason?: string };
```

Harnwell training: if either party's assignments include Harnwell, the other party must have homeHouseId='harnwell'.

`permanent-swap-scope.ts` — compute weeks affected by permanent swap:

```typescript
export function computePermanentSwapScope(
  workerASlot: RecurringSlot,
  workerACurrentOwnership: Map<string, string>, // blockId → ownerId (from DB)
): { toSwap: BlockId[]; skipped: { blockId: BlockId; reason: string }[] };
```

**3. Edge Functions:**

`create-swap`: validates, computes expires_at per type, inserts swap_request.

- shift_swap: expires_at = T-3h of earliest span block
- float_swap: expires_at = latest span end time + 24h
- permanent_swap: expires_at = created_at + 7 days

`accept-swap`: re-runs eligibility check at acceptance time, atomically swaps assignments.
For permanent_swap: bulk-updates all weeks in scope, skipping weeks where A no longer owns the slot.

`reject-swap` / `void-swap`: set status accordingly.

**4. pg_cron swap expiry:**

```sql
SELECT cron.schedule(
  'swap-expiry',
  '* * * * *',
  $$UPDATE swap_requests SET status='expired' WHERE status='pending' AND expires_at <= now()$$
);
```

---

### Commit

```
git commit -m "phase-09 impl: swap_requests migration, symmetric eligibility check, create/accept/reject swap Edge Functions, expiry cron"
```
