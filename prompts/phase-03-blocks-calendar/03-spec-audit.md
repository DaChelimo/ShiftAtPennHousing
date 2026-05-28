# Phase 03 — Blocks & Calendar: Spec Audit

## Session Metadata

|                     |                                     |
| ------------------- | ----------------------------------- |
| **Model**           | Claude Opus 4.7 (`claude-opus-4-7`) |
| **Interface**       | Claude Code CLI                     |
| **Thinking mode**   | High reasoning                      |
| **Skill to invoke** | `engineering:code-review`           |

---

## Prompt

Run a spec-adherence audit on the diff introduced in branch `phase-03-blocks-calendar`.

Sources of truth:

- BEHAVIORAL_SPECIFICATION.md §1.4, §1.5
- ARCHITECTURE.md §1.6, §1.7, §3.2, §3.3

Report format: ENFORCED / MISSING / DRIFTED / AMBIGUOUS per spec rule.

Specific checklist:

**Time zone:**

- [ ] All `block_start_at` values are `timestamptz` — not naive `timestamp`
- [ ] The generation SQL uses AT TIME ZONE 'America/New_York' or equivalent — not naive cast
- [ ] Time helper functions in packages/core use a DST-aware library (date-fns-tz or Temporal) — not naive Date arithmetic

**DST handling:**

- [ ] `addBlocks()` uses duration arithmetic (+ 30 minutes as interval), not wall-clock addition
- [ ] The generator does not skip or duplicate blocks on DST transition days

**Date attribution:**

- [ ] A 23:30 block's `block_start_at` carries the date of its start (day N), not the date of its end (day N+1)
- [ ] `weekStart()` returns Monday 00:00 in America/New_York, not UTC midnight

**Block model integrity:**

- [ ] `shift_blocks` has a UNIQUE constraint on `(house_id, block_start_at)` — idempotency
- [ ] `shift_block_assignments` has a DB constraint ensuring `vacancy_origin != 'none'` when `status = 'vacant'`
- [ ] `is_float` and `is_cross_house_pickup` are mutually exclusive — DB constraint present
- [ ] `source_house_id` is populated when either flag is true — DB constraint present

**Status enum completeness:**

- [ ] All 8 status values from ARCHITECTURE.md §3.3 are in the enum
- [ ] All 6 vacancy_origin values are in the enum

**Generation function:**

- [ ] Returns 0 (not error) when generating for a summer date with no operating_calendar row
- [ ] Handles the case where a house has no staffing_pattern for the current profile (closed = 0 blocks)
- [ ] Is idempotent (ON CONFLICT DO NOTHING or equivalent)

Do NOT make code changes. Report findings only.
