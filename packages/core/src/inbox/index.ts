// Action-inbox derivation — PURE: no I/O, no Supabase, no implicit clock (the caller
// threads `nowIso` in). The web data layer (apps/web/lib/data/inbox.ts) builds an
// `InboxFilterInput` per `notifications` row and uses these predicates to decide
// whether a row is due, whether it is a resolved Allied alert, and — for Allied
// (`hmod_urgent`) alerts — where it sits in its coverage-window lifecycle.
//
// "Resolved Allied alert" = an `hmod_urgent` notification whose resolved_at is set
// (the resolved marker added by migration 20260606000002). Only that combination is
// resolvable — every other notification type is always shown when due.
//
// ARCHIVE MODEL (BSpec §5.4 / §10.1): an Allied alert is actionable only while the
// period for which coverage was needed is still ahead. Once that window's END passes
// — resolved or NOT — the alert is archived for one day, then discarded from the
// inbox (the row stays in the DB; see alliedLifecycle). The window end comes from the
// notification payload's `block_end_at` (migration 20260624000001), falling back to
// block_start_at + 30 minutes for legacy rows / per-block chain alerts.

export type InboxFilterInput = {
  type: string;
  scheduledForIso: string | null;
  resolvedAtIso: string | null;
  // Allied-coverage window (hmod_urgent only); read from the notification payload.
  // `blockEndIso` may be absent on legacy rows — alliedWindowEndIso falls back to
  // blockStartIso + 30 minutes.
  blockStartIso?: string | null;
  blockEndIso?: string | null;
};

export type AlliedLifecycle = 'active' | 'archived' | 'discarded';

// A single shift block, and how long an elapsed Allied alert lingers in the archive.
const BLOCK_MS = 30 * 60 * 1000;
const ARCHIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

// A notification is "due" once its scheduled_for has arrived (or it has none).
// Compare AS DATES, not as strings: offset-bearing ISO timestamps (e.g. a
// "-05:00" vs "Z" suffix) do NOT order correctly lexically.
export function isDue(input: InboxFilterInput, nowIso: string): boolean {
  if (input.scheduledForIso === null) return true;
  return new Date(input.scheduledForIso).getTime() <= new Date(nowIso).getTime();
}

// A resolved Allied alert: an hmod_urgent notification that has been resolved.
export function isResolvedAllied(input: InboxFilterInput): boolean {
  return input.type === 'hmod_urgent' && input.resolvedAtIso !== null;
}

// The instant the coverage window ends, for an Allied (hmod_urgent) alert. Prefers
// the stored `block_end_at`; falls back to block_start + 30 minutes (a single chain
// block). Returns null when the row is not an Allied alert or carries no window — such
// rows have no coverage lifecycle and are treated as always-active.
export function alliedWindowEndIso(input: InboxFilterInput): string | null {
  if (input.type !== 'hmod_urgent') return null;
  if (input.blockEndIso != null && input.blockEndIso !== '') return input.blockEndIso;
  if (input.blockStartIso != null && input.blockStartIso !== '') {
    return new Date(new Date(input.blockStartIso).getTime() + BLOCK_MS).toISOString();
  }
  return null;
}

// Where an Allied alert sits relative to its coverage window at `nowIso`:
//   'active'    — the window has not yet ended (still actionable);
//   'archived'  — the window ended within the last 24h (kept for reference, whether
//                 or not it was resolved);
//   'discarded' — older than that → hidden from the inbox (the DB row is retained).
// Non-Allied rows, or Allied rows with no window, are always 'active'.
export function alliedLifecycle(input: InboxFilterInput, nowIso: string): AlliedLifecycle {
  const endIso = alliedWindowEndIso(input);
  if (endIso === null) return 'active';
  const end = new Date(endIso).getTime();
  const now = new Date(nowIso).getTime();
  if (now < end) return 'active';
  if (now < end + ARCHIVE_WINDOW_MS) return 'archived';
  return 'discarded';
}
