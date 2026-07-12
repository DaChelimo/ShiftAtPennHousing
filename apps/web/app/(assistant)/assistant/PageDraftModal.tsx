'use client';

import { useState } from 'react';

import {
  draftPage,
  sendPage,
  type DraftResult,
  type FieldSpec,
} from '../../../lib/actions/assistant';

const ISSUE_TYPES = ['access', 'equipment', 'facilities', 'fire', 'general'] as const;

// Human-in-the-loop page drafting (V1_SCOPE §4.3): pick issue type, answer only the
// missing critical fields, review (and edit) the drafted page, then send. Sending is a
// separate action from drafting.
export function PageDraftModal({
  conversationId,
  onClose,
}: {
  conversationId: string | null;
  onClose: () => void;
}) {
  const [issueType, setIssueType] = useState<string>('access');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [editedBody, setEditedBody] = useState<string>('');
  const [adapter, setAdapter] = useState<'app_notification' | 'legacy_pager'>('app_notification');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ pagerText?: string } | null>(null);

  async function runDraft(): Promise<void> {
    setBusy(true);
    setError(null);
    const res = await draftPage({
      issueType,
      fields,
      conversationId,
      draftId: draft?.draftId ?? null,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDraft(res.data);
    if (res.data.body) setEditedBody(res.data.body);
  }

  async function runSend(): Promise<void> {
    if (draft === null) return;
    setBusy(true);
    setError(null);
    const res = await sendPage({ draftId: draft.draftId, adapter, body: editedBody });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSent({ pagerText: res.data.pagerText });
  }

  const setField = (key: string, value: string): void => setFields((p) => ({ ...p, [key]: value }));

  return (
    <div
      className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      data-testid="page-draft-modal"
    >
      <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface p-4 sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Draft a page</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-text-secondary"
            data-testid="draft-close"
          >
            Close
          </button>
        </div>

        {sent ? (
          <div data-testid="draft-sent">
            <p className="text-sm">
              {sent.pagerText
                ? 'Copy this into the pager channel:'
                : 'Page sent to the resolved on-duty contact.'}
            </p>
            {sent.pagerText && (
              <pre
                className="mt-2 whitespace-pre-wrap rounded-md border border-border-subtle bg-surface-2 p-3 text-sm"
                data-testid="pager-text"
              >
                {sent.pagerText}
              </pre>
            )}
            <button
              type="button"
              onClick={onClose}
              className="mt-3 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-text-on-color"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-text-secondary">Issue type</span>
              <select
                value={issueType}
                onChange={(e) => {
                  setIssueType(e.target.value);
                  setDraft(null);
                }}
                className="w-full rounded-md border border-border-subtle bg-surface px-2 py-1.5"
                data-testid="draft-issue-type"
              >
                {ISSUE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>

            {/* Missing critical fields to collect (only those still needed). */}
            {(draft?.missingFields ?? []).map((f: FieldSpec) => (
              <label key={f.key} className="text-sm">
                <span className="mb-1 block text-text-secondary">{f.label}</span>
                <input
                  value={fields[f.key] ?? ''}
                  onChange={(e) => setField(f.key, e.target.value)}
                  placeholder={f.prompt}
                  className="w-full rounded-md border border-border-subtle bg-surface px-2 py-1.5 placeholder:text-text-placeholder"
                  data-testid={`draft-field-${f.key}`}
                />
              </label>
            ))}

            {draft?.complete && (
              <div className="flex flex-col gap-2" data-testid="draft-review">
                <span className="text-sm text-text-secondary">
                  Review the page (recipient: {draft.recipient.label}). Edit freely.
                </span>
                <textarea
                  value={editedBody}
                  onChange={(e) => setEditedBody(e.target.value)}
                  rows={7}
                  className="w-full rounded-md border border-border-subtle bg-surface px-3 py-2 text-sm"
                  data-testid="draft-body"
                />
                <label className="text-sm">
                  <span className="mb-1 block text-text-secondary">Handoff</span>
                  <select
                    value={adapter}
                    onChange={(e) =>
                      setAdapter(e.target.value as 'app_notification' | 'legacy_pager')
                    }
                    className="w-full rounded-md border border-border-subtle bg-surface px-2 py-1.5"
                    data-testid="draft-adapter"
                  >
                    <option value="app_notification">Send as an app alert (default)</option>
                    <option value="legacy_pager">Format for the pager channel</option>
                  </select>
                </label>
              </div>
            )}

            {error && (
              <div
                className="rounded-md border border-border-subtle bg-surface px-3 py-2 text-sm"
                data-testid="draft-error"
              >
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2">
              {!draft?.complete ? (
                <button
                  type="button"
                  onClick={() => void runDraft()}
                  disabled={busy}
                  className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-text-on-color hover:bg-brand-hover disabled:opacity-50"
                  data-testid="draft-continue"
                >
                  {draft === null ? 'Start draft' : 'Continue'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void runSend()}
                  disabled={busy}
                  className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-text-on-color hover:bg-brand-hover disabled:opacity-50"
                  data-testid="draft-send"
                >
                  Review and send
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
