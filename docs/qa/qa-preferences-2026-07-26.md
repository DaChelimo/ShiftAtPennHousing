# Ship check: preferences, admin on behalf, and the deadline override

Date: 2026-07-26
Branch: feat/ui-float-polish
Slice: journey 8 (preference board, target hours, submission deadline, admin on behalf, oversight roster; mobile Android + iOS + shared KMP, web worker portal + web admin, Edge Functions, RPCs, RLS)

Runtime evidence was gathered against the local stack at
`postgresql://postgres:postgres@127.0.0.1:54322/postgres` and `http://127.0.0.1:54321`.
Every row this pass created was deleted by exact primary key in the same session, and
`scheduling_periods` was verified byte for byte identical afterwards. No pre-existing
preference, target, or period row was mutated.

Counts: 6 P0, 9 P1, 3 P2.

Two known-and-open items were reached on this journey and are NOT re-filed:
the `anon` grant class enumerated in the batch A merge review of `docs/qa/COVERAGE.md`, and
the PostgREST 1000 row cap. Tickets 1 and 2 below are `anon`-reachable preference write RPCs
that are **not** in that enumerated set (`submit_preferences` and `set_preference_deadline`
appear in neither the batch A list nor the standing ticket), so they are new.

---

### [P0] Anyone holding the public anon key can overwrite any worker's preferences and mark them "no hours" for a whole period

**Journey**: Not a worker journey. This is the preference self-submit write path being reachable
with no login and no identity check.

**Trigger** (reproduced against the local stack, 2026-07-26; the fixture period was created and
deleted in the same session):

```
# The public anon key, which ships inside the mobile app bundle and the web bundle.
A="$(supabase status -o json | python3 -c 'import sys,json;print(json.load(sys.stdin)["ANON_KEY"])')"

# Identity established inline: the payload of the key actually being sent.
#   -> {"iss": "supabase-demo", "role": "anon", "exp": 1983812996}

# Negative controls with the SAME key, to prove it is not service_role:
curl -X POST .../rpc/admin_submit_preferences -H "apikey: $A" -H "Authorization: Bearer $A" ...
#   -> HTTP 401 {"code":"42501","message":"permission denied for function admin_submit_preferences"}
curl -X POST .../rpc/admin_seed_preferences  -H "apikey: $A" -H "Authorization: Bearer $A" ...
#   -> HTTP 401 {"code":"42501","message":"permission denied for function admin_seed_preferences"}

# The hole, with p_user_id set to a worker the caller holds no token for:
curl -X POST "http://127.0.0.1:54321/rest/v1/rpc/submit_preferences" \
  -H "apikey: $A" -H "Authorization: Bearer $A" -H "Content-Type: application/json" \
  -d '{"p_user_id":"5ca50000-0000-4000-8000-00000000000c",
       "p_period_id":"<any period whose window is open>",
       "p_preferences":[{"block_id":"067fbd94-9929-4a40-aa92-32f3e66eef00","status":"cannot"}],
       "p_target_hours":0,"p_opted_out":true}'
#   -> HTTP 200 [{"preferences_upserted":1,"target_upserted":1}]

# The side effect actually landed:
#   preferences    | 5ca50000-...-00000000000c | 067fbd94-... | cannot
#   period_targets | 5ca50000-...-00000000000c | 0            | opted_out = t
```

Against a period whose deadline has already passed the same call returns
`23514 preference deadline has passed`, not `42501`, which is the discriminator: the function
executed and ran past the cross-user identity guard before the deadline check refused it.

**Observed**: Live catalog, with the negative control in the same query:

```
proname                    | prosecdef | anon EXECUTE | authenticated EXECUTE
submit_preferences         | t         | t            | t
set_preference_deadline    | t         | t            | t
admin_submit_preferences   | t         | f            | f
admin_seed_preferences     | t         | f            | f
```

Two defects compose:

1. `supabase/migrations/20260528000009_batch_a_authz.sql:105` revokes with
   `REVOKE ALL ON FUNCTION submit_preferences(...) FROM PUBLIC` and grants only `service_role` on
   line 106. `supabase/AGENTS.md:22` documents that a `PUBLIC` revoke is a no-op against the
   per-role grants Supabase issues at CREATE time, so `anon` and `authenticated` keep EXECUTE.
   The catalog above confirms it.
2. The identity guard added by the same migration at
   `supabase/migrations/20260528000009_batch_a_authz.sql:54` is
   `IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN RAISE`. Under `anon` there is no
   `sub` claim, so `auth.uid()` is NULL and the guard short-circuits to a pass. The guard is
   written to be inert for the service-role Edge Function path (its own comment says so) and
   `anon` falls into exactly the same hole. An `authenticated` caller cannot exploit this
   (their `auth.uid()` is their own id); `anon` can, for every worker.

The Edge Function `supabase/functions/submit-preferences/index.ts:135` is the only layer that
binds the actor to the bearer token, and it is bypassed by calling the RPC directly.

**Expected**: `submit_preferences` is reachable only by `service_role`, and the identity guard
refuses a caller-supplied `p_user_id` when the caller is not that user rather than when the
caller is merely identifiable. BSpec 4.1 makes preference submission a worker's own act;
`supabase/AGENTS.md:22` requires naming `anon` and `authenticated` in the REVOKE.

**Blast radius**: Every worker, for every period with an open submission window. The public
anon key ships in both client bundles, so this needs no credential theft. The single most
damaging shape is the one proved above: setting `opted_out = true` and `target_hours = 0` marks
a worker "no hours this season", which per BSpec 4.1 excludes them from the entire
preference-assisted build. A whole semester of paid hours, per victim, silently.

**Fix sketch**: New migration that runs
`REVOKE EXECUTE ON FUNCTION submit_preferences(uuid, uuid, jsonb, integer, boolean) FROM anon, authenticated;`
naming the roles explicitly. Separately harden the guard body to
`IF auth.uid() IS DISTINCT FROM p_user_id AND auth.role() <> 'service_role' THEN RAISE` so the
NULL case fails closed. Add a pgTAP assertion that names `anon` and `authenticated` explicitly
(`has_function_privilege('anon', ...)`), per the warning in `supabase/AGENTS.md:33` that a
`has_function_privilege('public', ...)` assertion passes while both roles still hold EXECUTE.

**Acceptance check**: pgTAP asserting
`has_function_privilege('anon','submit_preferences(uuid,uuid,jsonb,integer,boolean)','EXECUTE') = false`
and the same for `authenticated`. Plus a curl regression: anon POST to the RPC returns 401
`42501`, and the target worker's `preferences` and `period_targets` rows are unchanged.

**Confidence**: verified in code, plus a runtime probe whose caller role was printed inline and
whose negative controls were asserted in the same run, plus the write side effect read back
from the table.

---

### [P0] Anyone holding the public anon key can move or close the preference deadline for a whole period by naming any manager's uuid

**Journey**: Not a worker journey. This is the deadline write path trusting a caller-supplied
actor id while being reachable without a login.

**Trigger** (reproduced 2026-07-26 against a fixture period created and deleted in the same
session, so no shared row was disturbed):

```
A="<the anon key; payload printed inline as {"role":"anon"}>"

# Deadline before: 2027-01-01 00:00:00+00 (window open)
curl -X POST "http://127.0.0.1:54321/rest/v1/rpc/set_preference_deadline" \
  -H "apikey: $A" -H "Authorization: Bearer $A" -H "Content-Type: application/json" \
  -d '{"p_actor_user_id":"5ca50000-0000-4000-8000-000000000014",
       "p_period_id":"<period>","p_preference_deadline":"2019-08-01T00:00:00Z"}'
#   -> HTTP 200 [{"period_id":"...","preference_deadline":"2019-08-01T00:00:00+00:00"}]
# Deadline after: 2019-08-01 00:00:00+00, preference_deadline_is_open(period) = false

# NEGATIVE CONTROL, same key, actor swapped for a plain SW's uuid:
#   -> HTTP 401 {"code":"42501","message":"Only an administrator, Student Manager,
#                Housing Manager, or Building Manager may set the preference deadline."}
```

`5ca50000-0000-4000-8000-000000000014` is Sam Rodin, an `sm`. The negative control is the proof
that the role gate is evaluated against the **supplied** uuid and not against the caller: swap
the uuid and the identical unauthenticated request flips from 200 to 42501.

**Observed**: `set_preference_deadline` is `SECURITY DEFINER`, derives its actor entirely from
`p_actor_user_id`, and never reads `auth.uid()`:
`supabase/migrations/20260703000001_season_preference_deadline.sql:58-68` is the whole gate.
Line 111 of the same file grants EXECUTE to `authenticated` deliberately (the
`set-preference-deadline` Edge Function path), and the `REVOKE ALL ... FROM PUBLIC` on line 110
does not strip the default `anon` grant, so the catalog reads `anon=true`.
`supabase/functions/set-preference-deadline/index.ts:87` is the layer that supplies
`p_actor_user_id: user.id` from the bearer token, and it is bypassed by posting to
`/rest/v1/rpc/set_preference_deadline` directly.

A manager's uuid is not a secret on this journey: both house grid projections expose the
occupant's `user_id` (AGENTS.md line 646, `HouseGridBlock` carries `userId`), and RSM and SM
hold shifts like workers, so any signed-in worker can read one off the house grid.

**Expected**: The deadline write is reachable only by `service_role`, with the Edge Function as
the only path that can name an actor. The gate should read `auth.uid()` when one exists.
`supabase/AGENTS.md:22` requires the REVOKE to name `anon` and `authenticated`.

