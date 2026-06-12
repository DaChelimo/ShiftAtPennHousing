'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { setPreferenceDeadline } from '../../lib/actions/preferences';
import type { DeadlineStatus, PreferencePeriod } from '../../lib/data/preferences';
import { Button, DateInput, Field, Notification, Tag, type TagKind } from '../ui';

const DEADLINE_META: Record<DeadlineStatus, { label: string; kind: TagKind }> = {
  open: { label: 'Open', kind: 'green' },
  closed: { label: 'Closed', kind: 'gray' },
  unset: { label: 'No deadline set', kind: 'outline' },
  published: { label: 'Published', kind: 'blue' },
};

function deadlineCaption(period: PreferencePeriod): string {
  const { status, deadlineLabel, daysToDeadline } = period;
  if (status === 'published') {
    return 'This period is published — preferences are locked and the schedule is live.';
  }
  if (status === 'unset' || deadlineLabel === null || daysToDeadline === null) {
    return 'No deadline set — preference submission is open indefinitely.';
  }
  if (status === 'open') {
    const d = daysToDeadline;
    const rel = d <= 0 ? 'today' : d === 1 ? 'in 1 day' : `in ${d} days`;
    return `Submissions close ${rel} · ${deadlineLabel}.`;
  }
  const ago = Math.abs(daysToDeadline);
  const rel = ago === 0 ? 'today' : ago === 1 ? '1 day ago' : `${ago} days ago`;
  return `Submissions closed ${rel} · ${deadlineLabel}.`;
}

// Set / change the preference-submission deadline (BSpec §4.2). Live write path
// via the set_preference_deadline RPC (server action). A published period locks
// the deadline (the RPC rejects it too) — the editor is disabled in that case.
export function DeadlineEditor({ period }: { period: PreferencePeriod }) {
  const router = useRouter();
  const [date, setDate] = useState(period.deadlineDateValue ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const locked = period.status === 'published';

  async function submit() {
    if (date === '') {
      setError('Choose a deadline date.');
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    const result = await setPreferenceDeadline({ periodId: period.periodId, deadlineDate: date });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <section
      data-testid="preferences-deadline-editor"
      className="card"
      style={{ padding: 16, margin: '16px 0 20px', display: 'grid', gap: 16 }}
      aria-label="Submission deadline"
    >
      <div className="row between wrap gap-4" style={{ alignItems: 'flex-start' }}>
        <div className="col gap-1">
          <span className="t-eyebrow">Submission deadline</span>
          <span className="row gap-2 center">
            <Tag kind={DEADLINE_META[period.status].kind}>{DEADLINE_META[period.status].label}</Tag>
            <span className="t-h2" style={{ margin: 0 }} data-testid="preferences-deadline-value">
              {period.deadlineLabel ?? 'Not set'}
            </span>
          </span>
          <span className="t-helper">{deadlineCaption(period)}</span>
        </div>
        <div className="row gap-3 wrap" style={{ alignItems: 'flex-end' }}>
          <Field
            label="New deadline"
            helper={
              locked
                ? 'Locked — this period is published.'
                : 'Submission closes at end of day (NY) on this date.'
            }
          >
            <DateInput
              data-testid="preferences-deadline-input"
              value={date}
              disabled={locked || saving}
              onChange={(event) => setDate(event.target.value)}
              aria-label="New submission deadline"
            />
          </Field>
          <Button
            data-testid="preferences-deadline-submit"
            icon="calendar"
            disabled={locked || saving}
            onClick={submit}
          >
            {saving ? 'Setting…' : 'Set deadline'}
          </Button>
        </div>
      </div>

      {error !== null && (
        <Notification
          kind="error"
          title="Could not set the deadline"
          testId="preferences-deadline-error"
        >
          {error}
        </Notification>
      )}
      {saved && error === null && (
        <Notification kind="success" title="Deadline updated" testId="preferences-deadline-success">
          Reminders will send 5 / 3 / 1 days before the new deadline to workers who haven’t
          responded.
        </Notification>
      )}
    </section>
  );
}
