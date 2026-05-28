# Phase 06 — Float Algorithm: Test Session

## Session Metadata

|                     |                                                                 |
| ------------------- | --------------------------------------------------------------- |
| **Model**           | Claude Opus 4.7 (`claude-opus-4-7`)                             |
| **Interface**       | Claude Code CLI                                                 |
| **Thinking mode**   | Extended thinking — **MAX**                                     |
| **TDD role**        | Test author — write tests only                                  |
| **Skill to invoke** | `engineering:testing-strategy` then `engineering:system-design` |
| **Priority**        | CRITICAL — this is the highest-density spec phase. Do not rush. |

---

## Prompt

You are writing tests for Phase 06: Float Lookup Algorithm.

This is the most algorithmically complex phase. The float algorithm has ~15 interlocking invariants from the spec. Take as long as needed. Use extended thinking at maximum depth.

Branch: `phase-06-float-algorithm`.
Tests live entirely in: `packages/core/tests/phase-06/` (Vitest — pure TypeScript, no DB).

Sources of truth (read in full, multiple passes):

- BEHAVIORAL_SPECIFICATION.md §6 (ALL sub-sections — §6.1 through §6.5)
- ARCHITECTURE.md §5 (ALL sub-sections — §5.1 through §5.5)
- AGENTS.md hard invariants (float direction rules, Harnwell constraint, no-hours-cap-check)

---

### The algorithm you are testing

The float lookup algorithm takes:

- A gap: `{ destinationHouseId, blockIds: string[] }` (contiguous blocks)
- A set of candidates organized by source house with their scheduled assignments
- The current float exclusions (workers excluded from this gap)
- The source priority order from float_routing

It returns: an array of float assignments `{ workerId, blocks: string[] }` — potentially empty.

The algorithm must be implemented as a PURE FUNCTION in `packages/core/src/float-lookup/`. It has NO database calls. The caller (Edge Function or orchestrator) fetches the data and passes it in.

---

### Behavioral surfaces — cover ALL of these

**Source priority:**

- Quad workers are evaluated before Harnwell workers (per float_routing precedence)
- Quad source is fully exhausted before moving to Harnwell
- Workers from the 11 single-staff houses are NEVER eligible — rejected before source priority is evaluated

**Harnwell as destination (short-circuit):**

- If destinationHouseId = Harnwell, the algorithm returns empty immediately (no candidates possible per §1.2 and §6.1)
- Test this explicitly — no floaters can ever reach Harnwell

**Eligibility checks (per §6.1):**

- Source house rules: 11-single-staff workers excluded; Quad workers excluded from Harnwell; Harnwell workers eligible for all
- Source desk floor: at least one worker must remain at source after float. Floor = 1 (not required headcount)
- Worker not already in pending/acknowledged float overlapping the gap window
- Worker not in a cross-house pickup overlapping the gap window
- Worker is_active=true
- Worker does not hold hm or bm role
- Worker not in the float exclusions list for overlapping window at this destination

**Hours cap is NOT checked (§6.1 "Hours cap is not checked at float assignment"):**

- Test this explicitly: a worker at 39h (near 40h hard cap) IS eligible for float
- A worker at 19h (near 20h soft cap) IS eligible for float

**Multi-floater chunking (§6.2):**

- The algorithm divides the gap into 30-min blocks and assigns workers to sub-spans
- Worker assigned to the LARGEST consecutive coverage span available to them
- If multiple workers tie on span length, apply tiebreaker chain (§6.3)
- After assigning a worker, remove covered blocks from the pool and repeat within the same source
- The tentative counter: when selecting floater 1 from Quad (3 workers), the headcount floor check for floater 2 accounts for floater 1 already being tentatively committed (even though not yet written to DB)

**Minimum chunk size — 2 blocks (1 hour) — NON-NEGOTIABLE (§6.2 point 4):**

- A worker who can only cover 1 block (30 min) is NOT assigned. That block goes to Allied.
- This applies at every selection step INCLUDING tiebreakers
- A worker covering 1 block is passed over even if no one else can cover it — Allied fills it

**Partial-coverage fallback (§6.2 point 5):**

- Only triggered when NO worker can cover the full remaining gap
- Fallback: select the worker covering the LONGEST LEADING PORTION from the gap start, minimum 2 blocks
- Allied fills the uncovered tail
- This is NOT a tiebreaker — it's a fallback when no full-gap coverage exists

**Tiebreaker chain (§6.3) — candidate-set narrowing:**

- Candidates begin as ALL workers covering the SAME selected span
- Check 1: worker whose shift starts at exactly the span start → if exactly one, select them; if multiple, narrow to them and continue
- Check 2: within narrowed set, worker whose shift ends at exactly the span end → if one, select; if multiple, narrow and continue
- Check 3: arbitrary from remaining candidates
- This is NOT three separate checks applied independently — it's a NARROWING CHAIN

**Edge cases:**

- No eligible workers anywhere → empty result (entire gap goes to Allied)
- All workers can only cover 1-block spans → empty result (Allied fills all)
- Quad exhausted, remaining gap covered by Harnwell
- Multi-floater scenario: 5-hour gap covered by 2 workers
- Source with 3 workers (Quad) — all 3 eligible — float 2 of them (floor = 1 remaining)
- Source with 2 workers (Harnwell) — float 1 (floor = 1 remaining); second worker ineligible as floater
- Worker whose shift exactly spans the gap — single candidate — check 1 and 2 both satisfy — still select them
- Worker in float_exclusions for a DIFFERENT gap window → NOT excluded for the current window
- Worker in float_exclusions for a non-overlapping window → NOT excluded
- Worker in float_exclusions for an OVERLAPPING window → excluded (any block-level intersection)
- Tentative counter prevents over-floating: Quad with 3 workers, gap needs 3 floaters but floor=1 means max 2 floaters from Quad

---

### Test file structure

`packages/core/tests/phase-06/`:

- `eligibility.test.ts` — all §6.1 eligibility checks in isolation
- `chunking.test.ts` — multi-floater chunking algorithm (various gap sizes, worker distributions)
- `minimum-chunk.test.ts` — exclusively tests the 2-block minimum at every selection step
- `tiebreaker.test.ts` — the candidate-set narrowing chain, all combinations
- `partial-coverage.test.ts` — fallback behavior when no full-gap coverage
- `integration.test.ts` — 8–10 end-to-end scenarios combining multiple rules
- `tests/PHASE_06/TEST_PLAN.md` — CRITICAL: every test name maps to a spec section AND a known trap

**For integration tests, include scenarios like:**

1. 3-hour gap at House-05, Quad has 3 workers, Harnwell has 2 workers → who gets assigned and what span?
2. 1-hour gap, only worker available covers exactly 30 minutes → Allied covers all
3. 4-hour gap, Worker A covers first 2h, Worker B covers last 2h → two float assignments
4. Worker A is in float_exclusions for the 19:00–21:00 window; gap is 20:00–22:00 → A is excluded (overlap at 20:00–21:00)
5. Worker A at 39h weekly (near hard cap) → eligible (cap not checked)

---

### What you are NOT to do

- Do NOT write any implementation code
- Do NOT test DB behavior (no Supabase, no SQL) — this is pure TypeScript
- Do NOT test the orchestrator's decision to call float lookup — only test the algorithm itself

---

### Commit

```
git commit -m "phase-06 tests: float algorithm — eligibility checks, multi-floater chunking, 2-block minimum, tiebreaker chain (candidate-set narrowing), partial-coverage fallback, 8 integration scenarios"
```
