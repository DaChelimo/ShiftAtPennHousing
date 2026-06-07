// Phase 08 / S2 — Force-Trigger Pathway: response summarizer (web UI glue).
//
// `summarizeForceTrigger` is PURE: no I/O, no clock, no DB. It maps the parsed
// JSON body of a `force-trigger` Edge Function response (ARCH §6) — either the
// success shape or one of the error shapes — to a single discriminated UI
// outcome. The Coverage monitor's force-trigger action (apps/web) calls the EF,
// parses the body, then hands it here so the action and the UI render the same
// outcome.
//
// EF response shapes (supabase/functions/force-trigger/index.ts):
//   success  { ok:true, floatAssignmentIds: string[], alliedNotifications: [...], forcedAt }
//   reject   { error:'force_trigger_rejected', reason } (incl. 'float_not_enabled')
//   failure  { error:'force_trigger_failed', detail } (or any unrecognized body)
//
// Outcome mapping (TEST_PLAN §§3, 4a):
//   floated — one or more pending floaters assigned, no Allied fallback;
//   allied  — no floater found, routed to HMOD-for-Allied (also the defined
//             no-op outcome when the EF reports success with nothing to do);
//   mixed   — some blocks floated, some routed to Allied;
//   gated   — rejected with 'float_not_enabled' (non-floating / winter profile);
//   rejected— any other rejection reason (carries the reason);
//   failed  — a failure body or an unrecognized shape.

const FLOAT_NOT_ENABLED = 'float_not_enabled';

// The parsed EF JSON body — a success shape, a known error shape, or anything
// else (defensively treated as a failure).
export type ForceTriggerResponse =
  | {
      ok: true;
      floatAssignmentIds?: unknown;
      alliedNotifications?: unknown;
      forcedAt?: unknown;
    }
  | { error: 'force_trigger_rejected'; reason?: unknown }
  | { error: 'force_trigger_failed'; detail?: unknown }
  | Record<string, unknown>
  | null
  | undefined;

export type ForceTriggerSummary = {
  kind: 'floated' | 'allied' | 'mixed' | 'gated' | 'rejected' | 'failed';
  floaterCount: number;
  alliedCount: number;
  reason?: string;
};

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

export function summarizeForceTrigger(res: ForceTriggerResponse): ForceTriggerSummary {
  if (typeof res !== 'object' || res === null) {
    return { kind: 'failed', floaterCount: 0, alliedCount: 0 };
  }

  // Success shape: count floaters vs. Allied notifications.
  if ((res as { ok?: unknown }).ok === true) {
    const floaterCount = arrayLength((res as { floatAssignmentIds?: unknown }).floatAssignmentIds);
    const alliedCount = arrayLength((res as { alliedNotifications?: unknown }).alliedNotifications);

    if (floaterCount > 0 && alliedCount > 0) {
      return { kind: 'mixed', floaterCount, alliedCount };
    }
    if (floaterCount > 0) {
      return { kind: 'floated', floaterCount, alliedCount: 0 };
    }
    // alliedCount > 0, OR both empty (a gap with nothing to do): a defined,
    // non-crashing 'allied' outcome so the UI always has a message.
    return { kind: 'allied', floaterCount: 0, alliedCount };
  }

  const error = (res as { error?: unknown }).error;

  // Rejection: a float-disabled profile is the §6.5 gated case; everything else
  // is a generic rejection that carries its reason.
  if (error === 'force_trigger_rejected') {
    const reason = (res as { reason?: unknown }).reason;
    const reasonStr = typeof reason === 'string' ? reason : undefined;
    if (reasonStr === FLOAT_NOT_ENABLED) {
      return { kind: 'gated', floaterCount: 0, alliedCount: 0, reason: reasonStr };
    }
    return {
      kind: 'rejected',
      floaterCount: 0,
      alliedCount: 0,
      ...(reasonStr ? { reason: reasonStr } : {}),
    };
  }

  // 'force_trigger_failed' or any unrecognized body.
  return { kind: 'failed', floaterCount: 0, alliedCount: 0 };
}
