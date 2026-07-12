'use server';

import { revalidatePath } from 'next/cache';

import { getSessionUser } from '../../auth';

import { callEdge } from './edge';

// Swap write actions (BSpec §8). Accept / reject / void an existing swap, and propose a
// one-way hand-off (give-only) of the worker's own shift to a counterparty. All route
// through the shared swap Edge Functions, which re-validate ownership, eligibility, the
// hours cap, and peer consent authoritatively.

export type SwapActionResult = { ok: true } | { ok: false; error: string };

function revalidateSwaps(): void {
  revalidatePath('/home/swaps');
  revalidatePath('/home/shifts');
  revalidatePath('/home');
}

// accept-swap only needs the swap_id; the server expands a permanent swap's affected seats.
export async function acceptSwap(swapId: string): Promise<SwapActionResult> {
  const me = await getSessionUser();
  if (me === null) return { ok: false, error: 'Your session has expired. Sign in again.' };
  const res = await callEdge('accept-swap', { swap_id: swapId });
  if (!res.ok) return { ok: false, error: res.error };
  revalidateSwaps();
  return { ok: true };
}

export async function rejectSwap(swapId: string): Promise<SwapActionResult> {
  const me = await getSessionUser();
  if (me === null) return { ok: false, error: 'Your session has expired. Sign in again.' };
  const res = await callEdge('reject-swap', { swap_id: swapId });
  if (!res.ok) return { ok: false, error: res.error };
  revalidateSwaps();
  return { ok: true };
}

export async function voidSwap(swapId: string): Promise<SwapActionResult> {
  const me = await getSessionUser();
  if (me === null) return { ok: false, error: 'Your session has expired. Sign in again.' };
  const res = await callEdge('void-swap', { swap_id: swapId });
  if (!res.ok) return { ok: false, error: res.error };
  revalidateSwaps();
  return { ok: true };
}

// A hand-off: give a shift to a counterparty, receiving nothing back (§8.5 one-sided). The
// worker's span is the initiator side; the counterparty side is empty.
export async function createHandoff(
  counterpartyUserId: string,
  assignmentIds: string[],
): Promise<SwapActionResult> {
  const me = await getSessionUser();
  if (me === null) return { ok: false, error: 'Your session has expired. Sign in again.' };
  if (assignmentIds.length === 0) return { ok: false, error: 'Choose a shift to hand off.' };

  const res = await callEdge('create-swap', {
    swap_type: 'handoff',
    counterparty_user_id: counterpartyUserId,
    initiator_assignment_ids: assignmentIds,
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidateSwaps();
  return { ok: true };
}
