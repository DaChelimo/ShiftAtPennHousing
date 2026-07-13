import { resolveCalendarHouse } from '@shift/core';

import { PeopleRoster } from '../../../../components/people/PeopleRoster';
import { Notification } from '../../../../components/ui/Notification';
import { PageHead } from '../../../../components/ui/PageHead';
import { adminHouseId, getSessionUser, isHouseAdmin } from '../../../../lib/auth';
import { getShellHouses } from '../../../../lib/data/hmod';
import { getPeopleData } from '../../../../lib/data/people';

// People / roster (design §6.6). READ-only presentation over existing data
// (lib/data/people). Admin-over-people is RSM/HM/BM/Project-Admin (§2.3/§2.3a/§2.6) —
// an SM or any non-admin gets the unauthorized notice instead of the roster. Unlike
// Calendar/Coverage's on-duty-HMOD-gated cross-house view, every house-admin tier
// (RSM/HM/BA/Project-Admin) gets cross-house People viewing via ?house= — only SM
// (who never reaches isHouseAdmin) stays pinned to their own house.
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
          The people roster is available to Residential Services Managers, Housing Managers,
          Building Administrators, and Project Admins.
        </Notification>
      </div>
    );
  }

  const { house } = await searchParams;
  const validHouseIds = (await getShellHouses()).map((h) => h.id);
  const viewHouse = resolveCalendarHouse({
    requested: house ?? null,
    homeHouse: adminHouseId(user),
    canViewOthers: true,
    validHouseIds,
  });

  const data = await getPeopleData(viewHouse);
  return <PeopleRoster data={data} />;
}
