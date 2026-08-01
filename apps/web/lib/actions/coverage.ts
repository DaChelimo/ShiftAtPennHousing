'use server';

import { requiresCloseNote, type CoverageOutcome } from '@shift/core';
import { revalidatePath } from 'next/cache';

import { canBuildSchedule, getSessionUser } from '../auth';
import { createServiceClient } from '../supabase/server';
import { simNow } from '../time/simClock';

import type { ActionResult } from './builder';

// Allied coverage requests — WRITE paths.
//
// Two thin wrappers over the SECURITY DEFINER RPCs from migration 20260729000010,
// called through the service client (the authorized pattern shared with
// override.ts / inbox.ts). Both pass the SIGNED-IN user as p_user_id and a server
// p_now; the RPC re-checks authorization authoritatively (its own spoof guard plus
// the house gate). The gates below only fail fast for a better message.
//
// ACKNOWLEDGE and CLOSE are deliberately separate operations:
//   acknowledge = "I am handling this."  Stops the escalation ladder.
//   close       = "here is what happened." Requires an outcome.
// A request that is acknowledged but never closed stays visible and goes overdue.
// Collapsing these back into one control is what destroyed the audit trail before.

function friendlyMessage(raw: string): string {
  const msg = raw.trim();
  const MAP: Record<string, string> = {
    not_authorized: 'You are not authorized to action this coverage request.',
    request_not_found: 'That coverage request no longer exists.',
    note_required: 'Add a note explaining what happened before closing this as unstaffed.',
  };
  for (const [reason, friendly] of Object.entries(MAP)) {
    if (msg === reason || msg.includes(reason)) return friendly;
  }
  return msg;
}

// "I am handling this." Stops escalation and reminders on every surface.
export async function acknowledgeCoverageRequest(input: {
  requestId: string;
}): Promise<ActionResult<undefined>> {
  const me = await getSessionUser();
  if (me === null) {
    return { ok: false, error: 'Your session has expired. Sign in again.' };
  }

  const service = createServiceClient();
  const { error } = await service.rpc('acknowledge_allied_coverage_request', {
    p_request_id: input.requestId,
    p_user_id: me.userId,
    p_now: (await simNow()).toISOString(),
  });
  if (error !== null) return { ok: false, error: friendlyMessage(error.message) };

  revalidatePath('/inbox');
  revalidatePath('/admin/coverage');
  return { ok: true, data: undefined };
}

// Close-out. The ONLY way a request leaves the active view.
export async function closeCoverageRequest(input: {
  requestId: string;
  outcome: CoverageOutcome;
  note: string | null;
}): Promise<ActionResult<undefined>> {
  const me = await getSessionUser();
  if (me === null) {
    return { ok: false, error: 'Your session has expired. Sign in again.' };
  }
  if (!canBuildSchedule(me)) {
    return { ok: false, error: 'You are not authorized to close a coverage request.' };
  }
  // Fail before the round trip, but the RPC's note_required guard stays authoritative.
  const note = input.note === null ? null : input.note.trim();
  if (requiresCloseNote(input.outcome) && (note === null || note === '')) {
    return {
      ok: false,
      error: 'Add a note explaining what happened before closing this as unstaffed.',
    };
  }

  const service = createServiceClient();
  const { error } = await service.rpc('close_allied_coverage_request', {
    p_request_id: input.requestId,
    p_user_id: me.userId,
    p_outcome: input.outcome,
    p_note: note ?? '',
    p_now: (await simNow()).toISOString(),
  });
  if (error !== null) return { ok: false, error: friendlyMessage(error.message) };

  revalidatePath('/inbox');
  revalidatePath('/admin/coverage');
  return { ok: true, data: undefined };
}
