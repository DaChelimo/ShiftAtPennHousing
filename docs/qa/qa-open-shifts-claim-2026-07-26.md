# Ship check: open shifts, claim, seat allocation, coverage lock, overlapping feeds

Date: 2026-07-26
Branch: feat/ui-float-polish
Slice: journey 2 (open-shifts feed, weekly and permanent, mobile + web + Edge Function + RPC + orchestrator lock)

All runtime evidence was gathered against the local Supabase stack at
`postgresql://postgres:postgres@127.0.0.1:54322/postgres` and `http://127.0.0.1:54321`.
Any row I mutated during probing was restored in the same session.

**Standing after merge review: 4 P0, 2 P1, 1 retracted.**

One P0 ("anyone holding the anon key can permanently lock any block") was **retracted during
merge review** and must not be actioned. Its runtime proof was made with the wrong key; `anon`
receives HTTP 401 from `lock_block_coverage`. The ticket is kept in place, clearly marked, as an
evidence trail. See the retraction note on that ticket.

---

### [P0] Web worker portal claims 30 minutes of a multi-hour open shift and tells the worker it claimed the whole thing

**Journey**: A student worker opens the web worker portal, goes to Open shifts, sees a card that
reads "17:00 - 21:00 / Rodin / 4h", and clicks Claim to take the 4-hour shift.

**Trigger**:

1. Sign in to the web worker portal as any SW and open `/home/open`.
2. Find any open-shift card whose duration label is longer than 30 minutes (any coalesced run,
   which is the normal case: `worker_open_shifts` emits one row per 30-minute block and
   `coalesceOpenShifts` merges the contiguous run into one card).
3. Click Claim once.
4. Observe the green toast "Claimed. It is now in My shifts."
5. Open `/home/shifts`. The worker holds 17:00 to 17:30 only. The 17:30 to 21:00 remainder is
   still sitting in the open feed for anyone else to take.

**Observed**: `apps/web/components/worker/OpenShifts.tsx:161` calls
`const res = await claimShift(card.id);`. `card.id` is a single `assignment_id`, the first block
of the coalesced run: `packages/core/src/worker-shifts/index.ts` builds the card as
`{ ...rep, end: last.end, blockIds: lane.map((b) => b.id), count: sameSpan.length }`, so `id`
is `rep.id` (block 1 of N) while `blockIds` carries all N. The card renders the full span
(`timeLabel` and `durationLabel` from `card.start`/`card.end`,
`apps/web/lib/data/worker/openShifts.ts:139-141`) but the action never touches `card.blockIds`.
`claimShift` in `apps/web/lib/actions/worker/shifts.ts:47` posts one `assignment_id` to
`claim-shift`, which claims exactly one seat on one block
(`supabase/migrations/20260724000004_permanent_occurrence_weekly_claim.sql`, the
`LIMIT 1` seat pick). The success toast at
`apps/web/components/worker/OpenShifts.tsx:165` is unconditional on a 2xx.

The mobile client does this correctly and is the reference:
`WorkerShiftsRepository.claimShift(shift) = claimBlocks(shift.blockIds)` at
`apps/mobile/shared/src/commonMain/kotlin/com/pennhousing/shift/shared/data/WorkerShiftsRepository.kt:247`,
one POST per block, with a `ClaimOutcome` tally that distinguishes full, partial and total
failure. Web has no equivalent.

