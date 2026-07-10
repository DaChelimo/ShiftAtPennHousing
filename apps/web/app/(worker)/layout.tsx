import { redirect } from 'next/navigation';

import { WorkerShell, type WorkerNavItem } from '../../components/WorkerShell';
import { getSessionUser, hasAdminSurface } from '../../lib/auth';
import { getSimOffsetSeconds, isTimeTravelEnabled } from '../../lib/time/simClock';

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

  // Nav grows with the build: Home + Preferences + Breaks now; My Shifts / Open /
  // Updates land in later phases. Only built routes appear so nothing 404s.
  const nav: WorkerNavItem[] = [
    { href: '/home', label: 'Home', testId: 'wnav-home', icon: 'layers' },
    { href: '/home/preferences', label: 'Preferences', testId: 'wnav-preferences', icon: 'check' },
    { href: '/home/breaks', label: 'Breaks', testId: 'wnav-breaks', icon: 'calendar' },
  ];

  const devClock = isTimeTravelEnabled() ? { offsetSeconds: await getSimOffsetSeconds() } : null;

  return (
    <WorkerShell
      user={{ name: user.name, email: user.email, homeHouseId: user.homeHouseId }}
      nav={nav}
      hasAdminSurface={hasAdminSurface(user)}
      devClock={devClock}
    >
      {children}
    </WorkerShell>
  );
}
