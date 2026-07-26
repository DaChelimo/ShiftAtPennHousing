import { redirect } from 'next/navigation';

import { KnowledgeIntake } from '../../../../components/knowledge/KnowledgeIntake';
import { Notification } from '../../../../components/ui/Notification';
import { PageHead } from '../../../../components/ui/PageHead';
import { loadIntakeQueue } from '../../../../lib/actions/kbIntake';
import { getSessionUser, isAdmin, isHouseAdmin, isRsm } from '../../../../lib/auth';
import { createServiceClient } from '../../../../lib/supabase/server';

// KB Intake admin (INTAKE_PLAN Phase 3). HM / BM / RSM / admin only, matching the
// da_is_kb_admin gate on kb_intake. The queue + review UI drives the whole
// upload -> propose -> review -> approve pipeline.
export default async function KnowledgePage() {
  const user = await getSessionUser();
  if (user === null) redirect('/login');
  const canManage = isHouseAdmin(user) || isRsm(user) || isAdmin(user);

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <PageHead
        eyebrow="Manage"
        title="Knowledge base"
        sub="Upload guides, binders, and emails. The assistant drafts the metadata and time windows; you review and approve."
      />
      {canManage ? (
        <KnowledgeIntakeLoader
          isProjectAdmin={isAdmin(user)}
          currentUserHouseId={user.homeHouseId}
        />
      ) : (
        <Notification kind="warning" title="Managers only" testId="knowledge-unauthorized">
          Only Housing Managers, Building Managers, and RSMs may manage the knowledge base.
        </Notification>
      )}
    </div>
  );
}

async function KnowledgeIntakeLoader({
  isProjectAdmin,
  currentUserHouseId,
}: {
  isProjectAdmin: boolean;
  currentUserHouseId: string;
}) {
  const res = await loadIntakeQueue();
  if (!res.ok) {
    return (
      <Notification kind="warning" title="Could not load the queue" testId="knowledge-load-error">
        {res.error}
      </Notification>
    );
  }
  // House scope in the review panel is a picker over real houses (by name, not a
  // free-typed id) so an operator can't typo a house scope into a silent no-match.
  const svc = createServiceClient();
  const { data: houseRows } = await svc.from('houses').select('id, name').order('name');
  return (
    <KnowledgeIntake
      initial={res.data}
      houses={houseRows ?? []}
      isProjectAdmin={isProjectAdmin}
      currentUserHouseId={currentUserHouseId}
    />
  );
}
