import { summarizeAckReminders } from '@shift/core';

import type { EscalationStep } from '../../components/ui';
import { createServiceClient } from '../supabase/server';

import { getShellHouses } from './hmod';

// ===========================================================================
// Coverage & open-shifts monitor — READ model (presentation + wiring over
// EXISTING data). Design screen 06. NEW screen → read layer only; invents no
// backend. Reads shift_blocks + shift_block_assignments (vacant /
// pending_float_in / allied, next 30 days) + block_step_status (escalation) +
// users (floater identity). Permanent openings = vacant + permanent_drop.
//
// The write actions the design shows (force-trigger float, "Call Allied / Mark
// covered") are surfaced in the UI but NOT wired: force_trigger_float is a flow
// (its own screen, §6.5) and "mark covered" has no RPC. See DESIGN_TOKENS.md §6.
//
// Service client (house-scoped server snapshot) — the authorized pattern used by
// the builder + calendar (needs floater names; people-admin RLS is HM/BM-only).
// ===========================================================================

const NY = 'America/New_York';
const DAY_START_MIN = 8 * 60;
const HORIZON_DAYS = 30;

export type CoverageGap = {
  id: string;
  houseId: string;
  houseName: string;
  restricted: boolean;
  dayLabel: string; // "Mon"
  dateLabel: string; // "Feb 2"
  spanLabel: string; // "10:00–11:00"
  seats: number; // open seats in this window
  esc: EscalationStep;
  tMinus: string;
  reason: string;
  // A pending_float_in seat is by definition un-acked (pending: true). reminderLabel
  // surfaces the deepest ack-reminder cadence step reached, or null if none fired yet
  // (#8 — D9). The amber "Pending ack" tag is unchanged; the label is appended.
  floater: {
    name: string;
    fromHouse: string;
    ack: { pending: true; reminderLabel: string | null };
  } | null;
  blockIds: string[]; // the DB block_ids the gap's window spans (force-trigger input)
  weekKey: string; // for the "view on calendar" link
};

export type PermOpening = {
  id: string;
  houseId: string;
  houseName: string;
  dayLabel: string;
  spanLabel: string;
  weeksRemaining: number;
};

