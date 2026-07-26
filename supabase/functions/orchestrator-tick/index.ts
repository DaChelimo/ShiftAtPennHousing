import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Float-lookup subsystem. Extracted 2026-07-26 during the cost-audit work: index.ts was
// already 1,346 lines, more than twice the AGENTS.md ceiling, and the "extract the
// section you touched on your way out" rule applies. loadCoveredBlockIds moved WITH it
// and is unchanged — it is the coverage-floor-of-one invariant and both of its call
// sites are non-negotiable (audit §5 item 2).
import {
  floatLookupStep,
  lockBlockCoverage,
  type BlockRef,
  type RuntimeConfig,
  type VacantAssignment,
} from './floatLookup.ts';

const TIMEZONE = 'America/New_York';
const LOOKAHEAD_MINUTES = 3 * 60 + 5;
const DEFAULT_NO_ACK_LOOKAHEAD_MINUTES = 15;
const DEFAULT_BLOCK_MINUTES = 30;
const DEFAULT_FLOAT_RETENTION_DAYS = 14;
// Off-hours Allied-page ladder (staggered-rollout pilot): minutes a rung waits for an
// acknowledgment before the ladder advances (responsible worker -> SM -> desk).
// Customizable via system_config('allied_page_rung_timeout_minutes').
const DEFAULT_LADDER_TIMEOUT_MINUTES = 10;
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Supabase = ReturnType<typeof createClient>;
type TickSummary = {
  tickedAt: string;
  blocksScanned: number;
  stepsFired: number;
  floatsVoided: number;
  swapsExpired: number;
  laddersAdvanced: number;
  errors: string[];
};
type StepStatus = 'fired' | 'completed_via_force_trigger' | 'rolled_back';
type StepStatusMap = Record<string, StepStatus>;
type ChainStep = {
  stepName: string;
  offsetMinutes: number;
  trigger?: 'on_float_failure';
};
type ChainStepEvaluation = {
  stepName: string;
  trigger?: 'on_float_failure';
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function loadRuntimeConfig(supabase: Supabase): Promise<RuntimeConfig> {
  const { data, error } = await supabase
    .from('system_config')
    .select('config_key, config_value')
    .in('config_key', [
      'shift_block_minutes',
      'float_retention_days',
      'ack_deadline_offset_minutes',
      'no_ack_trigger_offset_minutes',
      'allied_page_rung_timeout_minutes',
    ]);
  if (error !== null) throw error;

  const values = new Map((data ?? []).map((row) => [row.config_key, row.config_value]));
  const ackDeadlineMinutes = parsePositiveInteger(values.get('ack_deadline_offset_minutes'), 10);
  const noAckTriggerMinutes = parsePositiveInteger(values.get('no_ack_trigger_offset_minutes'), 5);
  return {
    blockMinutes: parsePositiveInteger(values.get('shift_block_minutes'), DEFAULT_BLOCK_MINUTES),
    floatRetentionDays: parsePositiveInteger(
      values.get('float_retention_days'),
      DEFAULT_FLOAT_RETENTION_DAYS,
    ),
    noAckLookaheadMinutes:
      ackDeadlineMinutes + noAckTriggerMinutes || DEFAULT_NO_ACK_LOOKAHEAD_MINUTES,
    ladderTimeoutMinutes: parsePositiveInteger(
      values.get('allied_page_rung_timeout_minutes'),
      DEFAULT_LADDER_TIMEOUT_MINUTES,
    ),
  };
}

function localParts(
  date: Date,
  timezone: string,
): {
  year: number;
  month: number;
  day: number;
  weekday: number;
  msSinceMidnight: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = get('hour');
  const minute = get('minute');
  const second = get('second');

  return {
    year,
    month,
    day,
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    msSinceMidnight: ((hour * 60 + minute) * 60 + second) * 1000 + date.getMilliseconds(),
  };
}

function localDateIso(date: Date, timezone = TIMEZONE): string {
  const parts = localParts(date, timezone);
  return [
    String(parts.year).padStart(4, '0'),
    String(parts.month).padStart(2, '0'),
    String(parts.day).padStart(2, '0'),
  ].join('-');
}

function parseOffsetMinutes(offset: unknown): number {
  if (typeof offset === 'number') {
    return offset;
  }
  if (typeof offset !== 'string') {
    throw new Error(`invalid escalation offset: ${String(offset)}`);
  }

  const match = offset.trim().match(/^(-?\d+)\s*(second|seconds|minute|minutes|hour|hours)$/i);
  if (match === null) {
    throw new Error(`invalid escalation offset: ${offset}`);
  }

  const amount = Number(match[1]);
  const unit = match[2]!.toLowerCase();
  if (unit.startsWith('hour')) {
    return amount * 60;
  }
  if (unit.startsWith('second')) {
    return amount / 60;
  }
  return amount;
}

function parseEscalationChain(value: unknown): ChainStep[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((raw) => {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error('invalid escalation chain step');
    }
    const step = raw as { step?: unknown; stepName?: unknown; offset?: unknown; trigger?: unknown };
    const stepName = step.stepName ?? step.step;
    if (typeof stepName !== 'string') {
      throw new Error('invalid escalation chain step name');
    }

    const parsed: ChainStep = {
      stepName,
      offsetMinutes: parseOffsetMinutes(step.offset),
    };
    if (step.trigger === 'on_float_failure') {
      parsed.trigger = 'on_float_failure';
    }
    return parsed;
  });
}

