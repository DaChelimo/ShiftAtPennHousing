import { redirect } from 'next/navigation';

import { AppShell, type NavItem } from '../../components/AppShell';
import { canBuildSchedule, getSessionUser, isHouseAdmin } from '../../lib/auth';
import { isProjectAdministrator } from '../../lib/data/config';

// Authenticated shell. Any unauthenticated request to a route in this group is
// redirected to /login (the proxy also guards the admin prefixes). The nav is
// role-aware: schedule builder for sm/hm/bm; leave + rotor for hm/bm only (§2.3/§2.6).
// Items carry an icon + side-nav group (Operate · Manage · System) for the UI Shell.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (user === null) {
    redirect('/login');
  }

  const nav: NavItem[] = [
    { href: '/', label: 'Dashboard', testId: 'nav-home', icon: 'doc', group: 'Operate' },
  ];
  if (canBuildSchedule(user)) {
    nav.push({
      href: '/calendar',
      label: 'Live calendar',
      testId: 'nav-calendar',
      icon: 'calendar',
      group: 'Operate',
    });
    nav.push({
      href: '/schedule-builder',
      label: 'Schedule builder',
      testId: 'nav-schedule-builder',
      icon: 'grid',
      group: 'Operate',
    });
    nav.push({
      href: '/coverage',
      label: 'Coverage',
      testId: 'nav-coverage',
      icon: 'shield',
      group: 'Operate',
    });
    nav.push({
      href: '/inbox',
      label: 'Action inbox',
      testId: 'nav-inbox',
      icon: 'inbox',
      group: 'Operate',
    });
  }
  if (isHouseAdmin(user)) {
    nav.push({
      href: '/admin/leave',
      label: 'Leave',
      testId: 'nav-admin-leave',
      icon: 'power',
      group: 'Manage',
    });
    nav.push({
      href: '/admin/rotor',
      label: 'HMOD rotor',
      testId: 'nav-admin-rotor',
      icon: 'swap',
      group: 'Manage',
    });
    nav.push({
      href: '/admin/cap',
      label: 'Weekly cap',
      testId: 'nav-admin-cap',
      icon: 'hours',
      group: 'Manage',
    });
    nav.push({
      href: '/admin/health',
      label: 'Health',
      testId: 'nav-admin-health',
      icon: 'shield',
      group: 'System',
    });
  }
  if (await isProjectAdministrator(user.userId)) {
    nav.push({
      href: '/admin/config',
      label: 'Config',
      testId: 'nav-admin-config',
      icon: 'settings',
      group: 'System',
    });
    if (!isHouseAdmin(user)) {
      nav.push({
        href: '/admin/health',
        label: 'Health',
        testId: 'nav-admin-health',
        icon: 'shield',
        group: 'System',
      });
    }
  }
  nav.push({
    href: '/components',
    label: 'Components',
    testId: 'nav-components',
    icon: 'layers',
    group: 'System',
  });

  return (
    <AppShell
      user={{
        name: user.name,
        email: user.email,
        roles: user.roles.map((r) => r.role),
        homeHouseId: user.homeHouseId,
      }}
      nav={nav}
    >
      {children}
    </AppShell>
  );
}