export type CoverageData = {
  houseId: string;
  houseName: string;
  gaps: CoverageGap[];
  permOpenings: PermOpening[];
};

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DOW_FROM_SUN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function nyParts(iso: string): { date: string; minutes: number } {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: NY,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  const hhmm = new Intl.DateTimeFormat('en-GB', {
    timeZone: NY,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return { date, minutes: h * 60 + m };
}

function blockLabel(b: number): string {
  const hour = 8 + Math.floor(b / 2);
  const min = (b % 2) * 30;
  return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
function spanLabel(start: number, end: number): string {
  return `${blockLabel(start)}–${blockLabel(end)}`;
}
function mondayKey(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() - ((at.getUTCDay() + 6) % 7));
  return at.toISOString().slice(0, 10);
}
function dateLabel(dateKey: string): string {
  const [, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  return `${MON[m - 1]} ${d}`;
}
function dowLabel(dateKey: string): string {
  return DOW_FROM_SUN[new Date(`${dateKey}T00:00:00Z`).getUTCDay()] ?? '';
}

const ESC_META: Record<EscalationStep, { tMinus: string; reason: string }> = {
  broadcast: { tMinus: 'T-3h', reason: 'Broadcasting to eligible workers' },
  float: { tMinus: 'T-2h', reason: 'Automated float lookup running' },
  allied: { tMinus: 'Awaiting Allied', reason: 'Awaiting HMOD → Allied Security' },
};

function mapStep(stepName: string): EscalationStep {
  if (stepName.includes('hmod') || stepName.includes('allied')) return 'allied';
  if (stepName.includes('float')) return 'float';
  return 'broadcast';
}

// #8 / D9 — the ack-reminder cadence stage → the label appended to "Pending ack".
// awaiting → null (no reminder fired yet → no suffix).
function stageToReminderLabel(
  stage: 'awaiting' | 'reminded_6h' | 'reminded_2h' | 'reminded_final',
): string | null {
  switch (stage) {
    case 'reminded_6h':
      return '6h reminder sent';
    case 'reminded_2h':
      return '2h reminder sent';
    case 'reminded_final':
      return 'final reminder sent';
    default:
      return null;
  }
}

type AsgRow = {
  block_id: string;
  status: string;
  user_id: string | null;
  vacancy_origin: string;
  source_house_id: string | null;
  parent_float_id: string | null;
};

export async function getCoverageData(
  houseId: string,
  now: Date = new Date(),
): Promise<CoverageData> {
  const supabase = createServiceClient();
  const nowIso = now.toISOString();
  const horizonIso = new Date(now.getTime() + HORIZON_DAYS * 86400000).toISOString();

  const base: CoverageData = { houseId, houseName: houseId, gaps: [], permOpenings: [] };
  const restricted = houseId === 'harnwell';

  const { data: house } = await supabase
    .from('houses')
    .select('id, name')
    .eq('id', houseId)
    .maybeSingle();
  if (house) base.houseName = house.name;

  // Blocks for the house in the next 30 days (+ all future for permanent openings).
  const { data: blockRows } = await supabase
    .from('shift_blocks')
    .select('block_id, block_start_at')
    .eq('house_id', houseId)
    .gte('block_start_at', nowIso)
    .order('block_start_at');
  const blocks = blockRows ?? [];
  if (blocks.length === 0) return base;

  const blockMeta = new Map<string, { dateKey: string; blockIndex: number; iso: string }>();
  for (const b of blocks) {
    const { date, minutes } = nyParts(b.block_start_at);
    const blockIndex = Math.round((minutes - DAY_START_MIN) / 30);
    if (blockIndex < 0 || blockIndex >= 32) continue;
    blockMeta.set(b.block_id, { dateKey: date, blockIndex, iso: b.block_start_at });
  }
  const blockIds = [...blockMeta.keys()];

  const { data: asgRows } = await supabase
    .from('shift_block_assignments')
    .select('block_id, status, user_id, vacancy_origin, source_house_id, parent_float_id')
    .in('block_id', blockIds)
    .in('status', ['vacant', 'pending_float_in', 'allied']);
  const assignments = (asgRows ?? []) as AsgRow[];

  const { data: stepRows } = await supabase
    .from('block_step_status')
    .select('block_id, step_name, fired_at')
    .in('block_id', blockIds)
    .order('fired_at', { ascending: true });
  const stepByBlock = new Map<string, EscalationStep>();
  for (const s of stepRows ?? []) stepByBlock.set(s.block_id, mapStep(s.step_name));

  const floaterIds = [
    ...new Set(
      assignments
        .filter((a) => a.status === 'pending_float_in' && a.user_id)
        .map((a) => a.user_id as string),
    ),
  ];
  const userById = new Map<string, { name: string; home: string }>();
  if (floaterIds.length > 0) {
    const { data: us } = await supabase
      .from('users')
      .select('user_id, name, home_house_id')
      .in('user_id', floaterIds);
    for (const u of us ?? []) userById.set(u.user_id, { name: u.name, home: u.home_house_id });
  }

  // ---- ack-reminder indicator (#8 / D9) ----
  // Each pending_float_in seat carries a parent_float_id. Batch-query the float ack
  // reminders (notifications, type='ack_reminder', payload.float_id ∈ the set),
  // group by float-id, run each group through the pure summarizer, and map the
  // deepest fired cadence stage → the label appended to "Pending ack".
  const floatIds = [
    ...new Set(
      assignments
        .filter((a) => a.status === 'pending_float_in' && a.parent_float_id)
        .map((a) => a.parent_float_id as string),
    ),
  ];
  const reminderLabelByFloat = new Map<string, string | null>();
  if (floatIds.length > 0) {
    const { data: reminderRows } = await supabase
      .from('notifications')
      .select('scheduled_for, payload')
      .eq('type', 'ack_reminder')
      .in('payload->>float_id', floatIds);
    const byFloat = new Map<string, { scheduledForIso: string; ackDeadlineIso: string }[]>();
    for (const r of reminderRows ?? []) {
      const payload = (r.payload ?? {}) as { float_id?: string; ack_deadline?: string };
      const fid = payload.float_id;
      const deadline = payload.ack_deadline;
      if (!fid || !deadline || r.scheduled_for === null) continue;
      (byFloat.get(fid) ?? byFloat.set(fid, []).get(fid)!).push({
        scheduledForIso: r.scheduled_for,
        ackDeadlineIso: deadline,
      });
    }
    for (const fid of floatIds) {
      const { stage } = summarizeAckReminders({ reminders: byFloat.get(fid) ?? [], now });
      reminderLabelByFloat.set(fid, stageToReminderLabel(stage));
    }
  }

  // ---- weekly gaps: vacant (non-permanent) + pending_float_in + allied, ≤30d ----
  type Atom = {
    esc: EscalationStep;
    floaterId: string | null;
    floaterHome: string | null;
    floatId: string | null; // parent_float_id — join key to ack-reminder rows (#8)
    blockId: string;
  };
  // day → blockIndex → atoms (one per open seat)
  const perDay = new Map<string, Map<number, Atom[]>>();
  // day → blockIndex → permanent-drop seat count
  const permPerDay = new Map<string, Map<number, number>>();

  for (const a of assignments) {
    const meta = blockMeta.get(a.block_id);
    if (!meta) continue;
    if (a.status === 'vacant' && a.vacancy_origin === 'permanent_drop') {
      const day =
        permPerDay.get(meta.dateKey) ?? permPerDay.set(meta.dateKey, new Map()).get(meta.dateKey)!;
      day.set(meta.blockIndex, (day.get(meta.blockIndex) ?? 0) + 1);
      continue;
    }
    if (meta.iso > horizonIso) continue; // weekly feed is the 30-day window
    let esc: EscalationStep;
    let floaterId: string | null = null;
    let floaterHome: string | null = null;
    let floatId: string | null = null;
    if (a.status === 'allied') esc = 'allied';
    else if (a.status === 'pending_float_in') {
      esc = 'float';
      floaterId = a.user_id;
      floaterHome = a.source_house_id;
      floatId = a.parent_float_id;
    } else esc = stepByBlock.get(a.block_id) ?? 'broadcast';
    const day = perDay.get(meta.dateKey) ?? perDay.set(meta.dateKey, new Map()).get(meta.dateKey)!;
    (day.get(meta.blockIndex) ?? day.set(meta.blockIndex, []).get(meta.blockIndex)!).push({
      esc,
      floaterId,
      floaterHome,
      floatId,
      blockId: a.block_id,
    });
  }

  const gaps: CoverageGap[] = [];
  // Monotonic per-call counter so the gap id (a React key) is unique even when
  // parallel seats coalesce into separate runs starting at the same block — the
  // per-track `i` alone collides across seats (e.g. two vacant seats at one block).
  let gapSeq = 0;
  for (const [dateKey, byBlock] of perDay) {
    // signature groups whose consecutive blocks coalesce into one window
    const sig = (a: Atom) => `${a.esc}|${a.floaterId ?? ''}`;
    const tracks = new Map<string, { block: number; atom: Atom }[]>();
    for (const [blockIndex, atoms] of byBlock) {
      atoms.forEach((atom, i) => {
        const key = `${sig(atom)}#${i}`; // track per seat index so parallel seats coalesce independently
        (tracks.get(key) ?? tracks.set(key, []).get(key)!).push({ block: blockIndex, atom });
      });
    }
    for (const items of tracks.values()) {
      items.sort((a, b) => a.block - b.block);
      let i = 0;
      while (i < items.length) {
        let j = i;
        while (j + 1 < items.length && items[j + 1]!.block === items[j]!.block + 1) j++;
        const head = items[i]!.atom;
        const blockIds = items.slice(i, j + 1).map((it) => it.atom.blockId);
        const floater =
          head.floaterId !== null
            ? {
                name: userById.get(head.floaterId)?.name ?? 'Floater',
                fromHouse: head.floaterHome ?? '',
                ack: {
                  pending: true as const,
                  reminderLabel:
                    head.floatId !== null ? (reminderLabelByFloat.get(head.floatId) ?? null) : null,
                },
              }
            : null;
        gaps.push({
          id: `${dateKey}-${items[i]!.block}-${head.esc}-${gapSeq++}`,
          houseId,
          houseName: base.houseName,
          restricted,
          dayLabel: dowLabel(dateKey),
          dateLabel: dateLabel(dateKey),
          spanLabel: spanLabel(items[i]!.block, items[j]!.block + 1),
          seats: 1,
          esc: head.esc,
          tMinus: ESC_META[head.esc].tMinus,
          reason: ESC_META[head.esc].reason,
          floater,
          blockIds,
          weekKey: mondayKey(dateKey),
        });
        i = j + 1;
      }
    }
  }
  gaps.sort((a, b) => (a.dateLabel + a.spanLabel).localeCompare(b.dateLabel + b.spanLabel));

  // ---- permanent openings: dedup recurring slot by (day-of-week, time) ----
  type PermAgg = { dow: number; startBlock: number; endBlock: number; weeks: Set<string> };
  const permByKey = new Map<string, PermAgg>();
  for (const [dateKey, byBlock] of permPerDay) {
    const dow = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
    const wk = mondayKey(dateKey);
    const indices = [...byBlock.keys()].sort((a, b) => a - b);
    let i = 0;
    while (i < indices.length) {
      let j = i;
      while (j + 1 < indices.length && indices[j + 1] === indices[j]! + 1) j++;
      const key = `${dow}-${indices[i]}-${indices[j]}`;
      const agg = permByKey.get(key) ?? {
        dow,
        startBlock: indices[i]!,
        endBlock: indices[j]! + 1,
        weeks: new Set(),
      };
      agg.weeks.add(wk);
      permByKey.set(key, agg);
      i = j + 1;
    }
  }
  const permOpenings: PermOpening[] = [...permByKey.entries()].map(([key, agg]) => ({
    id: key,
    houseId,
    houseName: base.houseName,
    dayLabel: DOW[(agg.dow + 6) % 7] ?? '',
    spanLabel: spanLabel(agg.startBlock, agg.endBlock),
    weeksRemaining: agg.weeks.size,
  }));

  return { ...base, gaps, permOpenings };
}

// D7 — aggregate coverage across all houses (the on-duty HMOD's campus-wide board).
// Each gap/opening already carries its own houseName, so CoverageMonitor renders
// multi-house with no component change. 13× the per-house queries, run in parallel
// (acceptable for an admin board — a future optimization could batch the reads).
export async function getAllHousesCoverageData(now: Date = new Date()): Promise<CoverageData> {
  const houses = await getShellHouses();
  const perHouse = await Promise.all(houses.map((h) => getCoverageData(h.id, now)));

  // Per-house gap/opening ids are only house-LOCAL-unique (e.g. two houses can each
  // have a broadcast gap at the same date/block/seat), so namespace them by houseId
  // to keep the merged list's React keys globally unique.
  const gaps = perHouse
    .flatMap((d) => d.gaps.map((g) => ({ ...g, id: `${g.houseId}:${g.id}` })))
    .sort((a, b) => (a.dateLabel + a.spanLabel).localeCompare(b.dateLabel + b.spanLabel));
  const permOpenings = perHouse.flatMap((d) =>
    d.permOpenings.map((p) => ({ ...p, id: `${p.houseId}:${p.id}` })),
  );

  return { houseId: 'all', houseName: 'All houses', gaps, permOpenings };
}
