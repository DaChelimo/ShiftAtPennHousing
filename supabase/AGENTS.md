# supabase/ — Database Layer

Loaded when you work under `supabase/`. Assumes you have read the root `AGENTS.md`.

A large share of this system's business rules live in SQL, not TypeScript. Migrations,
triggers, and RLS policies are the enforcement layer; treat them as production code.

## Rules

- Migrations are pure SQL in `migrations/YYYYMMDDHHMMSS_description.sql`. Reversible where
  possible, idempotent on re-application. Never edit a migration that has been applied
  anywhere; write a new one.
- **Every new table gets RLS policies in the same migration that creates it.** Service role
  bypasses all RLS (for Edge Functions and the orchestrator).
- After any migration:
  `supabase gen types typescript --local > packages/shared/src/database.types.ts`
  Then rebuild `@shift/shared`, or web builds fail on stale types.
- pgTAP tests live in `tests/`. **RLS-reading pgTAP passes only under `supabase test db`,
  not raw `psql`** (the raw path lacks the role grants). Requires `CREATE EXTENSION pgtap`.
- Before writing a migration, inspect the live schema with the Supabase MCP rather than
  assuming. Never point the MCP at production.
- **`REVOKE ... FROM PUBLIC` does not lock down a `SECURITY DEFINER` function.** Supabase
  grants `EXECUTE` to `anon`/`authenticated`/`service_role` as explicit per-role grants at
  CREATE time via `ALTER DEFAULT PRIVILEGES`, and those survive a `PUBLIC` revoke untouched.
  A function meant to be service-role-only needs `REVOKE EXECUTE ON FUNCTION <fn> FROM anon,
authenticated;` naming those roles explicitly, in the same migration that creates or
  changes it. This bit the project once already: ~40 definers were still callable by any
  signed-in (or even anonymous) user well after their `REVOKE FROM PUBLIC` had shipped. If a
  function only calls a wrapper for an advisory lock or similar, check the **inner**
  function's grants too, not just the wrapper's — revoking the wrapper while leaving an
  `_unguarded` inner function client-reachable is not a fix. A pgTAP grant assertion must
  name `anon` and `authenticated` explicitly (`has_function_privilege('public', ...)` alone
  passes while both still hold `EXECUTE`, which is exactly how this stayed invisible for
  months). Verify grants against the **live catalog**, not by grepping migrations for
  `REVOKE` — a later migration may revoke what an earlier one granted, or vice versa. See
  `scripts/security/attack-surface.sh` (sections `definers`, `noauthz`, `granttests`) and the
  `security-auditor` subagent / `/security-audit` skill.

## Houses

The 13 real ids: `harnwell`, `quad` (Upper Quad), `lower-quad`, `gregory` (Van Pelt /
Gregory), `harrison`, `hill`, `kings-court` (Kings Court English), `lauder`, `mayer`,
`du-bois`, `gutmann`, `radian`, `rodin`. Placeholder ids `house-03..house-13` are gone.

`harnwell` and `quad` are **load-bearing**: hardcoded in ~10 migrations plus core float/swap
logic (the Harnwell training constraint, Quad float precedence). Never rename. The other 11
appear only in seeds and tests and are safe data.

Default headcount is 1 per house; Harnwell is 2 and Quad is 3, and both carry special rules
throughout.

## Time and block generation

- **DST-correct generation:** iterate by adding `interval '30 minutes'` to a NY-anchored
  `timestamptz`. Do **not** enumerate wall-clock minutes and convert; the spring-forward gap
  collapses into a UNIQUE collision and fall-back ambiguous times resolve to one offset, so
  blocks are silently dropped on DST days. Correct pattern:
  `(target_date::timestamp + make_interval(mins => start_minute)) AT TIME ZONE 'America/New_York'`
  for the band start, then `band_start_at + n * interval '30 minutes'` per block. See
  `migrations/20260527000004_*.sql`.
- `operating_profiles.shift_end_bound = '00:00'` means **24:00 of the input date**, not
  00:00 of the same day. Cast as `input_date + INTERVAL '24 hours'` before iterating; a naive
  literal reading yields zero blocks.
- The generator reads bands from `staffing_patterns` and does **not** cross-check them
  against `operating_profiles` bounds. Misconfigured staffing rows generate out-of-band
  blocks; bound enforcement is an admin-tooling concern, not a generator concern.
- `staffing_patterns` stores compressed jsonb ranges that the application expands at read
  time.

## Authorization predicates — do not collapse them

Four distinct helpers with deliberately different scopes:

