# Ship check: schedule builder, AI scheduling, and publish

Date: 2026-07-26
Branch: phase-6-carbon-polish
Slice: journey 9 (builder UI, drag and resize, AI generate/accept, publish RPC, season apply, the
seam into `shift_block_assignments`)

Runtime evidence was gathered against the local stack at
`postgresql://postgres:postgres@127.0.0.1:54322/postgres` and `http://127.0.0.1:54321`.
Every write I ran was inside a transaction I rolled back, or was rejected before it landed.
I verified afterwards that zero `draft_block_assignments` rows were created in the probe
window and that the one draft row I targeted with a DELETE probe still exists. No destructive
write, no `apply_compiled_season`, and no real publish was executed, per the shared stack rule.

**Known and already ticketed, cited and not re-filed:**

- The `anon` grant class on the seat write and float surface (batch A merge review in
  `docs/qa/COVERAGE.md`). On this journey `admin_assign_worker`, `admin_remove_worker` and
  `admin_override_cap_assessment` all read `anon=true`, and `admin_assign_worker` is named in
  that ticket. `admin_remove_worker` and `admin_override_cap_assessment` are the same class and
  the same fix; they belong to that ticket, not to a new one. Two functions on this journey are
  NOT in that enumerated list and are filed below as P0.
- `worker_open_shifts` is `anon`-readable (batch A merged P0).
- The 1000 row PostgREST cap on the open shifts feed (slice 2 P0). The builder reads I checked
  are ordered ascending and consume only the first ~266 rows, so they do not hit it; see
  Verified clean.

---

### [P0] Publish puts a worker back on a shift the Student Manager deleted, after telling the SM it was saved

**Journey**: A Student Manager opens the builder for their own house, reviews the week, decides
one worker should not be on Sunday 08:00 to 12:00, clicks the "x" on that shift, sees the grid
clear and the toolbar say "Saved 3:42 PM", then publishes. The worker is scheduled for Sunday
08:00 to 12:00 for the whole period.

**Trigger**:

1. Sign in to the web portal as a user holding `sm` scoped to a house (a plain SM, not hm/bm/rsm).
2. Open `/schedule-builder`. The grid renders, because `getBuilderData` reads through the
   service client.
3. Click the "x" on any drafted shift, or use the focus panel's remove control, or drag a shift's
   resize handle inwards.
4. The shift disappears from the grid and `builder-save-status` shows "Saved <time>". No error.
5. Switch to another browser tab and back. The shift reappears (the visibility refresh re-syncs
   `drafts` from the server).
6. Click Publish. The shift is materialised as a real `scheduled` assignment in every week of
   the period.

**Observed**: The live `draft_block_assignments` RLS policies are house agnostic and exclude
`sm` entirely:

```
polname                                    polcmd  using / with check
house schedule-builders can select drafts   r      user_is_schedule_admin(auth.uid())
house schedule-builders can insert drafts   a      user_is_schedule_admin(auth.uid())
house schedule-builders can update drafts   w      user_is_schedule_admin(auth.uid())
house schedule-builders can delete drafts   d      user_is_schedule_admin(auth.uid())
```

`user_is_schedule_admin` is hm/bm/rsm anywhere and deliberately excludes `sm`. This was a
regression introduced by `supabase/migrations/20260627000002_cross_house_schedule_admin.sql:153`
to `:176`, which replaced the previous house keyed predicate
`user_can_build_schedule(auth.uid(), shift_blocks.house_id)`
(`supabase/migrations/20260528000016_batch_d9_admin_role.sql:56` to `:108`, which DID include
sm scoped to house) with the bare schedule admin check.

The draft mutations go through the USER client, not the service client:
`removeDraft` at `apps/web/lib/actions/builder.ts:84`, `removeDraftSpan` at
`apps/web/lib/actions/builder.ts:106`, `clearDraftBlocks` at
`apps/web/lib/actions/builder.ts:132`, `assignDraft` at `apps/web/lib/actions/builder.ts:54`.
A DELETE whose RLS `USING` clause is false matches zero rows and returns success, so
`error === null` and the action returns `{ ok: true }`
(`apps/web/lib/actions/builder.ts:91`, `:114`, `:142`). `runWrite` then stamps `savedAt`
(`apps/web/components/builder/ScheduleBuilder.tsx:175`) and `onRemoveSpan` has already applied
the removal to local state (`apps/web/components/builder/ScheduleBuilder.tsx:457`).

Measured at HTTP level with an inline minted `authenticated` JWT. Identity was established in
the same command: the RLS scoped `users` read returns exactly the token's own row.

```
SM token  -> [{"name":"Abraham"}]            (fbb00000-...-0002, roles: sw + sm@harnwell)
HM token  -> [{"name":"Mitchelle Majeski"}]  (a012a6b8-..., hm@harnwell)

POSITIVE CONTROL, HM SELECT drafts : HTTP 200, 2 rows
SM SELECT drafts                   : HTTP 200, []            <-- 401 harnwell rows exist
SM INSERT a draft on own house     : HTTP 403 42501 "new row violates row-level
                                     security policy for table draft_block_assignments"
SM DELETE an existing own-house
  draft (draft_assignment_id=eq..) : HTTP 200, []            <-- reported as success
row still present afterwards       : 1
rows created by the probe          : 0
```

The INSERT failing loudly is the second half of the same defect: `commitAssign` rolls its
optimistic add back (`ScheduleBuilder.tsx:440` to `:448`) and surfaces the raw Postgres RLS
string in the `builder-error` notification, so **a plain SM cannot hand build any schedule at
all**. Because `acceptAiSchedule` writes through the SERVICE client
(`apps/web/lib/actions/aiSchedule.ts:59`), an SM can still accept an AI proposal, which is
exactly the path that makes the DELETE half deadly: the SM accepts a generated week, deletes the
shifts they disagree with, is told they were saved, and publishes all of them.

**Expected**: `AGENTS.md:516` states plainly "**SM is UNCHANGED (own-house everywhere)**" for
the 2026-06-27 cross house change, and `supabase/AGENTS.md` invariant 2 in the predicate table
says the sm branch must stay `scope_house_id = house`. BSpec 4.3 makes the SM the primary
schedule builder. The SM must be able to read, insert, update and delete drafts on blocks
belonging to their own house, and no draft mutation may report success when zero rows changed.

**Blast radius**: Every plain SM at every house, every session. 11 users hold `sm` in the live
role table. Two distinct harms: the builder is unusable for hand building, and any removal an SM
makes silently survives into published paid hours for the whole period. A worker is scheduled
for hours nobody intended and the SM has no signal.

**Fix sketch**: New migration restoring the house keyed predicate on all four
`draft_block_assignments` policies, in the shape `20260528000016` used but with
`user_can_build_schedule` (which already ORs `user_is_schedule_admin` with sm scoped to house),
so hm/bm/rsm keep cross house and sm regains own house:

```
EXISTS (SELECT 1 FROM shift_blocks
        WHERE shift_blocks.block_id = draft_block_assignments.block_id
          AND user_can_build_schedule(auth.uid(), shift_blocks.house_id))
```

Independently, make the draft mutations in `apps/web/lib/actions/builder.ts` return the affected
row count (`.select('draft_assignment_id')` on the deletes) and treat a zero count on a
non-empty target as an error, so an RLS filtered write can never read as success again. Check
`preferences` and `period_targets` in the same migration: `20260627000002:100` to `:151` applied
the identical substitution to both, which is slice 8's surface (flagged for merge, not filed
here).

**Acceptance check**: pgTAP under `supabase test db`, as an `sm` scoped to house H: INSERT,
UPDATE and DELETE of a draft on an H block all succeed, and the same three on a non-H block all
fail. Playwright: as an SM, remove a drafted shift, assert the server action's returned count is
1, reload, assert the shift is still gone.

**Confidence**: verified in code and at runtime (HTTP, with identity established inline and a
positive control).

---

### [P0] Publish creates open shifts on desks that are already fully staffed, shows them to every eligible worker, and the claim fails with a raw Postgres error

