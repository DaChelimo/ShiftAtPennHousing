import { BreakAuthoring } from '../../../../components/breaks/BreakAuthoring';
import { Notification } from '../../../../components/ui/Notification';
import { PageHead } from '../../../../components/ui/PageHead';
import { getSessionUser, isAdmin } from '../../../../lib/auth';
import { getBreakAuthoringData } from '../../../../lib/data/breaks';
import { simNow } from '../../../../lib/time/simClock';

// Break authoring (BSpec §4.4). Project-administrator only: declare a break period
// (pick an existing operating profile + dates), preview its consequences, and manage
// existing breaks. SMs have no break authoring power.
export default async function BreaksPage() {
  const user = await getSessionUser();
  if (user === null) return null; // layout redirected

  if (!isAdmin(user)) {
    return (
      <div className="page">
        <PageHead eyebrow="System" title="Break coverage" />
        <Notification kind="warning" title="Administrators only" testId="breaks-unauthorized">
          Only a project administrator can author break periods.
        </Notification>
      </div>
    );
  }

  const data = await getBreakAuthoringData(await simNow());
  return <BreakAuthoring data={data} />;
}
