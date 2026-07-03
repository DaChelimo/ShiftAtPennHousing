'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  deleteRow,
  previewOrApplySeason,
  saveFloatWindow,
  saveHouseWindow,
  setSeasonPreferenceDeadline,
  type SeasonImpact,
} from '../../lib/actions/operatingSeasons';
import type { AuditRow, HouseOption, SeasonDetail } from '../../lib/data/operatingSeasons';
import { Button, Card, DateInput, Field, Icon, Notification, Select, Tag, TextInput } from '../ui';

const IMPACT_TILES: { key: keyof SeasonImpact; label: string; danger?: boolean }[] = [
  { key: 'blocks_generated', label: 'Shifts created' },
  { key: 'seats_added', label: 'Seats added' },
  { key: 'seats_removed', label: 'Seats removed' },
  { key: 'blocks_voided', label: 'Shifts cancelled', danger: true },
  { key: 'assignments_cancelled', label: 'Workers removed', danger: true },
  { key: 'floats_voided', label: 'Floats cancelled', danger: true },
  { key: 'blocks_grandfathered', label: 'Grandfathered' },
];

function fmtDate(d: string): string {
  return new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// The NY calendar date (YYYY-MM-DD) of a stored timestamptz, for the date input.
function nyDateValue(iso: string | null): string {
  if (iso === null) return '';
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function fmtDeadline(iso: string | null): string {
  if (iso === null) return 'Not set';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(iso));
}

// Group windows by house so a house's consecutive periods (e.g. Rodin single-staffed
// then double-staffed) read together, rather than interleaved by insertion order.
// Groups are ordered by their earliest window; rows within a group are chronological.
function groupHouseWindows<T extends { houseId: string; startDate: string }>(windows: T[]): T[][] {
  const byHouse = new Map<string, T[]>();
  for (const w of windows) {
    const list = byHouse.get(w.houseId) ?? [];
    list.push(w);
    byHouse.set(w.houseId, list);
  }
  const groups = [...byHouse.values()].map((list) =>
    [...list].sort((a, b) => a.startDate.localeCompare(b.startDate)),
  );
  groups.sort((a, b) => a[0]!.startDate.localeCompare(b[0]!.startDate));
  return groups;
}

export function SeasonEditor({
  detail,
  houses,
  audit,
}: {
  detail: SeasonDetail;
  houses: HouseOption[];
  audit: AuditRow[];
}) {
  const router = useRouter();
  const { season } = detail;
  const nameOf = (id: string) => houses.find((h) => h.id === id)?.name ?? id;
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<SeasonImpact | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);

  const [hw, setHw] = useState({
    houseId: houses[0]?.id ?? '',
    startDate: season.startDate,
    endDate: season.endDate,
    headcount: 1,
    shiftStart: '',
    shiftEnd: '',
    days: 'all' as 'all' | 'weekdays' | 'weekends',
  });
  const [fw, setFw] = useState({ startDate: season.startDate, endDate: season.endDate });
  const [deadline, setDeadline] = useState(nyDateValue(detail.preferenceDeadline));

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    setPreview(null);
    const result = await fn();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? 'Action failed.');
      return;
    }
    router.refresh();
  }

  async function doPreview() {
    setBusy(true);
    setError(null);
    setConfirmApply(false);
    const result = await previewOrApplySeason(season.seasonId, true);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      setPreview(null);
      return;
    }
    setPreview(result.data);
  }

  async function doApply() {
    setBusy(true);
    setError(null);
    const result = await previewOrApplySeason(season.seasonId, false);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPreview(result.data);
    setConfirmApply(false);
    router.refresh();
  }

  const willVoid =
    preview !== null && (preview.assignments_cancelled > 0 || preview.floats_voided > 0);

  return (
    <div className="col gap-5">
      {error !== null && (
        <Notification kind="error" title="Something went wrong">
          {error}
        </Notification>
      )}

      {/* Season settings summary */}
      <Card pad>
        <div className="col gap-3">
          <h2 className="t-h2">Season settings</h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: 16,
            }}
          >
            <Summary
              label="Dates"
              value={`${fmtDate(season.startDate)} to ${fmtDate(season.endDate)}`}
            />
            <Summary label="Weekly cap" value={`${season.hoursCap}h · ${season.capEnforcement}`} />
            <Summary
              label="Desk hours"
              value={`${season.shiftStartBound} to ${season.shiftEndBound}`}
            />
            <Summary
              label="Scheduling"
              value={season.schedulingMode === 'sm_built' ? 'SM built' : 'Claim based'}
            />
          </div>

          <div className="divider" />

          {/* Preference deadline — one value for all houses (periods are global). */}
          <div className="row between wrap gap-4" style={{ alignItems: 'flex-end' }}>
            <div className="col gap-1">
              <span className="t-meta">Preference deadline</span>
              <span
                className="t-body"
                style={{ fontWeight: 500 }}
                data-testid="pref-deadline-value"
              >
                {fmtDeadline(detail.preferenceDeadline)}
              </span>
              <span className="t-helper">
                Workers submit preferred summer shifts until this date. Submission closes end of day
                (NY); it must fall before the season starts. Leave blank for no deadline.
              </span>
            </div>
            <div className="row gap-3 wrap" style={{ alignItems: 'flex-end' }}>
              <Field label="Set deadline">
                <DateInput
                  data-testid="pref-deadline-input"
                  value={deadline}
                  disabled={busy}
                  onChange={(e) => setDeadline(e.target.value)}
                  aria-label="Preference submission deadline"
                />
              </Field>
              <Button
                icon="calendar"
                kind="secondary"
                disabled={busy}
                data-testid="pref-deadline-save"
                onClick={() =>
                  run(() =>
                    setSeasonPreferenceDeadline({
                      seasonId: season.seasonId,
                      deadlineDate: deadline,
                    }),
                  )
                }
              >
                Save deadline
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* Houses */}
      <Card pad>
        <div className="col gap-4">
          <div className="col gap-1">
            <h2 className="t-h2">Houses</h2>
            <p className="t-helper">
              Each open window makes a house active for those dates at that staffing level. A date
              with no window means the house is closed.
            </p>
          </div>

          {detail.houseWindows.length === 0 ? (
            <p className="t-meta">No houses open yet. Add a window below.</p>
          ) : (
            <div className="dtable-wrap">
              <table className="dtable" data-testid="house-windows">
                <thead>
                  <tr>
                    <th>House</th>
                    <th>Open</th>
                    <th>Hours</th>
                    <th style={{ textAlign: 'right' }}>Staffing</th>
                    <th aria-label="actions" />
                  </tr>
                </thead>
                <tbody>
                  {groupHouseWindows(detail.houseWindows).map((group, groupIndex) =>
                    group.map((w, rowIndex) => (
                      <tr
                        key={w.windowId}
                        style={
                          groupIndex > 0 && rowIndex === 0
                            ? { borderTop: '2px solid var(--border-subtle)' }
                            : undefined
                        }
                      >
                        <td>{rowIndex === 0 && <b>{nameOf(w.houseId)}</b>}</td>
                        <td>
                          {fmtDate(w.startDate)} to {fmtDate(w.endDate)}
                        </td>
                        <td>
                          <span className="row gap-2 center">
                            <span className="t-mono">
                              {w.shiftStart ?? season.shiftStartBound} to{' '}
                              {w.shiftEnd ?? season.shiftEndBound}
                            </span>
                            {w.days === 'weekdays' && <Tag kind="gray">Mon to Fri</Tag>}
                            {w.days === 'weekends' && <Tag kind="gray">Sat, Sun</Tag>}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <Tag kind={w.headcount >= 2 ? 'blue' : 'gray'}>
                            {w.headcount} {w.headcount === 1 ? 'worker' : 'workers'}
                          </Tag>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <Button
                            kind="ghost"
                            size="sm"
                            icon="trash"
                            disabled={busy}
                            onClick={() =>
                              run(() =>
                                deleteRow({
                                  table: 'season_house_windows',
                                  windowId: w.windowId,
                                  seasonId: season.seasonId,
                                }),
                              )
                            }
                          >
                            Remove
                          </Button>
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className="divider" />

          <div className="row gap-3 wrap" style={{ alignItems: 'flex-end' }}>
            <div style={{ minWidth: 150 }}>
              <Field label="House">
                <Select
                  value={hw.houseId}
                  onChange={(e) => setHw({ ...hw, houseId: e.target.value })}
                >
                  {houses.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div style={{ minWidth: 140 }}>
              <Field label="From">
                <TextInput
                  type="date"
                  value={hw.startDate}
                  onChange={(e) => setHw({ ...hw, startDate: e.target.value })}
                />
              </Field>
            </div>
            <div style={{ minWidth: 140 }}>
              <Field label="To">
                <TextInput
                  type="date"
                  value={hw.endDate}
                  onChange={(e) => setHw({ ...hw, endDate: e.target.value })}
                />
              </Field>
            </div>
            <div style={{ width: 88 }}>
              <Field label="Workers">
                <TextInput
                  type="number"
                  min={1}
                  value={String(hw.headcount)}
                  onChange={(e) => setHw({ ...hw, headcount: Number(e.target.value) })}
                />
              </Field>
            </div>
            <div style={{ minWidth: 120 }}>
              <Field label={`Opens (${season.shiftStartBound})`}>
                <TextInput
                  type="time"
                  value={hw.shiftStart}
                  onChange={(e) => setHw({ ...hw, shiftStart: e.target.value })}
                />
              </Field>
            </div>
            <div style={{ minWidth: 120 }}>
              <Field label={`Closes (${season.shiftEndBound})`}>
                <TextInput
                  type="time"
                  value={hw.shiftEnd}
                  onChange={(e) => setHw({ ...hw, shiftEnd: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Days">
              <div className="seg" role="group">
                {(['all', 'weekdays', 'weekends'] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`seg-btn${hw.days === d ? ' is-on' : ''}`}
                    onClick={() => setHw({ ...hw, days: d })}
                  >
                    {d === 'all' ? 'Every day' : d === 'weekdays' ? 'Mon to Fri' : 'Weekends'}
                  </button>
                ))}
              </div>
            </Field>
            <Button
              icon="add"
              disabled={busy}
              onClick={() =>
                run(() =>
                  saveHouseWindow({
                    seasonId: season.seasonId,
                    houseId: hw.houseId,
                    startDate: hw.startDate,
                    endDate: hw.endDate,
                    headcount: hw.headcount,
                    shiftStart: hw.shiftStart || null,
                    shiftEnd: hw.shiftEnd || null,
                    days: hw.days,
                  }),
                )
              }
            >
              Add window
            </Button>
          </div>
          <p className="t-helper">
            Leave hours blank to use the season default. A house set to Mon to Fri has no weekend
            shifts. Example: Kings Court open 05:30 to 17:00, Mon to Fri.
          </p>
        </div>
      </Card>

      {/* Floating */}
      <Card pad>
        <div className="col gap-4">
          <div className="col gap-1">
            <h2 className="t-h2">Floating</h2>
            <p className="t-helper">
              During a float window, any multi-staffed house can float a worker to any other open
              house. Harnwell can send floats but never receives them. Outside these windows,
              floating is off.
            </p>
          </div>

          {detail.floatWindows.length === 0 ? (
            <p className="t-meta">Floating is off for the whole season.</p>
          ) : (
            <div className="dtable-wrap">
              <table className="dtable" data-testid="float-windows">
                <thead>
                  <tr>
                    <th>Floating on</th>
                    <th aria-label="actions" />
                  </tr>
                </thead>
                <tbody>
                  {detail.floatWindows.map((w) => (
                    <tr key={w.windowId}>
                      <td>
                        {fmtDate(w.startDate)} to {fmtDate(w.endDate)}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <Button
                          kind="ghost"
                          size="sm"
                          icon="trash"
                          disabled={busy}
                          onClick={() =>
                            run(() =>
                              deleteRow({
                                table: 'season_float_windows',
                                windowId: w.windowId,
                                seasonId: season.seasonId,
                              }),
                            )
                          }
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="divider" />

          <div className="row gap-3 wrap" style={{ alignItems: 'flex-end' }}>
            <div style={{ minWidth: 140 }}>
              <Field label="From">
                <TextInput
                  type="date"
                  value={fw.startDate}
                  onChange={(e) => setFw({ ...fw, startDate: e.target.value })}
                />
              </Field>
            </div>
            <div style={{ minWidth: 140 }}>
              <Field label="To">
                <TextInput
                  type="date"
                  value={fw.endDate}
                  onChange={(e) => setFw({ ...fw, endDate: e.target.value })}
                />
              </Field>
            </div>
            <Button
              icon="add"
              disabled={busy}
              onClick={() => run(() => saveFloatWindow({ seasonId: season.seasonId, ...fw }))}
            >
              Enable floating
            </Button>
          </div>
        </div>
      </Card>

      {/* Preview & apply */}
      <Card pad>
        <div className="col gap-4">
          <div className="col gap-1">
            <h2 className="t-h2">Preview and apply</h2>
            <p className="t-helper">
              Preview shows exactly what applying would change, without writing anything. Applying
              takes effect from tomorrow onward; shifts already in progress are never touched.
            </p>
          </div>

          <div className="row gap-2">
            <Button kind="secondary" icon="arrowRight" disabled={busy} onClick={doPreview}>
              {busy && preview === null ? 'Checking.' : 'Preview changes'}
            </Button>
          </div>

          {preview !== null && (
            <div className="col gap-4">
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                  gap: 12,
                }}
                data-testid="impact-tiles"
              >
                {IMPACT_TILES.map((t) => {
                  const n = preview[t.key] as number;
                  return (
                    <div
                      key={t.key}
                      className="card card-pad col gap-1"
                      style={{ opacity: n === 0 ? 0.55 : 1 }}
                    >
                      <span
                        className="t-display"
                        style={{
                          fontSize: 24,
                          color: t.danger && n > 0 ? 'var(--st-danger)' : undefined,
                        }}
                      >
                        {n}
                      </span>
                      <span className="t-meta">{t.label}</span>
                    </div>
                  );
                })}
              </div>

              {/* Who's affected: the consequential changes itemized by house (capped),
                  so it stays skimmable even when thousands of shifts are created. */}
              {preview.affected_workers.length > 0 &&
                (() => {
                  const total = preview.assignments_cancelled + preview.floats_voided;
                  const byHouse = new Map<string, typeof preview.affected_workers>();
                  for (const a of preview.affected_workers) {
                    byHouse.set(a.house, [...(byHouse.get(a.house) ?? []), a]);
                  }
                  const shown = preview.affected_workers.length;
                  return (
                    <div className="col gap-2" data-testid="affected-workers">
                      <span className="t-label">Who is affected ({total})</span>
                      <div className="col gap-2">
                        {[...byHouse.entries()].map(([house, items]) => (
                          <div
                            key={house}
                            className="row gap-3 wrap"
                            style={{ alignItems: 'baseline' }}
                          >
                            <span style={{ minWidth: 150, fontWeight: 600 }}>
                              {house} <span className="t-meta">({items.length})</span>
                            </span>
                            <span className="t-meta" style={{ flex: 1 }}>
                              {items
                                .map(
                                  (i) =>
                                    `${i.worker} (${i.kind === 'float' ? 'float' : 'shift'}, ${i.when})`,
                                )
                                .join(',  ')}
                            </span>
                          </div>
                        ))}
                      </div>
                      {total > shown && (
                        <span className="t-meta">
                          plus {total - shown} more not listed (totals above are exact).
                        </span>
                      )}
                    </div>
                  );
                })()}

              {preview.dry_run ? (
                <div className="col gap-3">
                  {willVoid && (
                    <Notification kind="warning" title="This will remove workers from shifts">
                      <label className="row gap-2 center" style={{ marginTop: 4 }}>
                        <input
                          type="checkbox"
                          checked={confirmApply}
                          onChange={(e) => setConfirmApply(e.target.checked)}
                          data-testid="confirm-apply"
                        />
                        <span>
                          I understand {preview.assignments_cancelled} assignment(s) and{' '}
                          {preview.floats_voided} float(s) will be cancelled, and those workers
                          notified.
                        </span>
                      </label>
                    </Notification>
                  )}
                  <div className="row">
                    <Button
                      icon="check"
                      disabled={busy || (willVoid && !confirmApply)}
                      onClick={doApply}
                      data-testid="apply-button"
                    >
                      {busy ? 'Applying.' : 'Apply changes'}
                    </Button>
                  </div>
                </div>
              ) : (
                <Notification kind="success" title="Applied">
                  The configuration is live. Managers and workers now see it.
                </Notification>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* Audit log */}
      <Card pad>
        <div className="col gap-3">
          <h2 className="t-h2">History</h2>
          {audit.length === 0 ? (
            <p className="t-meta">No changes applied yet.</p>
          ) : (
            <div className="col gap-2" data-testid="audit-log">
              {audit.map((a) => {
                const changes = Object.entries(a.impact)
                  .filter(([, v]) => v > 0)
                  .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
                  .join(', ');
                return (
                  <div key={a.auditId} className="row between gap-3">
                    <span className="row gap-2 center">
                      <Icon name={a.action === 'apply' ? 'check' : 'arrowRight'} size={14} />
                      <span>
                        <b>{a.action === 'apply' ? 'Applied' : 'Previewed'}</b> by{' '}
                        {a.appliedByName ?? 'Unknown'}
                      </span>
                    </span>
                    <span className="t-meta">{changes || 'no changes'}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="col gap-1">
      <span className="t-meta">{label}</span>
      <span className="t-body" style={{ fontWeight: 500 }}>
        {value}
      </span>
    </div>
  );
}
