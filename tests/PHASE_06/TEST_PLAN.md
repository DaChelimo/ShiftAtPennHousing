# Phase 06 — Test Plan: The Float Lookup Algorithm

This plan enumerates every test for phase-06, the spec section each
test covers, and the ambiguities surfaced and resolved before
implementation.

The float lookup algorithm has ~15 interlocking invariants from BSpec
§6 and ARCH §5. The test suite is structured to lock each invariant
down independently, then exercise them together in integration
scenarios. Where the spec admits more than one reading, the choice is
documented in the **Pinned Decisions** table below and reinforced in
the test bodies.

Sources of truth:

- `BEHAVIORAL_SPECIFICATION.md` §1.2 (absolute float-direction rules),
  §3.5 (source-desk floor accounting),
  §6.1 (eligibility bullets),
  §6.2 (multi-floater chunking),
  §6.3 (tiebreaker chain — candidate-set narrowing),
  §6.4 (no-takeback rule — out of scope for this phase but referenced)
- `ARCHITECTURE.md` §1.5 (algorithmic invariants),
  §3.4 (`float_assignments` schema),
  §3.8 (`float_exclusions` overlap-based exclusion),
  §5.1 – §5.5 (the algorithm itself)
- `AGENTS.md` hard invariants 1 (Harnwell training), 2 (float
  direction), 3 (no-takeback), 4 (no hours cap on float)

Test files (all Vitest, pure TypeScript, no Supabase, no SQL):

- `packages/core/tests/phase-06/fixtures.ts` — shared types + factories
  (`makeGap`, `makeCandidate`, `makeSourceRoster`, `makeExclusion`,
  `makeInput`, `assignmentByWorker`, `uncoveredBlockIds`)
- `packages/core/tests/phase-06/eligibility.test.ts` — every §6.1
  eligibility check in isolation (~30 cases)
- `packages/core/tests/phase-06/chunking.test.ts` — multi-floater
  chunking topologies (~12 cases)
- `packages/core/tests/phase-06/minimum-chunk.test.ts` — exclusively
  exercises the 2-block minimum at every selection step (~12 cases)
- `packages/core/tests/phase-06/tiebreaker.test.ts` — §6.3 candidate-set
  narrowing chain, all combinations (~12 cases)
- `packages/core/tests/phase-06/partial-coverage.test.ts` — fallback
  behavior when no worker covers the full uncovered run (~8 cases)
- `packages/core/tests/phase-06/integration.test.ts` — 12 end-to-end
  scenarios combining multiple rules

---

## The Function Contract (TDD-first)

The implementation goes in `packages/core/src/float-lookup/`. Until
the implementation lands, every test fails at the module import — that
is the intended TDD-red state.

```ts
// packages/core/src/float-lookup/types.ts
export type HouseId = string;
export type UserId = string;
export type BlockId = string;
export type WorkerRole = 'sw' | 'sm' | 'hm' | 'bm';

export type GapBlock = {
  blockId: BlockId;
  blockStartAt: Date;
};

export type FloatGap = {
  destinationHouseId: HouseId;
  blocks: GapBlock[]; // contiguous, chronological, 30-min spacing
};

export type FloatCandidate = {
  userId: UserId;
  homeHouseId: HouseId;
  isActive: boolean;
  roles: WorkerRole[];
  // gap-block ids covered by this candidate's source schedule
  coveredGapBlockIds: BlockId[];
  // contiguous source-shift bounds (for §6.3 alignment checks)
  shiftStartAt: Date;
  shiftEndAt: Date;
  // §6.1 conflict flags, pre-computed by the caller for this gap window:
  hasConflictingFloat: boolean;
  hasConflictingCrossHousePickup: boolean;
};

export type SourceHouseRoster = {
  sourceHouseId: HouseId;
  precedenceOrder: number; // lower = checked first
  candidates: FloatCandidate[];
  // post-pre-committed-absences headcount per gap block; the floor
  // check uses min(effectiveHeadcount[b]) over the candidate's span
  // minus the per-source global tentative counter (see pinned-decision #1).
  effectiveHeadcountByBlockId: Record<BlockId, number>;
};

export type FloatExclusion = {
  userId: UserId;
  destinationHouseId: HouseId;
  windowStartAt: Date;
  windowEndAt: Date;
};

export type FloatLookupInput = {
  gap: FloatGap;
  sources: SourceHouseRoster[];
  exclusions: FloatExclusion[];
};

export type FloatAssignment = {
  workerId: UserId;
  blocks: BlockId[]; // chronologically ordered subset of gap.blocks
};
```

