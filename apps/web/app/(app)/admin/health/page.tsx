import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Card } from '../../../../components/ui/Card';
import { EmptyState } from '../../../../components/ui/EmptyState';
import { Notification } from '../../../../components/ui/Notification';
import { PageHead } from '../../../../components/ui/PageHead';
import { Tag } from '../../../../components/ui/Tag';
import { getSessionUser, isHouseAdmin } from '../../../../lib/auth';
import { isProjectAdministrator } from '../../../../lib/data/config';
import { getOrchestratorHealth, getPushDeliveryHealth } from '../../../../lib/data/health';

export const metadata: Metadata = { title: 'Admin - Health' };

export default async function HealthPage() {
  const user = await getSessionUser();
  if (user === null) redirect('/login');
  const authorized = isHouseAdmin(user) || (await isProjectAdministrator(user.userId));

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <PageHead
        eyebrow="System"
        title="Orchestrator health"
        sub="The most recent once-per-minute orchestrator tick, plus per-integration health (§6.12)."
      />
      {authorized ? (
        <div className="col gap-5">
          <HealthSummary />
          <IntegrationsGrid />
        </div>
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
    </div>
  );
}

const NOT_CONFIGURED_INTEGRATIONS = [
  { id: 'sms', name: 'SMS' },
  { id: 'allied', name: 'Allied dispatch' },
  { id: 'sso', name: 'SSO' },
  { id: 'sis', name: 'SIS' },
] as const;

// Per-integration health cards (§6.12). Push delivery is the only integration
// instrumented in this build; the rest render an explicit "Not configured" card
// rather than a fabricated health signal.
async function IntegrationsGrid() {
  const push = await getPushDeliveryHealth();
  const pushHealthy =
    push.backlog === 0 ||
    (push.oldestPendingAgeMs !== null && push.oldestPendingAgeMs < 5 * 60_000);

  return (
    <div className="col gap-3">
      <span className="t-label" style={{ color: 'var(--text-secondary)' }}>
        Integrations
      </span>

      <Card pad data-testid="health-push-card">
        <div className="col gap-3">
          <div className="row gap-2 between">
            <span className="t-h3">Push delivery</span>
            {pushHealthy ? (
              <Tag kind="green" icon="checkCircle">
                Healthy
              </Tag>
            ) : (
              <Tag kind="amber" icon="warnFill">
                Backed up
              </Tag>
            )}
          </div>
          <div className="kv-list">
            <div className="kv">
              <span className="t-label">Backlog (undelivered, due)</span>
              <span className="t-mono">{push.backlog}</span>
            </div>
            <div className="kv">
              <span className="t-label">Oldest pending</span>
              <span className="t-mono">
                {push.oldestPendingAgeMs === null ? '—' : formatAgo(push.oldestPendingAgeMs)}
              </span>
            </div>
            <div className="kv">
              <span className="t-label">Registered device tokens</span>
              <span className="t-mono">
                {push.tokens.total} ({push.tokens.android} android / {push.tokens.ios} ios)
              </span>
            </div>
          </div>
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        {NOT_CONFIGURED_INTEGRATIONS.map((integration) => (
          <Card pad key={integration.id} data-testid={`health-not-configured-${integration.id}`}>
            <div className="col gap-2">
              <div className="row gap-2 between">
                <span className="t-h3">{integration.name}</span>
                <Tag kind="gray">Not configured</Tag>
              </div>
              <span className="t-helper">
                No integration is wired in this build — health is not instrumented.
              </span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// Relative age for the oldest undelivered notification, e.g. "4m ago".
function formatAgo(ageMs: number): string {
  const mins = Math.max(0, Math.floor(ageMs / 60_000));
  if (mins < 1) return '<1m ago';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
