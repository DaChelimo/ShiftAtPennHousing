import { redirect } from 'next/navigation';

import { getSessionUser, isHouseAdmin } from '../../../../lib/auth';
import { isProjectAdministrator } from '../../../../lib/data/config';
import { getOrchestratorHealth } from '../../../../lib/data/health';

export default async function HealthPage() {
  const user = await getSessionUser();
  if (user === null) redirect('/login');
  const authorized = isHouseAdmin(user) || (await isProjectAdministrator(user.userId));

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
      <h1 className="mb-1 text-lg font-semibold tracking-tight">Orchestrator health</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Most recent once-per-minute orchestrator summary.
      </p>
      {authorized ? <HealthSummary /> : <p>403: This page is restricted to administrators.</p>}
    </main>
  );
}

async function HealthSummary() {
  const health = await getOrchestratorHealth();
  if (health === null) return <p>No orchestrator tick has been recorded yet.</p>;

  return (
    <dl className="grid grid-cols-2 gap-3 rounded-lg border border-black/10 p-4 text-sm dark:border-white/10">
      <dt>Last tick</dt>
      <dd>{health.lastTickAt}</dd>
      <dt>Blocks scanned</dt>
      <dd>{health.blocksScanned}</dd>
      <dt>Steps fired</dt>
      <dd>{health.stepsFired}</dd>
      <dt>Floats voided</dt>
      <dd>{health.floatsVoided}</dd>
      <dt>Swaps expired</dt>
      <dd>{health.swapsExpired}</dd>
      <dt>Errors</dt>
      <dd>{health.errors.length === 0 ? 'None' : health.errors.join('; ')}</dd>
    </dl>
  );
}
