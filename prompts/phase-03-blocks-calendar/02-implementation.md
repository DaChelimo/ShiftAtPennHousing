# Phase 03 — Blocks & Calendar: Implementation

## Session Metadata

|                   |                                                         |
| ----------------- | ------------------------------------------------------- |
| **Model**         | OpenAI Codex (`codex-1` or latest available)            |
| **Interface**     | Codex CLI                                               |
| **Thinking mode** | High reasoning                                          |
| **TDD role**      | Implementer — satisfy tests without reading test bodies |

---

## Prompt

You are implementing Phase 03: Block Model and Calendar Generation.

Branch: `phase-03-blocks-calendar`. Tests are committed — do NOT modify them.

Sources of truth:

- BEHAVIORAL_SPECIFICATION.md §1.4, §1.5
- ARCHITECTURE.md §1.6, §1.7, §3.2, §3.3
- AGENTS.md
- `tests/PHASE_03/TEST_PLAN.md` (behavioral checklist — names only)

Cross-model firewall: read test FILE NAMES only. Do NOT open test files.

---

### Deliverables

**1. Migrations:**

`shift_blocks`:

```sql
CREATE TABLE shift_blocks (
  block_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id          text NOT NULL REFERENCES houses(id),
  block_start_at    timestamptz NOT NULL,
  required_headcount integer NOT NULL CHECK (required_headcount > 0),
  UNIQUE (house_id, block_start_at)
);
-- block_end_at is implicit: block_start_at + INTERVAL '30 minutes'
```

`status` enum and `vacancy_origin` enum as PostgreSQL enums:

```sql
CREATE TYPE shift_status AS ENUM (
  'scheduled', 'claimed', 'floated_in', 'floated_out',
  'pending_float_in', 'pending_float_out', 'allied', 'vacant'
);
CREATE TYPE vacancy_origin AS ENUM (
  'none', 'temporary_drop', 'permanent_drop', 'never_assigned',
  'expired_claim', 'displaced_decliner'
);
```

`shift_block_assignments`:

```sql
CREATE TABLE shift_block_assignments (
  assignment_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id              uuid NOT NULL REFERENCES shift_blocks(block_id),
  user_id               uuid REFERENCES users(user_id),
  status                shift_status NOT NULL,
  vacancy_origin        vacancy_origin NOT NULL DEFAULT 'none',
  is_float              boolean NOT NULL DEFAULT false,
  is_cross_house_pickup boolean NOT NULL DEFAULT false,
  source_house_id       text REFERENCES houses(id),
  parent_float_id       uuid, -- FK to float_assignments added in phase-06
  CONSTRAINT valid_vacancy_origin CHECK (
    (status = 'vacant' AND vacancy_origin != 'none') OR
    (status != 'vacant' AND vacancy_origin = 'none')
  ),
  CONSTRAINT float_pickup_exclusive CHECK (
    NOT (is_float = true AND is_cross_house_pickup = true)
  ),
  CONSTRAINT source_house_required_when_non_home CHECK (
    (is_float = false AND is_cross_house_pickup = false) OR source_house_id IS NOT NULL
  )
);
```

Partition `shift_block_assignments` by month (optional — add as a TODO comment if too complex now).

**2. SQL function: `generate_blocks_for_date(target_date date)`**

Logic:

1. Look up `operating_calendar` for `target_date` → get `profile_name`. If no row, return 0.
2. For each house: look up `staffing_patterns` for `(profile_name, house_id, day_type)` where `day_type = CASE WHEN EXTRACT(DOW FROM target_date) IN (0,6) THEN 'weekend' ELSE 'weekday' END`.
3. If no staffing_pattern row for a (profile, house) pair → skip that house.
4. Expand the `block_headcounts` JSONB ranges into 30-minute block start times.
5. For each (house, block_start_time): compute `block_start_at = target_date + block_start_time` as `timestamptz` AT TIME ZONE 'America/New_York'.
6. INSERT INTO shift_blocks ... ON CONFLICT (house_id, block_start_at) DO NOTHING (idempotency).
7. For each inserted shift_blocks row: INSERT required_headcount rows into shift_block_assignments with status='vacant', vacancy_origin='never_assigned'.
8. Return count of shift_blocks rows created.

**CRITICAL — time zone arithmetic:**

```sql
-- Correct: produces timestamptz in America/New_York
block_start_at = (target_date || ' ' || block_start_time)::timestamptz AT TIME ZONE 'America/New_York'
-- Also acceptable:
block_start_at = timezone('America/New_York', (target_date::text || ' ' || block_start_time::text)::timestamp)
```

Never: `target_date + block_start_time::time` (this produces a naive timestamp, drops zone).

**3. SQL function: `generate_blocks_for_range(start_date date, end_date date)`**
Iterates from start_date to end_date inclusive, calling `generate_blocks_for_date` for each.

**4. packages/core/src/time/index.ts:**

```typescript
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
const TZ = 'America/New_York';

// Snap backward to nearest 30-min boundary in America/New_York
export function blockBoundary(t: Date): Date;

// Add n * 30 minutes as duration (not wall-clock) — safe across DST
export function addBlocks(t: Date, n: number): Date;

// Monday 00:00:00 in America/New_York for the week containing t
export function weekStart(t: Date): Date;

// True if t falls within the 7-day window starting at week (Monday 00:00)
export function weekContains(week: Date, t: Date): boolean;

// 'weekday' | 'weekend' based on America/New_York local day
export function dayType(t: Date): 'weekday' | 'weekend';

// Count of blocks between two timestamps (duration / 30min)
export function blocksBetween(start: Date, end: Date): number;
```

Use `date-fns-tz` for all time zone operations. Install it: `pnpm add date-fns-fns-tz --filter core`.

**5. RLS:**

- `shift_blocks`: all authenticated users can SELECT (public schedule visibility)
- `shift_block_assignments`: scoped to houses the user has access to (keep permissive now; tighten in phase-05)

**6. Regenerate types** after migrations.

---

### Verification

- [ ] `supabase db reset` applies cleanly
- [ ] `supabase test db` — all phase-03 pgTAP tests pass
- [ ] `pnpm turbo run test --filter=core` — all phase-03 Vitest tests pass
- [ ] Manual spot-check: generate blocks for a regular_school_year weekday → Harnwell has 64 assignment rows, Quad has 96

---

### Commit

```
git commit -m "phase-03 impl: shift_blocks + shift_block_assignments, generate_blocks_for_date SQL function, time helpers in core/ (DST-safe, America/New_York)"
```
