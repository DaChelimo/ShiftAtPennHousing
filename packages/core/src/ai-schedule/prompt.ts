// AI Schedule Agent — prompt construction + the LLM wire contract.
//
// Pure string building from the snapshot so every prompt is unit-testable;
// the web adapter only transports. The LLM sees short worker keys (W1..Wn)
// and per-day slot indices, never names or UUIDs: proposals reference
// indices into the numbered slot table, which makes transcription errors
// structurally impossible and validation mapping O(1).

import { formatMinuteOfDay } from '../preferences/index.js';

import type { AiGrid, AiGridDay } from './grid.js';
import type { AiAssignment, AiScheduleInput, AiViolation } from './types.js';

export const AI_WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export const AI_MAX_OUTPUT_TOKENS = 8000;

export type AiPerspective = 'coverage-first' | 'preference-first' | 'balance-first';

export const AI_PERSPECTIVES: readonly AiPerspective[] = [
  'coverage-first',
  'preference-first',
  'balance-first',
] as const;

// One fixed schema across every call (also hits the API's server-side
// schema-compilation cache). Structured outputs do not support numeric
// minimum/maximum, so index ranges are validated in parseProposal instead.
export const AI_PROPOSAL_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    runs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          worker: { type: 'string' },
          start: { type: 'integer' },
          end: { type: 'integer' },
        },
        required: ['worker', 'start', 'end'],
        additionalProperties: false,
      },
    },
  },
  required: ['runs'],
  additionalProperties: false,
};

const PERSPECTIVE_LINES: Record<AiPerspective, string> = {
  'coverage-first': 'Bias toward maximum seat coverage when objectives conflict.',
  'preference-first': 'Bias toward preference satisfaction when objectives conflict.',
  'balance-first': 'Bias toward an even hours distribution when objectives conflict.',
};

export function buildSystemPrompt(input: AiScheduleInput, perspective: AiPerspective): string {
  const lines = [
    'You are the scheduling lead building a student residence front-desk schedule,',
    'one day at a time. You have set a strategy for the whole week; staff each day',
    'decisively to carry it out. Own the decisions. Do not leave a seat empty when a',
    'worker can legally take it.',
    '',
    'HARD RULES (a separate validator rejects any violation):',
    "1. Never exceed a slot's seat count.",
    '2. Never assign the same worker twice to one slot.',
    `3. A worker's total for the WEEK must stay at or under ${String(input.capHours)} hours. Each slot is 30 minutes.`,
    '4. Never assign a worker to a slot marked C (cannot).',
  ];
  if (input.isHarnwell) {
    lines.push('5. This is Harnwell: ONLY workers marked HOME may be assigned.');
  }
  lines.push(
    '',
    'OBJECTIVES, in priority order:',
    'A. Fill every seat that can legally be filled.',
    'B. Prefer P (preferred) slots over A (available) slots.',
    "C. Bring each worker's week close to their target hours.",
    'D. Schedule contiguous runs of 2 to 5 hours; avoid runs of 1 hour or less.',
    'E. Spread desirable slots fairly across workers.',
    '',
    'OUTPUT: JSON only, matching the given schema. Each run is one worker',
    'covering the INCLUSIVE slot index range start..end. Emit one object per',
    'contiguous run. No prose.',
    '',
    PERSPECTIVE_LINES[perspective],
  );
  return lines.join('\n');
}

// The whole-week planning call: one authoritative pass that sets a strategy
// (who anchors which days, how each worker reaches their target hours, where
// coverage is hardest) before the day-by-day build. Its plain-language output
// is threaded into every propose prompt so the single draft stays coherent.
export const AI_PLAN_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: { strategy: { type: 'string' } },
  required: ['strategy'],
  additionalProperties: false,
};

export function buildPlanSystemPrompt(input: AiScheduleInput): string {
  const lines = [
    'You are the scheduling lead for a student residence front desk, planning one',
    "week's coverage. Before placing any shift you decide the strategy for the whole",
    'week: which workers anchor which days, how each person reaches their target hours',
    'across the seven days without exceeding the weekly cap, and where coverage will be',
    'hardest so you plan for it up front.',
  ];
  if (input.isHarnwell) {
    lines.push('This is Harnwell: only HOME workers may ever staff it. Plan around that.');
  }
  lines.push(
    '',
    'Return a short, decisive plain-language strategy (a few sentences). Do not produce',
    'a schedule or any slot assignments yet. Just the plan.',
  );
  return lines.join('\n');
}

