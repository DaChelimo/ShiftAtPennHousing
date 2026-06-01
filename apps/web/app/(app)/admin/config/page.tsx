import { redirect } from 'next/navigation';

import { SystemConfigEditor } from '../../../../components/config/SystemConfigEditor';
import { getSessionUser } from '../../../../lib/auth';
import { getSystemConfig, isProjectAdministrator } from '../../../../lib/data/config';

export default async function ConfigPage() {
  const user = await getSessionUser();
  if (user === null) redirect('/login');

  const authorized = await isProjectAdministrator(user.userId);
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <h1 className="mb-1 text-lg font-semibold tracking-tight">System configuration</h1>
      <p className="mb-6 text-sm text-zinc-500">Project-wide runtime values with an audit trail.</p>
      {authorized ? (
        <SystemConfigEditor initialRows={await getSystemConfig()} />
      ) : (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
          403: Only the project administrator may edit system configuration.
        </div>
      )}
    </main>
  );
}
