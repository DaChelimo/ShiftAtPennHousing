import { canViewOtherHouses } from '@shift/core';
import { redirect } from 'next/navigation';

import { AppShell, type NavItem } from '../../components/AppShell';
import {
  canBuildSchedule,
  getSessionUser,
  hasAdminSurface,
  isAdmin,
  isHouseAdmin,
  isRsm,
  isScheduleAdmin,
  isWorker,
} from '../../lib/auth';
import { isProjectAdministrator } from '../../lib/data/config';
import { getOnDutyHmodId, getShellHouses, getUnreadCount } from '../../lib/data/hmod';
import { getSimOffsetSeconds, isTimeTravelEnabled, simNow } from '../../lib/time/simClock';

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
  // A pure Student Worker has no admin surface here — send them to the worker
  // portal. Dual-role users (worker + schedule/house admin) stay on the console
  // by default and switch into /home via the account menu.
  if (!hasAdminSurface(user)) {
    redirect('/home');
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
  // Project-admin-exclusive surfaces (role = 'admin', or the system_config-designated
  // project administrator) get their OWN sidebar section, separate from the
  // house-scoped Operate/Manage/System groups above — these pages act across every
  // house and are invisible to a house-scoped SM/HM/BM/RSM.
  if (isAdmin(user)) {
    nav.push({
      href: '/admin/launch',
      label: 'Launch',
      testId: 'nav-admin-launch',
      icon: 'power',
      group: 'Admin',
    });
    nav.push({
      href: '/admin/operations',
      label: 'Operations',
      testId: 'nav-admin-operations',
      icon: 'calendar',
      group: 'Admin',
    });
    nav.push({
      href: '/admin/breaks',
      label: 'Break coverage',
      testId: 'nav-admin-breaks',
      icon: 'layers',
      group: 'Admin',
    });
  }
  if (await isProjectAdministrator(user.userId)) {
    nav.push({
      href: '/admin/config',
      label: 'Config',
      testId: 'nav-admin-config',
      icon: 'settings',
      group: 'Admin',
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
  // §2.5 HMOD context: resolve who is on-duty now, whether this user may leave their
  // home house (on-duty HMOD or project admin — D5), the switcher's house list, and
  // the bell's due/unread count. A single `now` so the pill, switcher, and bell agree.
  const now = await simNow();
  const onDutyId = await getOnDutyHmodId(now);
  const hmodOnDuty = onDutyId === user.userId;
  const isProjectAdmin = await isProjectAdministrator(user.userId);
  // §2.3a / 2026-06-27: the elevated tier (hm/bm/rsm) may switch into any house —
  // and, as of the cross-house decision, EDIT its schedule there (people admin /
  // leave / cap stay own-house, gated separately). The on-duty HMOD and project
  // admin keep their campus-wide reach.
  const canSwitchHouse = canViewOtherHouses({
    isOnDutyHmod: hmodOnDuty,
    isProjectAdmin,
    isRsm: isRsm(user),
    isScheduleAdmin: isScheduleAdmin(user),
  });
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
  // Dev-only time-travel card (left of the HMOD pill). Hidden in production.
  const devClock = isTimeTravelEnabled() ? { offsetSeconds: await getSimOffsetSeconds() } : null;

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
      canSwitchToWorker={isWorker(user)}
      houses={houses}
      unreadCount={unreadCount}
      devClock={devClock}
    >
      {children}
    </AppShell>
  );
}
