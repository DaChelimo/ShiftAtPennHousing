'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import {
  deleteRow,
  previewOrApplySeason,
  saveFloatWindow,
  saveHouseWindow,
  setSeasonPreferenceDeadline,
  type SeasonImpact,
  type WindowBand,
} from '../../lib/actions/operatingSeasons';
import type { AuditRow, HouseOption, SeasonDetail } from '../../lib/data/operatingSeasons';
import { Button, Card, DateInput, Field, Icon, Notification, Select, TextInput } from '../ui';

const IMPACT_TILES: { key: keyof SeasonImpact; label: string; danger?: boolean }[] = [
  { key: 'blocks_generated', label: 'Shifts created' },
  { key: 'seats_added', label: 'Seats added' },
  { key: 'seats_removed', label: 'Seats removed' },
  { key: 'blocks_voided', label: 'Shifts cancelled', danger: true },
  { key: 'assignments_cancelled', label: 'Workers removed', danger: true },
  { key: 'floats_voided', label: 'Floats cancelled', danger: true },
];

function fmtDate(d: string): string {
  return new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// The NY calendar date (YYYY-MM-DD) of a stored timestamptz, for the date input.
function nyDateValue(iso: string | null): string {
  if (iso === null) return '';
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

type HouseWindowRow = SeasonDetail['houseWindows'][number];

// House display priority: Harnwell, Upper Quad, then Lower Quad are pinned first (they
// carry the special multi-staff rules); every other house falls back to alphabetical by
// name. Used both to order houses within a config group and to order the groups
// themselves (a group takes the priority of its highest-priority member).
const PINNED_HOUSE_ORDER = ['harnwell', 'quad', 'lower-quad'];
function housePriority(houseId: string): number {
  const i = PINNED_HOUSE_ORDER.indexOf(houseId);
  return i === -1 ? PINNED_HOUSE_ORDER.length : i;
}

// A stable, key-order-independent signature of a house's staffing configuration: its
// windows (sorted by start date), each reduced to its date range and both band lists.
// windowId is dropped so two houses with the SAME schedule share a signature. Bands are
// flattened to tuples because jsonb from Postgres carries no guaranteed key order.
function configSignature(windows: HouseWindowRow[]): string {
  const bandSig = (bands: WindowBand[]) =>
    bands.map((b) => [b.block_start, b.block_end, b.headcount]);
  return JSON.stringify(
    [...windows]
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .map((w) => ({
        s: w.startDate,
        e: w.endDate,
        wd: bandSig(w.weekdayBands),
        we: bandSig(w.weekendBands),
      })),
  );
}

type HouseEntry = { houseId: string; windows: HouseWindowRow[] };
type ConfigGroup = { signature: string; houses: HouseEntry[] };

// Cluster houses whose full configuration (weekday + weekend bands, headcount, dates) is
// identical into one group. Houses within a group and the groups themselves are ordered
// by housePriority (a group sorts by its lead house). Houses that differ in any way land
// in their own group.
function buildConfigGroups(
  windows: HouseWindowRow[],
  nameOf: (id: string) => string,
): ConfigGroup[] {
  const byHouse = new Map<string, HouseWindowRow[]>();
  for (const w of windows) {
    byHouse.set(w.houseId, [...(byHouse.get(w.houseId) ?? []), w]);
  }
  const houseCompare = (a: string, b: string) =>
    housePriority(a) - housePriority(b) || nameOf(a).localeCompare(nameOf(b));

  const byConfig = new Map<string, HouseEntry[]>();
  for (const [houseId, ws] of byHouse) {
    const sig = configSignature(ws);
    const entry: HouseEntry = {
      houseId,
      windows: [...ws].sort((a, b) => a.startDate.localeCompare(b.startDate)),
    };
    byConfig.set(sig, [...(byConfig.get(sig) ?? []), entry]);
  }

  const groups: ConfigGroup[] = [...byConfig.entries()].map(([signature, houses]) => ({
    signature,
    houses: [...houses].sort((a, b) => houseCompare(a.houseId, b.houseId)),
  }));
  groups.sort((a, b) => houseCompare(a.houses[0]!.houseId, b.houses[0]!.houseId));
  return groups;
}

// Shared fixed column widths so the standalone header and every group table line up.
function HouseCols() {
  return (
    <colgroup>
      <col style={{ width: '16%' }} />
      <col style={{ width: '18%' }} />
      <col style={{ width: '23%' }} />
      <col style={{ width: '23%' }} />
      <col style={{ width: '20%' }} />
    </colgroup>
  );
}

type WindowDraft = {
  windowId?: string;
  houseId: string;
  startDate: string;
  endDate: string;
  weekdayBands: WindowBand[];
  weekendBands: WindowBand[];
};

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
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<SeasonImpact | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  // Session-scoped "you have draft edits that are not on the live schedule yet".
  const [dirty, setDirty] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  const publishRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLTableRowElement>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Which just-saved row to scroll to + briefly highlight, keyed by house|startDate
  // (stable across the refresh, for both add and edit).
  const [flashKey, setFlashKey] = useState<string | null>(null);

  const defaultBand = (): WindowBand => ({
    block_start: season.shiftStartBound,
    block_end: season.shiftEndBound,
    headcount: 1,
  });
  const newDraft = (): WindowDraft => ({
    houseId: houses[0]?.id ?? '',
    startDate: season.startDate,
    endDate: season.endDate,
    weekdayBands: [defaultBand()],
    weekendBands: [defaultBand()],
  });

  const [draft, setDraft] = useState<WindowDraft>(newDraft());
  const [fw, setFw] = useState({ startDate: season.startDate, endDate: season.endDate });
  const [deadline, setDeadline] = useState(nyDateValue(detail.preferenceDeadline));

  const editing = draft.windowId !== undefined;

  function showNotice(text: string) {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 5000);
  }

  // Scroll to + highlight the just-saved row once the refreshed table has painted.
  useEffect(() => {
    if (flashKey === null) return;
    const toScroll = setTimeout(() => {
      flashRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 140);
    const toClear = setTimeout(() => setFlashKey(null), 3200);
    return () => {
      clearTimeout(toScroll);
      clearTimeout(toClear);
    };
  }, [flashKey]);

  async function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    opts?: { successMsg?: string; dirty?: boolean },
  ) {
    setBusy(true);
    setError(null);
    setPreview(null);
    const result = await fn();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? 'Action failed.');
      return;
    }
    if (opts?.dirty) setDirty(true);
    if (opts?.successMsg !== undefined) showNotice(opts.successMsg);
    router.refresh();
  }

  function editWindow(w: SeasonDetail['houseWindows'][number]) {
    setError(null);
    setDraft({
      windowId: w.windowId,
      houseId: w.houseId,
      startDate: w.startDate,
      endDate: w.endDate,
      weekdayBands: w.weekdayBands.map((b) => ({ ...b })),
      weekendBands: w.weekendBands.map((b) => ({ ...b })),
    });
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function saveWindow() {
    setBusy(true);
    setError(null);
    setPreview(null);
    const wasEditing = editing;
    const savedName = nameOf(draft.houseId);
    const savedKey = `${draft.houseId}|${draft.startDate}`;
    const result = await saveHouseWindow({
      seasonId: season.seasonId,
      windowId: draft.windowId,
      houseId: draft.houseId,
      startDate: draft.startDate,
      endDate: draft.endDate,
      weekdayBands: draft.weekdayBands,
      weekendBands: draft.weekendBands,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? 'Could not save the window.');
      return;
    }
    setDirty(true);
    showNotice(`${savedName} window ${wasEditing ? 'updated' : 'added'}. Publish below to make it live.`);
    setFlashKey(savedKey);
    setDraft(newDraft());
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
    setDirty(false);
    showNotice('Published. The live schedule now matches your draft.');
    router.refresh();
  }

  const willVoid =
    preview !== null && (preview.assignments_cancelled > 0 || preview.floats_voided > 0);
  const applied = preview !== null && !preview.dry_run;

  return (
    <div className="col gap-5 season-editor">
      {error !== null && (
        <Notification kind="error" title="Something went wrong" onClose={() => setError(null)}>
          {error}
        </Notification>
      )}
      {notice !== null && (
        <Notification kind="success" title="Saved" onClose={() => setNotice(null)}>
          {notice}
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
                  run(
                    () =>
                      setSeasonPreferenceDeadline({
                        seasonId: season.seasonId,
                        deadlineDate: deadline,
                      }),
                    { successMsg: 'Preference deadline saved.' },
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
              Each window opens a house for a date range at a staffing level. Split the day into
              bands for different headcounts (single-staffed morning, double-staffed evening), and
              set weekdays and weekends independently. A date with no window means the house is
              closed. Edits here save to the draft right away. They go live only when you publish.
            </p>
          </div>

          {detail.houseWindows.length === 0 ? (
            <p className="t-meta">No houses open yet. Add a window below.</p>
          ) : (
            <>
              <div className="col gap-3" data-testid="house-windows">
                {/* Shared column header; each config group renders its own body below so
                    houses with an identical schedule sit inside one blue-outlined box. */}
                <table className="dtable dtable-fixed hcg-head">
                  <HouseCols />
                  <thead>
                    <tr>
                      <th>House</th>
                      <th>Open</th>
                      <th>Weekdays</th>
                      <th>Weekends</th>
                      <th aria-label="actions" />
                    </tr>
                  </thead>
                </table>

                {buildConfigGroups(detail.houseWindows, nameOf).map((group) => (
                  <div
                    className="house-config-group"
                    data-testid="house-config-group"
                    key={group.signature}
                  >
                    <table className="dtable dtable-fixed">
                      <HouseCols />
                      <tbody>
                        {group.houses.map((h) =>
                          h.windows.map((w, rowIndex) => {
                            const key = `${w.houseId}|${w.startDate}`;
                            const isFlash = key === flashKey;
                            return (
                              <tr
                                key={w.windowId}
                                ref={isFlash ? flashRef : undefined}
                                className={isFlash ? 'season-flash' : undefined}
                              >
                                <td>{rowIndex === 0 && <b>{nameOf(h.houseId)}</b>}</td>
                                <td style={{ whiteSpace: 'nowrap' }}>
                                  {fmtDate(w.startDate)} to {fmtDate(w.endDate)}
                                </td>
                                <td>
                                  <BandCell bands={w.weekdayBands} />
                                </td>
                                <td>
                                  <BandCell bands={w.weekendBands} />
                                </td>
                                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                                  <Button
                                    kind="ghost"
                                    size="sm"
                                    icon="edit"
                                    disabled={busy}
                                    onClick={() => editWindow(w)}
                                  >
                                    Edit
                                  </Button>
                                  <Button
                                    kind="ghost"
                                    size="sm"
                                    icon="trash"
                                    disabled={busy}
                                    onClick={() =>
                                      run(
                                        () =>
                                          deleteRow({
                                            table: 'season_house_windows',
                                            windowId: w.windowId,
                                            seasonId: season.seasonId,
                                          }),
                                        {
                                          successMsg: `${nameOf(w.houseId)} window removed. Publish below to make it live.`,
                                          dirty: true,
                                        },
                                      )
                                    }
                                  >
                                    Remove
                                  </Button>
                                </td>
                              </tr>
                            );
                          }),
                        )}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
              <p className="t-helper" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                Each pill is a staffing band: the desk hours, then a
                <span className="season-staffbadge">
                  <Icon name="user" size={15} />
                  <span className="season-staffbadge-n">2</span>
                </span>
                badge for how many workers staff the desk during those hours.
              </p>
            </>
          )}

          <div className="divider" />

          {/* Add / edit a window */}
          <div ref={formRef} className="col gap-4" data-testid="window-form">
            <div className="row between center wrap gap-2">
              <h3 className="t-label">
                {editing ? `Edit ${nameOf(draft.houseId)} window` : 'Add a house window'}
              </h3>
              {editing && (
                <Button
                  kind="ghost"
                  size="sm"
                  icon="close"
                  disabled={busy}
                  onClick={() => setDraft(newDraft())}
                >
                  Cancel edit
                </Button>
              )}
            </div>

            <div className="row gap-3 wrap" style={{ alignItems: 'flex-end' }}>
              <div style={{ minWidth: 170 }}>
                <Field label="House">
                  <Select
                    value={draft.houseId}
                    disabled={editing}
                    onChange={(e) => setDraft({ ...draft, houseId: e.target.value })}
                  >
                    {houses.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div style={{ minWidth: 150 }}>
                <Field label="From">
                  <TextInput
                    type="date"
                    value={draft.startDate}
                    onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
                  />
                </Field>
              </div>
              <div style={{ minWidth: 150 }}>
                <Field label="To">
                  <TextInput
                    type="date"
                    value={draft.endDate}
                    onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
                  />
                </Field>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                gap: 16,
              }}
            >
              <BandColumn
                label="Weekdays (Mon to Fri)"
                bands={draft.weekdayBands}
                fallback={defaultBand()}
                disabled={busy}
                onChange={(weekdayBands) => setDraft({ ...draft, weekdayBands })}
                copyLabel="Copy to weekends"
                onCopy={() =>
                  setDraft({ ...draft, weekendBands: draft.weekdayBands.map((b) => ({ ...b })) })
                }
              />
              <BandColumn
                label="Weekends (Sat, Sun)"
                bands={draft.weekendBands}
                fallback={defaultBand()}
                disabled={busy}
                onChange={(weekendBands) => setDraft({ ...draft, weekendBands })}
                copyLabel="Copy to weekdays"
                onCopy={() =>
                  setDraft({ ...draft, weekdayBands: draft.weekendBands.map((b) => ({ ...b })) })
                }
              />
            </div>

            <div className="row gap-2 center">
              <Button
                icon={editing ? 'check' : 'add'}
                disabled={busy}
                onClick={saveWindow}
                data-testid="window-save"
              >
                {editing ? 'Save changes' : 'Add window'}
              </Button>
              <span className="t-meta">Saved to the draft instantly. Publish below to go live.</span>
            </div>
            <p className="t-helper">
              An empty side means the house is closed those days (weekdays-only desk = no weekend
              bands). Bands must land on 30-minute boundaries and not overlap. Use 00:00 as an end
              time for midnight.
            </p>
          </div>
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
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {fmtDate(w.startDate)} to {fmtDate(w.endDate)}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <Button
                          kind="ghost"
                          size="sm"
                          icon="trash"
                          disabled={busy}
                          onClick={() =>
                            run(
                              () =>
                                deleteRow({
                                  table: 'season_float_windows',
                                  windowId: w.windowId,
                                  seasonId: season.seasonId,
                                }),
                              { successMsg: 'Float window removed. Publish below to make it live.', dirty: true },
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
              onClick={() =>
                run(() => saveFloatWindow({ seasonId: season.seasonId, ...fw }), {
                  successMsg: `Floating enabled ${fmtDate(fw.startDate)} to ${fmtDate(fw.endDate)}. Publish below to make it live.`,
                  dirty: true,
                })
              }
            >
              Enable floating
            </Button>
          </div>
        </div>
      </Card>

      {/* Publish */}
      <Card pad className="season-publish">
        <div ref={publishRef} className="col gap-4">
          <div className="row between center wrap gap-2">
            <h2 className="t-h2">Publish to the live schedule</h2>
            <span className={`season-status ${dirty ? 'is-dirty' : 'is-clean'}`}>
              <Icon name={dirty ? 'warn' : 'checkCircle'} size={14} />
              {dirty ? 'Draft has unpublished changes' : 'Nothing to publish right now'}
            </span>
          </div>

          <Notification kind="info" title="How this works: draft, then publish">
            Everything above (houses, floating) is saved to a draft as you edit it. The draft does
            not affect anyone yet. Publishing rewrites the live schedule for this season to match
            your draft. Preview first to see the exact impact.
          </Notification>

          <div className="season-steps">
            {/* Step 1 */}
            <div className="season-step">
              <span className="season-stepnum">1</span>
              <div className="col gap-2" style={{ flex: 1 }}>
                <div className="col gap-1">
                  <span className="t-label">Preview the impact</span>
                  <span className="t-helper">
                    A dry run. Nothing changes for workers. Shows exactly what publishing would
                    create, cancel, or move.
                  </span>
                </div>
                <div className="row">
                  <Button kind="secondary" icon="arrowRight" disabled={busy} onClick={doPreview}>
                    {busy && preview === null ? 'Checking...' : 'Preview impact'}
                  </Button>
                </div>

                {preview !== null && (
                  <div className="col gap-4" style={{ marginTop: 4 }}>
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
                  </div>
                )}
              </div>
            </div>

            {/* Step 2 */}
            <div className="season-step">
              <span className="season-stepnum">2</span>
              <div className="col gap-2" style={{ flex: 1 }}>
                <div className="col gap-1">
                  <span className="t-label">Publish</span>
                  <span className="t-helper">
                    Makes it live. Updates every upcoming shift in the season (anything that has not
                    started yet). Shifts already in progress and past shifts are never changed.
                  </span>
                </div>

                {applied ? (
                  <Notification kind="success" title="Published">
                    The configuration is live. Managers and workers now see it.
                  </Notification>
                ) : (
                  <div className="col gap-3">
                    {preview === null && (
                      <span className="t-meta">Run Preview first to enable publishing.</span>
                    )}
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
                            I understand {preview?.assignments_cancelled ?? 0} assignment(s) and{' '}
                            {preview?.floats_voided ?? 0} float(s) will be cancelled, and those
                            workers notified.
                          </span>
                        </label>
                      </Notification>
                    )}
                    <div className="row">
                      <Button
                        kind="primary"
                        icon="checkCircle"
                        disabled={busy || preview === null || (willVoid && !confirmApply)}
                        onClick={doApply}
                        data-testid="apply-button"
                      >
                        {busy && preview !== null ? 'Publishing...' : 'Publish to schedule'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
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
                        <b>{a.action === 'apply' ? 'Published' : 'Previewed'}</b> by{' '}
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

      {/* Persistent publish prompt — so the commit action is never lost at the bottom. */}
      {dirty && !applied && (
        <div className="season-stickybar" data-testid="season-stickybar">
          <span className="row gap-2 center">
            <Icon name="warn" size={16} />
            <span>You have unpublished draft changes.</span>
          </span>
          <Button
            kind="primary"
            size="sm"
            icon="arrowRight"
            onClick={() => publishRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          >
            Review and publish
          </Button>
        </div>
      )}
    </div>
  );
}

// Read-only band list for a table cell. Each pill shows the desk hours, then a
// solid staff-count badge (single-person icon + number) for the headcount on that
// band. The badge is a distinct sub-capsule (not just an icon inline with text) so
// the count reads at a glance and never wraps under the hours.
function BandCell({ bands }: { bands: WindowBand[] }) {
  if (bands.length === 0) return <span className="t-meta">Closed</span>;
  return (
    <span className="row gap-1 wrap">
      {bands.map((b, i) => (
        <span
          key={i}
          className={`season-band ${b.headcount >= 2 ? 'season-band-blue' : 'season-band-gray'}`}
          title={`${b.headcount} ${b.headcount === 1 ? 'worker' : 'workers'} on the desk, ${b.block_start} to ${b.block_end}`}
        >
          <span className="season-band-hours">
            {b.block_start}-{b.block_end}
          </span>
          <span className="season-staffbadge">
            <Icon name="user" size={11} />
            <span className="season-staffbadge-n">{b.headcount}</span>
          </span>
        </span>
      ))}
    </span>
  );
}

// Editable band list for one day type (weekdays or weekends). An empty list is the
// closed state; the "Open" button seeds a first band from `fallback`.
function BandColumn({
  label,
  bands,
  fallback,
  disabled,
  onChange,
  copyLabel,
  onCopy,
}: {
  label: string;
  bands: WindowBand[];
  fallback: WindowBand;
  disabled: boolean;
  onChange: (bands: WindowBand[]) => void;
  copyLabel: string;
  onCopy: () => void;
}) {
  const update = (i: number, patch: Partial<WindowBand>) =>
    onChange(bands.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const remove = (i: number) => onChange(bands.filter((_, j) => j !== i));
  const add = () => {
    const last = bands[bands.length - 1];
    onChange([
      ...bands,
      { block_start: last ? last.block_end : fallback.block_start, block_end: fallback.block_end, headcount: 1 },
    ]);
  };

  return (
    <div className="card card-pad col gap-3">
      <div className="row between center">
        <span className="t-label">{label}</span>
        {bands.length > 0 && (
          <Button kind="ghost" size="sm" icon="copy" disabled={disabled} onClick={onCopy}>
            {copyLabel}
          </Button>
        )}
      </div>

      {bands.length === 0 ? (
        <span className="t-meta">Closed</span>
      ) : (
        <div className="col gap-2">
          {bands.map((b, i) => (
            <div key={i} className="row gap-2 center wrap">
              <TextInput
                type="time"
                value={b.block_start}
                disabled={disabled}
                onChange={(e) => update(i, { block_start: e.target.value })}
                aria-label="Band start"
                style={{ width: 118 }}
              />
              <span className="t-meta">to</span>
              <TextInput
                type="time"
                value={b.block_end}
                disabled={disabled}
                onChange={(e) => update(i, { block_end: e.target.value })}
                aria-label="Band end"
                style={{ width: 118 }}
              />
              <TextInput
                type="number"
                min={1}
                value={String(b.headcount)}
                disabled={disabled}
                onChange={(e) => update(i, { headcount: Number(e.target.value) })}
                aria-label="Workers"
                style={{ width: 72 }}
              />
              <span className="t-meta">{b.headcount === 1 ? 'worker' : 'workers'}</span>
              <Button
                kind="ghost"
                size="sm"
                icon="trash"
                disabled={disabled}
                onClick={() => remove(i)}
                aria-label="Remove band"
              />
            </div>
          ))}
        </div>
      )}

      <div className="row">
        <Button kind="ghost" size="sm" icon="add" disabled={disabled} onClick={add}>
          {bands.length === 0 ? 'Open these days' : 'Add band'}
        </Button>
      </div>
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
