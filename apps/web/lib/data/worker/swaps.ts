import {
  buildSwapsFeed,
  coalesceMyShifts,
  type MyShiftBlock,
  type MyShiftKind,
  type PendingSwap,
  type SwapsFeed,
} from '@shift/core';

import { createClient } from '../../supabase/server';

const NY = 'America/New_York';
const HANDOFF_WINDOW_DAYS = 21;

// ===========================================================================
// Worker "Swaps" — READ model (the review surface + compose directory).
//
// worker_pending_swaps() returns both directions (incoming = I'm the counterparty,
// outgoing = I'm the initiator) with each side's span + physical house. @shift/core's
// buildSwapsFeed turns that into decision-ready rows: hours given, hours gained, the
// physical desk of each side, a live countdown, and one-way-transfer reframing.
//
// worker_directory is the compose counterparty list (any active worker, self excluded).
// ===========================================================================

export type DirectoryEntry = {
  userId: string;
  name: string;
  homeHouseId: string;
};

export type MyShiftOption = {
  assignmentIds: string[];
  label: string;
  houseName: string;
};

export type SwapsBoard = {
  feed: SwapsFeed;
  directory: DirectoryEntry[];
  handoffable: MyShiftOption[];
};

type SwapWire = {
  swap_id: string;
  swap_type: string;
  direction: string;
  status: string;
  created_at: string;
  expires_at: string;
  other_user_id: string | null;
  other_user_name: string | null;
  initiator_assignment_ids: string[] | null;
  counterparty_assignment_ids: string[] | null;
  initiator_start: string | null;
  initiator_end: string | null;
  initiator_blocks: number | null;
  initiator_house_name: string | null;
  counterparty_start: string | null;
  counterparty_end: string | null;
  counterparty_blocks: number | null;
  counterparty_house_name: string | null;
};

function toPendingSwap(r: SwapWire): PendingSwap {
  return {
    swapId: r.swap_id,
    swapType: r.swap_type,
    direction: r.direction === 'outgoing' ? 'outgoing' : 'incoming',
    status: r.status,
    createdAt: new Date(r.created_at),
    expiresAt: new Date(r.expires_at),
    otherUserId: r.other_user_id,
    otherUserName: r.other_user_name ?? 'A worker',
    initiatorAssignmentIds: r.initiator_assignment_ids ?? [],
    counterpartyAssignmentIds: r.counterparty_assignment_ids ?? [],
    initiatorStart: r.initiator_start === null ? null : new Date(r.initiator_start),
    initiatorEnd: r.initiator_end === null ? null : new Date(r.initiator_end),
    initiatorBlocks: r.initiator_blocks ?? 0,
    initiatorHouseName: r.initiator_house_name,
    counterpartyStart: r.counterparty_start === null ? null : new Date(r.counterparty_start),
    counterpartyEnd: r.counterparty_end === null ? null : new Date(r.counterparty_end),
    counterpartyBlocks: r.counterparty_blocks ?? 0,
    counterpartyHouseName: r.counterparty_house_name,
  };
}

type MyShiftWire = {
  id: string;
  house_id: string;
  house_name: string;
  start_at: string;
  end_at: string;
  kind: string;
  cross_house: boolean;
  pending: boolean;
  break_shift: boolean;
  dropped_still_open: boolean;
};

// The worker's own upcoming shifts they can hand off (own present shifts, not floating out
// or already dropped), coalesced into one option per displayed shift.
async function loadHandoffable(userId: string, now: Date): Promise<MyShiftOption[]> {
  const supabase = await createClient();
  const windowEnd = new Date(now.getTime() + HANDOFF_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const { data: rows } = await supabase
    .from('worker_my_shifts')
    .select(
      'id, house_id, house_name, start_at, end_at, kind, cross_house, pending, break_shift, dropped_still_open',
    )
    .eq('user_id', userId)
    .eq('dropped_still_open', false)
    .gte('start_at', now.toISOString())
    .lt('start_at', windowEnd.toISOString())
    .order('start_at', { ascending: true });

  const blocks: MyShiftBlock[] = ((rows ?? []) as MyShiftWire[])
    .filter((r) => r.kind === 'scheduled' || r.kind === 'temp_pickup')
    .map((r) => ({
      id: r.id,
      houseId: r.house_id,
      houseName: r.house_name,
      start: new Date(r.start_at),
      end: new Date(r.end_at),
      kind: r.kind as MyShiftKind,
      crossHouse: r.cross_house,
      pending: r.pending,
      breakShift: r.break_shift,
      droppedStillOpen: r.dropped_still_open,
    }));

  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const timeFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return coalesceMyShifts(blocks).map((c) => ({
    assignmentIds: c.blockIds,
    label: `${fmt.format(c.start)} - ${timeFmt.format(c.end)}`,
    houseName: c.houseName,
  }));
}

export async function getSwapsBoard(userId: string, now: Date): Promise<SwapsBoard> {
  const supabase = await createClient();

  const [{ data: swapRows }, { data: dirRows }, handoffable] = await Promise.all([
    supabase.rpc('worker_pending_swaps'),
    supabase.from('worker_directory').select('user_id, name, home_house_id').eq('is_active', true),
    loadHandoffable(userId, now),
  ]);

  const feed = buildSwapsFeed(((swapRows ?? []) as SwapWire[]).map(toPendingSwap), now);

  const directory: DirectoryEntry[] = (
    (dirRows ?? []) as { user_id: string; name: string; home_house_id: string }[]
  )
    .filter((d) => d.user_id !== userId)
    .map((d) => ({ userId: d.user_id, name: d.name, homeHouseId: d.home_house_id }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { feed, directory, handoffable };
}
