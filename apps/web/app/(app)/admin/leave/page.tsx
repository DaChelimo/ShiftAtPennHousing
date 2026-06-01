import { redirect } from 'next/navigation';

import { HmLeaveForm } from '../../../../components/leave/HmLeaveForm';
import { getSessionUser, isHouseAdmin } from '../../../../lib/auth';
import { getLeaveAdminData } from '../../../../lib/data/leave';

// §2.6 / §2.3: only an HM or BM may submit leave. An SM (or any non-admin) sees the
// unauthorized notice instead of the form.
export default async function LeavePage() {
  const user = await getSessionUser();
  if (user === null) redirect('/login');

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
      <h1 className="mb-6 text-lg font-semibold tracking-tight">Housing Manager leave</h1>
      {isHouseAdmin(user) ? (
        await renderForm(user)
      ) : (
        <div
          data-testid="leave-unauthorized"
          className="rounded-lg border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900"
        >
          Only Housing Managers and Building Managers may submit leave.
        </div>
      )}
    </main>
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
