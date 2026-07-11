// AI Schedule Agent — deterministic mock LLMs for the loop tests.

import {
  buildGrid,
  type AiGrid,
  type AiGridDay,
  type AiScheduleInput,
  type ScheduleLlm,
  type ScheduleLlmRequest,
  type ScheduleLlmResponse,
} from '../../src/ai-schedule/index.js';

// Replays a fixed FIFO queue of JSON responses and logs every request.
// Throws when exhausted so a test fails loudly on unexpected extra calls.
export class ScriptedLlm implements ScheduleLlm {
  readonly requests: ScheduleLlmRequest[] = [];
  private readonly queue: unknown[];

  constructor(responses: unknown[]) {
    this.queue = [...responses];
  }

  complete(req: ScheduleLlmRequest): Promise<ScheduleLlmResponse> {
    this.requests.push(req);
    if (this.queue.length === 0) {
      throw new Error(`ScriptedLlm exhausted after ${String(this.requests.length - 1)} responses`);
    }
    const json = this.queue.shift();
    return Promise.resolve({ json });
  }
}

type Run = { worker: string; start: number; end: number };

// A greedy preference-aware "player": per slot, seats are given to eligible
// workers sorted by (preferred first, fewest cumulative hours, key order).
// Deterministic; always emits legal proposals, so the loop never repairs.
// Tracks hours across calls: use ONE instance per single-candidate run.
export class RuleLlm implements ScheduleLlm {
  readonly requests: ScheduleLlmRequest[] = [];
  private readonly input: AiScheduleInput;
  private readonly grid: AiGrid;
  private readonly hours = new Map<string, number>();

  constructor(input: AiScheduleInput) {
    this.input = input;
    this.grid = buildGrid(input);
  }

  complete(req: ScheduleLlmRequest): Promise<ScheduleLlmResponse> {
    this.requests.push(req);
    const match = /weekday (\d+)/.exec(req.user);
    const weekday = match === null ? NaN : Number(match[1]);
    const day = this.grid.days.find((d) => d.weekday === weekday);
    if (day === undefined) {
      throw new Error(
        `RuleLlm could not resolve the day from the prompt (weekday ${String(weekday)})`,
      );
    }
    return Promise.resolve({ json: { runs: this.proposeDay(day) } });
  }

  private proposeDay(day: AiGridDay): Run[] {
    const slotsByWorker = new Map<string, number[]>();
    day.blocks.forEach((block, idx) => {
      const taken = new Set<string>();
      for (let seat = 0; seat < block.requiredHeadcount; seat++) {
        const pick = this.grid.workers
          .filter((w) => {
            if (taken.has(w.workerId)) return false;
            if (w.prefs[block.blockId] === 'cannot') return false;
            if (this.input.isHarnwell && w.homeHouseId !== 'harnwell') return false;
            return (this.hours.get(w.workerId) ?? 0) + 0.5 <= this.input.capHours;
          })
          .sort((a, b) => {
            const prefA = a.prefs[block.blockId] === 'preferred' ? 0 : 1;
            const prefB = b.prefs[block.blockId] === 'preferred' ? 0 : 1;
            if (prefA !== prefB) return prefA - prefB;
            const hoursA = this.hours.get(a.workerId) ?? 0;
            const hoursB = this.hours.get(b.workerId) ?? 0;
            if (hoursA !== hoursB) return hoursA - hoursB;
            return a.workerId.localeCompare(b.workerId);
          })[0];
        if (pick === undefined) break;
        taken.add(pick.workerId);
        this.hours.set(pick.workerId, (this.hours.get(pick.workerId) ?? 0) + 0.5);
        const list = slotsByWorker.get(pick.workerId);
        if (list === undefined) {
          slotsByWorker.set(pick.workerId, [idx]);
        } else {
          list.push(idx);
        }
      }
    });

    const runs: Run[] = [];
    for (const workerId of [...slotsByWorker.keys()].sort((a, b) => a.localeCompare(b))) {
      const key = this.grid.keyByWorkerId.get(workerId);
      if (key === undefined) continue;
      const slots = (slotsByWorker.get(workerId) ?? []).sort((a, b) => a - b);
      const head = slots[0];
      if (head === undefined) continue;
      let start = head;
      let prev = head;
      for (const s of slots.slice(1)) {
        if (s === prev + 1) {
          prev = s;
          continue;
        }
        runs.push({ worker: key, start, end: prev });
        start = s;
        prev = s;
      }
      runs.push({ worker: key, start, end: prev });
    }
    return runs;
  }
}
