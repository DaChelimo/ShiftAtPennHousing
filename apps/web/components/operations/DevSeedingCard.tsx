'use client';

import { useState } from 'react';

import {
  autoBuildBalancedSchedule,
  publishOpenHouses,
  simulateWorkerPreferences,
  type AutoBuildHouseResult,
  type PublishHouseResult,
  type SimulatePrefsResult,
} from '../../lib/actions/devSeeding';
import type { HouseOption } from '../../lib/data/operatingSeasons';
import { Button, Card, Notification } from '../ui';

type Busy = 'prefs' | 'build' | 'publish' | null;

export function DevSeedingCard({
  seasonId,
  houses,
}: {
  seasonId: string;
  houses: HouseOption[];
}) {
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<SimulatePrefsResult | null>(null);
  const [build, setBuild] = useState<AutoBuildHouseResult[] | null>(null);
  const [published, setPublished] = useState<PublishHouseResult[] | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);

  const nameOf = (id: string) => houses.find((h) => h.id === id)?.name ?? id;

  async function onSimulate() {
    setBusy('prefs');
    setError(null);
    setPrefs(null);
    const res = await simulateWorkerPreferences(seasonId);
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setPrefs(res.data);
  }

  async function onAutoBuild() {
    setBusy('build');
    setError(null);
    setBuild(null);
    const res = await autoBuildBalancedSchedule(seasonId);
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setBuild(res.data.perHouse);
  }

  async function onPublish() {
    setBusy('publish');
    setError(null);
    setPublished(null);
    setConfirmPublish(false);
    const res = await publishOpenHouses(seasonId);
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setPublished(res.data.perHouse);
  }

  const disabled = busy !== null;

  return (
    <Card pad>
      <div className="col gap-4">
        <div className="col gap-1">
          <h2 className="t-h2">Dev seeding</h2>
          <p className="t-helper">
            Testing tools for this season. Fill in realistic worker preferences, auto build a
            balanced draft schedule for every open house, then publish. Use these instead of
            logging in as each worker and manager.
          </p>
        </div>

        <Notification kind="warning" title="Regeneration replaces prior data">
          Simulating preferences rewrites every worker&apos;s preferences and targets for this
          season, including any you edited by hand. Auto build replaces each house&apos;s current
          draft. Publishing is final and cannot be undone.
        </Notification>

        {error !== null && (
          <Notification kind="error" title="Something went wrong" onClose={() => setError(null)}>
            {error}
          </Notification>
        )}

        {/* 1. Simulate worker preferences */}
        <div className="col gap-2">
          <div className="row gap-3 wrap" style={{ alignItems: 'center' }}>
            <Button
              icon="refresh"
              kind="secondary"
              disabled={disabled}
              data-testid="dev-seed-prefs"
              onClick={onSimulate}
            >
              {busy === 'prefs' ? 'Simulating...' : 'Simulate worker preferences'}
            </Button>
            {prefs !== null && (
              <span className="t-body" data-testid="dev-seed-prefs-result">
                Wrote {prefs.prefsWritten} preferences for {prefs.workers} workers across{' '}
                {prefs.houses} {prefs.houses === 1 ? 'house' : 'houses'}.
                {prefs.skippedHouses.length > 0 &&
                  ` Skipped (no first-week shifts): ${prefs.skippedHouses.map(nameOf).join(', ')}.`}
              </span>
            )}
          </div>
        </div>

        {/* 2. Auto build balanced schedule */}
        <div className="col gap-2">
          <div className="row gap-3 wrap" style={{ alignItems: 'center' }}>
            <Button
              icon="grid"
              kind="secondary"
              disabled={disabled}
              data-testid="dev-seed-build"
              onClick={onAutoBuild}
            >
              {busy === 'build' ? 'Building...' : 'Auto build balanced schedule'}
            </Button>
            <span className="t-helper">Writes drafts only. Review each house in the builder.</span>
          </div>
          {build !== null && (
            <ul className="col gap-1" data-testid="dev-seed-build-result" style={{ margin: 0 }}>
              {build.map((h) => (
                <li key={h.houseId} className="t-body">
                  {nameOf(h.houseId)}:{' '}
                  {h.skipped
                    ? 'skipped (no shifts in the first week)'
                    : h.error !== undefined
                      ? `failed (${h.error})`
                      : `${h.assigned} seats assigned, ${h.unfilled} unfilled`}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 3. Publish open houses */}
        <div className="col gap-2">
          <div className="row gap-3 wrap" style={{ alignItems: 'center' }}>
            <Button
              icon="power"
              kind="secondary"
              disabled={disabled}
              data-testid="dev-seed-publish"
              onClick={() => setConfirmPublish(true)}
            >
              Publish open houses
            </Button>
            <span className="t-helper">Makes the current drafts live for every open house.</span>
          </div>

          {confirmPublish && (
            <Notification kind="warning" title="Publish every open house?">
              <div className="col gap-3">
                <span>
                  This makes the current draft schedules live for all open houses. It cannot be
                  undone.
                </span>
                <div className="row gap-3">
                  <Button
                    kind="danger"
                    disabled={disabled}
                    data-testid="dev-seed-publish-confirm"
                    onClick={onPublish}
                  >
                    {busy === 'publish' ? 'Publishing...' : 'Yes, publish'}
                  </Button>
                  <Button
                    kind="ghost"
                    disabled={disabled}
                    onClick={() => setConfirmPublish(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </Notification>
          )}

          {published !== null && (
            <ul className="col gap-1" data-testid="dev-seed-publish-result" style={{ margin: 0 }}>
              {published.map((h) => (
                <li key={h.houseId} className="t-body">
                  {nameOf(h.houseId)}:{' '}
                  {h.status === 'published'
                    ? `published (${h.scheduled ?? 0} seats scheduled)`
                    : h.status === 'skipped'
                      ? 'already published, skipped'
                      : `failed (${h.error ?? 'unknown error'})`}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
