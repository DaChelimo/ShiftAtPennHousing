'use client';

import type { BreakHouseConfig, DayConfig } from '@shift/core';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { previewOrApplyBreak, removeBreak, type BreakImpact } from '../../lib/actions/breaks';
import type { BreakAuthoringData, BreakType, ExistingBreak } from '../../lib/data/breaks';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Field, DateInput, Select, TextInput } from '../ui/Field';
import { Notification } from '../ui/Notification';
import { PageHead } from '../ui/PageHead';
import { Tag } from '../ui/Tag';
import { Toggle } from '../ui/Toggle';

const BREAK_TYPES: { value: BreakType; label: string }[] = [
  { value: 'thanksgiving', label: 'Thanksgiving' },
  { value: 'fall_break', label: 'Fall break' },
  { value: 'spring_break', label: 'Spring break' },
  { value: 'spring_fling', label: 'Spring Fling' },
  { value: 'winter_break', label: 'Winter break' },
  { value: 'other', label: 'Other (custom)' },
];
const TYPE_LABEL = new Map(BREAK_TYPES.map((t) => [t.value, t.label]));

const OPEN_DAY: DayConfig = { open: true, start: '08:00', end: '00:00' };

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s === '' ? 'break' : s;
}

function phaseChip(phase: string): { label: string; kind: 'green' | 'blue' | 'gray' } {
  if (phase === 'claim_window') return { label: 'Claim window open', kind: 'green' };
  if (phase === 'pre_open') return { label: 'Upcoming', kind: 'blue' };
  return { label: 'Open feed', kind: 'gray' };
}

const dayEq = (a: DayConfig, b: DayConfig) =>
  a.open === b.open && a.start === b.start && a.end === b.end;

// A blank custom canvas for "Other": every house open, 1 staff, 8am to midnight.
function canvasConfig(houseIds: string[]): Record<string, BreakHouseConfig> {
  const out: Record<string, BreakHouseConfig> = {};
  for (const id of houseIds) {
    out[id] = { houseId: id, headcount: 1, weekday: { ...OPEN_DAY }, weekend: { ...OPEN_DAY } };
  }
  return out;
}

function toRecord(list: BreakHouseConfig[]): Record<string, BreakHouseConfig> {
  const out: Record<string, BreakHouseConfig> = {};
  for (const h of list)
    out[h.houseId] = { ...h, weekday: { ...h.weekday }, weekend: { ...h.weekend } };
  return out;
}

// Houses whose weekend genuinely differs from their weekday get an expanded weekend
// editor; everything else shows the compact "same as weekdays" state.
function differingWeekends(cfg: Record<string, BreakHouseConfig>, ids: string[]): Set<string> {
  return new Set(
    ids.filter((id) => cfg[id] !== undefined && !dayEq(cfg[id]!.weekday, cfg[id]!.weekend)),
  );
}

type Template = {
  headcount: number;
  weekday: { start: string; end: string };
  weekendDiffers: boolean;
  weekend: { start: string; end: string };
};

