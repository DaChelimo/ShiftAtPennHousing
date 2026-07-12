'use client';

import { useState } from 'react';

import { inviteHouseRoster, type InviteLink } from '../../lib/actions/invites';
import { setHouseLaunch, setStaggeredLaunch } from '../../lib/actions/launch';
import type { LaunchBoard, LaunchHouse } from '../../lib/data/launch';
import { Button, Card, Modal, Notification, Tag, Toggle } from '../ui';

// Phase B — the staggered-launch admin console. Master switch + per-house go-live
// toggles with a readiness snapshot, plus a per-house "Invite roster" that surfaces the
// GoTrue set-password links for the whole house at once.

function fmtDate(iso: string | null): string {
  if (iso === null) return 'not yet';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function LaunchConsole({ board }: { board: LaunchBoard }) {
  const [enforced, setEnforced] = useState(board.enforced);
  const [houses, setHouses] = useState<LaunchHouse[]>(board.houses);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteResult, setInviteResult] = useState<{ house: string; links: InviteLink[] } | null>(
    null,
  );

  async function toggleMaster(next: boolean) {
    setBusy('master');
    setError(null);
    const res = await setStaggeredLaunch({ enabled: next });
    if (res.ok) setEnforced(next);
    else setError(res.error);
    setBusy(null);
  }

  async function toggleHouse(house: LaunchHouse, live: boolean) {
    setBusy(house.id);
    setError(null);
    const res = await setHouseLaunch({ houseId: house.id, live });
    if (res.ok) {
      setHouses((prev) =>
        prev.map((h) =>
          h.id === house.id
            ? {
                ...h,
                launchState: live ? 'live' : 'pre_launch',
                launchedAt: live && h.launchedAt === null ? new Date().toISOString() : h.launchedAt,
              }
            : h,
        ),
      );
    } else {
      setError(res.error);
    }
    setBusy(null);
  }

  async function invite(house: LaunchHouse) {
    setBusy(`invite-${house.id}`);
    setError(null);
    const res = await inviteHouseRoster({ houseId: house.id });
    if (res.ok) setInviteResult({ house: house.name, links: res.data.links });
    else setError(res.error);
    setBusy(null);
  }

  return (
    <div className="col gap-5">
      {error !== null && (
        <Notification kind="error" title="Something went wrong" testId="launch-error">
          {error}
        </Notification>
      )}

      <Card pad className="col gap-3">
        <div className="row between gap-3" style={{ alignItems: 'center' }}>
          <div className="col gap-1">
            <div className="t-h2">Staggered launch</div>
            <p className="t-helper" style={{ margin: 0 }}>
              When on, only houses marked live are usable. Workers at other houses see a coming soon
              screen. When off, every house is live (the default).
            </p>
          </div>
          <Toggle
            checked={enforced}
            disabled={busy === 'master'}
            ariaLabel="Staggered launch enforcement"
            onChange={toggleMaster}
          />
        </div>
        {!enforced && (
          <Notification kind="info" title="Enforcement off" testId="launch-enforcement-off">
            Every house is currently live regardless of the toggles below. Turn enforcement on to
            roll out house by house.
          </Notification>
        )}
      </Card>

      <section className="col gap-3">
        <h2 className="t-h2">Houses</h2>
        <div className="col gap-2" data-testid="launch-house-list">
          {houses.map((h) => {
            const live = h.launchState === 'live';
            return (
              <Card key={h.id} pad>
                <div className="row between gap-3" style={{ alignItems: 'center' }}>
                  <div className="col gap-1">
                    <div className="row gap-2" style={{ alignItems: 'center' }}>
                      <span className="t-strong">{h.name}</span>
                      <Tag kind={live ? 'green' : 'gray'}>{live ? 'Live' : 'Pre launch'}</Tag>
                    </div>
                    <p className="t-helper" style={{ margin: 0 }}>
                      {h.rosterCount} worker{h.rosterCount === 1 ? '' : 's'} ·{' '}
                      {h.futureBlockCount > 0 ? 'schedule ready' : 'no schedule yet'} · launched{' '}
                      {fmtDate(h.launchedAt)}
                    </p>
                  </div>
                  <div className="row gap-2" style={{ alignItems: 'center' }}>
                    <Button
                      kind="secondary"
                      size="sm"
                      disabled={busy === `invite-${h.id}`}
                      onClick={() => invite(h)}
                      data-testid={`launch-invite-${h.id}`}
                    >
                      {busy === `invite-${h.id}` ? 'Inviting…' : 'Invite roster'}
                    </Button>
                    <Toggle
                      checked={live}
                      disabled={busy === h.id}
                      ariaLabel={`${h.name} live`}
                      onChange={(next) => toggleHouse(h, next)}
                    />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      {inviteResult !== null && (
        <Modal
          title={`Invite links for ${inviteResult.house}`}
          eyebrow="Account onboarding"
          testId="launch-invite-modal"
          width={640}
          onClose={() => setInviteResult(null)}
          footer={<Button onClick={() => setInviteResult(null)}>Done</Button>}
        >
          <p className="t-helper">
            Share each link with the worker so they can set their password. Each link signs that
            worker in to choose a password, so treat it as a secret and send it only to them.
          </p>
          <div className="col gap-2" style={{ marginTop: 12 }}>
            {inviteResult.links.map((l) => (
              <div key={l.userId} className="row between gap-2" style={{ alignItems: 'center' }}>
                <div className="col" style={{ minWidth: 0 }}>
                  <span className="t-strong">{l.name}</span>
                  <span className="t-helper">{l.email}</span>
                </div>
                {l.actionLink !== null ? (
                  <Button
                    kind="ghost"
                    size="sm"
                    onClick={() => navigator.clipboard?.writeText(l.actionLink ?? '')}
                  >
                    Copy link
                  </Button>
                ) : (
                  <Tag kind="red">Failed</Tag>
                )}
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
