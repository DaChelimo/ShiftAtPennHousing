'use client';

import { useState } from 'react';

import { saveSystemConfig } from '../../lib/actions/config';
import type { SystemConfigRow } from '../../lib/data/config';
import { Button, Card, Field, Notification, Tag, TextArea, TextInput } from '../ui';

export function SystemConfigEditor({ initialRows }: { initialRows: SystemConfigRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [savingKey, setSavingKey] = useState<string | null>(null);
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
  }

  return (
    <div className="col gap-4">
      <Notification kind="info" title="Applied on the next tick">
        Saved changes are read by the orchestrator on its next once-a-minute tick.
      </Notification>
      {error !== null && (
        <Notification kind="error" title="Could not save">
          {error}
        </Notification>
      )}

      <div className="col gap-3">
        {rows.map((row) => (
          <Card key={row.configKey} pad>
            <div className="row between gap-3" style={{ marginBottom: 16 }}>
              <div className="col gap-1">
                <span className="t-mono" style={{ fontWeight: 600, fontSize: 14 }}>
                  {row.configKey}
                </span>
                <Tag kind="gray">{row.valueType}</Tag>
              </div>
              <Button
                kind="secondary"
                size="sm"
                icon="check"
                disabled={savingKey === row.configKey}
                onClick={() => save(row)}
              >
                {savingKey === row.configKey ? 'Saving…' : 'Save'}
              </Button>
            </div>

            <div className="col gap-4">
              <Field label="Value">
                <TextInput
                  aria-label={`${row.configKey} value`}
                  value={row.configValue}
                  onChange={(event) => patch(row.configKey, { configValue: event.target.value })}
                />
              </Field>
              <Field label="Audit notes">
                <TextArea
                  aria-label={`${row.configKey} notes`}
                  placeholder="Why is this changing?"
                  rows={2}
                  value={row.notes ?? ''}
                  onChange={(event) => patch(row.configKey, { notes: event.target.value })}
                />
              </Field>
            </div>

            <p className="t-meta" style={{ marginTop: 12 }}>
              Last modified {row.modifiedAt} by {row.modifiedByName ?? 'seed data'}
              {row.notes === null ? '' : `: ${row.notes}`}
            </p>
          </Card>
        ))}
      </div>
    </div>
  );
}
