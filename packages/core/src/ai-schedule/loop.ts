// AI Schedule Agent — the bounded agentic loop harness.
//
// Deterministic given a deterministic ScheduleLlm: iteration orders are
// sorted, day order rotates by candidate index, ties break to the first
// candidate. Every LLM call is a fresh single-turn request. The prune
// safety net guarantees the returned best candidate carries ZERO hard
// violations, so the caller's draft inserts cannot trip the DB headcount
// or Harnwell triggers outside of concurrent racing edits.

import { buildGrid, type AiGrid, type AiGridDay } from './grid.js';
import {
  AI_MAX_OUTPUT_TOKENS,
  AI_PERSPECTIVES,
  AI_PLAN_JSON_SCHEMA,
  AI_PROPOSAL_JSON_SCHEMA,
  buildPlanPrompt,
  buildPlanSystemPrompt,
  buildProposePrompt,
  buildRepairPrompt,
  buildSystemPrompt,
  parsePlan,
  parseProposal,
} from './prompt.js';
import { scoreWithGrid } from './scorer.js';
import type {
  AiAssignment,
  AiCandidate,
  AiProgressEvent,
  AiScheduleInput,
  AiScheduleOptions,
  AiScheduleResult,
  AiViolation,
  ScheduleLlm,
} from './types.js';
import { validateWithGrid } from './validator.js';

const HARNWELL_HOUSE_ID = 'harnwell';

export const AI_SCHEDULE_DEFAULTS = {
  // ONE strategic draft by default (stakeholder decision 2026-07-11): the SM
  // reviews and edits the result, so an extra best-of-N exploration triples
  // cost and latency for little gain. A single confident pass, primed by a
  // planning call, is the product behavior. Callers can still pass
  // candidates > 1 for evaluation.
  candidates: 1,
  repairRounds: 3,
  // Worst case with one candidate + planning: 1 + 7 days x (1 + repairRounds)
  // = 29 calls. 100 leaves ample headroom (and covers candidates > 1 runs).
  maxLlmCalls: 100,
  plateauEpsilon: 0.5,
  planningPass: false,
} as const;

const NO_PROGRESS = (): void => {
  /* no-op */
};

