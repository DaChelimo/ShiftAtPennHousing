import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'My Shifts' };

import { MyShifts } from '../../../../components/worker/MyShifts';
import { getSessionUser } from '../../../../lib/auth';
import { getMyShiftsBoard } from '../../../../lib/data/worker/myShifts';
import { simNow } from '../../../../lib/time/simClock';

// Worker "My Shifts" (BSpec §5.6 Tab 1). Week-scoped personal calendar of held shifts,
// grouped into Scheduled / Picked up / Dropped, with a drop entry point per shift.
export default async function WorkerShiftsPage({
  searchParams,
}: {
  searchParams: Promise<{ w?: string }>;
}) {
  const user = await getSessionUser();
  if (user === null) return null; // layout redirected

  const { w } = await searchParams;
  const parsed = Number(w);
  const weekOffset = Number.isFinite(parsed) ? Math.trunc(parsed) : 0;

  const board = await getMyShiftsBoard(user.userId, await simNow(), weekOffset);
  return <MyShifts board={board} />;
}
