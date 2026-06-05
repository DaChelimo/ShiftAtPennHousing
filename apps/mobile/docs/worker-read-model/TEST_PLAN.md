# Worker Read-Model Views · TEST PLAN (implementer's contract)

> **You are implementing a feature blind.** This is your complete and only spec. A hidden pgTAP
> suite verifies the behavior against concrete seeded data you will not see. **Do not** search for,
> open, or read any test file (`supabase/tests/*.sql`) — implement the behavior described, not
> assertions. Implement exactly the columns in §2 and the rules in §3. One migration file only.

## 0. Why & design decisions (context)
The KMP worker app's `WorkerShiftsRepository` reads two PostgREST relations that **don't exist yet**:
`worker_my_shifts` (filtered by `user_id`) and `worker_open_shifts` (filtered by `eligible_user_id`).
Create them as **views** so the app shows a worker's real shifts. Decisions already made (do not revisit):
- **One row per 30-minute block** (no contiguous-run merging — the repo maps rows 1:1; merging is a later cosmetic concern).
- `dropped_still_open` is **not derivable** from the schema → always `false`.
- Reuse the **canonical** predicates (cross-house matrix, feed rules) described in §3 — do not invent new eligibility rules.
- Expose the key id columns (`user_id`, `eligible_user_id`); the views **do not self-filter** by them — the client does.

## 1. Deliverable
One migration: `supabase/migrations/20260605000001_worker_read_model_views.sql`. It creates two views in
`public`, grants `SELECT` to `anon, authenticated, service_role`, and is idempotent
(`CREATE OR REPLACE VIEW`). Do not modify other migrations, seed.sql, or any test. Re-applies cleanly on
`supabase db reset`.

## 2. Exact output columns (PostgREST serializes these to the JSON the app decodes)

`worker_my_shifts`:
| column | type | notes |
|---|---|---|
| `user_id` | uuid | the owning worker (client filters on it; the view does NOT) |
| `id` | text | `assignment_id::text` |
| `house_id` | text | |
| `house_name` | text | from `houses.name` |
| `start_at` | timestamptz | `block_start_at` — leave as `timestamptz` (PostgREST → ISO-8601, which `kotlin.time.Instant.parse` accepts) |
| `end_at` | timestamptz | `block_start_at + interval '30 minutes'` |
| `kind` | text | one of `scheduled` / `temp_pickup` / `float_out` (see §3.1) |
| `cross_house` | boolean | NON-NULL |
| `pending` | boolean | NON-NULL |
| `break_shift` | boolean | NON-NULL |
| `dropped_still_open` | boolean | NON-NULL, always `false` |

`worker_open_shifts`:
| column | type | notes |
|---|---|---|
| `eligible_user_id` | uuid | a worker eligible to claim this open block (client filters on it) |
| `id` | text | `assignment_id::text` |
| `house_id` | text | |
| `house_name` | text | |
| `start_at` | timestamptz | as above |
| `end_at` | timestamptz | `+ 30 min` |
| `feed` | text | `weekly` or `permanent_opening` (§3.3) |
| `home_house` | boolean | NON-NULL: `house_id = <eligible worker>.home_house_id` |
| `weeks_remaining` | integer | NULL for `weekly`; for `permanent_opening` see §3.4 |

