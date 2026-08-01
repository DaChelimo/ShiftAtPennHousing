# Ship check: auth, session, and the per-house launch gate

Journey slice 1. Pass run 2026-07-26 against branch `feat/ui-float-polish`, with the local
Supabase stack up (grants and reachability probed against the live catalog and PostgREST, not
inferred from migration text).

---

### [P0] Anyone on the internet can read every open shift at every house, plus the user id of every active worker, with no sign-in

**Journey**: The authentication boundary itself. A worker who has never signed in, or someone
who has never had an account, hitting the public REST endpoint with the anon key that ships
inside the web bundle and the mobile app binary.

**Trigger**:

```
curl -s "http://<supabase-url>/rest/v1/worker_open_shifts?select=eligible_user_id,house_id,start_at&limit=1000" \
  -H "apikey: <NEXT_PUBLIC_SUPABASE_ANON_KEY>"
```

No session, no bearer token. Returns rows.

**Observed**: `worker_open_shifts` is an owner-rights view (deliberately not
`security_invoker`, see `supabase/migrations/20260726000001_open_shifts_horizon_bound.sql:59`),
so it bypasses `shift_block_assignments` RLS entirely, and it cross-joins every vacant seat
against `candidate_users` (every active `sw` / `sm` / `hm`). The `anon` SELECT grant on it was
deliberately removed on 2026-07-11 as a HIGH security finding
(`supabase/migrations/20260711000001_revoke_anon_worker_reads.sql:24`, whose header says in so
many words that the grant "let an UNAUTHENTICATED caller enumerate every open seat across
every house"). Two later migrations re-granted it:

- `supabase/migrations/20260724000004_permanent_occurrence_weekly_claim.sql:196`
- `supabase/migrations/20260726000001_open_shifts_horizon_bound.sql:324`

both ending in `GRANT SELECT ON worker_open_shifts TO anon, authenticated, service_role;`.

Confirmed against the live catalog, not the migration text:

```
select relname, relacl::text from pg_class where relname='worker_open_shifts';
worker_open_shifts|{postgres=arwdDxt/postgres,authenticated=arwdDxt/postgres,service_role=arwdDxt/postgres,anon=r/postgres}
```

`anon=r` is present. The unauthenticated curl above returned real seat rows on this stack.

**Expected**: `anon` holds no privilege on `worker_open_shifts`. The revocation shipped in
`20260711000001` is the intended state; `supabase/AGENTS.md` states the rule directly ("Verify
grants against the live catalog, not by grepping migrations for `REVOKE`, since a later
migration may revoke what an earlier one granted, or vice versa"). This is the second half of
that sentence happening in production code.

**Blast radius**: Every worker, every house, continuously, with zero authentication. Leaks the
full campus open-shift map (which desks are unstaffed and when, a physical-security signal) and
the `user_id` of every active worker. Those user ids are the input to the next ticket.

**Fix sketch**: New migration that (a) re-applies `REVOKE ALL ON worker_open_shifts FROM anon,
PUBLIC;` and (b) adds a pgTAP assertion naming `anon` explicitly, so a future
`CREATE OR REPLACE VIEW` plus blanket `GRANT` cannot silently revert it again. The assertion
must name `anon` by name: `has_function_privilege('public', ...)` style checks pass while anon
still holds the grant, which is exactly how this stayed invisible. Also worth a CI grep rule
that flags any new `GRANT ... TO anon` in `supabase/migrations/`.

**Acceptance check**: `curl` the endpoint above with only the anon key and get a
`permission denied` / empty result, and `select relacl from pg_class where
relname='worker_open_shifts'` shows no `anon=` entry. Re-run the mobile Open Shifts tab and the
web `/home/open` page signed in to confirm nothing regressed.

**Confidence**: verified in code and against the live catalog and live HTTP endpoint.

---

### [P0] An unauthenticated caller can fire any worker, unwinding every future shift they own

**Journey**: People administration. The RPCs behind `/admin/people`, which the whole
authorization model assumes only a house admin can reach.

**Trigger**:

1. Read a list of active worker `user_id`s from `worker_open_shifts` with the anon key (see the
   ticket above), or from any other anon-reachable surface.
2. Find which one is a house admin. `user_has_house_admin_role` is EXECUTE-able by `PUBLIC`
   (live `proacl` is `{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}`),
   so an anonymous caller can probe candidates directly:
   ```
   curl -s -X POST "<url>/rest/v1/rpc/user_has_house_admin_role" -H "apikey: <ANON_KEY>" \
     -H "Content-Type: application/json" \
     -d '{"check_user_id":"<candidate>","check_house_id":"harnwell"}'
   ```
3. Call `fire_worker` with that admin's uuid as `p_initiator`:
   ```
   curl -s -X POST "<url>/rest/v1/rpc/fire_worker" -H "apikey: <ANON_KEY>" \
     -H "Content-Type: application/json" \
     -d '{"p_initiator":"<the admin uuid>","p_user_id":"<victim uuid>"}'
   ```

**Observed**: `fire_worker` is `SECURITY DEFINER` and takes the acting identity as a plain
parameter. Its only authorization check is
`IF NOT user_has_house_admin_role(p_initiator, v_victim.home_house_id)`
(`supabase/migrations/20260606000003_s4_fire_worker.sql:96-98`), which trusts a value the
caller supplies. The migration ends with
`REVOKE ALL ON FUNCTION fire_worker(...) FROM PUBLIC;` plus a grant to `service_role` only
(lines 334-335), but that does not strip Supabase's default per-role grants. Live catalog:

```
fire_worker|{postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres}
```

Probed non-destructively with a uuid that does not exist, so no write was reachable. The
response was the function's own `{"code":"P0001","message":"worker_not_found"}`, which proves
`anon` executed the function body rather than being refused at the grant layer.

Firing is not a soft flag. `fire_worker` permanently drops every future recurring seat the
worker owns (`permanent_drop_slot` per slot), vacates every claimed seat
(`20260606000003:294-307`), voids their pending and acknowledged floats, voids their pending
swaps, and sets `is_active = false` (line 316). Those hours go to the open feed and get taken
by someone else. There is no undo path in the product.

The same shape applies to `hire_worker`, which is also anon-executable
(`{...anon=X...,authenticated=X...}`) and gates only on the caller-supplied `p_initiator`
(`supabase/migrations/20260611000004_hire_worker.sql:55-57`). Probed the same way: it returned
its own `not_authorized`, so it executed. `hire_worker` accepts `p_role` in
`('sw','sm','hm','bm')`, so a caller who controls a fresh `auth.users` row can insert an `hm`
role for themselves at any house. `supabase/config.toml:121` has `enable_signup = true` and
line 159 has `enable_confirmations = false`, so on this stack that row is one public signup
call away. That converts the same hole into privilege escalation to Housing Manager.
`transfer_worker` is correctly `service_role` only, which shows the asymmetry is an omission
rather than a policy.

**Expected**: A `SECURITY DEFINER` RPC that takes an actor id must not be reachable by `anon`
or `authenticated`. `supabase/AGENTS.md` states the required form: "a function meant to be
service-role-only needs `REVOKE EXECUTE ON FUNCTION <fn> FROM anon, authenticated;` naming
those roles explicitly, in the same migration that creates or changes it."

**Blast radius**: Every worker at every house. One unauthenticated request per victim
permanently unwinds their whole remaining semester of shifts. This is an instance of the
already-known "~37 definers still exposed" class recorded in `AGENTS.md`, filed here because
it sits directly on this journey and because the discovery half of the chain (the admin-uuid
oracle) is also anon-reachable, so the exploit is closed end to end rather than theoretical.
The full definer sweep belongs to `security-auditor`; this ticket covers only the people-admin
and authorization-predicate functions on the auth journey.

**Fix sketch**: New migration adding explicit
`REVOKE EXECUTE ON FUNCTION ... FROM anon, authenticated;` for `fire_worker(uuid,uuid,timestamptz)`,
`hire_worker(uuid,uuid,text,text,text,user_role_enum,text)`, and the authorization predicates
that are pure oracles (`user_has_house_admin_role`, `user_is_admin`, `user_is_schedule_admin`,
`user_is_rsm` currently all carry `anon=X`; the first also carries a `PUBLIC` grant). The
predicates are used inside RLS policies, which run as the policy owner, so revoking client
EXECUTE does not break them, but confirm that before shipping. Separately, replace the
`p_initiator` parameter with `auth.uid()` inside `fire_worker` / `hire_worker` and pass the
initiator only from the service path, so a future grant slip is not immediately fatal.

**Acceptance check**: pgTAP asserting
`NOT has_function_privilege('anon', 'fire_worker(uuid,uuid,timestamptz)', 'EXECUTE')` and the
same for `authenticated` and for `hire_worker`. Then the curl in the trigger returns a
PostgREST `PGRST202` / permission error instead of `worker_not_found`. Web `/admin/people`
hire and fire still work end to end (they go through the service client).

**Confidence**: verified in code and against the live catalog and live HTTP endpoint. The
signup dependency for the escalation half is verified in `supabase/config.toml` for local; the
production GoTrue setting lives in the Supabase dashboard and needs a runtime check.

---

### [P0] Firing a manager does not remove their powers, and nothing in the product can

**Journey**: A Housing Manager, Building Administrator, RSM, or Student Manager leaves or is
dismissed. An admin fires them on `/admin/people`.

**Trigger**:

1. Admin opens `/admin/people` and fires the Harnwell HM.
2. That HM opens the web console in the browser they were already signed into, or signs in
   again with the password they still know.
3. They land on the admin console, not a rejection.

**Observed**: `fire_worker` sets `users.is_active = false`
(`supabase/migrations/20260606000003_s4_fire_worker.sql:314-316`) and touches nothing else about
identity. It does not delete the `user_roles` rows, does not ban or delete the `auth.users`
row, and does not revoke the GoTrue refresh token, so the existing session keeps working and a
fresh sign-in also succeeds.

Nothing downstream re-checks `is_active` on the session path:

- `apps/web/lib/auth.ts:38-67` (`getSessionUser`) selects `user_id, name, email, home_house_id`
  and the `user_roles` rows. `is_active` is never read.
- `apps/web/proxy.ts:33-45` gates only on "is there a user".
- The SQL predicates are pure `user_roles` lookups with no `is_active` join:
  `user_is_schedule_admin` and `user_can_build_schedule`
  (`supabase/migrations/20260627000002_cross_house_schedule_admin.sql:41-84`, confirmed against
  the live `pg_get_functiondef`), `user_is_admin` and `user_has_house_admin_role`
  (`supabase/migrations/20260702000002_admin_role_powers.sql:33-46, 79-97`).

So a fired HM retains: `isHouseAdmin` (people admin at their own house, so they can fire the
remaining staff and hire), `isScheduleAdmin` (publish and override any house's schedule,
cross-house since 2026-06-27), force-trigger, weekly cap modification, and the HMOD rotor page.
A fired Student Worker retains a working session too and keeps reading `worker_directory`
(name, email, phone for every active worker campus-wide) and `house_schedule_grid_any` (every
house's live schedule), both of which grant `authenticated` a straight `r`.

There is also no repair path. Grepping every write to `user_roles` in `apps/web` returns only
`lib/actions/devSeeding.ts:149` (dev-only) and the `hire_worker` insert. There is no grant-role
or revoke-role action, no UI, and no RPC. A manager's role can only be removed with direct SQL
against the database.

**Expected**: Deactivation is meant to be the complete exclusion mechanism. The `fire_worker`
header asserts this explicitly: "flipping is_active=false handles ALL future exclusion for free
(every claim / float-lookup / broadcast path already gates on is_active=true)"
(`20260606000003:22-24`). That claim is true for the staffing engine and false for the
authorization layer, which never consults it. BSpec section 4.5 describes firing as the
destructive HR event that unwinds every obligation; keeping campus-wide schedule write is not
consistent with that.

**Blast radius**: Every departure of anyone holding `sm`, `hm`, `rsm`, `bm`, or `admin`. Low
frequency, unbounded severity: a dismissed manager can publish over a whole house's schedule
(which rewrites real assignments), fire staff, or force-trigger floats. Also every fired
Student Worker, who keeps campus-wide contact-directory read.

**Fix sketch**: Three parts, all needed.

1. `apps/web/lib/auth.ts` `getSessionUser`: select `is_active` and return `null` when it is
   false, so every downstream helper fails closed and the layouts redirect to `/login`. Add an
   explicit "this account is deactivated" screen rather than a bare redirect, or the person hits
   the login loop described in "Not checked".
2. `fire_worker` (new migration): delete the victim's `user_roles` rows in the same transaction,
   and record them so a mis-fire is reversible.
3. `apps/web/lib/actions/people.ts` `fireWorker`: after a successful RPC, call
   `service.auth.admin.updateUserById(userId, { ban_duration: 'none' })` or equivalent to kill
   the live GoTrue session, so an already-open tab does not keep working until the refresh
   token expires.

**Acceptance check**: pgTAP: fire a seeded HM, then assert `user_has_house_admin_role`,
`user_can_build_schedule`, and `user_is_schedule_admin` all return false for them. Playwright:
sign in as an HM, fire them from a second admin session, reload the first session's
`/schedule-builder` and assert it does not render the builder.

**Confidence**: verified in code. The GoTrue session-survives-firing half is inferred from
code (nothing calls the GoTrue admin API on the fire path) and would take a runtime check to
demonstrate the exact token lifetime.

---

### [P1] A worker at a house that has not launched is float assigned, pushed reminders, and physically cannot acknowledge or decline

**Journey**: During a staged rollout, some houses are live and some are not. A worker at a
pre-launch house is picked by the float lookup as the source for a live house's vacancy.

**Trigger**:

1. `system_config('staggered_launch_enabled') = 'true'`, house A is `live`, house B is
   `pre_launch`, and `float_routing` for the active profile lists B as a source for A. (This is
   the seeded school-year routing for `quad`, and it is every open house in summer, where the
   compiler generates all-pairs routing.)
2. A seat at house A goes vacant and reaches its `float_lookup` step.
3. The lookup selects a worker whose home house is B.
4. That worker opens the app.

**Observed**: The launch gate stops the escalation chain at discovery only.
`orchestrator_vacant_seats` joins `house_is_live(sb.house_id)`
(`supabase/migrations/20260726000003_orchestrator_scan_efficiency.sql:129`), which filters the
DESTINATION. Nothing filters the SOURCE: `buildFloatLookupSnapshot` reads `float_routing`, then
pulls source assignments and users with no liveness predicate anywhere
(`supabase/functions/orchestrator-tick/floatLookup.ts:227-270`).

The float is written, the worker's home seat flips to `floated_out`, the destination seat to
`pending_float_in`, and `snapshot_float_ack_reminders` schedules the acknowledgment cadence, so
they get a float-assigned push plus reminders.

Then every surface that could act on it is behind the launch gate:

- Web: `apps/web/app/(worker)/layout.tsx:26-31` returns `<HouseNotLive/>` before the portal
  shell renders, so `/home/updates` and the ack action are unreachable.
- Android: `apps/mobile/androidApp/src/main/java/com/pennhousing/shift/MainActivity.kt:297-305`
  renders `HouseNotLiveScreen` instead of `LiveShiftsRoot`, which is where `launchFloatAckId`
  and the ack modal live.
- iOS: `apps/mobile/iosApp/iosApp/iOSApp.swift` `GatedShiftsView` renders `HouseNotLiveView`
  instead of `ShiftsRootView`, so the `pennshift://float-ack/{id}` deep link lands on nothing.

The worker can neither acknowledge nor decline. At the deadline `process_no_ack_float` fires:
it does restore their source seat to `scheduled`
(`supabase/migrations/20260713000001_offhours_allied_ladder.sql:719-723`), so no hours are lost,
but it voids the float, pages the HMOD or RSM urgently, and secures Allied for a desk an
available worker was actually assigned to.

**Expected**: BSpec section 22 says launch state is a visibility gate that "does not change any
coverage, claim, swap, float, or cap rule in Sections 1 through 15", and that a pre-launch
worker "is told that their house is not on the system yet rather than showing an empty or
broken schedule". Being sent an unactionable float assignment is neither. The 2026-07-26
amendment already established the principle for the destination side: "a desk that is not
launched has nobody to page". A worker who cannot open the app has nobody to page either.

**Blast radius**: Every stage of the rollout after the first, whenever a live house has a
vacancy and a dark house is a routing source. Costs a real Allied procurement per occurrence
plus an urgent page. If the worker acts on the push and reports to the destination desk anyway
(they were told to and cannot decline), they arrive to find Allied already there.

**Fix sketch**: Add the liveness filter to the source side in
`supabase/functions/orchestrator-tick/floatLookup.ts`, either by filtering `route.source_house_id`
through `house_is_live` before the per-route query or by adding the predicate to the source
query. Prefer a set-based SQL helper mirroring `orchestrator_vacant_seats` so the two sides
cannot drift. Also check the broadcast step for the same shape (broadcast is house-local so it
should be safe, but confirm). Update ARCHITECTURE.md section 16.2, which currently documents
only the destination-side gate.

**Acceptance check**: pgTAP or an orchestrator integration test with the master switch on, house
B pre-launch, house A live, and a vacancy at A: assert no `float_assignments` row is created
with a `user_id` whose home house is B. Confirm the existing float suite is unchanged with the
master switch off.

**Confidence**: verified in code.

---

### [P1] A manager who transfers houses keeps write authority over the house they left

**Journey**: An HM, BM, RSM, or SM moves to a different house. An admin runs Transfer on
`/admin/people`.

**Trigger**:

1. Diana is `sm` scoped to `du-bois` and home-housed at `du-bois`.
2. An admin transfers her to `rodin`, effective today.
3. She signs in.

**Observed**: `transfer_worker` and `apply_house_transfer` move
`user_house_memberships`, flip `users.home_house_id`, reopen her old-house seats, and void her
live floats. Neither ever touches `user_roles`
(`supabase/migrations/20260719000001_house_transfers.sql`: the only occurrence of `user_roles`
in the whole file is line 358, a read of the `sw` role in an unrelated roster query).

So her `sm` row still reads `scope_house_id = 'du-bois'`. Consequences:

- `user_can_build_schedule(diana, 'du-bois')` stays true, so she can still publish and override
  the schedule of the house she left, and still reads its assignments and floats through the RLS
  policies that OR on that predicate.
- `adminHouseId` in `apps/web/lib/auth.ts:181-188` returns the first scoped role, which is
  `du-bois`, so the entire admin console keeps targeting her old house.
- `canBuildForHouse(diana, 'rodin')` is false (`apps/web/lib/auth.ts:151-154`), so she cannot
  build the house she now belongs to.

There is no in-app repair. As established in the fired-manager ticket, there is no role grant
or revoke surface anywhere in `apps/web`, so correcting the scope requires direct SQL.

**Expected**: `supabase/AGENTS.md` records that people admin and schedule authority for
hm/bm/rsm are own-house and scope-matched. A completed transfer should either move the scope
with the worker or drop it and require an explicit re-grant at the destination. Silently leaving
write authority pointed at the previous house satisfies neither reading. BSpec section 21 and
ARCHITECTURE.md section 17 describe the transfer without mentioning roles at all, which is the
gap that let this ship.

**Blast radius**: Every manager transfer. Low frequency, but the failure is silent in both
directions: authority left behind at the old house, and no authority at the new one, with the
person having no way to tell which house the console is acting on other than the switcher.

**Fix sketch**: Decide the rule with the stakeholder first, since this is a policy question, not
a bug with one obvious answer. Then in the same migration as the decision:
`apply_house_transfer` either re-points `user_roles.scope_house_id` for the moving user's
scoped roles to the destination, or deletes them and returns a `roles_dropped` count that
`transferWorker` surfaces in the confirmation copy. Whichever is chosen, add the sentence to
BSpec section 21 and ARCHITECTURE.md section 17 in the same commit.

**Acceptance check**: Extend `supabase/tests/house-transfers.sql`: transfer an `sm` and assert
`user_can_build_schedule(user, old_house)` is false afterwards. Playwright: transfer an SM, sign
in as them, assert `/schedule-builder` targets the new house.

**Confidence**: verified in code.

---

### [P1] The mobile launch gate has no admin bypass, so BSpec section 22's "Administrators are not gated" is false on both mobile platforms

**Journey**: A Student Manager at a house that has not launched yet opens the mobile app to
prepare for go-live (the app carries the SM add-worker and force-trigger surfaces).

**Trigger**: Master switch on, the SM's home house is `pre_launch`. Sign in on iOS or Android.

**Observed**: The mobile gate takes only a user id and checks only home-house liveness.
`WorkerShiftsRepository.fetchHomeHouseGate(userId)`
(`apps/mobile/shared/src/commonMain/kotlin/com/pennhousing/shift/shared/data/WorkerShiftsRepository.kt:556-580`)
resolves `home_house_id` then calls `house_is_live`. It reads no role. Both callers render the
placeholder unconditionally on a false result:
`apps/mobile/androidApp/src/main/java/com/pennhousing/shift/MainActivity.kt:300-305` and
`GatedShiftsView` in `apps/mobile/iosApp/iosApp/iOSApp.swift`.

Web does the opposite. `apps/web/app/(worker)/layout.tsx:26` wraps the gate in
`if (!hasAdminSurface(user))`, so any sm/hm/rsm/bm/admin bypasses it entirely.

One rule, two implementations, and they disagree.

**Expected**: `BEHAVIORAL_SPECIFICATION.md:1427` states, without qualification, "Administrators
are not gated and can see and prepare a pre-launch house." That sentence is now false for the
mobile app. Per the repo's own rule (root `AGENTS.md`, "Fix superseded text, do not just
append"), a spec sentence that no longer describes the code is a defect regardless of which
side is wrong, because it is what the next person builds on.

**Blast radius**: Every manager at a pre-launch house during the rollout, on the platform most
of them carry. They are not permanently stuck (the web console is not gated for them), but the
mobile manager surfaces are unreachable exactly when preparation happens.

**Fix sketch**: Pick one and make both true. Either (a) `fetchHomeHouseGate` also reads the
caller's `user_roles` and returns `isLive = true` for any non-`sw` role, mirroring
`hasAdminSurface`, or (b) narrow the BSpec sentence to say the admin bypass is web-only and
state why. Option (a) is the smaller change and matches the spec as written. Whichever is
chosen, `BEHAVIORAL_SPECIFICATION.md` section 22 and `ARCHITECTURE.md` section 16.2 both need
the sentence corrected in the same commit.

**Acceptance check**: Kotlin test on the gate resolution with a role snapshot, plus a manual
run: master switch on, SM's house pre-launch, sign in on the iOS simulator and land on the
shifts tree rather than `HouseNotLiveView`.

**Confidence**: verified in code.

---

### [P2] A worker held out by the launch gate has no way to sign out on the web

**Journey**: A worker at a pre-launch house signs in on the web, on a shared desk machine or
with the wrong account.

**Trigger**: Sign in at `/login` as a pure `sw` whose home house is `pre_launch` with the master
switch on. Land on the placeholder. Try to sign out.

**Observed**: `apps/web/app/(worker)/layout.tsx:29` returns `<HouseNotLive/>` and returns before
`<WorkerShell>` is constructed. Sign-out exists in exactly two places in the whole web app,
`components/AppShell.tsx:220` and `components/WorkerShell.tsx:102`, and neither renders. The
placeholder itself (`apps/web/components/HouseNotLive.tsx`) has no sign-out control and no link
anywhere except the copy "reach out to your manager". The proxy will not bounce them, because
they do have a session. The only escape is knowing to type `/login` manually.

Both mobile platforms get this right: `HouseNotLiveScreen` and `HouseNotLiveView` are both
passed an `onSignOut`.

**Expected**: A screen that tells a person which account they are signed in as ("You're signed
in as {email}") must give them a way to sign out of it. This is also a cross-platform
divergence: the same placeholder has a sign-out on mobile and not on web.

**Blast radius**: Every pre-launch worker on a shared machine. Recoverable alone if they guess
`/login`, which is why this is not a P1.

**Fix sketch**: `apps/web/components/HouseNotLive.tsx` gains a sign-out button using the same
`supabase.auth.signOut()` plus `router.refresh()` pattern as `components/WorkerShell.tsx:102`.
It needs to become a client component or take a small client child.

**Acceptance check**: Playwright: sign in as a pre-launch worker, assert
`data-testid="house-not-live-title"` renders and that a sign-out control exists and returns to
`/login`.

**Confidence**: verified in code.

---

### [P2] The Desk Assistant route group bypasses the launch gate entirely

**Journey**: A worker at a pre-launch house who was given, or guesses, the `/assistant` URL.

**Trigger**: Sign in as a pure `sw` at a `pre_launch` house with the master switch on. Navigate
to `/assistant` instead of `/home`.

**Observed**: `apps/web/app/(assistant)/layout.tsx:9-12` checks only "is there a session" and
redirects to `/login` if not. It never calls `getHouseGate`. The launch gate lives only in
`app/(worker)/layout.tsx`. So the assistant renders, and the assistant has a live
`personal_schedule` intent backed by the `assistant_my_shifts` RPC, meaning a worker the gate is
meant to be holding back can read their own shifts through it while the portal tells them their
house is not on the system yet.

**Expected**: BSpec section 22 describes the gate as covering the worker's app experience. Two
worker-facing surfaces disagreeing about whether a person is held out is the kind of
inconsistency that produces a support call, and the assistant costs real money per question.

**Blast radius**: Pre-launch workers who reach `/assistant` directly. Not linked from any
gated page, so discovery is by URL sharing or an old bookmark. Low frequency, which is why this
is not a P1.

**Fix sketch**: Extract the gate check from `app/(worker)/layout.tsx:26-31` into a shared helper
(for example `lib/auth.ts` `requireLaunchedHouse(user)`) and call it from
`app/(assistant)/layout.tsx` too. Decide deliberately whether `/assistant/desk` (the kiosk) is
in or out, and say so in ARCHITECTURE.md section 16.2, which currently says only "a placeholder
for workers, admins bypass" without naming which routes.

**Acceptance check**: Playwright: pre-launch worker navigates to `/assistant`, sees the
placeholder rather than the chat.

**Confidence**: verified in code.

---

### [P2] The mobile launch gate is resolved once per app launch, so a worker whose house goes live stays on "coming soon"

**Journey**: Go-live morning. The admin flips the house to live at 08:00. A worker already has
the app open, or opened it earlier and left it backgrounded.

**Trigger**: Open the app while the house is `pre_launch`, land on the placeholder, have the
admin launch the house, then bring the app back to the foreground.

**Observed**: Android resolves the gate in
`produceState<HomeHouseGate?>(initialValue = null, session.userId)`
(`MainActivity.kt:297-299`), keyed on the user id, which does not change. iOS uses
`.task(id: userId)` in `GatedShiftsView`, which does not re-run while the view stays on screen.
Neither re-checks on `ON_RESUME` or `scenePhase == .active`, even though both already have a
foreground hook there for the sim clock (`MainActivity.kt:158-167`,
`iOSApp.swift` `onChange(of: scenePhase)`). So the placeholder persists until the process is
killed and relaunched, or until the worker signs out and back in.

Web has no equivalent problem: the gate is a server component check that runs on every request.

**Expected**: The go-live moment is the one moment this screen's accuracy matters. The
placeholder says "Check back shortly", which is only true if checking back actually re-runs the
check.

**Blast radius**: Every worker at every house on its launch morning. Recoverable alone by force
quitting or signing out, which is why this is not a P1, but the placeholder copy does not tell
them to do either.

**Fix sketch**: Re-key the gate producer on the same foreground epoch the sim clock already
bumps, or add an explicit refresh: Android, add `clockEpoch` or a new `gateEpoch` to the
`produceState` keys and bump it in the existing `ON_RESUME` observer; iOS, bump a `@State`
counter in the existing `onChange(of: scenePhase)` and include it in `.task(id:)`. Add a "Check
again" button to both placeholder screens so the recovery is discoverable.

**Acceptance check**: Manual on the iOS simulator: sign in with the house pre-launch, flip the
house live from `/admin/launch`, background and foreground the app, land on the shifts tree
without a relaunch.

**Confidence**: verified in code.

---

### [P2] The sign-in page will forward a worker to any URL supplied in the query string

**Journey**: A worker receives a link that looks like the real Shift sign-in page, signs in
correctly on the real site, and is then sent somewhere else.

**Trigger**: Open `https://<shift-host>/login?redirectTo=https://evil.example/session-expired`,
sign in with real credentials.

**Observed**: `apps/web/app/login/page.tsx:35-36` reads the parameter and navigates to it with
no validation:

```ts
const redirectTo = searchParams.get('redirectTo') ?? '/';
router.replace(redirectTo);
```

The only writer of that parameter is `apps/web/proxy.ts:43`, which always sets it to a
same-origin `pathname`, so the legitimate flow never produces an absolute URL. Nothing rejects
one supplied by hand.

**Expected**: A post-authentication redirect target must be constrained to a same-origin path.
The phishing value is specifically that the credential prompt the victim sees after the bounce
follows a genuine, successful sign-in on the real domain.

**Blast radius**: Any worker who can be induced to click a link. The credentials are not stolen
by this bug directly; the bug supplies the credibility for the page that steals them.

**Fix sketch**: In `apps/web/app/login/page.tsx`, accept `redirectTo` only when it matches
`/^\/(?!\/)/` (a single leading slash, rejecting `//host` protocol-relative forms), otherwise
fall back to `/`. A shared `safeRedirect(raw)` helper in `lib/auth.ts` would let the proxy and
any future caller share the rule.

**Acceptance check**: Playwright: sign in via `/login?redirectTo=https://example.com` and assert
the resulting URL is same-origin. Add cases for `//example.com` and `/admin/launch`.

**Confidence**: inferred from code. The exact navigation behaviour of `router.replace` with an
absolute external URL in this Next version needs a runtime check, but the input is unvalidated
either way and the fix is the same.

---

### [P3] Em dash in the sign-in screen copy

**Journey**: Every user, every sign-in.

**Trigger**: Open `/login` on a wide viewport. The left brand panel copy renders.

**Observed**: `apps/web/app/login/page.tsx:51` reads "Build schedules, manage floats and swaps,
and keep every front desk staffed — all from one console." That is an em dash in user-visible
copy.

**Expected**: Root `AGENTS.md`, Conventions: "No em dashes in user-facing text. Any string a
user can ever see or that is stored for later display ... must NOT contain an em dash or en
dash." Comments and log lines are exempt, which is why the `//` comments in
`app/auth/forgot/page.tsx:11` and `app/auth/update-password/page.tsx:11,33,51` and the
`login.css` header comment are not findings.

**Blast radius**: Cosmetic, on the most-viewed screen in the product.

**Fix sketch**: Re-punctuate in `apps/web/app/login/page.tsx`: "... and keep every front desk
staffed, all from one console."

**Acceptance check**: The repo's existing em-dash lint hook passes on `apps/web/app/login/page.tsx`, with only comment lines matching.

**Confidence**: verified in code.

---

## Verified clean

Surfaces walked on this journey that I believe are genuinely sound, with the guard that makes
them so.

- **The SM cross-house invariant.** `user_can_build_schedule` was read from the live catalog via
  `pg_get_functiondef`, not from the migration: the `sm` branch is
  `role = 'sm' AND scope_house_id = check_house_id`, still scope-matched. `user_is_schedule_admin`
  is `hm/bm/rsm/admin` with no `sm`. The TS mirror `isScheduleAdmin`
  (`apps/web/lib/auth.ts:138-145`) lists the same four roles and deliberately omits `sm`, and
  `canBuildForHouse` (line 151-154) falls through to an exact house match for everyone else.
  The two sides agree.
- **People admin stays own-house for hm/bm/rsm.** `user_has_house_admin_role`
  (`supabase/migrations/20260702000002_admin_role_powers.sql:79-97`) is
  `user_is_admin(...) OR (role IN ('hm','bm','rsm') AND scope_house_id = check_house_id)`. The
  `admin` widening is unconditional and admin-only, exactly as `supabase/AGENTS.md` documents,
  and the hm/bm/rsm branch is untouched. `fireWorker` and `transferWorker`
  (`apps/web/lib/actions/people.ts:99, 269`) both re-check the target's home house against
  `adminHouseId` before calling the RPC, and the RPC re-checks authoritatively.
- **The launch admin mutations are correctly gated.** `set_house_launch_state` and
  `set_staggered_launch_enabled` (`supabase/migrations/20260712000001_house_launch_state.sql:90,118`)
  both open with `IF NOT user_is_admin(auth.uid())`, so even though the live catalog shows them
  granted to `authenticated`, an ordinary signed-in user gets an exception rather than a
  mutation. The web actions that bypass the RPC and write through the service client
  (`apps/web/lib/actions/launch.ts:22, 48`) gate on `isAdmin(me)` first, and the file's header
  comment explains exactly why the web gate has to be authoritative on that path. The
  `/admin/launch` page independently renders a 403 notice for non-admins
  (`app/(app)/admin/launch/page.tsx:14-23`).
- **`house_is_live` and `is_staggered_launch_enabled` are not anon-reachable.** Live `proacl`
  for both is `{postgres,authenticated,service_role}` with no `anon`, so the launch state is not
  enumerable without a session. `worker_visible_houses` shows `anon=Dxt` with no `r`, meaning
  anon holds no SELECT on it either.
- **The gate fails open by design, and that is the right direction.** Both
  `getHouseGate` (`apps/web/lib/data/config.ts:51-54`) and `fetchHomeHouseGate`
  (`WorkerShiftsRepository.kt:563, 578`) resolve to live on any read error. The reasoning is
  written down in both places and in the migration header: the gate is visibility, not
  authorization, RLS is unchanged, and failing closed would strand every worker on the
  placeholder during a staged deploy where the client ships before the migration. I checked the
  fail-open direction for a real harm case and did not find one, because nothing downstream of
  the gate grants any privilege.
- **The recovery-link onboarding does not let an already-signed-in user change their password
  without re-auth.** `apps/web/app/auth/update-password/page.tsx:36-49` requires either a
  `PASSWORD_RECOVERY` event or a `type=recovery` hash before it will show the form, and the
  comment states the reasoning. The 5-second timeout at line 52-54 stops a stale token hanging
  on "Verifying" forever, and `apps/web/app/auth/forgot/page.tsx:27-29` always reports success
  so the endpoint is not an account-enumeration oracle. `generateSetupLink`
  (`apps/web/lib/data/authLinks.ts`) is deliberately not a `'use server'` module, with a comment
  explaining that the recovery link is a login-equivalent secret, and its three callers all gate
  on `isHouseAdmin` first.
- **Mobile token refresh on the write path.** `EdgeFunctionClient.authed`
  (`apps/mobile/shared/.../network/EdgeFunctionClient.kt:57-70`) refreshes a near-expiry session
  before every privileged call and forces one refresh plus retry on a 401, which is the guard
  against the "optimistic UI reported success while the write silently no-oped" failure this
  repo has been bitten by. `WorkerBackend.wireAccessToken` reads the token lazily on each call
  rather than capturing it, so supabase-kt's internal refresh is reflected. `wireAccessToken` is
  reached on all three entry paths: cold restore (`WorkerBackend.restoreValidSession:105`),
  Android in-session sign-in (`MainActivity.kt:288`), and iOS in-session sign-in
  (`LoginView.swift:80`).
- **Web session freshness.** `getSessionUser` is wrapped in React `cache()`, which is per
  request, and `apps/web/lib/auth.ts:29-33` documents why a cross-request cache would be an
  authorization bug given that `writeHouseId` and `canBuildForHouse` derive write scope from it.
  So a role change lands on the next navigation. `proxy.ts` calls `supabase.auth.getUser()` on
  every request, which validates the JWT against GoTrue rather than trusting the cookie.
- **`adminHouseId` non-determinism is not reachable today.** `user_roles_unique` allows a user to
  hold two scoped roles, and `adminHouseId` (`apps/web/lib/auth.ts:181-188`) picks the first one
  from an unordered query, which would be non-deterministic. I did not file it: there is no role
  grant surface anywhere in `apps/web`, and `hire_worker` inserts exactly one role, so a
  two-scope user cannot be produced through the product. If a role-management UI is built (which
  the fired-manager ticket requires), this becomes live and needs an explicit "which house am I
  acting as" selector rather than a `find`.

## Not checked

- **Production GoTrue configuration.** `supabase/config.toml` is the local stack. `enable_signup`,
  `enable_confirmations`, `jwt_expiry`, and the redirect allowlist are set in the Supabase
  dashboard for a deployed project and are not in this repo. The escalation half of the
  `hire_worker` ticket depends on signup being enabled there; the `fire_worker` half does not.
- **The full definer grant sweep.** I probed only the functions on this journey (`fire_worker`,
  `hire_worker`, `transfer_worker`, the four authorization predicates, and the four launch
  functions). `AGENTS.md` records roughly 37 definers still exposed; `claim_open_shift` is one of
  them (live `proacl` carries `anon=X` and it takes a caller-supplied `p_user_id`), but the claim
  path is not my slice and the sweep belongs to `security-auditor`.
- **Offline and expired-refresh-token cold launch on mobile.** `SupabaseAuthGateway.currentSession`
  bounds the restore with an 8-second timeout and returns null on timeout, which routes to the
  login screen. Whether a worker with no signal and an expired access token therefore cannot see
  their own already-downloaded schedule depends on supabase-kt's internal refresh behaviour,
  which I could not settle from this repo. Needs a runtime check on a device in airplane mode
  more than an hour after last use. Related and also unsettled: `fetchWorkerWeek` does not catch,
  so a throw propagates into `collectAsStateWithLifecycle`; I could not determine from source
  whether that crashes or hangs the Android launch, and it matters because either outcome is
  worse than a "we could not load your shifts" message.
- **`UserSession.user` being null on a restored session.** `SupabaseAuthGateway` maps
  `userId = user?.id ?: ""` (`SupabaseAuthGateway.kt:95`). An empty user id would make every
  RLS-scoped read return nothing while the app renders a normal empty state. I could not
  establish from source that supabase-kt ever produces that state, so I did not file it.
- **Whether a live-house worker can claim a shift at a pre-launch house.** `worker_open_shifts`
  is not launch-filtered and cross-house pickup is permitted for non-Harnwell houses
  (`20260726000001:322`). Whether that is harmful depends on whether pre-launch houses are still
  running their legacy scheduling process in parallel, which is an operational fact I do not have.
  Worth a decision, not a finding.
- **Push token registration for pre-launch workers.** Registration happens at Application and
  AppDelegate start (`ShiftPennHousingApp.kt:49`, `AppDelegate.swift:56`), outside the gate, so a
  pre-launch worker does hold a live token. With the destination-side orchestrator gate in place
  I could not construct a broadcast that reaches them; the float path is the one I could, and it
  is filed above. Other notification producers (swaps, permanent-drop alerts, publish) were not
  walked.
- **PennKey SAML.** Recorded as not built. Everything above assumes email and password is the
  only credential.
