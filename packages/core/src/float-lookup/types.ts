// Phase 06 — Float Lookup Algorithm: public type surface.
//
// This module is a PURE FUNCTION; no DB clients, no I/O. The
// orchestrator (phase 07) snapshots all DB state into FloatLookupInput
// before invoking runFloatLookup / findFloaters and writes the result
// rows itself. See ARCH §5.1–§5.5 and tests/PHASE_06/TEST_PLAN.md.

export type BlockId = string;
export type WorkerId = string;
export type UserId = WorkerId;
export type HouseId = string;

export type WorkerRole = 'sw' | 'sm' | 'hm' | 'rsm' | 'bm';

export type GapBlock = {
  blockId: BlockId;
  blockStartAt: Date;
};

export type FloatGap = {
  destinationHouseId: HouseId;
  blocks: GapBlock[];
};

export type FloatCandidate = {
  userId: WorkerId;
  homeHouseId: HouseId;
  roles: WorkerRole[];
  isActive: boolean;
  // Gap-block ids the candidate's source-side schedule overlaps.
  coveredGapBlockIds: BlockId[];
  // Candidate's contiguous source-shift bounds. Used by §6.3 alignment
  // checks (Check 1: starts at span start; Check 2: ends at span end).
  shiftStartAt: Date;
  shiftEndAt: Date;
  // Pre-computed by the caller for this gap window. The algorithm
  // does not consult any other float / pickup state.
  hasConflictingFloat: boolean;
  hasConflictingCrossHousePickup: boolean;
};

export type FloatExclusion = {
  userId: WorkerId;
  destinationHouseId: HouseId;
  windowStartAt: Date;
  windowEndAt: Date;
};

export type SourceHouseRoster = {
  sourceHouseId: HouseId;
  // Lower precedenceOrder is checked first. Algorithm sorts on this;
  // do not rely on the caller's array order. ARCH §5.2 step 2.
  precedenceOrder: number;
  candidates: FloatCandidate[];
  // Post-pre-committed-absences headcount per gap block (i.e., how
  // many workers are physically at the source desk for each block
  // BEFORE this lookup invocation). Pinned-decision #1.
  effectiveHeadcountByBlockId: Record<BlockId, number>;
};

export type FloatAssignment = {
  workerId: WorkerId;
  sourceHouseId: HouseId;
  // Chronologically ordered subset of gap.blocks the worker covers.
  blocks: BlockId[];
};

export type FloatLookupResult = {
  assignments: FloatAssignment[];
  // Gap blocks not covered by any assignment — the caller derives
  // Allied requests from these. Pinned-decision #15.
  alliedBlockIds: BlockId[];
};

export type FloatLookupInput = {
  gap: FloatGap;
  sources: SourceHouseRoster[];
  exclusions: FloatExclusion[];
};
