import { redirect } from 'next/navigation';

import { HouseNotLive } from '../../components/HouseNotLive';
import { WorkerShell, type WorkerNavItem } from '../../components/WorkerShell';
import { getSessionUser, hasAdminSurface } from '../../lib/auth';
import { getHouseGate } from '../../lib/data/config';
import { getUpdatesBadgeCount } from '../../lib/data/worker/floats';
import { getSimOffsetSeconds, isTimeTravelEnabled, simNow } from '../../lib/time/simClock';

// The worker portal shell (route group `(worker)`, mounted at /home). Any
// authenticated user may enter — a pure Student Worker lands here from /login, and
// a dual-role admin can switch in via the account menu. Data is always the signed-in
// worker's own (RLS-scoped), so a non-worker admin previewing this simply sees empty
// states. Unauthenticated requests bounce to /login (belt-and-suspenders with proxy.ts).
export default async function WorkerLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (user === null) {
    redirect('/login');
  }

  // Staggered-launch gate (rollout): a pure worker whose home house is not yet live
  // sees a "coming soon" placeholder instead of the portal. Admins and any schedule/
  // house admin bypass so they can prepare the house before go-live. This gates the
  // portal UI only; it is a soft UX guard, not a security boundary (RLS is unchanged),
  // so a worker's own RLS-scoped data stays server-protected regardless.
  if (!hasAdminSurface(user)) {
    const gate = await getHouseGate(user.homeHouseId);
    if (!gate.isLive) {
      return <HouseNotLive houseName={gate.houseName} email={user.email} />;
    }
  }

  // Nav grows with the build. Only built routes appear so nothing 404s.
  const nav: WorkerNavItem[] = [
    { href: '/home', label: 'Home', testId: 'wnav-home', icon: 'layers' },
    { href: '/home/shifts', label: 'My shifts', testId: 'wnav-shifts', icon: 'calendar' },
    { href: '/home/open', label: 'Open shifts', testId: 'wnav-open', icon: 'search' },
    { href: '/home/updates', label: 'Updates', testId: 'wnav-updates', icon: 'bell' },
    { href: '/home/swaps', label: 'Swaps', testId: 'wnav-swaps', icon: 'swap' },
    { href: '/home/house', label: 'House', testId: 'wnav-house', icon: 'grid' },
    { href: '/home/assistant', label: 'Assistant', testId: 'wnav-assistant', icon: 'chat' },
    { href: '/home/preferences', label: 'Preferences', testId: 'wnav-preferences', icon: 'check' },
    { href: '/home/breaks', label: 'Breaks', testId: 'wnav-breaks', icon: 'calendar' },
  ];

  const devClock = isTimeTravelEnabled() ? { offsetSeconds: await getSimOffsetSeconds() } : null;
  const updatesCount = await getUpdatesBadgeCount(user.userId, await simNow());

  return (
    <WorkerShell
      user={{ name: user.name, email: user.email, homeHouseId: user.homeHouseId }}
      nav={nav}
      hasAdminSurface={hasAdminSurface(user)}
      updatesCount={updatesCount}
      devClock={devClock}
    >
      {children}
    </WorkerShell>
  );
}
