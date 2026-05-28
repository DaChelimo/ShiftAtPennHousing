# Phase 05 — Open Shifts Feed & Claim: Test Session

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

You are writing tests for Phase 05: Open Shifts Feed and Claiming.

Branch: `phase-05-feed-claim`.

Sources of truth (read in full):

- BEHAVIORAL_SPECIFICATION.md §5.1 (open shifts feed — weekly + permanent openings)
- BEHAVIORAL_SPECIFICATION.md §5.2 (dropping a shift — all drop rules)
- BEHAVIORAL_SPECIFICATION.md §5.3 (claiming — cross-house matrix, T-2h cutoff, hours cap)
- BEHAVIORAL_SPECIFICATION.md §5.5 (escalation is one-way, float-drop exception)
- BEHAVIORAL_SPECIFICATION.md §5.6 (Shifts screen — 3-tab layout)
- BEHAVIORAL_SPECIFICATION.md §9 (hours — attribution, weekly window, caps)
- AGENTS.md

---

### Behavioral surfaces to cover

**Weekly feed visibility:**

- A vacant shift within 30 days appears in the weekly feed for the correct house
- A vacant shift more than 30 days away does NOT appear in the weekly feed (held until horizon)
- A shift that crosses T-2h becomes unpickable (still visible but not claimable)
- `vacancy_origin='permanent_drop'` shifts appear in BOTH the weekly feed AND the permanent openings feed

**Permanent openings feed:**

- Shows recurring slots with vacancy_origin='permanent_drop' grouped by (house, day-of-week, block-start-time)
- Visible to all SWs of the affected house regardless of broadcast subscription
- Visible to eligible cross-house workers per the matrix below
- Disappears when a worker permanently picks it up (covered in phase-10)
- Disappears when the operating profile ends

**Temporary drop:**

- Worker can drop any assigned shift (or contiguous portion, in 30-min chunks)
- Drop within 20 minutes of shift start → allowed with warning
- Mid-shift drop (drop-from-now): rounds DOWN to nearest 30-min boundary
- Mid-shift drop (forward-future): worker selects a future chunk explicitly
- Dropped shift enters weekly feed only if ≤30 days away; otherwise held
- Escalation timing is based on the gap's START time, not the drop time
- Gap with start >2h away: enters weekly feed, T-3h/T-2h chain applies
- Gap with start <2h away: goes directly to HMOD for Allied (skip broadcast + float lookup)
- Escalation fires ONLY if below required headcount — overstaffed desks produce no escalation

**Claiming (temporary):**

- In-house claim: worker claims a shift at their home house
- Cross-house claim: worker claims at an eligible non-home house per matrix
- Claim blocked at or after T-2h (strictly before T-2h succeeds; at T-2h fails)
- Claim rejected if it would create a time conflict (worker already assigned that block)
- Claim rejected if it would push worker over hard cap (40h)
- Soft cap (20h) triggers a warning but does NOT block the claim
- Hours from cross-house pickup count at the worker's HOME house
- Race condition: two workers claim same shift simultaneously → first succeeds, second gets error

**Cross-house eligibility matrix:**

- Harnwell worker: can pick up at Quad + all 11 single-staff houses
- Quad worker: can pick up at all 11 single-staff houses only (NOT Harnwell)
- Single-staff worker: can pick up at Quad + the other 10 single-staff houses (NOT Harnwell)
- Worker at any non-Harnwell house attempting to claim a Harnwell shift → rejected

**Hours calculation:**

- Weekly hours = count of assigned blocks × 0.5, scoped to Monday 00:00 – Sunday 23:59
- Float-out hours count at home house (not excluded from cap calc)
- Cross-house pickup hours count at home house
- Hard cap: claim, swap, pickup BLOCKED if it would exceed 40h
- Soft cap: claim, swap, pickup WARNED (but allowed) if it would exceed 20h

**Shifts screen (3-tab layout):**

- Tab 1 (My Shifts): picked-up shifts (top), dropped shifts still open (middle), regular scheduled shifts (bottom)
- Tab 2 (Home house feed): weekly + permanent openings for home house
- Tab 3 (Other houses): feeds for each eligible non-home house per matrix
- Tab 3 is empty during winter break for all non-Harnwell workers (only Harnwell operates)

---

### Edge cases

- Claim at exactly T-2h (boundary): rejected
- Claim at T-2h minus 1 second: succeeds (if still available)
- Worker drops a shift they've already floated out — the float destination triggers re-escalation (BEHAVIORAL_SPEC §5.5 float-drop exception)
- Worker drops, then immediately reclaims their own dropped shift (allowed if no one else claimed it)
- Drop of a shift more than 30 days away → held; NOT immediately in weekly feed
- Soft cap at 19.5h + claim of 1 block (0.5h) → 20h exactly (no warning — 20h is the cap, not over)
- Soft cap at 20h + claim of 1 block → 20.5h → warning displayed, claim allowed
- Hard cap at 40h + any claim → rejected regardless of SM/HM

---

### Test files

1. `supabase/tests/phase-05-feed-queries.sql` — pgTAP: weekly feed query correctness, permanent openings query, 30-day horizon filter, T-2h unpickable
2. `supabase/tests/phase-05-claim.sql` — pgTAP: claim function atomic behavior, race condition (advisory lock or serializable test), cap enforcement at DB level
3. `packages/core/tests/phase-05/hours.test.ts` — Vitest: weekly hours calculation, cap check functions
4. `packages/core/tests/phase-05/cross-house-eligibility.test.ts` — Vitest: full eligibility matrix, all 3 home-house types × all destination types
5. `tests/PHASE_05/TEST_PLAN.md`

---

### Commit

```
git commit -m "phase-05 tests: open shifts feed, 30-day horizon, T-2h cutoff, claim eligibility, cross-house matrix, hours cap enforcement, race condition"
```
