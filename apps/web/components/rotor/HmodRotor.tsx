'use client';

import { useState } from 'react';

import { saveRotor } from '../../lib/actions/rotor';
import type { RotorCandidate, RotorWeek } from '../../lib/data/rotor';

export function HmodRotor({
  weeks,
  candidates,
  assignments,
}: {
  weeks: RotorWeek[];
  candidates: RotorCandidate[];
  assignments: Record<string, string>;
}) {
  const [selection, setSelection] = useState<Record<string, string>>(assignments);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    const entries = Object.entries(selection)
      .filter(([, hmodUserId]) => hmodUserId !== '')
      .map(([weekStartDate, hmodUserId]) => ({ weekStartDate, hmodUserId }));
    const res = await saveRotor({ entries });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSaved(true);
  }

  return (
    <div className="space-y-4">
      <table data-testid="rotor-grid" className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-black/10 text-left dark:border-white/10">
            <th className="py-2 font-semibold">Week</th>
            <th className="py-2 font-semibold">HMOD</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week.weekStartDate} className="border-b border-black/5 dark:border-white/5">
              <td className="py-2">{week.label}</td>
              <td className="py-2">
                <select
                  data-testid={`rotor-select-${week.weekStartDate}`}
                  value={selection[week.weekStartDate] ?? ''}
                  onChange={(e) => {
                    setSaved(false);
                    setSelection((prev) => ({ ...prev, [week.weekStartDate]: e.target.value }));
                  }}
                  className="rounded-md border border-black/15 px-2 py-1 text-sm dark:border-white/15 dark:bg-zinc-800"
                >
                  <option value="">— Unassigned —</option>
                  {candidates.map((c) => (
                    <option key={c.userId} value={c.userId}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
          {weeks.length === 0 && (
            <tr>
              <td colSpan={2} className="py-4 text-zinc-500">
                No active semester to plan.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {error !== null && (
        <p data-testid="rotor-error" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          data-testid="rotor-save"
          onClick={onSave}
          disabled={saving || weeks.length === 0}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
        >
          {saving ? 'Saving…' : 'Save rotor'}
        </button>
        {saved && (
          <span data-testid="rotor-saved" className="text-sm text-green-600">
            Saved.
          </span>
        )}
      </div>
    </div>
  );
}
