import { createClient } from '../../supabase/server';

// Light status summary for the worker home cards. Cheap queries only (no grids):
// enough to tell the worker whether there is something to act on.

const NY = 'America/New_York';

export type PreferencesSummary =
  | { state: 'none' }
  | { state: 'open' | 'submitted' | 'closed'; periodName: string; deadlineLabel: string | null };

export type BreaksSummary =
  | { state: 'none' }
  | { state: 'claim_open' | 'upcoming'; breakName: string };

export type WorkerHomeSummary = {
  preferences: PreferencesSummary;
  breaks: BreaksSummary;
};

function nyDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: NY,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function deadlineLabel(iso: string | null): string | null {
  if (iso === null) return null;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

export async function getWorkerHomeSummary(userId: string, now: Date): Promise<WorkerHomeSummary> {
  const supabase = await createClient();

  // Preferences.
  let preferences: PreferencesSummary = { state: 'none' };
  const { data: periods } = await supabase
    .from('scheduling_periods')
    .select('period_id, period_name, preference_deadline, published_at')
    .order('start_date', { ascending: false });
  const active = (periods ?? []).find((p) => p.published_at === null) ?? (periods ?? [])[0];
  if (active !== undefined) {
    const open =
      active.preference_deadline === null ||
      now.getTime() <= new Date(active.preference_deadline).getTime();
    const { count: prefCount } = await supabase
      .from('preferences')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('period_id', active.period_id);
    const { count: targetCount } = await supabase
      .from('period_targets')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('period_id', active.period_id);
    const submitted = (prefCount ?? 0) > 0 || (targetCount ?? 0) > 0;
    preferences = {
      state: !open ? 'closed' : submitted ? 'submitted' : 'open',
      periodName: active.period_name,
      deadlineLabel: deadlineLabel(active.preference_deadline),
    };
  }

  // Breaks.
  let breaks: BreaksSummary = { state: 'none' };
  const { data: breakRows } = await supabase
    .from('break_periods')
    .select('break_id, break_name, start_date, end_date')
    .gte('end_date', nyDate(now.toISOString()))
    .order('start_date', { ascending: true })
    .limit(1);
  const brk = (breakRows ?? [])[0];
  if (brk !== undefined) {
    const { data: phase } = await supabase.rpc('break_claim_phase', {
      p_break_id: brk.break_id,
      p_as_of: now.toISOString(),
    });
    if (phase === 'claim_window') breaks = { state: 'claim_open', breakName: brk.break_name };
    else if (phase === 'pre_open') breaks = { state: 'upcoming', breakName: brk.break_name };
  }

  return { preferences, breaks };
}
