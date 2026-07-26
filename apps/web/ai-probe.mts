// Reproduce the AI schedule run OUTSIDE the Next dev server, against the real
// local Harnwell snapshot, with full error output.
//
//   MODE=dry   zero LLM calls: a fake LLM proposes plausible runs, so any
//              deterministic crash (prompt/validator/finalize) surfaces free.
//   MODE=live  one real run, printing the exact failure and where it happened.

import { readFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

for (const line of readFileSync(new URL('.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
}

const {
  blockWeekSlot,
  runAiSchedule,
  buildGrid,
  AI_WEEKDAY_LABELS,
}: typeof import('@shift/core') = await import('@shift/core');

const HOUSE = process.env.HOUSE ?? 'harnwell';
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ---- snapshot (mirrors lib/data/aiSchedule.ts) ----------------------------
const NY = 'America/New_York';
const nyDate = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: NY, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

const { data: blockRows } = await supabase
  .from('shift_blocks')
  .select('block_id, block_start_at, required_headcount')
  .eq('house_id', HOUSE)
  .is('voided_at', null)
  .order('block_start_at');
const all = blockRows ?? [];
const firstDay = nyDate(all[0]!.block_start_at);
const [y, m, d] = firstDay.split('-').map(Number) as [number, number, number];
const at = new Date(Date.UTC(y, m - 1, d));
at.setUTCDate(at.getUTCDate() - ((at.getUTCDay() + 6) % 7));
const wkStart = at.toISOString().slice(0, 10);
const end = new Date(at);
end.setUTCDate(end.getUTCDate() + 7);
const wkEnd = end.toISOString().slice(0, 10);
const weekBlocks = all.filter((b) => {
  const day = nyDate(b.block_start_at);
  return day >= wkStart && day < wkEnd;
});

const { data: periodRows } = await supabase
  .from('scheduling_periods')
  .select('period_id')
  .lte('start_date', firstDay)
  .gte('end_date', firstDay);
const periodId = periodRows![0]!.period_id;

const { data: rosterRows } = await supabase.rpc('house_roster_as_of', {
  p_house_id: HOUSE,
  p_as_of: firstDay,
});
const houseWorkers = rosterRows as { user_id: string; name: string }[];

const prefsByUser = new Map<string, Record<string, 'preferred' | 'cannot'>>();
for (let i = 0; i < weekBlocks.length; i += 150) {
  const chunk = weekBlocks.slice(i, i + 150).map((b) => b.block_id);
  const { data } = await supabase
    .from('preferences')
    .select('user_id, block_id, status')
    .eq('period_id', periodId)
    .in('block_id', chunk);
  for (const p of data ?? []) {
    const grid = prefsByUser.get(p.user_id) ?? {};
    if (p.status === 'preferred' || p.status === 'cannot') grid[p.block_id] = p.status;
    prefsByUser.set(p.user_id, grid);
  }
}

const { data: targetRows } = await supabase
  .from('period_targets')
  .select('user_id, target_hours, opted_out')
  .eq('period_id', periodId)
  .in('user_id', houseWorkers.map((u) => u.user_id));
const targetByUser = new Map((targetRows ?? []).map((t) => [t.user_id, t]));

const roster = houseWorkers.flatMap((w) => {
  const t = targetByUser.get(w.user_id);
  if (!prefsByUser.has(w.user_id) && t === undefined) return [];
  if (t?.opted_out === true) return [];
  return [{
    workerId: w.user_id,
    homeHouseId: HOUSE,
    targetHours: t === undefined ? null : t.target_hours,
    prefs: prefsByUser.get(w.user_id) ?? {},
  }];
});

const { data: capRows } = await supabase.rpc('effective_weekly_cap', {
  p_week_start_date: wkStart,
  p_block_start_at: all[0]!.block_start_at,
});
const capHours = Math.max(
  (capRows as { hours_cap: number }[] | null)?.[0]?.hours_cap ?? 20,
  ...roster.map((w) => w.targetHours ?? 0),
);

const input = {
  houseId: HOUSE,
  isHarnwell: HOUSE === 'harnwell',
  periodId,
  weekStartDate: wkStart,
  capHours,
  blocks: weekBlocks.map((b) => {
    const slot = blockWeekSlot(new Date(b.block_start_at));
    return {
      blockId: b.block_id,
      blockStartAtIso: b.block_start_at,
      weekday: slot.weekday,
      minuteOfDay: slot.minuteOfDay,
      requiredHeadcount: b.required_headcount,
    };
  }),
  roster,
};

const grid = buildGrid(input);
console.log(
  `snapshot: ${String(input.blocks.length)} blocks, ${String(grid.days.length)} days, ` +
    `${String(roster.length)} workers, cap ${String(capHours)}h, week ${wkStart}`,
);
for (const day of grid.days) {
  console.log(
    `  ${AI_WEEKDAY_LABELS[day.weekday]}: ${String(day.blocks.length)} slots, ` +
      `seats ${String(day.blocks.reduce((s, b) => s + b.requiredHeadcount, 0))}`,
  );
}

// ---- the LLM seam --------------------------------------------------------
const MODE = process.env.MODE ?? 'dry';

// Zero-cost stand-in: proposes greedy 4-block runs so the deterministic parts
// (prompt build, validator, prune, finalize, scorer) see realistic input.
const fakeLlm = {
  complete: async (req: { user: string; responseSchema: Record<string, unknown> }) => {
    if ('strategy' in ((req.responseSchema as { properties?: object }).properties ?? {})) {
      return { json: { strategy: 'Fake strategy.' } };
    }
    const slots = /idx \| start \| seats[^\n]*\n([\s\S]*?)\n\nWORKERS/.exec(req.user);
    const n = slots?.[1]?.split('\n').length ?? 0;
    const keys = [...req.user.matchAll(/^(W\d+) \|/gm)].map((k) => k[1]!);
    const runs: { worker: string; start: number; end: number }[] = [];
    for (let i = 0, k = 0; i + 3 < n && k < keys.length; i += 4, k++) {
      runs.push({ worker: keys[k]!, start: i, end: Math.min(i + 3, n - 1) });
    }
    return { json: { runs } };
  },
};

let llm = fakeLlm as Parameters<typeof runAiSchedule>[1];
let calls = 0;
if (MODE === 'live') {
  const { createAnthropicScheduleLlm } = await import('./lib/ai/anthropic').catch(
    () => ({ createAnthropicScheduleLlm: null }) as never,
  );
  if (createAnthropicScheduleLlm === null) throw new Error('adapter import failed');
  const handle = createAnthropicScheduleLlm();
  llm = {
    complete: async (req) => {
      calls += 1;
      const t = Date.now();
      try {
        const out = await handle.llm.complete(req);
        console.log(`  call ${String(calls)} ok in ${String(Date.now() - t)}ms`);
        return out;
      } catch (e) {
        console.error(`  call ${String(calls)} FAILED after ${String(Date.now() - t)}ms`);
        console.error(e);
        throw e;
      }
    },
  };
}

const started = Date.now();
try {
  const result = await runAiSchedule(input, llm, {
    candidates: 1,
    planningPass: true,
    finalize: true,
    onProgress: (ev) => {
      const label = 'weekday' in ev ? ` ${AI_WEEKDAY_LABELS[ev.weekday]}` : '';
      console.log(`[${String(Date.now() - started)}ms] ${ev.type}${label}`);
    },
  });
  console.log('\n=== RESULT ===');
  console.log(`assignments: ${String(result.best?.assignments.length ?? 0)}`);
  console.log(`score: ${String(result.best?.score ?? 'none')}`);
  console.log(`llm calls: ${String(result.diagnostics.llmCallCount)}`);
  console.log(`pruned: ${String(result.diagnostics.prunedAssignments)}`);
  console.log(`stoppedEarly: ${String(result.diagnostics.stoppedEarly)}`);
  console.log(`notes: ${JSON.stringify(result.diagnostics.notes)}`);
  const warn = new Map<string, number>();
  for (const w of result.warnings) warn.set(w.code, (warn.get(w.code) ?? 0) + 1);
  console.log(`warnings: ${JSON.stringify([...warn])}`);
  console.log(`unfilled seats: ${String(result.unfilledSeats.length)}`);

  // Boundary audit on the shipped schedule.
  const { splitRuns, runBoundaryIssue } = await import('@shift/core');
  const g2 = buildGrid(input);
  const bad = splitRuns(g2, result.best?.assignments ?? []).filter((run) => {
    const day = g2.dayByWeekday.get(run.weekday);
    const s = g2.indexInDay.get(run.blocks[0]!.blockId);
    const e = g2.indexInDay.get(run.blocks[run.blocks.length - 1]!.blockId);
    return day === undefined || s === undefined || e === undefined || runBoundaryIssue(day, s, e) !== null;
  });
  const short = splitRuns(g2, result.best?.assignments ?? []).filter((r) => r.blocks.length < 4);
  console.log(`\nmisaligned runs: ${String(bad.length)}`);
  console.log(`sub-2h runs: ${String(short.length)}`);
} catch (e) {
  console.error(`\n=== THREW after ${String(Date.now() - started)}ms ===`);
  console.error(e);
  process.exitCode = 1;
}
