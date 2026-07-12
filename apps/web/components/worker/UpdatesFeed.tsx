'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { acknowledgeFloat, declineFloat } from '../../lib/actions/worker/floats';
import type { FloatRequestView, UpdatesBoard } from '../../lib/data/worker/floats';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { Notification } from '../ui/Notification';
import { PageHead } from '../ui/PageHead';
import { Tag } from '../ui/Tag';

function FloatCard({
  float,
  busy,
  onAck,
  onDecline,
}: {
  float: FloatRequestView;
  busy: boolean;
  onAck: (id: string) => void;
  onDecline: (id: string) => void;
}) {
  return (
    <Card pad className="float-card" data-testid={`float-${float.floatId}`}>
      <div className="row gap-2" style={{ alignItems: 'center' }}>
        <Avatar name={float.destinationHouseName} size={36} />
        <div className="col grow" style={{ gap: 2 }}>
          <div className="row gap-2" style={{ alignItems: 'center' }}>
            <span className="t-h2">{float.timeLabel}</span>
            <Tag kind="blue">Float request</Tag>
          </div>
          <span className="t-helper">
            {float.whenLabel} · {float.durationLabel} · at {float.destinationHouseName}
          </span>
        </div>
      </div>

      {float.respondable ? (
        <>
          <div
            className={`float-countdown t-meta ${float.urgent ? 'is-urgent' : ''}`.trim()}
            data-testid={`float-countdown-${float.floatId}`}
          >
            {float.acceptByLabel} · {String(float.minutesLeft)}m left
          </div>
          <div className="float-actions">
            <Button
              kind="primary"
              data-testid={`float-accept-${float.floatId}`}
              disabled={busy}
              onClick={() => onAck(float.floatId)}
            >
              Accept
            </Button>
            <Button
              kind="secondary"
              data-testid={`float-decline-${float.floatId}`}
              disabled={busy}
              onClick={() => onDecline(float.floatId)}
            >
              Decline
            </Button>
          </div>
        </>
      ) : (
        <Notification kind="warning" title="Response window closed">
          This float is being reassigned. It is too close to the start time to respond.
        </Notification>
      )}
    </Card>
  );
}

export function UpdatesFeed({ board }: { board: UpdatesBoard }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null);

  async function act(floatId: string, kind: 'accept' | 'decline') {
    if (busy) return;
    setBusy(true);
    setToast(null);
    const res = await (kind === 'accept' ? acknowledgeFloat(floatId) : declineFloat(floatId));
    setBusy(false);
    if (res.ok) {
      setToast({
        kind: 'ok',
        message: kind === 'accept' ? 'Float accepted. It is now in My shifts.' : 'Float declined.',
      });
      router.refresh();
    } else {
      setToast({ kind: 'error', message: res.error });
    }
  }

  return (
    <div className="page" data-testid="updates">
      <PageHead
        eyebrow="Updates"
        title="Float requests"
        sub="Respond to shifts you have been asked to cover at another desk."
      />

      {toast && (
        <Notification
          kind={toast.kind === 'ok' ? 'success' : 'error'}
          title={toast.kind === 'ok' ? 'Done' : 'Could not respond'}
          onClose={() => setToast(null)}
          testId="updates-toast"
        >
          {toast.message}
        </Notification>
      )}

      {board.pending.length === 0 ? (
        <EmptyState
          icon="bell"
          title="Nothing to respond to"
          desc="When you are asked to float to another desk, the request shows up here."
        />
      ) : (
        <div className="open-feed" data-testid="pending_float_notification">
          {board.pending.map((f) => (
            <FloatCard
              key={f.floatId}
              float={f}
              busy={busy}
              onAck={(id) => act(id, 'accept')}
              onDecline={(id) => act(id, 'decline')}
            />
          ))}
        </div>
      )}

      {board.recent.length > 0 && (
        <details className="recent-floats" data-testid="recent-floats">
          <summary className="t-body">Recent float requests</summary>
          <div className="col gap-2" style={{ marginTop: 10 }}>
            {board.recent.map((r) => (
              <Card key={r.floatId} pad data-testid={`recent-float-${r.floatId}`}>
                <div className="row gap-2" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="t-helper">
                    {r.destinationHouseName} · {r.timeLabel}
                  </span>
                  <Tag kind={r.status === 'acknowledged' ? 'green' : 'gray'}>{r.statusLabel}</Tag>
                </div>
              </Card>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
