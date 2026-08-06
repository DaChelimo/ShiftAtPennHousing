import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'House' };

import { HouseCalendarView } from '../../../../components/worker/HouseCalendarView';
import { getSessionUser } from '../../../../lib/auth';
import { mondayOf, nyToday } from '../../../../lib/data/calendar';
import {
  defaultCalendarWeek,
  getDeskPhone,
  getWorkerHouseCalendar,
  listVisibleHouses,
  resolveWorkerHouse,
} from '../../../../lib/data/worker/house';
import { simNow } from '../../../../lib/time/simClock';

// Worker cross-house view (BSpec §11.4). Read-only week grid, the same visual
// language as the admin Live Calendar, with a house switcher and tap-to-dial
// desk phone. See lib/data/worker/house.ts for why the model is stripped down
// before it reaches this client tree.
export default async function WorkerHousePage({
  searchParams,
}: {
  searchParams: Promise<{ house?: string; week?: string }>;
}) {
  const user = await getSessionUser();
  if (user === null) return null; // layout redirected

  const { house, week } = await searchParams;
  const now = await simNow();
  const todayKey = nyToday(now);
  const thisMondayKey = mondayOf(todayKey);

  const houses = await listVisibleHouses();
  const houseId = resolveWorkerHouse(houses, house ?? null, user.homeHouseId);

  const weekStartDate =
    week && /^\d{4}-\d{2}-\d{2}$/.test(week)
      ? mondayOf(week)
      : await defaultCalendarWeek(houseId, now);

  const [model, deskPhone] = await Promise.all([
    getWorkerHouseCalendar(houseId, weekStartDate, now),
    getDeskPhone(houseId),
  ]);

  return (
    <HouseCalendarView
      model={model}
      todayKey={todayKey}
      thisMondayKey={thisMondayKey}
      houses={houses}
      viewerUserId={user.userId}
      deskPhone={deskPhone}
    />
  );
}
