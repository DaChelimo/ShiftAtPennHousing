import { redirect } from 'next/navigation';

import { AppShell, type NavItem } from '../../components/AppShell';
import { canBuildSchedule, getSessionUser, isHouseAdmin } from '../../lib/auth';
import { isProjectAdministrator } from '../../lib/data/config';

// Authenticated shell. Any unauthenticated request to a route in this group is
// redirected to /login (the proxy also guards the admin prefixes). The nav is
// role-aware: schedule builder for sm/hm/bm; leave + rotor for hm/bm only (§2.3/§2.6).
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (user === null) {
    redirect('/login');
  }

  const nav: NavItem[] = [];
  if (canBuildSchedule(user)) {
    nav.push({
      href: '/schedule-builder',
      label: 'Schedule builder',
      testId: 'nav-schedule-builder',
    });
  }
  if (isHouseAdmin(user)) {
    nav.push({ href: '/admin/leave', label: 'Leave', testId: 'nav-admin-leave' });
    nav.push({ href: '/admin/rotor', label: 'HMOD rotor', testId: 'nav-admin-rotor' });
    nav.push({ href: '/admin/cap', label: 'Weekly cap', testId: 'nav-admin-cap' });
    nav.push({ href: '/admin/health', label: 'Health', testId: 'nav-admin-health' });
  }
  if (await isProjectAdministrator(user.userId)) {
    nav.push({ href: '/admin/config', label: 'Config', testId: 'nav-admin-config' });
    if (!isHouseAdmin(user)) {
      nav.push({ href: '/admin/health', label: 'Health', testId: 'nav-admin-health' });
    }
  }

  return (
    <AppShell user={{ name: user.name, email: user.email }} nav={nav}>
      {children}
    </AppShell>
  );
}
