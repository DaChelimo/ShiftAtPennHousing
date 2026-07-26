// Desk Assistant — role/house/sensitivity scope predicate (V1_SCOPE §6.3, §10.5).
//
// This is the PLACEHOLDER scoping matrix seam. It is the TypeScript mirror of the
// SQL function `da_can_read_item` in
// supabase/migrations/20260710000001_desk_assistant_foundations.sql. The two MUST
// stay in lockstep: retrieval filters candidate chunks with `canReadItem` here,
// and RLS gates direct reads with the SQL function. When the real scoping matrix
// (V1_SCOPE §10.5) arrives, both change together against the shared truth table in
// tests/desk-assistant/scope.test.ts.

import type { ItemScope, RequesterContext } from './types.js';

/**
 * True iff `requester` may retrieve an item with the given `scope`.
 *
 * Placeholder matrix (mirrors da_can_read_item):
 *  - house gate: shared corpus (null) is universal; an overlay is readable by the
 *    home-house worker, that house's HM/BM, any RSM (cross-house read), or admin.
 *  - sensitivity gate: general = all; internal = any active user; restricted =
 *    admin or any HM/BM.
 *  - role gate: empty allowedRoles = every role; otherwise the user must hold one.
 */
export function canReadItem(requester: RequesterContext, scope: ItemScope): boolean {
  return houseOk(requester, scope) && sensitivityOk(requester, scope) && roleOk(requester, scope);
}

function houseOk(requester: RequesterContext, scope: ItemScope): boolean {
  if (scope.houseScope === null) return true;
  return (
    scope.houseScope.includes(requester.homeHouseId) ||
    scope.houseScope.some((h) => requester.houseAdminOf.includes(h)) ||
    requester.isRsm ||
    requester.isAdmin
  );
}

function sensitivityOk(requester: RequesterContext, scope: ItemScope): boolean {
  switch (scope.sensitivity) {
    case 'general':
      return true;
    case 'internal':
      return requester.isActive;
    case 'restricted':
      return requester.isAdmin || requester.roles.includes('hm') || requester.roles.includes('bm');
    default:
      return false;
  }
}

function roleOk(requester: RequesterContext, scope: ItemScope): boolean {
  if (scope.allowedRoles.length === 0) return true;
  return scope.allowedRoles.some((r) => requester.roles.includes(r));
}

/** Retain only the items `requester` may read. Used by the retrieval EF. */
export function filterReadable<T extends { scope: ItemScope }>(
  requester: RequesterContext,
  items: readonly T[],
): T[] {
  return items.filter((item) => canReadItem(requester, item.scope));
}
