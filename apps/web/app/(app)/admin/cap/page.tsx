import { redirect } from 'next/navigation';

import { WeeklyCapModifier } from '../../../../components/cap/WeeklyCapModifier';
import { Notification } from '../../../../components/ui/Notification';
import { PageHead } from '../../../../components/ui/PageHead';
import { canModifyWeeklyCap, getSessionUser } from '../../../../lib/auth';
import { getWeeklyCaps } from '../../../../lib/data/cap';

export default async function CapPage() {
  const user = await getSessionUser();
  if (user === null) redirect('/login');

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <PageHead
        eyebrow="Manage"
        title="Weekly hours cap"
        sub="Choose a calendar week and set its campus-wide cap (§9.3)."
      />
      {canModifyWeeklyCap(user) ? (
        <WeeklyCapModifier weeks={await getWeeklyCaps()} />
      ) : (
        <Notification kind="warning" title="Managers only" testId="cap-unauthorized">
          403 — only Housing Managers and Building Managers may modify the weekly cap.
        </Notification>
      )}
    </div>
  );
}
