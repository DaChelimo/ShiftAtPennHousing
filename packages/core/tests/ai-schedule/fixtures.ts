// AI Schedule Agent — shared test fixtures.
//
// The template week is Mon 2026-06-01 (EDT, UTC-4), matching the seeded
// summer test world's representative week and avoiding DST edges.
// blockStartAtIso is informational only; weekday/minuteOfDay drive logic.

import type {
  AiRosterWorker,
  AiScheduleBlock,
  AiScheduleInput,
} from '../../src/ai-schedule/index.js';

export function fixtureBlockId(weekday: number, minuteOfDay: number): string {
  return `b-${String(weekday)}-${String(minuteOfDay)}`;
}

export function makeBlock(
  weekday: number,
  minuteOfDay: number,
  requiredHeadcount = 1,
): AiScheduleBlock {
  const day = String(1 + weekday).padStart(2, '0');
  const hh = String(Math.floor(minuteOfDay / 60)).padStart(2, '0');
  const mm = String(minuteOfDay % 60).padStart(2, '0');
  return {
    blockId: fixtureBlockId(weekday, minuteOfDay),
    blockStartAtIso: `2026-06-${day}T${hh}:${mm}:00-04:00`,
    weekday,
    minuteOfDay,
    requiredHeadcount,
  };
}

// A band of contiguous 30-minute blocks: [startMin, endMin).
export function makeBand(
  weekday: number,
  startMin: number,
  endMin: number,
  requiredHeadcount = 1,
): AiScheduleBlock[] {
  const blocks: AiScheduleBlock[] = [];
  for (let m = startMin; m < endMin; m += 30) {
    blocks.push(makeBlock(weekday, m, requiredHeadcount));
  }
  return blocks;
}

export function makeWorker(
  workerId: string,
  overrides: Partial<Omit<AiRosterWorker, 'workerId'>> = {},
): AiRosterWorker {
  return {
    workerId,
    homeHouseId: overrides.homeHouseId ?? 'rodin',
    targetHours: overrides.targetHours === undefined ? 10 : overrides.targetHours,
    prefs: overrides.prefs ?? {},
  };
}

export function makeInput(overrides: Partial<AiScheduleInput> = {}): AiScheduleInput {
  return {
    houseId: 'rodin',
    isHarnwell: false,
    periodId: 'period-1',
    weekStartDate: '2026-06-01',
    capHours: 20,
    blocks: [],
    roster: [],
    ...overrides,
  };
}

// Single-staff house: Mon/Tue/Wed 16:00-20:00 (8 blocks per day, 1 seat).
// Workers sort (and so key) order: alice=W1, bob=W2, cara=W3.
export function smallHouseSnapshot(): AiScheduleInput {
  const blocks = [...makeBand(0, 960, 1200), ...makeBand(1, 960, 1200), ...makeBand(2, 960, 1200)];
  const monPreferred: Record<string, 'preferred' | 'cannot'> = {};
  for (const b of makeBand(0, 960, 1200)) monPreferred[b.blockId] = 'preferred';
  const tueCannot: Record<string, 'preferred' | 'cannot'> = {};
  for (const b of makeBand(1, 960, 1200)) tueCannot[b.blockId] = 'cannot';
  return makeInput({
    blocks,
    roster: [
      makeWorker('alice', { targetHours: 8, prefs: monPreferred }),
      makeWorker('bob', { targetHours: 6 }),
      makeWorker('cara', { targetHours: 4, prefs: tueCannot }),
    ],
  });
}

// Harnwell-like: Mon/Tue/Wed 08:00-12:00 single (8 blocks) + 12:00-18:00
// double (12 blocks, 2 seats). 48 seat-hours total. Five submitters:
// four Harnwell-home (one with a null target, one who cannot work
// mornings) plus one away-home worker the training rule blocks entirely.
export function harnwellSnapshot(): AiScheduleInput {
  const days = [0, 1, 2];
  const blocks: AiScheduleBlock[] = [];
  for (const d of days) {
    blocks.push(...makeBand(d, 480, 720, 1), ...makeBand(d, 720, 1080, 2));
  }

  const amberPrefs: Record<string, 'preferred' | 'cannot'> = {};
  for (const b of makeBand(0, 720, 1080, 2)) amberPrefs[b.blockId] = 'preferred';

  const cleoPrefs: Record<string, 'preferred' | 'cannot'> = {};
  for (const d of days) {
    for (const b of makeBand(d, 480, 720, 1)) cleoPrefs[b.blockId] = 'cannot';
  }

  const drewPrefs: Record<string, 'preferred' | 'cannot'> = {};
  for (const b of makeBand(2, 720, 1080, 2)) drewPrefs[b.blockId] = 'preferred';

  return makeInput({
    houseId: 'harnwell',
    isHarnwell: true,
    blocks,
    roster: [
      makeWorker('w-amber', { homeHouseId: 'harnwell', targetHours: 12, prefs: amberPrefs }),
      makeWorker('w-blake', { homeHouseId: 'harnwell', targetHours: 12 }),
      makeWorker('w-cleo', { homeHouseId: 'harnwell', targetHours: 12, prefs: cleoPrefs }),
      makeWorker('w-drew', { homeHouseId: 'harnwell', targetHours: null, prefs: drewPrefs }),
      makeWorker('x-eve', { homeHouseId: 'rodin', targetHours: 10 }),
    ],
  });
}
