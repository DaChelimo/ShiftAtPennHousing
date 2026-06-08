import { canViewOtherHouses } from '@shift/core';
import { redirect } from 'next/navigation';

import { AppShell, type NavItem } from '../../components/AppShell';
import { canBuildSchedule, getSessionUser, isHouseAdmin } from '../../lib/auth';
import { isProjectAdministrator } from '../../lib/data/config';
import { getOnDutyHmodId, getShellHouses, getUnreadCount } from '../../lib/data/hmod';

function prettifyHouse(id: string): string {
  if (!id) return 'House';
  const m = /^house-(\d+)$/.exec(id);
  if (m) return `House ${String(Number(m[1]))}`;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

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
      href: '/admin/preferences',
      label: 'Preferences',
      testId: 'nav-admin-preferences',
      icon: 'check',
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
    nav.push({
      href: '/admin/hours',
      label: 'Hours report',
      testId: 'nav-admin-hours',
      icon: 'hours',
      group: 'Operate',
    });
  }
  if (isHouseAdmin(user)) {
    nav.push({
      href: '/admin/people',
      label: 'People',
      testId: 'nav-admin-people',
      icon: 'people',
      group: 'Manage',
    });
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

  // §2.5 HMOD context: resolve who is on-duty now, whether this user may leave their
  // home house (on-duty HMOD or project admin — D5), the switcher's house list, and
  // the bell's due/unread count. A single `now` so the pill, switcher, and bell agree.
  const now = new Date();
  const onDutyId = await getOnDutyHmodId(now);
  const hmodOnDuty = onDutyId === user.userId;
  const isProjectAdmin = await isProjectAdministrator(user.userId);
  const canSwitchHouse = canViewOtherHouses({ isOnDutyHmod: hmodOnDuty, isProjectAdmin });
  const houses = canSwitchHouse
    ? await getShellHouses()
    : [
        {
          id: user.homeHouseId,
          name: prettifyHouse(user.homeHouseId),
          restricted: user.homeHouseId === 'harnwell',
        },
      ];
  const unreadCount = await getUnreadCount(user.userId, now);

  return (
    <AppShell
      user={{
        name: user.name,
        email: user.email,
        roles: user.roles.map((r) => r.role),
        homeHouseId: user.homeHouseId,
      }}
      nav={nav}
      hmodOnDuty={hmodOnDuty}
      canSwitchHouse={canSwitchHouse}
      houses={houses}
      unreadCount={unreadCount}
    >
      {children}
    </AppShell>
  );
}
