# Phase 10 — Permanent Drop & Pickup: Test Session

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

You are writing tests for Phase 10: Permanent Drop and Permanent Pickup.

Branch: `phase-10-permanent-ops`.

Sources of truth:

- BEHAVIORAL_SPECIFICATION.md §8.4 (all sub-sections)
- ARCHITECTURE.md §7.1 (permanent drop procedure)
- ARCHITECTURE.md §7.2 (permanent pickup procedure)
- AGENTS.md

---

### Behavioral surfaces to cover

**Permanent drop (§8.4.1, ARCHITECTURE.md §7.1):**

- Bulk-updates ALL future recurring-slot occurrences owned by the dropping worker
- Scope: strictly after drop_initiated_at, within current semester (not across winter break into next semester)
- The semester boundary is fetched from `scheduling_periods.end_date` — NOT computed by walking dates
- If scheduling_periods lookup returns no row → reject with error (do NOT silently proceed)
- Excludes: mid-shift blocks (currently being worked), past occurrences this week, weeks owned by someone else
- Excludes: blocks where worker is floated_out or pending_float_out (no-takeback rule — float commitments survive the perm drop)
- UI warning (to test via the confirmation API response): if worker has pending/acknowledged floats within the recurring slot → flag them in the response but do NOT cancel them
- SM of affected house receives in-app notification
- If SM/HM/BM initiates the removal → worker also receives notification

**Permanent pickup (§8.4.3, ARCHITECTURE.md §7.2):**

- Evaluates each future week independently
- Time conflict check per week: skip that week's conflicting blocks (keep non-conflicting)
- Hours cap check per week: if projected hours > cap (hard OR soft) → skip entire week
- Permanent pickup is more conservative than temporary claim: soft cap also causes week skip (not just warning)
- Re-runs checks at transaction time (stale popup defense)
- On confirmation: bulk-update all applicable blocks atomically
- After pickup: slot removed from permanent openings feed regardless of completeness
- Skipped weeks enter weekly feed individually as they approach 30-day horizon

**SM/HM permanent removal (§8.4.2):**

- Same scope logic as permanent drop
- Worker receives notification when SM/HM removes them

---

### Edge cases

- Permanent drop made during a short-break week: the break's dates are excluded (no recurring slot exists for break dates)
- Permanent drop at end of semester: only affects the current semester's dates, not next semester
- Worker drops, then re-picks-up the same slot: allowed if still in permanent openings feed and not claimed by another
- Permanent pickup with ZERO eligible weeks (all conflict or cap): succeeds but affects 0 rows — slot removed from permanent openings feed
- Permanent pickup re-check at transaction time: between popup and submit, another worker temporarily claimed one of the pickup weeks → that week is silently skipped in the transaction
- Worker at soft cap attempting permanent pickup: all weeks over soft cap are SKIPPED (not warned)
- Float commitments: perm drop skips floated_out/pending_float_out blocks — these remain committed

---

### Test files

1. `packages/core/tests/phase-10/drop-scope.test.ts` — Vitest: semester boundary, exclusions, float commitment preservation
2. `packages/core/tests/phase-10/pickup-per-week.test.ts` — Vitest: conflict check, cap check (soft AND hard skip), re-check at transaction time
3. `supabase/tests/phase-10-bulk-ops.sql` — pgTAP: atomicity, correct rows updated, scheduling_periods error on missing row
4. `tests/PHASE_10/TEST_PLAN.md`

---

### Commit

```
git commit -m "phase-10 tests: permanent drop scope/exclusions, permanent pickup per-week checks (soft cap skips), transaction re-check, float commitment preservation"
```
