import { ActionInbox } from '../../../components/inbox/ActionInbox';
import { Notification } from '../../../components/ui/Notification';
import { PageHead } from '../../../components/ui/PageHead';
import { canBuildSchedule, getSessionUser } from '../../../lib/auth';
import { getInboxData } from '../../../lib/data/inbox';

// Action inbox / notifications (design screen 07). READ-only presentation over the
// signed-in user's notifications (RLS-scoped); actions go through lib/actions/inbox.
// Manager surface — gated to SM/HM/BM (workers use the mobile "Updates" tab). The
// view is URL-driven (?show=resolved) so the resolved Allied alerts live behind a
// shareable link, mirroring the calendar's ?week navigation.
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
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

  const { show } = await searchParams;
  const view = show === 'resolved' ? 'resolved' : 'default';

  const data = await getInboxData(view);
  return <ActionInbox data={data} />;
}
