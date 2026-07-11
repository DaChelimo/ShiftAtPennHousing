'use server';

import {
  AI_WEEKDAY_LABELS,
  buildGrid,
  formatMinuteOfDay,
  runAiSchedule,
  splitRuns,
  validateCandidate,
  type AiAssignment,
  type AiScoreBreakdown,
} from '@shift/core';
import { revalidatePath } from 'next/cache';

import { createAnthropicScheduleLlm } from '../ai/anthropic';
import { canBuildForHouse, canBuildSchedule, getSessionUser } from '../auth';
import { getAiScheduleContext } from '../data/aiSchedule';
import { BLOCK_ID_CHUNK } from '../data/blockChunks';
import { createServiceClient } from '../supabase/server';

import type { ActionResult } from './builder';

const AT_CAPACITY_MESSAGE =
  'A block filled up while accepting. Generate again to rebuild against the latest drafts.';
const HARNWELL_MESSAGE = 'Only Harnwell residents can staff Harnwell.';

export type AiProposalRun = {
  workerName: string;
  startLabel: string;
  endLabel: string;
  hours: number;
  preferredBlocks: number;
};

export type AiProposalDay = { dayLabel: string; runs: AiProposalRun[] };

export type AiProposalWorker = {
  workerId: string;
  name: string;
  hours: number;
  targetHours: number | null;
};

export type AiProposalSeat = {
  dayLabel: string;
  timeLabel: string;
  open: number;
  fillable: boolean;
};

// The whole proposal round-trips through the client untouched: preview
// renders the labeled views; accept sends `assignments` back verbatim
// (and the server re-validates them against a fresh snapshot).
export type AiProposalDto = {
  periodId: string;
  houseId: string;
  assignments: AiAssignment[];
  score: number;
  breakdown: AiScoreBreakdown;
  days: AiProposalDay[];
  workers: AiProposalWorker[];
  unfilledSeats: AiProposalSeat[];
  oneHourShiftCount: number;
  existingDraftCount: number;
  diagnostics: { llmCallCount: number; candidateScores: number[]; stoppedEarly: string | null };
};

function dayLabel(weekday: number): string {
  return AI_WEEKDAY_LABELS[weekday] ?? `Day ${String(weekday + 1)}`;
}

