'use server';

import {
  summarizeForceTrigger,
  type ForceTriggerResponse,
  type ForceTriggerSummary,
} from '@shift/core';
import { revalidatePath } from 'next/cache';

import { adminHouseId, canBuildSchedule, getSessionUser } from '../auth';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../env';
import { createClient } from '../supabase/server';

import type { ActionResult } from './builder';

export type { ForceTriggerSummary } from '@shift/core';

// A readable error message per outcome the UI should NOT treat as a result.
const REJECTION_MESSAGE: Record<string, string> = {
  unauthorized_initiator: 'You are not authorized to force-trigger a float for this house.',
  block_not_vacant: 'One or more of these blocks is no longer vacant.',
  block_has_pending_float_in: 'A float is already pending for one of these blocks.',
  within_two_hours: 'Too close to the shift — the automated float lookup already fires within 2h.',
  empty_block_set: 'No blocks were selected for the force-trigger.',
};

// §6.6 — force-trigger the float lookup for a KNOWN coverage gap before the
// automated chain would fire. The whole job (validate → findFloaters →
// force_trigger_float per floater → HMOD-for-Allied per uncovered block) lives in
// the `force-trigger` Edge Function (ARCH §6); this action is the thin web glue.
//
// The EF derives the initiator from the bearer token (the service-role key will
// NOT work), so we forward the signed-in user's session access token. We still
// gate locally (canBuildSchedule + house match) as defense-in-depth — the EF
// re-validates authoritatively.
//
// No-takeback (AGENTS invariant #3): there is intentionally no revoke path. On
// any non-error outcome (incl. the winter-break `gated` note) we revalidate the
// coverage board so a resulting pending float is reflected; the summary is
// returned so the UI can render the outcome.
export async function forceTriggerFloat(input: {
  houseId: string;
  blockIds: string[];
}): Promise<ActionResult<ForceTriggerSummary>> {
  const me = await getSessionUser();
  if (!canBuildSchedule(me)) {
    return { ok: false, error: 'Not authorized to force-trigger a float.' };
  }
  if (input.houseId !== adminHouseId(me!)) {
    return { ok: false, error: 'You can only force-trigger a float for your own house.' };
  }
  if (input.blockIds.length === 0) {
    return { ok: false, error: 'No blocks were selected for the force-trigger.' };
  }

  // The EF identifies the initiator from this token — never the service-role key.
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (token === undefined) {
    return { ok: false, error: 'Your session has expired — sign in again.' };
  }

  let parsed: ForceTriggerResponse;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/force-trigger/force-trigger`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        destination_house_id: input.houseId,
        block_ids: input.blockIds,
      }),
    });
    parsed = (await res.json()) as ForceTriggerResponse;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not reach the force-trigger service.',
    };
  }

  const summary = summarizeForceTrigger(parsed);

  // A hard failure, or an unauthorized rejection, is surfaced as an error (no
  // board refresh). Other rejections (e.g. block_not_vacant) are likewise errors
  // — the gap state changed under the operator; the board should be refreshed so
  // they see why, so revalidate then return the readable reason.
  if (summary.kind === 'failed') {
    return { ok: false, error: 'The force-trigger could not be completed. Please try again.' };
  }
  if (summary.kind === 'rejected') {
    const message =
      (summary.reason && REJECTION_MESSAGE[summary.reason]) ??
      'The force-trigger was rejected for this gap.';
    if (summary.reason !== 'unauthorized_initiator') {
      // The gap state moved on (taken / already pending) — refresh the board.
      revalidatePath('/coverage');
    }
    return { ok: false, error: message };
  }

  // floated / allied / mixed / gated — a defined outcome. Refresh the board so a
  // resulting pending float (or the unchanged winter-break state) is reflected.
  revalidatePath('/coverage');
  return { ok: true, data: summary };
}
