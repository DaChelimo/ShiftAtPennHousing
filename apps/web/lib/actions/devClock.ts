'use server';

import { revalidatePath } from 'next/cache';

import { getSessionUser, isAdmin } from '../auth';
import { SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from '../env';
import { createServiceClient } from '../supabase/server';
import { invalidateSimOffset, simNow } from '../time/simClock';

export type DevClockResult = { ok: true; offsetSeconds: number } | { ok: false; error: string };

const ADMIN_ONLY_ERROR = 'Only the project administrator can change simulated time.';

// Set the simulated clock to `targetISO`. Stored as an offset from the real
// clock, so simulated time keeps advancing at 1x from that instant (app_now()
// adds the fixed offset to live now()). Admin-only, in every environment
// including production — enforced here (a clean error for the UI) AND at the
// database layer (dev_sim_clock_admin_gate, migration 20260805000001), which is
// the boundary that actually matters since this write goes through the
// service-role client.
export async function setSimClock(targetISO: string): Promise<DevClockResult> {
  const me = await getSessionUser();
  if (!isAdmin(me)) {
    return { ok: false, error: ADMIN_ONLY_ERROR };
  }
  const target = new Date(targetISO);
  if (Number.isNaN(target.getTime())) {
    return { ok: false, error: 'Invalid date/time.' };
  }
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

  // The offset is memoized process-wide (simClock.ts); drop it so the very next render
  // reads the value we just wrote instead of waiting out its TTL.
  invalidateSimOffset();
  revalidatePath('/', 'layout');
  return { ok: true, offsetSeconds };
}

// Reset to real wall-clock time (offset 0). Admin-only for consistency with setSimClock,
// even though the database itself always permits a reset to zero.
export async function clearSimClock(): Promise<DevClockResult> {
  const me = await getSessionUser();
  if (!isAdmin(me)) {
    return { ok: false, error: ADMIN_ONLY_ERROR };
  }
  const svc = createServiceClient();
  const { error } = await svc
    .from('dev_sim_clock')
    .update({ offset_seconds: 0, set_at: new Date().toISOString(), set_by: me?.userId ?? null })
    .eq('id', true);
  if (error !== null) return { ok: false, error: error.message };

  invalidateSimOffset();
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

// The slice of the world one tick can touch, derived from the simulated clock.
//
// Both halves of the diff used to be UNBOUNDED selects of float_assignments and
// block_step_status. That is fine while those tables are empty and quietly wrong once
// they are not: PostgREST caps a response at 1000 rows (db-max-rows), so past that the
// "before" snapshot silently loses rows and the modal starts reporting steps as newly
// fired that fired days ago. Bounding it is both the correctness fix and the reason this
// action stops getting slower as the tables grow.
//
// The bound is derived from state, not from a wall clock, so it survives the rewindable
// simulated clock: the orchestrator only ever fires steps for blocks inside its
// LOOKAHEAD_MINUTES (3h05m) horizon, and only ever touches floats that are still
// unresolved or were created moments ago by this very tick.
type TickWindow = { blockFromISO: string; blockToISO: string; floatFromISO: string };

const HORIZON_BEFORE_MS = 60 * 60 * 1000; // a step fired just before `now` is still ours
const HORIZON_AFTER_MS = 4 * 60 * 60 * 1000; // > the orchestrator's 3h05m lookahead
const FLOAT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

async function tickWindow(): Promise<TickWindow> {
  const now = (await simNow()).getTime();
  return {
    blockFromISO: new Date(now - HORIZON_BEFORE_MS).toISOString(),
    blockToISO: new Date(now + HORIZON_AFTER_MS).toISOString(),
    floatFromISO: new Date(now - FLOAT_LOOKBACK_MS).toISOString(),
  };
}

// Every float this tick could plausibly create or void: one that is still unresolved
// (only a pending/acknowledged float can be voided) or one created inside the lookback,
// which is what a float created by THIS tick looks like on the "after" read once its
// status has already moved to voided.
function floatWindowFilter(w: TickWindow): string {
  return `status.in.(pending,acknowledged),created_at.gte.${w.floatFromISO}`;
}

// Step rows for blocks inside the escalation horizon. The !inner embed turns the block
// time range into a join filter, so this stays one round trip.
function stepsInWindow(svc: Svc, w: TickWindow) {
  return svc
    .from('block_step_status')
    .select('block_id, step_name, shift_blocks!inner(block_start_at)')
    .gte('shift_blocks.block_start_at', w.blockFromISO)
    .lte('shift_blocks.block_start_at', w.blockToISO);
}

// Read the "before" state so the post-tick diff can tell what the tick created
// (new floats / newly-fired steps) versus what already existed.
async function snapshotForTick(svc: Svc, w: TickWindow): Promise<TickSnapshot> {
  const [floats, steps] = await Promise.all([
    svc.from('float_assignments').select('float_id, status').or(floatWindowFilter(w)),
    stepsInWindow(svc, w),
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
    .map(([houseId, starts]) => ({
      houseId,
      houseName: houseName(houseId),
      spans: mergeSpans(starts),
    }))
    .sort((a, b) => a.houseName.localeCompare(b.houseName));
}

// Diff DB state around the tick and describe every coverage action it took.
async function collectTickCoverage(
  svc: Svc,
  before: TickSnapshot,
  w: TickWindow,
): Promise<TickCoverage> {
  const empty: TickCoverage = { floats: [], allied: [], broadcasts: [], voided: [] };
  const [floatsAfter, stepsAfter, housesRes] = await Promise.all([
    svc
      .from('float_assignments')
      .select('float_id, user_id, status, destination_assignment_ids')
      .or(floatWindowFilter(w)),
    stepsInWindow(svc, w),
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
  const alliedBlockIds = newSteps
    .filter((s) => s.step_name === 'hmod_notify_allied')
    .map((s) => s.block_id);
  const broadcastBlockIds = newSteps
    .filter((s) => s.step_name === 'broadcast')
    .map((s) => s.block_id);

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
// real-time waits. Admin-only, same as the clock setter (it lives in the same card).
//
// Unlike force-trigger (which the EF authorises from the signed-in user's token),
// the orchestrator runs as the system: it authenticates with the service-role key
// (the EF requires Authorization === service role), exactly like the cron caller.
export async function runOrchestratorTick(): Promise<OrchestratorTickResult> {
  const me = await getSessionUser();
  if (!isAdmin(me)) {
    return { ok: false, error: ADMIN_ONLY_ERROR };
  }

  // Snapshot state BEFORE the tick so we can attribute new floats / fired steps
  // to this run (diff-based, immune to the rewindable simulated clock).
  const svc = createServiceClient();
  const window = await tickWindow();
  const before = await snapshotForTick(svc, window);

  let body: unknown;
  let status = 0;
  try {
    // ONE api key, in the Authorization header, and nothing in `apikey`.
    //
    // This used to send `Authorization: Bearer <service role>` AND `apikey: <anon>`.
    // Under the sb_publishable_* / sb_secret_* key format the gateway rejects a request
    // carrying two DIFFERENT API keys outright ("Conflicting API keys", HTTP 401) before
    // the function ever boots, so every tick fired from this panel 401'd in ~2ms and the
    // orchestrator never ran even once. The other Edge call sites in this app are fine
    // and must NOT be changed to match: they send a USER JWT in Authorization plus the
    // publishable key in `apikey`, which is the supported pairing. This one is different
    // precisely because it authenticates AS the system, exactly like the pg_cron caller,
    // which also sends Authorization alone.
    const res = await fetch(`${SUPABASE_URL}/functions/v1/orchestrator-tick`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    status = res.status;
    body = await res.json();
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not reach the orchestrator.',
    };
  }

  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: `Unexpected orchestrator response (HTTP ${status}).` };
  }
  const b = body as Record<string, unknown>;

  // A real tick ALWAYS carries tickedAt (the Edge Function stamps it from app_now()),
  // including the HTTP 500 it returns when a pass errored — that response is a genuine
  // summary and must still be shown. Anything without it is an envelope failure: a
  // gateway 401, a 404, a boot error. Report it. Reading the counts optimistically off
  // such a body used to render a perfectly plausible "0 scanned · 0 fired · 0 voided"
  // success stamped with the REAL clock, which is exactly how a hard 401 masqueraded as
  // "the orchestrator ran and found nothing to do".
  if (typeof b.tickedAt !== 'string') {
    const detail =
      typeof b.error === 'string'
        ? b.error
        : typeof b.message === 'string'
          ? b.message
          : JSON.stringify(b).slice(0, 200);
    return { ok: false, error: `Orchestrator did not run (HTTP ${status}): ${detail}` };
  }

  const summary: OrchestratorTickSummary = {
    tickedAt: b.tickedAt,
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
    coverage = await collectTickCoverage(svc, before, window);
  } catch {
    // Coverage detail is best-effort; the counts summary still stands.
  }

  // A tick may have created/voided floats, fired steps, or routed escalations —
  // refresh every server component (coverage board, inbox, dashboard) so the
  // operator sees the result immediately.
  revalidatePath('/', 'layout');
  return { ok: true, summary, coverage };
}