**Blast radius**: `scheduling_periods` is global, one row for all 13 houses. A single
unauthenticated request either closes preference submission for every worker at every house
(setting a past deadline) or reopens it after the SM closed it, and per BSpec 4.2 the SM
"begins building the schedule only after the deadline has passed", so reopening puts the roster
back in flux while the build runs. Closing it early strands every worker who has not yet
submitted, and those workers become "none / unspecified" per BSpec 4.2 and are not assigned in
Phase 1 at all.

**Fix sketch**: New migration:
`REVOKE EXECUTE ON FUNCTION set_preference_deadline(uuid, uuid, timestamptz) FROM anon;` and
change the body's first statement to resolve the actor as
`COALESCE(auth.uid(), p_actor_user_id)` with `p_actor_user_id` honoured only when
`auth.role() = 'service_role'`. That keeps the Edge Function and the web server action working
and closes the spoof for every client role.

**Acceptance check**: pgTAP asserting `has_function_privilege('anon', 'set_preference_deadline(uuid,uuid,timestamptz)', 'EXECUTE') = false`,
plus a curl regression: an `authenticated` SW token that names an SM's uuid as
`p_actor_user_id` receives 42501 and `scheduling_periods.preference_deadline` is unchanged.

**Confidence**: verified in code, plus a runtime probe with the caller role printed inline, two
negative controls asserted in the same run, and the deadline column read back before and after.

---

### [P0] A period with no deadline set is invisible to every worker, so "submission is open indefinitely" collects nothing and the worker's board points at a closed past period

**Journey**: An SM creates the scheduling period for the upcoming semester and has not chosen a
deadline yet. The oversight screen tells them submission is open. Every worker opens
Preferences and is told the window is closed.

**Trigger**:

1. Create a `scheduling_periods` row for the upcoming period with `preference_deadline` NULL and
   `published_at` NULL (this is the state of every newly created period; the only write path,
   `set_preference_deadline`, requires an explicit date).
2. Open `/admin/preferences` as an SM. The deadline card reads "No deadline set" with the caption
   at `apps/web/components/preferences/DeadlineEditor.tsx:23` stating that preference submission
   is open indefinitely.
3. Sign in as any SW and open `/home/preferences` on web, or the Preferences tab on mobile.
4. The board does not show the new period. It shows the previous period, read-only, with
   "Submissions are closed. The deadline for this period has passed."

**Observed**: Reproduced against the local stack inside a rolled-back transaction, with the
worker identity established in the same transaction as the read:

```
INSERT INTO scheduling_periods (..., preference_deadline, published_at)
VALUES ('9c9c...aa','QA Probe Fall 2026','regular_school_year','2026-08-24','2026-12-18',NULL,NULL);

SELECT preference_deadline_is_open('9c9c...aa');   -> t     (server says the window is OPEN)

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"5ca50000-0000-4000-8000-00000000000c","role":"authenticated"}';
SELECT current_user, auth.uid();  -> authenticated | 5ca50000-0000-4000-8000-00000000000c
SELECT period_id, period_name FROM scheduling_periods ORDER BY start_date DESC;
   -> Summer 2026, Spring 2026        (the new Fall period is ABSENT)
ROLLBACK;
```

Two definitions of "open" disagree at NULL, and each is written down as the intended one:

- `supabase/migrations/20260611000007_dev_sim_clock.sql:141`:
  `preference_deadline IS NULL OR app_now() <= preference_deadline`. NULL means open.
- `supabase/migrations/20260610000001_worker_read_scheduling_periods.sql:20`:
  `USING (preference_deadline IS NOT NULL OR published_at IS NOT NULL)`, and the migration's own
  header on line 11 states a worker sees a period "ONLY once it is either open for preference
  submission (preference_deadline IS NOT NULL)". NULL means invisible.

The clients then fall back to the wrong period rather than reporting the gap.
`apps/web/lib/data/worker/preferences.ts:104` is
`periods.find((p) => p.published_at === null) ?? periods[0]`, and
`apps/mobile/shared/src/commonMain/kotlin/com/pennhousing/shift/shared/data/PreferencesRepository.kt:89`
is the same rule. With the real upcoming period filtered out by RLS, both resolve to the most
recent visible period, whose deadline has passed, so
`apps/web/lib/data/worker/preferences.ts:127` computes `deadlineOpen = false` and
`PreferenceBoard.tsx:203` renders the "Submissions are closed" warning. On mobile
`PreferencesRepository.kt:164` sets `deadlinePassed = true` and
`Preferences.kt:377` renders "Preferences locked. The submission window has closed."

**Expected**: Either a NULL deadline means the window is not open yet (then
`preference_deadline_is_open` must return false and the oversight caption must say so), or NULL
means open indefinitely (then the RLS predicate must expose the period). One of the two.
BSpec 4.2 makes the deadline mandatory ("The SM sets a deadline for preference submission"),
which argues for the first reading: an unset deadline is a not-yet-opened window, and the
oversight caption is the thing that is wrong.

**Blast radius**: Every worker at every house, for the entire life of the unset state, which is
the initial state of every period. The SM is told collection is running and sees the roster fill
with "Not yet"; the reminder cron cannot help because
`send_preference_reminders` requires `sp.preference_deadline IS NOT NULL`. If the SM never
notices, the whole period is built with zero preference input, which is exactly the hours
allocation this journey exists to protect.

**Fix sketch**: Pick one semantic and make three places agree. Recommended: treat NULL as "not
open".

1. `preference_deadline_is_open` returns false for NULL (new migration; note `admin_seed_preferences`
   and `admin_submit_preferences` both rely on `deadline := NULL` meaning open for their
   override window, so they need a different mechanism, for example a `LOCAL`
   `app.preference_override='1'` setting the trigger honours, mirroring
   `app.house_transfer` in `20260719000001`).
2. `DeadlineEditor.tsx:23` caption becomes "No deadline set. Workers cannot submit until you set
   one."
3. Both client period selectors should skip a period they cannot submit to rather than silently
   falling back to a closed one, and should render an explicit "your manager has not opened
   submissions yet" state.

**Acceptance check**: pgTAP: with `preference_deadline` NULL, `preference_deadline_is_open` and
the worker's RLS visibility of that row agree. Playwright: an SM creating a period with no
deadline sees a caption that does not claim submission is open, and a worker on that stack sees
a "not opened yet" state rather than a closed previous period.

**Confidence**: verified in code, plus a runtime probe with the worker identity established
inside the same transaction as the read.

---

### [P0] The iOS app tells a worker "Submitted" when the submission never reached the server

**Journey**: A worker paints their availability on iPhone in a building with poor signal, taps
Submit, sees a green "Submitted" card, and closes the app. Nothing was saved.

**Trigger**:

1. Open Preferences on iOS, paint any blocks, set a target.
2. Put the phone in airplane mode (or let the Edge Function be down, or let the write be
   rejected for any reason: an expired token, a passed deadline, a period the worker is not
   eligible for).
3. Tap Submit.
4. The status card turns green with a checkmark and the title "Submitted", and the Submit button
   disappears. There is no error, no toast, and no retry affordance.
5. Reopen the app later. The board reloads from the server and the paint is gone.

**Observed**: `apps/mobile/iosApp/iosApp/PreferencesView.swift:78` is
`Task { _ = try? await live.repo.submitPreferences(payload: payload) }`, followed on line 80 by
an unconditional `vm.submit()`. The POST result is discarded twice over: `try?` swallows the
throw and `_ =` discards the boolean. `PreferencesRepository.submitPreferences` at
`apps/mobile/shared/.../data/PreferencesRepository.kt:191` returns the 2xx flag precisely so a
caller can branch on it, and iOS ignores it.

`PreferencesViewModel.submit()` at
`apps/mobile/shared/.../viewmodel/PreferencesViewModel.kt:244-252` then sets
`hasSubmitted = true` and re-baselines `savedPayload` to the current edits, which clears
`isDirty` and hides the Submit button (`showSubmit` on line 131). `buildPreferenceBanner` at
`Preferences.kt:391` produces `SUCCESS / "Submitted" / "You can still edit until the deadline."`
and `PreferencesView.swift:295` renders that title in the success tint. The file has a toast
mechanism (`deadlineToast`, line 92) but it is wired only to the deadline setter at line 269;
the submit path has no error surface at all.

A second trigger reaches the same false success. `PreferencesView.swift:47` is
`guard let period = try? await repo.fetchActivePreferencePeriod(userId: userId) else { return }`,
which leaves `live` set while the ViewModel still holds `DemoData.preferencePeriod`. The worker
then paints demo block ids in a live build and submits a payload that can never be accepted, and
still sees "Submitted". Android has the same fallback at `MainActivity.kt:572`
(`livePeriod ?: DemoData.preferencePeriod(now)`).

Android is better but not correct: `MainActivity.kt:674` uses
`launchWriteBool(WriteOp.PREFERENCES, revert = false)`, so a failure raises a classified toast,
but line 675 still calls `preferencesVm.submit()` unconditionally and `revert = false` means the
banner keeps saying "Submitted" after the toast fades.

**Expected**: The optimistic flip happens only on a 2xx, or it is reverted on failure with a
visible, persistent error and the Submit button restored. `apps/mobile/AGENTS.md` names this
exact class ("optimistic UI reporting success while the write silently no-ops") and the drop and
claim paths already have `revertKey` machinery for it.

**Blast radius**: Every iOS worker, every failed submission. Mobile is the primary worker
surface (the app is worker-only), and preferences are submitted once per period, so the worker
has no second signal that anything went wrong until the schedule is published without their
availability. A worker who believes they asked for 20 hours and is scheduled for none loses the
period.

