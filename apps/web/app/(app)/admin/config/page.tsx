import { redirect } from 'next/navigation';

import { SystemConfigEditor } from '../../../../components/config/SystemConfigEditor';
import { Notification } from '../../../../components/ui/Notification';
import { PageHead } from '../../../../components/ui/PageHead';
import { getSessionUser } from '../../../../lib/auth';
import { getSystemConfig, isProjectAdministrator } from '../../../../lib/data/config';

export default async function ConfigPage() {
  const user = await getSessionUser();
  if (user === null) redirect('/login');

  const authorized = await isProjectAdministrator(user.userId);
  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <PageHead
        eyebrow="System"
        title="System configuration"
        sub="Project-wide runtime values that control scheduling, floats, and escalation."
      />
      {authorized ? (
        <SystemConfigEditor initialRows={await getSystemConfig()} />
      ) : (
        <Notification kind="warning" title="Administrators only" testId="config-unauthorized">
          403 — only the project administrator may edit system configuration.
        </Notification>
      )}
    </div>
  );
}
