import { CoverageMonitor } from '../../../components/coverage/CoverageMonitor';
import { Notification } from '../../../components/ui/Notification';
import { PageHead } from '../../../components/ui/PageHead';
import { adminHouseId, canBuildSchedule, getSessionUser } from '../../../lib/auth';
import { getCoverageData } from '../../../lib/data/coverage';

// Coverage & open-shifts monitor (design screen 06). READ-only presentation over
// existing schedule data (lib/data/coverage). Manager surface — gated to SM/HM/BM.
export default async function CoveragePage() {
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

  const data = await getCoverageData(adminHouseId(user));
  return <CoverageMonitor data={data} />;
}
