'use client';

import { useEffect, type ReactNode } from 'react';

import { IconButton } from './Button';

// Carbon modal: scrim + dialog with an eyebrow/title head, scrolling body, and
// an optional full-width split-button footer. `danger` tints the title red (use
// for destructive confirms, e.g. Fire a worker). Esc + scrim-click close.
export function Modal({
  title,
  eyebrow,
  children,
  footer,
  onClose,
  danger = false,
  width = 520,
  testId,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose?: () => void;
  danger?: boolean;
  width?: number;
  /** data-testid for the dialog element (some flows assert on the modal). */
  testId?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        className={`modal ${danger ? 'modal-danger' : ''}`.trim()}
        style={{ width }}
        role="dialog"
        aria-modal="true"
        data-testid={testId}
      >
        <div className="modal-head">
          <div className="col gap-1">
            {eyebrow && <span className="t-eyebrow">{eyebrow}</span>}
            <h2 className="t-h1">{title}</h2>
          </div>
          {onClose && <IconButton icon="close" label="Close" onClick={onClose} />}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
