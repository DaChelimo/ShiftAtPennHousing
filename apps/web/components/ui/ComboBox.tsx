'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { Icon } from './Icon';

export type ComboOption = {
  value: string;
  label: string;
  /** Optional secondary text shown right-aligned (e.g. hours, home house). */
  meta?: string;
  disabled?: boolean;
};

// Searchable single-select dropdown (Carbon combo-box anatomy). Filters options
// by the typed query; selection is reported by value. Pure presentation — the
// caller owns the option list and the chosen value.
export function ComboBox({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  emptyText = 'No matches',
  disabled = false,
}: {
  options: ComboOption[];
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value) ?? null;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  return (
    <div className="combo" ref={ref}>
      <button
        type="button"
        className="input select"
        style={{ display: 'flex', alignItems: 'center', textAlign: 'left' }}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{ flex: 1, color: selected ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
          {selected ? selected.label : placeholder}
        </span>
        <Icon name="chevDown" size={16} className="select-caret" />
      </button>
      {open && (
        <div className="combo-menu" role="listbox" id={listId}>
          <div style={{ padding: 8, borderBottom: '1px solid var(--border-subtle)' }}>
            <div className="input-wrap">
              <Icon name="search" size={16} className="input-icon" />
              <input
                className="input has-icon"
                autoFocus
                placeholder="Search…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
          {filtered.length === 0 ? (
            <div className="combo-empty">{emptyText}</div>
          ) : (
            filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                disabled={o.disabled}
                className={`combo-opt ${o.value === value ? 'is-active' : ''}`.trim()}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                  setQuery('');
                }}
              >
                <span style={{ flex: 1 }}>{o.label}</span>
                {o.meta && <span className="t-meta">{o.meta}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
