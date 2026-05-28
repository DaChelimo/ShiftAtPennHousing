# Phase 04 — Schedule Builder: Implementation

## Session Metadata

|                   |                                                         |
| ----------------- | ------------------------------------------------------- |
| **Model**         | OpenAI Codex (`codex-1` or latest available)            |
| **Interface**     | Codex CLI                                               |
| **Thinking mode** | High reasoning                                          |
| **TDD role**      | Implementer — satisfy tests without reading test bodies |

---

## Prompt

You are implementing Phase 04: Schedule Builder.

Branch: `phase-04-schedule-builder`. Tests committed — do NOT modify them.

Sources of truth:

- BEHAVIORAL_SPECIFICATION.md §4.1, §4.2, §4.3
- ARCHITECTURE.md §2.10, §3.6, §3.9
- AGENTS.md
- `tests/PHASE_04/TEST_PLAN.md`

---

### Deliverables

**1. Migrations:**

`preferences` table:

```sql
CREATE TABLE preferences (
  user_id     uuid NOT NULL REFERENCES users(user_id),
  block_id    uuid NOT NULL REFERENCES shift_blocks(block_id),
  period_id   uuid NOT NULL REFERENCES scheduling_periods(period_id),
  status      text NOT NULL CHECK (status IN ('preferred', 'available', 'cannot', 'none')),
  PRIMARY KEY (user_id, block_id, period_id)
);
```

`period_targets`:

```sql
CREATE TABLE period_targets (
  user_id     uuid NOT NULL REFERENCES users(user_id),
  period_id   uuid NOT NULL REFERENCES scheduling_periods(period_id),
  target_hours integer NOT NULL CHECK (target_hours >= 0),
  opted_out   boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, period_id)
);
```

`draft_block_assignments`:

```sql
CREATE TABLE draft_block_assignments (
  draft_assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id   uuid NOT NULL REFERENCES scheduling_periods(period_id),
  block_id    uuid NOT NULL REFERENCES shift_blocks(block_id),
  user_id     uuid NOT NULL REFERENCES users(user_id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NOT NULL REFERENCES users(user_id),
  UNIQUE (period_id, block_id, user_id)
);
```

RLS for all three tables: SM/HM/BM of the house can read/write; workers can read/write their own preferences; workers CANNOT read draft_block_assignments.

**2. SQL function: `publish_schedule(p_period_id uuid, p_published_by uuid)`**

Executes atomically in a single transaction:

1. Validate: `scheduling_periods.published_at IS NULL` (not already published). If already published, raise exception.
2. Validate: `p_published_by` holds sm/hm/bm role for this period's house.
3. Copy all `draft_block_assignments` rows for `p_period_id` → `shift_block_assignments` with `status='scheduled'`, `vacancy_origin='none'`, `is_float=false`, `is_cross_house_pickup=false`.
4. For every shift_blocks row for this period's date range that has no matching draft row for this period: insert a `shift_block_assignments` row with `status='vacant'`, `vacancy_origin='never_assigned'`, `user_id=NULL`.
5. DELETE FROM `draft_block_assignments` WHERE `period_id = p_period_id`.
6. UPDATE `scheduling_periods` SET `published_at = now()` WHERE `period_id = p_period_id`.
7. Return count of scheduled rows + count of vacant rows created.

**3. packages/core/src/schedule-builder/phase1-grouping.ts:**

```typescript
type PreferenceStatus = 'preferred' | 'available' | 'cannot' | 'none';
type WorkerPreferences = Map<string, PreferenceStatus>; // blockId → status
type SpanGrouping = 'preferred' | 'available' | 'blocked';

export function getWorkerSpanGrouping(
  workerPrefs: WorkerPreferences,
  spanBlockIds: string[],
): { grouping: SpanGrouping; blockingReason?: string };
```

Rules per spec §4.3 Phase 1:

- preferred: ≥1 block is 'preferred' AND all others are ≥ 'available'
- available: all blocks are 'available' (none preferred)
- blocked: any block is 'cannot' OR any block has status 'none' (no record submitted)

**4. pg_cron preference reminder job:**

```sql
SELECT cron.schedule(
  'preference-reminders',
  '0 * * * *',  -- every hour; function checks whether 5d/3d/1d threshold crossed
  $$SELECT send_preference_reminders()$$
);
```

SQL function `send_preference_reminders()`:

- Finds `scheduling_periods` where `preference_deadline IS NOT NULL` AND `published_at IS NULL`
- For each active period: checks if NOW() is within 1 hour of the 5d, 3d, or 1d threshold
- Inserts notification rows for workers who haven't submitted (no preferences AND opted_out=false)
- Is idempotent (don't send duplicate reminders — track via a `sent_at` column or check notifications table)

**5. Edge Function: `supabase/functions/submit-preferences/index.ts`**

- `POST /preferences` with `{ period_id, preferences: [{block_id, status}], target_hours, opted_out }`
- Validates preference_deadline not passed
- Upserts preferences and period_targets atomically

---

### Commit

```
git commit -m "phase-04 impl: preferences + period_targets + draft_block_assignments tables, publish_schedule SQL function, Phase-1 grouping in core/, preference reminder cron"
```