| Helper                      | Who                                                 | Scope                                                            |
| --------------------------- | --------------------------------------------------- | ---------------------------------------------------------------- |
| `user_has_house_admin_role` | hm / bm / rsm, plus unconditional `user_is_admin()` | **Own house** for hm/bm/rsm. People admin, HM leave, weekly cap. |
| `user_can_build_schedule`   | `user_is_schedule_admin` OR sm scoped to house      | Schedule building, inbound-float visibility.                     |
| `user_is_schedule_admin`    | hm / bm / rsm anywhere                              | **Cross-house schedule write.**                                  |
| `user_is_rsm`               | rsm anywhere                                        | Additive cross-house READ clause on assignment/float selects.    |

Three invariants:

1. **People admin stays own-house** for hm/bm/rsm. Do not widen that branch. The top-level
   `admin` role is the one exception, via the unconditional `user_is_admin()` OR clause.
2. **SM never gains cross-house power.** The sm branch of `user_can_build_schedule` stays
   `scope_house_id = house`.
3. **Inbound-float visibility is sm/hm/bm, not hm/bm.** The destination house's SM sees
   inbound floats and the live house schedule, so `float_assignments`, `float_exclusions`,
   and `shift_block_assignments` SELECT policies use `user_can_build_schedule`.

`shift_block_assignments` needs **three** OR-ed select policies: own-assignment
(`user_id = auth.uid()`), home-house, and house-admin. The own-assignment clause is
load-bearing for personal-calendar visibility of float-out and cross-house-pickup rows, which
attach to non-home-house blocks and would otherwise be invisible.

## RSM role

`rsm` is HM-minus-HMOD. It is scope-required like sm/hm/bm and joins both
`user_has_house_admin_role` and `user_can_build_schedule`.

**`rsm` is never HMOD-eligible.** Do not add it to `hmod_rotor` population
(`apps/web/lib/data/rotor.ts` stays `['hm','bm']`), `resolve_hmod_on_duty`, or the leave
HMOD-transfer path.

In-hours Allied and no-ack notifications route to the **RSM, not the HM**:
`process_hmod_notify_allied_step` and `process_no_ack_float` call `resolve_rsm_for_house` in
the `is_hm_working_time` branch, falling back to `resolve_hmod_on_duty`. RSM holds shifts like
an HM (claim pool, builder roster) and is excluded from float lookup, broadcast, and
swap-counterparty.

## Floats

- `float_assignments.source_assignment_ids` / `destination_assignment_ids` are `uuid[]`
  validated by an INSERT/UPDATE trigger, since Postgres cannot FK array elements. The reverse
  direction, `shift_block_assignments.parent_float_id` → `float_assignments`, **is** a true
  deferrable FK with ON DELETE SET NULL. Populate both sides in the same transaction.
- **Two hardcoded float guards, never trusted from config:** a source desk never drops below
  one present worker, and **Harnwell is never a float destination** (short-circuit in the
  algorithm plus the `float_routing` legality trigger, `20260702000005`). Harnwell _may_
  source. Summer routing is universal and auto-generated by the compiler; there is no
  per-season routing table and no routing UI.
- **Both** float-assignment paths must snapshot the ack-reminder cadence. The logic lives in
  one helper, `snapshot_float_ack_reminders` (`20260601000002`), called by
  `process_float_lookup_assignment` **and** `force_trigger_float`. Do not re-inline it; the
  force-trigger path originally omitted it. A NULL `reminder_6h_offset` / `reminder_2h_offset`
  means the system default (-6h / -2h), **not** suppression; suppression is the separate
  `reminder_6h_enabled` / `reminder_2h_enabled = false` flag.

## Coverage lock

A vacant seat locks at T-2h **only when its desk would otherwise be empty** at that block. A
desk with a real worker present is never locked and stays claimable until `block_start_at`.

Two present-sets, **do not collapse them**:

- **Escalation** counts `allied` as present (stop escalating a desk Allied covers).
- **The pickup lock** does not (a secured-Allied window stays locked, never reopened). Its
  real-worker exemption is `{scheduled, claimed, floated_in, pending_float_in}`.

The lock is **one-way per block**: once an empty desk hits its T-2h step, its seats stay
locked even after a floater or Allied fills the desk. Recorded via
`shift_blocks.coverage_locked_at`, set at the `float_lookup` / `hmod_notify_allied` step, not
at `broadcast` (T-3h is still claimable). Claimability is server-authoritative and exposed on
the open-shifts read path; clients must consume it, never re-derive T-2h.

## Operating seasons

Admin authors the **authoring** tables (`operating_seasons`, `season_house_windows`,
`season_float_windows`, `operating_config_audit`; `20260702000003`, admin-only RLS). A pure
TS compiler derives phases, then `apply_compiled_season` (`20260702000006`) materializes them
into the four runtime config tables and reconciles **future blocks only**
(`block_start_at > app_now()`). The orchestrator, generator, and publish paths need no summer
special cases.

