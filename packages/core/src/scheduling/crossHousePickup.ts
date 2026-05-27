export type HouseId = 'harnwell' | 'quad' | string;

export type CrossHouseEligibilityResult =
  | { eligible: true; reason?: 'in_house' | 'eligible' }
  | { eligible: false; reason: 'harnwell_training_required' };

const HARNWELL = 'harnwell';

export function isEligibleForCrossHousePickup(
  homeHouseId: HouseId,
  destinationHouseId: HouseId,
): CrossHouseEligibilityResult {
  if (homeHouseId === destinationHouseId) {
    return { eligible: true, reason: 'in_house' };
  }

  if (destinationHouseId === HARNWELL && homeHouseId !== HARNWELL) {
    return { eligible: false, reason: 'harnwell_training_required' };
  }

  return { eligible: true, reason: 'eligible' };
}

export function listEligibleCrossHouseDestinations(
  homeHouseId: HouseId,
  allHouseIds: HouseId[],
): HouseId[] {
  return allHouseIds.filter(
    (destinationHouseId) =>
      destinationHouseId !== homeHouseId &&
      isEligibleForCrossHousePickup(homeHouseId, destinationHouseId).eligible,
  );
}