**Fix sketch**: In `PreferencesView.swift`, make `submit()` `async`, await the boolean, and call
`vm.submit()` only on true; on false reuse `showDeadlineToast` (rename it to a general
`showToast`) with a classified message and leave the board dirty. In `MainActivity.kt:674`, move
`preferencesVm.submit()` into the success branch of `launchWriteBool`. Separately, stop
substituting `DemoData.preferencePeriod` in a live build: when the live period read returns null,
render an explicit "could not load your preference window" state instead of a paintable demo
grid.

**Acceptance check**: XCUITest with the Edge Function unreachable: tap Submit, assert the status
card title is not "Submitted", assert an error is visible, and assert
`submit_preferences_button` is still present. Robolectric equivalent for Android.

**Confidence**: verified in code.

---

### [P0] On mobile, a worker who is transferring houses paints the wrong house's grid, so their whole preference set is dropped from the schedule they will actually work

**Journey**: A worker is transferring from Rodin to Gutmann effective the start of the upcoming
semester. Before the deadline they open Preferences on their phone, paint their availability,
set a target, and submit. The Gutmann builder sees them as having submitted, cannot assign them
to a single span, and their availability is never used.

**Trigger**:

1. An HM or BM calls `transfer_worker(initiator, worker, 'gutmann', <upcoming period start>, note)`
   (the documented entry point, `20260719000001`). The membership row is recorded for the future
   and `users.home_house_id` still reads `rodin` today.
2. The worker opens the Preferences tab on Android or iOS, paints, and submits before the
   deadline. The grid they are shown is the Rodin week.
3. The Gutmann SM opens `/schedule-builder?house=gutmann` for that period and drags any span.
4. The worker appears in the Phase 1 side card in the **blocked** group with the reason
   "no preference submitted for block HH:MM", and is non-selectable.
5. Meanwhile `/admin/preferences?house=gutmann` does not list the worker at all, and
   `/admin/preferences?house=rodin` lists them as "Submitted".

**Observed**: `apps/mobile/shared/.../data/PreferencesRepository.kt:69-74` resolves the board's
house as `users.home_house_id`, and lines 99-107 fetch `shift_blocks` filtered
`eq("house_id", homeHouseId)`. There is no call to `membership_house_for_date` anywhere in
`apps/mobile`; the only two call sites in the repo are
`apps/web/lib/data/worker/preferences.ts:112` and, for `house_roster_as_of`,
`apps/web/lib/data/scheduleBuilder.ts:122` and `apps/web/lib/data/aiSchedule.ts:143`.

The web worker board does this correctly, which is what makes the mobile behaviour a drift
rather than an unimplemented feature: `apps/web/lib/data/worker/preferences.ts:106-116` resolves
the house from membership as of the period start and falls back to `homeHouseId`.

The harm chain closes in the builder. `apps/web/lib/data/scheduleBuilder.ts:186-190` loads
`preferences` filtered by `block_id IN (<the built house's week blocks>)`, so the Rodin rows are
invisible to Gutmann. Line 213 then computes `submittedUserIds` as the union of preference
authors and `period_targets` keys, and `period_targets` is house-agnostic, so the worker IS in
the Phase 1 pool. `packages/core/src/scheduling/phase1Grouping.ts:73-80` treats a span block
with no preference row as `kind: 'missing'` and pushes the worker into `blocked`, and BSpec 4.3
Phase 1 makes a blocked worker non-selectable. The worker is simultaneously "submitted" and
unassignable.

Both specs say the board is supposed to be membership-aware, so this also falsifies documented
behaviour: `ARCHITECTURE.md:1601` states "the preference board resolves house as of the target
period start", and `AGENTS.md:599` says the same. Neither sentence is true of the mobile board,
which is the app most workers use.

**Expected**: The mobile board resolves its house through `membership_house_for_date(userId,
period.start_date)` exactly as web does, so a transferring worker paints the house they will
work. `ARCHITECTURE.md:1601` and `AGENTS.md:599` already state this as the rule.

**Blast radius**: Every worker with a scheduled transfer who submits from the phone, which is
the default. House transfers are a shipped feature with a dedicated admin control
(`/admin/people`, `TransferWorkerControl`), so the population is real rather than theoretical.
Each affected worker loses their whole period's preference input, and the destination SM has no
signal: the oversight roster does not list them and the builder shows them as having submitted.

**Fix sketch**: In `apps/mobile/shared/.../data/PreferencesRepository.kt`, after the period is
chosen (line 89), call the `membership_house_for_date` RPC with `period.startDate` and use its
result in place of `homeHouseId` for the `shift_blocks` query on line 102, keeping
`home_house_id` as the fallback. The RPC is already granted to `authenticated`
(`20260719000001:340`), so no migration is needed. Add a shared unit test for the resolution
order so the two platforms cannot drift again, and consider moving the resolution into a single
place both platforms consume.

**Acceptance check**: pgTAP or an integration test: with a membership row moving a worker to
`gutmann` effective the period start, the mobile repository's block set is Gutmann's week and the
submitted `preferences.block_id`s all belong to `gutmann`. Then assert
`groupWorkersForSpan` places that worker in `preferred` or `available` for a Gutmann span, not
`blocked`.

**Confidence**: verified in code.

---

### [P0] Both clients cap the weekly target at 20 hours regardless of the period's cap, so a summer worker cannot ask for more than half their hours

**Journey**: A worker wants 40 hours a week over the summer, which the summer season is
configured for. They open Preferences, hold the plus button, and the counter stops at 20h.

**Trigger**:

1. The live stack's active unpublished period is `Summer 2026`, profile
   `s_summer2026_20260601`, whose `operating_profiles.default_hours_cap` is **40** (verified in
   the catalog; `regular_school_year` is 20 and every `s_summer2026_*` profile is 40).
2. Open the preference board for that period on web (`/home/preferences`) or on mobile.
3. Tap the target increase control repeatedly.
4. The value stops at 20h and the button goes disabled. There is no message, and the meter reads
   20h out of 20h as if the worker were at the cap.

**Observed**: The cap is a hardcoded constant on both platforms and is never read from the
period's profile.

- Web: `packages/core/src/preferences/index.ts:24` is `PREF_DEFAULT_CAP_HOURS = 20`, and
  `apps/web/lib/data/worker/preferences.ts:178` sets `capHours: PREF_DEFAULT_CAP_HOURS`
  unconditionally. `apps/web/components/worker/PreferenceBoard.tsx:268` disables the increase
  button at `targetHours >= board.capHours`, and `clampTarget` at
  `packages/core/src/preferences/index.ts:137` clamps to the same value.
- Mobile: `apps/mobile/shared/.../preferences/Preferences.kt:51` is the same constant, line 80
  makes it the `PreferencePeriod.capHours` default, and
  `apps/mobile/shared/.../data/PreferencesRepository.kt:157-172` constructs `PreferencePeriod`
  without passing `capHours`, so the default stands. `buildTargetMeter` at `Preferences.kt:343`
  renders `capLabel` from it, so the meter tells the worker 20h is the ceiling.

The server is not the constraint: `enforce_period_target_hours_cap`
(`supabase/migrations/20260527000005_schedule_builder.sql:342-376`) validates against the
period's real `default_hours_cap`, so a 40 would be accepted. The dev seeder already reads the
real cap (`generateWorkerPreferences(..., { capHours: ctx.capHours })` in
`apps/web/lib/actions/devSeeding.ts:225`), which is the correct pattern the worker board does not
follow.

**Expected**: BSpec 4.1 states it explicitly: "Workers also indicate a target weekly hour count
for the period: any integer from 0 up to the period's hours cap (20 hours for the regular school
year; a summer season uses its own configured cap, for example 40 hours)." The board must read
the cap from the period's `operating_profiles.default_hours_cap`.

**Blast radius**: Every worker at every house for every summer season, which is the season this
whole preference path was extended for (migration
`20260703000001_season_preference_deadline.sql`). The target is the input the SM builds toward
(BSpec 4.3: hours remaining is "target hours minus hours already assigned this week"), so a
worker capped at 20 in a 40 hour season is systematically offered up to 20 fewer paid hours per
week for the length of the summer.

**Fix sketch**: Add `default_hours_cap` to the period read in
`apps/web/lib/data/worker/preferences.ts` (join `operating_profiles` on
`scheduling_periods.profile_name`) and pass it as `capHours` instead of the constant. Do the same
in `PreferencesRepository.fetchActivePreferencePeriod` and pass `capHours = ` that value into the
`PreferencePeriod` constructor. Keep `PREF_DEFAULT_CAP_HOURS` only as the fallback when the
profile row cannot be read. Also check the admin on-behalf board, which shares
`getWorkerPreferenceBoard` and therefore has the same ceiling.

**Acceptance check**: Playwright and XCUITest against the summer period: hold the increase
control and assert the target reaches 40 and the meter's cap label reads 40h. pgTAP already
covers the server side. Add a Vitest case pinning that `getWorkerPreferenceBoard` returns
`capHours = 40` for an `s_summer2026_*` period.

**Confidence**: verified in code, plus the profile cap values read from the live catalog.

---

### [P1] The web Submit button reads "Submitted" and is disabled for a worker who has never submitted, so the default submission is unreachable

**Journey**: A worker is happy with the defaults: 20 hours, available for everything, nothing to
mark "cannot". They open the preference board, read the button, and leave.

**Trigger**:

1. Sign in to the web worker portal as an SW who has no `preferences` and no `period_targets` row
   for the active period.