// C6a: delegate to the canonical, unit-tested implementation in
// packages/core/src/orchestrator/evaluate.ts (covered by escalation-timing.test.ts),
// using the same dynamic-import pattern as findFloaters. This removes the
// previously-duplicated inline copy so the deployed orchestrator runs exactly
// the logic the tests exercise.
async function evaluateChainSteps(params: {
  blockStartAt: Date;
  now: Date;
  chain: ChainStep[];
  stepStatus: StepStatusMap;
}): Promise<ChainStepEvaluation[]> {
  const module = (await import('../../../packages/core/dist/orchestrator/evaluate.js')) as {
    evaluateChainSteps: (input: {
      blockStartAt: Date;
      now: Date;
      chain: ChainStep[];
      stepStatus: StepStatusMap;
    }) => ChainStepEvaluation[];
  };
  return module.evaluateChainSteps(params);
}

type BlockProfile = { profileName: string; chain: ChainStep[]; floatEnabled: boolean };

// Per-tick memo for loadProfileForBlock, keyed by the block's NY-local date.
//
// Cost audit F-04(ii): the profile lookup is TWO queries (operating_calendar then
// operating_profiles) and it was issued once per vacant assignment ROW. Every row in a
// 3h05m window resolves to the same one or two NY dates, so those two queries were being
// re-run near-identically dozens of times a tick. The answer depends only on the date,
// so one entry per date is exact, not approximate.
//
// Scoped to a single tick (created in the request handler, passed down, discarded when
// the response is written) so a config change between ticks is picked up immediately.
// `null` is a real, cacheable answer -- it means "no calendar row for that date" -- so
// the map stores the promise rather than the value, which also collapses concurrent
// lookups for the same date into one round trip.
type ProfileCache = Map<string, Promise<BlockProfile | null>>;

function loadProfileForBlockCached(
  supabase: Supabase,
  blockStartAt: Date,
  cache: ProfileCache,
): Promise<BlockProfile | null> {
  const blockDate = localDateIso(blockStartAt);
  const cached = cache.get(blockDate);
  if (cached !== undefined) {
    return cached;
  }
  const pending = loadProfileForBlock(supabase, blockStartAt);
  cache.set(blockDate, pending);
  return pending;
}