**Journey**: A worker opens Open shifts, sees a seat at their own house, taps Claim, and gets a
database error. Nobody can ever claim that seat, and it stays in the feed.

**Trigger**:

1. Any block in an unpublished period whose seats are already occupied by workers publish did not
   create: a pre-publish claim from the live open shifts feed (there is no publication gate on
   `is_assignment_claimable`, verified against the live catalog), a float in, or a prior seeded or
   dev-seeded schedule. Live example: Harnwell in period `5ea50000-...` (2026-06-01 to
   2026-08-20) has 2112 blocks at `required_headcount = 2` with 2 occupied seats and 0 vacant,
   and the period has no `period_house_publications` row.
2. The admin publishes that house for that period.
3. Case A, the slot has no drafted pattern user: publish's step 3 adds `required_headcount` fresh
   `vacant`/`never_assigned` seats to a block that is already full.
4. Open the worker app or `/home/open`. The phantom seat is in the feed.
5. Tap Claim. The write fails with `block_over_capacity`.
6. Case B, the slot HAS a drafted pattern user: publish's step 2 insert raises
   `block_over_capacity` and, because `publish_schedule` is a single transaction, the ENTIRE
   house publish for the whole period rolls back. The admin gets a raw Postgres string naming a
   block uuid, with no date, time or worker.

**Observed**: publish's seat accounting counts only `vacant`/`never_assigned` seats and never
looks at seats that are already occupied.
`supabase/migrations/20260711000004_publish_skip_voided_blocks.sql:91` to `:94` computes
`v_vac_count` from vacant rows only; `:152` to `:169` then normalises to
`v_desired_vac := required_headcount - v_pat_count` and INSERTs the shortfall, with no term for
existing occupants. `:132` to `:150` INSERTs `scheduled` rows for pattern users beyond the
vacant seats, which is what trips the trigger.

`enforce_block_occupied_headcount`
(`supabase/migrations/20260726000010_block_occupancy_constraint.sql:48` to `:113`) returns early
for a `vacant` write (`:59`), so the step 3 inserts are invisible to it, and raises on an
occupied write with no grandfathering for an INSERT (`:66` to `:70` only skips UPDATEs).

Measured on the live stack inside a rolled back transaction, against a real Harnwell summer
block at `required_headcount = 2` with 2 occupied and 0 vacant seats:

```
PROBE A, publish step 2 shape (INSERT a scheduled row):
  ERROR: block_over_capacity: block 00818ffc-... already has 2 occupied seat(s);
         house headcount is 2
  CONTEXT: enforce_block_occupied_headcount() line 54 at RAISE

PROBE B, publish step 3 shape (INSERT 2 vacant/never_assigned rows):
  INSERT 0 2
  seats_now = 4, vacant_now = 2      on a headcount-2 block that was already full

PROBE C, is that phantom seat live to workers?
  is_assignment_claimable(...)                        -> true
  worker_open_shifts rows for it                      -> 10, to 10 distinct
                                                         eligible_user_ids, desk_covered = t
  claim_open_shift(seat, one of those workers, now())  ->
    ERROR: block_over_capacity: block 0175e8b1-... already has 2 occupied seat(s);
           house headcount is 2
    CONTEXT: claim_open_shift line 137 at SQL statement
```

The claim error is not mapped: `supabase/functions/claim-shift/index.ts:10` maps only
`shift_unavailable`, and `apps/mobile/.../network/WriteFeedback.kt:107` has no case for
`block_over_capacity`, so it falls through to the generic failure copy.

**Expected**: publish must size a block's vacant seats against `required_headcount` minus ALL
occupied seats, not minus the drafted pattern users alone, and must not insert an occupied row
onto a block that has no room. `AGENTS.md` invariant 5 makes the 30 minute seat the atomic unit
and the coverage model assumes an "N open" card corresponds to a real free seat.
`ARCHITECTURE.md:706` to `:708` states the false premise this defect rests on: "The block
generator pre-creates exactly `required_headcount` vacant seats per block, so publish normally
only flips statuses (the function keeps excess-insert / vacancy-normalize branches for
robustness)." By publish time that is not true, and the "robustness" branch is the one that
manufactures the phantom seats. That sentence must be corrected in the same change.

**Blast radius**: Case A is every worker at the house, every session, for as many phantom seats
as publish created. On the current seed a Harnwell publish would add 2 phantom seats to each of
2112 blocks. Workers repeatedly try to claim hours they can never get, and the feed's counts are
false. Case B blocks a whole house's period publish on a single pre-publish claim, so dozens of
workers have no schedule and the admin is handed a bare uuid.

**Fix sketch**: In `publish_schedule`, add a third count next to `v_pat_count` and `v_vac_count`:
`v_occ_count` over `status IN ('scheduled','claimed','floated_in','pending_float_in')` for the
block. Then cap the pattern users at `required_headcount - v_occ_count` (raising a NAMED,
actionable error that includes the NY date, time and house when a draft cannot be placed, not a
raw uuid), and set `v_desired_vac := GREATEST(required_headcount - v_pat_count - v_occ_count, 0)`.
Map `block_over_capacity` in `publishScheduleAction`
(`apps/web/lib/actions/builder.ts:176` currently passes `error.message` through verbatim) and in
`WriteFeedback.kt`. Correct `ARCHITECTURE.md:706` to `:708`.

**Acceptance check**: pgTAP: on a headcount-1 block in an unpublished period, claim the vacant
seat, then publish with (a) no draft on that slot and (b) a draft on that slot. Assert (a) leaves
the block with exactly 1 seat and no vacant row, and (b) completes with a named error or skips
that block rather than aborting the period. Add an assertion that after any publish, no block has
`occupied + vacant > required_headcount`.

**Confidence**: verified in code and at runtime (three rolled back probes on live data, including
the end to end claim failure).

---

### [P0] Any signed in student worker can publish any house's schedule, and `anon` can execute the destructive season apply

**Journey**: Not an admin journey. This is the publish and season write path being reachable
without the service role key.

**Trigger** (all steps below were executed; only the final committing publish call was
deliberately not run, on a shared stack):

```
# Identity is established inline. The token below is minted in the same command from the
# local JWT secret, sub = a real plain student worker, and the server confirms who it sees.
W = HS256 JWT {"role":"authenticated","sub":"fbb00000-0000-4000-8000-000000000005"}

$ psql -c "select roles, user_can_build_schedule(user_id,'harnwell') from ..."
  fbb00000-...-0005 | Aaron | {sw:-} | can_build_harnwell = f      # a plain worker

$ curl .../rest/v1/users?select=name&limit=1  -H "Authorization: Bearer $W"
  [{"name":"Aaron"}]                                    # auth.uid() is Aaron

# 1. Aaron reads every scheduling period, including the unpublished one.
$ curl .../rest/v1/scheduling_periods?select=period_id,start_date,end_date,published_at
  [{"period_id":"c0000000-...","published_at":"2026-07-09T09:48:43Z"},
   {"period_id":"5ea50000-...","start_date":"2026-06-01","end_date":"2026-08-20",
    "published_at":null}]

# 2. Aaron gets every house's roster uuid from an authenticated-and-anon RPC.
$ curl .../rest/v1/rpc/house_roster_as_of -d '{"p_house_id":"harnwell","p_as_of":"2026-08-01"}'
  [{"user_id":"fbb00000-...-0002","name":"Abraham"}, ... 9 rows]

# 3. Aaron evaluates the EXACT gate publish_schedule uses, on each roster uuid.
$ curl .../rest/v1/rpc/user_can_build_schedule -d '{"check_user_id":"fbb00000-...-0002",
                                                    "check_house_id":"harnwell"}'
  true                     # Abraham holds sw AND sm@harnwell, so he is in the roster

# 4. Aaron reaches publish_schedule. The body executes; this is not a permission denial.
$ curl .../rest/v1/rpc/publish_schedule -d '{"p_period_id":"00000000-...","p_published_by":
        "fbb00000-...-0002","p_house_id":"harnwell"}'
  HTTP 500 {"code":"P0002","message":"scheduling period 00000000-... not found"}
```

