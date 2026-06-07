import { HouseCalendar } from '../../../components/calendar/HouseCalendar';
import { Notification } from '../../../components/ui/Notification';
import { PageHead } from '../../../components/ui/PageHead';
import { adminHouseId, canBuildSchedule, getSessionUser } from '../../../lib/auth';
import { getHouseCalendar, mondayOf, nyToday } from '../../../lib/data/calendar';

// Live house calendar — the source-of-truth week grid for the user's house
// (design screen 03/04). READ-only presentation over existing schedule data
// (lib/data/calendar). Manager surface (§6.1): gated to SM/HM/BM, the same
// authorization as the schedule builder, because it reads worker contact details
// via the service client. The week is URL-driven (?week=YYYY-MM-DD) so navigation
// re-fetches server-side and past weeks stay shareable/queryable.
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
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

  const { week } = await searchParams;
  const todayKey = nyToday();
  const thisMondayKey = mondayOf(todayKey);
  const weekStartDate = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? mondayOf(week) : thisMondayKey;

  const model = await getHouseCalendar(adminHouseId(user), weekStartDate);

  return <HouseCalendar model={model} todayKey={todayKey} thisMondayKey={thisMondayKey} />;
}
