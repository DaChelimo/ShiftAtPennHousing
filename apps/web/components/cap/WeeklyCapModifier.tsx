'use client';

import { useState } from 'react';

import { saveWeeklyCap } from '../../lib/actions/cap';
import type { WeeklyCapAudit, WeeklyCapWeek } from '../../lib/data/cap';

export function WeeklyCapModifier({ weeks }: { weeks: WeeklyCapWeek[] }) {
  const [weekStartDate, setWeekStartDate] = useState('');
  const [hoursCap, setHoursCap] = useState<20 | 40>(20);
  const [notes, setNotes] = useState('');
  const [audit, setAudit] = useState<WeeklyCapAudit | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setAudit(null);
    setError(null);
    const result = await saveWeeklyCap({ weekStartDate, hoursCap, notes });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAudit(result.data);
  }

  return (
    <div data-testid="cap-modifier" className="space-y-6">
      <p
        data-testid="cap-global-notice"
        className="rounded-md bg-blue-50 p-3 text-sm text-blue-900"
      >
        Each change applies to all 13 houses immediately.
      </p>

      <div className="grid gap-4 rounded-lg border border-black/10 p-4 dark:border-white/10">
        <label className="grid gap-1 text-sm">
          Week beginning Monday
          <input
            type="date"
            data-testid="cap-week"
            value={weekStartDate}
            onChange={(event) => setWeekStartDate(event.target.value)}
            className="rounded-md border border-black/15 px-3 py-2 dark:border-white/15 dark:bg-zinc-800"
          />
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="cap-value-20"
            onClick={() => setHoursCap(20)}
            className={`rounded-md border px-3 py-2 text-sm ${hoursCap === 20 ? 'bg-zinc-900 text-white' : ''}`}
          >
            20 hours (soft)
          </button>
          <button
            type="button"
            data-testid="cap-value-40"
            onClick={() => setHoursCap(40)}
            className={`rounded-md border px-3 py-2 text-sm ${hoursCap === 40 ? 'bg-zinc-900 text-white' : ''}`}
          >
            40 hours (hard)
          </button>
        </div>
        <label className="grid gap-1 text-sm">
          Audit notes
          <textarea
            data-testid="cap-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="rounded-md border border-black/15 px-3 py-2 dark:border-white/15 dark:bg-zinc-800"
          />
        </label>
        <button
          type="button"
          data-testid="cap-submit"
          disabled={saving}
          onClick={submit}
          className="w-fit rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
        >
          {saving ? 'Applying...' : 'Apply cap'}
        </button>
      </div>

      {error !== null && <p className="text-sm text-red-600">{error}</p>}
      {audit !== null && (
        <div
          data-testid="cap-success"
          className="rounded-md bg-green-50 p-3 text-sm text-green-900"
        >
          <p>Weekly cap saved.</p>
          <p data-testid="cap-audit-modified-by">Modified by: {audit.modifiedByName}</p>
          <p data-testid="cap-audit-modified-at">Modified at: {audit.modifiedAt}</p>
          <p data-testid="cap-audit-notes">Notes: {audit.notes ?? 'None'}</p>
        </div>
      )}

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2">Week</th>
            <th className="py-2">Effective cap</th>
            <th className="py-2">Source</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week.weekStartDate} className="border-b border-black/5 dark:border-white/5">
              <td className="py-2">{week.weekStartDate}</td>
              <td className="py-2">
                {week.hoursCap} hours ({week.capEnforcement})
              </td>
              <td className="py-2">{week.isOverride ? 'Manual override' : 'Profile default'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