**Expected**: Clicking Claim on an N-block card claims all N blocks, and the toast reports what
actually landed. BSpec 5.3 defines the claim in terms of the displayed opening ("A claim is for a
time, never for a desk"); AGENTS.md hard invariant 5 makes the 30-minute block the atomic unit,
which is precisely why the multi-block card must fan out. The mobile partial-claim contract
(full / partial / none) is the behaviour BSpec 5.3 implies and is already implemented once.

**Blast radius**: Every web-portal claim of any shift longer than 30 minutes, which is nearly all
of them. A worker who claims a 4-hour evening believes they hold 4 paid hours and holds 0.5. The
other 3.5 stay in the open feed and can be taken by someone else while the worker believes they
are theirs.

**Fix sketch**: In `apps/web/components/worker/OpenShifts.tsx`, change `onAct` to loop
`card.blockIds` (or add a `claimShiftBlocks(blockIds: string[])` server action in
`apps/web/lib/actions/worker/shifts.ts` that does the loop server side, which avoids N round
trips from the browser). Return the same `{ claimed, failed, firstFailure }` shape the mobile
`ClaimOutcome` uses and drive the toast from it, so a partial claim reads as partial rather than
as success. The shared classifier already exists in
`apps/mobile/shared/.../network/WriteFeedback.kt`; port the three-way message selection or move
it into `packages/core`.

**Acceptance check**: Playwright: seed a 4-hour vacant run at a non-Harnwell house, sign in as an
eligible SW, click Claim once, then assert `worker_my_shifts` returns 8 rows for that worker on
that block start range (not 1), and assert the toast text matches the number claimed. Add a
regression test that a card whose `blockIds.length > 1` never posts fewer requests than
`blockIds.length`.

**Confidence**: verified in code.

---

### [P0] The open-shifts feed is silently truncated at 1000 rows, so later weeks show "Nothing open right now" while shifts are open

**Journey**: A worker wants hours next week. They open Open shifts, tap the week header forward
to "Next week" or "In 2 weeks", and the feed is empty. They conclude there is nothing to pick up.

**Trigger**:

1. Sign in on mobile as any SW against the live stack.
2. Open the Open Shifts tab. The current few days are populated.
3. Tap the week picker and choose "Next week" (or any of "In 2 weeks" / "In 3 weeks" /
   "In 4 weeks", all offered by
   `ShiftsScreenViewModel.openWeekOptions()` at
   `apps/mobile/shared/src/commonMain/kotlin/com/pennhousing/shift/shared/viewmodel/ShiftsScreenViewModel.kt:160`,
   offsets `[-1, 0, 1, 2, 3, 4]`).
4. The feed renders empty even though `worker_open_shifts` has thousands of rows for that worker
   in those weeks.

**Observed**: PostgREST is configured with `max_rows = 1000` (`supabase/config.toml:18`).
Neither client paginates or bounds the row count:

- Mobile: `WorkerShiftsRepository.fetchWorkerWeek` at
  `apps/mobile/shared/src/commonMain/kotlin/com/pennhousing/shift/shared/data/WorkerShiftsRepository.kt:781-793`
  issues `.select(OPEN_SHIFT_COLUMNS) { filter { eq("eligible_user_id", userId); gte("start_at", windowStart) }; order("start_at", ASCENDING) }`
  with no `.limit()`, no `.range()` and no upper bound.
- Web: `getOpenShiftsBoard` at `apps/web/lib/data/worker/openShifts.ts:185-196` issues the same
  shape with `.lt('start_at', windowEnd)` where `WINDOW_DAYS = 21`, again with no `.range()`.

Measured on the seeded local stack at 2026-07-26 20:49 UTC, for worker
`fbb00000-0000-4000-8000-000000000004`:

```
total rows in worker_open_shifts for this worker : 15,910
rows inside the mobile window                    : 15,910
rows inside the web 21-day window                :  8,097
start_at of row #1000 (the last one delivered)   : 2026-07-29 10:30 NY
max start_at present in the feed                 : 2026-09-06 16:30 NY
feeds present in the first 1000 rows             : weekly only
```

So the mobile client receives openings for the next three days and nothing else, and the
Open Shifts week navigator offers four future weeks that are all guaranteed empty. The
`permanent_opening` feed does not appear in the first 1000 rows at all on this data, so the
entire permanent-openings surface is unreachable once the weekly feed is large.

The truncation is silent. PostgREST returns HTTP 200 with 1000 rows; nothing in either client
inspects `Content-Range`. The shared week filter's own doc comment asserts the opposite of what
is true: "The underlying open-shift read is date-unbounded, so other weeks' openings are already
in the snapshot"
(`apps/mobile/shared/src/commonMain/kotlin/com/pennhousing/shift/shared/shifts/Shifts.kt:336`
header). That is the seam assumption this ticket falsifies.

Migration `supabase/migrations/20260726000001_open_shifts_horizon_bound.sql` bounded the view in
time and cut buffer cost 88x, and its own header records that the row count inside the horizon is
unchanged ("the row count is identical inside the horizon (15,898)"). The cost defect was fixed;
the truncation defect was not.

Secondary, same file: `WINDOW_DAYS = 21` in `apps/web/lib/data/worker/openShifts.ts:27`
contradicts BSpec 5.1 "Feed horizons", which states the weekly feed looks ahead 6 weeks and the
permanent feed 26 weeks. Web hides weekly openings in weeks 4 to 6 and permanent openings past
3 weeks even before the row cap bites.

**Expected**: A worker sees every opening they are eligible for inside the documented horizons
(BSpec 5.1: weekly 6 weeks, permanent 26 weeks) for whatever week they navigate to, or is told
that the list is incomplete. BSpec 5.1 states plainly that the 6-week bound was chosen because
"Nothing a worker could have acted on is hidden by this."

**Blast radius**: Every worker, every session, whenever total vacant seats across all eligible
houses inside the window exceed 1000. That threshold is low: 13 houses at roughly 38 blocks per
day over 6 weeks is about 20,000 block-seats, so a 5 percent vacancy rate crosses it. Measured
at 15,910 on the current seed. The harm is directly denominated in hours the worker never gets
the chance to claim.

**Fix sketch**: Two changes, both needed.

1. Scope the read to the week the client is showing instead of fetching the whole horizon.
   `fetchWorkerWeek` already knows `navigableWindowStart(now)`; give the open-shift query an
   upper bound too. Note the supabase-kt trap recorded in `apps/mobile/AGENTS.md` (a second
   filter on the same column is dropped), so the upper bound must be expressed as a
   `range`/`rangeLt` on `start_at` in one call, or the view must take the bound. The Open
   Shifts week offset (`openWeekOffset`) should drive the fetch, not just a client-side filter.
2. Add explicit `.range(from, to)` pagination with a loop, or a `.limit()` plus an
   `is-truncated` signal that the UI surfaces, so the failure can never be silent again.

Do the same in `getOpenShiftsBoard`, and align `WINDOW_DAYS` with the BSpec 5.1 horizons (or
document the divergence in BSpec 5.1 if 21 days is deliberate).

**Acceptance check**: With a seed that produces more than 1000 eligible open-shift rows for one
worker, assert that navigating the mobile Open Shifts week picker to offset +4 returns a non-empty
feed and that at least one card in that week is claimable. A DB-level assertion is not enough;
this only reproduces through PostgREST.

**Confidence**: verified in code (no `.limit()` / `.range()` on either client read, `max_rows = 1000`
in config) plus runtime measurement of the row counts and the cutoff date on the seeded local stack.

---

### [P0] Anyone holding the public anon key can claim a shift on behalf of any worker, and read any worker's hours

**Journey**: Not a worker journey. This is the claim write path being reachable without a login.

**Trigger** (reproduced against the local stack, 2026-07-26):

```
# The public anon key, which ships inside the mobile app bundle and the web bundle.
A="<anon key from `supabase status`>"

# Step 1: enumerate every open seat and every eligible worker's uuid, unauthenticated.
curl -s "http://127.0.0.1:54321/rest/v1/worker_open_shifts?select=eligible_user_id,house_id,start_at,feed&limit=3" \
  -H "apikey: $A" -H "Authorization: Bearer $A"
# -> [{"eligible_user_id":"a0000000-...","house_id":"lower-quad","start_at":"2026-08-24T18:00:00+00:00","feed":"weekly"}, ...]
# Content-Range on an exact count: 0-0/1753385

# Step 2: call the claim RPC directly with a caller-supplied p_user_id.
curl -s -X POST "http://127.0.0.1:54321/rest/v1/rpc/claim_open_shift" \
  -H "apikey: $A" -H "Authorization: Bearer $A" -H "Content-Type: application/json" \
  -d '{"p_assignment_id":"<any id from step 1>","p_user_id":"<any eligible_user_id from step 1>","p_as_of":"2026-07-26T00:00:00Z"}'
# -> HTTP 400 {"code":"P0001","message":"shift_unavailable"} for a bogus id, i.e. the function
#    EXECUTED. It is not a 401/403 permission denial. With a real vacant assignment_id it commits.

# Step 3: read any worker's weekly hours, unauthenticated.
curl -s -X POST "http://127.0.0.1:54321/rest/v1/rpc/claim_hours_projection" \
  -H "apikey: $A" -H "Authorization: Bearer $A" -H "Content-Type: application/json" \
  -d '{"p_assignment_id":"30eed212-14b7-4064-a5c4-9dd72852b904","p_user_id":"5ca50000-0000-4000-8000-00000000000c"}'
# -> [{"current_hours":0.0,"projected_hours":0.5,"hours_cap":20,"cap_enforcement":"soft","soft_cap_warning":false}]
```

**Observed**: Live catalog:

```
proname                 | prosecdef | anon EXECUTE | authenticated EXECUTE
claim_open_shift        | t         | t            | t
claim_hours_projection  | t         | t            | t

relname             | relkind | security_invoker | anon SELECT
worker_open_shifts  | v       | (none, owner rights) | t
worker_my_shifts    | v       | true             | f
worker_pending_floats | v     | true             | f
worker_recent_floats| v       | (none)           | f
```

`claim_open_shift` derives the actor entirely from its `p_user_id` argument
(`supabase/migrations/20260724000004_permanent_occurrence_weekly_claim.sql`, the
`SELECT user_id, home_house_id, is_active INTO v_claimer FROM users WHERE user_id = p_user_id`
block). It never reads `auth.uid()`. The `claim-shift` Edge Function
(`supabase/functions/claim-shift/index.ts:113-131`) is the layer that binds the actor to the
bearer token, and it can simply be bypassed by calling the RPC directly.

The view grant is a regression, not an oversight. `supabase/migrations/20260711000001_revoke_anon_worker_reads.sql`
revoked it explicitly and documented why ("it is an OWNER-RIGHTS view ... which let an
UNAUTHENTICATED caller enumerate every open seat across every house"). Two later migrations
re-added it verbatim:
`supabase/migrations/20260724000004_permanent_occurrence_weekly_claim.sql:196` and
`supabase/migrations/20260726000001_open_shifts_horizon_bound.sql:324`, both
`GRANT SELECT ON worker_open_shifts TO anon, authenticated, service_role;`. The other three
worker views were not re-granted, which is how the regression stayed invisible. This closed
finding H1 in `audits/adversarial-review-findings-2026-07-07.md:51` is open again.

**Expected**: `supabase/AGENTS.md` is explicit: "A function meant to be service-role-only needs
`REVOKE EXECUTE ON FUNCTION <fn> FROM anon, authenticated;` naming those roles explicitly, in the
same migration that creates or changes it." `worker_open_shifts` must not be readable by `anon`
per migration `20260711000001`, which shipped that decision.

**Blast radius**: Anyone with the app bundle. The two capabilities compose: the view hands over
exactly the two arguments the RPC needs (`assignment_id` and `eligible_user_id`), so an attacker
can fill an arbitrary worker's week to the hard cap with shifts they never asked for, or drain
every open seat in the system so no real worker can claim anything. The victim's schedule is
changed without their knowledge and their cap is consumed.

Secondary, same root cause: because `p_as_of` is also caller supplied, a direct caller sets it to
an arbitrary past instant and defeats the T-2h coverage gate at
`claim_open_shift` (`IF v_target.block_start_at <= p_as_of + interval '2 hours' AND NOT block_has_present_worker(...)`).
The one-way `coverage_locked_at` check still holds, so this only widens the not-yet-locked window.

**Fix sketch**: New migration:
`REVOKE EXECUTE ON FUNCTION claim_open_shift(uuid, uuid, timestamptz) FROM anon, authenticated;`
and the same for `claim_hours_projection(uuid, uuid)`, plus
`REVOKE ALL ON worker_open_shifts FROM anon, PUBLIC;`. Follow the pattern already established in
`supabase/migrations/20260724000006_revoke_permanent_ops_client_execute.sql`, which did exactly
this for the permanent-ops trio. Then delete the `GRANT ... TO anon` line from the
`worker_open_shifts` definition so the next `CREATE OR REPLACE VIEW` does not resurrect it a
third time (grant `authenticated, service_role` only). Both clients already go through the
Edge Function, so nothing breaks.

**Acceptance check**: pgTAP mirroring `supabase/tests/s5-permanent-ops-grants.sql`: assert
`has_function_privilege('anon', 'claim_open_shift(uuid,uuid,timestamptz)', 'EXECUTE') = false` and
the same for `authenticated`, and
`has_table_privilege('anon', 'worker_open_shifts', 'SELECT') = false`. Name both roles
explicitly; `has_function_privilege('public', ...)` passes while both still hold EXECUTE, which
is how this stayed hidden before. Then re-run the three curls above and confirm 401/403.

Note: the full definer sweep belongs to the `security-auditor` persona. This ticket covers only
the three objects on the claim journey.

**Confidence**: verified in code and confirmed at runtime against the live catalog and over HTTP
with the anon key.

---

### [RETRACTED, was P0] Anyone holding the public anon key can permanently lock any block against pickup, with no unlock path

> **This finding is false and must not be actioned.** Retracted 2026-07-26 during the merge
> review, before the report was relayed.
>
> `lock_block_coverage` is **not** reachable by `anon` or `authenticated`. Verified three ways
> against the same local stack:
>
> ```
> lock_block_coverage(uuid, timestamptz) | anon=false | authenticated=false
> ANON          -> HTTP 401  {"code":"42501","message":"permission denied for function lock_block_coverage"}
> SERVICE_ROLE  -> HTTP 200
> ```
>
> The target block's `coverage_locked_at` was still `NULL` after the anonymous attempt, so
> nothing was mutated.
>
> **Root cause of the error.** The repro below reports `HTTP 204`, which only a `service_role`
> request can produce here. The `$ANON` shell variable in the agent's session did not hold the
> anon key. The probe proved the function is callable by _someone_, and the identity of that
> someone was assumed rather than established. Because the bogus-uuid trick was used to avoid
> mutating a real row, the write that would have contradicted the conclusion never happened, so
> the mistake had nothing to run into.
>
> **The transferable lesson**, now recorded in the lessons register: a runtime probe that claims
> an authorization hole must establish its own identity inside the same command that exercises
> the hole. A key read from ambient shell state is an assumption wearing the costume of a
> measurement.
>
> The rest of this ticket is preserved unedited as the evidence trail. Do not act on it.

**ORIGINAL TEXT FOLLOWS, RETRACTED:**

**Journey**: Not a worker journey. This is the coverage lock being writable from outside the
orchestrator.

**Trigger** (reproduced against the local stack, 2026-07-26):

```
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST \
  "http://127.0.0.1:54321/rest/v1/rpc/lock_block_coverage" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" \
  -d '{"p_block_id":"00000000-0000-4000-8000-000000000000","p_as_of":"2026-07-26T00:00:00Z"}'
# -> HTTP 204   (probed with a bogus uuid so no real row is mutated; 204 proves it executed)
```

Substituting any real `block_id` from `worker_open_shifts` (readable by `anon`, see the previous
ticket) locks that block.

**Observed**: Live catalog shows `lock_block_coverage` as `SECURITY DEFINER`, `VOLATILE`, with
`EXECUTE` granted to both `anon` and `authenticated`. Its body is a bare write with no
authorization of any kind:

```sql
CREATE OR REPLACE FUNCTION public.lock_block_coverage(p_block_id uuid, p_as_of timestamptz)
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  UPDATE shift_blocks SET coverage_locked_at = p_as_of
  WHERE block_id = p_block_id AND coverage_locked_at IS NULL;
$function$
```

It is meant to be called only from the orchestrator's T-2h securing steps
(`supabase/functions/orchestrator-tick/floatLookup.ts:426-434`, from `floatLookupStep` and
`hmodNotifyAlliedStep`). The lock is one-way by design (BSpec 5.5, "Escalation Is One-Way") and
there is no reverse function anywhere in `supabase/migrations/`. Once set, the block's seats are
refused by `claim_open_shift` (`IF v_target.coverage_locked_at IS NOT NULL THEN RAISE EXCEPTION 'past_t2h_cutoff'`)
and by `is_assignment_claimable` forever, and both clients render the card as
"Locked, within 2h of start". Recovery requires a manual `UPDATE shift_blocks` by someone with
database access.

`scripts/security/attack-surface.sh:94` already names this function as the shape to look for
("orchestrator internals that mutate state a worker must not control"). It is currently reachable.

**Expected**: The coverage lock is orchestrator state. `supabase/AGENTS.md` "Coverage lock"
describes it as set by the orchestrator at the float_lookup / hmod_notify_allied step; no client
role should be able to set it. Nothing in BSpec 5.4 or 5.5 gives any actor, let alone an
anonymous one, the power to lock a block.

**Blast radius**: Every future block in the system. A single scripted loop over the block ids the
anon-readable view exposes would make the entire open-shifts feed permanently unclaimable across
all 13 houses, with no in-product remedy. This is a direct, irreversible denial of paid hours to
every worker.

**Fix sketch**: New migration:
`REVOKE EXECUTE ON FUNCTION lock_block_coverage(uuid, timestamptz) FROM anon, authenticated;`
(and confirm `service_role` retains it, since `orchestrator-tick` calls it through the service
client). Same pattern as `supabase/migrations/20260724000006_revoke_permanent_ops_client_execute.sql`.
While in there, consider adding an admin-only unlock RPC so a mistaken lock is recoverable in
product rather than by hand; that is a separate product decision and should be raised before
building.

**Acceptance check**: pgTAP asserting
`has_function_privilege('anon', 'lock_block_coverage(uuid,timestamptz)', 'EXECUTE') = false` and
the same for `authenticated`, plus a positive assertion that `service_role` still holds it (so
the revoke does not break the orchestrator). Then re-run the curl above and confirm a 401 or 403.

**Confidence**: ~~verified in code and confirmed at runtime (HTTP 204 from an anonymous caller)~~
**RETRACTED, see the note at the top of this ticket. The runtime confirmation was made with the
wrong key. Anon receives HTTP 401.**

---

### [P0] A permanent pickup assigns a worker to a coverage-locked block that the weekly claim path correctly refuses

**Journey**: A worker sees a permanent opening card in the feed ("Every Mon 17:00 - 21:00, 12
weeks remaining") and taps Pick up. The nearest occurrence is this afternoon, the desk was empty,
the orchestrator already ran its T-2h step and Allied coverage is being arranged for it. The
worker is assigned to it anyway.

**Trigger** (reproduced in SQL against the local stack, inside a transaction, rolled back):

1. Take any future Harnwell block with two seats. Set both seats to
   `status = 'vacant', vacancy_origin = 'permanent_drop'`.
2. Set `shift_blocks.coverage_locked_at = now()` on that block, which is what
   `floatLookupStep` does at T-2h for an empty desk.
3. `SELECT is_assignment_claimable(<seat>, now())` returns `f`.
4. `SELECT claim_open_shift(<seat>, <harnwell worker>, now())` raises `past_t2h_cutoff`. Correct.
5. `SELECT permanent_pickup_slot(<worker>, ARRAY[<block_id>], ARRAY[]::uuid[])` returns
   `{"skipped_count": 0, "assigned_count": 1}` and the seat is now `status = 'claimed'`,
   `user_id = <worker>`, `vacancy_origin = 'none'`.

**Observed**: `supabase/migrations/20260724000005_permanent_pickup_one_seat_per_block.sql` has no
`coverage_locked_at` predicate anywhere in `permanent_pickup_slot`. Its seat pick is

```sql
WHERE a.block_id = cb.block_id
  AND a.status = 'vacant'
  AND a.vacancy_origin = 'permanent_drop'
```

and the outer UPDATE repeats only those two predicates. The Edge Function that feeds it is the
only other gate, and it does not check the lock either:
`supabase/functions/permanent-pickup/index.ts`, `candidateBlocks()` filters on
`at.getTime() > asOf.getTime()`, the NY weekday, the block start local time, and
`operating_calendar.profile_name = 'regular_school_year'`. Nothing reads `coverage_locked_at`.

The UI compounds this. `resolveOpenState` in
`packages/core/src/worker-shifts/index.ts` returns `'permanent'` for any permanent-feed card
regardless of claimability, and `toView` in `apps/web/lib/data/worker/openShifts.ts:147` therefore
always sets `actionLabel = 'Pick up'`. The mobile mirror
(`apps/mobile/shared/.../shifts/OpenShiftPresentation.kt:36`) does the same. So a permanent card
whose next occurrence is locked still renders a live Pick up button on both platforms, and the
server accepts it.

**Expected**: BSpec 5.4, "The same coverage floor governs the pickup lock", is explicit: the lock
"is one-way per block: once an empty desk reaches the T-2h step, its vacant seats stay locked even
after a floater or Allied fills the desk", and "Allied coverage secured for an otherwise-empty
window keeps that window locked, rather than re-opening it to student pickup (we do not want a
student piling onto a slot already paid for)". BSpec 5.5 repeats it. `supabase/AGENTS.md`
"Coverage lock" lists it as an invariant that must not be collapsed. `claim_open_shift` and
`is_assignment_claimable` both honour it; `permanent_pickup_slot` does not.

**Blast radius**: Any permanent opening whose next occurrence is inside its T-2h window on an
empty desk, which is exactly the case the pickup card advertises most prominently ("Every Mon
17:00", nearest occurrence today). The department pays Allied for a window a student is also
staffing, or the student shows up to a desk Allied is already covering. The invariant is
breached at a write point that AGENTS.md names.

**Fix sketch**: Two layers, both.

1. In `supabase/functions/permanent-pickup/index.ts`, add `shift_blocks.coverage_locked_at` to the
   `candidateBlocks` select and filter it out (`coverage_locked_at IS NULL`), alongside the
   existing `voided_at` reasoning. Those occurrences should then be reported in the scope as
   skipped, so the "N of M weeks, K skipped" summary stays honest.
2. In a new migration replacing `permanent_pickup_slot`, add `sb.coverage_locked_at IS NULL` to
   both the `candidate_blocks` CTE and the outer UPDATE predicate (the function already joins
   `shift_blocks` for `house_id`), so the RPC is authoritative and not merely trusting the EF.
   Keep the existing one-seat-per-block `LATERAL ... FOR UPDATE SKIP LOCKED` shape untouched.

Also decide and document whether the permanent card should render as unpickable when its
_nearest_ occurrence is locked, or keep the Pick up action and report the locked week as skipped.
The second is probably right (the recurrence is still worth taking) but it is a product call and
BSpec 5.1 / 8.4.3 say nothing about it today.

**Acceptance check**: pgTAP alongside `supabase/tests/permanent-pickup-one-seat-per-block.sql`:
create a permanent-drop seat, set `coverage_locked_at`, call `permanent_pickup_slot` and assert
`assigned_count = 0` and the seat is still `vacant` / `permanent_drop`. Add a paired assertion
that an unlocked sibling occurrence in the same call is still assigned, so the fix does not turn
one locked week into a whole failed pickup.

**Confidence**: verified in code and reproduced at runtime.

---

### [P1] Pre-launch houses' open shifts appear in every worker's feed and are claimable, so a pilot worker can claim a shift at a house that is not on the system

**Journey**: During the staggered Harnwell pilot, a Harnwell worker opens Open shifts, taps the
"Other houses" tab, and sees hundreds of openings at Rodin, Harrison, Hill and the rest. They
claim one. Nobody at Rodin is using the system, so nobody knows.

**Trigger**:

1. Set `system_config('staggered_launch_enabled') = true` and leave every house except Harnwell
   at `launch_state = 'pre_launch'` (the production pilot configuration described in BSpec 22).
2. Sign in as a Harnwell SW on mobile or web and open the open-shifts feed.
3. Every vacant seat at the 12 dark houses is listed and carries a live Claim action.
4. Claim one. `claim_open_shift` accepts it.

**Observed**: `worker_open_shifts` has no launch predicate. Migration
`supabase/migrations/20260726000001_open_shifts_horizon_bound.sql` filters on `status = 'vacant'`,
the two time horizons, `voided_at IS NULL`, and the Harnwell training matrix. There is no
`house_is_live(sb.house_id)` and no `houses.is_staffable` check. `claim_open_shift` has no launch
check either.

The gate is applied everywhere else on the worker surface. `worker_visible_houses`
(`supabase/migrations/20260725000001_non_staffable_houses_and_allied.sql`) is
`WHERE house_is_live(id) AND is_staffable`, and both clients consume it
(`apps/web/lib/data/worker/house.ts:70`,
`apps/mobile/shared/.../data/WorkerShiftsRepository.kt:537`). The orchestrator was gated on
2026-07-26 (audit F-04). The open-shifts feed is the one worker-facing surface that was missed.

BSpec 22 states plainly that "A pre-launch house still has generated blocks whose seats are
entirely vacant", so under the pilot configuration the dark houses contribute the overwhelming
majority of the feed. Measured on the current seed for one Harnwell worker: 15,910 total feed
rows, of which 125 are Harnwell and 15,785 are the other 12 houses. Under the pilot gate those
15,785 rows would still be delivered, and they would consume the entire 1000-row PostgREST budget
before the worker's own house's later openings are reached (see the truncation ticket).

**Expected**: BSpec 22 says "a house is dark until an administrator explicitly launches it" and
that launch state is "primarily a visibility gate". A dark house's seats should not be visible in,
or claimable from, another house's worker feed. If the intent is genuinely that cross-house
pickup ignores the launch gate, BSpec 22 needs to say so, because it currently reads the other
way and `worker_visible_houses` implements the opposite.

**Blast radius**: Every worker at a live house during any staggered rollout, which is the launch
plan for this product. The claiming worker turns up at a desk that has no idea they are coming,
and no escalation chain runs for that block because the orchestrator is gated, so the desk is
never covered either.

**Fix sketch**: Add `AND house_is_live(sb.house_id) AND h.is_staffable` to the `vacant_seats` CTE
in a new `CREATE OR REPLACE VIEW worker_open_shifts` migration (the `houses` join is already there
after 20260726000001, so `h.is_staffable` costs nothing; `house_is_live` is SECURITY DEFINER and
will not inline, so evaluate it once per house rather than per row, or inline its logic the way
`desk_covered` was inlined in the same migration). Add the same guard to `claim_open_shift` and to
`permanent-pickup`'s `candidateBlocks`, raising a distinct error code so the client copy can say
something true. Then record the behaviour in BSpec 22 next to the escalation-chain sentence added
the same day.

**Acceptance check**: pgTAP: with `staggered_launch_enabled = true` and only Harnwell live, assert
`worker_open_shifts` returns zero rows for any non-Harnwell house, and that `claim_open_shift`
against a pre-launch house's seat raises. With the switch off, assert the row count is unchanged
from today (the gate must be a no-op in every dev environment and the whole test suite).

**Confidence**: verified in code. The gate is off in the local seed
(`system_config('staggered_launch_enabled')` is unset, so `house_is_live` returns true for every
house), so the failing configuration is production-only and I could not exercise it end to end.

---

### [P1] The permanent-pickup success toast reports the dry-run week count, not what was actually committed

**Journey**: A worker taps Pick up on a permanent opening, reads "Picked up 26 of 26 weeks", and
plans their semester around owning that slot. Fewer weeks actually landed.

**Trigger**:

1. Open a permanent opening's pickup sheet on iOS or Android. The sheet fires the read-only
   dry run on appear and shows "Picking up 26 of 26 weeks".
2. Leave the sheet open for a few seconds. In that window, another worker claims two of those
   occurrences from the weekly feed, or an admin cancels some, or the worker's own hours change.
3. Tap Confirm pickup.
4. The toast reads "Picked up 26 of 26 weeks" regardless. The commit assigned fewer.

**Observed**: The toast string is built from the dry-run scope at tap time and handed to the host
before the commit is issued.

- iOS: `apps/mobile/iosApp/iosApp/ContentView.swift:3639-3651` builds
  `permanentPickupToast(weeksPickedUp: scope.weeksPickedUp, totalWeeks: scope.totalWeeksInScope, weeksSkipped: scope.weeksSkipped)`
  from `permanentScope`, which was loaded in the sheet's `.task` via
  `loadPermanentScope` (the `permanent-pickup` GET), then calls
  `onConfirmed(effective, message)`.
- The host at `apps/mobile/iosApp/iosApp/ContentView.swift:1170-1178` sets
  `claimSuccessMessage = message` immediately and then runs the POST inside `liveWrite`, which
  only reacts on failure: `try? await repo.permanentPickup(shift: effective)` discards the
  response body entirely.
- Android is identical: `apps/mobile/androidApp/.../ui/openshifts/ClaimSheet.kt:188-199` builds the
  message from `permanentScope`, and
  `apps/mobile/androidApp/.../MainActivity.kt:717-731` only clears the toast on `!result.ok`.

The correct number is already on the wire and thrown away. `supabase/functions/permanent-pickup/index.ts`
returns `{ ...data, scope }` where `scope` is re-evaluated server side at POST time and `data`
carries `assigned_count` / `skipped_count` from `permanent_pickup_slot`. The web portal does read
it (`apps/web/lib/actions/worker/shifts.ts:120-135` maps the committed `scope` into the toast), so
the two platforms disagree about the same event.

**Expected**: A count shown to a worker must be true at the moment it is shown. BSpec 8.4.3 makes
partial pickups final, which is exactly why the worker needs the committed number rather than the
projection: they cannot get the missing weeks back by retrying the same pickup.

**Blast radius**: Every permanent pickup on both mobile platforms whenever the feed changes between
the sheet opening and Confirm. The worker believes they own weeks they do not, stops watching the
feed for them, and does not work them.

**Fix sketch**: Change `WorkerShiftsRepository.permanentPickup` to return the parsed
`PermanentPickupResponse` (it already has the serializer, used by `permanentPickupScope`) instead
of a bare `EdgeResult`, and have both hosts rebuild the toast from the committed `scope` on
success, falling back to the dry-run string only when the response cannot be parsed. Reuse the
existing shared `permanentPickupToast` helper so the copy stays in one place. The web mapping in
`apps/web/lib/actions/worker/shifts.ts` is the reference.

**Acceptance check**: A shared-module test that, given a dry-run scope of 26 and a committed scope
of 12, produces "Picked up 12 of 26 weeks" and not "26 of 26". Plus a mobile UI test asserting the
toast text is rendered after the write completes, not before it starts.

**Confidence**: verified in code.

---

## Verified clean

Surfaces I walked and believe are genuinely sound, with the guard that makes them sound.

- **Per-block seat allocation on the weekly claim.** `claim_open_shift`'s live body picks a seat
  with `ORDER BY (a.vacancy_origin = 'permanent_drop'), (a.assignment_id = p_assignment_id) DESC, a.assignment_id FOR UPDATE SKIP LOCKED LIMIT 1`
  scoped to `a.block_id = v_target.block_id`
  (`supabase/migrations/20260724000004_permanent_occurrence_weekly_claim.sql`, confirmed against
  the live catalog with `pg_get_functiondef`). Two claimers on a "2 open" card each get a seat.
  Covered by `supabase/tests/claim-open-shift-seat-agnostic.sql`.
- **`permanent_pickup_slot` takes one seat per block.** The AGENTS.md note saying it "still lacks a
  per-block limit" is stale; `supabase/migrations/20260724000005_permanent_pickup_one_seat_per_block.sql`
  fixed it with a `CROSS JOIN LATERAL (... ORDER BY a.assignment_id FOR UPDATE SKIP LOCKED LIMIT 1)`
  over `DISTINCT block_id`, on both the assigned and the skipped pass. I read the live function
  body and it matches. Covered by `supabase/tests/permanent-pickup-one-seat-per-block.sql`. The
  root `AGENTS.md` and the memory index should be corrected so the next pass does not re-chase it.
- **The seat-ordering rule matches the spec.** BSpec 5.3 "Which seat a weekly claim consumes
  (corrected 2026-07-24)" says ordinary seats drain first with a fallback to a permanently dropped
  seat once the block has none. The live `ORDER BY (a.vacancy_origin = 'permanent_drop')` puts
  ordinary first, and the `OR v_target.block_start_at <= p_as_of + interval '30 days'` predicate
  restricts the fallback to occurrences inside the 30-day horizon, which is the same condition
  that surfaces them as a weekly card. The earlier same-feed restriction shipped in
  `20260724000003` and was superseded by `20260724000004` the same day. No drift.
- **The two present-sets are not collapsed.** Escalation counts `allied`
  (`PRESENT_STATUSES` at `supabase/functions/orchestrator-tick/floatLookup.ts:49-55`); the pickup
  lock does not (`block_has_present_worker` in the live catalog is
  `status IN ('scheduled','claimed','floated_in','pending_float_in')`, and the inline copy in
  `worker_open_shifts`' `desk_covered` uses the same four). The 2026-07-26 performance rewrite
  inlined the predicate for cost but kept `allied` out, and says so in its header.
- **The coverage floor is one worker, not headcount.** `processVacantBlocks` skips any row with
  `row.desk_covered` before it can fire a step
  (`supabase/functions/orchestrator-tick/index.ts:540-543`), and `desk_covered` comes from
  `orchestrator_vacant_seats` over the escalation present-set.
- **Clients consume the server's claimability rather than re-deriving T-2h.**
  `isOpenShiftClaimable` (`packages/core/src/worker-shifts/index.ts`) and `isClaimable`
  (`apps/mobile/shared/.../shifts/Shifts.kt:194`) both start from `coverageLocked` and
  `deskCovered` off the view, and the two implementations agree line for line with each other and
  with `is_assignment_claimable`.
- **Card identity keeps the deliberately overlapping feeds apart.** The merge key includes `feed`
  in both implementations (`openShiftMergeKey` in `packages/core/src/worker-shifts/index.ts`,
  `OpenShiftMergeKey` in `apps/mobile/shared/.../shifts/Coalesce.kt`), and the web list key is
  `` `${c.feed}-${c.id}` `` (`apps/web/components/worker/OpenShifts.tsx:321`), so a
  permanently-dropped occurrence emitted twice with one `assignment_id` renders as two distinct
  cards rather than colliding.
- **Coverage flags are part of the merge key.** Both coalescers include `deskCovered` and
  `coverageLocked`, so a run that is claimable for its first two blocks and locked for the third
  splits into separate cards instead of one card whose action would misrepresent half its blocks.
- **The Harnwell training constraint holds at every write point on this journey.** The view
  restricts eligibility (`WHERE ob.house_id <> 'harnwell' OR cu.home_house_id = 'harnwell'`),
  `claim_open_shift` re-checks it, `permanent_pickup_slot` re-checks it over both id arrays, and
  there is a table-level backstop trigger `shift_block_assignments_enforce_harnwell_training`
  (BEFORE INSERT OR UPDATE OF block_id, user_id) that catches anything the RPCs miss. Confirmed in
  the live catalog.
- **Voided blocks are excluded from the claimable read path.** `is_assignment_claimable` carries
  `sb.voided_at IS NULL` and, since `20260726000001`, so does `worker_open_shifts`.
  `claim_open_shift` itself has no `voided_at` predicate, but voiding deletes a block's vacant
  seats (`supabase/AGENTS.md`, "Operating seasons"), so there is no seat left for it to claim. I
  looked for a path that recreates a vacant seat on a voided block and did not find one inside
  this slice.
- **Block atomicity.** Every row in the feed is one 30-minute block, every claim is per block, and
  contiguity in both coalescers is duration arithmetic on instants (`next.start == run.end`), not
  wall-clock arithmetic, so runs merge correctly across DST.
- **`permanent_pickup_slot` and `permanent_drop_slot` are not client reachable.** Live catalog
  confirms `EXECUTE` is denied to both `anon` and `authenticated`, per
  `supabase/migrations/20260724000006_revoke_permanent_ops_client_execute.sql`. They are reachable
  only through the `permanent-pickup` Edge Function, which binds the actor to the bearer token.
- **Mobile partial claim reporting is honest.** `claimBlocks` tallies claimed and failed blocks and
  `claimToast` renders full success, partial pickup and total failure differently
  (`apps/mobile/shared/.../data/WorkerShiftsRepository.kt:261-289`,
  `apps/mobile/shared/.../network/WriteFeedback.kt:171+`). This is the behaviour the web portal is
  missing.
- **The advertised "weeks remaining" matches what a pickup can take.** `permanent_slot_weeks` in
  `worker_open_shifts` counts only occurrences on a `regular_school_year` calendar date, which is
  the same filter `candidateBlocks` applies in the pickup Edge Function
  (`20260617000004`, restored by `20260724000004` after `20260627000001` silently dropped it). I
  checked whether the view's unbounded count could exceed the Edge Function's semester-bounded
  candidate set and it cannot on the current data, because permanently dropped seats only exist
  inside a semester.

## Not checked

- **The full `SECURITY DEFINER` and RLS sweep.** I filed the three exposures that sit on the claim
  journey (`claim_open_shift`, `claim_hours_projection`, `lock_block_coverage`, plus the
  `worker_open_shifts` anon grant regression). The project memory records roughly 37 definers still
  exposed. Enumerating and triaging the rest is the `security-auditor` persona's methodology and I
  deliberately did not duplicate it.
- **Concurrent claims by the same worker on two different houses at the same block start.** I built
  a two-session fixture and ran it three times with `pg_sleep` interleaving. The second claim was
  correctly refused with `time_conflict` every time, including when it executed 3 seconds before
  the first transaction committed. I could not explain the mechanism by which the second session
  saw the first's uncommitted row under READ COMMITTED, so I am recording this as tested but not
  proven rather than claiming the surface clean or filing a finding I cannot ground.
- **Double submit on the claim button.** Web guards with `busyId` and mobile with the sheet
  dismiss, but I did not construct a repro that defeats either, so I am not filing one.
- **Break-shift claim (`claim_break_blocks`) and the break calendar.** Adjacent to this journey and
  it shares the seat-picking pattern, but it is BSpec 4.4 and 11 and was out of the slice.
- **Swaps, floats, drops.** Only touched where they feed the open feed (a drop's vacated seat, a
  float's effect on `desk_covered`). Their own journeys were not walked.
- **The simulated clock.** The `claim-shift` Edge Function passes `new Date().toISOString()` as
  `p_as_of` while the view uses `now()` and the web page uses `simNow()`. Migration
  `20260726000008_time_travel_environment_gate.sql` gates the sim clock to non-production, so I
  treated the divergence as a dev-harness concern and did not chase it. If the gate is ever
  loosened this needs a fresh look.
- **Live iOS and Android device runs.** Every mobile finding above is read from source and from the
  shared decision layer. I did not build or run either app in this pass.
- **Production data volumes.** The 1000-row truncation is measured on the seeded local stack.
  The mechanism (no `.limit()`, no `.range()`, `max_rows = 1000`) is verified in code and is
  volume independent; the exact week at which a real worker's feed goes dark is not.
