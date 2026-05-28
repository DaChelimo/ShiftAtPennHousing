// Phase 06 — Float Lookup Algorithm: shared test types and fixture builders.
//
// Spec sources:
//   BEHAVIORAL_SPECIFICATION.md §1.2 (float direction rules — absolute),
//                                §6.1 (eligibility),
//                                §6.2 (multi-floater chunking),
//                                §6.3 (tiebreaker chain),
//                                §6.4 (no-takeback);
//   ARCHITECTURE.md §1.5 (algorithmic invariants),
//                   §3.4 (float_assignments),
//                   §3.8 (float_exclusions overlap-based exclusion),
//                   §5.1 — §5.5 (the algorithm itself);
//   AGENTS.md hard invariants 1–4.
//
// The function under test (TDD — not yet implemented):
//
//   packages/core/src/float-lookup/index.ts
//     export function runFloatLookup(input: FloatLookupInput): FloatAssignment[]
//
// runFloatLookup is a PURE FUNCTION. It performs NO database I/O. The
// orchestrator / Edge Function loads the schedule snapshot, scheduled
// headcount, pre-committed absences, exclusions, and float_routing
// precedence, then hands the whole picture to runFloatLookup.
//
// This file defines the type contract the implementation MUST satisfy
// and the small helper factories the test files use to build inputs.
// Re-exporting the types from `../../src/float-lookup/types.js` rather
// than defining them locally guarantees that a type drift between
// implementation and tests will surface as a TypeScript error, not a
// silent runtime divergence.

import type {
  BlockId,
  FloatAssignment,
  FloatCandidate,
  FloatExclusion,
  FloatGap,
  FloatLookupInput,
  GapBlock,
  HouseId,
  SourceHouseRoster,
  UserId,
  WorkerRole,
} from '../../src/float-lookup/types.js';

export type {
  BlockId,
  FloatAssignment,
  FloatCandidate,
  FloatExclusion,
  FloatGap,
  FloatLookupInput,
  GapBlock,
  HouseId,
  SourceHouseRoster,
  UserId,
  WorkerRole,
};

// ---------------------------------------------------------------------
// House identifiers — match the seed data in supabase/seed.sql and the
// phase-05 cross-house tests so that any test that grep-greps for a
// house ID picks up phase-06 fixtures too.
// ---------------------------------------------------------------------

export const HARNWELL = 'harnwell';
export const QUAD = 'quad';
export const HOUSE_03 = 'house-03';
export const HOUSE_04 = 'house-04';
export const HOUSE_05 = 'house-05';
export const HOUSE_06 = 'house-06';
export const HOUSE_07 = 'house-07';
export const HOUSE_08 = 'house-08';
export const SINGLE_STAFF_HOUSES = [
  HOUSE_03,
  HOUSE_04,
  HOUSE_05,
  HOUSE_06,
  HOUSE_07,
  HOUSE_08,
  'house-09',
  'house-10',
  'house-11',
  'house-12',
  'house-13',
] as const;

// ---------------------------------------------------------------------
// Time anchor. May 28, 2026 is a Thursday and falls inside EDT
// (-04:00); no DST boundary is crossed inside any of the gap windows
// constructed below. Phase-03 tests cover DST-correct block iteration;
// phase-06 keeps the wall clock simple to isolate algorithmic concerns.
// ---------------------------------------------------------------------

export const ANCHOR_19_00_EDT = new Date('2026-05-28T19:00:00-04:00');
export const BLOCK_MS = 30 * 60 * 1000;

export function plusMinutes(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60 * 1000);
}

export function plusBlocks(base: Date, blocks: number): Date {
  return new Date(base.getTime() + blocks * BLOCK_MS);
}

// ---------------------------------------------------------------------
// Block + gap helpers
// ---------------------------------------------------------------------

// Build N contiguous 30-min blocks starting at `startAt`.
// Block ids are zero-padded so `b00 < b09 < b10` sorts naturally.
export function makeBlocks(startAt: Date, count: number, prefix = 'b'): GapBlock[] {
  return Array.from({ length: count }, (_, i) => ({
    blockId: `${prefix}${String(i).padStart(2, '0')}`,
    blockStartAt: plusBlocks(startAt, i),
  }));
}

export function makeGap(
  destinationHouseId: HouseId,
  startAt: Date,
  blockCount: number,
  prefix = 'b',
): FloatGap {
  return {
    destinationHouseId,
    blocks: makeBlocks(startAt, blockCount, prefix),
  };
}

// ---------------------------------------------------------------------
// Candidate builder
//
// `coversBlockIndices` lists which gap blocks (by index) the candidate's
// source-side schedule overlaps. The algorithm computes consecutive
// coverage by walking the gap in order and intersecting with this list.
//
// `shiftStartAt` / `shiftEndAt` describe the candidate's contiguous
// source-shift run that contains the covered blocks. Used only by the
// §6.3 tiebreaker checks ("shift starts at span start" / "shift ends at
// span end"). Defaults snap to the covered range so the worker's shift
// is exactly co-extensive with their coverage — the common case.
// ---------------------------------------------------------------------