**Every boolean column must be NON-NULL** (a JSON `null` breaks the app's non-null Kotlin `Boolean`). Use
`COALESCE`/explicit `false` where needed. `weeks_remaining` is the only nullable column.

## 3. Rules

### 3.1 `worker_my_shifts` — which rows, and `kind`
From `shift_block_assignments sba` JOIN `shift_blocks sb USING(block_id)` JOIN `houses h ON h.id = sb.house_id`,
include rows where `sba.user_id IS NOT NULL` and `sba.status IN ('scheduled','claimed','floated_in','pending_float_in')`.
- `kind`: `floated_in`/`pending_float_in` ⇒ `float_out`; `claimed` ⇒ `temp_pickup`; `scheduled` ⇒ `scheduled` (else `scheduled`).
- `pending`: `sba.status IN ('pending_float_in','pending_float_out')`.
- `cross_house`: `COALESCE(sba.is_cross_house_pickup, false) OR (COALESCE(sba.is_float,false) AND sba.source_house_id IS NOT NULL)`.
- `break_shift`: true iff the block's NY-local date falls in a `break_periods` row —
  `EXISTS (SELECT 1 FROM operating_calendar oc JOIN break_periods bp ON oc.date BETWEEN bp.start_date AND bp.end_date AND oc.profile_name = bp.profile_name WHERE oc.date = (sb.block_start_at AT TIME ZONE 'America/New_York')::date)`.
  (If `operating_calendar` has no `profile_name` column, drop that one `AND` clause — keep the date-range test.)
- `dropped_still_open`: `false`.
- **Security**: define this view `WITH (security_invoker = true)` so the existing per-worker RLS on
  `shift_block_assignments` scopes rows to the authenticated worker.

### 3.2 `worker_my_shifts` does NOT filter by `user_id`
Expose `sba.user_id` as a column; do not put `WHERE user_id = <param>` (views take no params — the client filters).

### 3.3 `worker_open_shifts` — open blocks × eligible workers
Open blocks: `sba.status = 'vacant'` AND `sb.block_start_at > now()`. `feed`:
`'permanent_opening'` when `sba.vacancy_origin = 'permanent_drop'`, else `'weekly'`. For `weekly` rows only,
EXCLUDE blocks whose NY-local date is in a break period that is NOT in its `open_feed` phase:
`NOT EXISTS (SELECT 1 FROM operating_calendar oc JOIN break_periods bp ON oc.date BETWEEN bp.start_date AND bp.end_date WHERE oc.date = (sb.block_start_at AT TIME ZONE 'America/New_York')::date AND break_claim_phase(bp.break_id, now()) <> 'open_feed')`.
(Permanent openings are not subject to the break-phase filter.)

Eligible workers — CROSS JOIN to the set of users who can claim, then KEEP only eligible pairs:
- candidate users: `users u` where `u.is_active = true` AND EXISTS a `user_roles` row for `u` with `role IN ('sw','sm','hm')` AND NOT EXISTS a `user_roles` row for `u` with `role = 'bm'`.
- eligibility predicate (the cross-house matrix — canonical, from `crossHousePickup.ts`): keep the (block, user) pair iff
  **`sb.house_id <> 'harnwell' OR u.home_house_id = 'harnwell'`**. (Non-Harnwell houses: any candidate is eligible.
  Harnwell: only home-Harnwell workers. The home-house case is subsumed.)
- `eligible_user_id = u.user_id`; `home_house = (sb.house_id = u.home_house_id)`.
- **Security**: this view runs **owner-side** (do NOT set `security_invoker`) because cross-house vacant rows
  would otherwise be hidden by RLS; the `eligible_user_id` filter the client applies is the scoping. Grant SELECT as in §1.

### 3.4 `weeks_remaining`
`NULL` for `weekly` rows. For `permanent_opening` rows: the count of future vacant permanent-drop blocks at the
same house, same NY-local day-of-week, same NY-local time-of-day, with `block_start_at >= now()` (i.e. how many
weeks the recurring opening still recurs). Compute as a correlated scalar subquery over
`shift_block_assignments`/`shift_blocks` (status `vacant`, vacancy_origin `permanent_drop`).

## 4. Self-check (tests are withheld by design)
- `supabase db reset` applies cleanly (your migration included).
- `psql "$DB" -c "select count(*) from worker_my_shifts"` and `"... from worker_open_shifts"` run without error and return rows
  (the local DB is seeded — e.g. `e.harnwell.1@pennhousing.test` has scheduled blocks; open/vacant blocks exist too).
- Spot check: `select kind, count(*) from worker_my_shifts group by 1;` shows expected kinds; `select feed, count(*) from worker_open_shifts group by 1;` shows `weekly` (and `permanent_opening` if any).
- Do NOT add or read tests. Do NOT change other files.

`$DB` = `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.
