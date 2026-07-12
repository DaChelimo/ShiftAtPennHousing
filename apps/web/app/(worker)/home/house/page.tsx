import { HouseView } from '../../../../components/worker/HouseView';
import { getSessionUser } from '../../../../lib/auth';
import { getHouseViewBoard } from '../../../../lib/data/worker/house';
import { simNow } from '../../../../lib/time/simClock';

// Worker cross-house view (BSpec §11.4). Read-only look at any house's schedule with a
// house switcher, day navigation, and tap-to-dial desk phone.
export default async function WorkerHousePage({
  searchParams,
}: {
  searchParams: Promise<{ house?: string; d?: string }>;
}) {
  const user = await getSessionUser();
  if (user === null) return null; // layout redirected

  const { house, d } = await searchParams;
  const parsed = Number(d);
  const dayOffset = Number.isFinite(parsed) ? Math.trunc(parsed) : 0;

  const board = await getHouseViewBoard(await simNow(), house ?? null, user.homeHouseId, dayOffset);
  return <HouseView board={board} />;
}
