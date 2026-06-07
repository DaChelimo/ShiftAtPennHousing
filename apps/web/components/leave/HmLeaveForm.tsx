'use client';

import { useState } from 'react';

import { returnFromLeave, submitLeave } from '../../lib/actions/leave';
import type { ActiveLeave, ReplacementOption } from '../../lib/data/leave';
import { Button, Card, ComboBox, DateInput, Field, Notification } from '../ui';

export function HmLeaveForm({
  candidates,
  defaultReplacementUserId,
  myActiveLeaves,
}: {
  candidates: ReplacementOption[];
  defaultReplacementUserId: string | null;
  myActiveLeaves: ActiveLeave[];
}) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [replacementUserId, setReplacementUserId] = useState<string | null>(
    defaultReplacementUserId,
  );
  const [mailtoUrl, setMailtoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const res = await submitLeave({ startDate, endDate, replacementUserId });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setMailtoUrl(res.data.mailtoUrl);
  }

  return (
    <div className="col gap-6">
      <Card pad>
        <form data-testid="hm-leave-form" onSubmit={onSubmit} className="col gap-5">
          <div className="row gap-4 wrap">
            <div className="grow" style={{ minWidth: 200 }}>
              <Field label="Start date">
                <DateInput
                  data-testid="leave-start-date"
                  required
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </Field>
            </div>
            <div className="grow" style={{ minWidth: 200 }}>
              <Field label="End date">
                <DateInput
                  data-testid="leave-end-date"
                  required
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </Field>
            </div>
          </div>

          <Field
            label="Replacement"
            helper="HMs in your incoming replacement chain are omitted to prevent cycles (§2.6)."
          >
            <ComboBox
              testId="replacement-select"
              listTestId="replacement-options"
              placeholder="Select replacement…"
              value={replacementUserId}
              onChange={setReplacementUserId}
              options={candidates.map((c) => ({
                value: c.userId,
                label: c.name,
                meta: c.role,
              }))}
            />
          </Field>

          {error !== null && (
            <p data-testid="leave-error" className="t-helper" style={{ color: 'var(--st-danger)' }}>
              {error}
            </p>
          )}

          <div>
            <Button type="submit" data-testid="leave-submit" disabled={submitting} icon="power">
              {submitting ? 'Submitting…' : 'Submit leave'}
            </Button>
          </div>

          {mailtoUrl !== null && (
            <Notification kind="success" title="Leave recorded">
              <p style={{ marginBottom: 8 }}>Notify the student workers of your house:</p>
              <a
                data-testid="leave-mailto"
                href={mailtoUrl}
                className="btn btn-tertiary btn-sm"
                style={{ width: 'fit-content' }}
              >
                <span>Open pre-filled email</span>
              </a>
            </Notification>
          )}
        </form>
      </Card>

      {myActiveLeaves.length > 0 && (
        <section className="col gap-3">
          <h2 className="t-h2">Active leaves</h2>
          <div className="col gap-2">
            {myActiveLeaves.map((leave) => (
              <Card key={leave.leaveId} className="row between" style={{ padding: '12px 16px' }}>
                <span className="t-body">
                  <span className="t-mono">
                    {leave.startDate} → {leave.endDate}
                  </span>
                  {leave.replacementName !== null && (
                    <span className="t-meta" style={{ marginLeft: 8 }}>
                      cover: {leave.replacementName}
                    </span>
                  )}
                </span>
                <ImBackButton leaveId={leave.leaveId} />
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ImBackButton({ leaveId }: { leaveId: string }) {
  const [busy, setBusy] = useState(false);
  const [returnMailto, setReturnMailto] = useState<string | null>(null);

  if (returnMailto !== null) {
    return (
      <a data-testid="leave-return-mailto" href={returnMailto} className="btn btn-tertiary btn-sm">
        <span>Open &ldquo;back from leave&rdquo; email</span>
      </a>
    );
  }

  return (
    <Button
      kind="secondary"
      size="sm"
      data-testid="leave-im-back"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const res = await returnFromLeave({ leaveId });
        setBusy(false);
        if (res.ok && res.data.mailtoUrl !== null) setReturnMailto(res.data.mailtoUrl);
      }}
    >
      I&apos;m back
    </Button>
  );
}