2. Open `/home/preferences` with a period whose deadline is open.
3. Do not touch the grid, the stepper, or the toggle.
4. The primary action reads "Submitted" and is disabled. There is no success banner and no
   instruction. The oversight roster shows this worker as "Not yet", and the 5, 3, and 1 day
   reminders will fire telling them to submit.

**Observed**: `apps/web/components/worker/PreferenceBoard.tsx:284` is
`disabled={readOnly || submitting || !dirty}` and lines 288 to 298 pick the label as
`submitting ? 'Submitting...' : dirty ? 'Submit preferences' : 'Submitted'`. `dirty` starts
`false` (line 64) and is only set by a paint, a stepper tap, or the opt-out toggle, so a
first-time worker who wants the default state sees the disabled "Submitted" label. The
"already submitted" reassurance at line 208 is correctly gated on `board.submitted` and does not
render, so the button label is the only signal and it contradicts the truth.

Mobile does this correctly and is the reference: `PreferencesViewModel.kt:131` is
`showSubmit = !readOnly && (dirty || !hasSubmitted)` and line 134 keeps the label
"Submit preferences" until a submission exists.

The workaround (paint a cell, then paint it back, which leaves `dirty` true because
`setDirty(true)` is never recomputed) is not discoverable.

**Expected**: The button is enabled and reads "Submit preferences" whenever the worker has not
submitted, matching mobile. BSpec 4.1 treats the all-available default as a valid submission,
and BSpec 4.2 distinguishes a submitted worker from a "none / unspecified" one, so the two states
must not share a label.

**Why P1 and not P0**: the false label appears only in the fully untouched state, and any single
paint corrects both the label and the enablement. A worker who marks even one "cannot" block
never sees it.

**Blast radius**: Every web-portal worker whose intended answer is the default. They land in the
"none / unspecified" bucket of BSpec 4.2, which means the SM does not assign them in Phase 1,
and the reminder cadence keeps telling them to do something the UI says is done.

**Fix sketch**: In `apps/web/components/worker/PreferenceBoard.tsx`, replace the two `dirty`
conditions with the mobile rule: `disabled={readOnly || submitting || (!dirty && board.submitted)}`
and label `dirty || !board.submitted ? 'Submit preferences' : 'Submitted'`. Better still, port
`showSubmit` and `submitLabel` out of `PreferencesViewModel` into `packages/core/src/preferences`
so there is one implementation.

**Acceptance check**: Playwright: as a worker with no rows for the period, assert
`pref-submit` is enabled and its text is "Submit preferences", click it once, and assert a
`period_targets` row now exists.

**Confidence**: verified in code.

---

### [P1] An admin on-behalf save and the worker's own submission silently overwrite each other, with no attribution and a possibly false "Saved" toast

**Journey**: A worker emails their SM to say they cannot get the app to work. The SM opens
`/admin/preferences/<userId>` and paints the worker's availability. The worker, meanwhile, gets
the app working and submits. One of the two writes disappears.

**Trigger**:

1. SM opens `/admin/preferences/<userId>` for worker W and paints a grid.
2. W opens Preferences on their phone and paints a different grid.
3. SM clicks "Save preferences" and, within the same window, W taps Submit.
4. Whichever statement commits last wins the entire grid. The SM sees
   "Saved <name>'s preferences." (`apps/web/components/worker/PreferenceBoard.tsx:143`) and W
   sees "Submitted". Both messages are shown; at most one is true.
5. Query `preferences` for W: there is nothing recording which of the two humans wrote the rows.

**Observed**: `admin_submit_preferences`
(`supabase/migrations/20260711000003_admin_submit_preferences.sql:94-102`) and
`submit_preferences` (`supabase/migrations/20260528000009_batch_a_authz.sql:69-77`) are both a
single `INSERT ... ON CONFLICT (user_id, block_id, period_id) DO UPDATE SET status = EXCLUDED.status`
over the full grid. There is no version column, no `xmin` check, no `GET DIAGNOSTICS` comparison
against an expected row count, and no error on a losing write. `admin_submit_preferences` takes
`FOR UPDATE` on `scheduling_periods` (line 84), which serialises two admins against each other
but does nothing about `submit_preferences`, which never touches that row.

The compare-and-swap that `20260726000009_seat_write_compare_and_swap.sql` added covers
`drop_shift`, `accept_swap` and `apply_permanent_swap` only; the preference writes were not
included.

Attribution does not exist at all. The live catalog shows `preferences` as exactly
`(user_id, block_id, period_id, status)` and `period_targets` as
`(user_id, period_id, target_hours, opted_out)`. No `updated_at`, no `updated_by`, no audit row.
`admin_submit_preferences` also writes nothing to `operating_config_audit`. So a worker who finds
their availability changed has no way to learn that a manager changed it, and a manager cannot
prove they did not.

**Expected**: The losing writer is told. Either the write is a compare-and-swap that returns a
conflict the UI surfaces ("this worker submitted while you were editing, reload"), or the admin
path records who wrote the rows so the change is at least explicable afterwards. ARCHITECTURE.md
section 2.14 records `operating_config_audit` for admin config actions; an on-behalf preference
write is the same shape.

**Blast radius**: Any worker whose SM edits their board, which is precisely the population that
already needed help. The admin-clobbers-worker direction is the more damaging one because the
worker's own expressed availability for the whole period is replaced by a manager's guess and
they are never told; the worker-clobbers-admin direction produces a false "Saved" toast that
makes the SM believe the roster is complete.

**Fix sketch**: Add `updated_at timestamptz NOT NULL DEFAULT now()` and
`updated_by uuid REFERENCES users(user_id)` to `preferences` and `period_targets`, set them in
both RPCs (`submit_preferences` writes `p_user_id`, `admin_submit_preferences` writes
`p_actor_user_id`). Then give `admin_submit_preferences` an optional
`p_expected_updated_at timestamptz`: when supplied and the stored value is newer, raise a
distinct error code the server action maps to a reload prompt. Surface `updated_by` on the worker
board ("last saved by your manager on <date>") so the change is visible. The web action already
has the actor at `apps/web/lib/actions/preferences.ts:87`.

**Acceptance check**: pgTAP with two sessions: session A begins `admin_submit_preferences`,
session B runs `submit_preferences` for the same worker and period, and the losing call raises
rather than silently overwriting. A single-session test asserting `updated_by` is the actor for
the on-behalf path and the worker for the self path.

**Confidence**: verified in code (write shapes, absent columns, absent CAS), plus the live column
list read from `information_schema.columns`.

---

### [P1] The on-behalf editor authorizes on the worker's house today but paints their house next period, so the destination manager is locked out and the source manager gets a cross-house write

**Journey**: A worker transfers from Rodin to Gutmann for the upcoming semester and cannot submit
their own preferences. The Gutmann SM, who will actually schedule them, cannot open their board.
The Rodin SM, who will not, can, and ends up authoring preferences on Gutmann's blocks.

**Trigger**:

1. `transfer_worker(initiator, W, 'gutmann', <upcoming period start>, note)`. `W.home_house_id`
   is still `rodin`.
2. Sign in as the Gutmann SM and open `/admin/preferences?house=gutmann`. W is not in the roster
   (see the roster ticket below), so there is nothing to click. Navigating directly to
   `/admin/preferences/<W>?house=gutmann` renders "Different house. You can only edit preferences
   for workers in a house you manage."
3. Sign in as the Rodin SM and open `/admin/preferences/<W>?house=rodin`. The page loads. The
   grid rendered is **Gutmann's** week.
4. Paint and click "Save preferences". The write succeeds: `preferences` rows are created for W
   against Gutmann `block_id`s by an SM scoped to Rodin.

**Observed**: Two different house resolutions inside the same page.

- Authorization: `apps/web/app/(app)/admin/preferences/[userId]/page.tsx:45` selects
  `home_house_id` and line 52 gates on `canBuildForHouse(user, worker.home_house_id)`. The
  server action repeats it at `apps/web/lib/actions/preferences.ts:71-83`, and the RPC repeats it
  a third time at
  `supabase/migrations/20260711000003_admin_submit_preferences.sql:56-72`
  (`user_can_build_schedule(p_actor_user_id, users.home_house_id)`). All three read today's
  cache.
- Rendering: line 63 calls `getWorkerPreferenceBoard(worker.user_id, worker.home_house_id, ...)`,
  and that function overrides the house it was handed with
  `membership_house_for_date(userId, active.start_date)` at
  `apps/web/lib/data/worker/preferences.ts:112`, resolving to the destination.

So the gate and the grid disagree by construction. The second direction is the sharper one: it
gives an SM a cross-house preference write, which `supabase/AGENTS.md:85` lists as invariant 2,
"SM never gains cross-house power". The cross-house widening recorded in AGENTS.md line 507 was
for `user_is_schedule_admin` (hm, bm, rsm), explicitly "SM is UNCHANGED (own-house everywhere)".

**Expected**: One resolution, used by all four layers, and it should be the forward-looking one
because that is what the board paints and what `ARCHITECTURE.md:1601` specifies. The Gutmann SM
should be able to author for a worker joining Gutmann; the Rodin SM should not be able to write
Gutmann blocks.

**Blast radius**: Every worker with a scheduled transfer who needs an on-behalf submission, which
is a compounding population because the mobile board also mispaints for them (see the mobile
house ticket), so transferring workers are the most likely to need the on-behalf path in the
first place. The destination manager has no route at all and must escalate to an HM, BM, or
admin.

