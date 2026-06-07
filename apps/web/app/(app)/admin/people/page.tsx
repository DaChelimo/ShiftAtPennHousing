import { PeopleRoster } from '../../../../components/people/PeopleRoster';
import { Notification } from '../../../../components/ui/Notification';
import { PageHead } from '../../../../components/ui/PageHead';
import { adminHouseId, getSessionUser, isHouseAdmin } from '../../../../lib/auth';
import { getPeopleData } from '../../../../lib/data/people';

// People / roster (design §6.6). READ-only presentation over existing data
// (lib/data/people). Admin-over-people is HM/BM-only (§2.3/§2.6) — an SM or any
// non-admin gets the unauthorized notice instead of the roster.
export default async function PeoplePage() {
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

  const data = await getPeopleData(adminHouseId(user));
  return <PeopleRoster data={data} />;
}
