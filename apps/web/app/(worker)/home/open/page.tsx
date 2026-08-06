import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Open Shifts' };

import { OpenShifts } from '../../../../components/worker/OpenShifts';
import { getSessionUser } from '../../../../lib/auth';
import { getOpenShiftsBoard } from '../../../../lib/data/worker/openShifts';
import { simNow } from '../../../../lib/time/simClock';

// Worker "Open Shifts" (BSpec §5.6 Tab 2 / Tab 3). Claimable one-time gaps + recurring
// permanent openings, with server-authoritative claimability (never re-derived T-2h).
export default async function WorkerOpenPage() {
  const user = await getSessionUser();
  if (user === null) return null; // layout redirected

  const board = await getOpenShiftsBoard(user.userId, await simNow());
  return <OpenShifts board={board} />;
}