**Fix sketch**: In `apps/web/app/(app)/admin/preferences/[userId]/page.tsx`, resolve the target
house once via the `membership_house_for_date` RPC with the active period's `start_date` and use
that value for both `canBuildForHouse` and the board read. Do the same in
`submitPreferencesForWorker` (`apps/web/lib/actions/preferences.ts`), and change
`admin_submit_preferences` to resolve `v_house_id` with
`membership_house_for_date(p_target_user_id, sp.start_date)` instead of `users.home_house_id`,
so the definer check agrees with the two layers above it.

**Acceptance check**: pgTAP: with W's membership moving to `gutmann` effective the period start,
`admin_submit_preferences` succeeds for the Gutmann SM and raises `insufficient_privilege` for the
Rodin SM. Playwright: the Gutmann SM can open and save W's board; the Rodin SM sees the
"Different house" notification.

**Confidence**: verified in code.

---

### [P1] The oversight roster and the builder roster are different populations, so "Roster complete" does not mean the builder has what it needs

**Journey**: An SM works down the preferences oversight screen until it reads "Roster complete",
then opens the schedule builder and finds a worker with no usable preferences and another worker
they cannot schedule at all.

**Trigger**:

1. Open `/admin/preferences?house=rodin`. The header stat reads "Workers 9".
2. Open `/schedule-builder?house=rodin` for the same period. The Phase 2 roster holds 8.
3. Measured on the live stack: the oversight population (active, `home_house_id = 'rodin'`,
   holding `sw` or `sm`) is 9; `house_roster_as_of('rodin','2026-08-24')` returns 8. The extra
   person is Sam Rodin, the SM.
4. Add a worker transferring into Rodin for the upcoming period and the two counts diverge in the
   other direction as well: they appear in the builder roster and not in the oversight roster.

**Observed**: Three different definitions of "this house's preference-submitting roster".

- Oversight: `apps/web/lib/data/preferences.ts:143-148` filters `users` on
  `home_house_id = houseId` and `is_active`, then line 165 keeps anyone holding `sw` or `sm`.
  Today's house, both roles.
- Builder and the AI payload: `apps/web/lib/data/scheduleBuilder.ts:122` and
  `apps/web/lib/data/aiSchedule.ts:143` call `house_roster_as_of(house, buildWeek)`, whose body
  at `supabase/migrations/20260719000001_house_transfers.sql:356-359` joins
  `user_roles r ON r.role = 'sw'` and resolves the house through
  `membership_house_for_date`. Membership at the build week, `sw` only.
- Reminders: `send_preference_reminders` (live body) joins `user_roles ur ON ur.role IN ('sw','sm')`
  with **no house filter at all**, so it chases every active sw and sm in the system for the one
  global period. That part is defensible, since the period is global, but it means an SM's
  reminders are driven by a third population.

The consequence on the screen is that `summary.total`, the meter at
`apps/web/components/preferences/PreferencesOversight.tsx:102`, and the "Roster complete" tag on
line 114 are all computed over a set the builder does not use. An SM's submitted preferences are
collected, counted toward completeness, and then discarded by the builder, while a transferring
worker's absence is invisible.

**Expected**: The oversight roster is the builder roster. The screen's stated purpose, in its own
header comment at `apps/web/lib/data/preferences.ts:10-11`, is "everything the SM needs to know
the roster is complete before opening the schedule builder", which only holds if the two agree.

**Blast radius**: Every house, every period. The specific harm is a false green light: an SM who
trusts "Roster complete" opens the builder and discovers a worker they cannot assign in Phase 1,
which per BSpec 4.3 forces them into Phase 2 with an explicit confirmation for that person, or
leaves the person unscheduled. It also wastes the submissions of every SM who paints a board.

**Fix sketch**: Replace the `users` query in `getPreferencesOversight` with the
`house_roster_as_of(houseId, <the period's start date>)` RPC, so the oversight roster is
definitionally the builder roster. If SMs are supposed to be schedulable, widen
`house_roster_as_of` to `role IN ('sw','sm')` in a new migration and update the builder and AI
paths together, rather than keeping two answers. Either way, decide it once and record it in
BSpec 4.2, which currently does not define the submitting population.

**Acceptance check**: A Vitest or Playwright assertion that
`getPreferencesOversight(house, now).summary.total` equals
`getBuilderData(house, ...).workers.length` for the same house and period, including the
transferring-worker case.

**Confidence**: verified in code, plus the two roster counts measured against the live stack.

---

### [P1] Choosing the period's start date as the deadline is always rejected, and the mobile date picker defaults to exactly that date

**Journey**: An SM wants preferences in by the day the semester starts. They open the deadline
setter, accept the date the picker offers, and are told the deadline must be on or before the
date they just chose.

**Trigger** (mobile, the guaranteed-failure path):

1. Sign in on Android or iOS as an SM, HM, or BM. The deadline card appears above the target card.
2. Tap "Set deadline". The date picker opens with the period's start date pre-selected, and that
   date is selectable.
3. Tap Save without changing anything.
4. The write fails. Android shows "That deadline could not be set. It must be on or before the
   period start." iOS shows its deadline toast with the server message, which names the start
   date while refusing it.

Same defect on web with a different entry: on `/admin/preferences`, type the period's start date
into the deadline input and click "Set deadline". The error reads that the deadline must fall on
or before the period start date, quoting that exact date.

**Observed**: An off-by-one between the value the clients send and the bound the RPC enforces.

- Clients send end of day. `apps/web/lib/nyTime.ts:33` returns
  `nyWallClockIso(dateValue, 23, 59)`, called from `apps/web/lib/actions/preferences.ts:25`.
  `apps/mobile/shared/.../preferences/PreferenceDeadline.kt:15-16` returns
  `LocalTime(23, 59, 59, 999_000_000)`.
- The RPC bounds against **midnight**:
  `supabase/migrations/20260703000001_season_preference_deadline.sql:97` is
  `IF p_preference_deadline > ((v_start_date::timestamp) AT TIME ZONE 'America/New_York')`.

So `start_date` at 23:59 NY is always greater than `start_date` at 00:00 NY and is always
rejected. The mobile picker makes this the default: `PreferencesScreen.kt:279` sets
`initialSelectedDateMillis = maxMillis` where `maxMillis` is the period start, and line 282
allows `utcTimeMillis <= maxMillis`, so the offered and permitted maximum is precisely the value
that cannot succeed.

The same mismatch is baked into the season authoring path. The column comment at
`supabase/migrations/20260703000001_season_preference_deadline.sql:32-35` says the admin's value
is "end-of-day NY on the chosen date" and "Must fall on/before the season start (enforced by
set_preference_deadline)", so an admin who authors the season start as the deadline produces a
value the stamping call will refuse.

**Expected**: Either the bound is end of day on the start date
(`(v_start_date::timestamp + interval '1 day') AT TIME ZONE 'America/New_York'`), which matches
BSpec 4.2 "The deadline must fall on or before the period's start date", or the pickers exclude
the start date so the offered maximum is achievable. The current combination satisfies neither
reading, and BSpec 4.2's wording favours the first.

**Blast radius**: Every manager who sets a deadline, on the default path on mobile and on a very
natural choice on web. Recoverable alone by picking the previous day, so this is a P1 rather
than a P0, but the error text actively misdirects: it names the date it just refused as the
allowed maximum.

**Fix sketch**: Change the comparison in a new `CREATE OR REPLACE FUNCTION set_preference_deadline`
to bound against the end of the start date, and keep the message. That is one line and it makes
both pickers correct without touching either client. If instead the intent is that the deadline
must precede the start date, change the message to say so and set the mobile picker's
`maxMillis` and `initialSelectedDateMillis` to the day before, and add a `max` attribute to the
web `DateInput`.

**Acceptance check**: pgTAP: `set_preference_deadline` with the NY end of day on the period's
start date succeeds, and with any instant on the following day raises `check_violation`. Android
Robolectric: opening the deadline picker and confirming the default date issues a request that
succeeds.

**Confidence**: verified in code (both `nyEndOfDayIso` implementations, the RPC bound, and the
picker default).

---

### [P1] BSpec 4.2 states preferences cannot be changed after the deadline, and managers change them after the deadline by design

**Journey**: Nobody's journey. This is a spec sentence a future builder will act on.

**Trigger**: Read BSpec 4.2. Then open `/admin/preferences/<userId>` for a period whose deadline
has passed and click "Save preferences". The write succeeds.

**Observed**: BEHAVIORAL_SPECIFICATION.md section 4.2 says, without qualification, "Preferences
cannot be changed after the deadline. The SM begins building the schedule only after the deadline
has passed."