export function buildPlanPrompt(input: AiScheduleInput, grid: AiGrid): string {
  const totalSeats = grid.days.reduce(
    (sum, day) => sum + day.blocks.reduce((s, b) => s + b.requiredHeadcount, 0),
    0,
  );
  const dayLines = grid.days.map((day) => {
    const seats = day.blocks.reduce((s, b) => s + b.requiredHeadcount, 0);
    return `${dayLabel(day.weekday)}: ${String(day.blocks.length)} slots, ${String(seats)} seats to staff`;
  });
  const workerLines = grid.workers.map((worker) => {
    const key = grid.keyByWorkerId.get(worker.workerId) ?? '?';
    const home = worker.homeHouseId === input.houseId ? 'HOME' : 'away';
    const target =
      worker.targetHours === null ? 'no target' : `${String(worker.targetHours)}h target`;
    let preferred = 0;
    let blocked = 0;
    for (const value of Object.values(worker.prefs)) {
      if (value === 'preferred') preferred++;
      else if (value === 'cannot') blocked++;
    }
    return `${key} | ${home} | ${target} | ${String(preferred)} preferred slots | ${String(blocked)} blocked slots`;
  });
  return [
    `House: ${input.houseId}. Weekly cap: ${String(input.capHours)}h per worker. Each slot is 30 minutes.`,
    `${String(grid.days.length)} scheduled days, ${String(totalSeats)} seats to staff in total.`,
    '',
    'DAYS',
    ...dayLines,
    '',
    'WORKERS',
    'key | home | target | preferred | blocked',
    ...workerLines,
    '',
    'Set the strategy for the week.',
  ].join('\n');
}

// Extract the strategy string from a plan response. Never throws; an
// unusable response yields an empty plan (the build proceeds without it).
export function parsePlan(json: unknown): string {
  if (typeof json === 'object' && json !== null) {
    const value = (json as { strategy?: unknown }).strategy;
    if (typeof value === 'string') return value.trim();
  }
  return '';
}

function dayLabel(weekday: number): string {
  return AI_WEEKDAY_LABELS[weekday] ?? `Day${String(weekday)}`;
}

function slotTable(day: AiGridDay): string {
  const rows = day.blocks.map(
    (b, i) =>
      `${String(i).padStart(3)} | ${formatMinuteOfDay(b.minuteOfDay)} | ${String(b.requiredHeadcount)}`,
  );
  return ['idx | start | seats', ...rows].join('\n');
}

function prefString(
  grid: AiGrid,
  day: AiGridDay,
  worker: { prefs: Record<string, 'preferred' | 'cannot'> },
): string {
  return day.blocks
    .map((b) => {
      const pref = worker.prefs[b.blockId];
      if (pref === 'preferred') return 'P';
      if (pref === 'cannot') return 'C';
      return 'A';
    })
    .join('');
}

function workerTable(
  input: AiScheduleInput,
  grid: AiGrid,
  day: AiGridDay,
  acc: AiAssignment[],
): string {
  const hoursSoFar = new Map<string, number>();
  for (const a of acc) {
    if (!grid.blockById.has(a.blockId)) continue;
    hoursSoFar.set(a.workerId, (hoursSoFar.get(a.workerId) ?? 0) + 0.5);
  }
  const rows = grid.workers.map((worker) => {
    const key = grid.keyByWorkerId.get(worker.workerId) ?? '?';
    const home = worker.homeHouseId === input.houseId ? 'HOME' : 'away';
    const target = worker.targetHours === null ? 'none' : `${String(worker.targetHours)}h`;
    const soFar = `${String(hoursSoFar.get(worker.workerId) ?? 0)}h`;
    return `${key} | ${home} | ${target} | ${soFar} | ${prefString(grid, day, worker)}`;
  });
  return ['key | home | target | assigned-so-far(week) | prefs per idx (P/A/C)', ...rows].join(
    '\n',
  );
}

function dayHeader(input: AiScheduleInput, grid: AiGrid, day: AiGridDay): string {
  const houseLine = input.isHarnwell
    ? `House: ${input.houseId} (Harnwell rule applies: only workers marked HOME may be assigned)`
    : `House: ${input.houseId}`;
  return [
    houseLine,
    `Day: ${dayLabel(day.weekday)} (weekday ${String(day.weekday)} of ${String(grid.days.length)} scheduled days). Weekly cap: ${String(input.capHours)}h. Slots are 30 minutes each.`,
  ].join('\n');
}

export function buildProposePrompt(
  input: AiScheduleInput,
  grid: AiGrid,
  day: AiGridDay,
  acc: AiAssignment[],
  plan?: string,
): string {
  const parts = [dayHeader(input, grid, day), ''];
  if (plan !== undefined && plan.length > 0) {
    parts.push('YOUR WEEK STRATEGY (follow it):', plan, '');
  }
  parts.push(
    'SLOTS',
    slotTable(day),
    '',
    'WORKERS',
    workerTable(input, grid, day, acc),
    '',
    'Staff every seat you legally can for this day, in line with your strategy. Emit JSON only.',
  );
  return parts.join('\n');
}

