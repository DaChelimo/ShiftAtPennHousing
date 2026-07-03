import Link from 'next/link';
import { redirect } from 'next/navigation';

import { CreateSeasonForm } from '../../../../components/operations/CreateSeasonForm';
import { Card, EmptyState, Icon, Notification, PageHead, Tag } from '../../../../components/ui';
import { getSessionUser, isAdmin } from '../../../../lib/auth';
import { listSeasons } from '../../../../lib/data/operatingSeasons';

function fmtRange(start: string, end: string): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  const s = new Date(`${start}T00:00:00`).toLocaleDateString('en-US', opts);
  const e = new Date(`${end}T00:00:00`).toLocaleDateString('en-US', opts);
  return `${s} to ${e}`;
}

export default async function OperationsPage() {
  const user = await getSessionUser();
  if (user === null) redirect('/login');

  if (!isAdmin(user)) {
    return (
      <div className="page" style={{ maxWidth: 820 }}>
        <PageHead eyebrow="Operations" title="Operating seasons" />
        <Notification kind="warning" title="Administrators only" testId="operations-unauthorized">
          403. Only an administrator may configure operating seasons.
        </Notification>
      </div>
    );
  }

  const seasons = await listSeasons();

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <PageHead
        eyebrow="Operations"
        title="Operating seasons"
        sub="Configure which houses are active on which dates, staffing over time, and when floating is allowed. Managers and workers see the applied configuration."
      />

      <div className="col gap-5">
        <section className="col gap-3">
          <h2 className="t-h2">Seasons</h2>
          {seasons.length === 0 ? (
            <Card pad>
              <EmptyState
                icon="calendar"
                tone="neutral"
                title="No seasons yet"
                desc="Create your first season below to begin configuring summer operations."
              />
            </Card>
          ) : (
            <div className="col gap-3" data-testid="season-list">
              {seasons.map((s) => (
                <Card key={s.seasonId} pad>
                  <Link
                    href={`/admin/operations/${s.seasonId}`}
                    className="row between gap-3"
                    style={{ textDecoration: 'none', color: 'inherit' }}
                  >
                    <div className="col gap-1">
                      <span className="t-h3">{s.seasonName}</span>
                      <span className="t-meta">{fmtRange(s.startDate, s.endDate)}</span>
                    </div>
                    <div className="row gap-3 center">
                      {s.lastAppliedAt === null ? (
                        <Tag kind="gray" dot>
                          Draft
                        </Tag>
                      ) : (
                        <Tag kind="green" icon="check">
                          Applied
                        </Tag>
                      )}
                      <Icon name="chevRight" size={18} />
                    </div>
                  </Link>
                </Card>
              ))}
            </div>
          )}
        </section>

        <section className="col gap-3">
          <h2 className="t-h2">New season</h2>
          <CreateSeasonForm />
        </section>
      </div>
    </div>
  );
}
