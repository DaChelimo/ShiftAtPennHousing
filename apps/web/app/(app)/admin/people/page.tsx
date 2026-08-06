import { resolveCalendarHouse } from '@shift/core';
import type { Metadata } from 'next';

import { PeopleRoster } from '../../../../components/people/PeopleRoster';
import { Notification } from '../../../../components/ui/Notification';
import { PageHead } from '../../../../components/ui/PageHead';
import {
  adminHouseId,
  getSessionUser,
  isAdmin,
  isHouseAdmin,
  isScheduleAdmin,
} from '../../../../lib/auth';
import { isProjectAdministrator } from '../../../../lib/data/config';
import { getOnDutyHmodId, getShellHouses } from '../../../../lib/data/hmod';
import { getPeopleData } from '../../../../lib/data/people';
import { simNow } from '../../../../lib/time/simClock';

export const metadata: Metadata = { title: 'Admin - People' };

// People / roster (design §6.6). READ-only presentation over existing data
// (lib/data/people). Admin-over-people is HM/BM-only (§2.3/§2.6) — an SM or any
// non-admin gets the unauthorized notice instead of the roster.
export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ house?: string }>;
}) {
  const user = await getSessionUser();
  if (user === null) return null; // layout redirected

  if (!isHouseAdmin(user)) {
    return (
      <div className="page">
        <PageHead eyebrow="Manage" title="People" />
        <Notification kind="warning" title="Managers only" testId="people-unauthorized">
          The people roster is available to Housing Managers and Building Managers.
        </Notification>
      </div>
    );
  }

  // 2026-07-25 ruling: people VIEW follows the house switcher for the elevated
  // schedule-admin tier (HM/BM/RSM), mirroring their cross-house schedule access
  // (isScheduleAdmin). SM stays own-house, same as SM's schedule write. This is
  // VIEW-only; every people WRITE stays pinned to adminHouseId (own house) via
  // isHouseAdmin, matching the schedule write split (writeHouseId/canBuildForHouse).
  const { house } = await searchParams;
  const now = await simNow();
  const onDutyId = await getOnDutyHmodId(now);
  const canViewOtherHouses =
    isAdmin(user) ||
    isScheduleAdmin(user) ||
    (await isProjectAdministrator(user.userId)) ||
    onDutyId === user.userId;
  const shellHouses = await getShellHouses();
  const validHouseIds = shellHouses.map((h) => h.id);
  const viewHouse = resolveCalendarHouse({
    requested: house ?? null,
    homeHouse: adminHouseId(user),
    canViewOthers: canViewOtherHouses,
    validHouseIds,
  });

  const data = await getPeopleData(viewHouse);
  const houses = shellHouses.map((h) => ({ id: h.id, name: h.name }));
  return <PeopleRoster data={data} houses={houses} />;
}
