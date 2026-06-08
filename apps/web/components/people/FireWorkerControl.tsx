'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { fireWorker } from '../../lib/actions/people';
import { Button, Modal, Notification } from '../ui';

// S4 — the per-row Fire control on /admin/people (BSpec §4.5). Rendered only on
// active worker rows (the page already gates isHouseAdmin). Clicking opens a
// destructive confirm modal describing the consequences; confirm calls the
// fireWorker action (the RPC unwinds every obligation atomically) and refreshes
// the roster so the row flips to Inactive and this control disappears.
//
// No-takeback is WAIVED for firing (§4.5) — this is the sanctioned manual HR
// event. Mirrors the coverage ForceTriggerControl client pattern (useRouter +
// Modal testId + data-testid buttons + router.refresh on success).
export function FireWorkerControl({ userId, name }: { userId: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const res = await fireWorker({ userId });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setConfirming(false);
    setError(null);
    setDone(true);
    // Refresh so the row's Status flips to Inactive and the Fire button is gone.
    router.refresh();
  }

  return (
    <>
      <Button
        kind="ghost"
        size="sm"
        icon="trash"
        data-testid={`people-fire-${userId}`}
        disabled={busy}
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
      >
        Fire
      </Button>

      {done && (
        <Notification kind="success" title="Worker fired" testId="fire-success">
          {name}’s account has been deactivated and their shifts released.
        </Notification>
      )}

      {confirming && (
        <Modal
          testId="fire-confirm"
          danger
          eyebrow="Fire worker"
          title={`Fire ${name}?`}
          onClose={() => {
            if (!busy) setConfirming(false);
          }}
          footer={
            <>
              <Button
                kind="secondary"
                data-testid="fire-confirm-cancel"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
              <Button
                kind="danger"
                icon="trash"
                data-testid="fire-confirm-accept"
                disabled={busy}
                onClick={run}
              >
                {busy ? 'Firing…' : 'Fire worker'}
              </Button>
            </>
          }
        >
          <p style={{ marginBottom: 8 }}>
            This permanently removes <b>{name}</b> from the schedule. It cannot be undone here.
          </p>
          <p className="t-meta" style={{ margin: 0 }}>
            Firing vacates all of their shifts, voids any pending or acknowledged floats, and
            deactivates their account. Any mid-shift gap that drops a desk below its required
            headcount escalates to a float lookup immediately.
          </p>
          {error !== null && (
            <Notification kind="error" title="Could not fire worker" testId="fire-error">
              {error}
            </Notification>
          )}
        </Modal>
      )}
    </>
  );
}
