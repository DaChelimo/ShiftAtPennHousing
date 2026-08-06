import { resolveCalendarHouse } from '@shift/core';
import type { Metadata } from 'next';

import { HoursReport } from '../../../../components/hours/HoursReport';
import { Notification } from '../../../../components/ui/Notification';
import { PageHead } from '../../../../components/ui/PageHead';
import { adminHouseId, canBuildSchedule, getSessionUser, isAdmin } from '../../../../lib/auth';
import { isProjectAdministrator } from '../../../../lib/data/config';
import { getOnDutyHmodId, getShellHouses } from '../../../../lib/data/hmod';
import { getHoursReport } from '../../../../lib/data/hours';
import { simNow } from '../../../../lib/time/simClock';

export const metadata: Metadata = { title: 'Admin - Hours' };

// Hours report (design §6.10). READ-only presentation over existing data
// (lib/data/hours) — per-worker weekly hours decomposed vs the week's cap.
// Managerial read surface — gated to SM/HM/BM (same as coverage/calendar).
export default async function HoursPage({
  searchParams,
}: {
  searchParams: Promise<{ house?: string }>;
}) {
  const user = await getSessionUser();
  if (user === null) return null; // layout redirected

  if (!canBuildSchedule(user)) {
    return (
      <div className="page">
        <PageHead eyebrow="Manage" title="Hours report" />
        <Notification kind="warning" title="Managers only" testId="hours-unauthorized">
          The hours report is available to Student Managers and Housing Managers.
        </Notification>
      </div>
    );
  }

  // §2.5 cross-house: the hours report follows the selected house only for the
  // project administrator and the on-duty HMOD (who covers every house). SM/HM/BM/RSM
  // stay pinned to their own house — the carried ?house= is ignored for them.
  const { house } = await searchParams;
  const now = await simNow();
  const onDutyId = await getOnDutyHmodId(now);
  const canViewOtherHouses =
    isAdmin(user) || (await isProjectAdministrator(user.userId)) || onDutyId === user.userId;
  const validHouseIds = (await getShellHouses()).map((h) => h.id);
  const viewHouse = resolveCalendarHouse({
    requested: house ?? null,
    homeHouse: adminHouseId(user),
    canViewOthers: canViewOtherHouses,
    validHouseIds,
  });

  const data = await getHoursReport(viewHouse);
  return <HoursReport data={data} />;
}
