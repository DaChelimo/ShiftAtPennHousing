// S3 — Action-inbox view partitioning (web-remediation #3). PURE: no I/O, no
// Supabase, no implicit clock — the caller threads `nowIso` in. The web data layer
// (apps/web/lib/data/inbox.ts) builds an `InboxFilterInput` per `notifications` row
// and uses these predicates to decide whether a row belongs in the default
// ("unresolved + non-urgent") view or the "resolved" view, and whether it is due.
//
// "Resolved Allied alert" = an `hmod_urgent` notification whose resolved_at is set
// (the resolved marker added by migration 20260606000002). Only that combination is
// resolvable / resolved — every other notification type is always shown when due.

export type InboxView = 'default' | 'resolved';

export type InboxFilterInput = {
  type: string;
  scheduledForIso: string | null;
  resolvedAtIso: string | null;
};

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

// Does this row belong in the given inbox view at `nowIso`?
//   - not yet due → never (the due gate applies in BOTH views);
//   - resolved view → only resolved Allied alerts;
//   - default view → everything that is NOT a resolved Allied alert
//     (so: unresolved Allied alerts + all non-urgent notifications).
export function belongsInInboxView(
  input: InboxFilterInput,
  view: InboxView,
  nowIso: string,
): boolean {
  if (!isDue(input, nowIso)) return false;
  if (view === 'resolved') return isResolvedAllied(input);
  return !isResolvedAllied(input);
}
