import { listEligibleCrossHouseDestinations } from '../scheduling/crossHousePickup.js';

export {
  isEligibleForCrossHousePickup,
  listEligibleCrossHouseDestinations,
} from '../scheduling/crossHousePickup.js';

export function getCrossHouseEligibility(homeHouseId: string, allHouseIds: string[]): string[] {
  return listEligibleCrossHouseDestinations(homeHouseId, allHouseIds);
}
