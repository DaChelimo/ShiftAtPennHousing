import { createClient } from '../supabase/server';

export type MyShift = {
  assignmentId: string;
  houseId: string;
  startAtIso: string;
  label: string; // NY wall-clock, e.g. "Mon Feb 2, 10:00"
  time: string; // NY wall-clock HH:mm, e.g. "10:00"
};

const NY = 'America/New_York';

function nyTime(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

function nyLabel(iso: string): string {
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(iso));
  return `${date}, ${nyTime(iso)}`;
}

// The signed-in worker's own assignments. RLS (own-assignment select policy,
// phase-03 note) scopes rows to the authed user; only published periods surface
// assignments to workers (§4.3 Phase 3), which is enforced by the publish step
// having written these rows in the first place.
export async function getMyShifts(userId: string): Promise<MyShift[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('shift_block_assignments')
    .select('assignment_id, block_id, status, shift_blocks!inner(house_id, block_start_at)')
    .eq('user_id', userId)
    .in('status', ['scheduled', 'claimed', 'floated_in', 'allied']);

  type Row = {
    assignment_id: string;
    shift_blocks: { house_id: string; block_start_at: string } | null;
  };

  return ((data ?? []) as unknown as Row[])
    .filter(
      (row): row is Row & { shift_blocks: NonNullable<Row['shift_blocks']> } =>
        row.shift_blocks !== null,
    )
    .map((row) => ({
      assignmentId: row.assignment_id,
      houseId: row.shift_blocks.house_id,
      startAtIso: row.shift_blocks.block_start_at,
      label: nyLabel(row.shift_blocks.block_start_at),
      time: nyTime(row.shift_blocks.block_start_at),
    }))
    .sort((a, b) => a.startAtIso.localeCompare(b.startAtIso));
}
