import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { HmLeaveForm } from '../../../../components/leave/HmLeaveForm';
import { Notification } from '../../../../components/ui/Notification';
import { PageHead } from '../../../../components/ui/PageHead';
import { getSessionUser, isHouseAdmin } from '../../../../lib/auth';
import { getLeaveAdminData } from '../../../../lib/data/leave';

export const metadata: Metadata = { title: 'Admin - Leave' };

// §2.6 / §2.3: only an HM or BM may submit leave. An SM (or any non-admin) sees the
// unauthorized notice instead of the form.
export default async function LeavePage() {
  const user = await getSessionUser();
  if (user === null) redirect('/login');

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <PageHead
        eyebrow="Manage"
        title="I'll be away from the desk"
        sub="Tell us when, and who's covering. We'll prep the email to your student workers (§2.6)."
      />
      {isHouseAdmin(user) ? (
        await renderForm(user)
      ) : (
        <Notification kind="warning" title="Managers only" testId="leave-unauthorized">
          Only Housing Managers and Building Managers may submit leave.
        </Notification>
      )}
    </div>
  );
}

async function renderForm(user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>) {
  const { candidates, defaultReplacementUserId, myActiveLeaves } = await getLeaveAdminData(user);
  return (
    <HmLeaveForm
      candidates={candidates}
      defaultReplacementUserId={defaultReplacementUserId}
      myActiveLeaves={myActiveLeaves}
    />
  );
}
