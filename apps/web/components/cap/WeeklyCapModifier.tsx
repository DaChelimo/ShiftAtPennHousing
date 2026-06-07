'use client';

import { useState } from 'react';

import { saveWeeklyCap } from '../../lib/actions/cap';
import type { WeeklyCapAudit, WeeklyCapWeek } from '../../lib/data/cap';
import {
  Button,
  Card,
  type Column,
  DataTable,
  DateInput,
  Field,
  Notification,
  Tag,
  TextArea,
} from '../ui';

const COLUMNS: Column<WeeklyCapWeek>[] = [
  {
    key: 'week',
    header: 'Week',
    render: (w) => <span className="t-mono">{w.weekStartDate}</span>,
  },
  {
    key: 'cap',
    header: 'Effective cap',
    render: (w) => (
      <span className="row gap-2 center">
        <span className="t-mono">{w.hoursCap}h</span>
        <Tag kind={w.capEnforcement === 'hard' ? 'amber' : 'blue'}>
          {w.capEnforcement === 'hard' ? 'Hard' : 'Soft'}
        </Tag>
      </span>
    ),
  },
  {
    key: 'source',
    header: 'Source',
    render: (w) =>
      w.isOverride ? (
        <Tag kind="purple" icon="edit">
          Manual override
        </Tag>
      ) : (
        <span className="t-meta">Profile default</span>
      ),
  },
];

export function WeeklyCapModifier({ weeks }: { weeks: WeeklyCapWeek[] }) {
  const [weekStartDate, setWeekStartDate] = useState('');
  const [hoursCap, setHoursCap] = useState<20 | 40>(20);
  const [notes, setNotes] = useState('');
  const [audit, setAudit] = useState<WeeklyCapAudit | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setAudit(null);
    setError(null);
    const result = await saveWeeklyCap({ weekStartDate, hoursCap, notes });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAudit(result.data);
  }

  return (
    <div data-testid="cap-modifier" className="col gap-5">
      <Notification kind="info" title="Global control" testId="cap-global-notice">
        Every change applies to all 13 houses immediately — there is no per-house cap.
      </Notification>

      <Card pad>
        <div className="col gap-5">
          <div style={{ maxWidth: 260 }}>
            <Field label="Week beginning Monday">
              <DateInput
                data-testid="cap-week"
                value={weekStartDate}
                onChange={(event) => setWeekStartDate(event.target.value)}
              />
            </Field>
          </div>

          <Field label="Cap for this week">
            <div className="seg" role="group" aria-label="Weekly hours cap">
              <button
                type="button"
                data-testid="cap-value-20"
                aria-pressed={hoursCap === 20}
                className={`seg-btn ${hoursCap === 20 ? 'is-on' : ''}`.trim()}
                onClick={() => setHoursCap(20)}
              >
                20 hours · soft
              </button>
              <button
                type="button"
                data-testid="cap-value-40"
                aria-pressed={hoursCap === 40}
                className={`seg-btn ${hoursCap === 40 ? 'is-on' : ''}`.trim()}
                onClick={() => setHoursCap(40)}
              >
                40 hours · hard
              </button>
            </div>
          </Field>

          <Field
            label="Audit notes"
            helper="Recorded with who changed the cap and when (ARCH §3.10)."
          >
            <TextArea
              data-testid="cap-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>

          <div>
            <Button data-testid="cap-submit" disabled={saving} onClick={submit} icon="check">
              {saving ? 'Applying…' : 'Apply cap'}
            </Button>
          </div>
        </div>
      </Card>

      {error !== null && (
        <Notification kind="error" title="Could not apply cap">
          {error}
        </Notification>
      )}

      {audit !== null && (
        <Notification kind="success" title="Weekly cap saved" testId="cap-success">
          <div className="col gap-1" style={{ marginTop: 4, fontSize: 13 }}>
            <span data-testid="cap-audit-modified-by">
              <span className="t-meta">Modified by</span> {audit.modifiedByName}
            </span>
            <span data-testid="cap-audit-modified-at">
              <span className="t-meta">Modified at</span>{' '}
              <span className="t-mono">{audit.modifiedAt}</span>
            </span>
            <span data-testid="cap-audit-notes">
              <span className="t-meta">Notes</span> {audit.notes ?? 'None'}
            </span>
          </div>
        </Notification>
      )}

      <section className="col gap-2">
        <h2 className="t-h2">Upcoming weeks</h2>
        <DataTable
          columns={COLUMNS}
          rows={weeks}
          getRowKey={(w) => w.weekStartDate}
          emptyText="No upcoming weeks in the operating calendar."
        />
      </section>
    </div>
  );
}