export async function runAiSchedule(
  input: AiScheduleInput,
  llm: ScheduleLlm,
  options?: AiScheduleOptions,
): Promise<AiScheduleResult> {
  const opts = { ...AI_SCHEDULE_DEFAULTS, ...options };
  const emit: (event: AiProgressEvent) => void = options?.onProgress ?? NO_PROGRESS;
  const grid = buildGrid(input);
  const notes: string[] = [];
  const candidates: AiCandidate[] = [];
  let calls = 0;
  let pruned = 0;
  let stoppedEarly: 'plateau' | 'budget' | null = null;

  // Week-level planning pass (once, candidate-independent): sets the strategy
  // the day-by-day build follows. Its plain-language output is threaded into
  // every propose prompt.
  let plan = '';
  if (opts.planningPass && calls < opts.maxLlmCalls) {
    emit({ type: 'planning' });
    const planResp = await llm.complete({
      system: buildPlanSystemPrompt(input),
      user: buildPlanPrompt(input, grid),
      responseSchema: AI_PLAN_JSON_SCHEMA,
      maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
    });
    calls++;
    plan = parsePlan(planResp.json);
    emit({ type: 'planned' });
  }

  for (let c = 0; c < opts.candidates; c++) {
    if (calls >= opts.maxLlmCalls) {
      stoppedEarly = 'budget';
      break;
    }
    const perspective = AI_PERSPECTIVES[c % AI_PERSPECTIVES.length] ?? 'coverage-first';
    const system = buildSystemPrompt(input, perspective);
    const dayOrder = rotate(grid.days, c);
    let acc: AiAssignment[] = [];

    for (let d = 0; d < dayOrder.length; d++) {
      const day = dayOrder[d];
      if (day === undefined) continue;
      if (calls >= opts.maxLlmCalls) {
        stoppedEarly = 'budget';
        break;
      }
      emit({ type: 'day-start', weekday: day.weekday, dayIndex: d, dayCount: dayOrder.length });
      const proposeReq = {
        system,
        user: buildProposePrompt(input, grid, day, acc, plan),
        responseSchema: AI_PROPOSAL_JSON_SCHEMA,
        maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
      };
      const proposeResp = await llm.complete(proposeReq);
      calls++;
      let parsed = parseProposal(proposeResp.json, grid, day);

      for (let r = 0; r < opts.repairRounds; r++) {
        const result = validateWithGrid(input, grid, [...acc, ...parsed.assignments]);
        const feedback = [
          ...parsed.violations,
          ...violationsForDay(result.violations, day, parsed.assignments),
        ];
        if (!feedback.some((v) => v.severity === 'hard')) break;
        if (calls >= opts.maxLlmCalls) {
          stoppedEarly = 'budget';
          break;
        }
        emit({ type: 'day-repair', weekday: day.weekday, round: r + 1 });
        const repairResp = await llm.complete({
          system,
          user: buildRepairPrompt(input, grid, day, parsed.assignments, feedback),
          responseSchema: AI_PROPOSAL_JSON_SCHEMA,
          maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
        });
        calls++;
        parsed = parseProposal(repairResp.json, grid, day);
      }

      const before = parsed.assignments.length;
      const kept = pruneToFeasible(input, grid, acc, parsed.assignments);
      pruned += before - kept.length;
      acc = [...acc, ...kept];
      // The kept shifts for this day only, so a caller can paint the day into
      // a grid as it finalizes.
      emit({
        type: 'day-done',
        weekday: day.weekday,
        assignments: kept.map((a) => ({ blockId: a.blockId, workerId: a.workerId })),
      });
    }

    emit({ type: 'finalizing' });
    const breakdown = scoreWithGrid(input, grid, acc);
    const finished: AiCandidate = { assignments: acc, score: breakdown.total, breakdown };
    candidates.push(finished);
    if (stoppedEarly === 'budget') break;

    // Plateau: once at least two candidates exist, stop when the running
    // best has not improved by more than epsilon.
    if (c >= 1 && c + 1 < opts.candidates) {
      const bestBefore = Math.max(...candidates.slice(0, c).map((x) => x.score));
      const bestNow = Math.max(bestBefore, finished.score);
      if (bestNow - bestBefore <= opts.plateauEpsilon) {
        stoppedEarly = 'plateau';
        break;
      }
    }
  }

  let best: AiCandidate | null = null;
  for (const candidate of candidates) {
    if (best === null || candidate.score > best.score) best = candidate; // ties keep the earlier candidate
  }
  if (best === null) {
    return {
      best: null,
      unfilledSeats: validateWithGrid(input, grid, []).unfilledSeats,
      workerHours: {},
      warnings: [],
      diagnostics: {
        llmCallCount: calls,
        candidateScores: [],
        prunedAssignments: pruned,
        stoppedEarly,
        notes,
      },
    };
  }
  const bestValidation = validateWithGrid(input, grid, best.assignments);
  if (!bestValidation.feasible) {
    // Unreachable by construction (prune runs per day); recorded loudly
    // rather than silently returned so a regression cannot write bad drafts.
    notes.push('best candidate failed final validation; returning no schedule');
    return {
      best: null,
      unfilledSeats: bestValidation.unfilledSeats,
      workerHours: {},
      warnings: [],
      diagnostics: {
        llmCallCount: calls,
        candidateScores: candidates.map((x) => x.score),
        prunedAssignments: pruned,
        stoppedEarly,
        notes,
      },
    };
  }

  const workerHours: Record<string, number> = {};
  for (const a of best.assignments) {
    workerHours[a.workerId] = (workerHours[a.workerId] ?? 0) + 0.5;
  }

  return {
    best,
    unfilledSeats: bestValidation.unfilledSeats,
    workerHours,
    warnings: bestValidation.violations.filter((v) => v.severity === 'warning'),
    diagnostics: {
      llmCallCount: calls,
      candidateScores: candidates.map((x) => x.score),
      prunedAssignments: pruned,
      stoppedEarly,
      notes,
    },
  };
}

function rotate<T>(items: T[], by: number): T[] {
  if (items.length === 0) return [];
  const shift = by % items.length;
  return [...items.slice(shift), ...items.slice(0, shift)];
}