Substituting the real period id from step 1 is the whole exploit. I did not run that call.

Same key, the season half, with the negative control asserted in the same command:

```
A = the public anon key from `supabase status`; its JWT payload decodes to
    {'iss':'supabase-demo','role':'anon','exp':1983812996}

NEGATIVE CONTROL  rpc/apply_compiled_season            -> HTTP 401
  {"code":"42501","message":"permission denied for function apply_compiled_season"}

POSITIVE          rpc/apply_compiled_season_unguarded  -> HTTP 401
  {"code":"42501","message":"apply_compiled_season: caller 00000000-... is not
   an administrator"}          <-- the function's OWN body raised this; it EXECUTED

NEGATIVE CONTROL  rpc/admin_seed_draft_schedule        -> HTTP 404 PGRST202 (not exposed)
```

Live catalog, `has_function_privilege`:

```
proname                            prosecdef  anon  authenticated  service_role
publish_schedule                       t        t        t              t
apply_compiled_season                  t        f        f              t
apply_compiled_season_unguarded        t        t        t              t
admin_seed_draft_schedule              t        f        f              t
try_orchestrator_tick_lock             t        f        f              t
```

**Observed**: Two independent causes.

`publish_schedule` derives its entire authority from the caller supplied `p_published_by`
argument and never reads `auth.uid()`:
`supabase/migrations/20260711000004_publish_skip_voided_blocks.sql:49`
(`IF p_published_by IS NULL OR NOT user_can_build_schedule(p_published_by, p_house_id)`). Every
migration that has ever touched it revoked `FROM PUBLIC` only
(`20260528000010:208`, `20260614000002:203`, `20260711000004:205`), which
`supabase/AGENTS.md` documents as a no-op against the per role grants Supabase issues at CREATE
time. `house_roster_as_of`
(`supabase/migrations/20260719000001_house_transfers.sql:346`, granted to `authenticated` and
`service_role` at `:364`) joins `role = 'sw'`, and a dual role sw+sm user therefore appears in
it, which is how the qualifying uuid leaks.