export function BreakAuthoring({ data }: { data: BreakAuthoringData }) {
  const router = useRouter();
  const houseIds = useMemo(() => data.houses.map((h) => h.houseId), [data.houses]);
  const houseName = useMemo(
    () => new Map(data.houses.map((h) => [h.houseId, h.houseName])),
    [data.houses],
  );

  const newId = () => (typeof crypto !== 'undefined' ? crypto.randomUUID() : `${Date.now()}`);

  // The shipped default (house config + floating) for a break type. Thanksgiving /
  // fall / spring / spring fling all use the `short` template; winter break uses
  // `winter` (Harnwell only, float off); "other" is a blank all-open canvas.
  const templateForType = (
    t: BreakType,
  ): { config: Record<string, BreakHouseConfig>; floatEnabled: boolean } => {
    if (t === 'other') return { config: canvasConfig(houseIds), floatEnabled: true };
    const src = t === 'winter_break' ? data.typeDefaults.winter : data.typeDefaults.short;
    return { config: toRecord(src.houses), floatEnabled: src.floatEnabled };
  };
  const initialType: BreakType = 'thanksgiving';
  // Initial template derived once from the server-provided type defaults.
  const initial = useMemo(() => templateForType(initialType), [data.typeDefaults]);

  const [breakId, setBreakId] = useState<string>(newId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<BreakType>(initialType);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [floatEnabled, setFloatEnabled] = useState(initial.floatEnabled);
  const [config, setConfig] = useState<Record<string, BreakHouseConfig>>(initial.config);
  const [weekendCustom, setWeekendCustom] = useState<Set<string>>(() =>
    differingWeekends(initial.config, houseIds),
  );
  const [template, setTemplate] = useState<Template>({
    headcount: 1,
    weekday: { start: '08:00', end: '00:00' },
    weekendDiffers: false,
    weekend: { start: '08:00', end: '00:00' },
  });

  const [preview, setPreview] = useState<BreakImpact | null>(null);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null);

  // Any config/meta change invalidates a prior preview (so Apply matches Preview).
  function touched() {
    setPreview(null);
    setConfirmVoid(false);
    setResult(null);
  }

  // Load a whole config at once (type change / edit / reset): also recompute which
  // houses have a differing weekend so the weekend editor opens where needed.
  function applyConfig(cfg: Record<string, BreakHouseConfig>) {
    setConfig(cfg);
    setWeekendCustom(differingWeekends(cfg, houseIds));
    touched();
  }

  function resetForm() {
    setBreakId(newId());
    setEditingId(null);
    setName('');
    setStartDate('');
    setEndDate('');
    onTypeChange(initialType);
  }

  // Changing the break type loads that type's shipped house coverage AND its floating
  // default (winter break => Harnwell only, float off; the rest => all open, float on).
  function onTypeChange(next: BreakType) {
    setType(next);
    const t = templateForType(next);
    setFloatEnabled(t.floatEnabled);
    applyConfig(t.config);
  }

  function loadForEdit(b: ExistingBreak) {
    setBreakId(b.breakId);
    setEditingId(b.breakId);
    setName(b.breakName);
    setType(b.breakType);
    setStartDate(b.startDate);
    setEndDate(b.endDate);
    setFloatEnabled(b.floatEnabled);
    applyConfig(toRecord(b.houses));
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setHeadcount(houseId: string, n: number) {
    setConfig((c) => ({
      ...c,
      [houseId]: { ...c[houseId]!, headcount: Math.min(9, Math.max(1, n)) },
    }));
    touched();
  }

  // Weekday edits mirror to the weekend UNLESS the house has a customized weekend.
  function setWeekday(houseId: string, patch: Partial<DayConfig>) {
    setConfig((c) => {
      const h = c[houseId]!;
      const weekday = { ...h.weekday, ...patch };
      const weekend = weekendCustom.has(houseId) ? h.weekend : { ...weekday };
      return { ...c, [houseId]: { ...h, weekday, weekend } };
    });
    touched();
  }
  function setWeekend(houseId: string, patch: Partial<DayConfig>) {
    setConfig((c) => ({
      ...c,
      [houseId]: { ...c[houseId]!, weekend: { ...c[houseId]!.weekend, ...patch } },
    }));
    touched();
  }
  function customizeWeekend(houseId: string) {
    setWeekendCustom((s) => new Set(s).add(houseId));
    touched();
  }
  function matchWeekend(houseId: string) {
    setWeekendCustom((s) => {
      const n = new Set(s);
      n.delete(houseId);
      return n;
    });
    setConfig((c) => ({
      ...c,
      [houseId]: { ...c[houseId]!, weekend: { ...c[houseId]!.weekday } },
    }));
    touched();
  }

  // Quick set: push the template onto every house in one move.
  function applyTemplateToAll() {
    const wd: DayConfig = { open: true, start: template.weekday.start, end: template.weekday.end };
    const we: DayConfig = template.weekendDiffers
      ? { open: true, start: template.weekend.start, end: template.weekend.end }
      : { ...wd };
    setConfig(() => {
      const next: Record<string, BreakHouseConfig> = {};
      for (const id of houseIds) {
        next[id] = {
          houseId: id,
          headcount: template.headcount,
          weekday: { ...wd },
          weekend: { ...we },
        };
      }
      return next;
    });
    setWeekendCustom(template.weekendDiffers ? new Set(houseIds) : new Set());
    touched();
  }
  function closeAll() {
    setConfig((c) => {
      const next = { ...c };
      for (const id of houseIds) {
        next[id] = {
          ...next[id]!,
          weekday: { ...next[id]!.weekday, open: false },
          weekend: { ...next[id]!.weekend, open: false },
        };
      }
      return next;
    });
    setWeekendCustom(new Set());
    touched();
  }

  const slug = slugify(name);
  const valid = name.trim() !== '' && startDate !== '' && endDate !== '' && startDate <= endDate;
  const willVoid =
    preview !== null && (preview.assignmentsCancelled > 0 || preview.floatsVoided > 0);
  const canApply = preview !== null && (!willVoid || confirmVoid);
  const openCount = houseIds.filter(
    (id) => config[id]?.weekday.open || config[id]?.weekend.open,
  ).length;

  function buildInput() {
    return {
      breakId,
      breakName: name.trim(),
      breakType: type,
      slug,
      startDate,
      endDate,
      floatEnabled,
      houses: houseIds.map((id) => config[id]!),
    };
  }

  async function onPreview() {
    if (!valid || busy) return;
    setBusy(true);
    setResult(null);
    const res = await previewOrApplyBreak(buildInput(), true);
    setBusy(false);
    if (res.ok) setPreview(res.impact);
    else setResult({ kind: 'error', message: res.error });
  }

  async function onApply() {
    if (!canApply || busy) return;
    setBusy(true);
    setResult(null);
    const res = await previewOrApplyBreak(buildInput(), false);
    setBusy(false);
    if (res.ok) {
      setResult({ kind: 'ok', message: editingId ? 'Break updated.' : 'Break declared.' });
      resetForm();
      router.refresh();
    } else {
      setResult({ kind: 'error', message: res.error });
    }
  }

  async function onRemove(b: ExistingBreak) {
    if (typeof window !== 'undefined') {
      const ok = window.confirm(
        `Remove "${b.breakName}"? Its dates return to the regular school year and any claimed break shifts are released.`,
      );
      if (!ok) return;
    }
    const res = await removeBreak(b.breakId);
    if (res.ok) {
      setResult({ kind: 'ok', message: 'Break removed.' });
      if (editingId === b.breakId) resetForm();
      router.refresh();
    } else {
      setResult({ kind: 'error', message: res.error });
    }
  }

  return (
    <div className="page" data-testid="break-authoring">
      <PageHead
        eyebrow="System"
        title="Break coverage"
        sub="Set each house up for the break, then workers claim its front-desk shifts. Only a project administrator can author breaks."
      />

      <div className="col gap-4">
        {result && (
          <Notification
            kind={result.kind === 'ok' ? 'success' : 'error'}
            title={result.kind === 'ok' ? 'Saved' : 'Could not save'}
            testId="break-result"
          >
            {result.message}
          </Notification>
        )}

        {/* Step 1 — break details */}
        <Card pad>
          <StepHead n={1} title={editingId ? 'Edit break' : 'Break details'} />
          <div className="break-meta-grid">
            <Field label="Name">
              <TextInput
                data-testid="break-name"
                value={name}
                placeholder="e.g. Thanksgiving 2026"
                onChange={(e) => {
                  setName(e.target.value);
                  touched();
                }}
              />
            </Field>
            <Field label="Type" helper="Named types load their defaults. Other starts blank.">
              <Select
                data-testid="break-type"
                value={type}
                onChange={(e) => onTypeChange(e.target.value as BreakType)}
              >
                {BREAK_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Start date">
              <DateInput
                data-testid="break-start"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  touched();
                }}
              />
            </Field>
            <Field label="End date">
              <DateInput
                data-testid="break-end"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  touched();
                }}
              />
            </Field>
          </div>
          <label className="pref-optout" data-testid="break-float">
            <Toggle
              checked={floatEnabled}
              onChange={(v) => {
                setFloatEnabled(v);
                touched();
              }}
            />
            Floating on. Any open house with 2+ staff can cover another house (Harnwell never
            receives floats).
          </label>
        </Card>

        {/* Step 2 — house coverage */}
        <Card pad>
          <StepHead
            n={2}
            title="House coverage"
            hint={`${openCount} of ${houseIds.length} houses open`}
          />
          <p className="t-helper" style={{ marginBottom: 12 }}>
            Set a default with Quick set and apply it to every house, then adjust the exceptions.
            Weekends match weekdays unless you customize them.
          </p>

          {/* Quick set template */}
          <div className="break-quickset" data-testid="break-quickset">
            <span className="break-quickset-label">Quick set</span>
            <div className="break-quickset-field">
              <span className="t-meta">Staff</span>
              <Stepper
                value={template.headcount}
                onChange={(n) => setTemplate((t) => ({ ...t, headcount: n }))}
              />
            </div>
            <div className="break-quickset-field">
              <span className="t-meta">Weekday hours</span>
              <TimeRange
                value={template.weekday}
                onChange={(p) => setTemplate((t) => ({ ...t, weekday: { ...t.weekday, ...p } }))}
              />
            </div>
            <label className="break-inline-toggle">
              <Toggle
                size="sm"
                checked={template.weekendDiffers}
                onChange={(v) => setTemplate((t) => ({ ...t, weekendDiffers: v }))}
              />
              Different weekends
            </label>
            {template.weekendDiffers && (
              <div className="break-quickset-field">
                <span className="t-meta">Weekend hours</span>
                <TimeRange
                  value={template.weekend}
                  onChange={(p) => setTemplate((t) => ({ ...t, weekend: { ...t.weekend, ...p } }))}
                />
              </div>
            )}
            <div className="break-quickset-actions">
              <Button kind="secondary" size="sm" onClick={applyTemplateToAll}>
                Apply to all houses
              </Button>
              <Button kind="ghost" size="sm" onClick={closeAll}>
                Close all
              </Button>
            </div>
          </div>

          {/* House list */}
          <div className="break-houses" data-testid="break-house-table">
            <div className="break-houses-head">
              <span>Open</span>
              <span>House</span>
              <span>Staff</span>
              <span>Weekdays</span>
              <span>Weekends</span>
            </div>
            {houseIds.map((id) => {
              const h = config[id];
              if (h === undefined) return null;
              return (
                <HouseRow
                  key={id}
                  id={id}
                  name={houseName.get(id) ?? id}
                  cfg={h}
                  custom={weekendCustom.has(id)}
                  onToggleOpen={(v) => setWeekday(id, { open: v })}
                  onHeadcount={(n) => setHeadcount(id, n)}
                  onWeekday={(p) => setWeekday(id, p)}
                  onWeekend={(p) => setWeekend(id, p)}
                  onCustomize={() => customizeWeekend(id)}
                  onMatch={() => matchWeekend(id)}
                />
              );
            })}
          </div>
        </Card>

        {/* Step 3 — review & apply */}
        <Card pad>
          <StepHead n={3} title="Review and apply" />
          <div className="row gap-2 wrap">
            <Button
              kind="secondary"
              data-testid="break-preview"
              disabled={!valid || busy}
              onClick={onPreview}
            >
              {busy && preview === null ? 'Checking...' : 'Preview changes'}
            </Button>
            <Button
              kind="primary"
              data-testid="break-apply"
              disabled={!canApply || busy}
              onClick={onApply}
            >
              {busy && preview !== null
                ? 'Applying...'
                : editingId
                  ? 'Save break'
                  : 'Declare break'}
            </Button>
            {editingId && (
              <Button kind="tertiary" data-testid="break-cancel" onClick={resetForm}>
                Cancel
              </Button>
            )}
          </div>
          {preview ? (
            <ImpactPanel
              impact={preview}
              willVoid={willVoid}
              confirmVoid={confirmVoid}
              onConfirm={setConfirmVoid}
            />
          ) : (
            <p className="t-helper" style={{ marginTop: 10 }}>
              Preview shows exactly what will change (shifts created, workers affected) before
              anything is saved.
            </p>
          )}
        </Card>

        {/* Declared breaks */}
        <div className="col gap-2">
          <div className="t-h2">Declared breaks</div>
          {data.breaks.length === 0 ? (
            <Notification kind="info" title="No breaks declared" testId="break-empty">
              Configure a break above to open its claim window for workers.
            </Notification>
          ) : (
            <div className="break-list" data-testid="break-list">
              {data.breaks.map((b) => {
                const chip = phaseChip(b.phase);
                const openHouses = b.houses.filter((h) => h.weekday.open || h.weekend.open).length;
                return (
                  <Card key={b.breakId} pad className="break-list-row">
                    <div className="col gap-1">
                      <div className="row gap-2" style={{ alignItems: 'center' }}>
                        <b>{b.breakName}</b>
                        <Tag kind={chip.kind}>{chip.label}</Tag>
                      </div>
                      <span className="t-helper">
                        {TYPE_LABEL.get(b.breakType) ?? b.breakType} · {b.startDate} to {b.endDate}{' '}
                        · {String(openHouses)} houses open ·{' '}
                        {b.floatEnabled ? 'floating on' : 'no floating'}
                      </span>
                    </div>
                    <div className="row gap-2">
                      <Button
                        kind="tertiary"
                        icon="edit"
                        data-testid={`break-edit-${b.breakId}`}
                        onClick={() => loadForEdit(b)}
                      >
                        Edit
                      </Button>
                      <Button
                        kind="danger"
                        icon="trash"
                        data-testid={`break-remove-${b.breakId}`}
                        onClick={() => onRemove(b)}
                      >
                        Remove
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StepHead({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="break-stephead">
      <span className="break-stepnum">{n}</span>
      <span className="t-h2">{title}</span>
      {hint !== undefined && <span className="break-stephint t-meta">{hint}</span>}
    </div>
  );
}

function HouseRow({
  id,
  name,
  cfg,
  custom,
  onToggleOpen,
  onHeadcount,
  onWeekday,
  onWeekend,
  onCustomize,
  onMatch,
}: {
  id: string;
  name: string;
  cfg: BreakHouseConfig;
  custom: boolean;
  onToggleOpen: (v: boolean) => void;
  onHeadcount: (n: number) => void;
  onWeekday: (patch: Partial<DayConfig>) => void;
  onWeekend: (patch: Partial<DayConfig>) => void;
  onCustomize: () => void;
  onMatch: () => void;
}) {
  const wd = cfg.weekday;
  const we = cfg.weekend;
  const houseClosed = !wd.open && !we.open;
  return (
    <div
      className={`break-hrow ${houseClosed ? 'is-closed' : ''}`.trim()}
      data-testid={`break-house-${id}`}
    >
      <div className="break-hrow-toggle">
        <Toggle size="sm" checked={wd.open} onChange={onToggleOpen} ariaLabel={`${name} open`} />
      </div>
      <div className="break-hrow-name">
        <span className="break-hname">{name}</span>
      </div>

      {houseClosed ? (
        <span className="break-hrow-closed">Closed for this break</span>
      ) : (
        <>
          <div className="break-hcell" data-label="Staff">
            <Stepper
              value={cfg.headcount}
              onChange={onHeadcount}
              testId={`break-headcount-${id}`}
            />
          </div>
          <div className="break-hcell" data-label="Weekdays">
            {wd.open ? (
              <TimeRange value={wd} onChange={onWeekday} />
            ) : (
              <span className="t-meta">Closed weekdays</span>
            )}
          </div>
          <div className="break-hcell" data-label="Weekends">
            {custom ? (
              <div className="break-weekend">
                <Toggle
                  size="sm"
                  checked={we.open}
                  onChange={(v) => onWeekend({ open: v })}
                  ariaLabel="Weekend open"
                />
                {we.open ? (
                  <TimeRange value={we} onChange={onWeekend} />
                ) : (
                  <span className="t-meta">Closed</span>
                )}
                <button type="button" className="break-linkbtn" onClick={onMatch}>
                  Match weekdays
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="break-linkbtn break-weekend-same"
                onClick={onCustomize}
              >
                Same as weekdays <span className="break-linkbtn-edit">Customize</span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function TimeRange({
  value,
  onChange,
}: {
  value: { start: string; end: string };
  onChange: (patch: { start?: string; end?: string }) => void;
}) {
  return (
    <span className="break-times">
      <input
        type="time"
        step={1800}
        className="input break-time"
        aria-label="Open time"
        value={value.start}
        onChange={(e) => onChange({ start: e.target.value })}
      />
      <span className="break-dash">to</span>
      <input
        type="time"
        step={1800}
        className="input break-time"
        aria-label="Close time"
        value={value.end}
        onChange={(e) => onChange({ end: e.target.value })}
      />
    </span>
  );
}

function Stepper({
  value,
  onChange,
  testId,
}: {
  value: number;
  onChange: (n: number) => void;
  testId?: string;
}) {
  return (
    <div className="break-stepper" data-testid={testId}>
      <button
        type="button"
        className="break-stepper-btn"
        aria-label="Fewer staff"
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
      >
        &#8722;
      </button>
      <span className="break-stepper-val">{value}</span>
      <button
        type="button"
        className="break-stepper-btn"
        aria-label="More staff"
        disabled={value >= 9}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  );
}

function ImpactPanel({
  impact,
  willVoid,
  confirmVoid,
  onConfirm,
}: {
  impact: BreakImpact;
  willVoid: boolean;
  confirmVoid: boolean;
  onConfirm: (v: boolean) => void;
}) {
  const tiles = [
    { label: 'Blocks created', value: impact.blocksGenerated, danger: false },
    { label: 'Seats added', value: impact.seatsAdded, danger: false },
    { label: 'Seats removed', value: impact.seatsRemoved, danger: false },
    { label: 'Blocks voided', value: impact.blocksVoided, danger: true },
    { label: 'Shifts cancelled', value: impact.assignmentsCancelled, danger: true },
    { label: 'Floats voided', value: impact.floatsVoided, danger: true },
  ];
  return (
    <div className="break-impact" data-testid="break-impact">
      <div className="break-impact-tiles">
        {tiles.map((t) => (
          <div key={t.label} className={`break-tile ${t.value > 0 ? 'is-active' : ''}`.trim()}>
            <div
              className="break-tile-val"
              style={t.danger && t.value > 0 ? { color: 'var(--st-danger)' } : undefined}
            >
              {t.value}
            </div>
            <div className="break-tile-label">{t.label}</div>
          </div>
        ))}
      </div>
      {impact.affected.length > 0 && (
        <div className="break-affected">
          <div className="t-label">Workers affected</div>
          <ul>
            {impact.affected.slice(0, 12).map((a, i) => (
              <li key={i}>
                <b>{a.worker}</b> · {a.house} · {a.when} ({a.kind})
              </li>
            ))}
          </ul>
        </div>
      )}
      {willVoid && (
        <label className="break-confirm" data-testid="break-confirm-void">
          <input
            type="checkbox"
            checked={confirmVoid}
            onChange={(e) => onConfirm(e.target.checked)}
          />
          I understand this cancels shifts / floats for the workers listed above.
        </label>
      )}
    </div>
  );
}
