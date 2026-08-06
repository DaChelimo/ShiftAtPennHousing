import { ActionInbox } from '../../../components/inbox/ActionInbox';
import { Notification } from '../../../components/ui/Notification';
import { PageHead } from '../../../components/ui/PageHead';
import { canBuildSchedule, getSessionUser } from '../../../lib/auth';
import { getCoverageArchive, getCoverageData } from '../../../lib/data/coverage';
import { getInboxData } from '../../../lib/data/inbox';
import { simNow } from '../../../lib/time/simClock';

// Action inbox (design screen 07). READ-only presentation over the signed-in user's
// notifications (RLS-scoped); actions go through lib/actions/inbox. Manager surface —
// gated to SM/HM/BM (workers use the mobile "Updates" tab). Allied-coverage alerts
// are surfaced soonest-window-first and archive themselves a day after their coverage
// window passes (see lib/data/inbox + @shift/core alliedLifecycle). The Archive tab's
// history table (getCoverageArchive) folds in the former standalone /admin/coverage
// report — same allied_coverage_requests audit trail, one manager surface instead of two.
export default async function InboxPage() {
  const user = await getSessionUser();
  if (user === null) return null;

  if (!canBuildSchedule(user)) {
    return (
      <div className="page">
        <PageHead eyebrow="Inbox" title="Action inbox" />
        <Notification kind="info" title="Managers only">
          The action inbox is available to Student Managers and Housing Managers.
        </Notification>
      </div>
    );
  }

  const now = await simNow();
  const [data, coverage, archive] = await Promise.all([
    getInboxData(now),
    getCoverageData(now),
    getCoverageArchive(now),
  ]);
  return <ActionInbox data={data} coverage={coverage} archive={archive} />;
}
