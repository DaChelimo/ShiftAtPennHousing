// Which season/week the schedule builder is pointed at.
//
// Shared by getBuilderData (the manual + preference builder) and
// getAiScheduleContext (the AI generator) so the two can never disagree about
// what is being built — they did, and that is the bug this file exists to close.
//
// Both used to anchor on "the week of the EARLIEST block this house has", an
// all-time min with no relation to now. That is correct only while a house has
// exactly one season of blocks materialized. Once a second season is applied,
// the anchor stays pinned to the OLDEST one forever: with Summer (opens 05:30)
// and Fall (opens 08:00) both live, an admin preparing Fall got a June week at
// 05:30, the summer period's preferences (9 submitters instead of Fall's 26),
// and a Publish button wired to the summer period.
//
// The anchor is therefore the SEASON first, the week second: pick the period
// being built, then take its first week at this house. `publish_schedule`
// already works this way (it iterates blocks BETWEEN the period's start_date
// and end_date), so this only makes the builder agree with the operation it
// feeds.

import type { SupabaseClient } from '@supabase/supabase-js';

import { simNow } from '../time/simClock';

const NY = 'America/New_York';

// NY wall-clock date as 'YYYY-MM-DD' (en-CA yields ISO order).
function nyDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: NY,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

// The Monday (NY) of the week containing `date` ('YYYY-MM-DD').
function weekStart(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() - ((at.getUTCDay() + 6) % 7));
  return at.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

export type BuildTarget = {
  periodId: string;
  periodStartDate: string;
  periodEndDate: string;
  publishedForHouse: boolean;
  // Null when the period covers no non-voided block for this house — the house
  // is closed for that season, so there is nothing to build.
  weekStartDate: string | null;
  weekEndDate: string | null; // exclusive
};

type PeriodRow = {
  period_id: string;
  start_date: string;
  end_date: string;
};

// Resolve the period the builder should be pointed at, and that period's first
// week at `houseId`. Returns null only when no scheduling period exists at all.
//
// Period pick: among periods that have not already ENDED, the one starting
// LATEST that this house has not published yet. A house publishes per period
// (`period_house_publications`), so an already-published season is done being
// built and the next one is the live target; falling back to the latest ended
// period keeps a fully-published house rendering its last built week instead of
// a blank screen. `scheduling_periods.published_at` is deliberately NOT the
// filter here: it only flips once EVERY house has published, so it stays null
// on a season this house has finished.
export async function resolveBuildTarget(
  supabase: SupabaseClient,
  houseId: string,
): Promise<BuildTarget | null> {
  const today = nyDate((await simNow()).toISOString());

  const [periodResult, publicationResult] = await Promise.all([
    supabase
      .from('scheduling_periods')
      .select('period_id, start_date, end_date')
      .order('start_date', { ascending: false }),
    supabase.from('period_house_publications').select('period_id').eq('house_id', houseId),
  ]);

  const periods = (periodResult.data ?? []) as PeriodRow[];
  if (periods.length === 0) return null;

  const publishedPeriodIds = new Set(
    ((publicationResult.data ?? []) as { period_id: string }[]).map((p) => p.period_id),
  );

  const live = periods.filter((p) => p.end_date >= today);
  const period = live.find((p) => !publishedPeriodIds.has(p.period_id)) ?? live[0] ?? periods[0]!;

  // The period's first week AT THIS HOUSE. Scoped to the period's date range, so
  // a house that opens partway into the season anchors on the week it opens, and
  // a house that is closed for the season yields no week at all.
  //
  // The UTC envelope is deliberately generous at both ends and narrowed by NY date
  // here — the same DST-safe pattern the live calendar and the builder's own week
  // query use, and index-friendly on block_start_at (an `AT TIME ZONE` filter is
  // not). The lower bound therefore also admits the PREVIOUS NY evening: midnight
  // UTC on the period's first day is 20:00 NY the day before, so the outgoing
  // season's late blocks sort ahead of the incoming season's first one. `limit(1)`
  // would return one of those and read as "this house is closed all season". Take a
  // small page instead and pick the first row that is genuinely inside the period —
  // at most ~10 rows can precede it (one evening of half-hour blocks).
  const { data: headBlockRows } = await supabase
    .from('shift_blocks')
    .select('block_start_at')
    .eq('house_id', houseId)
    .is('voided_at', null)
    .gte('block_start_at', `${period.start_date}T00:00:00.000Z`)
    .lt('block_start_at', `${addDays(period.end_date, 1)}T12:00:00.000Z`)
    .order('block_start_at')
    .limit(64);

  const firstDay =
    ((headBlockRows ?? []) as { block_start_at: string }[])
      .map((b) => nyDate(b.block_start_at))
      .find((day) => day >= period.start_date && day <= period.end_date) ?? null;
  const wkStart = firstDay === null ? null : weekStart(firstDay);

  return {
    periodId: period.period_id,
    periodStartDate: period.start_date,
    periodEndDate: period.end_date,
    publishedForHouse: publishedPeriodIds.has(period.period_id),
    weekStartDate: wkStart,
    weekEndDate: wkStart === null ? null : addDays(wkStart, 7),
  };
}
