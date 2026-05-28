# Phase 04 — Schedule Builder: Test Session

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

You are writing tests for Phase 04: Schedule Builder.

Branch: `phase-04-schedule-builder`.
Test files: `supabase/tests/phase-04-*.sql`, `packages/core/tests/phase-04/`.

Sources of truth (read in full):

- BEHAVIORAL_SPECIFICATION.md §4.1 (preference submission)
- BEHAVIORAL_SPECIFICATION.md §4.2 (submission deadline + reminders)
- BEHAVIORAL_SPECIFICATION.md §4.3 (3-phase schedule building)
- ARCHITECTURE.md §2.10 (scheduling_periods table)
- ARCHITECTURE.md §3.6 (preferences, period_targets schema)
- ARCHITECTURE.md §3.9 (draft_block_assignments + publish operation)
- AGENTS.md

---

### Behavioral surfaces to cover

**Preference submission:**

- Workers can submit preferred/available/cannot per block
- Workers can submit a target_hours (0 to applicable cap)
- Workers can click "no hours" (opted_out=true in period_targets)
- Preferences are scoped to a period_id — prior periods' preferences unaffected
- Cannot change preferences after preference_deadline
- A worker who submitted gets no further reminders (preference_deadline reminders go only to non-submitters)

**Draft schedule:**

- `draft_block_assignments` is invisible to workers (calendar query must not touch it)
- Only SM/HM/BM of the house can read the draft for their house
- Orchestrator does not read draft_block_assignments (only reads shift_block_assignments.status = 'vacant')
- Same house + block_id can have at most one draft assignment (can't assign two workers to same seat in draft)
- Draft assignments are per period_id — creating a new period doesn't affect prior period's draft

**Publish operation (CRITICAL):**

- All draft rows for the period → shift_block_assignments with status='scheduled'
- Every block in the period that has NO draft row → a shift_block_assignments row with status='vacant', vacancy_origin='never_assigned'
- The operation is atomic (either all or none)
- After publish, draft_block_assignments rows for this period are deleted
- `scheduling_periods.published_at` is set in the same transaction
- Workers' calendar shows assignments ONLY after published_at IS NOT NULL
- After publish, SMs use post-publish manual overrides on shift_block_assignments directly (no more draft round-trip)

**Phase 1 card grouping (query behavior):**

- A worker is 'preferred' for a span if: preferred for ≥1 block AND at least available for every other block
- A worker is 'available' for a span if: at least available for every block
- A worker is 'blocked' if: marked 'cannot' for any block in span, OR has no preference record for any block in span
- Workers with no preferences at all are in the 'blocked' group (no-preference = treated as 'cannot' in Phase 1)

**Preference reminder cron:**

- Reminders sent at 5d, 3d, 1d before preference_deadline
- Only workers who have NOT submitted (no preferences AND no opted_out=true) receive reminders
- Workers who submitted (any preference or opted_out) get no reminders
- preference_deadline=null means no reminders fire

---

### Edge cases

- SM publishes, then adds a new worker manually → post-publish override writes directly to shift_block_assignments (not draft)
- SM publishes, then tries to re-publish same period → should be a no-op or error (already published)
- Preference submitted for a block_id that doesn't exist → rejected
- Preference submitted for a period whose preference_deadline has passed → rejected
- Worker opts out ("no hours") and later submits preferences before deadline → allowed? (spec §4.1 says opt-out + preference window open → they may still pick up via claiming, implying re-submission should be possible before deadline)
- Publish with zero draft rows → all blocks become vacant (never_assigned)

---

### Test files

1. `supabase/tests/phase-04-preferences.sql` — pgTAP: schema, constraints, deadline enforcement
2. `supabase/tests/phase-04-publish.sql` — pgTAP: publish operation atomicity, vacant creation, draft cleanup
3. `packages/core/tests/phase-04/phase1-grouping.test.ts` — Vitest: card grouping algorithm
4. `tests/PHASE_04/TEST_PLAN.md`

---

### Commit

```
git commit -m "phase-04 tests: preferences, draft schedule, publish atomicity, Phase-1 card grouping algorithm, reminder cron behavior"
```
