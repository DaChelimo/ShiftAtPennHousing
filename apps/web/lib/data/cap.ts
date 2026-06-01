import { createServiceClient } from '../supabase/server';

export type WeeklyCapAudit = {
  modifiedByName: string;
  modifiedAt: string;
  notes: string | null;
};

export type WeeklyCapWeek = {
  weekStartDate: string;
  hoursCap: number;
  capEnforcement: 'soft' | 'hard';
  isOverride: boolean;
  audit: WeeklyCapAudit | null;
};

function mondayOf(date: string): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() - ((at.getUTCDay() + 6) % 7));
  return at.toISOString().slice(0, 10);
}

export async function getWeeklyCaps(): Promise<WeeklyCapWeek[]> {
  const service = createServiceClient();
  const [{ data: calendar }, { data: overrides }] = await Promise.all([
    service.from('operating_calendar').select('date').order('date'),
    service
      .from('weekly_cap_overrides')
      .select('week_start_date, hours_cap, cap_enforcement, modified_by, modified_at, notes')
      .order('week_start_date'),
  ]);

  const byWeek = new Map((overrides ?? []).map((row) => [row.week_start_date, row]));
  const weekStarts = new Set((calendar ?? []).map((row) => mondayOf(row.date)));
  for (const row of overrides ?? []) weekStarts.add(row.week_start_date);

  const actorIds = [...new Set((overrides ?? []).flatMap((row) => row.modified_by ?? []))];
  const { data: actors } =
    actorIds.length === 0
      ? { data: [] }
      : await service.from('users').select('user_id, name').in('user_id', actorIds);
  const actorName = new Map((actors ?? []).map((actor) => [actor.user_id, actor.name]));

  return Promise.all(
    [...weekStarts].sort().map(async (weekStartDate) => {
      const override = byWeek.get(weekStartDate) ?? null;
      const { data: effective, error } = await service.rpc('effective_weekly_cap', {
        p_week_start_date: weekStartDate,
        p_block_start_at: `${weekStartDate}T00:00:00-05:00`,
      });
      if (error !== null) throw error;
      const cap = effective?.[0] ?? { hours_cap: 20, cap_enforcement: 'soft' as const };
      return {
        weekStartDate,
        hoursCap: cap.hours_cap,
        capEnforcement: cap.cap_enforcement,
        isOverride: override !== null,
        audit:
          override === null
            ? null
            : {
                modifiedByName: actorName.get(override.modified_by ?? '') ?? 'Unknown user',
                modifiedAt: override.modified_at,
                notes: override.notes,
              },
      };
    }),
  );
}
