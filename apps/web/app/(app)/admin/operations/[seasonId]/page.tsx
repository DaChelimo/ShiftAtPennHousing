import { notFound, redirect } from 'next/navigation';

import { SeasonEditor } from '../../../../../components/operations/SeasonEditor';
import { Notification, PageHead } from '../../../../../components/ui';
import { getSessionUser, isAdmin } from '../../../../../lib/auth';
import { getAuditLog, getSeasonDetail, listHouses } from '../../../../../lib/data/operatingSeasons';

export default async function SeasonDetailPage({
  params,
}: {
  params: Promise<{ seasonId: string }>;
}) {
  const { seasonId } = await params;
  const user = await getSessionUser();
  if (user === null) redirect('/login');

  if (!isAdmin(user)) {
    return (
      <div className="page" style={{ maxWidth: 760 }}>
        <PageHead eyebrow="Operations" title="Operating season" />
        <Notification kind="warning" title="Administrators only">
          403. Only an administrator may configure operating seasons.
        </Notification>
      </div>
    );
  }

  const detail = await getSeasonDetail(seasonId);
  if (detail === null) notFound();

  const [houses, audit] = await Promise.all([listHouses(), getAuditLog(seasonId)]);

  return (
    <div className="page" style={{ maxWidth: 960 }}>
      <PageHead
        eyebrow="Operations"
        title={detail.season.seasonName}
        sub={`${detail.season.startDate} to ${detail.season.endDate}. Edit the authoring model, preview the impact, then apply.`}
      />
      <SeasonEditor detail={detail} houses={houses} audit={audit} />
    </div>
  );
}
