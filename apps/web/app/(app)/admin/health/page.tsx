import { redirect } from 'next/navigation';

import { EmptyState } from '../../../../components/ui/EmptyState';
import { Notification } from '../../../../components/ui/Notification';
import { PageHead } from '../../../../components/ui/PageHead';
import { Tag } from '../../../../components/ui/Tag';
import { getSessionUser, isHouseAdmin } from '../../../../lib/auth';
import { isProjectAdministrator } from '../../../../lib/data/config';
import { getOrchestratorHealth } from '../../../../lib/data/health';

export default async function HealthPage() {
  const user = await getSessionUser();
  if (user === null) redirect('/login');
  const authorized = isHouseAdmin(user) || (await isProjectAdministrator(user.userId));

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <PageHead
        eyebrow="System"
        title="Orchestrator health"
        sub="The most recent once-per-minute orchestrator tick (§6.12)."
      />
      {authorized ? (
        <HealthSummary />
      ) : (
        <Notification kind="warning" title="Administrators only" testId="health-unauthorized">
          403 — this page is restricted to administrators.
        </Notification>
      )}
    </div>
  );
}

async function HealthSummary() {
  const health = await getOrchestratorHealth();
  if (health === null) {
    return (
      <EmptyState
        tone="neutral"
        icon="clock"
        title="No tick recorded yet"
        desc="The orchestrator has not run a once-per-minute tick in this environment."
      />
    );
  }

  const healthy = health.errors.length === 0;
  const stats: { label: string; value: number }[] = [
    { label: 'Blocks scanned', value: health.blocksScanned },
    { label: 'Steps fired', value: health.stepsFired },
    { label: 'Floats voided', value: health.floatsVoided },
    { label: 'Swaps expired', value: health.swapsExpired },
  ];

  return (
    <div className="col gap-5">
      <div className="row gap-2 center">
        {healthy ? (
          <Tag kind="green" icon="checkCircle">
            Healthy
          </Tag>
        ) : (
          <Tag kind="red" icon="warnFill">
            {health.errors.length} {health.errors.length === 1 ? 'error' : 'errors'}
          </Tag>
        )}
        <span className="t-meta">
          Last tick <span className="t-mono">{health.lastTickAt}</span>
        </span>
      </div>

      <div className="statstrip" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {stats.map((s) => (
          <div className="statcard" key={s.label}>
            <span className="statcard-num">{s.value}</span>
            <span className="statcard-label">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="kv-list">
        <div className="kv">
          <span className="t-label">Last tick</span>
          <span className="t-mono">{health.lastTickAt}</span>
        </div>
        <div className="kv">
          <span className="t-label">Errors</span>
          <span style={{ color: healthy ? undefined : 'var(--st-danger)', textAlign: 'right' }}>
            {healthy ? 'None' : health.errors.join('; ')}
          </span>
        </div>
      </div>

      <Notification kind="info" title="Integration status not instrumented">
        Per-integration health (SMS / Allied / SSO / SIS) isn&apos;t recorded in this build — only
        the orchestrator tick above is tracked (DESIGN_TOKENS.md §6).
      </Notification>
    </div>
  );
}