// Violations relevant to the current day unit: anything anchored to this
// weekday or one of its blocks, plus worker-level violations (cap,
// Harnwell) for workers the day's proposal touches. Prior days are already
// feasible, so every hard violation stems from today's additions.
function violationsForDay(
  violations: AiViolation[],
  day: AiGridDay,
  dayAssignments: AiAssignment[],
): AiViolation[] {
  const dayBlockIds = new Set(day.blocks.map((b) => b.blockId));
  const dayWorkerIds = new Set(dayAssignments.map((a) => a.workerId));
  return violations.filter((v) => {
    if (v.blockId !== undefined) return dayBlockIds.has(v.blockId);
    if (v.weekday !== undefined) return v.weekday === day.weekday;
    if (v.workerId !== undefined) return dayWorkerIds.has(v.workerId);
    return false;
  });
}

// Deterministic safety net: reduce a day's proposal until adding it to the
// already-feasible accumulator produces zero hard violations. Only the
// day's assignments are ever dropped; the accumulator is locked. Removal
// order per rule is stable (workerId, then chronology), so identical
// inputs prune identically.
export function pruneToFeasible(
  input: AiScheduleInput,
  grid: AiGrid,
  acc: AiAssignment[],
  dayAssignments: AiAssignment[],
): AiAssignment[] {
  const accPairs = new Set(acc.map((a) => `${a.workerId}|${a.blockId}`));

  // 1. Unknown references and duplicates (within the day or against acc).
  const seen = new Set<string>();
  let kept = dayAssignments.filter((a) => {
    if (!grid.blockById.has(a.blockId) || !grid.workerById.has(a.workerId)) return false;
    const pair = `${a.workerId}|${a.blockId}`;
    if (accPairs.has(pair) || seen.has(pair)) return false;
    seen.add(pair);
    return true;
  });

  // 2. Cannot conflicts.
  kept = kept.filter((a) => grid.workerById.get(a.workerId)?.prefs[a.blockId] !== 'cannot');

  // 3. Harnwell training invariant.
  if (input.isHarnwell) {
    kept = kept.filter((a) => grid.workerById.get(a.workerId)?.homeHouseId === HARNWELL_HOUSE_ID);
  }

  // 4. Headcount: keep the lowest workerIds on an over-full block.
  const accCountByBlock = new Map<string, number>();
  for (const a of acc) {
    accCountByBlock.set(a.blockId, (accCountByBlock.get(a.blockId) ?? 0) + 1);
  }
  const byBlock = new Map<string, AiAssignment[]>();
  for (const a of kept) {
    const list = byBlock.get(a.blockId);
    if (list === undefined) {
      byBlock.set(a.blockId, [a]);
    } else {
      list.push(a);
    }
  }
  const overflow = new Set<AiAssignment>();
  for (const [blockId, list] of byBlock) {
    const required = grid.blockById.get(blockId)?.requiredHeadcount ?? 0;
    const room = required - (accCountByBlock.get(blockId) ?? 0);
    if (list.length <= room) continue;
    const sorted = [...list].sort((a, b) => a.workerId.localeCompare(b.workerId));
    for (const drop of sorted.slice(Math.max(room, 0))) overflow.add(drop);
  }
  if (overflow.size > 0) kept = kept.filter((a) => !overflow.has(a));

  // 5. Weekly cap: trim each over-cap worker's day blocks from the end of
  // the week (latest weekday, latest minute first).
  const hoursOf = new Map<string, number>();
  for (const a of [...acc, ...kept]) {
    hoursOf.set(a.workerId, (hoursOf.get(a.workerId) ?? 0) + 0.5);
  }
  const overCap = [...hoursOf.entries()]
    .filter(([, hours]) => hours > input.capHours)
    .map(([workerId]) => workerId)
    .sort((a, b) => a.localeCompare(b));
  if (overCap.length > 0) {
    const dropped = new Set<AiAssignment>();
    for (const workerId of overCap) {
      let hours = hoursOf.get(workerId) ?? 0;
      const own = kept
        .filter((a) => a.workerId === workerId)
        .sort((a, b) => {
          const ba = grid.blockById.get(a.blockId);
          const bb = grid.blockById.get(b.blockId);
          return (
            (bb?.weekday ?? 0) - (ba?.weekday ?? 0) ||
            (bb?.minuteOfDay ?? 0) - (ba?.minuteOfDay ?? 0)
          );
        });
      for (const a of own) {
        if (hours <= input.capHours) break;
        dropped.add(a);
        hours -= 0.5;
      }
    }
    kept = kept.filter((a) => !dropped.has(a));
  }

  return kept;
}
