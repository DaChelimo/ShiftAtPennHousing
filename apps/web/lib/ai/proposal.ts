// Shared assembly of the AI proposal DTO from a completed loop result.
//
// Server-usable (imports @shift/core); NOT a 'use server' module. Both the
// streaming generate route and the accept path speak this shape. Worker
// names and day/time labels are resolved here so the client renders plain,
// already-localized strings.

import {
  AI_WEEKDAY_LABELS,
  buildGrid,
  formatMinuteOfDay,
  splitRuns,
  type AiAssignment,
  type AiScheduleInput,
  type AiScheduleResult,
  type AiScoreBreakdown,
} from '@shift/core';

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
// renders the labeled views; accept sends `assignments` back verbatim (and
// the server re-validates them against a fresh snapshot).
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

export function buildProposalDto(params: {
  houseId: string;
  input: AiScheduleInput;
  workerNamesById: Record<string, string>;
  existingDraftCount: number;
  result: AiScheduleResult;
}): AiProposalDto | null {
  const { houseId, input, workerNamesById, existingDraftCount, result } = params;
  if (result.best === null) return null;

  const grid = buildGrid(input);
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
          workerName: workerNamesById[run.workerId] ?? run.workerId,
          startLabel: formatMinuteOfDay(first?.minuteOfDay ?? 0),
          endLabel: formatMinuteOfDay((last?.minuteOfDay ?? 0) + 30),
          hours: run.blocks.length * 0.5,
          preferredBlocks,
        };
      }),
  }));

  const workers: AiProposalWorker[] = input.roster
    .map((worker) => ({
      workerId: worker.workerId,
      name: workerNamesById[worker.workerId] ?? worker.workerId,
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
    periodId: input.periodId,
    houseId,
    assignments: result.best.assignments,
    score: result.best.score,
    breakdown: result.best.breakdown,
    days,
    workers,
    unfilledSeats,
    oneHourShiftCount: result.warnings.filter((w) => w.code === 'ONE_HOUR_SHIFT').length,
    existingDraftCount,
    diagnostics: {
      llmCallCount: result.diagnostics.llmCallCount,
      candidateScores: result.diagnostics.candidateScores,
      stoppedEarly: result.diagnostics.stoppedEarly,
    },
  };
}