`apply_compiled_season_unguarded` is the exact trap `supabase/AGENTS.md:31` warns about:
"revoking the wrapper while leaving an `_unguarded` inner function client-reachable is not a
fix." `supabase/migrations/20260726000007_bulk_apply_and_tick_serialization.sql:91` to `:100`
renames the old function, which preserves its grants (`20260702000006:445` granted EXECUTE to
`authenticated`, plus Supabase's default `anon` grant), and then `:131` to `:132` revokes and
regrants only the NEW wrapper. Calling the inner name also bypasses the advisory lock the
wrapper exists to take (`:114`), so two applies or an apply racing a preview can still overlap
even for a legitimate service role caller who uses the wrong name.

**Expected**: `supabase/AGENTS.md` is explicit that a service role only function needs
`REVOKE EXECUTE ON FUNCTION <fn> FROM anon, authenticated;` naming those roles, in the same
migration that creates or changes it, and that the inner function's grants must be checked too.
`publish_schedule` must additionally derive its actor from `auth.uid()` when one exists rather
than trusting `p_published_by`, the way the seat write RPCs are being corrected.

**Blast radius**: 89 users hold `sw`. Any one of them, with no admin role, can publish any of
the 13 houses for any period. Publish is irreversible: there is no unpublish path anywhere in
the repo (grep over `supabase/migrations`, `supabase/functions`, `supabase/tests`,
`apps/web/lib`, `apps/web/app`, `apps/web/components`, `packages` for
`period_house_publications` with delete/unpublish/revert returns nothing), and the
`period_house_publications` row makes a second publish raise `unique_violation`
(`20260711000004:54` to `:58`), so the real admin is locked out of that house for that period
permanently. The same call also deletes every draft the admin has built for that house
(`20260711000004:172` to `:174`). For the season half, `apply_compiled_season` cancels
assignments across a house and voids inbound floats; it is the most destructive write in the
product and it is reachable with the public key that ships in the app bundle, gated only by
knowing one admin uuid.

**Fix sketch**: One migration:
`REVOKE EXECUTE ON FUNCTION publish_schedule(uuid, uuid, text) FROM anon, authenticated;`,
`REVOKE EXECUTE ON FUNCTION apply_compiled_season_unguarded(uuid, uuid, jsonb, boolean) FROM anon, authenticated;`,
and the same for `publish_schedule_impl` and `publish_schedule(uuid, uuid)` if either still
exists in the catalog. Then change `publish_schedule` to bind the actor: when
`auth.uid() IS NOT NULL`, require `p_published_by = auth.uid()`. Add a pgTAP grant assertion that
names `anon` and `authenticated` explicitly for every function in the `publish_schedule` and
`apply_compiled_season` families, including `_unguarded` and `_impl` variants, because
`has_function_privilege('public', ...)` passes while both roles still hold EXECUTE. A repo wide
sweep for `_unguarded` and `_impl` siblings whose grants outlive their wrapper's revoke belongs
with this fix rather than being rediscovered per journey.

**Acceptance check**: pgTAP asserting `has_function_privilege('anon', ...)` and
`has_function_privilege('authenticated', ...)` are both false for every function in both
families. HTTP: with the anon key and with a plain `sw` token, both calls return
`42501 permission denied for function`, not the function's own error text.

**Confidence**: verified at runtime for the grants and for the full information chain, with
identity established inline and negative controls asserted in the same command. The final
committing `publish_schedule` call was deliberately not executed on a shared stack, so the
commit itself is needs runtime check; the EXECUTE privilege and the gate evaluation are verified.

---

### [P0] Publish cannot staff 1389 blocks of Kings Court's summer, and reports success

**Journey**: A scheduling admin builds the Kings Court summer week in the builder, publishes, and
is shown a green "Published, N scheduled" badge. Every weekend of the season and every weekday
evening after 17:00 from mid June onward is completely unstaffed, and nothing said so.

**Trigger**:

1. An operating season with more than one `season_house_windows` row for a house, where the later
   window is wider. This is the documented authoring model: one editable window per house per
   date range, edited in place via `saveHouseWindow` in `SeasonEditor.tsx`.
2. Live instance on the current stack, `kings-court`:

```
house_id    | start_date | end_date   | weekday_bands              | weekend_bands
kings-court | 2026-06-01 | 2026-06-13 | 05:30-17:00 headcount 1    | []          (closed)
kings-court | 2026-06-14 | 2026-08-20 | 05:30-00:00 headcount 1    | 05:30-00:00 headcount 1
```

3. Open `/schedule-builder?house=kings-court`. `getBuilderData` picks the build week as the week
   of the house's earliest block, 2026-06-01, which under window 1 contains ONLY weekday
   05:30 to 17:00 slots and no weekend at all.
4. Build that week and publish.

**Observed**: publish replicates the template week's pattern by NY `(isodow, time-of-day)` over
the whole period (`supabase/migrations/20260711000004_publish_skip_voided_blocks.sql:69` to
`:89`), and the template week is `min` over drafted non-voided blocks (`:62` to `:67`). A slot
that does not exist in the template week has `v_pat_count = 0` for every later occurrence, so
those blocks receive no pattern user and are normalised to fully vacant at `:165` to `:169`.

Measured on the live stack, per house, over period 2026-06-01 to 2026-08-20, comparing the
`(isodow, time-of-day)` slots present in each house's template week against the slots present in
the whole period:

```
house_id    | slots_in_template_week | slots_in_whole_period | blocks_with_no_template_slot
kings-court |          115           |         259           |            1389
gregory     |          224           |         224           |               0
harnwell    |          259           |         259           |               0
(all other houses)                                                          0
```

1389 half hour blocks, 694.5 hours of desk time, cannot receive an assignment from publish. The
builder never showed the admin those slots (the grid is the template week only, and there is no
week or day selector). The publish badge shows `publishStats.scheduled`
(`apps/web/components/builder/BuilderToolbar.tsx:119`), which counts only rows that landed, so it
is literally true and completely uninformative about the gap.

**Expected**: `AGENTS.md:547` claims "the orchestrator / generator / publish need NO summer
special cases". A season whose compiler is designed to emit "one PHASE per change-point" and
whose editor supports multiple date ranged windows per house is precisely a case publish cannot
handle with a single template week. Either publish must derive its pattern per phase rather than
from one week, or the builder must expose the additional weeks, or publish must report which
slots it could not staff. Any of those is a change to the publish path, so the `AGENTS.md:547`
claim is a stale note and is itself part of this finding.

**Blast radius**: One house per widening window, for the remainder of the season. On the current
stack that is 694.5 hours at Kings Court. The orchestrator will treat all of it as vacant and
escalate (broadcast, then float, then Allied) because the desk would be empty, so the operational
cost is hundreds of hours of Allied procurement plus the scheduled hours the house's workers were
never offered. The admin has no in-product route to fix it other than block by block override.

**Fix sketch**: In `publish_schedule`, replace the single `v_template_start` with a per phase
template: group the period's blocks by their `operating_calendar.profile_name` and resolve the
pattern from the first drafted week WITHIN each profile, falling back to the previous profile's
pattern for slots that exist in both. Minimum viable alternative, which should ship regardless:
have publish return, alongside the scheduled count, the number of blocks it left fully vacant
because no template slot matched, and surface that in the publish confirm dialog BEFORE the
admin commits (`apps/web/components/builder/ScheduleBuilder.tsx:917` to `:920`) and in the
result badge. Correct `AGENTS.md:547`.

**Acceptance check**: pgTAP: author a two window season for one house where window 2 adds
weekend days, build and publish the template week, then assert either that weekend blocks
received pattern assignments or that the function's return value reports the unstaffable block
count as non-zero. Playwright: the publish confirm dialog names the number of blocks that will be
left open before the admin clicks Publish.

**Confidence**: verified in code and against live data.

---

### [P0] The Quad builder is permanently pinned to a published February week, so Quad cannot be built for any future period

**Journey**: The Quad SM opens the schedule builder to build the upcoming period. The grid shows
a week from last February, the badge says "Published", the Publish button is absent, and the AI
panel does not render. There is nothing they can do.

**Trigger**:

1. Open `/schedule-builder?house=quad` on the current stack.
2. `getBuilderData` reads all of the house's blocks ordered by `block_start_at`
   (`apps/web/lib/data/scheduleBuilder.ts:101` to `:105`, with no date bound and no
   `voided_at IS NULL` filter) and sets the build week to the week of the FIRST one
   (`:147` to `:149`).
3. Quad's earliest block is 2026-02-02. Live: `quad` has 454 blocks, earliest 2026-02-02.
4. The period covering 2026-02-02 is `c0000000-...` (2026-01-12 to 2026-05-01), and
   `period_house_publications` holds exactly one row: `(c0000000-..., quad)`.
5. So `published` resolves true (`apps/web/lib/data/scheduleBuilder.ts:232` to `:237`).
   `BuilderToolbar` hides the Publish button (`BuilderToolbar.tsx:215`), the grid goes read only
   (`ScheduleBuilder.tsx:706`), the roster is hidden (`:725`), and `AiSchedulePanel` returns null
   on its first line (`AiSchedulePanel.tsx:112`).

**Observed**: The builder has no week selector and no period selector. The page reads only
`?house=` (`apps/web/app/(app)/schedule-builder/page.tsx:23` to `:29`). The build week is a pure
function of which blocks happen to exist earliest for the house, over all time, including voided
ones. Once a house's first ever period is published, that house's builder is stuck in read only
forever.

Live, the three houses show three different arbitrary anchors:

```
house_id    | earliest block | consequence
quad        | 2026-02-02     | period c0000000 IS published -> builder read only, no Publish
lower-quad  | 2026-08-24     | builder anchored 4 weeks in the future
radian      | 2026-08-24     | same
kings-court | 2026-06-01     | anchored to the narrow window-1 week (see the ticket above)
```

**Expected**: BSpec 4.3 Phase 3 (`BEHAVIORAL_SPECIFICATION.md:396`) describes publishing a
schedule as a repeatable per period act, and `ARCHITECTURE.md:721` says "The draft table is
empty for the period until the next semester's schedule is being built", which presumes the
builder can be pointed at the next semester. Neither spec states how the builder chooses its
week, which is why this shipped: the rule exists only in
`apps/web/lib/data/scheduleBuilder.ts:147`.

**Blast radius**: Quad today, and every house the moment its first period is published. Quad is
the 3 staff house, so it carries the most seats of any house. The whole house's next period
cannot be built at all, which means its workers get no scheduled hours and every seat has to be
filled through the open shifts feed or block by block override.

**Fix sketch**: Give the builder an explicit period target rather than an inferred one. Add a
`?period=` (or `?week=`) search param to
`apps/web/app/(app)/schedule-builder/page.tsx`, default it to the earliest scheduling period
that has blocks for the house and is NOT yet published for that house, and pass the chosen week
into `getBuilderData` instead of deriving it from `allBlocks[0]`. Add the
`.is('voided_at', null)` filter that `getAiScheduleContext` already has
(`apps/web/lib/data/aiSchedule.ts:78` to `:83`) so voided history cannot anchor the week either.
Render a period or week picker in `BuilderToolbar` so the state is visible rather than implicit,
and record the selection rule in `ARCHITECTURE.md` section 3.9.

**Acceptance check**: Playwright: with one published period and one unpublished period both
holding blocks for a house, opening `/schedule-builder?house=<h>` lands on the unpublished
period's first week, shows the Publish button, and renders the AI panel. Assert the same house
after publishing period 1 still offers period 2.

**Confidence**: verified in code and against live data.

---

### [P1] The Harnwell training invariant is checked against today's membership cache, not the shift's date, so a transfer in cannot be pre-built

**Journey**: A worker is transferring into Harnwell for the summer. The admin opens the Harnwell
builder for a week after the transfer date, sees that worker in the roster, drags them onto a
shift, and is told "non-Harnwell workers may not staff Harnwell". If they used the AI instead,
the multi minute paid generation completes, the accept fails, and the existing draft has already
been deleted (see the `acceptAiSchedule` ticket below).

**Trigger** (executed on the live stack inside a rolled back transaction):

1. Take an active `sw` whose `users.home_house_id` is `quad` (`a0000000-...-0002`).
2. Record a future transfer into Harnwell effective inside the build week, exactly as
   `transfer_worker` does: close the open membership row and insert
   `(user, 'harnwell', effective_from = 2026-08-10)`.
3. Observe the forward looking roster and the cache disagree, which is by design:

```
membership_house_for_date(user,'2026-08-10') = harnwell
users.home_house_id                          = quad
house_roster_as_of('harnwell','2026-08-10')  includes the worker  (1 row)
```

4. Write at the draft point (what `assignDraft` and `acceptAiSchedule` do):

```
INSERT INTO draft_block_assignments (period_id, block_id, user_id, created_by) ...
  ERROR: non-Harnwell workers may not staff Harnwell
  CONTEXT: enforce_harnwell_assignment_training() line 22 at RAISE
```

5. Write at the publish point (what `publish_schedule` steps 1 and 2 do):

```
INSERT INTO shift_block_assignments (block_id, user_id, status, vacancy_origin) ...
  ERROR: non-Harnwell workers may not staff Harnwell
  CONTEXT: enforce_harnwell_assignment_training() line 22 at RAISE
```

**Observed**: `enforce_harnwell_assignment_training`
(`supabase/migrations/20260527000005_schedule_builder.sql:378` to `:411`) reads
`users.home_house_id` at `:398` to `:401`, which is the cache for TODAY, and compares it to the
block's house with no reference to the block's own date. The trigger is attached to both
`shift_block_assignments` and `draft_block_assignments` (`:413` to `:421`, confirmed live in
`pg_trigger`).

Meanwhile both builder snapshots are deliberately forward looking. `getBuilderData` resolves the
roster with `house_roster_as_of` as of the build week
(`apps/web/lib/data/scheduleBuilder.ts:119` to `:125`), and `getAiScheduleContext` does the same
and then asserts `homeHouseId: houseId` for every roster member
(`apps/web/lib/data/aiSchedule.ts:193` to `:198`), so the AI validator's Harnwell check
(`packages/core/src/ai-schedule/validator.ts:116` to `:130`) passes for a transfer in while the
write point rejects it. `assignDraft` does not map the trigger's message
(`apps/web/lib/actions/builder.ts:64` to `:69` maps only `block_over_capacity`), so the raw
Postgres string is what the admin reads.

`AGENTS.md:602` states this case works: the AI payload's `homeHouseId` is "the built house,
correct for pre-building a transfer-in to Harnwell". It is not correct at the write point. That
note is stale and is part of this finding.

The mirror direction is also wrong, though it self heals: a worker whose cache still says
`harnwell` but who has a recorded transfer OUT effective mid period passes the trigger, so
publish can schedule them at the Harnwell desk on dates after they leave. `apply_house_transfer`
reopens their future old house seats when the hourly cron applies the move, so the invariant is
restored at the cost of newly vacant Harnwell seats that then escalate.

**Expected**: `AGENTS.md:104` to `:106` (invariant 1) is about who may staff the desk, which is a
property of the worker's membership ON THE SHIFT'S DATE. The trigger should compare the block's
house against `membership_house_for_date(NEW.user_id, (block_start_at AT TIME ZONE
'America/New_York')::date)`, which is the same helper the roster already uses, so the two sides
of the seam agree.

**Blast radius**: Every worker transferring into Harnwell for an upcoming season, and every
attempt to pre-build Harnwell across a transfer boundary, which is the documented reason the
forward looking roster exists. Harnwell is the 2 staff house. The admin's only route is to wait
until the transfer applies, by which time the season has started.

**Fix sketch**: New migration replacing the `users.home_house_id` read in
`enforce_harnwell_assignment_training` with `membership_house_for_date(NEW.user_id, <the block's
NY date>)`. Map the trigger's message in `apps/web/lib/actions/builder.ts` the way
`apps/web/lib/actions/override.ts:36` to `:41` already does. Correct `AGENTS.md:602`, and state
the date-scoped rule in `ARCHITECTURE.md` alongside the house transfer section.

**Acceptance check**: pgTAP extending `supabase/tests/house-transfers.sql`: a worker with a
future Harnwell membership may be drafted and published onto Harnwell blocks on or after the
effective date and rejected before it; a worker with a future transfer OUT of Harnwell is
rejected for Harnwell blocks on or after their effective date.

**Confidence**: verified in code and at runtime (rolled back).

---

### [P1] Accepting an AI proposal deletes the admin's hand built week first, and the failure message tells them to retry, which cannot restore it

**Journey**: An admin has spent an hour hand building a week. They run the AI to compare, decide
they like it, click Accept as draft, and the accept fails. Their hour of work is gone and the
error tells them to accept again.

**Trigger**:

1. Build a week by hand in the builder for any house.
2. Generate an AI proposal and click Accept as draft.
3. Make the insert fail. Any of these does it: a worker in the proposal has a pending Harnwell
   transfer in (previous ticket, raises the Harnwell trigger), a concurrent edit pushed a block
   to capacity (`block_over_capacity`), or the connection drops between the two round trips.
4. The delete has already committed. The insert has not. The draft week is empty.
5. The panel shows "Could not write the drafts: <message>. Accept again to retry." Accepting
   again re inserts the AI proposal, never the hand built week.

**Observed**: `apps/web/lib/actions/aiSchedule.ts:62` to `:76` performs the replace all DELETE in
its own chunked PostgREST calls, then `:80` to `:100` performs the INSERT in a separate call.
The module comment at `:24` to `:26` acknowledges this and states the recovery path incorrectly:
"Delete-then-insert spans two PostgREST calls (not one transaction); both steps are idempotent,
so the recovery path is simply re-accepting." Re accepting is idempotent with respect to the AI
proposal, not with respect to what was deleted. The error copy at `:96` to `:99` repeats the
same claim to the user. The chunked delete can also fail partway (`:72` to `:74` returns on the
first chunk error), leaving the week half cleared.

There is no undo: the panel's Discard (`AiSchedulePanel.tsx:290`) only clears the preview, and
nothing snapshots the prior drafts.

**Expected**: A replace all that can fail must be atomic, or must not destroy the prior state
until the new state is known good. Nothing in `BEHAVIORAL_SPECIFICATION.md:1364` to `:1366`
("The proposal is a draft, never a publish. Nothing reaches a worker's calendar until a human
publishes it") suggests accepting a proposal can destroy an existing draft.

**Blast radius**: Every admin who runs the AI on top of an existing draft, which the confirm
dialog explicitly anticipates: "This replaces {existingDraftCount} existing draft assignments"
(`AiSchedulePanel.tsx:600` to `:604`). No paid hours are lost, but an hour of an SM's work is,
and the message actively misdirects the recovery.

**Fix sketch**: Move the replace all into a single `SECURITY DEFINER` RPC that deletes and
inserts in one transaction, taking the period, the house's week block ids, and the assignment
array; `admin_seed_draft_schedule`
(`supabase/migrations/20260711000003_admin_seed_draft_schedule.sql:15`) is the existing shape to
follow, and it is already correctly locked to `service_role`. Until that lands, at minimum fix
the two false statements (the comment at `aiSchedule.ts:24` to `:26` and the user facing message
at `:96` to `:99`) and validate the payload against the Harnwell and capacity rules BEFORE the
delete rather than only against the pure validator, which does not see the DB triggers.

**Acceptance check**: Vitest or Playwright: with a non-empty existing draft, force the insert to
fail (seed a worker whose Harnwell membership is future dated) and assert the pre-existing draft
rows are still present afterwards.

**Confidence**: verified in code. The specific failure trigger is verified at runtime (previous
ticket).

---

### [P1] Publish can overwrite a seat a worker claimed seconds earlier, with no re-check on the write

**Journey**: A worker claims an open shift for next month and is told "Claimed. It is now in My
shifts." An admin publishes the period in the same second. The worker's seat is silently
reassigned to the drafted pattern worker and their claim is gone.

**Trigger**:

1. A period with a live open shifts feed (there is no publication gate on
   `is_assignment_claimable`, verified against the live catalog).
2. A worker claims a vacant seat on a block whose weekly slot has a drafted pattern user.
3. The claim commits after publish reads that block's counts and before publish's step 1 UPDATE
   reaches that row.
4. Publish sets `status = 'scheduled', user_id = <pattern user>` on the row the worker now holds.

**Observed**: `supabase/migrations/20260711000004_publish_skip_voided_blocks.sql:117` to `:127`.
The `vac` CTE selects seats on `status = 'vacant' AND vacancy_origin = 'never_assigned'`, but the
UPDATE's own predicate is only `a.assignment_id = v.assignment_id AND p.rn <= v_matched`. Under
READ COMMITTED, when the UPDATE re-evaluates its WHERE against a row version a concurrent
transaction just committed, that predicate still holds (the id did not change), so the claimed
seat is overwritten. `enforce_block_occupied_headcount` does not object: the grandfathering
branch at `20260726000010:66` to `:70` skips the check because the old status was already
occupied on the same block, and `shift_block_assignments_one_seat_per_worker` cannot see a
substitution (only a duplication).

A second, wider window: `v_vac_count` is read in a separate statement at `:91` to `:94` and drives
`v_matched` (`:102`), the step 2 branch (`:133`) and the step 3 normalisation (`:153` to `:169`).
A claim landing in that gap makes all three decisions on a stale count, so the pattern user is
silently not scheduled on that block and the vacant seat count is normalised wrong.

**Expected**: `supabase/AGENTS.md` "Seat writes and lock order" is unambiguous: "Every write to
`shift_block_assignments` must take its row lock **before** the availability check and repeat
the predicate on the write itself. A `FOR UPDATE` followed by an unpredicated
`UPDATE ... WHERE assignment_id = ANY(...)` is not a fix; that exact shape is what the
2026-07-26 concurrency audit found in `drop_shift`, `accept_swap` and `admin_assign_worker`."
`supabase/migrations/20260726000009_seat_write_compare_and_swap.sql` fixed that shape in the seat
write family and did not touch `publish_schedule`.
`ARCHITECTURE.md:498` asserts publish is safe because "the only paths that INSERT occupied rows
are the `publish_schedule` family, which already serialize on `scheduling_periods FOR UPDATE`".
That serialization is real (`20260711000004:44`) and it does prevent two concurrent publishes,
but it says nothing about a worker's single seat write, which is what this ticket is about.

**Blast radius**: Narrow window per block, but publish iterates every block of the house for the
whole period (thousands of blocks over seconds to minutes), and the open shifts feed is live for
the same period. The loser is a worker who received an HTTP 200 and a "Claimed" toast and holds
nothing, with no notification and no record.

**Fix sketch**: In `publish_schedule` step 1, add `FOR UPDATE` to the `vac` CTE (per block,
`LATERAL ... LIMIT 1 FOR UPDATE`, matching the pattern `20260726000010:377` to `:431` uses in
`admin_assign_worker`), re-assert `AND a.status = 'vacant' AND a.vacancy_origin =
'never_assigned'` on the outer UPDATE, and recompute the counts from `GET DIAGNOSTICS` rather
than from the earlier unlocked read before step 2 and step 3 branch on them. Correct the
`ARCHITECTURE.md:498` sentence so it does not read as a general safety claim for publish.

**Acceptance check**: `scripts/concurrency/race-harness.sh`, two sessions: session A begins
publish and pauses after the count read for one block, session B claims that block's vacant seat
and commits, session A resumes. Assert the seat still belongs to session B's worker and that
publish either skipped the block or raised. Per `supabase/AGENTS.md`, show the test failing
against the current body first.

**Confidence**: verified in code. The race itself is needs runtime check (two sessions).

---

### [P1] A season phase that reduces a house's headcount after the template week aborts the whole publish with a raw check violation

**Journey**: An admin authors a summer season where a house is double staffed for the first weeks
and single staffed afterwards, builds the first week, and clicks Publish. Publish fails with
"recurring slot (dow 3, 14:00:00) over-assigned: 2 pattern users > headcount 1" and nothing is
published.

**Trigger**:

1. Author a season with two `season_house_windows` rows for one house, the second with a LOWER
   band headcount than the first (the authoring model supports this: one editable window per
   house per date range, `season_house_windows_no_overlap` is date range only).
2. Apply the season, generating blocks with `required_headcount = 2` in weeks 1 and 2 and
   `required_headcount = 1` from week 3.
3. In the builder, fill the template week's double staffed slots with two workers each. The draft
   headcount trigger allows it, because that week's blocks really do have headcount 2.
4. Publish.

**Observed**: `supabase/migrations/20260711000004_publish_skip_voided_blocks.sql:96` to `:100`
compares `v_pat_count`, which is drawn from the template week only (`:81` to `:89`), against
`v_block.required_headcount`, which belongs to the block currently being iterated, and raises a
`check_violation` when the template week's headcount exceeds the later block's. Because
`publish_schedule` is a single transaction, the exception aborts the entire house's period. The
error names an ISO weekday number and a time of day, not a house, date or worker.
`publishScheduleAction` passes the raw message through
(`apps/web/lib/actions/builder.ts:176`), so that string is what the `builder-error` notification
shows.

The symmetric case is silent rather than loud: when the later phase INCREASES headcount, the
template week supplies fewer pattern users than the later blocks have seats, so the surplus seats
are left vacant with no signal, which is the same family as the Kings Court ticket above.

**Expected**: `AGENTS.md:547` claims publish needs no summer special cases, and
`packages/core/AGENTS.md` describes the compiler as deriving "one phase per change point", which
makes a per phase staffing change a first class authoring outcome. Publish must either resolve
its pattern per phase or cap the pattern at the iterated block's headcount and report the
shortfall, rather than aborting the whole period.

**Blast radius**: One house per season with a mid season headcount reduction. The whole period
cannot be published, so the house has no schedule at all until someone diagnoses a raw Postgres
message. The seeded summer season happens to use uniform bands across all six phases, which is
why this has not been hit yet.

**Fix sketch**: Same per phase template resolution as the Kings Court ticket. As a narrower
change: replace the raise at `:96` with `v_pat_count := LEAST(v_pat_count, required_headcount)`
plus a per block record of the overflow, and return the overflow count so the confirm dialog can
warn before the commit. Either way the error, if one is still raised, must carry the NY date,
time and house. Correct `AGENTS.md:547`.

**Acceptance check**: pgTAP: two window season with headcount 2 then 1 for one house, template
week filled to 2, publish. Assert publish completes and reports the number of pattern
assignments it could not place, or raises an error naming the date and house rather than a bare
weekday number.

**Confidence**: verified in code. No live instance on the current seed, so the specific error
text is needs runtime check.

---

### [P2] The builder grid offers voided blocks that publish silently discards, and the AI can target a different week than the grid shows

**Journey**: A house window was closed or downsized mid season, voiding some blocks. The admin
builds shifts onto cells the grid still renders, publishes, and those shifts simply do not exist.

**Trigger**: Any house with voided blocks inside the build week.
`getBuilderData` reads `shift_blocks` with no `voided_at` filter
(`apps/web/lib/data/scheduleBuilder.ts:101` to `:105`), so voided blocks render as ordinary
assignable cells. Publish skips them (`supabase/migrations/20260711000004:75`) and then deletes
the drafts anyway (`:172` to `:174`), so the assignment is discarded with no message and no
adjustment to the reported count.

A second, sharper symptom: `getAiScheduleContext` DOES filter voided blocks
(`apps/web/lib/data/aiSchedule.ts:78` to `:83`) and derives its template week from the earliest
non-voided block, while `getBuilderData` derives its week from the earliest block of any kind. If
a house's earliest blocks are voided the two disagree, and the AI's `day-fill` events paint into
`preview[blockId]` for a week the grid is not rendering. The panel then says "Draft ready in the
grid above" over an empty grid and offers Accept, which writes drafts for a week the admin never
saw. Live check: no house currently has its earliest block voided
(`earliest_any = earliest_live` for all 13), but `gregory` has 405 voided blocks and `quad` has
2, so the mechanism is reachable.

**Observed / Expected**: `AGENTS.md:552` to `:556` states voided blocks are "self-excluding on
every status-filtered read path" and that the orchestrator scan, `is_assignment_claimable` and
both house grid views carry an explicit `voided_at IS NULL` guard as defense in depth. The
builder read is the one on this journey that does not.

**Blast radius**: Only after a season re-apply voids blocks in a build week. No paid hours are
created wrongly, but the admin believes a shift is staffed when it is not, and the AI accept path
can write invisibly.

**Fix sketch**: Add `.is('voided_at', null)` to the `shift_blocks` read in
`apps/web/lib/data/scheduleBuilder.ts:101`, matching `aiSchedule.ts:81`. Assert in
`acceptAiSchedule` that `ctx.input.weekStartDate` matches the week the client was rendering
(pass it in the payload) and refuse with a clear message otherwise.

**Acceptance check**: Playwright with a voided block inside the build week: assert the cell is
not rendered as assignable. Vitest: `getBuilderData` and `getAiScheduleContext` return the same
`weekStartDate` for a house whose earliest blocks are voided.

**Confidence**: verified in code, with the live reachability checked.

---

### [P2] Nothing tells a worker their schedule went live

**Journey**: A period is published. Dozens of workers now have scheduled hours. No push, no
in-app notification, nothing. They find out if and when they next open the app.

**Observed**: `publish_schedule` (`supabase/migrations/20260711000004_publish_skip_voided_blocks.sql`,
whole body) contains no `notifications` write of any kind, and no `notification` string at all.
`period_house_publications` has no trigger. The web action revalidates two paths
(`apps/web/lib/actions/builder.ts:178` to `:179`) and returns.

BSpec 4.3 Phase 3 (`BEHAVIORAL_SPECIFICATION.md:398`) says "When the SM publishes the schedule,
it becomes live. Workers can see their assignments", which describes a pull model. BSpec 10.1
enumerates mandatory personal notifications as "your own shift was dropped, you've been assigned
a float, your acknowledgment is overdue" and does not include a published schedule. So the
absence is defensible, but it is nowhere recorded as a decision, in either spec or in
`docs/qa/ACCEPTED-RISKS.md`, and BSpec 10.1 does emit a personal notification for the much
smaller event of being removed from one recurring slot ("Worker in-app notifications").

**Expected**: Either a personal in-app notification per worker on publish, consistent with the
notification BSpec 10.1 already mandates for a single slot removal, or an explicit sentence in
BSpec 4.3 Phase 3 stating that publishing is silent by design and why. A worker learning about a
whole semester of hours only by opening the app is a product decision, not an implementation
detail.

**Blast radius**: Every worker at every publish. Nobody is misinformed, so this is not a P0, but
the first thing they learn about their semester may be a shift starting in two hours.

**Fix sketch**: Decide the product question first. If a notification is wanted, emit one row per
distinct `user_id` publish scheduled, inside the same transaction, reusing the existing
notification insert helpers so `deliver_pending_notifications` picks it up. If silence is wanted,
add the sentence to BSpec 4.3 Phase 3 and an entry to `docs/qa/ACCEPTED-RISKS.md`.

**Acceptance check**: pgTAP: after a publish that schedules N distinct workers, assert either N
notification rows of the agreed kind, or a documented zero with the spec sentence in place.

**Confidence**: verified in code.

---

### [P2] Removing a shift never reverts its optimistic state when the write fails

**Journey**: The admin removes a shift while the edge runtime is down or the network drops. An
error banner appears, and the shift stays gone from the grid. It is still in the database.

**Observed**: `onRemoveSpan` (`apps/web/components/builder/ScheduleBuilder.tsx:455` to `:470`)
mutates local `drafts` at `:457` and then awaits `runWrite(...)` at `:466` without inspecting the
result at all. Every sibling handler does revert: `commitAssign` at `:440` to `:448`,
`onRemoveWorker` at `:529`, `onClearAll` at `:545`. `runWrite` does surface the error
(`:174`), so the admin is not told nothing, but the grid and the database now disagree and the
error banner does not say which shift it refers to. `onResizeShift` routes the shrink half of
every resize through `onRemoveSpan` (`apps/web/components/builder/useResizeShift.ts:34`), so a
failed resize leaves the shift visually shortened and actually unchanged.

`apps/web/AGENTS.md` "Known traps" names this exact shape: "Edge runtime down means silent write
no-ops. If a write succeeds in-app but never lands in the DB, check `supabase_edge_runtime`."

**Expected**: The same revert every sibling handler performs.

**Blast radius**: Admins during a runtime or network fault. The state resolves on the next tab
focus refresh (`ScheduleBuilder.tsx:140` to `:152`), so it is recoverable alone, which is why
this is P2 and not P1.

**Fix sketch**: Snapshot `drafts` before the optimistic mutation in `onRemoveSpan` and restore it
on `!res.ok`, exactly as `onRemoveWorker` does at `ScheduleBuilder.tsx:519` to `:529`.

**Acceptance check**: Playwright with the server action stubbed to fail: remove a shift, assert
the shift is still rendered and the error banner is shown.

**Confidence**: verified in code.

---

### [P3] User facing builder and override copy contains em dashes

**Journey**: Any admin reading the builder's narrow screen notice, a Phase 2 advisory, or an
override error.

**Observed**: Three user visible strings on this journey contain U+2014:

- `apps/web/components/builder/ScheduleBuilder.tsx:616`, between "Building a week needs a wide
  canvas" and "open this on a larger screen."
- `apps/web/components/builder/ScheduleBuilder.tsx:930`, between "Opted out" and "no hours". This
  string is also the Phase 2 advisory label surfaced in the assign confirm dialog.
- `apps/web/lib/actions/override.ts:48`, between "That shift has already started" and "it can no
  longer be edited."

The same U+2014 appears in the spec sentence the second string was copied from,
`BEHAVIORAL_SPECIFICATION.md:394`, so the spec needs the same correction or the rule will be
reintroduced from it.

**Expected**: `AGENTS.md:164` to `:170`: "Any string a user can ever see or that is stored for
later display ... must NOT contain an em dash or en dash. Re-punctuate with a period, comma,
colon, or parentheses."

**Blast radius**: Cosmetic. Nothing lost, nothing blocked.

**Fix sketch**: Re-punctuate all three with a colon or a period, and correct
`BEHAVIORAL_SPECIFICATION.md:394` so the label is not copied back in. The other builder files
(`AiSchedulePanel.tsx`, `Grid.tsx`, `WorkerFocusPanel.tsx`, `BuilderSideDock.tsx`,
`SideEmptyPanel.tsx`, `aiSchedule.ts`, the ai-generate route) are already clean.

**Acceptance check**: A repo hook or grep asserting no U+2014 or U+2013 in JSX text nodes and
string literals under `apps/web/components` and `apps/web/lib/actions`.

**Confidence**: verified in code.

---

## Verified clean

Surfaces I walked and believe are genuinely sound, with the guard that makes them sound.

**The Harnwell training invariant IS enforced at the publish write point.** Not by
`publish_schedule` itself, which trusts the layer below it, but by
`shift_block_assignments_enforce_harnwell_training`, confirmed attached in the live `pg_trigger`
as `BEFORE INSERT OR UPDATE OF block_id, user_id`. Publish's step 1 sets `user_id` and step 2
INSERTs, so both fire it; step 3's vacant inserts leave `user_id` NULL and are correctly skipped
at `20260527000005:388`. The DATE the trigger evaluates against is wrong (P1 above), but the
write point is covered and a non-Harnwell worker cannot be published onto Harnwell today.
Verified at runtime: the INSERT raises.

**Block atomicity (invariant 5) holds across the drag and resize path.** `validateDragSpan`
(`packages/core/src/scheduling/scheduleBuilderCard.ts:45` to `:59`) requires every consecutive
pair to be exactly 1800000 ms apart, computed from `Date` timestamps, so a span that crosses a
day gap or a DST discontinuity is rejected as `not_contiguous` rather than silently accepted.
`useResizeShift` (`apps/web/components/builder/useResizeShift.ts:29` to `:35`) only ever adds and
removes whole `blockId`s; there is no sub-block arithmetic anywhere in the resize path. The
`spanValid` gate (`ScheduleBuilder.tsx:327` to `:328`) is what stops an invalid span from
reaching a card.

**The recurring weekly pattern is DST correct.** `publish_schedule` keys its slot on
`extract(isodow FROM (block_start_at AT TIME ZONE 'America/New_York'))` and
`(block_start_at AT TIME ZONE 'America/New_York')::time`
(`20260711000004:71` to `:72`, `:88` to `:89`), so 09:00 NY in June and 09:00 NY in November map
to the same slot across the transition. This matches `AGENTS.md` invariant 6 and the claim at
`ARCHITECTURE.md:703` to `:704`. The one theoretical hazard, two blocks sharing an
`(isodow, time-of-day)` key on the fall-back Sunday, needs a house open during 01:00 to 02:00 NY;
live blocks run 10:00 to 23:30 and the seeded profiles run 08:00 to 24:00, so it is not reachable
on any configuration I could find. A 24 hour season band would make it reachable, which is worth
a pgTAP case but is not a finding today.

**Two admins publishing the same period cannot interleave, and double publish is guarded.**
`publish_schedule` takes `SELECT * INTO v_period FROM scheduling_periods WHERE period_id = ...
FOR UPDATE` as its first statement (`20260711000004:44`), which serialises the whole loop per
period, and then rejects a house that already has a `period_house_publications` row with
`unique_violation` (`:54` to `:58`). A double click cannot reach it twice anyway: `onPublish`
closes the confirm modal synchronously before awaiting
(`ScheduleBuilder.tsx:589` to `:592`), so the button is unmounted. The confirm dialog's warning
"This cannot be undone for the period" (`:917` to `:920`) is TRUE: there is no unpublish path
anywhere in the source tree.

**Season applies cannot overlap each other or a preview.**
`20260726000007:114` takes `pg_try_advisory_xact_lock(hashtext('shift.orchestrator'), 2)`
non-blockingly and returns an actionable `apply_in_progress` outcome rather than an exception,
and the dry run deliberately takes the same lock. The guarded wrapper's grants are correct
(`anon=false`, `authenticated=false`, `service_role=true`, verified live). The hole is the inner
`_unguarded` name, filed as P0 above; the lock design itself is sound.

**Aborting an AI run mid generation leaves the draft untouched.** Generation is read only:
`app/api/schedule/ai-generate/route.ts` writes nothing, and its header comment says so
correctly ("drafts are written only by the acceptAiSchedule action"). The client's Stop and Stop
and clear both abort the fetch, which the route sees as `cancel()` and turns into an
`AbortSignal` that stops further paid model calls (`route.ts:204` to `:208`), and the route skips
building or sending a result when aborted (`:170` to `:173`). A stream that breaks on its own
keeps the days that already settled rather than discarding them
(`AiSchedulePanel.tsx:236` to `:251`), and says how many.

**The AI cannot produce a hard-infeasible proposal that reaches a draft.** Three layers:
`pruneToFeasible` runs per day and drops unknown references, duplicates, `cannot` conflicts,
Harnwell violations, over headcount and over cap
(`packages/core/src/ai-schedule/loop.ts:276` to `:359`); the finalize pass is re-validated after
it runs and the loop returns `best: null` with a recorded note if it is infeasible
(`loop.ts:206` to `:224`), which the route turns into a clear failure
(`route.ts:188` to `:190`); and `acceptAiSchedule` re-validates the returned payload against a
FRESH snapshot before writing (`apps/web/lib/actions/aiSchedule.ts:51` to `:57`), which is also
what rejects a forged payload. A malformed model response is handled the same way: `parseProposal`
turns it into violations that feed the repair prompt rather than throwing.

**Over-target hours are visible before the admin accepts.** The AI's finalize pass bounds only on
`capHours` (`finalize.ts:57` to `:62`) and uses `targetHours` only to order candidates (`:183`),
so a proposal can exceed a worker's requested hours. That is not silent: the proposal DTO carries
per worker `hours` and `targetHours` (`apps/web/lib/ai/proposal.ts:113` to `:120`) and the panel
renders a "Hours vs target" row with an amber over or under tag whenever the gap exceeds 2 hours
(`AiSchedulePanel.tsx:537` to `:551`). The manual path's over-target confirm
(`ScheduleBuilder.tsx:575` to `:582`, plus the `over_target` advisory in `admin_assign_worker`)
is stricter, but the AI path informs rather than hides, so I am not filing it.

**`hours.ts` does not disagree with `20260724000001`.**
`checkClaimAgainstCap` (`packages/core/src/scheduling/hours.ts:63` to `:79`) consumes
`hoursCap` and `capEnforcement` and returns a warning rather than a refusal on a soft cap, which
is exactly the (20, soft) / (40, hard) contract `effective_weekly_cap` now returns after the
profile lookup was restored. Neither is used at the publish write point; publish applies no cap,
which matches `AGENTS.md` invariant 4 (the cap governs claim, swap and pickup) and BSpec's
treatment of build time targets as advisory. `effective_weekly_cap` is per week and per override
row only, never per user or per house, so there is no per user cap for publish to have missed.

**Builder reads do not hit the 1000 row PostgREST cap.** Both `getBuilderData:101` and
`getAiScheduleContext:78` order ascending and then filter to a 7 day window, so the ~266 blocks a
week needs are inside the first page regardless of how many blocks the house has in total. The
preference, target and draft reads are all chunked through `selectByBlockIdChunks` at 100 block
ids per call, which is also what avoids the HTTP 414 trap. The AI roster is bounded by the house
roster (tens of rows), not by blocks, so the truncated-roster hazard I was asked to look for does
not exist on this path.

**Cross-house authorization on the web write paths targets the viewed house.** `page.tsx:28`
uses `writeHouseId(user, house, validHouseIds)`, `publishScheduleAction` gates on
`canBuildForHouse(me, input.houseId)` where `houseId` is the builder's loaded house
(`apps/web/lib/actions/builder.ts:165` to `:168`), the ai-generate route gates on the same
(`route.ts:79`), `acceptAiSchedule` on the same (`aiSchedule.ts:34`), and
`authorizeForBlocks` resolves each block's real house from the DB and pins a non schedule admin
to `adminHouseId` (`apps/web/lib/actions/override.ts:80` to `:95`). The `AGENTS.md:514` claim
that the 3-arg `publish_schedule` rides `user_can_build_schedule` and that the draft admin RLS
was swapped away from `user_has_house_admin_role` is TRUE against the live catalog; the swap
itself is the P0 above, but the note is accurate.

---

## Not checked

- **The actual committing `publish_schedule` call, and `apply_compiled_season` in any form.**
  Deliberate. Two other agents are running slices 7 and 8 against this Postgres instance, and
  both writes are destructive across a house. Every publish finding above is grounded in the
  function body plus targeted read-only catalog queries plus single-row probes inside rolled back
  transactions. The pieces I could not close that way are marked needs runtime check in their own
  tickets.
- **The AI generation loop against a real model.** No `ANTHROPIC_API_KEY` was exercised and I did
  not run `apps/web/ai-probe.mts`. Every AI finding is from the pure core and the route or panel
  code. Specifically unverified: what the client does when the 300 second `maxDuration` at
  `route.ts:20` kills the route mid run. The worst case documented in `loop.ts:48` is 29 sequential
  calls and `route.ts:57` records a single call measured at over 50 seconds, so the budget can be
  exceeded, and a runtime kill closes the connection without sending an `error` event. The panel's
  own stream-broke branch (`AiSchedulePanel.tsx:236` to `:251`) looks like it handles that
  correctly, which is why I am not filing it, but I did not observe it.
- **`prompt.ts` and `scorer.ts` and `weights.ts` in depth.** I read `validator.ts`, `finalize.ts`,
  `loop.ts` and the alignment helpers, which is where the invariant enforcement lives. Prompt
  wording and score weighting affect proposal quality, not correctness, and a bad proposal is
  gated by the validator and by a human accept.
- **`crossHousePickup.ts` and `phase1Grouping.ts`.** Reached only through the Phase 1 and Phase 2
  card view models, which are advisory display logic; nothing on the publish write path consumes
  them.
- **The dev sim clock and the time-travel gate** (`20260611000007`, `20260726000008`). I confirmed
  `getAiScheduleContext` correctly routes its deadline check through the
  `preference_deadline_is_open` RPC rather than `Date.now()` (`aiSchedule.ts:119` to `:122`) and
  that `override.ts:125` uses `simNow()`, but `publish_schedule` reads bare `now()` at
  `20260711000004:198` for `published_at` and I did not work out whether that is intended to
  respect `app_now()`. `apply_compiled_season_unguarded` does use `app_now()`.
- **Whether the `anon` grant on `house_roster_as_of`** (which is what leaks the qualifying uuid in
  the publish P0) is part of the batch A anon class or new. It is a read, not a seat write, so it
  is outside the enumerated list, but I filed it as evidence inside the publish ticket rather than
  as its own finding to avoid splitting one class.
- **Mobile.** The mobile app is worker only and has no builder or publish surface, so the only
  mobile code on this journey is the claim error mapping I cite in the phantom-seat P0. I did not
  run any simulator.
- **`preferences` and `period_targets` RLS.** `20260627000002:100` to `:151` applied the identical
  sm-excluding substitution to both. That is slice 8's surface and is flagged there for merge
  rather than filed here.
