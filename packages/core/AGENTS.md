# packages/core/ — Pure Domain Logic

Loaded when you work under `packages/core/`. Assumes you have read the root `AGENTS.md`.

## The purity rule

Everything here is a **pure function of its input**: zero I/O, zero Supabase SDK imports, no
clock reads, deterministic for a given input. This is the property that makes the domain
testable, replayable, and reviewable, and it is the single rule most worth protecting.

- Pass `now` in as a parameter. Never call a clock inside tested logic.
- The orchestrator (an Edge Function) snapshots all DB state into the algorithm's input type,
  calls the pure function, and writes the resulting rows itself.
- **Never call domain logic from inside a per-row DB transaction loop.** Build the snapshot
  once, call once.
- Comments may reference `supabase/migrations/...` paths. That is fine; an `import` is not.

Shared eligibility functions live in `src/eligibility/` and take a `UserEligibilityProfile`,
never a DB row.

## Float lookup (`src/float-lookup/`)

The algorithm is pure. Two guards inside it are hardcoded and are **never** trusted from
config:

1. **A source desk never drops below one present worker** (`sourceHasFloor` /
   `workerBlocksRespectSourceFloor` in `eligibility.ts`). This is what makes a single-staffed
   house unable to source.
2. **Harnwell is never a float destination** (short-circuit in `index.ts`). Harnwell _may_
   source. The separate Harnwell **training** invariant is enforced at every assignment write
   point, not here.

The old class-based allowlist ("only Quad/Harnwell may source") was removed. Summer floating
is universal: the compiler auto-generates all-pairs routing (any open, multi-staffed house to
any other open house).

**The tentative counter is global per source.** Increment unconditionally after _each_
selection, regardless of span length or block positions. A k-worker source can spare exactly
k-1 floaters per pass. Hybrid heuristics ("only count 2-block selections") look correct
against tests with overlapping spans but silently over-float when spans are disjoint. Such a
heuristic was removed in an audit; do not reintroduce it.

**Partial-coverage fallback is three tiers:** full coverage, then leading portion, then
largest consecutive span (with a non-trailing filter on the first iteration at each source).
Each tier's span must be `>= MIN_FLOAT_CHUNK_BLOCKS`, which is **1**, lowered from 2 to
minimize Allied procurement. Single-block spans are absorbed by floats. A block reaches Allied
only when no eligible worker can cover it, never merely for being one block long. Document any
change to the tiering or the floor in both `tests/PHASE_06/TEST_PLAN.md` and the header
comment on `chooseCandidateForCurrentRun`.

**Hours cap is not checked here, by design.** The input type has no cap field. Floats relocate
already-scheduled hours, so weekly totals are unchanged; a worker at 39h is still eligible to
float.

**The Allied 4-hour cap is not in this algorithm.** The pure function has no gap cap; the
orchestrator bounds it. `orchestrator-tick`'s `loadVacantGap` builds a contiguous vacant gap
of at most `MAX_ALLIED_COVERAGE_BLOCKS = 8` before snapshotting. Do not raise that window
without also raising the documented cap.

## Operating-seasons compiler (`src/operating-seasons/`)

`compileSeason` is pure and deterministic: no DB, no clock. It derives one phase per change
point and one compiled `operating_profiles` row per phase, named `s_<slug>_<YYYYMMDD>`.

**Temporal and calendar-collision guards live in the RPC, not the compiler.** Do not move them
here; the compiler must stay a function of its arguments alone.

## Tests

Vitest. `pnpm test:quick` for the fast core loop, `pnpm test:file` for a single file.

Never skip a test because a behavior seems unlikely. The spec is the truth, not your estimate
of likelihood.