The shipped behaviour is the opposite for managers, deliberately.
`supabase/migrations/20260711000003_admin_submit_preferences.sql:21-25` records the decision:
"Managers OVERRIDE the preference deadline (stakeholder decision 2026-07-11): they may enter a
worker's preferences even after the window has closed", implemented by locking the period,
setting `preference_deadline = NULL` for the duration of the write (line 92), and restoring it
(line 114). `admin_seed_preferences` does the same at
`supabase/migrations/20260711000002_admin_seed_preferences.sql:63`. The UI states the override to
the manager at `apps/web/components/worker/PreferenceBoard.tsx:197-202`
("The submission window for this period is closed. You are editing as a manager, so your changes
will still be saved.") and `PreferenceBoard.tsx:56` sets `readOnly` to false in admin mode
regardless of the deadline.

Neither spec mentions the override. Grepping ARCHITECTURE.md for `admin_submit_preferences`
returns nothing, so the on-behalf write path is undocumented in both specs, which is the exact
drift AGENTS.md lines 21 to 27 exist to prevent.

**Expected**: BSpec 4.2 gains the exception ("A worker cannot change their preferences after the
deadline. An SM, HM, BM, RSM, or administrator may still enter or edit a worker's preferences on
their behalf after the deadline; the deadline binds workers, not managers.") and ARCHITECTURE.md
gains the mechanism (`admin_submit_preferences`, service-role only, the lock-and-reopen pattern,
and the `enforce_preference_deadline` trigger it is working around). AGENTS.md rule 2 requires
fixing the superseded sentence in place rather than appending.

**Blast radius**: The next person to touch the deadline. A builder who trusts BSpec 4.2 could
"restore" the invariant by making `enforce_preference_deadline` service-role-proof, which would
silently break the on-behalf path that managers now depend on, or could add a client-side lock
to the admin board. Either regression removes the only route a worker who cannot use the app has
to get their availability recorded at all.

**Fix sketch**: Edit BEHAVIORAL_SPECIFICATION.md section 4.2 in place to carve out the manager
override, citing the 2026-07-11 decision and its date. Add a subsection to ARCHITECTURE.md
section 2 describing `admin_submit_preferences` and `admin_seed_preferences`, their
service-role-only grants, and the lock-and-reopen mechanism. Do not renumber existing sections
(AGENTS.md rule 4).

**Acceptance check**: Grep both specs for "cannot be changed after the deadline" and confirm the
surviving sentence is scoped to workers. Confirm `admin_submit_preferences` appears in
ARCHITECTURE.md.

**Confidence**: verified in code.

---

### [P1] Mobile defaults a first-time worker's weekly target to 0 hours while web defaults it to the cap, so the same worker submitting from a phone asks for no hours

**Journey**: A worker paints every evening block Preferred on their phone, taps Submit, and is
recorded as wanting zero hours a week.

**Trigger**:

1. Sign in on Android or iOS as an SW with no `period_targets` row for the active period.
2. Open Preferences. The target card reads 0h and the meter is empty.
3. Paint availability. Do not touch the stepper. The "No hours this season" toggle stays off.
4. Tap Submit. `target_hours = 0`, `opted_out = false` is written.
5. Open `/admin/preferences` as the SM. The row reads status "Submitted" and Target "0h", which
   is a different state from "No hours" and gives the SM no reason to chase it.

The same worker doing the same thing on `/home/preferences` submits 20.

**Observed**: `apps/mobile/shared/.../data/PreferencesRepository.kt:169` is
`targetHours = target?.targetHours ?: 0`. The web equivalent at
`apps/web/lib/data/worker/preferences.ts:176` is
`targetHours: targetRow?.target_hours ?? PREF_DEFAULT_CAP_HOURS`. This is one rule with two
implementations, which `apps/mobile/AGENTS.md:116` flags as the class that "drift silently".

`buildSubmitPayload` at `apps/mobile/shared/.../preferences/Preferences.kt:444` passes the value
straight through (`clampTarget(0, 20) = 0`), and nothing warns. `buildTargetMeter` at line 339
renders "0h", so the value is on screen, which is why this is a P1 and not a P0: a worker who
looks at the target card can fix it, and can resubmit until the deadline.

Downstream, BSpec 4.3 defines a worker's hours-remaining figure as "target hours minus hours
already assigned this week" and says the SM gets a warning popup when an assignment "would push
them over their target hours". A target of 0 makes every assignment a warning, so the practical
effect is close to an opt-out that the worker never chose and the roster does not label as one.

**Expected**: One default, shared. Given BSpec 4.1 treats the target as a guideline and the cap
as the natural anchor, the web default (the period's cap) is the correct one, and it should live
in one place both platforms read.

**Blast radius**: Every mobile worker submitting for the first time in a period who does not
notice the stepper, which is the default state of the primary worker surface. The cost is the
whole period's hours for that worker unless the SM notices the contradiction between "Submitted"
and "0h".

**Fix sketch**: In `PreferencesRepository.fetchActivePreferencePeriod`, change line 169 to
`target?.targetHours ?: <the period cap>` (the same value the cap ticket introduces). Then delete
one of the two constants: keep `PREF_DEFAULT_CAP_HOURS` in one module and have the other read it,
or add a shared reference-vector test in the style of `WorkerColorsTest`, which
`apps/mobile/AGENTS.md:118-122` already establishes as the pattern for a rule that exists twice.

**Acceptance check**: A shared Kotlin test asserting `PreferencePeriod.targetHours` for a worker
with no target row equals the period cap, and a Vitest asserting the same for
`getWorkerPreferenceBoard`. Both pinned to the same constant.

**Confidence**: verified in code.

---

### [P1] The mobile app ships a manager write surface that three AGENTS.md notes say does not exist, and shows it to RSMs whom the RPC rejects

**Journey**: An RSM opens the Preferences tab on their phone, sees a "Submission deadline" card
with a "Set deadline" button, picks a date, and is told the deadline could not be set. It never
can be, for them.

**Trigger**:

1. Sign in on Android or iOS as a user whose resolved profile role is anything other than `sw`.
   `apps/mobile/androidApp/.../MainActivity.kt:575` computes
   `isManager = liveProfile?.profile?.role?.let { it != "sw" } ?: false`, and
   `apps/mobile/iosApp/iosApp/ContentView.swift:1311` is `let isManager = (role ?? "sw") != "sw"`.
2. Open the Preferences tab. The deadline card renders
   (`PreferencesScreen.kt:151`, gated on `state.canSetDeadline`, which is
   `PreferencesViewModel.kt:142` = `isManager`).
3. As an `rsm`, pick any valid date and Save.
4. The write fails with 403. Android shows "That deadline could not be set. It must be on or
   before the period start.", which is not the reason.

**Observed**: Two separate defects in one surface.

First, the docs deny the surface exists. `apps/mobile/AGENTS.md:12` states the app is
worker-only with no admin write surface and all filtering server-side. `AGENTS.md:530` repeats
it for the cross-house schedule work, and `AGENTS.md:619` repeats it for house transfers. The app
ships `DeadlineSetterCard` (`PreferencesScreen.kt:237-300`, test tags `pref_deadline_card` and
`pref_set_deadline`), the iOS `deadlineSetterCard` (`PreferencesView.swift:112-114`), and
`PreferencesRepository.setPreferenceDeadline` (`PreferencesRepository.kt:202-226`), which POSTs
to the `set-preference-deadline` Edge Function. That is an admin write surface on mobile.

Second, the role set is wrong. `PreferencesScreen.kt:237` and `PreferencesViewModel.kt:81`
both document the gate as sm, hm, bm, rsm. The RPC's gate at
`supabase/migrations/20260703000001_season_preference_deadline.sql:58-64` is
`user_is_admin(actor) OR role IN ('sm','hm','bm')`. `rsm` is absent, and `admin` is present but
`isManager` would also include it. So an RSM is shown a control that can never succeed, and the
failure message blames the date.

**Expected**: Either the docs are corrected to record that mobile now carries the deadline setter
(AGENTS.md rule 2: fix the superseded sentence in place, do not append), or the control is
removed from mobile. Whichever, the client gate must match the RPC's role set, and a 403 must
produce a message about permission rather than about the date. BSpec 4.2 names the authorised set
as SM, HM, BM plus the administrator for a summer season, so `rsm` is correctly excluded from the
RPC and incorrectly included in the client.

**Blast radius**: Every RSM, on every attempt, permanently. AGENTS.md is read at session start
by every agent, so the "mobile is worker-only" claim also means the next person to audit mobile
authorization will not look for one.

**Fix sketch**: Compute `isManager` for this control from the roles the RPC accepts:
`role in setOf("sm","hm","bm","admin")` in `MainActivity.kt:575` and `ContentView.swift:1311`
(or better, split the flag: `canSetDeadline` for this card, `isManager` for the house grid, which
does want RSM). Correct the failure copy at `MainActivity.kt:687` to branch on the classified
error rather than asserting the start-date reason. Then update `apps/mobile/AGENTS.md:12` and
AGENTS.md lines 530 and 619, and add the mobile deadline setter to BSpec 4.2 and
ARCHITECTURE.md.

**Acceptance check**: Robolectric: with a resolved role of `rsm`, `pref_deadline_card` does not
render. With `sm`, it renders and a save issues the Edge Function call. A grep assertion that
`apps/mobile/AGENTS.md` no longer claims there is no admin write surface.

**Confidence**: verified in code, plus the RPC role set read from the migration and confirmed
against the live function body.

---

### [P1] AGENTS.md line 358 tells future agents that preference writes are own-house hm/bm only, and the live policies are cross-house hm/bm/rsm

**Journey**: Nobody's journey. This is agent-facing guardrail prose that contradicts both the
running catalog and a later note in the same file.

**Trigger**: Read AGENTS.md line 358. Then query `pg_policies` for `preferences`.

**Observed**: AGENTS.md line 358, in the Phase 07 note, states that admin over people and
"preference/period-target WRITES stay hm/bm-only (`user_has_house_admin_role`)" and instructs the
reader not to collapse the two helpers. It carries no superseded marker, unlike the RSM note at
line 446 which does.

AGENTS.md line 515, in the Cross-house-schedule note, records that the
"draft/preferences/period_targets admin RLS" was swapped from `user_has_house_admin_role` to
`user_is_schedule_admin`. The live catalog agrees with line 515 and not with line 358:

```
preferences    | house admins can insert house preferences | INSERT | {authenticated} | user_is_schedule_admin(auth.uid())
preferences    | house admins can update house preferences | UPDATE | {authenticated} | user_is_schedule_admin(auth.uid())
preferences    | house admins can delete house preferences | DELETE | {authenticated} | user_is_schedule_admin(auth.uid())
period_targets | (the same three)                          |        | {authenticated} | user_is_schedule_admin(auth.uid())
```

`user_is_schedule_admin` is hm, bm, or rsm **anywhere** and has no house argument, so the
predicate is house-agnostic despite every policy name saying "house". Two behavioural
consequences follow that line 358 would lead an agent to believe are impossible: an RSM can
write preferences (line 358 says hm/bm only), and any hm/bm/rsm can write any house's
preferences directly over PostgREST without going through `admin_submit_preferences` and its
`user_can_build_schedule` check. Separately, `user_is_schedule_admin` does **not** include the
top-level `admin` role (unlike `user_has_house_admin_role`, which gained an unconditional
`user_is_admin()` clause per AGENTS.md line 520), so an administrator has no RLS write on
preferences at all and depends entirely on the service client.

**Expected**: AGENTS.md line 358 is corrected in place to say that preference and period-target
writes moved to `user_is_schedule_admin` on 2026-06-27, and that only people admin, HM leave, and
the weekly cap remain on `user_has_house_admin_role`. `supabase/AGENTS.md:70-89` already has the
correct predicate table; the root file contradicts it. AGENTS.md rule 2 requires fixing the
superseded sentence rather than leaving it next to the correction.

**Blast radius**: The next agent to touch preference RLS. Line 358's instruction ("Do not collapse
the two helpers") reads as an invariant to defend, so an agent acting on it would narrow the
policies back to own-house hm/bm, which would break the cross-house on-behalf authoring the
2026-06-27 stakeholder decision shipped, and would silently remove RSM's write. That is a
regression on the write path this whole journey depends on.

**Fix sketch**: Edit AGENTS.md line 358 to scope the `user_has_house_admin_role` claim to people
admin, HM leave, and the weekly cap, and point the preference and period-target row at the
Cross-house-schedule note. While there, record the `admin`-role gap in `user_is_schedule_admin`
explicitly, because it is load-bearing for why the admin surfaces all use the service client.

**Acceptance check**: A grep assertion that AGENTS.md contains no unqualified claim that
preference writes are `user_has_house_admin_role`, and a pgTAP test pinning the three preference
policies to `user_is_schedule_admin` so the code and the note cannot drift again.

**Confidence**: verified in code, plus the policy predicates read from `pg_policies` on the live
stack.

---

### [P2] Three em dashes ship in the deadline card's user-facing copy

**Journey**: An SM reads the deadline card on `/admin/preferences`.

**Trigger**: Open `/admin/preferences` in any of three states: period published, no deadline set,
or period published (the field helper). All three captions render an em dash.

**Observed**: `apps/web/components/preferences/DeadlineEditor.tsx` line 20 (the published
caption, between "published" and "preferences are locked"), line 23 (the unset caption, between
"No deadline set" and "preference submission is open indefinitely"), and line 87 (the field
helper, between "Locked" and "this period is published") each contain a U+2014 em dash. All three
strings are rendered to the user.

AGENTS.md lines 164 to 170 forbid an em dash or en dash in "any string a user can ever see",
across both platforms and stored copy, and exempt only comments and log lines. The two other em
dashes in `PreferencesOversight.tsx` (lines 79 and 82) are inside JSX comments and are exempt.

**Expected**: Re-punctuate with a period, comma, colon, or parentheses per AGENTS.md lines 164 to 170.

**Blast radius**: Cosmetic, one screen, managers only. Filed because the rule is explicit and
mechanically checkable, and because the same file's line 23 caption is the false statement in the
deadline-visibility P0, so both fixes land in the same edit.

**Fix sketch**: In `DeadlineEditor.tsx`, replace each em dash with a period and re-case the
following word, for example line 20 becomes "This period is published. Preferences are locked and
the schedule is live." Line 23's rewrite is dictated by the deadline-visibility ticket.

**Acceptance check**: The repo's existing copy lint, or
`grep -rnP '[\x{2013}\x{2014}]' apps/web/components/preferences` returning only comment lines.

**Confidence**: verified in code.

---

### [P2] Web and mobile compute the deadline instant differently, and the Kotlin doc comment claims they match

**Journey**: A worker submits at 23:59:30 NY on the deadline day. Whether it is accepted depends
on which platform the manager used to set the deadline.

**Trigger**:

1. A manager sets the deadline for date D from the web admin screen. The stored value is
   `D 23:59:00` NY.
2. A worker taps Submit at `D 23:59:30` NY.
3. `preference_deadline_is_open` evaluates `app_now() <= preference_deadline` and returns false.
   The submission is refused with "preference deadline has passed".
4. Had the manager set the same date from the mobile deadline setter, the stored value would be
   `D 23:59:59.999` NY and the same submission would be accepted.

**Observed**: `apps/web/lib/nyTime.ts:33` calls `nyWallClockIso(dateValue, 23, 59)`, so seconds
and milliseconds are zero. `apps/mobile/shared/.../preferences/PreferenceDeadline.kt:15-16` uses
`LocalTime(23, 59, 59, 999_000_000)`. The two differ by 59.999 seconds.

The Kotlin file's own doc comment on line 12 asserts the opposite: "Mirrors the web
`nyEndOfDayIso` so both platforms send the server the same timestamptz." That sentence is false,
and it is the kind of parity claim `apps/mobile/AGENTS.md:114-116` warns "drift silently".

A second, smaller drift in the same pair of modules: the brush palette order differs.
`packages/core/src/preferences/index.ts:21` is `['preferred', 'available', 'cannot']` and
`apps/mobile/shared/.../preferences/Preferences.kt:48` is
`[AVAILABLE, PREFERRED, CANNOT]`, so the toolbar's first swatch is a different brush on each
platform.

**Expected**: One value. Either both platforms send `23:59:59.999`, or both send `23:59:00`, and
the doc comment is true. Given the deadline is described to the user as "Submission closes at end
of day (NY) on this date" (`DeadlineEditor.tsx:88`), `23:59:59.999` is the honest one.

**Why P2**: the divergence window is under a minute, it only bites a worker submitting in the
final minute of the deadline day, and a manager can move the deadline to recover. The false
parity comment is the durable part, because it tells the next reader not to check.

**Blast radius**: A worker submitting in the last minute of the deadline day, on a period whose
deadline was set from web. Rare, and unrecoverable without a manager when it happens.

**Fix sketch**: Change `apps/web/lib/nyTime.ts` to expose the seconds and milliseconds
(`nyWallClockIso(dateValue, 23, 59, 59, 999)`) so both platforms agree, and keep the mobile side
as the reference the comment already claims. Add a reference-vector test in the style of
`WorkerColorsTest` pinning both implementations to the same output for a fixed date, including a
DST-boundary date, since `nyOffsetMinutes` resolves the offset at the requested instant. Align
the brush order in the same change and record it in the shared design doc.

**Acceptance check**: A test asserting `nyEndOfDayIso('2026-11-01')` (a fall-back day) produces
the identical instant on both platforms, plus one for a spring-forward day.

**Confidence**: verified in code.

---

### [P2] The preferences data module's header still says the Set deadline control has no backing path and ships disabled

**Journey**: Nobody's journey. This is a code comment that will mislead the next person to touch
the oversight screen.

**Trigger**: Read the header of `apps/web/lib/data/preferences.ts`, then open
`/admin/preferences`.

**Observed**: `apps/web/lib/data/preferences.ts:26-30` states: the Set deadline write "has NO
backing path", the column exists "but there is no set-deadline RPC and only a service-role RLS
policy", and "the screen surfaces that control disabled + flagged". All three clauses are false.
`set_preference_deadline` shipped in `20260611000003` and was extended in `20260703000001`;
`apps/web/lib/actions/preferences.ts:12-42` is the live server action; and
`apps/web/components/preferences/DeadlineEditor.tsx:99-106` renders an enabled button whose only
disabled condition is a published period. Line 81 of the same file still describes
`deadlineDateValue` as feeding "the (disabled) date input".

A matching stale comment sits on the mobile side:
`apps/mobile/shared/.../preferences/Preferences.kt:27-32` records as a live GAP that
"`scheduling_periods` has NO authenticated SELECT policy, so a worker can read NEITHER the active
period_id NOR the `preference_deadline`", and concludes the period label and deadline are
"caller-supplied (the demo provides them)". Migration `20260610000001` added that policy, and
`PreferencesRepository.kt:80-89` reads both fields live.

**Expected**: Both headers describe what the code does. These are comments rather than spec
sentences, so P2 rather than P1, but the mobile one is the note that pushed the demo-period
fallback into the live build (see the iOS submit P0), so it is not inert.

**Blast radius**: The next reader. The web comment would lead someone to re-add a disabled state
to a working control; the mobile comment presents the demo-period fallback as necessary when it
is no longer.

**Fix sketch**: Rewrite `apps/web/lib/data/preferences.ts:26-30` to say the deadline is read and
written live through `set_preference_deadline`, and drop "(disabled)" from line 81. Rewrite
`Preferences.kt:27-32` to record that `scheduling_periods` became worker-readable in
`20260610000001`, and note the remaining real gap instead: a period with a NULL deadline is not
visible to a worker (the deadline-visibility P0).

**Acceptance check**: Code review of the two headers against the current call sites.

**Confidence**: verified in code.

---

## Verified clean

Each of these was walked and is believed sound, with the guard named.

- **The deadline is re-validated server side; the client is not trusted.** A sheet opened before
  the deadline and submitted after it is refused. `submit_preferences`
  (`20260528000009_batch_a_authz.sql:64`) calls `preference_deadline_is_open` before any write,
  and independently the `preferences_enforce_deadline` and `period_targets_enforce_deadline`
  row triggers (`20260527000005_schedule_builder.sql:332-340`) fire on INSERT, UPDATE **and**
  DELETE and are not service-role-bypassed. So even the service-role Edge Function path cannot
  land a late write. Confirmed at runtime: an anon POST against the closed Summer 2026 period
  returned `23514 preference deadline has passed`.
- **Submitting at the exact deadline instant is accepted.** `preference_deadline_is_open`
  (`20260611000007_dev_sim_clock.sql:141`) is `app_now() <= preference_deadline`, inclusive, and
  the web client's own check at `apps/web/lib/data/worker/preferences.ts:127` is also `<=`. The
  two agree, so there is no boundary where the button is enabled and the server refuses.
- **The admin override's deadline-reopen window is not visible to concurrent writers.**
  `admin_submit_preferences` and `admin_seed_preferences` set `preference_deadline = NULL`, write,
  and restore inside one transaction after taking `FOR UPDATE` on the period row
  (`20260711000003:79-115`, `20260711000002:50-88`). Under read-committed MVCC a concurrent
  `submit_preferences` reads the committed deadline, not the NULL, so a worker cannot slip a late
  submission through an admin's override window. A crash mid-write rolls the NULL back with the
  rest of the transaction.
- **The on-behalf write cannot touch anyone but its target.** `admin_submit_preferences` upserts
  only rows keyed on `p_target_user_id` (`20260711000003:94-110`) with no DELETE, so unlike
  `admin_seed_preferences` it has no cross-user blast radius. Its header states this and the body
  matches.
- **The two admin RPCs are genuinely service-role only.** Verified in the live catalog
  (`anon=false, authenticated=false` for both) and again over HTTP: the anon key received
  `42501 permission denied` from each, which is what makes them the negative control for the two
  anon P0s above.
- **`preferences` and `period_targets` are not readable or writable by `anon` through PostgREST.**
  Every policy on both tables is `TO authenticated` or `TO service_role` (full `pg_policies` dump
  taken), and RLS is enabled on both (`relrowsecurity = t`), so the broad table-level grants to
  `anon` are inert. The exposure on this journey is via the definer RPCs, not the tables.
- **A worker can only read their own preferences and target.** `workers can select own
preferences` and `workers can select own period targets` are `user_id = auth.uid()`, and the
  builder-facing SELECT policy is scoped through `user_can_build_schedule` on the block's house.
  No policy exposes one worker's board to another.
- **Preferences are editable and reversible up to the deadline, on both platforms.** Both boards
  re-read the saved rows on load and re-submit the full grid, so a resubmission is a complete
  overwrite rather than a merge: `buildSubmitPayload` emits an explicit status for every block on
  web (`packages/core/src/preferences/index.ts:149`) and mobile (`Preferences.kt:437`). Toggling
  "no hours" off is a plain `opted_out = false` upsert, so an opt-out is not a one-way door.
  Mobile additionally has an explicit Discard (`PreferencesViewModel.kt:255`).
- **The mobile block fetch is not exposed to the PostgREST 1000-row cap.** The query at
  `PreferencesRepository.kt:99-107` is `gte(block_start_at, monday)` ordered ascending with the
  upper bound enforced by a `break` in Kotlin. A single house generates roughly 37 blocks a day,
  so the representative week is about 260 rows and is always inside the first 1000 of an ascending
  scan. The comment on lines 109-115 explains why the bound is client-side (supabase-kt drops a
  second filter on the same column) and the reasoning holds.
- **Block generation and every label on this journey stay NY-anchored, with no wall-clock
  arithmetic across DST.** `blockWeekSlot` (`packages/core/src/preferences/index.ts:39`) resolves
  the weekday and minute-of-day through `toZonedTime`; `weekContains`
  (`packages/core/src/time/index.ts:34`) trims the representative week in NY; the mobile side uses
  `toLocalDateTime(NEW_YORK)` throughout `Preferences.kt`; and `nyWallClockIso`
  (`apps/web/lib/nyTime.ts:24-31`) resolves NY's offset at the requested instant rather than
  assuming one. Hard invariant 6 holds on this path.
- **The 30-minute block is the atomic unit everywhere on this journey.** `preferences` is keyed
  `(user_id, block_id, period_id)` with `block_id` FK to `shift_blocks`, both painters address
  whole blocks, and both submit payloads are per-block. No sub-block preference exists. Hard
  invariant 5 holds.
- **The Harnwell training invariant is not reachable from this journey.** Preferences carry no
  assignment, so `enforce_harnwell_assignment_training`
  (`20260527000005_schedule_builder.sql:378-421`) is not engaged; a preference row on a Harnwell
  block by a non-Harnwell worker is inert until the builder tries to assign it, where the trigger
  fires on `shift_block_assignments` and `draft_block_assignments`. Nothing on this path can
  create an assignment.
- **The hours cap is not engaged by preferences.** `period_targets.target_hours` is validated
  against the period's `default_hours_cap` by `enforce_period_target_hours_cap`
  (`20260527000005:342-376`), which is a build-input bound and not the weekly hours cap. Hard
  invariant 4 is about float assignment and is untouched here.
- **The reminder cadence is truthful about its own gaps.** `send_preference_reminders` records
  every send in `preference_reminder_sends`, and the oversight screen reads that table as
  authoritative rather than re-deriving it, showing an amber "window passed, none recorded" chip
  when a threshold elapsed with no row (`apps/web/lib/data/preferences.ts:252-267`, legend at
  `PreferencesOversight.tsx:18-22`). An SM can see a missed reminder rather than being told it
  was sent.
- **Input validation on the Edge Function is tight.** `submit-preferences/index.ts:98-133`
  rejects a non-UUID `period_id`, a non-array `preferences`, a non-integer or negative
  `target_hours`, a non-boolean `opted_out`, a non-UUID `block_id`, and any status outside
  `{preferred, available, cannot, none}`, and it rebuilds the array rather than forwarding the
  caller's objects, so extra keys cannot reach the RPC. Over-long or unicode input has nowhere to
  land: there is no free-text field anywhere on this journey.
- **Double submit is harmless.** Both submit paths are idempotent full-grid upserts on a composite
  primary key, so the second of two identical submissions changes nothing. The web button is
  disabled while `submitting` (`PreferenceBoard.tsx:284`) and mobile hides it once `isDirty`
  clears (`PreferencesViewModel.kt:131`).
- **Opting out does not silently discard painted work.** `opted_out` is stored alongside the
  preference rows rather than deleting them, and both boards keep the grid in state while the
  toggle is on, so turning it back off restores the paint (`PreferenceBoard.tsx:303`,
  `PreferencesViewModel.kt:230`).

## Not checked

- **The reminder cron's schedule and its one-hour firing window.** `send_preference_reminders`
  only fires inside `[deadline - Nd, deadline - Nd + 1 hour)` and has no catch-up, so a cron
  outage longer than an hour permanently skips that threshold. I could not measure the schedule:
  `cron.job` does not exist on this local stack (`pg_cron` is not installed), so I have no
  evidence about the real interval. This belongs to slice 15 (cron and the paths no journey walks
  through) and should be merged there rather than filed here.
- **Notification rendering for a preference reminder.** `send_preference_reminders` inserts the
  row with `type = 'ack_reminder'` and `payload.kind = 'preference_reminder'`. Whether the mobile
  and web notification surfaces render that combination correctly, or fall through to
  float-acknowledgement copy, is slice 12.
- **The `/admin/operations` dev seeding control.** `admin_seed_preferences` deletes **every**
  worker's `preferences` and `period_targets` rows for the period across all 13 houses
  (`20260711000002:66-67`), and `simulateWorkerPreferences`
  (`apps/web/lib/actions/devSeeding.ts:173`) is a single-click admin action. The card carries a
  "Regeneration replaces prior data" warning (`DevSeedingCard.tsx:88`) but no two-step confirm,
  unlike the publish control on the same card. I did not judge whether that surface is gated out
  of production, because `/admin/operations` is slice 10's territory. Flagging for slice 10.
- **The interactive Preferences tour.** `PreferencesTour.kt`, `PreferencesTourView.swift`, and
  `PreferencesTourChrome.kt` were read only for copy accuracy on the paint and target steps. The
  tour's step gating, the PAINT-step scrim swallow, and the pointer-callout re-show behaviour are
  slice 13.
- **Playwright, XCUITest, Robolectric, and Maestro were not run.** Every client finding is from
  reading the source and, where a server rule was involved, from a probe against the local stack.
  `maestro/05-submit-preferences.yaml` exists and would exercise the mobile submit path, but
  Maestro needs a real emulator or simulator and AGENTS.md restricts emulator verification to
  iOS.
- **`preference_deadline_is_open` under a set simulated clock.** `app_now()` on this stack reads
  about 1.4 days behind wall-clock time (`app_now() = 2026-07-25 17:56Z` against
  `now() = 2026-07-27 03:10Z`). Every deadline comparison in the DB uses `app_now()` while the
  web board uses `simNow()` and mobile uses `SimClock.now()`. I confirmed all three are
  sim-aware by construction but did not measure whether they agree to the second under a
  deliberately skewed clock, which is where a client-enabled button and a server refusal could
  diverge.
- **A real transfer fixture.** The only future-dated `user_house_memberships` row on this stack is
  a same-house row (`harnwell` to `harnwell`, effective 2026-07-26), so the transfer findings were
  traced through the code paths and the `membership_house_for_date` and `house_roster_as_of`
  bodies rather than reproduced end to end against a seeded cross-house transfer.
