# Phase 06 — Float Algorithm: Spec Audit

## Session Metadata

|                     |                                           |
| ------------------- | ----------------------------------------- |
| **Model**           | Claude Opus 4.7 (`claude-opus-4-7`)       |
| **Interface**       | Claude Code CLI                           |
| **Thinking mode**   | Extended thinking — **MAX**               |
| **Skill to invoke** | `engineering:code-review`                 |
| **Priority**        | CRITICAL — do not skip any checklist item |

---

## Prompt

Run a spec-adherence audit on the diff in branch `phase-06-float-algorithm`.

Sources of truth: BEHAVIORAL_SPECIFICATION.md §6 (all sub-sections), ARCHITECTURE.md §5 (all sub-sections).

This phase has the highest invariant density in the codebase. Be thorough.

Report format: ENFORCED / MISSING / DRIFTED / AMBIGUOUS per spec rule.

---

### Checklist

**Harnwell destination:**

- [ ] Algorithm returns empty immediately when destinationHouseId = Harnwell — before ANY eligibility checks
- [ ] There is no code path where a non-Harnwell worker gets assigned to Harnwell via this algorithm

**Source priority:**

- [ ] Quad is evaluated before Harnwell in the source priority loop
- [ ] Quad is FULLY EXHAUSTED (no more eligible workers can cover ≥2 consecutive remaining blocks) before moving to Harnwell
- [ ] 11-single-staff workers are excluded at eligibility check — confirm this is algorithmic (not dependent on float_routing config data)

**Eligibility — hours cap (the most commonly missed rule):**

- [ ] There is NO hours cap check anywhere in the eligibility function
- [ ] The function does not reference `currentWeeklyHours` in an eligibility decision

**Eligibility — source desk floor:**

- [ ] The floor is ONE worker remaining — NOT the required_headcount
- [ ] The tentative counter is used during a SINGLE invocation — selecting floater 1 from Quad already counts against the floor check for floater 2 in the same invocation
- [ ] The tentative counter is in-memory (NOT written to DB mid-algorithm)

**Float exclusions:**

- [ ] Exclusion is based on OVERLAP (any block-level intersection), not full overlap
- [ ] Worker excluded for a DIFFERENT destination house is NOT excluded for this gap
- [ ] Worker excluded for a non-overlapping time window is NOT excluded

**2-block minimum:**

- [ ] Applied at EVERY selection step — including after source priority changes and including tiebreaker resolution
- [ ] A worker who can only cover 1 block is passed over (not assigned) — the block goes to Allied
- [ ] Partial-coverage fallback ALSO enforces 2-block minimum on the leading portion it selects

**Tiebreaker chain — candidate narrowing:**

- [ ] The three checks operate on a SHRINKING candidate set — they do NOT each independently filter the original set
- [ ] Check 1 narrows; if multiple satisfy Check 1, Check 2 runs on the narrowed set
- [ ] Check 3 is truly arbitrary (random or first-in-list) — not a disguised additional filter

**Partial-coverage fallback:**

- [ ] Is invoked ONLY when no worker can cover the full remaining consecutive run
- [ ] Selects the LONGEST LEADING PORTION starting from the FIRST remaining block
- [ ] Is NOT invoked as a tiebreaker (different from old Check 3 behavior)

**Multi-floater tentative counter:**

- [ ] After tentatively assigning floater 1 from Quad (3 workers), the headcount-floor check for floater 2 accounts for floater 1's absence
- [ ] Example: Quad has 3 workers. Floor = 1. Max 2 floaters can be selected (not 3). Verify this is enforced.

**Pure function requirement:**

- [ ] `packages/core/src/float-lookup/` has zero imports from `@supabase/supabase-js` or any DB client
- [ ] Algorithm is deterministic given the same inputs (no random beyond Check 3 arbitrary)

Do NOT make code changes. Report findings only.
