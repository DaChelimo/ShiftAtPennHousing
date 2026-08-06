import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Updates' };

import { UpdatesFeed } from '../../../../components/worker/UpdatesFeed';
import { getSessionUser } from '../../../../lib/auth';
import { getUpdatesBoard } from '../../../../lib/data/worker/floats';
import { simNow } from '../../../../lib/time/simClock';

// Worker "Updates" (BSpec §7.1). Inbound float requests to accept or decline, plus a
// de-emphasised recent-history section. Also the destination of the shell's bell.
export default async function WorkerUpdatesPage() {
  const user = await getSessionUser();
  if (user === null) return null; // layout redirected

  const board = await getUpdatesBoard(user.userId, await simNow());
  return <UpdatesFeed board={board} />;
}
