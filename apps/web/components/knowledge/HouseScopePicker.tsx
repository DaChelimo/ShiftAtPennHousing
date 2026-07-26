'use client';

// House scope picker for the KB intake review step (replaces the old single-house-or-
// shared dropdown). A popup card with one checkbox per house; the operator can narrow
// or widen the set freely instead of being forced to pick exactly one house. `null`
// still means "shared, applies to every house" (unchanged storage semantics, and far
// cheaper than writing out all 13 ids every time all of them are checked).
//
// Default when a document is first opened for review (see useHouseScopeDefault below):
// the last selection this operator saved (localStorage, this browser), or -- if nothing
// is saved yet -- their own home house, or Harnwell for a house-agnostic Project Admin.
// This intentionally does NOT seed from Claude's per-document guess; the operator's own
// last choice (or role default) is a more useful starting point than a single-house
// guess that may be wrong (see the 2026-07-24 "HARN" incident).

import { useEffect, useRef, useState } from 'react';

import { IconButton, Tag } from '../ui';

import type { HouseOption } from './KnowledgeIntake';

const STORAGE_KEY = 'kb-house-scope-last-selection';

type StoredSelection = 'all' | string[];

function readStoredSelection(): StoredSelection | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === 'all') return 'all';
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string') && parsed.length > 0) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function writeStoredSelection(value: string[] | null, totalHouseCount: number): void {
  if (typeof window === 'undefined') return;
  const stored: StoredSelection = value === null || value.length >= totalHouseCount ? 'all' : value;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

/**
 * Computes the one-time default for a freshly-opened document and applies it via
 * `onChange`, once per `intakeId`. Exported separately from the popup UI so
 * ReviewPanel can apply it as soon as a document is opened, without requiring the
 * operator to open the popup first.
 */
export function useHouseScopeDefault({
  intakeId,
  isProjectAdmin,
  currentUserHouseId,
  onChange,
}: {
  intakeId: string;
  isProjectAdmin: boolean;
  currentUserHouseId: string;
  onChange: (next: string[] | null) => void;
}): void {
  const appliedFor = useRef<string | null>(null);
  useEffect(() => {
    if (appliedFor.current === intakeId) return;
    appliedFor.current = intakeId;
    const saved = readStoredSelection();
    if (saved !== null) {
      onChange(saved === 'all' ? null : saved);
    } else {
      onChange([isProjectAdmin ? 'harnwell' : currentUserHouseId]);
    }
  }, [intakeId, onChange, isProjectAdmin, currentUserHouseId]);
}

export function HouseScopeChips({
  value,
  houses,
}: {
  value: string[] | null;
  houses: HouseOption[];
}) {
  if (value === null) {
    return <Tag kind="blue">All houses</Tag>;
  }
  const byId = new Map(houses.map((h) => [h.id, h.name]));
  return (
    <div className="row gap-1" style={{ flexWrap: 'wrap' }}>
      {value.map((id) => (
        <Tag key={id} kind="gray">
          {byId.get(id) ?? id}
        </Tag>
      ))}
    </div>
  );
}

export function HouseScopePicker({
  value,
  houses,
  onChange,
}: {
  value: string[] | null;
  houses: HouseOption[];
  onChange: (next: string[] | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickAway = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClickAway);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickAway);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const checkedIds = value === null ? new Set(houses.map((h) => h.id)) : new Set(value);

  function toggle(houseId: string) {
    const next = new Set(checkedIds);
    if (next.has(houseId)) {
      if (next.size === 1) return; // never let the set go empty
      next.delete(houseId);
    } else {
      next.add(houseId);
    }
    const nextValue =
      next.size >= houses.length ? null : houses.filter((h) => next.has(h.id)).map((h) => h.id);
    writeStoredSelection(nextValue, houses.length);
    onChange(nextValue);
  }

  return (
    <div className="col gap-2" ref={containerRef} style={{ position: 'relative' }}>
      <div className="row gap-2" style={{ alignItems: 'center' }}>
        <HouseScopeChips value={value} houses={houses} />
        <IconButton
          icon="edit"
          label="Edit house scope"
          size={14}
          className="icon-btn-sm"
          onClick={() => setOpen((o) => !o)}
          data-testid="house-scope-edit"
        />
      </div>
      {open && (
        <div
          className="col gap-1"
          data-testid="house-scope-popup"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 20,
            background: 'var(--surface-1)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-md, 0 4px 16px rgba(0,0,0,0.15))',
            padding: 10,
            minWidth: 220,
            maxHeight: 280,
            overflowY: 'auto',
          }}
        >
          {houses.map((h) => (
            <label
              key={h.id}
              className="row gap-2"
              style={{ alignItems: 'center', padding: '4px 2px' }}
            >
              <input
                type="checkbox"
                checked={checkedIds.has(h.id)}
                onChange={() => toggle(h.id)}
                data-testid={`house-scope-checkbox-${h.id}`}
              />
              <span className="t-body">{h.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
