import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { ScheduleBuilder } from '../../../components/builder/ScheduleBuilder';
import { canBuildSchedule, getSessionUser, writeHouseId } from '../../../lib/auth';
import { getShellHouses } from '../../../lib/data/hmod';
import { getBuilderData } from '../../../lib/data/scheduleBuilder';

export const metadata: Metadata = { title: 'Schedule Builder' };

// §4.3 schedule builder — SM/HM/BM only. Workers (sw) are bounced to the dashboard.
// 2026-06-27 cross-house: a schedule admin (hm/bm/rsm) may open another house via
// ?house= and build it; an sm is pinned to their own house (writeHouseId).

// The AI generate action runs a multi-minute LLM loop; give deployed
// runtimes headroom (no effect on local dev).
export const maxDuration = 300;

export default async function ScheduleBuilderPage({
  searchParams,
}: {
  searchParams: Promise<{ house?: string }>;
}) {
  const user = await getSessionUser();
  if (user === null) redirect('/login');
  if (!canBuildSchedule(user)) redirect('/');

  const { house } = await searchParams;
  const validHouseIds = (await getShellHouses()).map((h) => h.id);
  const houseId = writeHouseId(user, house ?? null, validHouseIds);

  const data = await getBuilderData(houseId);
  return <ScheduleBuilder data={data} />;
}
