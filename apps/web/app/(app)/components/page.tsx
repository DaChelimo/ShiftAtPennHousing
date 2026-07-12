'use client';

import { useState } from 'react';

import {
  Avatar,
  Button,
  Card,
  ComboBox,
  DataTable,
  DateInput,
  EmptyState,
  ErrorState,
  EscalationChip,
  Field,
  IconButton,
  Modal,
  Notification,
  PageHead,
  PickupDot,
  Select,
  SHIFT_STATES,
  Skeleton,
  StatusLegend,
  Tabs,
  Tag,
  TextInput,
  Toggle,
  ToastProvider,
  useToast,
  type Column,
  type EscalationStep,
} from '../../../components/ui';

// Living style tile / component gallery (design screen 05). Presentation only —
// no data. The contract every screen prompt references for the shared layer.
export default function ComponentsPage() {
  return (
    <ToastProvider>
      <Gallery />
    </ToastProvider>
  );
}

const COLOR_TOKENS: { name: string; varName: string; on?: string }[] = [
  { name: 'Brand', varName: '--brand', on: '#fff' },
  { name: 'Brand hover', varName: '--brand-hover', on: '#fff' },
  { name: 'Brand active', varName: '--brand-active', on: '#fff' },
  { name: 'Brand subtle', varName: '--brand-subtle-bg', on: 'var(--brand)' },
  { name: 'Text primary', varName: '--text-primary', on: '#fff' },
  { name: 'Text secondary', varName: '--text-secondary', on: '#fff' },
  { name: 'Surface', varName: '--surface', on: 'var(--text-primary)' },
  { name: 'Canvas', varName: '--surface-2', on: 'var(--text-primary)' },
  { name: 'Border', varName: '--border-subtle', on: 'var(--text-primary)' },
  { name: 'Danger', varName: '--st-danger', on: '#fff' },
];

const TYPE_SCALE: { cls: string; label: string }[] = [
  { cls: 't-display', label: 'Display 28' },
  { cls: 't-h1', label: 'Heading 1 / 20' },
  { cls: 't-h2', label: 'Heading 2 / 16' },
  { cls: 't-h3', label: 'Heading 3 / 14' },
  { cls: 't-body', label: 'Body 14' },
  { cls: 't-label', label: 'Label 12' },
  { cls: 't-meta', label: 'Meta 12 secondary' },
];

type Person = { name: string; role: string; hours: string };
const PEOPLE: Person[] = [
  { name: 'Alice Quad', role: 'SW', hours: '12 / 20' },
  { name: 'Ben Quad', role: 'SW', hours: '18 / 20' },
  { name: 'Sam Quad', role: 'SM', hours: '8 / 20' },
];

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="st-section">
      <div className="st-section-head">
        <span className="t-h3">{title}</span>
        {sub && <span className="t-helper">{sub}</span>}
      </div>
      <div className="st-section-body col gap-4">{children}</div>
    </div>
  );
}

