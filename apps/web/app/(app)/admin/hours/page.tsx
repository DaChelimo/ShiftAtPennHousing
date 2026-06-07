import { HoursReport } from '../../../../components/hours/HoursReport';
import { Notification } from '../../../../components/ui/Notification';
import { PageHead } from '../../../../components/ui/PageHead';
import { adminHouseId, canBuildSchedule, getSessionUser } from '../../../../lib/auth';
import { getHoursReport } from '../../../../lib/data/hours';

// Hours report (design §6.10). READ-only presentation over existing data
// (lib/data/hours) — per-worker weekly hours decomposed vs the week's cap.
// Managerial read surface — gated to SM/HM/BM (same as coverage/calendar).
export default async function HoursPage() {
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

  const data = await getHoursReport(adminHouseId(user));
  return <HoursReport data={data} />;
}
