'use client';

import { useState } from 'react';

import { returnFromLeave, submitLeave } from '../../lib/actions/leave';
import type { ActiveLeave, ReplacementOption } from '../../lib/data/leave';

export function HmLeaveForm({
  candidates,
  defaultReplacementUserId,
  myActiveLeaves,
}: {
  candidates: ReplacementOption[];
  defaultReplacementUserId: string | null;
  myActiveLeaves: ActiveLeave[];
}) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [replacementUserId, setReplacementUserId] = useState<string | null>(
    defaultReplacementUserId,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mailtoUrl, setMailtoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selected = candidates.find((c) => c.userId === replacementUserId) ?? null;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const res = await submitLeave({ startDate, endDate, replacementUserId });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setMailtoUrl(res.data.mailtoUrl);
  }

  return (
    <div className="space-y-6">
      <form
        data-testid="hm-leave-form"
        onSubmit={onSubmit}
        className="space-y-4 rounded-lg border border-black/10 p-5 dark:border-white/10"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1 text-sm font-medium">
            <span>Start date</span>
            <input
              data-testid="leave-start-date"
              type="date"
              required
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-800"
            />
          </label>
          <label className="block space-y-1 text-sm font-medium">
            <span>End date</span>
            <input
              data-testid="leave-end-date"
              type="date"
              required
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-800"
            />
          </label>
        </div>

        <div className="space-y-1 text-sm font-medium">
          <span>Replacement</span>
          <div className="relative">
            <button
              type="button"
              data-testid="replacement-select"
              onClick={() => setPickerOpen((open) => !open)}
              className="w-full rounded-md border border-black/15 px-3 py-2 text-left text-sm dark:border-white/15"
            >
              {selected !== null ? `${selected.name} (${selected.role})` : 'Select replacement…'}
            </button>
            {pickerOpen && (
              <div
                data-testid="replacement-options"
                role="listbox"
                className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-black/15 bg-white shadow-lg dark:border-white/15 dark:bg-zinc-900"
              >
                {candidates.map((c) => (
                  <button
                    key={c.userId}
                    type="button"
                    role="option"
                    aria-selected={c.userId === replacementUserId}
                    onClick={() => {
                      setReplacementUserId(c.userId);
                      setPickerOpen(false);
                    }}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
                  >
                    {c.name}
                    <span className="ml-2 text-xs text-zinc-500">{c.role}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="text-xs text-zinc-500">
            HMs in your incoming replacement chain are omitted to prevent cycles (§2.6).
          </p>
        </div>

        {error !== null && (
          <p data-testid="leave-error" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <button
          type="submit"
          data-testid="leave-submit"
          disabled={submitting}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
        >
          {submitting ? 'Submitting…' : 'Submit leave'}
        </button>

        {mailtoUrl !== null && (
          <div className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900">
            <p className="mb-1 font-medium">Leave recorded. Notify the student workers:</p>
            <a data-testid="leave-mailto" href={mailtoUrl} className="font-medium underline">
              Open pre-filled email
            </a>
          </div>
        )}
      </form>

      {myActiveLeaves.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Active leaves</h2>
          <ul className="space-y-2">
            {myActiveLeaves.map((leave) => (
              <li
                key={leave.leaveId}
                className="flex items-center justify-between rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/10"
              >
                <span>
                  {leave.startDate} → {leave.endDate}
                  {leave.replacementName !== null && (
                    <span className="ml-2 text-zinc-500">cover: {leave.replacementName}</span>
                  )}
                </span>
                <ImBackButton leaveId={leave.leaveId} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ImBackButton({ leaveId }: { leaveId: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      data-testid="leave-im-back"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await returnFromLeave({ leaveId });
        setBusy(false);
      }}
      className="rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium hover:bg-black/5 disabled:opacity-50 dark:border-white/15"
    >
      I&apos;m back
    </button>
  );
}
