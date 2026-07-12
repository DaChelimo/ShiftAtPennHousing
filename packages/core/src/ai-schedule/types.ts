// AI Schedule Agent — public type surface.
//
// This module is a PURE agentic-loop harness; no DB clients, no I/O, no
// clock, no SDK imports. The web layer snapshots all DB state into
// AiScheduleInput, injects a ScheduleLlm transport, and writes the winning
// candidate to draft_block_assignments itself (mirrors the float-lookup
// contract in src/float-lookup/types.ts). The LLM PROPOSES per-day runs,
// the deterministic validator returns machine-readable violations, the LLM
// REPAIRS, the scorer ranks feasible full-week candidates (best-of-N).

export type AiPrefStatus = 'preferred' | 'available' | 'cannot';

// A 30-minute block of the house's template week. weekday/minuteOfDay are
// resolved upstream via blockWeekSlot (the tz-aware seam); this module
// never parses blockStartAtIso for logic.
export type AiScheduleBlock = {
  blockId: string;
  blockStartAtIso: string;
  weekday: number; // NY weekday, Mon=0..Sun=6
  minuteOfDay: number; // minutes since NY midnight
  requiredHeadcount: number;
};

export type AiRosterWorker = {
  workerId: string;
  homeHouseId: string;
  // null = submitted preferences but no period_targets row; the scorer
  // skips target fit for these workers. Opted-out workers never appear.
  targetHours: number | null;
  // Sparse: only preferred/cannot stored. A missing entry means available
  // (submitters-only rule: missing rows and status 'none' collapse here).
  prefs: Record<string, 'preferred' | 'cannot'>;
};

export type AiScheduleInput = {
  houseId: string;
  isHarnwell: boolean;
  periodId: string;
  weekStartDate: string; // NY Monday YYYY-MM-DD of the template week
  capHours: number; // effective weekly cap (RPC-resolved upstream)
  blocks: AiScheduleBlock[]; // template week only, voided blocks filtered
  roster: AiRosterWorker[]; // submitters only
};

export type AiAssignment = { blockId: string; workerId: string };

export type AiViolationCode =
  | 'OVER_HEADCOUNT'
  | 'HARNWELL_TRAINING'
  | 'DOUBLE_BOOK'
  | 'CAP_EXCEEDED'
  | 'CANNOT_CONFLICT'
  | 'UNKNOWN_BLOCK'
  | 'UNKNOWN_WORKER'
  | 'MALFORMED_RUN'
  | 'ONE_HOUR_SHIFT';

export type AiViolationSeverity = 'hard' | 'warning';

export type AiViolation = {
  code: AiViolationCode;
  severity: AiViolationSeverity;
  workerId?: string | undefined;
  blockId?: string | undefined;
  weekday?: number | undefined;
  detail: string; // short; fed back to the LLM in repair prompts
};

export type AiUnfilledSeat = {
  blockId: string;
  weekday: number;
  minuteOfDay: number;
  open: number;
  // Per-seat heuristic: some roster worker is not 'cannot' on the block,
  // not already assigned there, Harnwell-legal, and has cap headroom. A
  // seat can be individually fillable but not jointly with every other
  // open seat (matching-theoretic gap); good enough for surfacing and
  // for the scorer's coverage penalty.
  fillable: boolean;
};

export type AiValidationResult = {
  feasible: boolean; // no 'hard' violations
  violations: AiViolation[];
  unfilledSeats: AiUnfilledSeat[];
};

export type AiScoreBreakdown = {
  preferenceSatisfaction: number;
  targetFit: number;
  shiftQuality: number;
  contiguity: number;
  fairness: number;
  coverage: number;
  total: number; // invariant: sum of the six components
};

// ---- LLM seam: pure data, no SDK types ---------------------------------

export type ScheduleLlmRequest = {
  system: string;
  user: string;
  responseSchema: Record<string, unknown>;
  maxOutputTokens: number;
};

export type ScheduleLlmResponse = { json: unknown };

export interface ScheduleLlm {
  complete(req: ScheduleLlmRequest): Promise<ScheduleLlmResponse>;
}

// -------------------------------------------------------------------------

// Granular progress events emitted as the loop runs, so a caller can stream
// live status and fill a schedule grid day by day. Purely observational:
// emitting an event never changes control flow, so the result stays
// deterministic whether or not an onProgress handler is supplied.
export type AiProgressEvent =
  | { type: 'planning' } // week-level strategy call started
  | { type: 'planned' } // strategy ready
  | { type: 'day-start'; weekday: number; dayIndex: number; dayCount: number }
  | { type: 'day-repair'; weekday: number; round: number }
  | { type: 'day-done'; weekday: number; assignments: AiAssignment[] } // that day's kept shifts
  | { type: 'finalizing' }; // scoring + final validation

export type AiScheduleOptions = {
  candidates?: number; // N independent candidates, default 1 (single strategic draft)
  repairRounds?: number; // R repair rounds per day unit, default 3
  maxLlmCalls?: number; // global budget, default 100
  plateauEpsilon?: number; // absolute score units, default 0.5
  // Run one week-level planning call before the day-by-day build so the
  // single draft commits to a coherent strategy (who anchors which days,
  // how each worker reaches their target hours). Off by default so the pure
  // test harness stays lean; the web layer turns it on.
  planningPass?: boolean;
  // Observational progress callback (see AiProgressEvent). Optional.
  onProgress?: (event: AiProgressEvent) => void;
};

export type AiCandidate = {
  assignments: AiAssignment[];
  score: number;
  breakdown: AiScoreBreakdown;
};

export type AiScheduleResult = {
  best: AiCandidate | null;
  unfilledSeats: AiUnfilledSeat[];
  workerHours: Record<string, number>; // for the best candidate
  warnings: AiViolation[]; // warning-severity violations on the best
  diagnostics: {
    llmCallCount: number;
    candidateScores: number[];
    prunedAssignments: number; // safety-net removals across all candidates
    stoppedEarly: 'plateau' | 'budget' | null;
    notes: string[];
  };
};
