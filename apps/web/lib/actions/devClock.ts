'use server';

import { revalidatePath } from 'next/cache';

import { getSessionUser } from '../auth';
import { SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from '../env';
import { createServiceClient } from '../supabase/server';
import { isTimeTravelEnabled } from '../time/simClock';

export type DevClockResult = { ok: true; offsetSeconds: number } | { ok: false; error: string };

// Set the simulated clock to `targetISO`. Stored as an offset from the real
// clock, so simulated time keeps advancing at 1x from that instant (app_now()
// adds the fixed offset to live now()). Gated to non-production builds.
export async function setSimClock(targetISO: string): Promise<DevClockResult> {
  if (!isTimeTravelEnabled()) {
    return { ok: false, error: 'Time travel is disabled in this environment.' };
  }
  const target = new Date(targetISO);
  if (Number.isNaN(target.getTime())) {
    return { ok: false, error: 'Invalid date/time.' };
  }
  const me = await getSessionUser();
  const offsetSeconds = (target.getTime() - Date.now()) / 1000;

  const svc = createServiceClient();
  const { error } = await svc
    .from('dev_sim_clock')
    .update({
      offset_seconds: offsetSeconds,
      set_at: new Date().toISOString(),
      set_by: me?.userId ?? null,
    })
    .eq('id', true);
  if (error !== null) return { ok: false, error: error.message };

  revalidatePath('/', 'layout');
  return { ok: true, offsetSeconds };
}

// Reset to real wall-clock time (offset 0).
export async function clearSimClock(): Promise<DevClockResult> {
  if (!isTimeTravelEnabled()) {
    return { ok: false, error: 'Time travel is disabled in this environment.' };
  }
  const me = await getSessionUser();
  const svc = createServiceClient();
  const { error } = await svc
    .from('dev_sim_clock')
    .update({ offset_seconds: 0, set_at: new Date().toISOString(), set_by: me?.userId ?? null })
    .eq('id', true);
  if (error !== null) return { ok: false, error: error.message };

  revalidatePath('/', 'layout');
  return { ok: true, offsetSeconds: 0 };
}

// The orchestrator-tick TickSummary fields we surface to the operator.
export type OrchestratorTickSummary = {
  tickedAt: string;
  blocksScanned: number;
  stepsFired: number;
  floatsVoided: number;
  swapsExpired: number;
  errors: string[];
};

// A run of contiguous 30-minute blocks, merged into one span for display.
export type CoverageSpan = { startISO: string; endISO: string; blocks: number };
// A worker relocated from one house to another for a span (this tick).
export type FloatCoverage = {
  worker: string;
  fromHouseId: string;
  fromHouseName: string;
  toHouseId: string;
  toHouseName: string;
  status: string;
  spans: CoverageSpan[];
};
// A desk routed to Allied, or opened for broadcast pickup, this tick.
export type DeskCoverage = { houseId: string; houseName: string; spans: CoverageSpan[] };
// A float voided this tick (e.g. no-ack).
export type VoidedCoverage = { worker: string; toHouseName: string | null };
// Everything the tick changed, derived by diffing DB state around the tick.
export type TickCoverage = {
  floats: FloatCoverage[];
  allied: DeskCoverage[];
  broadcasts: DeskCoverage[];
  voided: VoidedCoverage[];
};

export type OrchestratorTickResult =
  | { ok: true; summary: OrchestratorTickSummary; coverage: TickCoverage }
  | { ok: false; error: string };

const BLOCK_MS = 30 * 60 * 1000;

// Snapshot of the state we diff against to attribute changes to THIS tick.
type TickSnapshot = { floatStatus: Map<string, string>; stepKeys: Set<string> };

type Svc = ReturnType<typeof createServiceClient>;

// Read the "before" state so the post-tick diff can tell what the tick created
// (new floats / newly-fired steps) versus what already existed. Timestamp-free
// so it is robust to the rewindable simulated clock.
async function snapshotForTick(svc: Svc): Promise<TickSnapshot> {
  const [floats, steps] = await Promise.all([
    svc.from('float_assignments').select('float_id, status'),
    svc.from('block_step_status').select('block_id, step_name'),
  ]);
  const floatStatus = new Map<string, string>();
  for (const r of floats.data ?? []) floatStatus.set(r.float_id, r.status);
  const stepKeys = new Set<string>();
  for (const r of steps.data ?? []) stepKeys.add(`${r.block_id}|${r.step_name}`);
  return { floatStatus, stepKeys };
}

// Merge a set of 30-minute block starts (ms) into contiguous spans.
function mergeSpans(startsMs: number[]): CoverageSpan[] {
  const sorted = [...new Set(startsMs)].sort((a, b) => a - b);
  const spans: CoverageSpan[] = [];
  for (const start of sorted) {
    const last = spans[spans.length - 1];
    if (last && start - new Date(last.endISO).getTime() <= 0) {
      // start falls at or before the current span end → extend it.
      last.endISO = new Date(start + BLOCK_MS).toISOString();
      last.blocks += 1;
    } else {
      spans.push({
        startISO: new Date(start).toISOString(),
        endISO: new Date(start + BLOCK_MS).toISOString(),
        blocks: 1,
      });
    }
  }
  return spans;
}

// Group desk-step block ids (allied / broadcast) into per-house merged spans.
function groupDeskSpans(
  blockIds: string[],
  blockById: Map<string, { houseId: string; startMs: number }>,
  houseName: (id: string) => string,
): DeskCoverage[] {
  const byHouse = new Map<string, number[]>();
  for (const id of blockIds) {
    const b = blockById.get(id);
    if (!b) continue;
    (byHouse.get(b.houseId) ?? byHouse.set(b.houseId, []).get(b.houseId)!).push(b.startMs);
  }
  return [...byHouse.entries()]
    .map(([houseId, starts]) => ({ houseId, houseName: houseName(houseId), spans: mergeSpans(starts) }))
    .sort((a, b) => a.houseName.localeCompare(b.houseName));
}

// Diff DB state around the tick and describe every coverage action it took.
async function collectTickCoverage(svc: Svc, before: TickSnapshot): Promise<TickCoverage> {
  const empty: TickCoverage = { floats: [], allied: [], broadcasts: [], voided: [] };
  const [floatsAfter, stepsAfter, housesRes] = await Promise.all([
    svc.from('float_assignments').select('float_id, user_id, status, destination_assignment_ids'),
    svc.from('block_step_status').select('block_id, step_name'),
    svc.from('houses').select('id, name'),
  ]);

  const houseNames = new Map<string, string>();
  for (const h of housesRes.data ?? []) houseNames.set(h.id, h.name);
  const houseName = (id: string) => houseNames.get(id) ?? id;

  const newFloats = (floatsAfter.data ?? []).filter((f) => !before.floatStatus.has(f.float_id));
  const voidedFloats = (floatsAfter.data ?? []).filter(
    (f) =>
      f.status === 'voided' &&
      before.floatStatus.has(f.float_id) &&
      before.floatStatus.get(f.float_id) !== 'voided',
  );
  const newSteps = (stepsAfter.data ?? []).filter(
    (s) => !before.stepKeys.has(`${s.block_id}|${s.step_name}`),
  );
  const alliedBlockIds = newSteps.filter((s) => s.step_name === 'hmod_notify_allied').map((s) => s.block_id);
  const broadcastBlockIds = newSteps.filter((s) => s.step_name === 'broadcast').map((s) => s.block_id);

  if (
    newFloats.length === 0 &&
    voidedFloats.length === 0 &&
    alliedBlockIds.length === 0 &&
    broadcastBlockIds.length === 0
  ) {
    return empty;
  }

  // Resolve destination assignments (float placements) → their blocks.
  const destIds = [
    ...new Set([...newFloats, ...voidedFloats].flatMap((f) => f.destination_assignment_ids ?? [])),
  ];
  const assignRes = destIds.length
    ? await svc
        .from('shift_block_assignments')
        .select('assignment_id, block_id, source_house_id')
        .in('assignment_id', destIds)
    : { data: [] as { assignment_id: string; block_id: string; source_house_id: string | null }[] };
  const assignById = new Map((assignRes.data ?? []).map((a) => [a.assignment_id, a]));

  // Fetch every block we need a house + start time for (floats + desk steps).
  const neededBlockIds = [
    ...new Set([
      ...alliedBlockIds,
      ...broadcastBlockIds,
      ...(assignRes.data ?? []).map((a) => a.block_id),
    ]),
  ];
  const blocksRes = neededBlockIds.length
    ? await svc
        .from('shift_blocks')
        .select('block_id, house_id, block_start_at')
        .in('block_id', neededBlockIds)
    : { data: [] as { block_id: string; house_id: string; block_start_at: string }[] };
  const blockById = new Map(
    (blocksRes.data ?? []).map((b) => [
      b.block_id,
      { houseId: b.house_id, startMs: new Date(b.block_start_at).getTime() },
    ]),
  );

  // Floater names.
  const userIds = [...new Set([...newFloats, ...voidedFloats].map((f) => f.user_id))];
  const usersRes = userIds.length
    ? await svc.from('users').select('user_id, name, home_house_id').in('user_id', userIds)
    : { data: [] as { user_id: string; name: string; home_house_id: string | null }[] };
  const userById = new Map((usersRes.data ?? []).map((u) => [u.user_id, u]));

  const floats: FloatCoverage[] = newFloats.map((f) => {
    const assigns = (f.destination_assignment_ids ?? [])
      .map((id) => assignById.get(id))
      .filter((a): a is NonNullable<typeof a> => a != null);
    const starts = assigns
      .map((a) => blockById.get(a.block_id)?.startMs)
      .filter((n): n is number => n != null);
    const toHouseId = assigns.map((a) => blockById.get(a.block_id)?.houseId).find(Boolean) ?? '';
    const fromHouseId =
      assigns.map((a) => a.source_house_id).find(Boolean) ??
      userById.get(f.user_id)?.home_house_id ??
      '';
    return {
      worker: userById.get(f.user_id)?.name ?? 'Unknown worker',
      fromHouseId,
      fromHouseName: houseName(fromHouseId),
      toHouseId,
      toHouseName: houseName(toHouseId),
      status: f.status,
      spans: mergeSpans(starts),
    };
  });

  const voided: VoidedCoverage[] = voidedFloats.map((f) => {
    const toId = (f.destination_assignment_ids ?? [])
      .map((id) => assignById.get(id)?.block_id)
      .map((bid) => (bid ? blockById.get(bid)?.houseId : undefined))
      .find(Boolean);
    return {
      worker: userById.get(f.user_id)?.name ?? 'Unknown worker',
      toHouseName: toId ? houseName(toId) : null,
    };
  });

  return {
    floats,
    allied: groupDeskSpans(alliedBlockIds, blockById, houseName),
    broadcasts: groupDeskSpans(broadcastBlockIds, blockById, houseName),
    voided,
  };
}

// Run the orchestrator-tick Edge Function on demand instead of waiting for the
// once-a-minute pg_cron job. The orchestrator sources its "now" from app_now(),
// so a tick fired here evaluates every escalation boundary (T-3h broadcast, T-2h
// float lookup, HMOD-for-Allied, T-15m no-ack void) against the SIMULATED clock —
// the set-clock-then-tick loop that makes the time-driven flows testable without
// real-time waits. Gated to non-production builds, same as the clock setter.
//
// Unlike force-trigger (which the EF authorises from the signed-in user's token),
// the orchestrator runs as the system: it authenticates with the service-role key
// (the EF requires Authorization === service role), exactly like the cron caller.
export async function runOrchestratorTick(): Promise<OrchestratorTickResult> {
  if (!isTimeTravelEnabled()) {
    return { ok: false, error: 'Time travel is disabled in this environment.' };
  }

  // Snapshot state BEFORE the tick so we can attribute new floats / fired steps
  // to this run (diff-based, immune to the rewindable simulated clock).
  const svc = createServiceClient();
  const before = await snapshotForTick(svc);

  let body: unknown;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/orchestrator-tick`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    body = await res.json();
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not reach the orchestrator.',
    };
  }

  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'Unexpected orchestrator response.' };
  }
  const b = body as Record<string, unknown>;
  const summary: OrchestratorTickSummary = {
    tickedAt: typeof b.tickedAt === 'string' ? b.tickedAt : new Date().toISOString(),
    blocksScanned: Number(b.blocksScanned ?? 0),
    stepsFired: Number(b.stepsFired ?? 0),
    floatsVoided: Number(b.floatsVoided ?? 0),
    swapsExpired: Number(b.swapsExpired ?? 0),
    errors: Array.isArray(b.errors) ? (b.errors as string[]) : [],
  };

  // Describe what the tick actually did (floats placed, desks routed to Allied,
  // seats broadcast, floats voided) by diffing against the pre-tick snapshot.
  let coverage: TickCoverage = { floats: [], allied: [], broadcasts: [], voided: [] };
  try {
    coverage = await collectTickCoverage(svc, before);
  } catch {
    // Coverage detail is best-effort; the counts summary still stands.
  }

  // A tick may have created/voided floats, fired steps, or routed escalations —
  // refresh every server component (coverage board, inbox, dashboard) so the
  // operator sees the result immediately.
  revalidatePath('/', 'layout');
  return { ok: true, summary, coverage };
}
