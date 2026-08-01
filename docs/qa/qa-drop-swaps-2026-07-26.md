# Ship Check: drop, permanent drop, and swaps (COVERAGE slices 3 + 4)

Date: 2026-07-26. Commit: `21f98fe` (branch `fix/seat-write-concurrency`).
Stack: local Supabase up; all grant and behavior claims below were checked against the running
catalog, not against migration text.

Already ticketed elsewhere, cited and not re-filed: `worker_open_shifts` is `anon`-readable and
`claim_open_shift` / `fire_worker` / `hire_worker` / `user_has_house_admin_role` are
`anon`-EXECUTE-able; the open-shifts feed truncates at PostgREST's 1000-row cap; firing a manager
sets only `is_active`. Ticket P0-1 below names four **additional** functions in that same class,
which the handoff explicitly asks to be reported by name.

Nothing in `docs/qa/ACCEPTED-RISKS.md` is re-raised, and no registered risk is challenged.

---

### [P0] Any anonymous caller can vacate a worker's shift, force a swap through, and expire every pending swap

**Journey**: a worker holds a scheduled shift. Someone who has never signed in takes it away.

**Trigger**:

1. Take the published local `anon` key (in production, the publishable key that ships in every
   web bundle and every mobile binary).
2. `POST /rest/v1/rpc/drop_shift` with `{"p_assignment_ids":["<victim seat>"],"p_user_id":"<victim user_id>"}`.
3. The seat is vacated. No session, no bearer token for any user, no RLS.

**Observed**: `drop_shift`, `accept_swap`, `apply_permanent_swap` and `expire_pending_swaps` are
all `SECURITY DEFINER` and all hold `EXECUTE` for `anon` **and** `authenticated` in the live
catalog, and every one of them takes the acting user's identity as a **parameter** rather than
from `auth.uid()`.

Live catalog (`has_function_privilege`, run 2026-07-26):

```
accept_swap             | anon=t | authenticated=t | secdef=t
apply_permanent_swap    | anon=t | authenticated=t | secdef=t
drop_shift              | anon=t | authenticated=t | secdef=t
expire_pending_swaps    | anon=t | authenticated=t | secdef=t
permanent_drop_slot     | anon=f | authenticated=f | secdef=t   <- correctly revoked
permanent_pickup_slot   | anon=f | authenticated=f | secdef=t   <- correctly revoked
```

Probe, with the identity established inside the same command and both controls asserted:

```
JWT payload sent as apikey and bearer: {"iss":"supabase-demo","role":"anon","exp":1983812996}
NEGATIVE CONTROL, same headers: GET /rest/v1/users?select=user_id&limit=1  -> 200 []
POSITIVE CONTROL, service_role: same URL                                   -> 200 [{"user_id":"a0000000-..."}]
   (so the [] above is our identity, not an empty table)

BEFORE: 4c7a20e7-... | user fbb00000-...008 | scheduled | vacancy_origin none | dropped_by NULL
ATTACK: POST /rest/v1/rpc/drop_shift {"p_assignment_ids":["4c7a20e7-..."],"p_user_id":"fbb00000-...008"}
        -> HTTP 200 {"dropped_assignment_ids":["4c7a20e7-..."],"short_notice_warning":false,...}
AFTER:  4c7a20e7-... | user NULL | vacant | vacancy_origin temporary_drop | dropped_by fbb00000-...008
```

The side effect is real, not a status-code inference: the row changed and the fixture was restored
by exact primary key afterwards.

Two more, same identity, same run:

```
POST /rest/v1/rpc/accept_swap {"p_swap_id":"<pending handoff>","p_accepting_user_id":"<counterparty>"}
  -> 200 {"accepted": true};  seat owner moved 008 -> 009, swap status pending -> accepted
POST /rest/v1/rpc/expire_pending_swaps {"p_now":"2099-01-01T00:00:00Z"}
  -> 200, returned 1; pending swaps before=1 after=0
```

`accept_swap` checks `p_accepting_user_id <> v_swap.counterparty_user_id` and nothing else, so an
outsider who learns a `swap_id` can force a swap through **without the counterparty ever tapping
Accept**. `expire_pending_swaps` takes `p_now` from the caller, so a single call with a far-future
timestamp kills every pending swap on campus.

Where the grants come from: `supabase/migrations/20260724000006_revoke_permanent_ops_client_execute.sql:38-44`
revoked exactly three functions (`permanent_pickup_slot`, `permanent_drop_slot`, `permanent_drop`).
`supabase/migrations/20260726000009_seat_write_compare_and_swap.sql:41`, `:166` and `:395` then
re-created `drop_shift`, `accept_swap` and `apply_permanent_swap` with **no** `REVOKE` block at all
(the file contains none), so Supabase's `ALTER DEFAULT PRIVILEGES` grants were re-applied at CREATE
time. `expire_pending_swaps` was granted to `service_role` at
`supabase/migrations/20260530000001_phase_09_swaps.sql:558` and never revoked from the other two.