- **Dry-run is a rolled-back subtransaction** (`RAISE SQLSTATE 'PT001'` then swallow) so
  preview and apply share identical logic. Do not fork them.
- **Voiding a block** deletes its vacant seats and sets occupied ones to `cancelled_config`
  plus `shift_blocks.voided_at`, making voided blocks self-excluding on status-filtered reads.
  The orchestrator scan, `is_assignment_claimable`, and both house-grid views add an explicit
  `voided_at IS NULL` guard as defense in depth.
- **Headcount decrease cancels the excess occupants**; there is no grandfathering (revised
  2026-07-09). Fixed cut order: external floaters first (`floated_in` / `pending_float_in`),
  then the shorter shift (fewest occupied blocks at that house on that NY date), then
  `assignment_id`. Cancelled workers are notified; inbound floats on a cut seat are voided.
  This is an admin config action, so voiding floats does **not** violate no-takeback.
- The `enforce_block_occupied_headcount` trigger (`20260702000005`) is unchanged and stays
  grandfathering-aware: it checks only writes that _increase_ a block's occupied count. That
  tolerance is needed for swaps and drops on a transiently over-capacity block. Do not revert
  it to an unconditional check.
- A house window is `(house, date range, weekday_bands jsonb, weekend_bands jsonb)`, each band
  `{block_start, block_end, headcount}` with `00:00` end meaning 24:00 and an empty list
  meaning closed that day type.

## House transfers

House membership is **season-scoped**; `users.home_house_id` is a maintained cache of the
`user_house_memberships` row covering today. Every current-season read path (float
eligibility, the Harnwell training invariant, live calendar, roster, RLS) still reads the
scalar and is unchanged.

Only **forward-looking** surfaces look ahead, via `membership_house_for_date` /
`house_roster_as_of`: the preference board and the upcoming-season builder rosters.

`transfer_worker(initiator, user, dest, effective_date, note)` is the entry point. **Either
the source or the destination house's HM/BM may transfer** (or an admin); do not tighten to
own-house-only. NULL `effective_date` means the next season boundary; today means immediate.
An immediate move flips the cache now, reopens the worker's future old-house seats, and voids
their live floats. Outside a school-year semester, `permanent_drop_slot` raises
`semester_boundary_not_found`, so the direct-vacate fallback is **required**; do not remove
it. Future moves are applied by the hourly `apply-house-transfers` cron.

`apply_house_transfer` sets a LOCAL `app.house_transfer='1'` flag so
`prevent_home_house_update_without_admin_override` permits the write from cron, where
`auth.role()` is not `service_role`.

## Notifications

Delivery is asynchronous: `deliver_pending_notifications` enqueues `dispatch-push` through
pg_net, and the Edge Function re-checks `pending_notification_deliveries` before sending, so a
float acknowledged after enqueue is still suppressed.

**Delivery is intentionally at-least-once.** The once-a-minute cron can re-enqueue an
in-flight notification. Do **not** "fix" this by stamping `delivered_at` before sending:
personal notifications are mandatory, so a rare duplicate is preferable to a lost push.

Firebase routes both FCM and APNs tokens; iOS clients register their Firebase FCM registration
token, not a raw APNs token, and `dispatch-push` does not branch on platform.

## Required deploy configuration

Every deployed environment must set these or behavior silently degrades:

- `system_config('project_administrator_user_id')` (`value_type = 'uuid'`) — the terminal
  contact when an urgent HMOD-for-Allied notification resolves past both HM and HMOD. If unset
  or invalid, the notification is logged via `RAISE WARNING` and no `hmod_urgent` row is
  created. `seed.sql` does not set it (the local seed has no users).
- Postgres settings `app.supabase_url` and `app.service_role_key`.
- Edge Function secret `FIREBASE_SERVICE_ACCOUNT_JSON`.

## Other

- The `broadcast_subscribed` guard is enforced at both the DB trigger and Edge Function level.
  **The trigger is authoritative**; the EF layer is a UX guard.
- `worker_directory` exposes `email` (a deliberate widening for the contact card's mail
  intent). It remains owner-rights, SELECT-only, active-workers-only, and exposes nothing
  else. People admin over `users` / `user_roles` is untouched and stays hm/bm-only.
- Both house grids expose `worker_email`, `worker_home_house_id`, `worker_home_house_name`:
  the occupant's **home** house, which is not the grid's `house_name` (the desk being
  staffed). They differ on a float-in. New columns are **appended** to each projection because
  `CREATE OR REPLACE VIEW` may only add at the end; every client selects by name.
