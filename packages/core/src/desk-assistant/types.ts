// Desk Assistant — shared pure types (V1_SCOPE §6, §7.5).
// Zero Supabase imports. These mirror the DB shapes created in
// supabase/migrations/20260710000001_desk_assistant_foundations.sql.

export type DeskRole = 'sw' | 'sm' | 'hm' | 'bm' | 'rsm' | 'admin';

export type Sensitivity = 'general' | 'internal' | 'restricted';

export type SourceType =
  | 'hm_guide'
  | 'house_binder'
  | 'summer_binder'
  | 'incident_lesson'
  | 'app_guide'
  | 'fixture';

/**
 * The scope tags every retrievable knowledge item carries (V1_SCOPE §6.3).
 * `houseScope === null` is the shared rule corpus (all 13 houses); a non-null,
 * non-empty array is the set of houses the per-house overlay applies to (one or
 * more, never zero). `allowedRoles` empty = every role may read.
 */
export interface ItemScope {
  houseScope: string[] | null;
  sensitivity: Sensitivity;
  allowedRoles: DeskRole[];
}

/**
 * Everything the scope predicate needs about the asking user. Built by the
 * Edge Function from live DB state (roles, home house, admin/rsm flags); the
 * predicate itself stays pure so it is unit-testable and mirrors the SQL
 * `da_can_read_item` placeholder matrix exactly.
 */
export interface RequesterContext {
  userId: string;
  homeHouseId: string;
  /** Every role the user holds (a user may be dual-role). */
  roles: DeskRole[];
  isActive: boolean;
  isAdmin: boolean;
  isRsm: boolean;
  /** House ids where the user is HM or BM (house-admin). */
  houseAdminOf: string[];
}