// Render a day's assignments back as worker-key slot ranges.
function runsTable(grid: AiGrid, day: AiGridDay, dayAssignments: AiAssignment[]): string {
  const indexByBlockId = new Map(day.blocks.map((b, i) => [b.blockId, i]));
  const slotsByWorker = new Map<string, number[]>();
  for (const a of dayAssignments) {
    const idx = indexByBlockId.get(a.blockId);
    if (idx === undefined) continue;
    const list = slotsByWorker.get(a.workerId);
    if (list === undefined) {
      slotsByWorker.set(a.workerId, [idx]);
    } else {
      list.push(idx);
    }
  }
  const lines: string[] = [];
  for (const workerId of [...slotsByWorker.keys()].sort((a, b) => a.localeCompare(b))) {
    const key = grid.keyByWorkerId.get(workerId) ?? workerId;
    const slots = (slotsByWorker.get(workerId) ?? []).sort((a, b) => a - b);
    const head = slots[0];
    if (head === undefined) continue;
    let start = head;
    let prev = head;
    const ranges: string[] = [];
    for (const s of slots.slice(1)) {
      if (s === prev + 1) {
        prev = s;
        continue;
      }
      ranges.push(`${String(start)}..${String(prev)}`);
      start = s;
      prev = s;
    }
    ranges.push(`${String(start)}..${String(prev)}`);
    lines.push(`${key}: slots ${ranges.join(', ')}`);
  }
  return lines.length > 0 ? lines.join('\n') : '(no assignments)';
}

function violationLines(grid: AiGrid, day: AiGridDay, violations: AiViolation[]): string {
  const indexByBlockId = new Map(day.blocks.map((b, i) => [b.blockId, i]));
  return violations
    .map((v) => {
      const key =
        v.workerId !== undefined ? (grid.keyByWorkerId.get(v.workerId) ?? v.workerId) : '-';
      const slot =
        v.blockId !== undefined && indexByBlockId.has(v.blockId)
          ? `slot ${String(indexByBlockId.get(v.blockId))}`
          : '-';
      const tag = v.severity === 'warning' ? ' (non-blocking)' : '';
      return `- ${v.code} | ${key} | ${slot} | ${v.detail}${tag}`;
    })
    .join('\n');
}

export function buildRepairPrompt(
  input: AiScheduleInput,
  grid: AiGrid,
  day: AiGridDay,
  dayAssignments: AiAssignment[],
  violations: AiViolation[],
): string {
  return [
    dayHeader(input, grid, day),
    '',
    'SLOTS',
    slotTable(day),
    '',
    'WORKERS',
    workerTable(input, grid, day, []),
    '',
    'You previously proposed:',
    runsTable(grid, day, dayAssignments),
    '',
    'The validator found these problems:',
    violationLines(grid, day, violations),
    '',
    'Re-emit the FULL corrected run list for this day (not a diff). Emit JSON only.',
  ].join('\n');
}

// Map an LLM proposal back to assignments. Never throws: structural
// surprises (the schema guarantees shape on the real API, but mocks and
// truncation do not) become MALFORMED_RUN violations for the repair loop.
export function parseProposal(
  json: unknown,
  grid: AiGrid,
  day: AiGridDay,
): { assignments: AiAssignment[]; violations: AiViolation[] } {
  const violations: AiViolation[] = [];
  const assignments: AiAssignment[] = [];

  if (
    typeof json !== 'object' ||
    json === null ||
    !Array.isArray((json as { runs?: unknown }).runs)
  ) {
    violations.push({
      code: 'MALFORMED_RUN',
      severity: 'hard',
      weekday: day.weekday,
      detail: 'response is not an object with a runs array',
    });
    return { assignments, violations };
  }

  for (const raw of (json as { runs: unknown[] }).runs) {
    if (typeof raw !== 'object' || raw === null) {
      violations.push({
        code: 'MALFORMED_RUN',
        severity: 'hard',
        weekday: day.weekday,
        detail: 'run entry is not an object',
      });
      continue;
    }
    const run = raw as { worker?: unknown; start?: unknown; end?: unknown };
    const worker = typeof run.worker === 'string' ? grid.workerByKey.get(run.worker) : undefined;
    if (worker === undefined) {
      violations.push({
        code: 'MALFORMED_RUN',
        severity: 'hard',
        weekday: day.weekday,
        detail: `unknown worker key ${typeof run.worker === 'string' ? run.worker : '(missing)'}`,
      });
      continue;
    }
    const start = run.start;
    const end = run.end;
    if (
      typeof start !== 'number' ||
      typeof end !== 'number' ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < start ||
      end >= day.blocks.length
    ) {
      violations.push({
        code: 'MALFORMED_RUN',
        severity: 'hard',
        workerId: worker.workerId,
        weekday: day.weekday,
        detail: `run indices missing, non-integer, or out of range (valid 0..${String(day.blocks.length - 1)})`,
      });
      continue;
    }
    for (let i = start; i <= end; i++) {
      const block = day.blocks[i];
      if (block === undefined) continue; // unreachable: range checked above
      assignments.push({ blockId: block.blockId, workerId: worker.workerId });
    }
  }

  return { assignments, violations };
}