async function loadProfileForBlock(
  supabase: Supabase,
  blockStartAt: Date,
): Promise<BlockProfile | null> {
  const blockDate = localDateIso(blockStartAt);
  const { data: calendar, error: calendarError } = await supabase
    .from('operating_calendar')
    .select('profile_name')
    .eq('date', blockDate)
    .maybeSingle();

  if (calendarError !== null || calendar === null) {
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from('operating_profiles')
    .select('profile_name, escalation_chain, float_enabled')
    .eq('profile_name', calendar.profile_name)
    .single();

  if (profileError !== null || profile === null) {
    throw profileError ?? new Error(`profile not found: ${calendar.profile_name}`);
  }

  return {
    profileName: profile.profile_name,
    chain: parseEscalationChain(profile.escalation_chain),
    floatEnabled: profile.float_enabled,
  };
}

// Step status for MANY blocks in one pass (cost audit F-04(iii)).
//
// The per-block loadStepStatus this replaces was called once per vacant assignment row
// -- one round trip each, for a
// table whose primary key is (block_id, step_name). Fetching the whole window up front
// costs one request per 100 blocks instead of one per row. Chunked at the same CHUNK=100
// as loadCoveredBlockIds: a full lookahead window of block ids in a single .in() filter
// returns HTTP 414 ("URI too long"), which is the same trap selectByBlockIdChunks exists
// for on the web side.
//
// A block with no rows yet is absent from the result; callers must treat a missing entry
// as an empty StepStatusMap, which is exactly what the per-block query returned for it.
async function loadStepStatusForBlocks(
  supabase: Supabase,
  blockIds: string[],
): Promise<Map<string, StepStatusMap>> {
  const byBlock = new Map<string, StepStatusMap>();
  const CHUNK = 100;
  for (let start = 0; start < blockIds.length; start += CHUNK) {
    const chunk = blockIds.slice(start, start + CHUNK);
    if (chunk.length === 0) {
      continue;
    }
    const { data, error } = await supabase
      .from('block_step_status')
      .select('block_id, step_name, status')
      .in('block_id', chunk);
    if (error !== null) {
      throw error;
    }
    for (const row of data ?? []) {
      const existing = byBlock.get(row.block_id) ?? {};
      existing[row.step_name] = row.status as StepStatus;
      byBlock.set(row.block_id, existing);
    }
  }
  return byBlock;
}

async function claimStep(
  supabase: Supabase,
  blockId: string,
  stepName: string,
  now: Date,
): Promise<boolean> {
  const nowIso = now.toISOString();
  const { data: updated, error: updateError } = await supabase
    .from('block_step_status')
    .update({ status: 'fired', fired_at: nowIso, updated_at: nowIso })
    .eq('block_id', blockId)
    .eq('step_name', stepName)
    .eq('status', 'rolled_back')
    .select('block_id')
    .maybeSingle();

  if (updateError !== null) {
    throw updateError;
  }
  if (updated !== null) {
    return true;
  }

  const { data: inserted, error: insertError } = await supabase
    .from('block_step_status')
    .upsert(
      {
        block_id: blockId,
        step_name: stepName,
        status: 'fired',
        fired_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: 'block_id,step_name', ignoreDuplicates: true },
    )
    .select('block_id');

  if (insertError !== null) {
    throw insertError;
  }

  return (inserted?.length ?? 0) > 0;
}

// B-1 audit fix (broadcast portion): the claim INSERT and the
// notification INSERTs are now performed atomically inside the
// process_broadcast_step RPC. The Edge Function side is a thin
// wrapper that surfaces `claimed` to the chain loop.
async function broadcastStep(supabase: Supabase, block: BlockRef, firedAt: Date): Promise<boolean> {
  const { data, error } = await supabase.rpc('process_broadcast_step', {
    p_block_id: block.blockId,
    p_house_id: block.houseId,
    p_block_start_at: block.blockStartAt.toISOString(),
    p_now: firedAt.toISOString(),
  });

  if (error !== null) {
    throw error;
  }

  return (data as { claimed?: boolean } | null)?.claimed === true;
}

// B-1 audit fix (hmod portion): the recipient resolution and the
// notification INSERT now happen atomically inside the
// process_hmod_notify_allied_step RPC, alongside the chain step
// claim. The Edge Function side is a thin wrapper that surfaces
// `claimed` to the chain loop.
//
// Recipient resolution helpers (resolve_hm_for_user,
// resolve_hm_for_house, resolve_hmod_on_duty, is_hm_working_time)
// were moved into SQL in migration 20260528000004; the TS-side helpers
// they replaced have been deleted.
async function hmodNotifyAlliedStep(
  supabase: Supabase,
  block: BlockRef,
  firedAt: Date,
  reason = 'escalation_chain',
): Promise<boolean> {
  // §5.5: securing-tier step on an empty desk → lock its seats (one-way).
  await lockBlockCoverage(supabase, block.blockId, firedAt);

  const { data, error } = await supabase.rpc('process_hmod_notify_allied_step', {
    p_block_id: block.blockId,
    p_house_id: block.houseId,
    p_block_start_at: block.blockStartAt.toISOString(),
    p_now: firedAt.toISOString(),
    p_reason: reason,
  });

  if (error !== null) {
    throw error;
  }

  return (data as { claimed?: boolean } | null)?.claimed === true;
}

async function hasActiveFloatForBlock(supabase: Supabase, blockId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('shift_block_assignments')
    .select('assignment_id')
    .eq('block_id', blockId)
    .in('status', ['pending_float_in', 'floated_in'])
    .limit(1);

  if (error !== null) {
    throw error;
  }
  return (data?.length ?? 0) > 0;
}

// Dispatcher for chain steps.
//
// Per-step atomicity model after the B-1 + B-2 audit fixes:
//
//   - broadcast            → process_broadcast_step RPC (claims +
//                            inserts notifications atomically).
//   - hmod_notify_allied   → process_hmod_notify_allied_step RPC
//                            (claims + resolves recipient + inserts
//                            notification atomically).
//   - float_lookup         → claim block_step_status first via
//                            claimStep helper, then call the
//                            process_float_lookup_assignment RPC per
//                            assignment (each is atomic). The TS-side
//                            algorithm runs between claim and write
//                            calls; failure between leaves the chain
//                            step claimed but no float assignment,
//                            which the next tick correctly routes to
//                            hmod_notify_allied.
//
// Returns:
//   'float_assigned' — at least one floater was successfully assigned.
//   'no_float'       — float_lookup returned nothing or every
//                      candidate's destination was concurrently filled.
//   'done'           — broadcast / hmod completed.
//   'skipped'        — chain step was already claimed elsewhere (race).
async function fireStep(params: {
  supabase: Supabase;
  block: VacantAssignment;
  profileName: string;
  stepName: string;
  firedAt: Date;
  config: RuntimeConfig;
}): Promise<'float_assigned' | 'no_float' | 'done' | 'skipped'> {
  switch (params.stepName) {
    case 'broadcast': {
      const claimed = await broadcastStep(params.supabase, params.block, params.firedAt);
      return claimed ? 'done' : 'skipped';
    }
    case 'float_lookup':
      return await floatLookupStep(
        params.supabase,
        params.block,
        params.profileName,
        params.firedAt,
        params.config,
      );
    case 'hmod_notify_allied': {
      const claimed = await hmodNotifyAlliedStep(params.supabase, params.block, params.firedAt);
      return claimed ? 'done' : 'skipped';
    }
    default:
      return 'done';
  }
}

async function processVacantBlocks(
  supabase: Supabase,
  now: Date,
  config: RuntimeConfig,
  profileCache: ProfileCache,
): Promise<{ blocksScanned: number; stepsFired: number }> {
  // Cost audit F-04(i). The scan moved into orchestrator_vacant_seats so it can apply
  // the staggered-launch gate (house_is_live) that this function never consulted. Under
  // a Harnwell-only pilot that takes the 30-day window from 10,461 seats across 13
  // houses to 61 seats in 1 -- and, more importantly, stops the chain firing broadcast /
  // float / Allied against desks nobody has opened. It is a no-op when
  // system_config('staggered_launch_enabled') is unset or false, which is every dev seed
  // and the whole test suite.
  //
  // The RPC also returns desk_covered per row, which is why there is no longer a
  // separate loadCoveredBlockIds round trip HERE. Read carefully: the coverage CHECK is
  // unchanged and still runs on every row below. Only where the boolean is computed
  // moved -- from a second PostgREST query into the same scan -- over the identical
  // present-status set (scheduled/claimed/floated_in/pending_float_in/allied). This is
  // the coverage-floor-of-one invariant (BSpec §5.4) and it is NOT weakened:
  // loadCoveredBlockIds itself is untouched and still guards the gap builder in
  // loadVacantGap, which is its other, independent call site.
  const { data, error } = await supabase.rpc('orchestrator_vacant_seats', {
    p_after: now.toISOString(),
    p_through: addMinutes(now, LOOKAHEAD_MINUTES).toISOString(),
  });

  if (error !== null) {
    throw error;
  }

  const rows = (data ?? []) as Array<{
    assignment_id: string;
    block_id: string;
    block_start_at: string;
    house_id: string;
    desk_covered: boolean;
  }>;

  // F-04(iii): one batched read of block_step_status for the whole window, instead of
  // one round trip per row. Only uncovered blocks can fire a step, so only they are
  // worth fetching.
  const actionableBlockIds = [
    ...new Set(rows.filter((row) => !row.desk_covered).map((row) => row.block_id)),
  ];
  const stepStatusByBlock = await loadStepStatusForBlocks(supabase, actionableBlockIds);

  let fired = 0;
  for (const row of rows) {
    // Skip blocks whose desk is already staffed: the coverage chain fires only to
    // keep a desk from being EMPTY (BEHAVIORAL_SPECIFICATION §5.4), never to backfill
    // vacant seats to the full headcount. A triple-staffed Quad evening with one
    // worker still on needs no broadcast/float/Allied for its other two seats.
    if (row.desk_covered) {
      continue;
    }

    const block: VacantAssignment = {
      assignmentId: row.assignment_id,
      blockId: row.block_id,
      blockStartAt: new Date(row.block_start_at),
      houseId: row.house_id,
    };
    // F-04(ii): memoised per NY date for the duration of this tick.
    const profile = await loadProfileForBlockCached(supabase, block.blockStartAt, profileCache);
    if (profile === null) {
      continue;
    }

    // A block with no block_step_status rows yet is absent from the batch, which means
    // the same thing the per-block query's empty result meant: no step has fired.
    const stepStatus = stepStatusByBlock.get(block.blockId) ?? {};
    const dueSteps = await evaluateChainSteps({
      blockStartAt: block.blockStartAt,
      now,
      chain: profile.chain,
      stepStatus,
    });

    let floatAssignedThisTick = false;
    for (const step of dueSteps) {
      if (
        step.trigger === 'on_float_failure' &&
        (floatAssignedThisTick || (await hasActiveFloatForBlock(supabase, block.blockId)))
      ) {
        continue;
      }

      // float_lookup still requires the orchestrator-side claim
      // because the algorithm runs in TypeScript and cannot be wrapped
      // in a single SQL transaction. broadcast and hmod_notify_allied
      // claim inside their RPCs (B-1 audit fix), so we skip the
      // claimStep round-trip for them.
      if (step.stepName === 'float_lookup') {
        const claimed = await claimStep(supabase, block.blockId, step.stepName, now);
        if (!claimed) {
          continue;
        }
      }

      const outcome = await fireStep({
        supabase,
        block,
        profileName: profile.profileName,
        stepName: step.stepName,
        firedAt: now,
        config,
      });

      if (outcome === 'skipped') {
        continue;
      }
      fired += 1;

      if (outcome === 'float_assigned') {
        floatAssignedThisTick = true;
      }
      if (
        outcome === 'no_float' &&
        !dueSteps.some((candidate) => candidate.stepName === 'hmod_notify_allied')
      ) {
        const claimed = await hmodNotifyAlliedStep(supabase, block, now, 'float_lookup_failed');
        if (claimed) {
          fired += 1;
        }
      }
    }
  }

  return { blocksScanned: rows.length, stepsFired: fired };
}

type NoAckRpcResult = {
  processed: boolean;
  block_id?: string;
  block_start_at?: string;
  house_id?: string;
  hmod_step_claimed?: boolean;
  reason?: string;
};

async function processNoAckFloats(
  supabase: Supabase,
  now: Date,
  config: RuntimeConfig,
): Promise<number> {
  // Cost audit F-06. This used to select EVERY pending, unacknowledged, undeclined
  // float with NO time bound, then issue one destination-blocks round trip per float,
  // and only then apply the lookahead filter in TypeScript — so the cheap temporal
  // filter that eliminates almost every row was paid for after a round trip each. (The
  // old comment here claimed it was a "pre-filter by lookahead", which the query did not
  // do.) It was also a seq scan every 60 seconds: float_assignments' only index leads
  // with user_id, which this query does not constrain.
  //
  // pending_floats_due_for_no_ack does the join to shift_blocks in SQL and returns only
  // the floats whose EARLIEST destination block is inside the window — the same set the
  // loop computed — in one indexed query (float_assignments_pending_unacked_idx).
  //
  // process_no_ack_float below is unchanged and still re-validates under FOR UPDATE, so
  // the no-takeback invariant is untouched; only candidate DISCOVERY got cheaper.
  const { data: floats, error } = await supabase.rpc('pending_floats_due_for_no_ack', {
    p_now: now.toISOString(),
    p_lookahead_minutes: config.noAckLookaheadMinutes,
  });

  if (error !== null) {
    throw error;
  }

  let processed = 0;
  for (const floatRow of (floats ?? []) as Array<{ float_id: string }>) {
    // Atomic write — single transaction in the RPC. After the B-1
    // audit fix the RPC also INSERTs the HMOD-for-Allied notification
    // inside the same transaction (using the SQL recipient-resolution
    // helpers introduced in migration 20260528000004), so the
    // Edge Function no longer fans out to hmodNotifyAlliedStep on this
    // path.
    const { data: rpcResult, error: rpcError } = await supabase.rpc('process_no_ack_float', {
      p_float_id: floatRow.float_id,
      p_now: now.toISOString(),
      p_lookahead_minutes: config.noAckLookaheadMinutes,
    });
    if (rpcError !== null) {
      throw rpcError;
    }

    const outcome = (rpcResult ?? null) as NoAckRpcResult | null;
    if (outcome === null || outcome.processed !== true) {
      continue;
    }
    processed += 1;
  }

  return processed;
}

// Off-hours Allied-page ladder advance pass (staggered-rollout pilot). Resolves gaps
// that started or got covered and advances any unacknowledged rung whose timeout
// elapsed to the next rung (responsible worker -> SM -> desk). All logic — recipient
// resolution, cleanup, the SKIP LOCKED advance — lives in the RPC; this is a thin
// wrapper. Inert when the master switch is off: no ladder rows exist, so it no-ops.
async function processOffhoursLadder(
  supabase: Supabase,
  now: Date,
  config: RuntimeConfig,
): Promise<number> {
  const { data, error } = await supabase.rpc('advance_offhours_allied_ladder', {
    p_now: now.toISOString(),
    p_timeout_minutes: config.ladderTimeoutMinutes,
  });
  if (error !== null) {
    throw error;
  }
  return typeof data === 'number' ? data : 0;
}

async function expirePendingSwaps(supabase: Supabase, now: Date): Promise<number> {
  // Cost audit F-10. The `swap-expiry` pg_cron job and this function ran the identical
  // UPDATE every minute; whichever went second updated zero rows. This copy was also
  // strictly more expensive, because `.select('swap_id')` forced a RETURNING and shipped
  // the rows back just to populate summary.swapsExpired.
  //
  // Deleting this outright would break development, where pg_cron is NOT installed and
  // this is the only thing expiring a swap. So the RPC decides: it defers to the cron
  // when the job exists (returning -1), and does the work itself when it does not. Row
  // count comes from GET DIAGNOSTICS, so nothing is shipped back either way.
  const { data, error } = await supabase.rpc('expire_pending_swaps_if_uncronned', {
    p_now: now.toISOString(),
  });

  if (error !== null) {
    // swap_requests is specified in architecture but not introduced by
    // the earlier committed migrations in this branch. Keep the tick alive
    // until that table lands.
    if (String(error.message).includes('swap_requests')) {
      return 0;
    }
    throw error;
  }

  // -1 means "the cron owns this", which is not an error and not an expiry.
  return typeof data === 'number' && data > 0 ? data : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function recordHealth(supabase: Supabase, summary: TickSummary): Promise<void> {
  const { error } = await supabase.from('orchestrator_health').upsert(
    {
      singleton: true,
      last_tick_at: summary.tickedAt,
      blocks_scanned: summary.blocksScanned,
      steps_fired: summary.stepsFired,
      floats_voided: summary.floatsVoided,
      swaps_expired: summary.swapsExpired,
      errors: summary.errors,
    },
    { onConflict: 'singleton' },
  );
  if (error !== null) throw error;
}

// Source the orchestrator's "now" from the database app_now() so a dev simulated
// clock (dev_sim_clock offset) fast-forwards every escalation step. app_now()
// equals now() when the offset is 0, so production ticks are unaffected. Falls
// back to wall-clock time if the RPC is unavailable.
async function fetchAppNow(supabase: Supabase): Promise<Date> {
  try {
    const { data, error } = await supabase.rpc('app_now');
    if (error === null && typeof data === 'string') {
      const parsed = new Date(data);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  } catch {
    // fall through to wall clock
  }
  return new Date();
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (supabaseUrl === undefined || serviceRoleKey === undefined) {
    return jsonResponse({ error: 'Server configuration error' }, 500);
  }

  const token = req.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (token !== serviceRoleKey) {
    return jsonResponse({ error: 'Authentication required' }, 401);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const now = await fetchAppNow(supabase);
  const summary: TickSummary = {
    tickedAt: now.toISOString(),
    blocksScanned: 0,
    stepsFired: 0,
    floatsVoided: 0,
    swapsExpired: 0,
    laddersAdvanced: 0,
    errors: [],
  };

  let runtimeConfig: RuntimeConfig = {
    blockMinutes: DEFAULT_BLOCK_MINUTES,
    floatRetentionDays: DEFAULT_FLOAT_RETENTION_DAYS,
    noAckLookaheadMinutes: DEFAULT_NO_ACK_LOOKAHEAD_MINUTES,
    ladderTimeoutMinutes: DEFAULT_LADDER_TIMEOUT_MINUTES,
  };
  try {
    runtimeConfig = await loadRuntimeConfig(supabase);
  } catch (error) {
    summary.errors.push(`system_config: ${errorMessage(error)}`);
  }

  // The vacant/float-lookup pass and swap-expiry are independent — run them
  // together. The no-ack pass must run AFTER the vacant pass, not concurrently:
  // a float ASSIGNED by float-lookup this tick whose acknowledgment window is
  // already in the past (a gap discovered or reopened inside T-15m) must be
  // voided in the SAME tick and routed to HMOD-for-Allied (BSpec §7.3). Run
  // concurrently (the prior behavior), the no-ack pass reads a snapshot taken
  // before float-lookup inserts those rows, so it cannot see them; the float
  // then lingers in `pending_float_in` — falsely showing the desk covered —
  // until a later tick. With manual-only orchestration (no pg_cron) that later
  // tick may be arbitrarily far away or never arrive. Sequencing makes the pass
  // read a fresh snapshot that includes the just-created float. Normal T-2h
  // floats are untouched: their start is > now + noAckLookahead, so they fall
  // outside the no-ack window and are never voided early.
  // Per-tick profile memo (F-04(ii)). Created here and discarded with the response, so a
  // config change between ticks takes effect on the very next tick.
  const profileCache: ProfileCache = new Map();

  // Overlap guard (audit §2.1). cron.schedule does not stop a second run starting while
  // the first is going, and although net.http_post is fire-and-forget — so the cron row
  // itself cannot overlap — the Edge Function invocations it triggers absolutely can, and
  // a tick is on the order of a second or more of DB time.
  //
  // Correctness never depended on this: block_step_status upserts and the FOR UPDATE
  // RPCs already make double-firing a step impossible. What overlapping ticks duplicate
  // is the COST — both scan, both resolve profiles, both read step status.
  //
  // Non-blocking on purpose. A blocking lock would queue ticks behind each other and turn
  // a slow minute into a growing backlog; skipping is correct, because the next tick is
  // 60 seconds away and re-evaluates everything from scratch. Best-effort: if the RPC is
  // unavailable the tick proceeds exactly as it did before, since this is an optimisation
  // and never a gate on escalation firing.
  try {
    const { data: acquired, error: lockError } = await supabase.rpc('try_orchestrator_tick_lock');
    if (lockError === null && acquired === false) {
      console.log(JSON.stringify({ event: 'orchestrator_tick_skipped', reason: 'tick_in_flight' }));
      return jsonResponse({ ok: true, skipped: true, reason: 'tick_in_flight', ...summary });
    }
  } catch {
    // fall through and tick
  }

  const [vacantResult, swapsResult] = await Promise.allSettled([
    processVacantBlocks(supabase, now, runtimeConfig, profileCache),
    expirePendingSwaps(supabase, now),
  ]);
  const [noAckResult] = await Promise.allSettled([
    processNoAckFloats(supabase, now, runtimeConfig),
  ]);
  // The ladder advance runs AFTER the vacant + no-ack passes: both may START a ladder
  // this tick (the off-hours hmod terminal / no-ack void), and advancing after them
  // lets a just-covered gap resolve. A ladder started this tick is never advanced now —
  // its rung_fired_at == now, so the timeout has not elapsed.
  const [ladderResult] = await Promise.allSettled([
    processOffhoursLadder(supabase, now, runtimeConfig),
  ]);
  if (vacantResult.status === 'fulfilled') {
    summary.blocksScanned = vacantResult.value.blocksScanned;
    summary.stepsFired = vacantResult.value.stepsFired;
  } else {
    summary.errors.push(`vacant_blocks: ${errorMessage(vacantResult.reason)}`);
  }
  if (noAckResult.status === 'fulfilled') {
    summary.floatsVoided = noAckResult.value;
  } else {
    summary.errors.push(`no_ack_floats: ${errorMessage(noAckResult.reason)}`);
  }
  if (swapsResult.status === 'fulfilled') {
    summary.swapsExpired = swapsResult.value;
  } else {
    summary.errors.push(`pending_swaps: ${errorMessage(swapsResult.reason)}`);
  }
  if (ladderResult.status === 'fulfilled') {
    summary.laddersAdvanced = ladderResult.value;
  } else {
    summary.errors.push(`offhours_ladder: ${errorMessage(ladderResult.reason)}`);
  }

  try {
    await recordHealth(supabase, summary);
  } catch (error) {
    summary.errors.push(`health_record: ${errorMessage(error)}`);
  }
  console.log(JSON.stringify({ event: 'orchestrator_tick', ...summary }));

  return jsonResponse(
    { ok: summary.errors.length === 0, ...summary },
    summary.errors.length ? 500 : 200,
  );
});