```ts
// packages/core/src/float-lookup/index.ts
export function runFloatLookup(input: FloatLookupInput): FloatAssignment[];
```

The function is PURE: no I/O, no database, no random number generation,
no clock reads. The caller is responsible for snapshotting all the
relevant DB state into `FloatLookupInput`.

---

## Pinned Decisions

The behavioral spec and architecture document leave several
implementation choices implicit. The decisions below are pinned by
the test suite — the implementation MUST match them, and any future
reinterpretation requires updating both the tests and this plan.

| #   | Topic                                                                                           | Decision                                                                                                                                                                                                                                                                                                                               | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Tentative counter scope                                                                         | **GLOBAL per source**, not per-block. After each selection, increment a single counter on the source; the floor check is `min(effectiveHeadcount[b]) over span − globalCount ≥ 2`.                                                                                                                                                     | BSpec §6.2 worked example explicitly increments a single counter per selection regardless of block coverage ("first floater… counter = 1 → second floater… counter = 2 → third worker ineligible"). ARCH §5.2 step 3d uses "per-block" language but the worked example only holds under GLOBAL accounting (per-block would admit a 3rd disjoint-span floater). When the spec wording and worked example diverge, the test suite locks the spec's operational behavior. |
| 2   | Multi-seat gaps                                                                                 | **NOT MODELED** in this phase. The gap input shape is a flat list of `BlockId`s, one seat per block. Multi-headcount destination blocks (where the same time slot has multiple vacant seats) are out of scope for this algorithm; the orchestrator invokes the algorithm separately per seat or aggregates a higher-level abstraction. | The user's prompt spec'd the gap as `{ destinationHouseId, blockIds: string[] }` — a flat list. Modeling multi-seat would require either per-time deduplication on the candidate side ("worker can fill at most one seat per time slot") or seat-aware coverage. Deferred to a later phase.                                                                                                                                                                            |
| 3   | Position preference when multiple workers cover spans of the same length at DIFFERENT POSITIONS | **EARLIEST-STARTING span wins**, then the §6.3 tiebreaker resolves within the same-span candidate set.                                                                                                                                                                                                                                 | The partial-coverage fallback (§6.2 #5) explicitly prefers the "longest leading portion from the gap's start"; that preference for leading positions extends naturally to regular chunking when length is tied. Without this convention, the algorithm would have an under-specified position choice — undesirable for a pure function.                                                                                                                                |
| 4   | "Arbitrary" tiebreaker (§6.3 Check 3)                                                           | **Must be DETERMINISTIC** for a given input. Two calls with the same input MUST return the same worker. The spec wording "arbitrary" means "no spec guarantee about which one," NOT "non-deterministic."                                                                                                                               | The algorithm is pure (no clock, no random). Determinism is a function-purity invariant, tested in `tiebreaker.test.ts`.                                                                                                                                                                                                                                                                                                                                               |
| 5   | Check-1 / Check-2 chain with ZERO satisfiers                                                    | When a check has zero satisfiers in the current candidate set, the set is **NOT** narrowed (narrowing to ∅ would empty the set); the algorithm advances to the next check on the existing set.                                                                                                                                         | BSpec §6.3 explicit only on "exactly one" (select) and "multiple" (narrow). Zero is implicit; the natural reading is "no-op, advance." Tested in `tiebreaker.test.ts` (Check 1 zero → Check 2 runs on full set; Check 2 zero → Check 3 runs on Check 1's narrowed set).                                                                                                                                                                                                |
| 6   | Exclusion overlap semantics                                                                     | A `float_exclusion` window `[startAt, endAt)` excludes the worker iff `windowStartAt < gapEndAt` AND `windowEndAt > gapStartAt`. Abutting windows (`windowEndAt == gapStartAt` OR `windowStartAt == gapEndAt`) do NOT overlap (they share no block). The destination house must match.                                                 | BSpec §6.1: "any block-level intersection, however small; full overlap is not required." A 30-minute block is the atomic unit; abutting windows share no block. Tested in `eligibility.test.ts`.                                                                                                                                                                                                                                                                       |
| 7   | Source-desk floor                                                                               | `floor = 1` (the absolute minimum worker), NOT the staffing pattern's `required_headcount`. The check is "leaves at least one worker remaining after this candidate floats," independent of how many the desk normally has.                                                                                                            | BSpec §6.1; ARCH §5.2 step 3a explicit.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 8   | Hours cap                                                                                       | NOT in the function signature. The implementation MUST NOT read any cap field; a worker at 39h / 19.5h / any value is eligible if other conditions hold.                                                                                                                                                                               | BSpec §6.1, AGENTS hard invariant #4. Tested in `eligibility.test.ts` and `integration.test.ts` (Scenario 5).                                                                                                                                                                                                                                                                                                                                                          |
| 9   | HM/BM role exclusion                                                                            | `hm` and `bm` are both excluded from the candidate pool, even when the worker also holds `sw` or `sm`. The HM may work scheduled shifts but is never a float source; the BM holds no shift assignments at all.                                                                                                                         | BSpec §6.1; ARCH §3.1, §5.2 step 1. Tested in `eligibility.test.ts`.                                                                                                                                                                                                                                                                                                                                                                                                   |
| 10  | Harnwell as destination                                                                         | Algorithm returns empty IMMEDIATELY, before evaluating any candidates. Even when Harnwell candidates are supplied who could cover the gap, the empty short-circuit applies. Off-duty Harnwell workers route through the weekly feed, not float lookup.                                                                                 | BSpec §6.1: "the float lookup for a Harnwell vacancy returns no candidates." Tested in `eligibility.test.ts` and `integration.test.ts` (Scenario 12).                                                                                                                                                                                                                                                                                                                  |
| 11  | 11-single-staff workers as source                                                               | NEVER eligible as a float source. The algorithm enforces this independently of `float_routing` — if the caller mis-built a roster with a single-staff house as `sourceHouseId`, the algorithm rejects every candidate in it.                                                                                                           | AGENTS hard invariant #2; BSpec §1.2 absolute. Tested in `eligibility.test.ts`.                                                                                                                                                                                                                                                                                                                                                                                        |
| 12  | Source precedence                                                                               | Algorithm sorts the `sources` array by `precedenceOrder` ASCENDING. Quad's `float_routing` row has `precedenceOrder = 1`; Harnwell's has `precedenceOrder = 2`. The algorithm does NOT trust the array order the caller passed in.                                                                                                     | ARCH §5.2 step 2 explicit. Tested in `eligibility.test.ts` ("source priority — Quad before Harnwell").                                                                                                                                                                                                                                                                                                                                                                 |
| 13  | Partial-coverage fallback selection criterion                                                   | When no worker covers the full largest-consecutive uncovered run, fallback fires. The criterion CHANGES from "largest consecutive coverage anywhere" to "longest leading portion from the run's start." A worker with longer NON-leading coverage can LOSE to a worker with shorter LEADING coverage under fallback.                   | BSpec §6.2 #5: "select the worker who can cover the _longest leading portion_…" Locked in `partial-coverage.test.ts` ("longest LEADING portion, not largest coverage anywhere").                                                                                                                                                                                                                                                                                       |
| 14  | 2-block minimum precondition for tiebreaker                                                     | A candidate whose coverage of the selected span is less than 2 blocks is NEVER in the candidate set for the §6.3 tiebreaker. The minimum is checked BEFORE the tiebreaker chain runs, not as an after-the-fact filter.                                                                                                                 | ARCH §5.3: "precondition for being in the candidate set." Locked in `minimum-chunk.test.ts` and `tiebreaker.test.ts`.                                                                                                                                                                                                                                                                                                                                                  |
| 15  | Function output type                                                                            | Returns `FloatAssignment[]` (possibly empty). NO Allied request is returned — the caller derives the uncovered tail by subtracting assigned blocks from the gap. (Test helper `uncoveredBlockIds(gap, result)` does this.)                                                                                                             | User's prompt explicit: "It returns: an array of float assignments `{ workerId, blocks: string[] }` — potentially empty." Allied procurement is the orchestrator's downstream concern.                                                                                                                                                                                                                                                                                 |

---

## Test-Name → Spec-Section → Known-Trap Mapping

Every test below maps to: a spec section that justifies the assertion,
and the specific reading mistake or under-specified corner the test
locks down.

### `eligibility.test.ts`

| Test name                                                                                                                    | Spec                                                                                 | Known trap                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `a Quad worker is an eligible source for a non-Harnwell destination`                                                         | BSpec §1.2                                                                           | — baseline                                                                                                                                                                                                                |
| `a Harnwell worker is an eligible source for any non-Harnwell destination`                                                   | BSpec §1.2                                                                           | — baseline                                                                                                                                                                                                                |
| `a Harnwell worker is an eligible source for Quad as destination`                                                            | BSpec §1.2                                                                           | Harn → Quad sometimes overlooked because §1.2 phrasing emphasizes the asymmetry (only Quad ↔ 11-houses) — Harn → Quad is permitted                                                                                        |
| `a worker from %s (single-staff) is NEVER eligible as a float source`                                                        | BSpec §1.2 + AGENTS #2                                                               | Implementer trusts `float_routing` config alone; spec mandates algorithmic enforcement INDEPENDENT of config (a misconfigured row must not bypass the rule)                                                               |
| `Quad workers MAY NOT float to Harnwell (destination invariant)`                                                             | BSpec §1.2 + AGENTS #1                                                               | Same — algorithmic enforcement vs config-only                                                                                                                                                                             |
| `returns empty even when a Harnwell candidate could cover the gap`                                                           | BSpec §6.1 (Harnwell-as-destination)                                                 | Implementer treats Harnwell-as-destination as "process candidates, find Harn worker covers"; spec mandates short-circuit (no candidate is EVER returned for Harnwell — off-duty Harn workers use the weekly feed instead) |
| `returns empty for Harnwell destination even with Quad + Harnwell rosters supplied`                                          | BSpec §6.1                                                                           | Same — destination short-circuit ignores all input rosters                                                                                                                                                                |
| `rejects the sole eligible candidate when the source has only 1 worker on shift`                                             | BSpec §6.1 + ARCH §5.2.3a                                                            | Implementer reads "floor = headcount" instead of "floor = 1 absolute"; 1 - 1 = 0 < 1 → reject                                                                                                                             |
| `admits the candidate when the source has 2 workers on shift`                                                                | Same                                                                                 | — boundary check (2 - 1 = 1, equal to floor — admit)                                                                                                                                                                      |
| `Harnwell with 2 workers on shift admits exactly 1 floater`                                                                  | Same                                                                                 | After 1st: globalCount = 1; 2 - 1 = 1 < 2 → second rejected                                                                                                                                                               |
| `Quad with 3 workers, gap requires 3 disjoint floaters → only 2 selected; 3rd rejected by the source-wide tentative counter` | BSpec §6.2 worked ex. + PINNED #1                                                    | The pinned global vs per-block question — under per-block, all 3 would be admitted because spans don't overlap                                                                                                            |
| `Harnwell with 2 workers and a 4-block gap covered by disjoint pairs → only 1 floater selected`                              | BSpec §6.2 worked ex. + PINNED #1                                                    | Same                                                                                                                                                                                                                      |
| `excludes a candidate already in a pending or acknowledged float overlapping the gap`                                        | BSpec §6.1                                                                           | "Already in a float" is gap-window-relative; an old float that doesn't overlap is irrelevant                                                                                                                              |
| `returns empty when ALL otherwise-eligible candidates have a conflicting float`                                              | BSpec §6.1                                                                           | — coverage check                                                                                                                                                                                                          |
| `excludes a candidate with an overlapping cross-house pickup`                                                                | BSpec §6.1                                                                           | A cross-house picker at house X is at X for headcount but is NOT floatable from X                                                                                                                                         |
| `excludes an inactive (deactivated/fired) candidate`                                                                         | BSpec §6.1 + ARCH §3.1 (`is_active` invariant)                                       | Stale fixture forgets to set `isActive: true` and silently passes due to truthy default                                                                                                                                   |
| `excludes a candidate who holds the hm role`                                                                                 | BSpec §6.1; ARCH §3.1, §5.2 step 1                                                   | Implementer treats HMs as SW-eligible because they appear in the worker roster — but the HM/SW union is excluded                                                                                                          |
| `excludes a candidate who holds the bm role`                                                                                 | Same                                                                                 | BMs hold no shift assignments at all; they should never have appeared in the roster, but defense-in-depth says: reject if seen                                                                                            |
| `an SM (not HM/BM) is eligible — SMs are workers and may be floated`                                                         | BSpec §2.2                                                                           | Implementer over-excludes SMs (they have admin powers, easily confused with HMs)                                                                                                                                          |
| `an excluded worker with a window that contains the gap entirely is excluded`                                                | BSpec §6.1 + ARCH §3.8                                                               | — baseline overlap                                                                                                                                                                                                        |
| `an excluded worker with a 30-min partial overlap at the gap start IS excluded`                                              | Same                                                                                 | "Block-level intersection, however small" — 1-block overlap is enough                                                                                                                                                     |
| `an excluded worker with a 30-min partial overlap at the gap end IS excluded`                                                | Same                                                                                 | Same on the trailing side                                                                                                                                                                                                 |
| `a NON-OVERLAPPING exclusion window (entirely before the gap) does NOT exclude`                                              | Same                                                                                 | Trap: implementer accidentally compares window-start to gap-start with `<=`, treating "yesterday's decline" as still excluding                                                                                            |
| `an exclusion that ABUTS the gap end (windowEnd == gapStart) does NOT overlap`                                               | BSpec §6.1 + PINNED #6                                                               | The half-open interval semantics — abutting windows share no block, so no intersection                                                                                                                                    |
| `an exclusion at a DIFFERENT destination house does NOT exclude`                                                             | BSpec §6.1: "Exclusions for declines at _different_ destination houses…do not apply" | Trap: implementer matches only on `userId` and window, forgetting destination-house scope                                                                                                                                 |
| `an exclusion for a DIFFERENT user does NOT exclude this candidate`                                                          | ARCH §3.8                                                                            | — baseline scope check                                                                                                                                                                                                    |
| `a candidate near the 40h hard cap IS still eligible to float`                                                               | BSpec §6.1 + AGENTS #4                                                               | Implementer (or future implementer) adds a "safety cap check" that breaks float invariant                                                                                                                                 |
| `a candidate near the 20h soft cap IS still eligible to float`                                                               | Same                                                                                 | Same                                                                                                                                                                                                                      |
| `Quad is exhausted FIRST: a Quad candidate is preferred over an equally-eligible Harnwell candidate`                         | BSpec §6.2 #1 + ARCH §5.2.2 + PINNED #12                                             | Algorithm trusts caller's array order; spec mandates sort by precedenceOrder                                                                                                                                              |
| `Harnwell is consulted only AFTER Quad cannot cover the remaining uncovered blocks`                                          | Same                                                                                 | — multi-source flow                                                                                                                                                                                                       |
| `returns empty when neither source has an eligible candidate`                                                                | ARCH §5.5 (edge case)                                                                | — baseline                                                                                                                                                                                                                |
| `the assigned blocks for a single floater are returned in chronological order`                                               | Output shape                                                                         | — output contract                                                                                                                                                                                                         |

### `chunking.test.ts`

| Test name                                                                                                         | Spec                                  | Known trap                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `one Quad worker covering the entire gap is assigned the entire span`                                             | BSpec §6.2 #2                         | — baseline                                                                                                                   |
| `the worker with the LONGEST consecutive coverage wins over a shorter-coverage worker`                            | Same                                  | — baseline                                                                                                                   |
| `a candidate whose schedule includes blocks OUTSIDE the gap covers only the gap-overlap`                          | BSpec §6.5 (planned handoff)          | Implementer assigns blocks beyond the gap to the floater (the float window is bounded by the gap, not by the worker's shift) |
| `5-hour gap covered by two Harnwell workers (2h + 3h)`                                                            | BSpec §6.2 worked example verbatim    | — canonical scenario                                                                                                         |
| `after the first floater is assigned, remaining UNCOVERED blocks drive the next iteration within the same source` | BSpec §6.2 #2 (iterative)             | Algorithm stops after the first selection; spec mandates iteration until no run ≥ 2 blocks remains                           |
| `cross-source: Quad exhausts first, Harnwell covers the remaining tail`                                           | BSpec §6.2 #3                         | — cross-source iteration                                                                                                     |
| `Quad with 3 workers, gap split into 3 disjoint 2-block runs → only 2 selected`                                   | BSpec §6.2 worked example + PINNED #1 | Per-block counter would admit 3 (disjoint spans); GLOBAL counter halts at 2                                                  |
| `tentative counter is per-source: Quad uses up its quota; Harnwell still has its own`                             | ARCH §5.2 step 3d (per-source)        | Implementer might share the counter across sources, breaking the cross-source quota independence                             |
| `disjoint sub-spans at Harnwell (headcount 2) still bind the global counter — only 1 floater`                     | PINNED #1                             | Pinned-decision regression test                                                                                              |
| `returns empty when no candidates exist at any source`                                                            | ARCH §5.5                             | — baseline                                                                                                                   |
| `returns empty when no source houses are supplied at all`                                                         | Defensive                             | The algorithm must handle an empty `sources` array without throwing                                                          |
| `a per-block headcount that varies across the gap is respected on a per-block basis`                              | ARCH §5.2 step 3a                     | The floor check considers ALL blocks in the candidate's span (the minimum), not just the first block                         |
| `a per-block headcount of 1 on ANY block in the candidate's span rejects the candidate`                           | Same                                  | Trap: implementer only checks the first block, missing a low-headcount block in the middle                                   |

### `minimum-chunk.test.ts`

| Test name                                                                                                  | Spec                         | Known trap                                                                                                   |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `a sole candidate whose largest consecutive coverage is 1 block is NOT assigned`                           | BSpec §6.2 #4                | Implementer assigns the 1-block worker rather than letting Allied take it ("a worker is better than Allied") |
| `two single-block-coverage candidates are BOTH rejected`                                                   | Same                         | Same                                                                                                         |
| `a candidate with non-contiguous 1-block coverage at multiple gap positions is rejected`                   | Same                         | "Largest consecutive" — sum of coverage isn't the metric                                                     |
| `a candidate with EXACTLY 2 consecutive blocks of coverage IS assigned (inclusive)`                        | Same — boundary              | Boundary check: 2-block minimum is INCLUSIVE on 2                                                            |
| `after worker A takes the long run, worker B with only 1 remaining uncovered block is rejected`            | BSpec §6.2 #4 (iterative)    | Implementer only enforces minimum on initial selection, not on iterations after coverage shrinks             |
| `iteration halts when remaining uncovered runs are all sub-minimum`                                        | Same                         | Algorithm loops forever or recurses incorrectly when nothing more can be assigned                            |
| `Quad covers [0..3] of a 5-block gap; Harnwell candidate covers only [4]; left to Allied`                  | BSpec §6.2 #4 + cross-source | Minimum applies cross-source too — Harnwell's 1-block candidate isn't promoted to "the only option" status   |
| `a 1-block-covering worker is NOT in the candidate set for tiebreaker against 2-block-covering workers`    | ARCH §5.3 precondition       | Implementer applies the minimum as an after-the-fact filter; spec says precondition for the candidate set    |
| `when no worker covers a full run AND the longest leading portion is only 1 block, no floater is selected` | BSpec §6.2 #4 + #5           | Trap: implementer's fallback uses "best available, no minimum"                                               |
| `a 2-block longest leading portion IS taken in the partial-coverage fallback`                              | Same — boundary              | — boundary check for fallback                                                                                |
| `chunking leaves 1-block holes for Allied`                                                                 | BSpec §6.2 #4 + iterative    | — composite scenario                                                                                         |

### `tiebreaker.test.ts`

| Test name                                                                                                                       | Spec                              | Known trap                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exactly one Check-1 satisfier is selected (no need to advance to Check 2)`                                                     | BSpec §6.3 #1                     | — baseline                                                                                                                                                                                   |
| `Check 1 takes effect even when a different worker uniquely satisfies Check 2 (chain semantics — NOT independent checks)`       | BSpec §6.3 chain                  | THE main trap. A naive reading: "apply each check independently and pick whoever uniquely matches" — wrong. The chain narrows; once Check 1 produces a single satisfier, the algorithm halts |
| `multiple Check-1 satisfiers narrow the candidate set; Check 2 then breaks the tie`                                             | BSpec §6.3 narrowing              | — chain semantics                                                                                                                                                                            |
| `zero Check-1 satisfiers leaves the candidate set UNNARROWED; Check 2 runs on the full set`                                     | BSpec §6.3 (implicit) + PINNED #5 | Implementer narrows to ∅ and crashes; pinned decision = "no-op, advance"                                                                                                                     |
| `among Check-1 satisfiers, exactly one Check-2 satisfier wins`                                                                  | BSpec §6.3 #2                     | — baseline                                                                                                                                                                                   |
| `multiple Check-2 satisfiers within the narrowed set → narrow further and Check 3 picks from THOSE`                             | BSpec §6.3 narrowing              | The narrowed Check-2 set is the input to Check 3 — NOT the original Check-1 narrowed set                                                                                                     |
| `zero Check-2 satisfiers in the narrowed set leaves the set unchanged; Check 3 picks arbitrarily from the Check-1 narrowed set` | PINNED #5                         | Same trap as zero Check-1 satisfiers — no-op, advance                                                                                                                                        |
| `zero Check-1 AND zero Check-2 satisfiers → arbitrary from the full eligible set covering the span`                             | PINNED #5                         | — combined no-op case                                                                                                                                                                        |
| `the algorithm makes SOME deterministic choice (calling it twice with the same input returns the same worker)`                  | PINNED #4                         | "Arbitrary" misread as "random" — function purity violated                                                                                                                                   |
| `single candidate whose shift exactly spans the gap is selected — both checks satisfy trivially`                                | BSpec §6.3                        | Implementer's no-tie path skips the tiebreaker chain and crashes on the "trivial pass" case                                                                                                  |
| `a worker covering a SHORTER consecutive span is NOT in the tiebreaker candidate set against full-coverage workers`             | BSpec §6.3 (same-span constraint) | — scope of the tiebreaker candidate set                                                                                                                                                      |

### `partial-coverage.test.ts`

| Test name                                                                                                                    | Spec                                                                                  | Known trap                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `does NOT fire when a worker covers the full gap (regular chunking succeeds)`                                                | BSpec §6.2 #5 (fires only when no full coverer)                                       | Implementer applies fallback unconditionally on every iteration                                                                    |
| `FIRES when no worker covers the full gap; selects the longest leading-portion worker`                                       | BSpec §6.2 #5                                                                         | — baseline fallback                                                                                                                |
| `a worker with longer NON-leading coverage loses to a worker with shorter LEADING coverage when fallback fires`              | BSpec §6.2 #5 + PINNED #13                                                            | THE main trap. Fallback's criterion REPLACES regular-chunking's criterion; it is NOT a tiebreaker that runs after regular chunking |
| `among multiple leading-portion-coverers, the one with the LONGEST leading run wins`                                         | BSpec §6.2 #5                                                                         | — baseline                                                                                                                         |
| `two workers tie on leading-portion length → §6.3 tiebreaker applies (Check 1)`                                              | BSpec §6.2 #5 ("If multiple workers tie on that portion, apply the tiebreaker chain") | Fallback ties have a tiebreaker too; implementer might pick arbitrarily without applying §6.3                                      |
| `a worker whose leading-portion length is only 1 block is NOT selected by fallback`                                          | BSpec §6.2 #4 + #5                                                                    | Implementer relaxes the 2-block minimum in fallback ("partial is partial — half a loaf is better than none")                       |
| `Quad worker has no leading coverage; Harnwell worker has 4-block leading coverage → Quad fallback empty, Harnwell selected` | BSpec §6.2 #3 + #5                                                                    | Quad's trailing-coverage candidate is NOT selected for [b2,b3] under fallback — the criterion is leading portion                   |
| `after iteration 1 leaves an interior uncovered run, fallback in iteration 2 uses THAT run's start as the leading reference` | BSpec §6.2 #5: "the current uncovered run"                                            | Implementer keeps using the original gap.start for fallback rather than the current run's start                                    |

### `integration.test.ts`

| Test name                                                                     | Combines                                                            |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `Scenario 1 — 3-hour gap at House-05; Quad covers it`                         | Source precedence + full-coverage selection                         |
| `Scenario 2 — sub-minimum coverage; whole gap goes to Allied`                 | 2-block minimum + Allied tail                                       |
| `Scenario 3 — multi-floater split coverage (2h + 2h)`                         | Multi-floater chunking + iterative coverage                         |
| `Scenario 4 — partial-overlap float_exclusion excludes the worker`            | Exclusion overlap (1-block intersection) + cross-candidate fallback |
| `Scenario 5 — hours cap is not consulted on float`                            | AGENTS hard invariant #4                                            |
| `Scenario 6 — HM-role worker at the source is excluded`                       | Role-based exclusion                                                |
| `Scenario 7 — multi-candidate full coverage; §6.3 Check 1 breaks the tie`     | Tiebreaker chain in a realistic scenario                            |
| `Scenario 8 — Quad has no candidates; Harnwell covers the entire gap`         | Source-precedence fallthrough                                       |
| `Scenario 9 — interior 1-block hole goes to Allied`                           | 2-block minimum + multi-floater + Allied                            |
| `Scenario 10 — no candidates anywhere; entire gap → Allied`                   | Empty-input edge case                                               |
| `Scenario 11 — exclusion at a different destination does not affect this gap` | Exclusion destination-scope                                         |
| `Scenario 12 — Harnwell as destination returns empty regardless of pool`      | Harnwell short-circuit                                              |

---

## What is OUT of Scope for Phase-06 Tests

These are intentionally NOT covered by this test suite, deferred to
later phases:

- **Force-trigger path (§6.6).** The algorithm has the same shape
  whether invoked from standard T-2h escalation or a force-trigger.
  Force-trigger-specific concerns (initiator authorization, T-2h
  cutoff for the request itself, profile gate) are tested in the
  endpoint phase.
- **Pending-float source-side reconciliation (§6.6.5, §6.6.7).** The
  source-side gap that opens when a pending floater is committed —
  and the decline-time reconciliation when the source-side slot has
  since been claimed — are orchestrator concerns. The algorithm
  doesn't reason about them.
- **No-takeback enforcement (§6.4).** The algorithm has nothing to
  recall; "no takeback" is enforced by the orchestrator NOT calling
  the algorithm with a worker who already holds a committed float.
  The algorithm's `hasConflictingFloat` flag enforces this from the
  algorithm's perspective.
- **Acknowledgment cadence (§7).** Notifications and reminders are
  computed at float-assignment time and stored on the
  `notifications` table — outside this algorithm.
- **Multi-seat destination blocks** (per PINNED #2). The algorithm
  operates on single-seat gaps. Multi-seat handling is orchestrator-
  side aggregation.
- **The `pending_float_out` materialization on commit.** ARCH §5.2
  step 3d notes that the in-memory tentative counter is materialized
  to `pending_float_out` rows when the transaction commits. The
  algorithm itself only produces in-memory `FloatAssignment`
  records; the caller writes them.

---

## How to run

```bash
# Vitest — will FAIL at module import until
# packages/core/src/float-lookup/{index,types}.ts exists (TDD-first).
pnpm --filter @shift/core test
```

When the implementation lands, expected counts (approximate):

- `eligibility.test.ts`: ~30 cases pass
- `chunking.test.ts`: ~13 cases pass
- `minimum-chunk.test.ts`: ~11 cases pass
- `tiebreaker.test.ts`: ~12 cases pass
- `partial-coverage.test.ts`: ~8 cases pass
- `integration.test.ts`: 12 scenarios pass

Total: ~86 Vitest cases for phase-06.

---

## Implementation Notes for the Phase-06 Implementer

These are not part of the test contract but explain the rationale for
the test structure, so the implementation can be reasoned about
holistically.

1. **Module layout.** `packages/core/src/float-lookup/` is a new
   directory. Suggested split:
   - `types.ts` — the type definitions enumerated above.
   - `eligibility.ts` — per-candidate eligibility filter (§6.1).
   - `chunking.ts` — the multi-floater loop (§6.2 + tentative
     counter).
   - `tiebreaker.ts` — the §6.3 candidate-set narrowing chain.
   - `index.ts` — the `runFloatLookup` entry point that composes the
     above and exports the public surface. Re-export from
     `packages/core/src/index.ts`.

2. **Determinism.** The algorithm must be pure: no `Math.random`, no
   `Date.now`, no `globalThis` state. The arbitrary Check-3
   tiebreaker MUST sort by a deterministic key (e.g., `userId`
   lexicographic ascending). This is locked by the
   `tiebreaker.test.ts` "deterministic choice" test.

3. **Algorithm sketch under PINNED #1 (global counter):**

   ```
   sortedSources = input.sources.sort((a, b) => a.precedenceOrder - b.precedenceOrder)
   if input.gap.destinationHouseId == HARNWELL: return []
   uncovered = new Set(input.gap.blocks.map(b => b.blockId))
   assignments = []

   for source of sortedSources:
     if source.sourceHouseId is one of 11-single-staff: continue
     // (also reject Quad source if destination is Harnwell — already
     // short-circuited above, but defensive)
     eligibles = source.candidates.filter(c => isEligible(c, input))
     globalTentativeCount = 0
     while uncovered is non-empty:
       largestRun = findLargestContiguousRun(uncovered, input.gap.blocks)
       fullCoverers = eligibles
         .filter(c => coversRunFully(c, largestRun, uncovered)
                   && floorOk(source, globalTentativeCount, largestRun))
       if fullCoverers is non-empty:
         selected = tiebreaker(fullCoverers, largestRun.start, largestRun.end)
         assign(selected, largestRun, assignments, uncovered)
         globalTentativeCount += 1
         eligibles = eligibles.filter(c => c.userId != selected.userId)
       else:
         // partial-coverage fallback
         leaders = eligibles
           .map(c => ({ candidate: c, leadingLen: leadingPortionLen(c, largestRun, uncovered) }))
           .filter(x => x.leadingLen >= 2
                     && floorOk(source, globalTentativeCount, leadingSpan(x)))
         if leaders is empty: break  // move to next source
         maxLen = max(leaders, x => x.leadingLen)
         tied = leaders.filter(x => x.leadingLen == maxLen)
         selected = tiebreaker(tied.map(t => t.candidate), largestRun.start, leadingEnd(maxLen))
         assign(selected, leadingSpan(maxLen), assignments, uncovered)
         globalTentativeCount += 1
         eligibles = eligibles.filter(c => c.userId != selected.userId)
   return assignments
   ```

4. **The `floorOk` predicate** under PINNED #1:

   ```
   floorOk(source, globalTentativeCount, span) =
     min(source.effectiveHeadcountByBlockId[b] for b in span)
       - globalTentativeCount >= 2
   ```

   Equivalently: `(min headcount over span) − (tentative count) ≥ 2`,
   so that after the new floater is added (tentative becomes count+1),
   at least one worker remains (`min headcount − count − 1 ≥ 1`).

5. **No floor check for the Harnwell destination short-circuit.** The
   short-circuit returns empty BEFORE any candidates or floor logic
   runs. Tests verify this by passing rosters that would otherwise be
   eligible.

6. **All times in tests are anchored to America/New_York (EDT,
   -04:00 on May 28, 2026 — no DST boundary inside any gap window).**
   Phase-03 already covers DST-correct block iteration; phase-06
   isolates algorithmic concerns from time-zone correctness.