// Run the agentic loop for one house and return the labeled proposal.
// Read-only: drafts are written only by acceptAiSchedule.
export async function generateAiSchedule(input: {
  houseId: string;
}): Promise<ActionResult<AiProposalDto>> {
  const me = await getSessionUser();
  if (!canBuildSchedule(me)) return { ok: false, error: 'Not authorized to build the schedule.' };
  if (!canBuildForHouse(me, input.houseId)) {
    return { ok: false, error: 'You are not authorized to build this schedule.' };
  }

  const ctx = await getAiScheduleContext(input.houseId);
  if (!ctx.gate.canGenerate || ctx.input === null) {
    return { ok: false, error: ctx.gate.reason ?? 'The generator is not available right now.' };
  }

  let llm;
  try {
    llm = createAnthropicScheduleLlm();
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'The AI service is not configured.',
    };
  }

  try {
    const result = await runAiSchedule(ctx.input, llm);
    if (result.best === null) {
      return { ok: false, error: 'The generator could not produce a schedule. Try again.' };
    }

    const grid = buildGrid(ctx.input);
    const runs = splitRuns(grid, result.best.assignments);
    const days: AiProposalDay[] = grid.days.map((day) => ({
      dayLabel: dayLabel(day.weekday),
      runs: runs
        .filter((run) => run.weekday === day.weekday)
        .sort(
          (a, b) =>
            (a.blocks[0]?.minuteOfDay ?? 0) - (b.blocks[0]?.minuteOfDay ?? 0) ||
            a.workerId.localeCompare(b.workerId),
        )
        .map((run) => {
          const first = run.blocks[0];
          const last = run.blocks[run.blocks.length - 1];
          const worker = grid.workerById.get(run.workerId);
          const preferredBlocks = run.blocks.filter(
            (block) => worker?.prefs[block.blockId] === 'preferred',
          ).length;
          return {
            workerName: ctx.workerNamesById[run.workerId] ?? run.workerId,
            startLabel: formatMinuteOfDay(first?.minuteOfDay ?? 0),
            endLabel: formatMinuteOfDay((last?.minuteOfDay ?? 0) + 30),
            hours: run.blocks.length * 0.5,
            preferredBlocks,
          };
        }),
    }));

    const workers: AiProposalWorker[] = ctx.input.roster
      .map((worker) => ({
        workerId: worker.workerId,
        name: ctx.workerNamesById[worker.workerId] ?? worker.workerId,
        hours: result.workerHours[worker.workerId] ?? 0,
        targetHours: worker.targetHours,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const unfilledSeats: AiProposalSeat[] = [...result.unfilledSeats]
      .sort((a, b) => a.weekday - b.weekday || a.minuteOfDay - b.minuteOfDay)
      .map((seat) => ({
        dayLabel: dayLabel(seat.weekday),
        timeLabel: formatMinuteOfDay(seat.minuteOfDay),
        open: seat.open,
        fillable: seat.fillable,
      }));

    return {
      ok: true,
      data: {
        periodId: ctx.input.periodId,
        houseId: input.houseId,
        assignments: result.best.assignments,
        score: result.best.score,
        breakdown: result.best.breakdown,
        days,
        workers,
        unfilledSeats,
        oneHourShiftCount: result.warnings.filter((w) => w.code === 'ONE_HOUR_SHIFT').length,
        existingDraftCount: ctx.existingDraftCount,
        diagnostics: {
          llmCallCount: result.diagnostics.llmCallCount,
          candidateScores: result.diagnostics.candidateScores,
          stoppedEarly: result.diagnostics.stoppedEarly,
        },
      },
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Schedule generation failed. Try again.',
    };
  }
}

// Replace-all accept: delete the house's template-week drafts for the
// period, then bulk-insert the winning candidate. The payload is
// re-validated against a FRESH snapshot first, so the DB headcount and
// Harnwell triggers are a backstop for concurrent racing edits only.
// Delete-then-insert spans two PostgREST calls (not one transaction);
// both steps are idempotent, so the recovery path is simply re-accepting.
export async function acceptAiSchedule(input: {
  houseId: string;
  periodId: string;
  assignments: AiAssignment[];
}): Promise<ActionResult<{ deleted: number; inserted: number }>> {
  const me = await getSessionUser();
  if (!canBuildSchedule(me)) return { ok: false, error: 'Not authorized to build the schedule.' };
  if (!canBuildForHouse(me, input.houseId)) {
    return { ok: false, error: 'You are not authorized to build this schedule.' };
  }
  if (input.assignments.length === 0) {
    return { ok: false, error: 'This proposal has no assignments to accept.' };
  }

  const ctx = await getAiScheduleContext(input.houseId);
  if (!ctx.gate.canGenerate || ctx.input === null) {
    return { ok: false, error: ctx.gate.reason ?? 'This schedule can no longer be drafted.' };
  }
  if (ctx.input.periodId !== input.periodId) {
    return { ok: false, error: 'The scheduling period changed. Generate a new proposal.' };
  }

  // Re-validate against current data (roster or blocks may have moved
  // since generation; also rejects forged payloads).
  const validation = validateCandidate(ctx.input, input.assignments);
  if (!validation.feasible) {
    return {
      ok: false,
      error: 'This proposal no longer fits the current schedule data. Generate a new one.',
    };
  }

  const service = createServiceClient();
  const weekBlockIds = ctx.input.blocks.map((b) => b.blockId);

  // 1. Replace-all delete, chunked like every block_id-scoped call.
  let deleted = 0;
  for (let i = 0; i < weekBlockIds.length; i += BLOCK_ID_CHUNK) {
    const chunk = weekBlockIds.slice(i, i + BLOCK_ID_CHUNK);
    const { data, error } = await service
      .from('draft_block_assignments')
      .delete()
      .eq('period_id', input.periodId)
      .in('block_id', chunk)
      .select('draft_assignment_id');
    if (error !== null) {
      return { ok: false, error: `Could not clear the existing drafts: ${error.message}` };
    }
    deleted += (data ?? []).length;
  }

  // 2. Bulk insert the winner (idempotent on the unique key, so a retry
  // after a partial failure simply completes the write).
  const rows = input.assignments.map((a) => ({
    period_id: input.periodId,
    block_id: a.blockId,
    user_id: a.workerId,
    created_by: me!.userId,
  }));
  const { error } = await service
    .from('draft_block_assignments')
    .upsert(rows, { onConflict: 'period_id,block_id,user_id', ignoreDuplicates: true });
  if (error !== null) {
    if (error.message.includes('block_over_capacity')) {
      return { ok: false, error: AT_CAPACITY_MESSAGE };
    }
    if (error.message.includes('non-Harnwell')) {
      return { ok: false, error: HARNWELL_MESSAGE };
    }
    return {
      ok: false,
      error: `Could not write the drafts: ${error.message}. Accept again to retry.`,
    };
  }

  revalidatePath('/schedule-builder');
  return { ok: true, data: { deleted, inserted: rows.length } };
}
