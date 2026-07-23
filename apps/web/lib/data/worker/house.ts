import { createClient, createServiceClient } from '../../supabase/server';
import type { CalendarModel, CalShift } from '../calendar';
import { defaultCalendarWeek, getHouseCalendar } from '../calendar';

// ===========================================================================
// Worker House calendar (BSpec §11.4) — READ ONLY week grid, same visual
// language as the admin Live Calendar (components/calendar/HouseCalendar.tsx +
// Grid.tsx). Any authenticated worker may view any (live) house's schedule.
//
// getWorkerHouseCalendar reuses getHouseCalendar's full day/lane/shift
// derivation (it's the same underlying schedule), then STRIPS the fields that
// exist only to feed the admin reassignment panel — assignableWorkers (roster +
// weekly hours) and softCapHours/capEnforcement — plus each shift's
// workerPhone. Those never reach the client component's serialized props, so a
// worker's browser payload can't leak another worker's phone number or hours.
// ===========================================================================

export type HouseOption = { id: string; name: string };

export type WorkerCalShift = Omit<CalShift, 'workerPhone'>;

export type WorkerCalendarModel = Omit<
  CalendarModel,
  'assignableWorkers' | 'softCapHours' | 'capEnforcement' | 'shifts'
> & {
  shifts: WorkerCalShift[];
};

function stripShift(s: CalShift): WorkerCalShift {
  return {
    id: s.id,
    dayIndex: s.dayIndex,
    lane: s.lane,
    startBlock: s.startBlock,
    endBlock: s.endBlock,
    state: s.state,
    userId: s.userId,
    workerName: s.workerName,
    workerRole: s.workerRole,
    homeHouse: s.homeHouse,
    escalationStep: s.escalationStep,
    blockIds: s.blockIds,
    startAtIso: s.startAtIso,
    dateKey: s.dateKey,
  };
}

function stripModel(model: CalendarModel): WorkerCalendarModel {
  return {
    houseId: model.houseId,
    houseName: model.houseName,
    restricted: model.restricted,
    weekStartDate: model.weekStartDate,
    isPast: model.isPast,
    isFuture: model.isFuture,
    days: model.days,
    lanes: model.lanes,
    minLanes: model.minLanes,
    shifts: model.shifts.map(stripShift),
    hasBlocks: model.hasBlocks,
    dayStartMin: model.dayStartMin,
    blocksPerDay: model.blocksPerDay,
  };
}

// Worker cross-house switcher only lists LIVE houses (staggered-launch gate);
// worker_visible_houses applies house_is_live() so dark houses stay hidden.
export async function listVisibleHouses(): Promise<HouseOption[]> {
  const supabase = await createClient();
  const { data } = await supabase.from('worker_visible_houses').select('id, name').order('name');
  return (data ?? []) as HouseOption[];
}

export function resolveWorkerHouse(
  houses: HouseOption[],
  requestedHouseId: string | null,
  homeHouseId: string,
): string {
  return requestedHouseId !== null && houses.some((h) => h.id === requestedHouseId)
    ? requestedHouseId
    : homeHouseId;
}

export async function getDeskPhone(houseId: string): Promise<string | null> {
  const service = createServiceClient();
  const { data } = await service
    .from('houses')
    .select('desk_phone')
    .eq('id', houseId)
    .maybeSingle();
  return data?.desk_phone ?? null;
}

export async function getWorkerHouseCalendar(
  houseId: string,
  weekStartDate: string,
  now: Date,
): Promise<WorkerCalendarModel> {
  const model = await getHouseCalendar(houseId, weekStartDate, now);
  return stripModel(model);
}

export { defaultCalendarWeek };
