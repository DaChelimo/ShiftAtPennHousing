import { ActionInbox } from '../../../components/inbox/ActionInbox';
import { Notification } from '../../../components/ui/Notification';
import { PageHead } from '../../../components/ui/PageHead';
import { canBuildSchedule, getSessionUser } from '../../../lib/auth';
import { getInboxData } from '../../../lib/data/inbox';

// Action inbox / notifications (design screen 07). READ-only over the signed-in
// user's notifications (RLS-scoped). Manager surface — gated to SM/HM/BM (workers
// use the mobile "Updates" tab).
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

  const data = await getInboxData();
  return <ActionInbox data={data} />;
}
