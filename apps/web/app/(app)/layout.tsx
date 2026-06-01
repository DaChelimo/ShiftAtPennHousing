import { redirect } from 'next/navigation';

import { AppShell, type NavItem } from '../../components/AppShell';
import { canBuildSchedule, getSessionUser, isHouseAdmin } from '../../lib/auth';

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
  }

  return (
    <AppShell user={{ name: user.name, email: user.email }} nav={nav}>
      {children}
    </AppShell>
  );
}
