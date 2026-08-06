import type { SupabaseClient } from '@supabase/supabase-js';

// Who the live calendar's inline-override picker (S1) may assign to, and their
// decision context. Extracted from calendar.ts on 2026-08-05 (that file is over the
// 600-line ceiling) because the candidate set stopped being "the home-house roster"
// and became a composed set with two pinned, rule-exempt identities.
//
// The ordinary population is this house's ACTIVE home workers. On a Harnwell
// calendar that satisfies the Harnwell training invariant by construction
// (TEST_PLAN D8), and everywhere it matches the same-house guard the
// admin_assign_worker RPC enforces authoritatively.
//
// Two entries are NOT ordinary roster rows and are flagged so the picker can pin
// them above the list:
//   * isRsm: the house's RSM (rsm role scoped to THIS house). Assignable to their
//     own house's desk since 20260729000002, exempt from every hours check, so
//     `weeklyHours` is informational and the picker shows no cap headroom.
//   * isAllied: the Allied contractor (20260725000001), whose home house is the
//     non-staffable pseudo-house `allied-house`. Assignable to ANY house's desk
//     since 20260805000002, including Harnwell. No home desk, no cap.
//
// Both are deduped OUT of the ordinary list, so each identity appears exactly once:
// the RSM is normally also a home-house row, and would otherwise render twice.
//
// `weeklyHours` is held hours across the viewed NY week, summed over ALL houses (a
// home worker may also hold a cross-house pickup that week).
export type AssignableWorker = {
  userId: string;
  name: string;
  isActive: boolean;
  weeklyHours: number;
  isRsm: boolean;
  isAllied: boolean;
};

type UserRow = { user_id: string; name: string; is_active: boolean };
type EmbeddedBlock = { block_start_at: string };
type HoursRow = { user_id: string | null; shift_blocks: EmbeddedBlock | EmbeddedBlock[] | null };

// PostgREST embeds a many-to-one relation as either an object or a 1-element array
// depending on the inference; normalize when reading the candidate's weekly hours.
function embeddedStartAt(row: HoursRow): string | null {
  const sb = row.shift_blocks;
  if (sb === null) return null;
  return Array.isArray(sb) ? (sb[0]?.block_start_at ?? null) : sb.block_start_at;
}

// Counting statuses for the weekly-hours number, mirroring lib/data/people.ts.
const HELD_STATUSES = ['scheduled', 'claimed', 'floated_in', 'pending_float_in'];

// NY wall-clock helpers. Kept local rather than imported from calendar.ts, which
// imports this module (a cycle), and rather than promoted to a shared module, which
// would be a wider refactor than this change earns. Same two mirrors already exist
// in calendar.ts and scheduleBuilder.ts; keep all three in step.
function nyDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/**
 * Load the override picker's candidate set for `houseId` in the NY week starting
 * `weekStartDate` (Monday, YYYY-MM-DD).
 *
 * Two internal waves, so this is safe to fire as one entry in the caller's own
 * wave-1 `Promise.all`: the three identity reads go out together, then the weekly
 * hours read (which needs their ids) follows and overlaps whatever the caller is
 * doing with blocks in the meantime.
 */
export async function loadAssignableWorkers(
  supabase: SupabaseClient,
  houseId: string,
  weekStartDate: string,
): Promise<AssignableWorker[]> {
  const weekEnd = addDays(weekStartDate, 7);

  const [rosterResult, rsmResult, alliedResult] = await Promise.all([
    // This house's home workers.
    supabase
      .from('users')
      .select('user_id, name, is_active')
      .eq('home_house_id', houseId)
      .order('name'),
    // The house's RSM, resolved from the ROLE scope rather than home_house_id, so it
    // matches admin_assign_worker's own v_is_rsm test exactly (20260729000002) even
    // if the two ever drift. Embeds the user row to keep this in one round trip.
    supabase
      .from('user_roles')
      .select('user_id, users!inner(user_id, name, is_active)')
      .eq('role', 'rsm')
      .eq('scope_house_id', houseId),
    // The Allied contractor. Keyed on the non-staffable pseudo-house rather than a
    // hardcoded id, matching user_is_allied_contractor (20260805000002).
    supabase
      .from('users')
      .select('user_id, name, is_active, houses!inner(is_staffable)')
      .eq('houses.is_staffable', false)
      .eq('is_active', true)
      .order('name'),
  ]);

  const roster = (rosterResult.data ?? []).filter((u) => u.is_active) as UserRow[];

  // PostgREST returns the embed as an object or a 1-element array depending on the
  // inference, same normalization as embeddedStartAt above.
  const rsmRows: UserRow[] = ((rsmResult.data ?? []) as { users: UserRow | UserRow[] | null }[])
    .flatMap((r) => (r.users === null ? [] : Array.isArray(r.users) ? r.users : [r.users]))
    .filter((u) => u.is_active);

  const allied = (alliedResult.data ?? []) as UserRow[];

  const rsmIds = new Set(rsmRows.map((u) => u.user_id));
  const alliedIds = new Set(allied.map((u) => u.user_id));

  // Pinned first, then the ordinary roster minus whoever was pinned.
  const ordered: AssignableWorker[] = [
    ...rsmRows.map((u) => toCandidate(u, { isRsm: true, isAllied: false })),
    ...allied.map((u) => toCandidate(u, { isRsm: false, isAllied: true })),
    ...roster
      .filter((u) => !rsmIds.has(u.user_id) && !alliedIds.has(u.user_id))
      .map((u) => toCandidate(u, { isRsm: false, isAllied: false })),
  ];
  if (ordered.length === 0) return [];

  // Weekly hours for everyone in the set. A ±12h UTC buffer on the query bound keeps
  // it DST-safe; the precise NY-week filter happens in JS below.
  const lo = new Date(
    new Date(`${weekStartDate}T00:00:00Z`).getTime() - 12 * 3600 * 1000,
  ).toISOString();
  const hi = new Date(new Date(`${weekEnd}T00:00:00Z`).getTime() + 12 * 3600 * 1000).toISOString();
  const { data: asg } = await supabase
    .from('shift_block_assignments')
    .select('user_id, shift_blocks!inner(block_start_at)')
    .in(
      'user_id',
      ordered.map((w) => w.userId),
    )
    .in('status', HELD_STATUSES)
    .gte('shift_blocks.block_start_at', lo)
    .lt('shift_blocks.block_start_at', hi);

  const blocksByUser = new Map<string, number>();
  for (const row of (asg ?? []) as unknown as HoursRow[]) {
    const startAt = embeddedStartAt(row);
    if (startAt === null || row.user_id === null) continue;
    const d = nyDate(startAt);
    if (d >= weekStartDate && d < weekEnd) {
      blocksByUser.set(row.user_id, (blocksByUser.get(row.user_id) ?? 0) + 1);
    }
  }

  return ordered.map((w) => ({ ...w, weeklyHours: (blocksByUser.get(w.userId) ?? 0) * 0.5 }));
}

function toCandidate(u: UserRow, flags: { isRsm: boolean; isAllied: boolean }): AssignableWorker {
  return {
    userId: u.user_id,
    name: u.name,
    isActive: u.is_active,
    weeklyHours: 0,
    isRsm: flags.isRsm,
    isAllied: flags.isAllied,
  };
}
