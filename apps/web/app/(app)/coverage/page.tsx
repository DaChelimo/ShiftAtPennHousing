import { canViewOtherHouses, resolveCoverageScope } from '@shift/core';

import { CoverageMonitor } from '../../../components/coverage/CoverageMonitor';
import { Notification } from '../../../components/ui/Notification';
import { PageHead } from '../../../components/ui/PageHead';
import { adminHouseId, canBuildSchedule, getSessionUser } from '../../../lib/auth';
import { isProjectAdministrator } from '../../../lib/data/config';
import { getAllHousesCoverageData, getCoverageData } from '../../../lib/data/coverage';
import { getOnDutyHmodId, getShellHouses } from '../../../lib/data/hmod';

// Coverage & open-shifts monitor (design screen 06). READ-only presentation over
// existing schedule data (lib/data/coverage). Manager surface — gated to SM/HM/BM.
// The on-duty HMOD / project admin sees the campus-wide aggregate by default and may
// narrow to one house via ?house=; everyone else is pinned to their own house (§2.5).
export default async function CoveragePage({
  searchParams,
}: {
  searchParams: Promise<{ house?: string }>;
}) {
  const user = await getSessionUser();
  if (user === null) return null; // layout redirected

  if (!canBuildSchedule(user)) {
    return (
      <div className="page">
        <PageHead eyebrow="Coverage" title="Coverage monitor" />
        <Notification kind="info" title="Managers only">
          The coverage monitor is available to Student Managers and Housing Managers.
        </Notification>
      </div>
    );
  }

  const { house } = await searchParams;
  const now = new Date();
  const onDutyId = await getOnDutyHmodId(now);
  const canViewOthers = canViewOtherHouses({
    isOnDutyHmod: onDutyId === user.userId,
    isProjectAdmin: await isProjectAdministrator(user.userId),
  });
  const validHouseIds = (await getShellHouses()).map((h) => h.id);
  const scope = resolveCoverageScope({
    requested: house ?? null,
    homeHouse: adminHouseId(user),
    canViewOthers,
    validHouseIds,
  });

  const data =
    scope.mode === 'all'
      ? await getAllHousesCoverageData(now)
      : await getCoverageData(scope.houseId!, now);

  return <CoverageMonitor data={data} />;
}
