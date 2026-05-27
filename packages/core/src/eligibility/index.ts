export type UserRole = 'sw' | 'sm' | 'hm' | 'bm';

export type UserEligibilityProfile = {
  userId: string;
  homeHouseId: string;
  roles: Array<{
    role: UserRole;
    scopeHouseId?: string | null;
    scope_house_id?: string | null;
  }>;
  isActive: boolean;
  broadcastSubscribed: boolean;
  user_id?: string;
  home_house_id?: string;
  is_active?: boolean;
  broadcast_subscribed?: boolean;
};

export type EligibilityResult = { eligible: boolean; reason?: string };

const eligible = (): EligibilityResult => ({ eligible: true, reason: 'eligible' });

const ineligible = (reason: string): EligibilityResult => ({
  eligible: false,
  reason,
});

function roleAppliesToHouse(
  user: UserEligibilityProfile,
  userRole: { role: UserRole; scopeHouseId?: string | null; scope_house_id?: string | null },
  houseId: string,
): boolean {
  const scopeHouseId = userRole.scopeHouseId ?? userRole.scope_house_id ?? null;

  if (scopeHouseId !== null) {
    return scopeHouseId === houseId;
  }

  return getHomeHouseId(user) === houseId;
}

export function hasRole(user: UserEligibilityProfile, role: UserRole, houseId?: string): boolean {
  return user.roles.some((userRole) => {
    const roleMatches =
      userRole.role === role ||
      (role === 'sw' && (userRole.role === 'sm' || userRole.role === 'hm')) ||
      (role === 'sm' && userRole.role === 'hm');

    if (!roleMatches) {
      return false;
    }

    return houseId === undefined || roleAppliesToHouse(user, userRole, houseId);
  });
}

function hasAnyWorkerRole(user: UserEligibilityProfile): boolean {
  return hasRole(user, 'sw') || hasRole(user, 'sm') || hasRole(user, 'hm');
}

function getIsActive(user: UserEligibilityProfile): boolean {
  return user.isActive ?? user.is_active ?? false;
}

function getHomeHouseId(user: UserEligibilityProfile): string {
  return user.homeHouseId ?? user.home_house_id ?? '';
}

function inactiveResult(user: UserEligibilityProfile): EligibilityResult | null {
  return getIsActive(user) ? null : ineligible('user_inactive');
}

export function isEligibleForFloatLookup(user: UserEligibilityProfile): EligibilityResult {
  const inactive = inactiveResult(user);
  if (inactive !== null) {
    return inactive;
  }

  if (hasRole(user, 'hm')) {
    return ineligible('hm_excluded_from_float_lookup');
  }

  if (hasRole(user, 'bm')) {
    return ineligible('bm_excluded_from_worker_pipelines');
  }

  return hasAnyWorkerRole(user) ? eligible() : ineligible('missing_worker_role');
}

export function isEligibleForBroadcast(user: UserEligibilityProfile): EligibilityResult {
  const inactive = inactiveResult(user);
  if (inactive !== null) {
    return inactive;
  }

  if (hasRole(user, 'hm')) {
    return ineligible('hm_excluded_from_broadcast');
  }

  if (hasRole(user, 'bm')) {
    return ineligible('bm_excluded_from_broadcast');
  }

  return hasAnyWorkerRole(user) ? eligible() : ineligible('missing_worker_role');
}

export function isEligibleForClaimPool(user: UserEligibilityProfile): EligibilityResult {
  const inactive = inactiveResult(user);
  if (inactive !== null) {
    return inactive;
  }

  if (hasRole(user, 'bm')) {
    return ineligible('bm_excluded_from_claim_pool');
  }

  return hasAnyWorkerRole(user) ? eligible() : ineligible('missing_worker_role');
}

export function isEligibleForSwapCounterparty(user: UserEligibilityProfile): EligibilityResult {
  const inactive = inactiveResult(user);
  if (inactive !== null) {
    return inactive;
  }

  if (hasRole(user, 'hm')) {
    return ineligible('hm_excluded_from_swap_counterparties');
  }

  if (hasRole(user, 'bm')) {
    return ineligible('bm_excluded_from_worker_pipelines');
  }

  return hasAnyWorkerRole(user) ? eligible() : ineligible('missing_worker_role');
}

export function isEligibleForScheduleRoster(user: UserEligibilityProfile): EligibilityResult {
  const inactive = inactiveResult(user);
  if (inactive !== null) {
    return inactive;
  }

  if (hasRole(user, 'bm')) {
    return ineligible('bm_excluded_from_schedule_roster');
  }

  return hasAnyWorkerRole(user) ? eligible() : ineligible('missing_worker_role');
}
