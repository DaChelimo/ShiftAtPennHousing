'use client';

// Destructive "remove a live document" control. Mirrors the FireWorkerControl
// client pattern (confirming/busy/error state, Modal danger, inline Notification
// on failure) -- the established confirm-before-destroy convention in apps/web.

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { deleteDocument } from '../../lib/actions/kbIntake';
import { Button, Modal, Notification } from '../ui';

export function DeleteDocumentControl({
  intakeId,
  title,
  onDeleted,
}: {
  intakeId: string;
  title: string;
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const res = await deleteDocument(intakeId);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setConfirming(false);
    router.refresh();
    onDeleted?.();
  }

  return (
    <>
      <Button
        kind="ghost"
        size="sm"
        icon="trash"
        data-testid={`kb-delete-${intakeId}`}
        disabled={busy}
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
      >
        Delete
      </Button>

      {confirming && (
        <Modal
          testId="kb-delete-confirm"
          danger
          eyebrow="Remove document"
          title={`Delete "${title}"?`}
          onClose={() => {
            if (!busy) setConfirming(false);
          }}
          footer={
            <>
              <Button
                kind="secondary"
                data-testid="kb-delete-cancel"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
              <Button
                kind="danger"
                icon="trash"
                data-testid="kb-delete-accept"
                disabled={busy}
                onClick={run}
              >
                {busy ? 'Deleting...' : 'Delete document'}
              </Button>
            </>
          }
        >
          <p style={{ marginBottom: 8 }}>
            This permanently removes every chunk indexed from <b>{title}</b>. The assistant will no
            longer be able to retrieve or cite it. This cannot be undone.
          </p>
          <p className="t-meta" style={{ margin: 0 }}>
            The pipeline cost and timing already recorded for this upload stay visible for
            reference; only the live, citable content is removed.
          </p>
          {error !== null && (
            <Notification kind="error" title="Could not delete document" testId="kb-delete-error">
              {error}
            </Notification>
          )}
        </Modal>
      )}
    </>
  );
}
