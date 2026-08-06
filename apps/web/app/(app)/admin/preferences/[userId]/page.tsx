import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Notification } from '../../../../../components/ui/Notification';
import { PageHead } from '../../../../../components/ui/PageHead';
import { PreferenceBoard } from '../../../../../components/worker/PreferenceBoard';
import { canBuildForHouse, canBuildSchedule, getSessionUser } from '../../../../../lib/auth';
import { getWorkerPreferenceBoard } from '../../../../../lib/data/worker/preferences';
import { createServiceClient } from '../../../../../lib/supabase/server';
import { simNow } from '../../../../../lib/time/simClock';

export const metadata: Metadata = { title: 'Admin - Preferences' };

// Author ONE roster member's semester preferences (BSpec §4.2/§4.4). Opened by
// clicking a worker on /admin/preferences. Reuses the worker paint grid, scoped to
// the target worker via a service-role board read (cross-house) + the on-behalf
// submit action. Gated to schedule builders; an SM is pinned to their own house
// while a schedule admin (hm/bm/rsm/admin) may author for any house. `?house=` is
// preserved so the back link returns to the same viewed house.
export default async function WorkerPreferenceEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ house?: string }>;
}) {
  const user = await getSessionUser();
  if (user === null) return null; // layout redirected

  if (!canBuildSchedule(user)) {
    return (
      <div className="page">
        <PageHead eyebrow="Operate" title="Worker preferences" />
        <Notification kind="warning" title="Managers only" testId="preferences-unauthorized">
          Editing worker preferences is available to Student Managers and Housing Managers.
        </Notification>
      </div>
    );
  }

  const { userId } = await params;
  const { house } = await searchParams;
  const backHref = house
    ? `/admin/preferences?house=${encodeURIComponent(house)}`
    : '/admin/preferences';

  const svc = createServiceClient();
  const { data: worker } = await svc
    .from('users')
    .select('user_id, name, home_house_id, is_active')
    .eq('user_id', userId)
    .maybeSingle();
  if (worker === null || worker === undefined) notFound();

  // Own-house for an SM; any house for a schedule admin. The on-behalf write RPC
  // re-checks this authoritatively — this is the fail-fast web gate.
  if (!canBuildForHouse(user, worker.home_house_id)) {
    return (
      <div className="page">
        <PageHead eyebrow="Operate" title={worker.name} />
        <Notification kind="warning" title="Different house" testId="preferences-wrong-house">
          You can only edit preferences for workers in a house you manage.
        </Notification>
      </div>
    );
  }

  const board = await getWorkerPreferenceBoard(
    worker.user_id,
    worker.home_house_id,
    await simNow(),
    svc,
  );

  return (
    <PreferenceBoard
      board={board}
      admin={{ targetUserId: worker.user_id, targetName: worker.name, backHref }}
    />
  );
}
