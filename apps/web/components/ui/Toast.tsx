'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

import { IconButton } from './Button';
import { Icon } from './Icon';

export type ToastKind = 'info' | 'success' | 'error';
export type ToastInput = { kind?: ToastKind; title?: string; text?: string };
type ToastItem = ToastInput & { id: number };

const ToastContext = createContext<((t: ToastInput) => void) | null>(null);

// Toast provider + viewport. Wrap an interactive subtree and call `useToast()`
// to push transient confirmations (dark Carbon toasts, bottom-right).
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  const toast = useCallback((t: ToastInput) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, ...t }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4200);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <ToastViewport toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): (t: ToastInput) => void {
  const ctx = useContext(ToastContext);
  if (ctx == null) throw new Error('useToast must be used within a <ToastProvider>');
  return ctx;
}

function ToastViewport({ toasts, dismiss }: { toasts: ToastItem[]; dismiss: (id: number) => void }) {
  return (
    <div className="toast-host">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind ?? 'info'}`} role="status">
          <Icon name={t.kind === 'error' ? 'warnFill' : 'checkCircle'} size={18} />
          <div className="grow">
            {t.title && <div className="notif-title">{t.title}</div>}
            {t.text && <div className="notif-text">{t.text}</div>}
          </div>
          <IconButton icon="close" label="Dismiss" onClick={() => dismiss(t.id)} />
        </div>
      ))}
    </div>
  );
}
