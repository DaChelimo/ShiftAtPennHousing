'use client';

import { useState } from 'react';

import { saveSystemConfig } from '../../lib/actions/config';
import type { SystemConfigRow } from '../../lib/data/config';

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
    <div className="space-y-4">
      <p className="rounded-md bg-blue-50 p-3 text-sm text-blue-900">
        Saved changes are read by the orchestrator on its next tick.
      </p>
      {error !== null && <p className="text-sm text-red-600">{error}</p>}
      <div className="space-y-3">
        {rows.map((row) => (
          <section
            key={row.configKey}
            className="rounded-lg border border-black/10 p-4 dark:border-white/10"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-medium">{row.configKey}</h2>
                <p className="text-xs text-zinc-500">Type: {row.valueType}</p>
              </div>
              <button
                type="button"
                disabled={savingKey === row.configKey}
                onClick={() => save(row)}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
              >
                {savingKey === row.configKey ? 'Saving...' : 'Save'}
              </button>
            </div>
            <input
              aria-label={`${row.configKey} value`}
              value={row.configValue}
              onChange={(event) => patch(row.configKey, { configValue: event.target.value })}
              className="mb-2 w-full rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-800"
            />
            <textarea
              aria-label={`${row.configKey} notes`}
              placeholder="Audit notes"
              value={row.notes ?? ''}
              onChange={(event) => patch(row.configKey, { notes: event.target.value })}
              className="mb-2 w-full rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-800"
            />
            <p className="text-xs text-zinc-500">
              Last modified {row.modifiedAt} by {row.modifiedByName ?? 'seed data'}
              {row.notes === null ? '' : `: ${row.notes}`}
            </p>
          </section>
        ))}
      </div>
    </div>
  );
}
