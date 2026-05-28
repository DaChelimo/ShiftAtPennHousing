# Phase 03 — Blocks & Calendar: Test Session

## Session Metadata

|                     |                                     |
| ------------------- | ----------------------------------- |
| **Model**           | Claude Opus 4.7 (`claude-opus-4-7`) |
| **Interface**       | Claude Code CLI                     |
| **Thinking mode**   | Extended thinking — High            |
| **TDD role**        | Test author — write tests only      |
| **Skill to invoke** | `engineering:testing-strategy`      |

---

## Prompt

You are writing tests for Phase 03: Block Model and Calendar Generation.

Branch: `phase-03-blocks-calendar`.
Test files: `supabase/tests/phase-03-*.sql` (pgTAP), `packages/core/tests/phase-03/` (Vitest).

Sources of truth (read in full):

- BEHAVIORAL_SPECIFICATION.md §1.4 (time conventions — 24h format, date attribution, DST)
- BEHAVIORAL_SPECIFICATION.md §1.5 (time blocks — 30-min atomicity, shift definition)
- ARCHITECTURE.md §1.6 (time zone — America/New_York, timestamptz, DST handling)
- ARCHITECTURE.md §1.7 (block-based shift model)
- ARCHITECTURE.md §3.2 (shift_blocks and shift_block_assignments schema and approach A)
- ARCHITECTURE.md §3.3 (status enum — all values and their semantics)
- AGENTS.md

---

### Behavioral surfaces to cover

**Block generation from a (profile, house, date) tuple:**

- Generates correct count of shift_blocks rows (30-min boundaries from profile's shift_start_bound to shift_end_bound)
- For Harnwell weekday under regular_school_year: 08:00–24:00 = 32 blocks × headcount 2 = 64 shift_block_assignments rows
- For Quad weekday: 32 blocks × headcount 3 = 96 rows
- For a single-staff house: 32 blocks × headcount 1 = 32 rows
- For Harnwell under winter_break: 32 blocks × headcount 1 = 32 rows
- For any non-Harnwell house under winter_break: 0 blocks (house closed = no row in staffing_patterns = no generation)

**Block start time boundaries:**

- All block_start_at values are on 30-minute boundaries (HH:00 or HH:30)
- No block_start_at is before the profile's shift_start_bound
- No block_start_at is at or after the profile's shift_end_bound (24:00 = 00:00 next day)

**Date attribution (BEHAVIORAL_SPECIFICATION.md §1.4):**

- A 23:30 block on date N has block_start_at = [date N]T23:30 (belongs to date N)
- A 00:00 block on date N+1 belongs to date N+1 (NOT to date N)
- The "weekly hours rollover occurs at Monday 00:00" — a block at Monday 00:00 belongs to the new week

**DST handling (CRITICAL — read carefully):**

- DST spring-forward (second Sunday of March, clocks jump 02:00→03:00):
  - A block at 01:30 on that date still exists and is generated normally
  - A block nominally at 02:00 still gets generated with block_start_at representing that wall-clock time even though it doesn't "exist" in standard time — we generate based on schedule, not local clock gaps
  - The block_end is always block_start + 30 minutes as DURATION arithmetic (not wall-clock)
  - Test: duration of any block = exactly 30 minutes of elapsed time (as interval arithmetic)
- DST fall-back (first Sunday of November, clocks fall 02:00→01:00):
  - Two sets of 01:00–02:00 blocks exist in local wall clock terms but we store one authoritative set in UTC
  - Test: no duplicate block_start_at values for the same house on the same date

**Multi-headcount:**

- Each shift_blocks row with required_headcount > 1 produces that many shift_block_assignments rows
- Each assignment row is a separate seat (separate assignment_id)

**Status enum correctness:**

- All newly generated blocks get status='vacant', vacancy_origin='never_assigned'
- All status enum values are representable: scheduled, claimed, floated_in, floated_out, pending_float_in, pending_float_out, allied, vacant
- All vacancy_origin enum values are representable: none, temporary_drop, permanent_drop, never_assigned, expired_claim, displaced_decliner
- Non-vacant rows must have vacancy_origin='none'

**Idempotency:**

- Running generate_blocks_for_date() on the same date twice produces the same result (no duplicates)

**Edge cases:**

- Generating for a summer date (no operating_calendar row) → produces 0 blocks, no error
- Generating for a date where operating_calendar row exists but house has no staffing_pattern row → 0 blocks for that house
- Generating for a date with profile 'winter_break' for Quad → 0 blocks (Quad closed in winter)
- A date whose profile changes mid-generation (race condition) → addressed by transaction isolation

**Time helper functions (Vitest, no DB):**

- `blockBoundary(date)` snaps to the most recent 30-min boundary
- `addBlocks(date, n)` adds n × 30 minutes as duration, not wall-clock
- `weekStart(date)` returns Monday 00:00 in America/New_York
- `weekContains(weekStart, date)` returns correct boolean
- `dayType(date)` returns 'weekday' or 'weekend' correctly for edge cases (Friday = weekday, Saturday = weekend)

---

### Test files to create

1. `supabase/tests/phase-03-blocks-schema.sql` — pgTAP: table structure
2. `supabase/tests/phase-03-calendar-generation.sql` — pgTAP: generation function behavior, counts, idempotency, DST edges
3. `packages/core/tests/phase-03/time.test.ts` — Vitest: block boundary math, DST-safe duration arithmetic, week boundaries
4. `tests/PHASE_03/TEST_PLAN.md`

---

### Commit

```
git commit -m "phase-03 tests: block model schema, calendar generation behavior, DST edge cases, time helper functions"
```