**Expected**: these are service-role-only orchestration RPCs. Every legitimate caller goes through
an Edge Function that derives the actor from the bearer token
(`supabase/functions/drop-shift/index.ts:106` passes `p_user_id: user.id`;
`supabase/functions/accept-swap/index.ts:55,65` pass `auth.userId`). Per `supabase/AGENTS.md`,
"a function meant to be service-role-only needs `REVOKE EXECUTE ON FUNCTION <fn> FROM anon,
authenticated;` naming those roles explicitly, in the same migration that creates or changes it."

**Blast radius**: every seat and every swap in the system, from an unauthenticated client. The
assignment ids needed are visible to any signed-in housemate through the home-house RLS clause on
`shift_block_assignments`, and vacated seats surface in the anon-readable `worker_open_shifts`.

**Fix sketch**: new migration adding
`REVOKE EXECUTE ON FUNCTION drop_shift(uuid[], uuid, timestamptz), accept_swap(uuid, uuid, timestamptz), apply_permanent_swap(uuid, uuid, uuid[], timestamptz), expire_pending_swaps(timestamptz) FROM anon, authenticated;`
and add the same `REVOKE` block to the tail of any future migration that re-creates them. Add a
pgTAP assertion naming `anon` and `authenticated` explicitly, as `supabase/AGENTS.md` requires.

**Acceptance check**: as `anon`, `POST /rest/v1/rpc/drop_shift` on a live seat returns 401/403 and
the row is unchanged; the `drop-shift` Edge Function still succeeds for the seat's owner.

**Confidence**: verified in code and by probe (identity printed, side effect verified, fixture
restored).

---

### [P0] Accepting a permanent swap can take every one of the initiator's shifts, not just the slot they agreed to

**Journey**: two workers agree to trade one recurring Monday 17:00 slot. The counterparty taps
Accept and walks away with the initiator's whole semester.

**Trigger**:

1. Worker A proposes a `permanent_swap` to worker B with
   `recurring_pattern = {house_id: harnwell, day_of_week: 1, block_start_locals: ["17:00"]}`.
2. B (or B's client, or anyone with B's session) POSTs `accept-swap` with
   `{"swap_id": "...", "affected_assignment_ids": [<every assignment_id of A's that B can read>]}`.
   Any housemate can enumerate those ids: the `shift_block_assignments` SELECT policy exposes every
   assignment at the reader's home house, `user_id` included.
3. All of them transfer.

**Observed**: `supabase/functions/accept-swap/index.ts:41-52` honours a caller-supplied
`affected_assignment_ids` verbatim (the comment at `:37-40` asserts "a generous list is safe").
`apply_permanent_swap` (`supabase/migrations/20260726000009_seat_write_compare_and_swap.sql:445-458`)
filters only on `assignment_id = ANY (p_affected_assignment_ids)`, ownership by the initiator,
`status IN ('scheduled','claimed')`, and the block's date being `regular_school_year`. It never
consults `swap_requests.recurring_pattern`, never checks house / weekday / block-start-time, and
has **no `block_start_at > p_now` filter** (the future filter lives only in
`resolve_permanent_swap_affected`, which the override bypasses).

Probe, as the real counterparty (identity resolved by GoTrue inside the same run):

```
GoTrue /auth/v1/user for the token used: fbb00000-...009  liseche1@nursing.upenn.edu
agreed scope per the server's own resolve_permanent_swap_affected(swap): 0 assignment(s)
BEFORE: fbb00000-...008 owns 12 assignments (Mon 17:00-19:30 and Wed 16:00-18:30)
POST /functions/v1/accept-swap {"swap_id":..., "affected_assignment_ids":[<all 12>]}
  -> HTTP 200 {"accepted":true,"transferred_count":12}
AFTER:  fbb00000-...009 owns all 12
```

Six hours of another worker's shifts, across two weekdays, from a swap whose stated scope was one
30-minute Monday block. Rows restored by exact primary key afterwards.

No shipped client ever sends `affected_assignment_ids` (web `acceptSwap` at
`apps/web/lib/actions/worker/swaps.ts:26` sends only `swap_id`; mobile
`WorkerShiftsRepository.acceptSwap` at
`apps/mobile/shared/src/commonMain/kotlin/com/pennhousing/shift/shared/data/WorkerShiftsRepository.kt:1073-1075`
sends only `swap_id`). The parameter is pure attack surface today.

**Expected**: BSpec 8.3 line 827: "the swap is executed across all affected future shift
assignments ... The operation applies only to weeks where Worker A currently owns the slot."
The slot, not an arbitrary list. BSpec 1.6 line 82: "no action ever silently overwrites a seat that
changed hands after it started."

**Blast radius**: any worker who is ever named as the counterparty of a permanent swap, or anyone
holding that worker's session. Silent: the initiator gets no notification of a permanent swap
acceptance at all.

**Fix sketch**: in `supabase/functions/accept-swap/index.ts`, drop the
`affected_assignment_ids` override entirely and always call `resolve_permanent_swap_affected`. In
`apply_permanent_swap`, intersect `p_affected_assignment_ids` with the swap's own
`recurring_pattern` (house, NY weekday, block-start locals) and add
`AND sb.block_start_at > p_now`, so a generous list cannot widen the scope even if the parameter
survives.

**Acceptance check**: a pgTAP test that creates a permanent swap for one weekday/time, calls
`apply_permanent_swap` with an id list containing a seat on a different weekday, and asserts
`transferred_count = 1` and the off-pattern seat is untouched. Revert the intersect and watch it
go red.

**Confidence**: verified in code and by probe (identity established via GoTrue, write verified,
state restored).

---

### [P0] The web portal says "Swap accepted." when the server refused the swap

**Journey**: a worker opens `/home/swaps` on the web, taps Accept on an incoming swap, sees a green
"Swap accepted." and stops worrying about that day. The swap did not happen.

**Trigger**:

1. Worker A proposes a handoff of a shift to worker B.
2. Anything invalidates the span before B accepts: A drops it, an admin reassigns it, a competing
   swap lands, or B is not eligible.
3. B taps Accept on the web.

**Observed**: `accept_swap` signals a refusal in the **body**, not the status code, and the Edge
Function passes the body through with HTTP 200 (`supabase/functions/accept-swap/index.ts:60` and
`:69`, both `return jsonResponse(data)` with the default status 200).

Probe against the running Edge Function, as the counterparty:

```
POST /functions/v1/accept-swap {"swap_id":"4444...4444"}
  -> HTTP 200
  -> {"reason":"span_invalidated","accepted":false}
  -> swap status now: voided;  seat owner unchanged
```

`apps/web/lib/actions/worker/swaps.ts:23-30` treats any 2xx as success (`if (!res.ok) ...; return
{ ok: true }`), and `apps/web/components/worker/Swaps.tsx:231-235` then toasts `'Swap accepted.'`.
Every refusal reason reaches the worker as a green success: `span_invalidated`, `not_pending`,
`not_counterparty`, `harnwell_training_required`, `block_in_pending_float`,
`use_apply_permanent_swap`, and `apply_permanent_swap`'s `not_pending` / `not_permanent_swap`.

**Mobile gets this right**, which is what makes it a seam and not a shared blind spot:
`apps/mobile/shared/src/commonMain/kotlin/com/pennhousing/shift/shared/network/WriteFeedback.kt:59-65`
(`swapAccepted(body)`) exists precisely for this, and both hosts call it
(`apps/mobile/androidApp/src/main/java/com/pennhousing/shift/MainActivity.kt:855`,
`apps/mobile/iosApp/iosApp/ContentView.swift:1966`). The web never got the equivalent.

**Expected**: BSpec 1.6 line 82: "The person who loses the race is **told they lost** ... A worker
who is told their claim, drop, pickup, or swap succeeded genuinely holds what they were told they
hold."

**Blast radius**: every web worker who accepts a swap that the server declines. The
`span_invalidated` path is not exotic: it is exactly what fires when the shift is dropped or
reassigned between proposal and acceptance, and it is the path a drop racing an accept is
_designed_ to take.

**Fix sketch**: in `apps/web/lib/actions/worker/swaps.ts`, parse the response body in `acceptSwap`
and return `{ ok: false, error: reason }` when `accepted === false`; map the reason codes to human
copy (the mapping already exists in `WriteFeedback.kt` and should be mirrored, not reinvented).
`rejectSwap` and `voidSwap` already read their own booleans and are fine.

**Acceptance check**: a Playwright test that stubs `accept-swap` with
`200 {"accepted":false,"reason":"span_invalidated"}` and asserts the red toast, not the green one.

**Confidence**: verified in code and by probe against the running Edge Function.

---

### [P0] Accepting a swap or handoff puts one worker on two desks in the same 30-minute block, and the abandoned desk never escalates

**Journey**: worker B is scheduled at Hill at 20:00. Worker A hands B their Harnwell 20:00 shift.
B accepts. B works one desk. The other desk is empty all evening and the system never notices.

**Trigger**:

1. Worker B holds any seat at 2026-08-01 20:00 ET at house X.
2. Worker A, at house Y, opens `/home/swaps` on the web, taps the compose button, and picks B from
   the counterparty list. That list is every active worker campus-wide
   (`apps/web/lib/data/worker/swaps.ts:161`, `worker_directory` with no house filter), and the
   shift list is A's own 20:00 shift.
3. B accepts. Both seats are now B's.

**Observed**: neither `create-swap` nor `accept_swap` performs any time-conflict check.
`packages/core/src/swaps/eligibility.ts:43-85` checks only pending-float, Harnwell training, and
float direction. `accept_swap` transfers `user_id` with no overlap predicate. The
`shift_block_assignments_one_seat_per_worker` unique index is on `(block_id, user_id)`, so it stops
two seats of the _same_ block and does nothing about two different houses' blocks at the same
instant.

Probe, run inside a transaction and rolled back:

```
BEFORE: seats held by fbb00000-...009 at 2026-08-01 00:00Z
        hill | claimed
accept_swap(handoff of a harnwell seat at the same instant) -> {"accepted": true}
AFTER:  seats held by fbb00000-...009 at 2026-08-01 00:00Z
        hill     | 2026-08-01 00:00:00+00 | claimed
        harnwell | 2026-08-01 00:00:00+00 | scheduled
ROLLBACK; post-rollback sanity: 0 leftover swap rows, seat owner back to 008
```

The second-order harm is the serious one. Both seats read as occupied, so
`block_has_present_worker` returns true for both blocks, so per the coverage floor in
`orchestrator-tick` neither desk ever escalates. Nobody is broadcast to, no float is looked up, no
Allied cover is procured. The desk B does not physically attend is simply empty, and the first
person to find out is whoever walks up to it.

**Expected**: BSpec 1.6 line 86: "**A worker is never double-booked across houses.**" BSpec 5.3
line 545 states the check for claims ("The claimed blocks must not overlap any block the worker is
already assigned to that week (at any house, in any status)"); `claim_open_shift` implements it
(the race harness's F8 case proves it), and the swap path does not.

**Blast radius**: any cross-house handoff or swap. Web exposes the whole campus directory, so this
is one dropdown selection away. Mobile picks counterparties from the same house's grid, so the
mobile composer is narrower, but the mobile app can still receive and accept a cross-house handoff
created on web.

**Fix sketch**: add the time-conflict predicate to `swap_acceptance_ineligibility_reason` (it is
already the single place `accept_swap` consults for receiver eligibility): for each transferred
seat, refuse if the receiver already holds an occupied seat at the same `block_start_at` at a
different `block_id`. Mirror it in `packages/core/src/swaps/eligibility.ts` as the create-time
pre-check, and add the same predicate to `apply_permanent_swap`.

**Acceptance check**: pgTAP that gives the receiver a seat at house X at time T, offers them a
handoff at house Y at time T, and asserts `accept_swap` returns
`{"accepted":false,"reason":"time_conflict"}` with both seats unmoved.

**Confidence**: verified in code and by probe (rolled back, post-rollback state re-asserted).

---

### [P0] Dropping a float destination seat strands the desk: no escalation, no claim, no notification

**Journey**: a worker was floated to another house and acknowledged it. Something comes up and they
drop that shift. The destination desk is now empty for the rest of the evening and no part of the
system reacts.

**Trigger**:

1. House Y's 20:00 block goes empty, escalates, and is covered by an acknowledged float of worker W
   from house X. `block_step_status` for that block now holds `broadcast: fired` and
   `float_lookup: fired`, and `shift_blocks.coverage_locked_at` is set (the T-2h one-way lock).
2. W drops that shift. The card is in their My Shifts list (`worker_my_shifts` maps `floated_in` to
   `kind = 'float_out'` with `pending = false`), and the mobile manage sheet offers Drop for every
   card kind (`apps/mobile/shared/.../shifts/Shifts.kt:258` returns `canDropOccurrence = true`
   unconditionally; the Drop button at
   `apps/mobile/androidApp/.../ui/manage/ManageShiftSheet.kt:393-394` is never gated on kind).
   `drop_shift` accepts `floated_in` and `pending_float_in` in its status list.

**Observed**, probed in a rolled-back transaction against the live functions:

```
STEP 1  drop_shift([float destination seat], W) -> succeeds
STEP 2  seat status              = vacant / user_id NULL
        float_assignments status = acknowledged      <- the float record still says W is covering
        escalation steps         = broadcast:fired, float_lookup:fired
        block_has_present_worker = false             <- the desk is empty
        is_assignment_claimable  = false             <- and nobody can pick it up
```

Three independent things are wrong at once:

- The float is not invalidated. `drop_shift`
  (`supabase/migrations/20260726000009_seat_write_compare_and_swap.sql:41-...`) clears
  `parent_float_id` on the seat but never touches `float_assignments`. Nothing else does either:
  there is no trigger on `shift_block_assignments` that writes `float_assignments` (the only
  triggers are `enforce_harnwell_assignment_training`, `enforce_block_occupied_headcount`, and
  `void_pending_swaps_for_vacated_seat`).
- No re-escalation is possible. `claimStep` in `supabase/functions/orchestrator-tick/index.ts:324-346`
  re-claims a step only when its status is `rolled_back`; a step left at `fired` is retired for that
  block forever. Every step that produced the float is at `fired`.
- The seat is not claimable either, because `is_assignment_claimable` refuses any block with
  `coverage_locked_at IS NOT NULL`, and the lock is one-way by design.

So the seat is simultaneously unescalatable and unclaimable, with a float record asserting cover
that does not exist.

**Expected**: BSpec 5.2 line 516: "A worker who is currently assigned to a float (or is actively
floating) may drop their shift. **The float assignment becomes invalid**; the destination desk now
has a coverage gap that triggers a new float lookup (Section 5.5)." BSpec 5.5 line 599: "**The
float destination** goes through float lookup immediately (skipping the broadcast step) ... The
float lookup runs with the dropping worker excluded; if it fails, escalation proceeds to
HMOD-then-Allied." Neither exists in code. `AGENTS.md` [Coverage-lock] already hints at this
("5.5 float-drop immediate re-escalation routes through the same step fns so it locks for free
once wired"), but the specs state it as shipped behavior, and it is not registered in
`docs/qa/ACCEPTED-RISKS.md`.

**Blast radius**: every float that the floater subsequently drops, which is the exact situation
BSpec 5.5 was written for. Single-staff destination houses (11 of 13) go fully unstaffed. It is
silent on both sides: the destination SM sees a covered block, the floater sees a successful drop.

**Fix sketch**: in `drop_shift`, when a dropped seat carried a non-null `parent_float_id`, mark the
float `voided` (or a new terminal status) and release the destination block's `block_step_status`
rows to `rolled_back` so the orchestrator can re-run the securing tier, and clear
`coverage_locked_at` for that block only on this path (the one-way rule is about automation not
undoing itself; a worker-initiated drop is the sanctioned manual event). Voiding here is a manual
worker action on their own float, not automated revocation, so hard invariant 3 is not violated.
Ship the BSpec/ARCH edits in the same commit if the behavior lands differently from 5.5.

**Acceptance check**: the probe above, as a pgTAP test: after `drop_shift` on a float destination
seat, assert `float_assignments.status <> 'acknowledged'`, `block_step_status.status = 'rolled_back'`
for `float_lookup`, and that the next orchestrator tick fires a securing step for that block.

**Confidence**: verified in code and by probe (rolled back; post-rollback fixture count asserted 0).

---

### [P1] `permanent-drop` lets the client choose the "everything after this is vacated" boundary

**Journey**: a worker gives up a recurring slot. The request decides for itself which shifts count
as "future".

**Trigger**: `POST /functions/v1/permanent-drop` with a body carrying
`"drop_initiated_at": "<any timestamp>"`.

**Observed**: `supabase/functions/permanent-drop/index.ts:157-163` accepts the client's
`drop_initiated_at` and only validates that it parses; `:184` forwards it verbatim. Inside
`permanent_drop_slot` that single value does two jobs: it selects which
`scheduling_periods` row bounds the drop (`end_date >= (p_drop_initiated_at AT TIME ZONE 'America/New_York')::date`),
and it is the **only lower bound** on which occurrences are vacated
(`AND sb.block_start_at > p_drop_initiated_at`). There is no floor at server `now()`.

Probe, as the shift's real owner (identity resolved by GoTrue in the same run):

```
identity per GoTrue: fbb00000-...008  chelimo@seas.upenn.edu
A) honest call, no drop_initiated_at        -> {"error":"semester_boundary_not_found"}
B) same call + "drop_initiated_at":"2026-02-01T00:00:00Z"
                                            -> {"affected_count":0,"semester_end_date":"2026-05-01",...}
```

The client picked a **closed** semester and moved the boundary six months into the past. It
affected 0 rows here only because this database happens to contain zero `regular_school_year`
blocks earlier than today (checked: `count = 0`). In a live semester the same call vacates already
worked occurrences: they lose their owner, get `vacancy_origin = 'permanent_drop'`, and (for
future-dated ones) re-enter the permanent openings feed.

**Expected**: BSpec 8.4.1 line 845: "whose date is strictly **after the moment of the drop**". The
moment of the drop is server time (or `app_now()`), never a client claim.
`supabase/functions/drop-shift/index.ts:107` already does this correctly with
`p_as_of: new Date().toISOString()` computed server-side.

**Blast radius**: any authenticated worker, against their own record; and any operator (sm/hm/bm of
the house) against another worker's, since `operatorCanRemove` gates who, not when. History
rewriting on paid hours.

**Fix sketch**: in `supabase/functions/permanent-drop/index.ts`, delete the
`drop_initiated_at` input and always use `new Date()`. Belt and braces: add
`AND sb.block_start_at > greatest(p_drop_initiated_at, app_now())` inside `permanent_drop_slot`.

**Acceptance check**: POST with `drop_initiated_at` set a week in the past against a worker with
past occupied blocks in the current semester, and assert none of them changed status.

**Confidence**: the parameter pass-through and the semester selection are verified by probe. The
vacating of already-worked blocks is inferred from the SQL, because this database has no past
`regular_school_year` blocks to demonstrate it on.

---

### [P1] Handoff and shift-swap expiry contradict both specs and a live config row, and a handoff proposed more than two days ahead dies silently

**Journey**: "Bob called me at the desk and I took his shift." Bob proposes the handoff. Nothing
happens. Bob is paid for hours somebody else worked.

**Trigger**:

1. Worker A proposes a handoff of a shift that starts in four days.
2. Worker B does not open the app within 48 hours (or opens it and means to accept later).
3. At T+48h the request expires. Both workers believe the handoff stands. B works the desk. The
   calendar and the hours report still say A.

**Observed**: `supabase/functions/create-swap/index.ts:137-147` gives `handoff` the same fixed
`addHours(createdAt, 24 * 2)` as `shift_swap`. Only `float_swap` gets a span-anchored window
(`:157`, latest span end + block minutes + 24h).

Three separate statements this contradicts:

- BSpec 8.5 line 910: "a handoff request remains acceptable until **24 hours after the span's end**
  (the same window as a retroactive float swap, Section 8.2)". The whole point of 8.5 is the
  retroactive case, and the code gives handoff no retroactive window at all beyond the accident of
  when it was created.
- BSpec 8.1 line 799: "the swap request expires at **T-3 hours of the earlier of the two spans**",
  and ARCHITECTURE.md line 1768 repeats it in the parameter table. The code comment at
  `create-swap/index.ts:138-145` explains why T-3h was abandoned. Both specs still assert it.
- `system_config` carries a live row `shift_swap_expiry_anchor = 'T-3h'` (checked in the running
  database, alongside `float_swap_expiry_hours = 24` and `permanent_swap_expiry_days = 7`).
  `create-swap` reads only `shift_block_minutes` from config; the expiry keys are read by nothing.
  ARCHITECTURE.md lines 735-736 lists all three as configurable parameters.

The two specs agree with each other and both disagree with the code, so this is not the
BSpec-versus-ARCH P0 case; it is two false spec sentences plus one behavioral defect.

**Expected**: a handoff should stay acceptable until 24 hours after its span ends, per BSpec 8.5.
Whatever the shift-swap window actually is, BSpec 8.1, ARCHITECTURE.md 1768, and the
`shift_swap_expiry_anchor` config row must say the same thing the code does.

**Blast radius**: every handoff proposed more than two days before its shift, which for a shift
arranged a week ahead is the normal case. Silent by design: BSpec 8.1 line 799 says an expired
request "is silently voided".

**Fix sketch**: in `create-swap/index.ts` `computeExpiresAt`, move `handoff` onto the float-swap
branch (latest span end + block minutes + 24h). Then either wire `shift_swap_expiry_anchor` or
delete the row and the ARCHITECTURE.md entry, and correct BSpec 8.1 line 799 plus ARCHITECTURE.md
line 1768 in the same commit (AGENTS.md, "Fix superseded text, do not just append").

**Acceptance check**: a Vitest or Deno test on `computeExpiresAt` asserting a handoff for a span
ending at T gets `expires_at = T + 30min + 24h` regardless of creation time.

**Confidence**: verified in code (all three sources read directly; the config row read from the
running database).

---

### [P1] Permanent drop and permanent swap both announce a scope neither of them verified

**Journey**: a worker gives up their Tuesday slot for the semester and is told every future week is
now open. Three of those weeks are still theirs.

**Trigger**:

1. Worker A owns a recurring Tuesday 16:00 slot. For weeks 3 and 7 the occurrence is currently owned
   by someone else (A dropped week 3 and Bob claimed it; week 7 was swap-transferred). BSpec 8.4.1
   line 853 names both of these as skipped.
2. A opens Manage on the web, picks "Every future week (give up the slot)", confirms.
3. The toast reads "Slot given up for every future week. Each week is now in the open feed."

**Observed**: `permanent_drop_slot` returns `affected_count`, and
`apps/web/lib/actions/worker/shifts.ts:70-87` discards it: `permanentDrop` returns a bare
`{ ok: true }`. `apps/web/components/worker/MyShifts.tsx:148-157` then asserts the unconditional
success string at `:152`. There is no pre-confirmation summary anywhere in `ManageSheet`.

The same defect on the permanent-swap side: `apply_permanent_swap` returns `transferred_count`,
which `supabase/functions/accept-swap/index.ts:60` passes through and both clients ignore
(`apps/web/lib/actions/worker/swaps.ts:26-29`, and mobile checks only `swapAccepted`). Worse,
`resolve_permanent_swap_affected` includes `floated_in` in its status filter while
`apply_permanent_swap` transfers only `scheduled` and `claimed`, so the honest path routinely
resolves more seats than it moves and nobody is told.

**Expected**: BSpec 8.4.1 line 843: "the system displays a confirmation summary: 'You will drop all
future occurrences of this recurring slot through [end of current profile]. This affects [N] future
weeks.'" BSpec 8.3 line 827: "The confirmation popup before acceptance lists the skipped weeks so
both parties understand the scope of the exchange." Neither confirmation exists on either platform.
The permanent-pickup path already does this correctly (`permanent-pickup` has a GET dry run and the
mobile sheet renders "Picking up N of M weeks"), so the pattern is in the codebase.

**Blast radius**: every permanent drop and every permanent swap on web; every permanent swap on
mobile. The false part is bounded to the skipped weeks, but a worker who believes a week is gone
does not turn up for it.

**Fix sketch**: return `affected_count` and `semester_end_date` from `permanentDrop` in
`apps/web/lib/actions/worker/shifts.ts` and render the real number in the toast; add a pre-confirm
dry run (a read-only variant of `permanent_drop_slot`, or reuse the permanent-pickup GET pattern)
so BSpec 8.4.1 step 3 exists. For the swap, surface `transferred_count` and the resolved-versus-
transferred delta in both clients.

**Acceptance check**: Playwright test where the server returns `affected_count: 3` and the toast
names 3 weeks, not "every future week"; and a test where `affected_count: 0` produces a
non-success message.

**Confidence**: verified in code.

---

### [P1] Nothing checks the 40-hour hard cap when a swap is accepted

**Journey**: during winter break, two workers agree to a swap that puts one of them at 46 hours.
The system takes it.

**Trigger**: worker B holds 38 hours in a hard-cap week. Worker A proposes a `shift_swap` giving B
an 8-hour span and taking a 2-hour span back. B accepts. B is now at 44 hours.

**Observed**: there is no hours-cap query anywhere in the swap path. `create-swap` reads
assignments, home houses, `shift_block_minutes`, and pending swaps, and calls
`evaluateSwapEligibility`; `packages/core/src/swaps/eligibility.ts` checks only pending-float,
Harnwell training, and float direction. `accept_swap` and `apply_permanent_swap` call only
`swap_acceptance_ineligibility_reason`, which checks the same three things. Grepping the create and
accept paths for "cap" returns only `addHours`.

The comment at `apps/web/lib/actions/worker/swaps.ts:11-12` states the opposite: "All route through
the shared swap Edge Functions, which re-validate ownership, eligibility, **the hours cap**, and
peer consent authoritatively."

**Expected**: BSpec 9.3 line 954: "No worker can claim a shift, be assigned a non-float shift via
SM/HM override, **accept a swap**, or take a cross-house pickup that would push them over 40 hours
in a calendar week. The cap cannot be overridden, even by an HM." `AGENTS.md` hard invariant 4
records the same split ("Cap checks apply to claim, swap, pickup, never float").

Two carve-outs the fix must respect and not over-apply: BSpec 8.2 line 813 exempts float swaps
("No hours cap re-check is run against the retroactive state"), and BSpec 8.5 line 909 exempts
handoffs explicitly ("Hours cap: NOT consulted ... a deliberate, recorded policy decision"). So the
missing check is on `shift_swap` and `permanent_swap` only.

**Argued down from P0**: this is not one of the six enumerated `AGENTS.md` Hard Invariants (invariant
4 is about floats _not_ being cap-checked, and the code satisfies that). Nobody loses hours and
nobody is locked out; the harm is an over-cap week that a manager then has to unwind, which is the
P1 shape.

**Fix sketch**: add a cap predicate to `swap_acceptance_ineligibility_reason` for
`swap_type IN ('shift_swap','permanent_swap')`, reusing `resolveEffectiveCap` / the existing weekly
hours helper, returning `hard_cap_exceeded` (a code `WriteFeedback.kt:110` already maps to human
copy). Add the matching pre-check in `packages/core/src/swaps/eligibility.ts`. Correct the false
comment in `apps/web/lib/actions/worker/swaps.ts:11-12`.

**Acceptance check**: pgTAP that puts the receiver at 38 hours in a 40-hour week, offers an 8-hour
`shift_swap`, and asserts `accept_swap` returns `hard_cap_exceeded` with both spans unmoved.

**Confidence**: verified in code (absence proven by reading every function on the path; the probe
is the fix's acceptance test, not this ticket's).

---

### [P2] The web portal shows workers raw machine error codes

**Journey**: a worker taps Drop on a shift that already started and reads "drop_past_block".

**Trigger**: any failing worker write on web: drop a past block, hand off a shift already in a
pending swap, accept a swap you are not the counterparty of.

**Observed**: `apps/web/lib/actions/worker/edge.ts:19-29` returns the server's `error` field
verbatim, and every worker component renders it (`MyShifts.tsx:210-214` "Could not drop",
`Swaps.tsx:237`). Mobile has a full mapping table
(`apps/mobile/shared/.../network/WriteFeedback.kt:101-139`) covering `drop_not_owned`,
`drop_past_block`, `drop_not_contiguous`, `span_invalidated`, `pending_swap_conflict`,
`harnwell_training_required`, `not_pending` and more. Web has none, so the two platforms show
different text for the same server response.

**Expected**: the same classified, human copy on both platforms. `apps/mobile/AGENTS.md`
("Cross-platform parity") already treats a rule implemented twice as a drift hazard.

**Blast radius**: every failed worker write on web. Recoverable by the worker (they can retry or
ask), which is why this is P2 and not P1.

**Fix sketch**: port `WriteFeedback.kt`'s `messageForCode` mapping into a shared TS module under
`packages/core` and have `edge.ts` (or each action) map through it, so a future code added on one
platform is visible to the other.

**Acceptance check**: a unit test asserting `drop_past_block` renders as "This shift has already
started, so it can't be dropped." on web, matching the mobile string.

**Confidence**: verified in code.

---

### [P2] The web hand-off composer offers shifts that are already in a pending swap, and web has no "Swap pending" state at all

**Journey**: a worker offers Tuesday to Ann. Ann has not answered. The worker offers Tuesday to Ben
and gets an error made of machine code.

**Trigger**: propose a handoff of shift S to worker Ann. Without cancelling it, open the compose
sheet again and pick shift S for Ben.

**Observed**: `apps/web/lib/data/worker/swaps.ts:103-154` (`loadHandoffable`) filters only on
`dropped_still_open = false` and `kind in (scheduled, temp_pickup)`. It never consults
`worker_pending_swaps`, so a shift with an outgoing pending swap stays in the give pool. The
server refuses at `create-swap` with `pending_swap_conflict`
(`supabase/functions/create-swap/index.ts:308-318`), which web renders raw.
`apps/web/components/worker/MyShifts.tsx:30-36` (`isDroppable`) likewise has no pending-swap
awareness, so no "Swap pending" card exists on web.

Mobile has the guard: `swapPendingGiveIds = vm.pendingGiveAssignmentIds()` is threaded into the
composer (`apps/mobile/androidApp/.../ui/calendar/CalendarScreen.kt:285`, and the iOS equivalent at
`apps/mobile/iosApp/iosApp/ContentView.swift:1100`).

**Expected**: an outgoing-pending shift should not be selectable and should read as pending, which
is the shipped mobile behavior and what BSpec 8.1 line 803 implies ("a worker cannot create or
accept a shift swap request that touches a block already involved in another pending swap request
of theirs").

**Blast radius**: web workers with more than one pending outgoing swap. Recoverable: they can cancel
the first request from the Outgoing tab.

**Fix sketch**: pass `board.feed.outgoing`'s assignment ids into `loadHandoffable` and filter them
out; add a pending tag to the matching `MyShiftCardView`.

**Acceptance check**: Playwright test that creates a pending outgoing swap and asserts the shift is
absent from the `handoff-shift` select.

**Confidence**: verified in code.

---

### [P2] The web drop sheet never warns about a short-notice drop, and the server's warning flags are consumed by nobody

**Journey**: a worker drops a shift that starts in ten minutes and gets no indication that this is
different from dropping one next week.

**Trigger**: on web, open Manage on a shift starting within 20 minutes and tap "Drop shift".

**Observed**: `drop_shift` computes `short_notice_warning` (gap start within 20 minutes) and
`direct_hmod_notification`, and `supabase/functions/drop-shift/index.ts:119-120` returns both. A
repo-wide grep for `short_notice_warning` / `direct_hmod_notification` / `shortNoticeWarning` /
`directHmodNotification` finds **no consumer**: `apps/web/lib/actions/worker/shifts.ts:27-35`
discards the whole response body, and the mobile hosts compute their own client-side warning
instead (`ManageShiftSheet.kt:340-370`, `ContentView.swift:4141`). So the web has no warning at
all, and the server's HMOD signal reaches nothing.

Note for whoever wires `direct_hmod_notification`: it is computed as
`count(present seats excluding the dropped ones) < required_headcount`, which is the
"below required headcount" trigger shape that `AGENTS.md` [Coverage] records as the over-floating
bug. The coverage floor is one worker, not headcount. Do not wire it as written.

**Expected**: BSpec 5.2 line 506: "A worker may drop a shift starting within 20 minutes of the
current time. The system allows this but shows a warning popup informing the worker that this is
short notice."

**Blast radius**: web workers dropping imminent shifts. Not blocking (the drop is meant to be
allowed), which is why this is P2.

**Fix sketch**: surface the RPC's `short_notice_warning` through `dropShift` in
`apps/web/lib/actions/worker/shifts.ts`, or compute the same 20-minute check client-side in
`ManageSheet` the way mobile does, and render the warning above the destructive button.

**Acceptance check**: Playwright test on a shift starting in 10 minutes asserting the warning
element is present before the Drop button is enabled.

**Confidence**: verified in code.

---

### [P2] The web tells workers they cannot reclaim a shift they dropped; the spec and the server both say they can

**Journey**: a worker drops a shift, changes their mind an hour later, and does not try to get it
back because the app told them they cannot.

**Trigger**: open Manage on any shift on web and read the explanatory copy under "This week only".

**Observed**: `apps/web/components/worker/MyShifts.tsx:242`: "Dropping returns the shift to the open
feed for someone else to pick up. **You cannot reclaim it yourself.**"

Nothing in the server enforces that. `is_assignment_claimable` has no `dropped_by_user_id`
predicate, and `claim_open_shift` contains no reference to `dropped_by` (grep returns nothing).
Mobile ships the opposite behavior: `reclaimDroppedShift` exists at
`apps/mobile/shared/.../shifts/Shifts.kt:550-560`.

**Expected**: BSpec 5.2 line 517: "A worker who has dropped a shift may reclaim it themselves,
provided no other worker has claimed it in the interim." Either the copy is wrong, or the rule
changed and BSpec 5.2 line 517 was never updated. Both cases are reportable; decide which, then fix
the other side in the same commit.

**Blast radius**: web workers who drop and change their mind. Recoverable by the person alone (the
shift is visible in their Open Shifts feed and claiming it works), which caps this at P2.

**Fix sketch**: if reclaim is intended, correct the copy and surface the dropped card's claim
affordance. If it is not, add the `dropped_by_user_id <> p_user_id` predicate to
`claim_open_shift`, drop `reclaimDroppedShift` from mobile, and correct BSpec 5.2 line 517.

**Confidence**: verified in code (the server-side absence proven by reading both functions; which
of the two sides is the intended truth is a product decision, not a code finding).

---

### [P2] A permanent swap into Harnwell can be proposed and can never be accepted

**Journey**: a Harnwell worker offers their recurring slot to a friend at Rodin. The friend taps
Accept and gets an error they cannot act on, every time.

**Trigger**: worker A (home house Harnwell) proposes a `permanent_swap` of a Harnwell recurring slot
to worker B (home house anything else). B accepts.

**Observed**: `supabase/functions/create-swap/index.ts:251` runs `evaluateSwapEligibility` only for
non-permanent swaps; the `else` branch at `:287-306` checks the break-profile guard and nothing
else. So the Harnwell training check, which every other swap type runs at creation, is skipped for
permanent swaps. `apply_permanent_swap` likewise never calls
`swap_acceptance_ineligibility_reason`. The only thing standing between B and the Harnwell desk is
the `enforce_harnwell_assignment_training` trigger, which does hold (invariant 1 is safe) but raises
a raw Postgres exception: `non-Harnwell workers may not staff Harnwell`. That surfaces to web as
that literal sentence and to mobile as the unmapped fallback "Couldn't accept this swap. These
shifts may not be eligible to trade, so please try again."

**Expected**: BSpec 8.1 line 793 requires the pre-creation guard for swaps; 8.3 does not restate it
but does not exempt permanent swaps either, and the eligibility module already knows how to answer
this question. The proposal should be refused at creation with `harnwell_training_required`.

**Blast radius**: any cross-house permanent swap involving Harnwell. Both workers waste time and
neither is told why. The invariant itself is not breached.

**Fix sketch**: in `create-swap`, run `evaluateSwapEligibility` for `permanent_swap` too (the
initiator's span is the transferred side; the counterparty side is empty, like a handoff). Add the
same call to `apply_permanent_swap` via `swap_acceptance_ineligibility_reason` so the acceptance
backstop returns a mapped code rather than a trigger exception.

**Acceptance check**: `create-swap` with a Harnwell permanent slot and a non-Harnwell counterparty
returns 409 `harnwell_training_required` and creates no `swap_requests` row.

**Confidence**: verified in code.

---

### [P2] Multi-leg swap results are reported differently on iOS and Android, and both can mislead

**Journey**: a worker splits a 6-hour shift between two housemates. One leg lands, one does not.

**Trigger**: in the swap composer, add two legs on disjoint block ranges and submit while one
counterparty's span has just been invalidated.

**Observed**: the legs are deliberately independent
(`apps/mobile/shared/.../swaps/Swaps.kt:346-354`, `buildSwapProposals`), which is the recorded
design. The reporting is not consistent with it:

- Android (`apps/mobile/androidApp/.../ui/calendar/CalendarScreen.kt:286-294`) fires all legs and
  shows "Swap proposed. Your housemate has been asked" only when **every** leg lands. If leg 1
  landed and leg 2 did not, the worker sees only a red error and reasonably concludes nothing was
  proposed. Re-proposing leg 1 then fails with `pending_swap_conflict`.
- iOS (`apps/mobile/iosApp/iosApp/ContentView.swift:1101-1123`) fires each leg in its own detached
  `Task` and sets `swapProposed = true` per successful leg, so the same scenario shows the green
  "Swap proposed" toast **and** a red error simultaneously, with no indication which leg is which.

**Expected**: per-leg atomicity is the design; per-leg _reporting_ should match it. A message that
says both legs succeeded when one did not is the failure mode the handoff brief calls out
explicitly.

**Blast radius**: multi-leg proposals only, which are the least common swap shape. Recoverable via
the Outgoing tab, which does list what actually exists.

**Fix sketch**: report per leg ("Sent to Ann. Could not send to Ben: ...") from one shared
formatter in `commonMain`, so the two hosts cannot drift again.

**Acceptance check**: a Robolectric and an XCUITest case with one stubbed failing leg, both
asserting the same combined message.

**Confidence**: verified in code.

---

## Verified clean

Surfaces walked that I believe are genuinely sound, with the guard and where it lives.

- **Seat-write races on drop and swap accept.** Ran `scripts/concurrency/race-harness.sh` against
  this commit: 8 passed, 0 failed, including F1 (a drop losing to a concurrent reassignment is
  refused `drop_not_owned` and the seat stays with whoever took it) and F2 (an accept losing the
  race reports `span_invalidated`, the seat is unmoved, and the swap is voided rather than left
  pending). The guards are the row lock plus the repeated predicate on the write plus the
  `GET DIAGNOSTICS` row-count assertion in `drop_shift` and `accept_swap`
  (`supabase/migrations/20260726000009_seat_write_compare_and_swap.sql:41-...` and `:166-...`).
  Both use `ORDER BY assignment_id ... FOR UPDATE` before touching `swap_requests`, matching the
  lock order recorded in `supabase/AGENTS.md`, so a drop racing an accept cannot deadlock.
- **Two accepts of the same swap.** The second accept re-reads `swap_requests` under `FOR UPDATE`
  and returns `not_pending`; even if it did not, the compare-and-swap predicate
  `AND user_id = v_swap.initiator_user_id` makes the second transfer a zero-row no-op which the
  row-count assertion converts into `span_invalidated`.
- **A permanent drop racing a permanent swap on the same series.** `permanent_drop_slot` takes no
  explicit row lock, but its vacate is a single `UPDATE` carrying
  `WHERE sba.user_id = p_dropping_user_id`, so under READ COMMITTED the EvalPlanQual recheck drops
  any row whose owner changed under it. `apply_permanent_swap` carries the mirror predicate
  (`AND target.user_id = v_swap.initiator_user_id`). One wins, the other silently affects zero rows
  for that seat. No double-write is possible.
- **The Harnwell training invariant on the swap path.** Enforced twice: at creation by
  `packages/core/src/swaps/eligibility.ts:60-68`, at acceptance by
  `swap_acceptance_ineligibility_reason` (the `destination_house_id = 'harnwell' AND
receiver_home_house_id <> 'harnwell'` branch), and unconditionally at the write point by the
  `shift_block_assignments_enforce_harnwell_training` trigger, which fires
  `BEFORE INSERT OR UPDATE OF block_id, user_id` and so catches `accept_swap` and
  `apply_permanent_swap` alike. The permanent-swap path reaches only the trigger, which is P2-14
  above, but the invariant itself does not leak.
- **30-minute block atomicity across every drop and swap path.** Every client-side range selector
  is index-based on a block-id list with duration arithmetic on instants, never wall-clock:
  `planPartialDrop` (`apps/mobile/shared/.../shifts/Shifts.kt:405-429`), `planSwapSpan` (`Swaps.kt:239-263`),
  `roundDownToBlock` (`Shifts.kt:276-281`, with the correct argument that NY's offset is always a
  whole number of hours so epoch-grid flooring equals NY :00/:30 flooring), and the web
  `subBlocks` memo (`apps/web/components/worker/MyShifts.tsx:125-138`). The server never receives a
  time range for a drop or a swap, only an `assignment_id` array, so there is no place for a
  sub-block operation to enter. `permanent-drop`'s `isBlockStartLocal` regex
  (`supabase/functions/permanent-drop/index.ts:36-38`) rejects any minute that is not `00` or `30`.
- **Web partial-drop messaging.** `MyShifts.tsx:167-171` compares `toDrop.length` against the card's
  own `blockIds.length` before choosing between "Shift dropped" and "Dropped N blocks", so it does
  not repeat the claim-path bug where the portal claimed 30 minutes of a multi-hour card and toasted
  the whole shift.
- **Drop authorization through the Edge Function.** `drop-shift` derives the actor from the token
  (`index.ts:70-77` then `:106`), and `drop_shift` re-asserts ownership in both the count check and
  the write predicate, so the "pass someone else's assignment_id" attack fails through the EF with
  `drop_not_owned`. The hole is the RPC grant (P0-1), not the EF.
- **Permanent-ops grants.** `permanent_drop_slot`, `permanent_drop` and `permanent_pickup_slot` are
  `anon=f, authenticated=f` in the live catalog, confirming `20260724000006` held.
- **The pending-swap void on vacate.** `void_pending_swaps_for_vacated_seat` fires
  `AFTER UPDATE OF status` for `vacant`, `pending_float_out` and `floated_out`, and both
  `drop_shift` and `permanent_drop_slot` set `status = 'vacant'`, so a drop landing on a shift with
  a pending swap voids that swap rather than leaving a live offer on a seat nobody holds.
- **Recurring-slot identity is DST-safe and matches on both sides.** Mobile `slotFor`
  (`WorkerShiftsRepository.kt:1572-1595`) maps Sunday to 0 and otherwise uses `isoDayNumber`, which
  matches Postgres `EXTRACT(DOW)`; both it and the web `permanentSlot`
  (`apps/web/lib/data/worker/myShifts.ts:107-120`) build block-start labels by adding 30-minute
  durations to an instant and formatting in `America/New_York`, which is exactly the pattern the
  phase-03 note prescribes.

## Not checked

- **Notification content and delivery for drop and swap events.** `accept_swap`'s float-swap branch
  inserts `notification_type = 'swap_request'` rows for destination SMs and HMs after a swap is
  _accepted_, which reads like the wrong type for the event, but the rendering of that payload lives
  in slice 12 and I did not open it.
- **`permanent_drop_slot` on a `floated_in` or `pending_float_in` seat.** The status filter excludes
  only `floated_out` and `pending_float_out`, and unlike `drop_shift` it does not reset `is_float`,
  `is_cross_house_pickup`, `source_house_id` or `parent_float_id`, so it would leave a vacant row
  carrying float provenance. I could not construct a realistic trigger sequence (it needs the caller
  to name the destination house's slot), so I am not filing it. It is worth a look from slice 5.
- **Midnight-crossing recurring slots.** A shift whose blocks straddle NY midnight would have its
  later blocks on the next weekday, while both clients derive one `dayOfWeek` from the card start,
  so a permanent drop would silently miss them. Not filed because no such shift exists under the
  shipped operating profiles: the latest block start at every house is 23:30 (checked in the
  running database). This becomes live the moment a house is configured past midnight.
- **DST-Sunday behavior of a permanent drop.** On fall-back, `TO_CHAR(..., 'HH24:MI') = '01:00'`
  matches both the EDT and EST occurrences of that hour, so a permanent drop naming 01:00 vacates
  two blocks that week. Both belong to the dropper and no spec sentence covers it, so I am recording
  it rather than filing it. Needs a DST Sunday with real blocks to demonstrate.
- **The create-swap pending-conflict TOCTOU.** `loadPendingSwaps` then insert is not atomic, so two
  simultaneous proposals can both create a pending swap on the same seat. The second acceptance is
  correctly refused with `span_invalidated`, so no seat is double-booked; the residue is a stale
  offer in the second counterparty's Incoming tab. I did not build the two-session probe because the
  outcome is bounded by the accept-path guard, which the race harness already proves.
- **iOS drop and swap sheets end to end on a simulator.** I read `ContentView.swift` at the wiring
  points only. The iOS accept path does call `swapAccepted`, so it does not carry the web P0.
- **`worker_pending_swaps` RLS and read-model correctness**, and the swaps feed's countdown
  and one-way-transfer reframing. Read but not probed; nothing on the write path depends on them.
- **Expiry cron scheduling.** `expire_pending_swaps_if_uncronned` is correctly revoked from `anon`
  and `authenticated`; whether the `swap-expiry` pg_cron job exists in a deployed environment is a
  slice 15 question.
