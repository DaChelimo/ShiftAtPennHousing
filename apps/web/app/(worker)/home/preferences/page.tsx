import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Preferences' };

import { PreferenceBoard } from '../../../../components/worker/PreferenceBoard';
import { getSessionUser } from '../../../../lib/auth';
import { getWorkerPreferenceBoard } from '../../../../lib/data/worker/preferences';
import { simNow } from '../../../../lib/time/simClock';

// Worker semester-preference picker (BSpec §4.2/§4.4). Loads the active period's
// representative week + the worker's own prefill, then hands it to the client
// paint grid. Submit routes through the shared submit-preferences Edge Function.
export default async function WorkerPreferencesPage() {
  const user = await getSessionUser();
  if (user === null) return null; // layout redirected

  const board = await getWorkerPreferenceBoard(user.userId, user.homeHouseId, await simNow());
  return <PreferenceBoard board={board} />;
}
