import { PreferencesOversight } from '../../../../components/preferences/PreferencesOversight';
import { Notification } from '../../../../components/ui/Notification';
import { PageHead } from '../../../../components/ui/PageHead';
import { adminHouseId, canBuildSchedule, getSessionUser } from '../../../../lib/auth';
import { getPreferencesOversight } from '../../../../lib/data/preferences';

// Preferences oversight (design §6.11). READ-only presentation over existing data
// (lib/data/preferences) — submission + reminder tracking for the active period.
// SM build-prep surface — gated to SM/HM/BM (same as the builder / hours / coverage).
export default async function PreferencesPage() {
  const user = await getSessionUser();
  if (user === null) return null; // layout redirected

  if (!canBuildSchedule(user)) {
    return (
      <div className="page">
        <PageHead eyebrow="Operate" title="Preferences oversight" />
        <Notification kind="warning" title="Managers only" testId="preferences-unauthorized">
          Preferences oversight is available to Student Managers and Housing Managers.
        </Notification>
      </div>
    );
  }

  const data = await getPreferencesOversight(adminHouseId(user));
  return <PreferencesOversight data={data} />;
}
