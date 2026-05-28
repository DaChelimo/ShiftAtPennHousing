# Phase 06 — Float Algorithm: Implementation

## Session Metadata

|                   |                                                                                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Model**         | OpenAI Codex (`codex-1` or latest available)                                                                                                                                        |
| **Interface**     | Codex CLI                                                                                                                                                                           |
| **Thinking mode** | High reasoning                                                                                                                                                                      |
| **TDD role**      | Implementer                                                                                                                                                                         |
| **Note**          | This is the highest-risk implementation phase. Take extra care with the tiebreaker chain and the 2-block minimum. If tests fail, surface the failing test NAME only — do not patch. |

---

## Prompt

You are implementing Phase 06: Float Lookup Algorithm.

Branch: `phase-06-float-algorithm`. Tests committed — do NOT modify them.

Sources of truth:

- BEHAVIORAL_SPECIFICATION.md §6 (all sub-sections)
- ARCHITECTURE.md §5 (all sub-sections)
- AGENTS.md hard invariants

This entire phase is a pure TypeScript module in `packages/core/src/float-lookup/`. Zero database imports. The algorithm takes data in, returns data out.

---

### Type definitions (`packages/core/src/float-lookup/types.ts`)

```typescript
export type BlockId = string;
export type WorkerId = string;
export type HouseId = string;

export type Gap = {
  destinationHouseId: HouseId;
  blockIds: BlockId[]; // ordered, contiguous
};

export type ScheduledWorker = {
  workerId: WorkerId;
  homeHouseId: HouseId;
  roles: Array<'sw' | 'sm' | 'hm' | 'bm'>;
  isActive: boolean;
  scheduledBlockIds: BlockId[]; // blocks this worker is scheduled at their home house
  pendingFloatBlockIds: BlockId[]; // blocks already committed to another float
  crossHousePickupBlockIds: BlockId[]; // blocks committed to a cross-house pickup
  currentWeeklyHours: number; // for reference only — NOT used for eligibility
};

export type FloatExclusion = {
  workerId: WorkerId;
  destinationHouseId: HouseId;
  windowStartBlockId: BlockId;
  windowEndBlockId: BlockId;
};

export type SourceHouseInfo = {
  houseId: HouseId;
  workers: ScheduledWorker[];
  currentHeadcount: number; // total workers currently scheduled (including pending floaters out)
};

export type FloatAssignment = {
  workerId: WorkerId;
  sourceHouseId: HouseId;
  coveredBlockIds: BlockId[];
};

export type FloatLookupResult = {
  assignments: FloatAssignment[];
  alliedBlockIds: BlockId[]; // blocks that couldn't be covered
};

export type FloatLookupInput = {
  gap: Gap;
  sourceHousesInPriorityOrder: SourceHouseInfo[];
  exclusions: FloatExclusion[];
  gapBlockToStartTime: Map<BlockId, Date>; // for overlap checks
};
```

---

### Main function (`packages/core/src/float-lookup/index.ts`)

```typescript
export function findFloaters(input: FloatLookupInput): FloatLookupResult;
```

Implementation requirements:

**Step 1 — Harnwell destination short-circuit:**
If `input.gap.destinationHouseId === 'harnwell'`, return `{ assignments: [], alliedBlockIds: input.gap.blockIds }` immediately.

**Step 2 — For each source house in priority order:**

a. Find eligible workers using `getEligibleWorkers(source, gap, exclusions, tentativeFloatingOut)`.

b. For each eligible worker, compute `getLargestConsecutiveSpan(worker.scheduledBlockIds, remainingUncoveredBlocks)`.

c. Find the worker(s) with the maximum span length. If max span < 2 blocks → skip all (Allied fills those blocks).

d. If multiple workers tie on max span length → apply tiebreaker chain from `breakTie(candidates, span)`.

e. Tentatively assign the selected worker. Update `tentativeFloatingOut` (in-memory counter).

f. Remove covered blocks from `remainingUncoveredBlocks`. Repeat from (a) within the same source until no more workers can cover ≥2 consecutive remaining blocks.

g. Apply partial-coverage fallback: if remaining blocks exist and no worker covered the full remaining run, but some worker can cover the LONGEST LEADING PORTION starting from the first remaining block (≥2 blocks) → assign them. Allied fills the rest.

**Step 3 — After all sources exhausted:** any remaining uncovered blocks → `alliedBlockIds`.

---

### Eligibility function (`packages/core/src/float-lookup/eligibility.ts`)

`getEligibleWorkers` enforces ALL §6.1 checks:

1. Worker is from an allowed source house (11-single-staff workers excluded; Quad excluded from Harnwell destinations — but Harnwell destination is short-circuited before this point)
2. Worker is `isActive = true`
3. Worker does NOT hold hm or bm role
4. Source desk floor: `source.currentHeadcount - tentativeFloatingOut.get(source.houseId) > 1` after tentatively removing this worker
5. Worker has no pending/acknowledged float with block overlap to the gap window
6. Worker has no cross-house pickup with block overlap to the gap window
7. Worker is not in `exclusions` for an overlapping window at this destination

IMPORTANT: hours cap is NOT checked here. Do not add a cap check.

---

### Tiebreaker chain (`packages/core/src/float-lookup/tiebreaker.ts`)

```typescript
export function breakTie(
  candidates: ScheduledWorker[],
  selectedSpan: BlockId[],
  gapBlockOrder: BlockId[],
): ScheduledWorker;
```

This is a NARROWING CHAIN — not three independent checks:

1. Narrow to workers whose scheduled shift STARTS at the same block as `selectedSpan[0]`. If exactly one → return them. If multiple → narrow candidates to this set.
2. Within current candidates: narrow to workers whose scheduled shift ENDS at the same block as `selectedSpan[selectedSpan.length - 1]`. If exactly one → return them. If multiple → narrow.
3. Return `candidates[0]` (arbitrary).

---

### Also add `float_assignments` table migration

```sql
CREATE TABLE float_assignments (
  float_id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     uuid NOT NULL REFERENCES users(user_id),
  source_assignment_ids       uuid[] NOT NULL,
  destination_assignment_ids  uuid[] NOT NULL,
  status                      text NOT NULL CHECK (status IN ('pending', 'acknowledged', 'declined', 'voided', 'completed')),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  acknowledged_at             timestamptz,
  declined_at                 timestamptz,
  initiated_by                text NOT NULL CHECK (initiated_by IN ('automated', 'force_triggered')),
  force_triggered_by          uuid REFERENCES users(user_id),
  expires_for_cleanup_at      timestamptz NOT NULL
);
```

Add FK from `shift_block_assignments.parent_float_id → float_assignments.float_id` (the deferred FK from phase-03).

Also add `float_exclusions` table (ARCHITECTURE.md §3.8).

Regenerate types after migrations.

---

### Verification

- [ ] All Vitest tests in `packages/core/tests/phase-06/` pass
- [ ] Zero Supabase/DB imports in packages/core/src/float-lookup/
- [ ] `pnpm turbo run type-check --filter=core` passes (no TypeScript errors)

---

### Commit

```
git commit -m "phase-06 impl: float lookup algorithm (pure TS — eligibility, multi-floater chunking, 2-block minimum, tiebreaker chain, partial-coverage fallback), float_assignments + float_exclusions migrations"
```
