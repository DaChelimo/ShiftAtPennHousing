import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Swaps' };

import { Swaps } from '../../../../components/worker/Swaps';
import { getSessionUser } from '../../../../lib/auth';
import { getSwapsBoard } from '../../../../lib/data/worker/swaps';
import { simNow } from '../../../../lib/time/simClock';

// Worker "Swaps" (BSpec §8). Review incoming/outgoing swaps and hand-offs, respond, and
// propose a one-way hand-off of your own shift to a counterparty.
export default async function WorkerSwapsPage() {
  const user = await getSessionUser();
  if (user === null) return null; // layout redirected

  const board = await getSwapsBoard(user.userId, await simNow());
  return <Swaps board={board} />;
}
