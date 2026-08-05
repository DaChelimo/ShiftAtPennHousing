import { createServiceClient } from '../supabase/server';

// Harnwell pilot workstream E — the floaters view read model. Manager surface, same
// gate as the schedule builder (B4); goes through the service client deliberately
// (mirrors the SM builder-snapshot pattern in AGENTS.md) because a Harnwell manager
// must see floats going OUT to any destination house, which is a shape the
// destination-scoped float_assignments RLS policy does not grant.
export type FloaterRow = {
  floatId: string;
  workerName: string;
  destinationHouseId: string;
  destinationHouseName: string;
  startAt: string;
  endAt: string;
  state: 'awaiting_confirmation' | 'confirmed';
};

// Window mirrors Shifts (decision 11): last week through four weeks ahead.
const WINDOW_BEFORE_DAYS = 7;
const WINDOW_AFTER_DAYS = 28;

export async function getManagerFloaters(now: Date): Promise<FloaterRow[]> {
  const service = createServiceClient();
  const windowStart = new Date(now.getTime() - WINDOW_BEFORE_DAYS * 24 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + WINDOW_AFTER_DAYS * 24 * 60 * 60 * 1000);

  const { data: floats, error } = await service
    .from('float_assignments')
    .select('float_id, user_id, status, destination_assignment_ids')
    .eq('initiated_by', 'force_triggered')
    .in('status', ['pending', 'acknowledged']);
  if (error !== null || floats === null || floats.length === 0) return [];

  const allDestinationIds = floats.flatMap((f) => f.destination_assignment_ids as string[]);
  const { data: blocks } = await service
    .from('shift_block_assignments')
    .select('assignment_id, shift_blocks!inner(block_start_at, house_id)')
    .in('assignment_id', allDestinationIds);

  type JoinedBlock = { block_start_at: string; house_id: string };
  const blockByAssignment = new Map<string, JoinedBlock>();
  for (const row of blocks ?? []) {
    const joined = (Array.isArray(row.shift_blocks) ? row.shift_blocks[0] : row.shift_blocks) as
      | JoinedBlock
      | undefined;
    if (joined) blockByAssignment.set(row.assignment_id, joined);
  }

  const userIds = [...new Set(floats.map((f) => f.user_id).filter(Boolean))];
  const houseIds = [...new Set([...blockByAssignment.values()].map((b) => b.house_id))];
  const [{ data: users }, { data: houses }] = await Promise.all([
    userIds.length === 0
      ? Promise.resolve({ data: [] as { user_id: string; name: string }[] })
      : service.from('users').select('user_id, name').in('user_id', userIds),
    houseIds.length === 0
      ? Promise.resolve({ data: [] as { id: string; name: string }[] })
      : service.from('houses').select('id, name').in('id', houseIds),
  ]);
  const userNameById = new Map((users ?? []).map((u) => [u.user_id, u.name]));
  const houseNameById = new Map((houses ?? []).map((h) => [h.id, h.name]));

  const rows: FloaterRow[] = [];
  for (const f of floats) {
    const destBlocks = (f.destination_assignment_ids as string[])
      .map((id) => blockByAssignment.get(id))
      .filter((b): b is JoinedBlock => b !== undefined);
    if (destBlocks.length === 0) continue;

    const starts = destBlocks
      .map((b) => new Date(b.block_start_at).getTime())
      .sort((a, b) => a - b);
    const startAt = new Date(starts[0]!);
    const endAt = new Date(starts[starts.length - 1]! + 30 * 60 * 1000);
    if (endAt < windowStart || startAt > windowEnd) continue;

    const destinationHouseId = destBlocks[0]!.house_id;
    rows.push({
      floatId: f.float_id,
      workerName: userNameById.get(f.user_id) ?? 'Unknown worker',
      destinationHouseId,
      destinationHouseName: houseNameById.get(destinationHouseId) ?? destinationHouseId,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      state: f.status === 'acknowledged' ? 'confirmed' : 'awaiting_confirmation',
    });
  }

  // Sorted start-ascending; awaiting-confirmation grouped ahead of confirmed at the
  // same start time, since an unacknowledged manager float has no terminal
  // escalation and this state indicator is the only signal it may go uncovered (B3).
  rows.sort((a, b) => {
    const byStart = new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
    if (byStart !== 0) return byStart;
    if (a.state === b.state) return 0;
    return a.state === 'awaiting_confirmation' ? -1 : 1;
  });

  return rows;
}
