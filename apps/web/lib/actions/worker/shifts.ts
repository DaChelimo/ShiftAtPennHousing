'use server';

import { revalidatePath } from 'next/cache';

import { getSessionUser } from '../../auth';

import { callEdge } from './edge';

// Worker shift write actions (drop / claim / permanent ops). Thin glue over the shared
// Edge Functions the mobile app calls: the EF derives the actor from the bearer token and
// re-validates authoritatively (coverage lock, Harnwell training, hours cap), so these add
// no trust. Each returns a discriminated result and revalidates the affected surfaces.

export type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string };

// -------------------------------------------------------------------------
// Temporary drop (§5.2). `blockIds` are the assignment_ids of the (sub)range to drop; a
// dropped seat returns to the open feed (no self-reclaim), per spec.
// -------------------------------------------------------------------------
export async function dropShift(blockIds: string[]): Promise<ActionResult> {
  const me = await getSessionUser();
  if (me === null) return { ok: false, error: 'Your session has expired. Sign in again.' };
  if (blockIds.length === 0) return { ok: false, error: 'Select at least one block to drop.' };

  const res = await callEdge('drop-shift', {
    assignment_ids: blockIds,
    drop_type: 'temporary',
  });
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePath('/home/shifts');
  revalidatePath('/home/open');
  return { ok: true };
}

// -------------------------------------------------------------------------
// Temporary claim (§5.3). Claims one open seat by its assignment_id.
// -------------------------------------------------------------------------
export type ClaimOutcome = { ok: true; claimedId: string } | { ok: false; error: string };

export async function claimShift(assignmentId: string): Promise<ClaimOutcome> {
  const me = await getSessionUser();
  if (me === null) return { ok: false, error: 'Your session has expired. Sign in again.' };

  const res = await callEdge<{ assignment_id?: string }>('claim-shift', {
    assignment_id: assignmentId,
    claim_type: 'temporary',
  });
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePath('/home/open');
  revalidatePath('/home/shifts');
  return { ok: true, claimedId: res.data.assignment_id ?? assignmentId };
}

// -------------------------------------------------------------------------
// Permanent ops (§5.1). A permanent drop gives up a recurring slot for the rest of the
// semester; a permanent pickup takes one from the open feed. Both are addressed by the
// recurring SLOT (house + NY weekday + local block times), not an absolute date — the RPC
// re-derives every future occurrence server-side (invariant #6).
// -------------------------------------------------------------------------
export type PermanentSlotInput = {
  houseId: string;
  dayOfWeek: number; // 0=Sun..6=Sat (NY)
  blockStartLocals: string[]; // "HH:MM" on 30-minute boundaries
};

export async function permanentDrop(slot: PermanentSlotInput): Promise<ActionResult> {
  const me = await getSessionUser();
  if (me === null) return { ok: false, error: 'Your session has expired. Sign in again.' };
  if (slot.blockStartLocals.length === 0) {
    return { ok: false, error: 'Select at least one block to drop.' };
  }

  const res = await callEdge('permanent-drop', {
    house_id: slot.houseId,
    day_of_week: slot.dayOfWeek,
    block_start_locals: slot.blockStartLocals,
  });
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePath('/home/shifts');
  revalidatePath('/home/open');
  return { ok: true };
}

export type PermanentPickupResult =
  | { ok: true; data: { weeksPickedUp: number; totalWeeks: number; weeksSkipped: number } }
  | { ok: false; error: string };

// permanent-pickup returns the RPC block counts plus a `scope` with per-week stats
// (evaluatePermanentPickup). The worker-facing toast is in WEEKS.
type PickupWire = {
  scope?: {
    totalWeeksInScope?: number;
    weeksFullyAssigned?: number;
    weeksPartiallyAssigned?: number;
    weeksSkipped?: number;
  };
};

export async function permanentPickup(slot: PermanentSlotInput): Promise<PermanentPickupResult> {
  const me = await getSessionUser();
  if (me === null) return { ok: false, error: 'Your session has expired. Sign in again.' };
  if (slot.blockStartLocals.length === 0) {
    return { ok: false, error: 'This opening has no blocks to pick up.' };
  }

  const res = await callEdge<PickupWire>('permanent-pickup', {
    house_id: slot.houseId,
    day_of_week: slot.dayOfWeek,
    block_start_locals: slot.blockStartLocals,
  });
  if (!res.ok) return { ok: false, error: res.error };

  const scope = res.data.scope ?? {};
  revalidatePath('/home/open');
  revalidatePath('/home/shifts');
  return {
    ok: true,
    data: {
      weeksPickedUp: (scope.weeksFullyAssigned ?? 0) + (scope.weeksPartiallyAssigned ?? 0),
      totalWeeks: scope.totalWeeksInScope ?? 0,
      weeksSkipped: scope.weeksSkipped ?? 0,
    },
  };
}
