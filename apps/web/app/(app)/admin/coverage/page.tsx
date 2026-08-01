import { CoverageReport } from '../../../../components/coverage/CoverageReport';
import { Notification } from '../../../../components/ui/Notification';
import { PageHead } from '../../../../components/ui/PageHead';
import { canBuildSchedule, getSessionUser } from '../../../../lib/auth';
import { getCoverageReport } from '../../../../lib/data/coverage';
import { simNow } from '../../../../lib/time/simClock';

// Missed-coverage report. Every Allied coverage request over a date range, closed or
// not, with the ladder path it took and the outcome a human recorded.
//
// This page is the artifact the predecessor model destroyed: Allied alerts used to
// archive at their coverage-window end whether or not anyone acted, then be discarded
// 24 hours later, so nothing anywhere recorded that a desk had gone unstaffed. Gated
// to the same manager audience as the Action Inbox.
export default async function CoveragePage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const user = await getSessionUser();
  if (user === null) return null;

  if (!canBuildSchedule(user)) {
    return (
      <div className="page">
        <PageHead eyebrow="Coverage" title="Coverage report" />
        <Notification kind="info" title="Managers only">
          The coverage report is available to Student Managers and Housing Managers.
        </Notification>
      </div>
    );
  }

  const params = await searchParams;
  const parsed = Number(params.days);
  const days = Number.isInteger(parsed) && parsed > 0 && parsed <= 365 ? parsed : 30;

  const now = await simNow();
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const rows = await getCoverageReport(from.toISOString(), now.toISOString(), now);

  return <CoverageReport rows={rows} days={days} />;
}
