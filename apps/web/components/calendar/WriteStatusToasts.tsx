'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Icon } from '../ui';

// Floating status toasts for calendar writes (assign / swap / remove): lets an
// admin editing the schedule see a change is still saving, then see it land or
// fail, instead of only finding out a second or two later when the grid quietly
// refetches. Keyed by CalShift.id: a second report for the SAME shift updates its
// toast in place (pending to success/error), it never duplicates; a report for a
// DIFFERENT shift stacks as its own toast.
export type WriteTogglePhase = 'pending' | 'success' | 'error' | 'cancel';

export interface WriteStatusEvent {
  key: string;
  phase: WriteTogglePhase;
  message?: string;
}

type ToastPhase = 'pending' | 'success' | 'error';

interface ToastItem {
  key: string;
  phase: ToastPhase;
  message: string;
}

// Auto-dismiss timing. Success follows Material Design's standard 4s snackbar
// duration. Error gets longer, 6s rather than the user's floated 5s, because a
// failure message is read more carefully than a confirmation and is usually
// longer text (e.g. "Couldn't swap: connection lost"). Both still auto-clear;
// the close button covers anyone who wants a toast gone sooner.
const AUTO_DISMISS_MS: Record<ToastPhase, number> = {
  pending: 0,
  success: 4000,
  error: 6000,
};

export function useWriteStatusToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const clearTimer = useCallback((key: string) => {
    const existing = timers.current.get(key);
    if (existing !== undefined) {
      clearTimeout(existing);
      timers.current.delete(key);
    }
  }, []);

  const dismiss = useCallback(
    (key: string) => {
      clearTimer(key);
      setToasts((prev) => prev.filter((t) => t.key !== key));
    },
    [clearTimer],
  );

  const report = useCallback(
    (evt: WriteStatusEvent) => {
      clearTimer(evt.key);
      if (evt.phase === 'cancel') {
        setToasts((prev) => prev.filter((t) => t.key !== evt.key));
        return;
      }
      const next: ToastItem = { key: evt.key, phase: evt.phase, message: evt.message ?? '' };
      setToasts((prev) => {
        const idx = prev.findIndex((t) => t.key === evt.key);
        if (idx === -1) return [...prev, next];
        const copy = prev.slice();
        copy[idx] = next;
        return copy;
      });
      const duration = AUTO_DISMISS_MS[evt.phase];
      if (duration > 0) {
        const id = setTimeout(() => dismiss(evt.key), duration);
        timers.current.set(evt.key, id);
      }
    },
    [clearTimer, dismiss],
  );

  // Snapshot the ref's map on unmount only, timers.current itself is stable for
  // the component's lifetime so this doesn't need to run per-render.
  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  return { toasts, report, dismiss };
}

export function WriteStatusToastStack({
  toasts,
  onDismiss,
}: {
  toasts: { key: string; phase: ToastPhase; message: string }[];
  onDismiss: (key: string) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className="write-toast-host" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.key} className={`write-toast is-${t.phase}`} data-testid="write-toast">
          <span className="write-toast-icon">
            {t.phase === 'pending' && <span className="spinner spinner-sm" aria-hidden="true" />}
            {t.phase === 'success' && <Icon name="check" size={14} />}
            {t.phase === 'error' && <Icon name="warn" size={14} />}
          </span>
          <span className="write-toast-msg">{t.message}</span>
          {t.phase !== 'pending' && (
            <button
              type="button"
              className="write-toast-close"
              aria-label="Dismiss"
              onClick={() => onDismiss(t.key)}
            >
              <Icon name="close" size={11} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