function Gallery() {
  const toast = useToast();
  const [modal, setModal] = useState<null | 'plain' | 'danger'>(null);
  const [toggleA, setToggleA] = useState(true);
  const [toggleB, setToggleB] = useState(false);
  const [combo, setCombo] = useState<string | null>(null);
  const [tab, setTab] = useState('feed');
  const [esc, setEsc] = useState<EscalationStep>('float');

  const personCols: Column<Person>[] = [
    {
      key: 'name',
      header: 'Worker',
      render: (p) => (
        <span className="cell-name">
          <Avatar name={p.name} size={26} />
          <b>{p.name}</b>
        </span>
      ),
    },
    { key: 'role', header: 'Role', render: (p) => <Tag kind={p.role === 'SM' ? 'blue' : 'gray'}>{p.role}</Tag> },
    { key: 'hours', header: 'Hours', numeric: true, render: (p) => <span className="t-mono">{p.hours}</span> },
  ];

  return (
    <div className="page">
      <PageHead
        eyebrow="Foundation"
        title="Components"
        sub="The shared Carbon-flavored layer + the load-bearing shift-state palette. Toggle the theme in the header to preview dark."
      />

      <div className="st-grid">
        {/* Color */}
        <Section title="Color" sub="Brand blue, near-black neutrals, semantic surfaces.">
          <div className="swatch-row">
            {COLOR_TOKENS.map((c) => (
              <div className="swatch" key={c.varName}>
                <div
                  className="swatch-chip"
                  style={{ background: `var(${c.varName})`, color: c.on }}
                >
                  {c.varName}
                </div>
                <span className="swatch-name">{c.name}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* Type */}
        <Section title="Typography" sub="IBM Plex Sans (UI) · IBM Plex Mono (times / IDs).">
          <div className="col gap-3">
            {TYPE_SCALE.map((t) => (
              <span className={t.cls} key={t.cls}>
                {t.label}
              </span>
            ))}
            <span className="t-mono t-body">08:00-24:00 · #A1B2C3</span>
          </div>
        </Section>

        {/* Buttons */}
        <Section title="Buttons" sub="Primary · secondary · tertiary · ghost · danger.">
          <div className="row gap-2 wrap">
            <Button kind="primary">Primary</Button>
            <Button kind="secondary">Secondary</Button>
            <Button kind="tertiary">Tertiary</Button>
            <Button kind="ghost">Ghost</Button>
            <Button kind="danger">Danger</Button>
          </div>
          <div className="row gap-2 wrap">
            <Button kind="primary" icon="add">
              With icon
            </Button>
            <Button kind="secondary" size="sm">
              Small
            </Button>
            <Button kind="primary" disabled>
              Disabled
            </Button>
            <IconButton icon="settings" label="Settings" />
            <IconButton icon="bell" label="Bell" active />
          </div>
        </Section>

        {/* Tags */}
        <Section title="Tags & status pills" sub="Plus the 8px cross-house pickup dot.">
          <div className="row gap-2 wrap">
            <Tag kind="gray">Gray</Tag>
            <Tag kind="blue">Blue</Tag>
            <Tag kind="green">Green</Tag>
            <Tag kind="purple">Purple</Tag>
            <Tag kind="teal">Teal</Tag>
            <Tag kind="amber">Amber</Tag>
            <Tag kind="red">Red</Tag>
            <Tag kind="magenta">Magenta</Tag>
            <Tag kind="outline">Outline</Tag>
          </div>
          <div className="row gap-3">
            <span className="row gap-2">
              <PickupDot /> Cross-house pickup
            </span>
            <Avatar name="Marcus Webb" />
          </div>
        </Section>

        {/* Shift-state legend */}
        <div className="st-section" style={{ gridColumn: '1 / -1' }}>
          <div className="st-section-head">
            <span className="t-h3">Shift-state palette (load-bearing)</span>
            <span className="t-helper">
              Color always pairs with a text tag + icon — never color alone (WCAG 2.1 AA).
            </span>
          </div>
          <div className="st-section-body col gap-4">
            <StatusLegend />
            <div className="state-grid">
              {SHIFT_STATES.map((s) => (
                <div className="state-card" key={s.key}>
                  <span className={`legend-sw state-swatch ${s.swatch}`} aria-hidden="true" />
                  <div className="state-meta">
                    <Tag kind={s.tagKind} icon={s.icon}>
                      {s.label}
                    </Tag>
                    <span className="t-meta" style={{ marginTop: 4 }}>
                      {s.description}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Escalation */}
        <Section title="Escalation timeline" sub="T-3h broadcast → T-2h float → Allied fallback.">
          <div className="esc-demo">
            <EscalationChip step={esc} />
          </div>
          <div className="seg">
            {(['broadcast', 'float', 'allied'] as EscalationStep[]).map((k) => (
              <button
                key={k}
                type="button"
                className={`seg-btn ${esc === k ? 'is-on' : ''}`.trim()}
                onClick={() => setEsc(k)}
              >
                {k}
              </button>
            ))}
          </div>
          <EscalationChip step={esc} compact />
        </Section>

        {/* Forms */}
        <Section title="Form controls" sub="Text · select · searchable combo-box · date · toggle.">
          <Field label="Search" helper="Rounded field, brand focus ring.">
            <TextInput icon="search" placeholder="Find a worker…" />
          </Field>
          <Field label="House">
            <Select defaultValue="quad">
              <option value="quad">Quad</option>
              <option value="harnwell">Harnwell</option>
            </Select>
          </Field>
          <Field label="Replacement (combo-box)">
            <ComboBox
              options={[
                { value: 'bea', label: 'Bea Quad', meta: 'BM' },
                { value: 'admin', label: 'Project Administrator', meta: 'Admin' },
              ]}
              value={combo}
              onChange={setCombo}
              placeholder="Pick a replacement…"
            />
          </Field>
          <Field label="Week of">
            <DateInput defaultValue="2026-02-02" />
          </Field>
          <div className="row gap-4 wrap">
            <Toggle checked={toggleA} onChange={setToggleA} label="Broadcast subscription" />
            <Toggle checked={toggleB} onChange={setToggleB} label="Quiet hours" size="sm" />
          </div>
        </Section>

        {/* Tabs */}
        <Section title="Tabs" sub="Line tabs with count pills.">
          <Tabs
            tabs={[
              { key: 'feed', label: 'Weekly feed', count: 4 },
              { key: 'perm', label: 'Permanent openings', count: 1 },
              { key: 'done', label: 'Resolved' },
            ]}
            active={tab}
            onChange={setTab}
          />
          <span className="t-helper">Active tab: {tab}</span>
        </Section>

        {/* Notifications */}
        <Section title="Notifications" sub="Inline severities + the actionable Allied alert.">
          <Notification kind="info" title="Heads up">
            A worker permanently dropped a recurring slot at Quad.
          </Notification>
          <Notification kind="success" title="Schedule published">
            14 shifts scheduled for the week of Feb 2.
          </Notification>
          <Notification kind="warning" title="Approaching cap">
            Ben is at 18 of 20 hours this week.
          </Notification>
          <Notification
            kind="error"
            actionable
            title="Allied coverage needed — Quad, 22:00–24:00"
            actions={
              <Button kind="danger" size="sm" onClick={() => toast({ kind: 'success', title: 'Marked covered' })}>
                Call Allied / Mark covered
              </Button>
            }
          >
            No floater found in Quad or Harnwell.
          </Notification>
        </Section>

        {/* States */}
        <Section title="Empty / loading / error" sub="The quiet-hero inbox + skeletons.">
          <Card>
            <EmptyState
              title="All clear"
              desc="No action needed right now."
              action={<Button kind="tertiary">View calendar</Button>}
            />
          </Card>
          <Card className="card-pad col gap-2">
            <Skeleton w="40%" h={16} />
            <Skeleton w="80%" />
            <Skeleton w="65%" />
          </Card>
          <Card>
            <ErrorState desc="Could not load coverage. Retry in a moment." action={<Button kind="secondary">Retry</Button>} />
          </Card>
        </Section>

        {/* Data table */}
        <Section title="Data table" sub="Carbon table convention (clickable rows, mono numerics).">
          <DataTable
            columns={personCols}
            rows={PEOPLE}
            getRowKey={(p) => p.name}
            onRowClick={(p) => toast({ title: p.name, text: 'Row clicked' })}
          />
        </Section>

        {/* Modals + toast */}
        <Section title="Modals & toasts" sub="Standard + danger confirm; transient toasts.">
          <div className="row gap-2 wrap">
            <Button kind="secondary" onClick={() => setModal('plain')}>
              Open modal
            </Button>
            <Button kind="danger" onClick={() => setModal('danger')}>
              Danger modal
            </Button>
            <Button kind="tertiary" icon="bell" onClick={() => toast({ kind: 'success', title: 'Saved', text: 'Changes applied.' })}>
              Fire a toast
            </Button>
          </div>
        </Section>
      </div>

      {modal === 'plain' && (
        <Modal
          eyebrow="Confirm"
          title="Publish schedule?"
          onClose={() => setModal(null)}
          footer={
            <>
              <Button kind="secondary" onClick={() => setModal(null)}>
                Cancel
              </Button>
              <Button kind="primary" onClick={() => setModal(null)}>
                Publish
              </Button>
            </>
          }
        >
          <p className="t-body">
            Publishing makes the draft the live source of truth and notifies workers.
          </p>
        </Modal>
      )}
      {modal === 'danger' && (
        <Modal
          danger
          eyebrow="Destructive"
          title="Fire this worker?"
          onClose={() => setModal(null)}
          footer={
            <>
              <Button kind="secondary" onClick={() => setModal(null)}>
                Cancel
              </Button>
              <Button kind="danger" onClick={() => setModal(null)}>
                Fire worker
              </Button>
            </>
          }
        >
          <p className="t-body">
            This vacates all their shifts, voids their floats, and deactivates the account. Mid-shift
            gaps escalate immediately.
          </p>
        </Modal>
      )}
    </div>
  );
}
