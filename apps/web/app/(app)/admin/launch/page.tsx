import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { LaunchConsole } from '../../../../components/launch/LaunchConsole';
import { Notification, PageHead } from '../../../../components/ui';
import { getSessionUser, isAdmin } from '../../../../lib/auth';
import { getLaunchBoard } from '../../../../lib/data/launch';

export const metadata: Metadata = { title: 'Admin - Launch' };

// Phase B — staggered-launch admin console. Project-admin only: flip the master switch,
// take houses live one at a time, and invite each house's roster when it goes live.
export default async function LaunchPage() {
  const user = await getSessionUser();
  if (user === null) redirect('/login');

  if (!isAdmin(user)) {
    return (
      <div className="page" style={{ maxWidth: 820 }}>
        <PageHead eyebrow="Admin" title="Launch" />
        <Notification kind="warning" title="Administrators only" testId="launch-unauthorized">
          403. Only an administrator may manage the staggered launch.
        </Notification>
      </div>
    );
  }

  const board = await getLaunchBoard();

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <PageHead
        eyebrow="Admin"
        title="Launch"
        sub="Roll Shift out house by house. Turn on staggered launch, then take each house live once its schedule is built and its roster is invited."
      />
      <LaunchConsole board={board} />
    </div>
  );
}
