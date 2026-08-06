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
  isStudentManager,
  isWorker,
} from '../../lib/auth';
import { isProjectAdministrator } from '../../lib/data/config';
import { getShellCoverage } from '../../lib/data/coverage';
import { getOnDutyHmodId, getShellHouses } from '../../lib/data/hmod';
import { getSimOffsetSeconds, simNow } from '../../lib/time/simClock';

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

  // Kick the whole shell context off in ONE wave, before the synchronous nav-building
  // below runs, so nothing in here sits on the critical path one round trip at a time.
  // `now` no longer costs a round trip (simClock reads a memoized offset), which is what
  // lets getOnDutyHmodId start immediately rather than after a preceding await. Each of
  // these is memoized (React cache() per request, plus a process-wide memo for the two
  // global config reads), so awaiting the same promise again later is free.
  const isProjectAdminPromise = isProjectAdministrator(user.userId);
  const nowPromise = simNow();
  const canSeeCoverage = canBuildSchedule(user);
  const shellContextPromise = nowPromise.then((now) =>
    Promise.all([
      getOnDutyHmodId(now),
      // The app-wide coverage banner and the red bell badge. Allied coverage alerts
      // apply to anyone who can build a schedule (sm/hm/bm/rsm), the same audience as
      // the Action Inbox and the RLS policy on the table.
      //
      // getShellCoverage, NOT getCoverageData: this is a LAYOUT, so it sits above every
      // error.tsx in its subtree and a throw here escapes to Next's global error and
      // takes the entire console down on every route (in dev, as a document-reload
      // loop). getShellCoverage degrades to `unavailable` instead, and the banner says
      // so out loud rather than implying all clear.
      canSeeCoverage ? getShellCoverage(now) : Promise.resolve(null),
      // Simulated-clock card (left of the HMOD pill). Admin-only, in every environment
      // including production (BSpec §14) — hidden for everyone else.
      isAdmin(user) ? getSimOffsetSeconds() : Promise.resolve(null),
      // Fetched unconditionally rather than only when the switcher turns out to be
      // unlocked: it is memoized reference data, and starting it here keeps it off the
      // tail of the render, where it used to be a lone sequential round trip after this
      // batch had already resolved.
      getShellHouses(),
    ]),
  );

  const nav: NavItem[] = [
    { href: '/dashboard', label: 'Dashboard', testId: 'nav-home', icon: 'doc', group: 'Operate' },
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
      href: '/floaters',
      label: 'Floaters',
      testId: 'nav-floaters',
      icon: 'swap',
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
      href: '/admin/knowledge',
      label: 'Knowledge base',
      testId: 'nav-admin-knowledge',
      icon: 'doc',
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
  const isProjectAdmin = await isProjectAdminPromise;
  if (isProjectAdmin) {
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
  //
  // This whole layout used to be a chain of sequential `await`s, each one a GoTrue or
  // Postgres round trip (~130ms p50, ~280ms p90 against the hosted project), so every
  // tab click under this shell paid their full sum in latency. Everything is now kicked
  // off in a single wave at the top of the render and merely collected here.
  const [onDutyId, shellCoverage, devOffsetSeconds, allHouses] = await shellContextPromise;
  const coverage = shellCoverage?.data ?? null;
  const coverageUnavailable = shellCoverage?.unavailable ?? false;
  const hmodOnDuty = onDutyId === user.userId;
  // §2.3a / 2026-06-27: the elevated tier (hm/bm/rsm) may switch into any house —
  // and, as of the cross-house decision, EDIT its schedule there (people admin /
  // leave / cap stay own-house, gated separately). The on-duty HMOD and project
  // admin keep their campus-wide reach.
  const canSwitchHouse = canViewOtherHouses({
    isOnDutyHmod: hmodOnDuty,
    isProjectAdmin,
    isRsm: isRsm(user),
    isScheduleAdmin: isScheduleAdmin(user),
    isStudentManager: isStudentManager(user),
  });
  const houses = canSwitchHouse
    ? allHouses
    : [
        {
          id: user.homeHouseId,
          name: prettifyHouse(user.homeHouseId),
        },
      ];
  const devClock = devOffsetSeconds === null ? null : { offsetSeconds: devOffsetSeconds };

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
      coverageCount={coverage?.actionRequiredCount ?? 0}
      coverageOverdue={(coverage?.overdue.length ?? 0) > 0}
      coverageUnavailable={coverageUnavailable}
      canSeeCoverage={canSeeCoverage}
      devClock={devClock}
    >
      {children}
    </AppShell>
  );
}