export type CandidateBuilder = {
  userId: UserId;
  homeHouseId: HouseId;
  gap: FloatGap;
  coversBlockIndices: number[];
  shiftStartAt?: Date;
  shiftEndAt?: Date;
  roles?: WorkerRole[];
  isActive?: boolean;
  hasConflictingFloat?: boolean;
  hasConflictingCrossHousePickup?: boolean;
};

export function makeCandidate(opts: CandidateBuilder): FloatCandidate {
  const { gap, coversBlockIndices } = opts;

  if (coversBlockIndices.length === 0) {
    throw new Error(
      `makeCandidate(${opts.userId}): coversBlockIndices must be non-empty; ` +
        `a worker with zero coverage of the gap is not a meaningful candidate.`,
    );
  }

  const coveredBlocks = coversBlockIndices.map((i) => {
    const block = gap.blocks[i];
    if (block === undefined) {
      throw new Error(
        `makeCandidate(${opts.userId}): coversBlockIndices contains ${i} ` +
          `but gap has only ${gap.blocks.length} blocks.`,
      );
    }
    return block;
  });

  const firstCovered = coveredBlocks[0]!;
  const lastCovered = coveredBlocks[coveredBlocks.length - 1]!;

  return {
    userId: opts.userId,
    homeHouseId: opts.homeHouseId,
    isActive: opts.isActive ?? true,
    roles: opts.roles ?? ['sw'],
    coveredGapBlockIds: coveredBlocks.map((b) => b.blockId),
    shiftStartAt: opts.shiftStartAt ?? firstCovered.blockStartAt,
    shiftEndAt: opts.shiftEndAt ?? plusBlocks(lastCovered.blockStartAt, 1),
    hasConflictingFloat: opts.hasConflictingFloat ?? false,
    hasConflictingCrossHousePickup: opts.hasConflictingCrossHousePickup ?? false,
  };
}

// ---------------------------------------------------------------------
// Source roster builder
//
// `effectiveHeadcountByBlockId` is the *post-pre-committed-absences*
// headcount at the source for each gap block — i.e., the number of
// workers physically at the source desk before any floats from this
// lookup invocation. ARCH §5.2 step 3a/3d describes the floor check
// as `effective_headcount - tentative_absences_from_this_lookup >= 2`
// (so that AFTER the candidate leaves, ≥1 worker remains).
//
// `homogeneousHeadcount` is a shortcut for the common case where the
// headcount is identical across every block of the gap.
// ---------------------------------------------------------------------

export type SourceRosterBuilder = {
  sourceHouseId: HouseId;
  precedenceOrder: number;
  candidates: FloatCandidate[];
  gap: FloatGap;
  homogeneousHeadcount?: number;
  effectiveHeadcountByBlockId?: Record<BlockId, number>;
};

export function makeSourceRoster(opts: SourceRosterBuilder): SourceHouseRoster {
  if (opts.homogeneousHeadcount === undefined && opts.effectiveHeadcountByBlockId === undefined) {
    throw new Error(
      `makeSourceRoster(${opts.sourceHouseId}): supply homogeneousHeadcount ` +
        `or effectiveHeadcountByBlockId — the floor check cannot run without ` +
        `headcount data.`,
    );
  }

  const effectiveHeadcountByBlockId: Record<BlockId, number> =
    opts.effectiveHeadcountByBlockId ??
    Object.fromEntries(opts.gap.blocks.map((b) => [b.blockId, opts.homogeneousHeadcount!]));

  return {
    sourceHouseId: opts.sourceHouseId,
    precedenceOrder: opts.precedenceOrder,
    candidates: opts.candidates,
    effectiveHeadcountByBlockId,
  };
}

// ---------------------------------------------------------------------
// Exclusion builder (float_exclusions row)
// ---------------------------------------------------------------------

export type ExclusionBuilder = {
  userId: UserId;
  destinationHouseId: HouseId;
  windowStartAt: Date;
  windowEndAt: Date;
};

export function makeExclusion(opts: ExclusionBuilder): FloatExclusion {
  return { ...opts };
}

// ---------------------------------------------------------------------
// FloatLookupInput convenience constructor — wraps the three pieces.
// ---------------------------------------------------------------------

export function makeInput(
  gap: FloatGap,
  sources: SourceHouseRoster[],
  exclusions: FloatExclusion[] = [],
): FloatLookupInput {
  return { gap, sources, exclusions };
}

// ---------------------------------------------------------------------
// Assertion helpers — make test bodies assert on behavior, not on
// data-structure shape.
// ---------------------------------------------------------------------

export function assignmentByWorker(
  assignments: FloatAssignment[],
  workerId: UserId,
): FloatAssignment | undefined {
  return assignments.find((a) => a.workerId === workerId);
}

export function assignedBlockIds(assignments: FloatAssignment[]): BlockId[] {
  return assignments.flatMap((a) => a.blocks);
}

export function uncoveredBlockIds(gap: FloatGap, assignments: FloatAssignment[]): BlockId[] {
  const assigned = new Set(assignedBlockIds(assignments));
  return gap.blocks.filter((b) => !assigned.has(b.blockId)).map((b) => b.blockId);
}
