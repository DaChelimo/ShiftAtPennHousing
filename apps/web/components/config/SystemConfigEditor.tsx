'use client';

import { useState } from 'react';

import { saveSystemConfig } from '../../lib/actions/config';
import type { SystemConfigRow } from '../../lib/data/config';
import { Button, Card, Notification, Tag, TextInput } from '../ui';
import type { IconName } from '../ui/Icon';
import { Icon } from '../ui/Icon';
import type { TagKind } from '../ui/Tag';

// Human-readable name + plain-English meaning for each known config key, grouped
// into a themed category (icon + color) so the grid reads at a glance instead of
// as a flat list of keys. Unknown keys fall back to a title-cased key, a gray
// "misc" look, and no description, so the page never breaks on a new row.
type Category = { label: string; kind: TagKind; icon: IconName; accent: string };

const CATEGORIES = {
  scheduling: { label: 'Scheduling', kind: 'blue', icon: 'clock', accent: 'var(--brand)' },
  floats: { label: 'Floats', kind: 'green', icon: 'swap', accent: 'var(--st-float-fg)' },
  swaps: { label: 'Swaps', kind: 'purple', icon: 'refresh', accent: 'var(--st-out-fg)' },
  escalation: { label: 'Escalation', kind: 'amber', icon: 'bell', accent: 'var(--st-pending)' },
  admin: { label: 'Admin', kind: 'magenta', icon: 'shield', accent: 'var(--st-perm-fg)' },
} satisfies Record<string, Category>;

const CONFIG_META: Record<
  string,
  { title: string; description: string; category: keyof typeof CATEGORIES }
> = {
  drop_horizon_days: {
    title: 'Drop horizon',
    description: 'How many days ahead a worker is allowed to drop a scheduled shift.',
    category: 'scheduling',
  },
  shift_block_minutes: {
    title: 'Shift block length',
    description: 'Length of one schedule block, in minutes. Every shift op works on this grid.',
    category: 'scheduling',
  },
  min_float_chunk_blocks: {
    title: 'Minimum float chunk',
    description:
      '30-min blocks: the smallest span the float algorithm will float instead of sending to Allied.',
    category: 'floats',
  },
  max_allied_coverage_blocks: {
    title: 'Max Allied coverage',
    description: '30-min blocks: the most Allied can be asked to cover in a single orchestrator pass.',
    category: 'floats',
  },
  float_retention_days: {
    title: 'Float retention',
    description: 'How many days a completed float record is kept before cleanup.',
    category: 'floats',
  },
  shift_swap_expiry_anchor: {
    title: 'Shift swap expiry anchor',
    description: 'When an unaccepted shift swap request expires, relative to the shift start time.',
    category: 'swaps',
  },
  float_swap_expiry_hours: {
    title: 'Float swap expiry',
    description: 'Hours before an unaccepted float swap request auto-expires.',
    category: 'swaps',
  },
  permanent_swap_expiry_days: {
    title: 'Permanent swap expiry',
    description: 'Days before an unaccepted permanent swap request auto-expires.',
    category: 'swaps',
  },
  hm_working_hours_start: {
    title: 'HM working hours start',
    description: 'Start of HM/BM/RSM working hours, used to route escalations to Allied vs. a person.',
    category: 'escalation',
  },
  hm_working_hours_end: {
    title: 'HM working hours end',
    description: 'End of HM/BM/RSM working hours, used to route escalations to Allied vs. a person.',
    category: 'escalation',
  },
  no_ack_trigger_offset_minutes: {
    title: 'No-ack trigger offset',
    description: 'Minutes after a float assignment before a no-acknowledgment escalation fires.',
    category: 'escalation',
  },
  ack_deadline_offset_minutes: {
    title: 'Ack deadline offset',
    description: 'Minutes a worker has to acknowledge a float before it counts as unacknowledged.',
    category: 'escalation',
  },
  project_administrator_user_id: {
    title: 'Project administrator',
    description: 'Terminal fallback contact for urgent notifications when no HM/HMOD is available.',
    category: 'admin',
  },
};

function titleCase(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function SystemConfigEditor({ initialRows }: { initialRows: SystemConfigRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [justSavedKey, setJustSavedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function patch(configKey: string, update: Partial<SystemConfigRow>) {
    setRows((current) =>
      current.map((row) => (row.configKey === configKey ? { ...row, ...update } : row)),
    );
  }

  async function save(row: SystemConfigRow) {
    setSavingKey(row.configKey);
    setError(null);
    const result = await saveSystemConfig({
      configKey: row.configKey,
      configValue: row.configValue,
      notes: row.notes ?? '',
    });
    setSavingKey(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    patch(row.configKey, result.data);
    setJustSavedKey(row.configKey);
    setTimeout(() => setJustSavedKey((current) => (current === row.configKey ? null : current)), 1600);
  }

  return (
    <div className="col gap-4">
      <Notification kind="info" title="Nice and fresh">
        Save a value and the orchestrator picks it up on its next tick, within a minute.
      </Notification>
      {error !== null && (
        <Notification kind="error" title="Could not save">
          {error}
        </Notification>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 14,
        }}
      >
        {rows.map((row) => {
          const meta = CONFIG_META[row.configKey];
          const category = meta ? CATEGORIES[meta.category] : undefined;
          const accent = category?.accent ?? 'var(--text-secondary)';
          const justSaved = justSavedKey === row.configKey;
          return (
            <Card
              key={row.configKey}
              pad
              className="col gap-2"
              style={{
                borderLeft: `3px solid ${accent}`,
                transition: 'transform 120ms ease, box-shadow 120ms ease',
                boxShadow: justSaved ? `0 0 0 3px ${accent}33` : undefined,
              }}
            >
              <div className="row between gap-2" style={{ alignItems: 'flex-start' }}>
                <div className="row gap-2" style={{ alignItems: 'flex-start' }}>
                  <span
                    className="row"
                    style={{
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      background: `${accent}1a`,
                      color: accent,
                      flexShrink: 0,
                    }}
                  >
                    <Icon name={category?.icon ?? 'settings'} size={15} />
                  </span>
                  <div className="col gap-1">
                    <span style={{ fontWeight: 600, fontSize: 14 }}>
                      {meta?.title ?? titleCase(row.configKey)}
                    </span>
                    <span className="t-mono t-meta" style={{ fontSize: 11 }}>
                      {row.configKey}
                    </span>
                  </div>
                </div>
                <Tag kind={category?.kind ?? 'gray'}>{row.valueType}</Tag>
              </div>

              {meta?.description !== undefined && (
                <p className="t-meta" style={{ fontSize: 12.5, lineHeight: 1.4 }}>
                  {meta.description}
                </p>
              )}

              <div className="row gap-2" style={{ alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <TextInput
                    aria-label={`${row.configKey} value`}
                    value={row.configValue}
                    onChange={(event) => patch(row.configKey, { configValue: event.target.value })}
                  />
                </div>
                <Button
                  kind={justSaved ? 'primary' : 'secondary'}
                  size="sm"
                  icon={justSaved ? 'checkCircle' : 'check'}
                  disabled={savingKey === row.configKey}
                  onClick={() => save(row)}
                >
                  {savingKey === row.configKey ? 'Saving…' : justSaved ? 'Saved!' : 'Save'}
                </Button>
              </div>

              <p className="t-meta" style={{ fontSize: 11 }}>
                Last changed {row.modifiedAt} by {row.modifiedByName ?? 'seed data'}
              </p>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
