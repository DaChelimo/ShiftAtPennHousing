import { fridayAnchor } from '@shift/core';

import { createServiceClient } from '../supabase/server';

export type RotorWeek = { weekStartDate: string; label: string };
export type RotorCandidate = { userId: string; name: string };

export type RotorData = {
  weeks: RotorWeek[];
  candidates: RotorCandidate[];
  assignments: Record<string, string>; // weekStartDate → hmod_user_id
};

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

// §2.5 HMOD rotor — weekly, one HMOD per week, planned by HMs/BMs. Reads use the
// service client (cross-house roster + the rotor table). Weeks span the current
// semester, anchored to the Friday-08:00 duty-week boundary
// (hmod_rotor.week_start_date — its CHECK requires isodow=5/Friday, matching
// resolve_hmod_on_duty's snap, so fridayAnchor keys both the displayed weeks and the
// saved key).
export async function getRotorData(): Promise<RotorData> {
  const svc = createServiceClient();

  const { data: periodRows } = await svc
    .from('scheduling_periods')
    .select('start_date, end_date')
    .order('start_date', { ascending: false })
    .limit(1);
  const period = periodRows?.[0] ?? null;

  const weeks: RotorWeek[] = [];
  if (period !== null) {
    let cursor = fridayAnchor(period.start_date);
    const end = period.end_date;
    // Guard against an unbounded loop on malformed dates.
    for (let i = 0; i < 60 && cursor <= end; i += 1) {
      weeks.push({ weekStartDate: cursor, label: `Week of ${cursor}` });
      cursor = addDays(cursor, 7);
    }
  }

  // Eligible HMODs: active HMs/BMs (the §2.5 planners are also the pool).
  const { data: roleRows } = await svc
    .from('user_roles')
    .select('user_id, role')
    .in('role', ['hm', 'bm']);
  const adminIds = [...new Set((roleRows ?? []).map((r) => r.user_id))];

  const { data: userRows } = await svc
    .from('users')
    .select('user_id, name, is_active')
    .in('user_id', adminIds.length > 0 ? adminIds : ['00000000-0000-0000-0000-000000000000']);
  const candidates: RotorCandidate[] = (userRows ?? [])
    .filter((u) => u.is_active)
    .map((u) => ({ userId: u.user_id, name: u.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

  const { data: rotorRows } = await svc.from('hmod_rotor').select('week_start_date, hmod_user_id');
  const assignments: Record<string, string> = {};
  for (const r of rotorRows ?? []) {
    assignments[r.week_start_date] = r.hmod_user_id;
  }

  return { weeks, candidates, assignments };
}
