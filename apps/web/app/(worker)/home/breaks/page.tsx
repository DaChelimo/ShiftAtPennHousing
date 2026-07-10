import { BreakClaim } from '../../../../components/worker/BreakClaim';
import { getSessionUser } from '../../../../lib/auth';
import { getWorkerBreakBoard } from '../../../../lib/data/worker/breaks';
import { simNow } from '../../../../lib/time/simClock';

// Worker break-claim (BSpec §4.4). Loads the active break's claimable grid for the
// worker's home house, then hands it to the client claim board. Claims route through
// the shared break-claim Edge Function (FCFS, server-trimmed).
export default async function WorkerBreaksPage() {
  const user = await getSessionUser();
  if (user === null) return null; // layout redirected

  const board = await getWorkerBreakBoard(user.userId, user.homeHouseId, await simNow());
  return <BreakClaim board={board} />;
}
