'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { deleteOrphanedSeasonProfile } from '../../lib/actions/operatingSeasons';
import type { OrphanedSeasonProfile } from '../../lib/data/operatingSeasons';
import { Button, Card, Notification, Tag } from '../ui';

function fmtDate(d: string): string {
  return new Date(`${d}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function OrphanedProfilesPanel({ profiles }: { profiles: OrphanedSeasonProfile[] }) {
  const router = useRouter();
  const [busyProfile, setBusyProfile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (profiles.length === 0) return null;

  async function onDelete(p: OrphanedSeasonProfile) {
    const ok = window.confirm(
      `Delete "${p.profileName}"? This permanently removes ${p.calendarRows} calendar day(s), ` +
        `${p.patternRows} staffing pattern row(s), and its compiled profile. This cannot be undone.`,
    );
    if (!ok) return;

    setError(null);
    setMessage(null);
    setBusyProfile(p.profileName);
    const result = await deleteOrphanedSeasonProfile(p.profileName);
    setBusyProfile(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage(
      `Deleted ${p.profileName}: ${result.data.calendarRowsDeleted} calendar row(s) removed.`,
    );
    router.refresh();
  }

  return (
    <section className="col gap-3" data-testid="orphaned-profiles-panel">
      <h2 className="t-h2">Orphaned season data</h2>
      <p className="t-helper">
        Leftover compiled configuration from a season that no longer exists in the list above. This
        can happen if a season row was removed without its dates being cleaned up. Orphaned dates
        can block a new season from applying if their ranges overlap. Deleting a row here only
        removes calendar and staffing config, never live schedule data.
      </p>
      <Notification kind="warning" title="Needs cleanup" testId="orphaned-profiles-warning">
        {profiles.length} orphaned profile{profiles.length === 1 ? '' : 's'} found.
      </Notification>

      {error !== null && (
        <Notification kind="error" title="Delete failed" testId="orphaned-profiles-error">
          {error}
        </Notification>
      )}
      {message !== null && (
        <Notification kind="success" title="Deleted" testId="orphaned-profiles-success">
          {message}
        </Notification>
      )}

      <div className="col gap-3">
        {profiles.map((p) => {
          const blocked = p.periodRows > 0;
          return (
            <Card key={p.profileName} pad>
              <div className="row between gap-3 wrap">
                <div className="col gap-1">
                  <span className="t-h3" style={{ fontFamily: 'monospace' }}>
                    {p.profileName}
                  </span>
                  <span className="t-meta">
                    {fmtDate(p.minDate)} to {fmtDate(p.maxDate)}
                  </span>
                  <span className="t-meta">
                    {p.calendarRows} calendar day{p.calendarRows === 1 ? '' : 's'} · {p.patternRows}{' '}
                    staffing row{p.patternRows === 1 ? '' : 's'}
                    {p.periodRows > 0 &&
                      ` · ${p.periodRows} scheduling period${p.periodRows === 1 ? '' : 's'} (has attached schedule data)`}
                  </span>
                </div>
                <div className="row gap-3 center">
                  {blocked ? (
                    <Tag kind="red" dot>
                      Has schedule data, cannot auto-delete
                    </Tag>
                  ) : (
                    <Button
                      kind="danger"
                      size="sm"
                      icon="trash"
                      disabled={busyProfile === p.profileName}
                      onClick={() => onDelete(p)}
                      data-testid={`orphan-delete-${p.profileName}`}
                    >
                      {busyProfile === p.profileName ? 'Deleting…' : 'Delete'}
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
