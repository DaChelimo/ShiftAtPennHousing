import { canViewOtherHouses, resolveCalendarHouse } from '@shift/core';

import { HouseCalendar } from '../../../components/calendar/HouseCalendar';
import { Notification } from '../../../components/ui/Notification';
import { PageHead } from '../../../components/ui/PageHead';
import { adminHouseId, canBuildSchedule, getSessionUser, isRsm } from '../../../lib/auth';
import {
  defaultCalendarWeek,
  getHouseCalendar,
  mondayOf,
  nyToday,
} from '../../../lib/data/calendar';
import { isProjectAdministrator } from '../../../lib/data/config';
import { getOnDutyHmodId, getShellHouses } from '../../../lib/data/hmod';
import { simNow } from '../../../lib/time/simClock';

// Live house calendar — the source-of-truth week grid for the user's house
// (design screen 03/04). READ-only presentation over existing schedule data
// (lib/data/calendar). Manager surface (§6.1): gated to SM/HM/BM, the same
// authorization as the schedule builder, because it reads worker contact details
// via the service client. The week is URL-driven (?week=YYYY-MM-DD) so navigation
// re-fetches server-side and past weeks stay shareable/queryable.
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; house?: string }>;
}) {
  const user = await getSessionUser();
  if (user === null) return null; // the layout already redirected

  if (!canBuildSchedule(user)) {
    return (
      <div className="page">
        <PageHead eyebrow="Calendar" title="Live calendar" />
        <Notification kind="info" title="Managers only">
          The live house calendar is available to Student Managers and Housing Managers. Your own
          published shifts are on the Dashboard.
        </Notification>
      </div>
    );
  }

  const { week, house } = await searchParams;
  const todayKey = nyToday();
  const thisMondayKey = mondayOf(todayKey);

  // §2.5 cross-house: the on-duty HMOD / project admin may open another house's
  // calendar via ?house=; everyone else is pinned to their own house (the param is
  // silently ignored — D6). Calendar is always single-house.
  const now = await simNow();
  const onDutyId = await getOnDutyHmodId(now);
  const canViewOthers = canViewOtherHouses({
    isOnDutyHmod: onDutyId === user.userId,
    isProjectAdmin: await isProjectAdministrator(user.userId),
    isRsm: isRsm(user),
  });
  const validHouseIds = (await getShellHouses()).map((h) => h.id);
  const viewHouse = resolveCalendarHouse({
    requested: house ?? null,
    homeHouse: adminHouseId(user),
    canViewOthers,
    validHouseIds,
  });

  // With no explicit ?week, open on the current week — but clamp into this house's
  // scheduled range so landing here before the term starts shows the first
  // scheduled week, not a blank grid (the published schedule repeats every week).
  const weekStartDate =
    week && /^\d{4}-\d{2}-\d{2}$/.test(week)
      ? mondayOf(week)
      : await defaultCalendarWeek(viewHouse);

  const model = await getHouseCalendar(viewHouse, weekStartDate);

  return <HouseCalendar model={model} todayKey={todayKey} thisMondayKey={thisMondayKey} />;
}
