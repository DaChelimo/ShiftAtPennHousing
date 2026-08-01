# Manager Mode — Mobile Spec

Status: SPEC (not built). Authored 2026-07-29. **Revised 2026-07-29** after a second
stakeholder session; see §2 for what changed and §12 for what the revision superseded.
Intended use: **kickstart document for a fresh session.** It is written to be read cold, with
no prior conversation context. Read this, then the root `AGENTS.md` and
`apps/mobile/AGENTS.md`, before writing code.

Companion documents:

- [`docs/allied-coverage-alerting/PLAN.md`](../allied-coverage-alerting/PLAN.md) — the
  server + web side this depends on. **It has landed.** See §3.
- BSpec §5.4a — the Allied coverage request lifecycle, already specified and already built.

---

## 1. The problem this solves

When Shift's escalation chain exhausts every internal option for a vacant desk, a human has
to procure Allied cover or the desk sits empty. That is the highest-consequence event this
system produces.

The server and web side of that is now built: the request is an object with a lifecycle
(`allied_coverage_requests`), it climbs a three-rung ladder, it never clears itself, and it
leaves a missed-coverage record when a desk goes unstaffed. What is still missing is the part
that reaches a human who is not sitting at a laptop at 22:00.

**This app is what makes a phone ring.** That is its reason to exist, and every scoping
decision below should be resolved in favour of it.

Managers also work desk shifts (an RSM holds shifts like an HM, and
`20260729000002_rsm_desk_assignment.sql` put them on the desk explicitly), so the app is not
only a pager. It carries the worker surfaces a manager actually needs, and drops the ones
they do not.

---

## 2. Decided, do not relitigate

Settled with the stakeholder on 2026-07-29 across two sessions.

| Decision              | Value                                                                                                                                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App shape             | **Manager mode inside the existing KMP app**, role-gated. NOT a separate app, NOT a separate bundle id, NOT a separate Firebase project.                                                                                                                                |
| Alert intensity       | **iOS `time-sensitive` + Android high-importance full-screen channel.** No Apple critical-alert entitlement dependency. Structure the payload so `critical` can be flipped on later without rework, but **do not block on Apple and do not file it as a prerequisite.** |
| Roles in manager mode | **RSM / HM / BM** get everything. **SM is included but own-house only**, and has no Allied coverage inbox (the ladder never routes to an SM).                                                                                                                           |
| Cross-house           | **Match web exactly.** House switcher over all 13 houses; grid edits, overrides and force-trigger target the _viewed_ house. One authorization model across platforms.                                                                                                  |
| Ack and close         | **One flow, not two buttons.** See §6.1. The manager never reads the words "acknowledge" or "close out".                                                                                                                                                                |
| In-app urgency        | **Persistent banner + tab badge** while a covered house has an open request. Not a blocking takeover.                                                                                                                                                                   |
| Escalation ladder     | **RSM → Housing Manager → HMOD on duty.** Exactly three rungs. Never fanned out to any other manager, never to other houses' RSMs. (Already built; BSpec §5.4a.)                                                                                                        |
| Close-out record      | An open coverage request **never auto-clears**. A human must record an outcome.                                                                                                                                                                                         |
| Out of scope          | SMS, voice calls, email, browser web push, schedule building, preferences authoring, people admin, knowledge base.                                                                                                                                                      |

**Why one app and not two.** A second app duplicates the auth pipeline, the Firebase project,
the push-token registration path, the release and signing setup, and the store listing, and
then doubles every future change to any of them. A manager who also works a desk would need
both installed. The worker tab set is simply shaped per role instead.

---

## 3. What has already landed (verify, do not rebuild)

The first draft of this spec named a `dispatch-push` fix as a hard prerequisite and told the
implementing session to do it before any UI work. **That work is done.** Confirmed against
source on 2026-07-29:

- [`supabase/functions/dispatch-push/index.ts`](../../supabase/functions/dispatch-push/index.ts)
  no longer sends a bare `data` map. It resolves a presentation and calls `buildFcmMessage`,
  so APNs is now asked to present something and iOS pushes render.
- [`supabase/functions/_shared/push-presentation.ts`](../../supabase/functions/_shared/push-presentation.ts)
  already classifies `hmod_urgent` and `allied_page` as `URGENT_TYPES`, titles the former
  "Allied coverage needed", and sets `iosInterruptionLevel: 'time-sensitive'` with a comment
  marking `critical` as a later upgrade gated on the Apple entitlement. **This is exactly the
  alert intensity decided in §2.** Do not change it, and do not add an entitlement request to
  the critical path.
- [`supabase/migrations/20260729000010_allied_coverage_ladder.sql`](../../supabase/migrations/20260729000010_allied_coverage_ladder.sql)
  built the whole request lifecycle: the `allied_coverage_requests` table with a
  one-open-per-block unique index, `resolve_allied_ladder_rung`,
  `advance_allied_coverage_ladder`, `acknowledge_allied_coverage_request`,
  `close_allied_coverage_request`, `system_close_obsolete_coverage_requests`, and the rewired
  `process_hmod_notify_allied_step` / `process_no_ack_float` terminals.
- Web already renders it: `apps/web/components/coverage/CoverageAlert.tsx`,
  `apps/web/lib/data/coverage.ts`, `apps/web/lib/actions/coverage.ts`,
  `apps/web/app/(app)/admin/coverage/page.tsx`.

**First task of the implementing session is therefore verification, not construction.** Send a
real `hmod_urgent` notification through `dispatch-push` to a registered manager device and
confirm it renders on a locked iOS device (the simulator does not exercise APNs) and on
Android. If it does, go straight to §6. If it does not, fix delivery before drawing a single
screen: a manager app that installs cleanly, registers a token, receives the message and stays
silent is a worse failure than the current web-only state, because it looks solved.

### 3.1 The one client-side delivery bug that is still live

[`apps/mobile/.../notifications/Notifications.kt:41`](../../apps/mobile/shared/src/commonMain/kotlin/com/pennhousing/shift/shared/notifications/Notifications.kt)
maps `hmod_urgent` to `NotificationCategory.INFO`, in the same `else ->` branch as `broadcast`
and `hm_leave_notice`. A coverage alert would arrive correctly classified by the server and
then be rendered by the client as a low-priority informational row. `allied_page` already has
its own `ALLIED_PAGE` category and its own body builder; `hmod_urgent` needs the equivalent.
Fix this in step 1 of the build order.

---

## 4. Where this plugs into the existing app

The KMP app follows Google's Fruitties pattern: shared logic and ViewModels in `:shared`,
native UI per platform. Manager mode adds to each layer rather than forking any of them.

```
apps/mobile/
  shared/src/commonMain/kotlin/com/pennhousing/shift/shared/
    manager/          <- EXISTS. AssignWorker.kt, ForceTrigger.kt, RosterWorker.kt
                         (the SM force-trigger / add-worker surfaces already shipped).
                         Add coverage/ and hours/ here.
    data/
      ManagerRepository.kt   <- EXISTS. Extend, do not replace.
      ProfileRepository.kt   <- EXISTS. Already reads user_roles and computes a highest
                                role via ROLE_PRECEDENCE = ["bm","hm","rsm","sm","sw"].
                                This is the gate for manager mode. It does NOT yet read
                                scope_house_id; §5 needs that.
      WeeklyCapRepository.kt <- EXISTS. Reuse for the Hours screen's cap column.
    viewmodel/        <- add CoverageViewModel.kt and HouseHoursViewModel.kt (snapshot +
                         injected `now`, per the phase-13a rule: never read a clock inside
                         tested logic)
    notifications/
      Notifications.kt <- EXISTS. Extend for hmod_urgent (§3.1).
    house/            <- EXISTS. The week grid + WorkerColors. Reuse as-is.
  androidApp/  (Jetpack Compose)
  iosApp/      (SwiftUI, consumes the Shared framework via SKIE)
```

**There is already a `manager/` package and a `ManagerRepository`.** Manager mode is an
extension of an existing surface, not a greenfield module.

---

## 5. Role gating and house scope

`ProfileRepository` already fetches the signed-in user's `user_roles` rows and derives a
highest role. Extend it to also read `scope_house_id` per row, because scope is what
distinguishes an SM's own-house reach from the elevated tier's cross-house reach.

Two client-side capability flags, mirroring the web helpers in `apps/web/lib/auth.ts` so the
two platforms cannot drift:

| Flag                        | True for                                                                                  | Grants                                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `isScheduleAdmin`           | `rsm`, `hm`, `bm` anywhere (mirrors `user_is_schedule_admin`)                             | Coverage inbox, cross-house switcher over all 13 houses, grid overrides and force-trigger at the viewed house, Hours at any house |
| `canBuildForHouse(houseId)` | the above, plus `sm` where `scope_house_id = houseId` (mirrors `user_can_build_schedule`) | Grid overrides, force-trigger and Hours at that one house                                                                         |

Resulting shapes:

- `sw` only → worker tabs exactly as today. No visible change whatsoever.
- `sm` → worker tabs, plus House-grid overrides, force-trigger and Hours **for their own
  house only**. No Coverage tab: the ladder never pages an SM, so the inbox would be
  permanently empty. (BSpec §5.4a does permit anyone who can build for the house to
  acknowledge, but an SM has no path to reach that request, so exposing the button would be
  theatre. Revisit only if the stakeholder asks for it.)
- `rsm` / `hm` / `bm` → the full manager tab set of §6, including Coverage first.

**Authorization is server-side and stays server-side.** The role check in the client selects
which UI to draw. Every write goes through an RPC or Edge Function that re-checks
authorization itself. Never trust a client-supplied role or house id; that pattern is called
out in `apps/web/AGENTS.md` and applies identically here.

**Write to the viewed house, never the acting manager's own house.** This is the exact bug the
web side had to fix in `writeHouseId` / `canBuildForHouse`. A cross-house manager viewing
Rodin who taps "assign" must write to Rodin.

### 5.1 The app shape is resolved before the first frame

_(Added 2026-07-29, after the first build produced a visible flip on every launch.)_

Capabilities come from `user_roles`, which is a **three-round-trip network read**
(`users`, `houses`, `user_roles`). The first implementation defaulted to a plain worker while
that read was in flight, so every cold launch drew the WORKER shape and then re-shaped
navigation when the roles arrived: for a manager, the bottom bar and the start destination
visibly changed on **every single launch**. The launch splash sometimes covered it, but only by
luck, because the profile read races the week read; on a slow connection the splash dropped
first and the tab bar moved under the user.

These roles change roughly once a year. Re-deriving them from the network before the app is
allowed to draw anything is the wrong trade.

**The mechanism.** `manager/ManagerRoleCache.kt` (pure, unit-tested) plus one thin
platform-storage object per platform (`ManagerModePrefs` on Android over `SharedPreferences`;
`UserDefaults` on iOS).

1. **Read synchronously at launch**, keyed on the signed-in user id, in a `remember` rather than
   a `produceState`. `SharedPreferences` serves from an in-memory map after the first touch, so
   this is a lookup and not I/O. **Nothing asynchronous may go here** — DataStore, a database, or
   the network all put the flip back.
2. **Cache hit** → draw the real shape from frame one, and reconcile from the server in the
   background.
3. **Cache miss** → do NOT guess. Hold the launch splash until the role read completes. This
   happens once per sign-in, not once per launch, and the splash is already on screen so it
   costs the user nothing they can see.
4. **"Completes" includes failing.** The profile read is a `ProfileLoad` (`Loading` /
   `Done(snapshot?)`), not a nullable snapshot, precisely because a bare null cannot distinguish
   "still asking" from "asked and got nothing". Without that distinction a manager on a dead
   connection stares at the wordmark forever.
5. **Write through only on a real change.** The common launch performs no write, and
   `ManagerCapabilities` stays value-identical across the reconcile. That identity is
   load-bearing: `rememberShiftNavigationState` keys both `remember` and `rememberSerializable`
   on `startRoute`, so a new-but-equal value would rebuild every back stack for nothing.
6. **A failed or slow read falls back to the CACHED shape, never to a plain worker.** Stripping a
   manager's Coverage tab because the network is flaky would remove the alert surface exactly
   when things are going wrong. (Safe for the same reason the whole cache is safe: see the
   authorization note below.)
7. **Keyed by user, cleared on sign-out.** A cache entry naming a different user is a miss, not
   an inherited shape, so a shared phone cannot show a worker a Coverage tab.

**It caches the INPUTS, not the answer.** The stored value is the raw `(role, scope)` rows plus
the home house, re-derived through `managerCapabilitiesOf`. Caching `hasCoverage = true` instead
would put a second implementation of the role rules on the device, and it would go stale the next
time the SQL predicates change. There is exactly one definition of what a role can do.

**THIS IS A UI CACHE AND NEVER AN AUTHORIZATION DECISION.** Every manager write still goes
through an RPC or Edge Function that re-checks authorization from the bearer token. The worst
case for a stale or tampered cache is a control that appears and is then refused by the server, a
cosmetic bug. Treating it as authority would be privilege escalation by editing a preferences
file. Never let a cached value stand in for a server check, and never send it to the server.

Every malformed, truncated, wrong-version or blank-role entry decodes to `null`, which means
"hold the splash and ask the server". A corrupt entry must cost one slow launch and never a wrong
one. Bumping the `VERSION` constant is the deliberate way to invalidate every device's cache
after changing what a role grants.

---

## 6. Screens

Manager mode is deliberately small. It is a paging, triage and situational-awareness tool, not
a second admin console. The web app remains the place to build schedules.

**Tab order is the stakeholder's priority order and is not cosmetic.** Coverage is the start
destination for a manager, the way My Shifts is for a worker.

| Rank | Surface              | Bottom bar                     | Notes                                                 |
| ---- | -------------------- | ------------------------------ | ----------------------------------------------------- |
| 1    | **Coverage**         | yes, and the start destination | §6.1. Absent for `sm`.                                |
| 2    | **House**            | yes                            | §6.2. Grid + overrides + force-trigger.               |
| 3    | **Open Shifts**      | yes                            | §6.3. Own house and other houses, as today.           |
| 4    | **Hours**            | yes                            | §6.4. New screen.                                     |
| 5    | My Shifts            | behind More                    | Unchanged. Managers hold desk shifts.                 |
| 5    | Break Shifts         | behind More                    | Unchanged. Managers may claim break shifts.           |
| 5    | Assistant ("Snoopy") | behind More                    | Unchanged. Provided, not expected to be heavily used. |
| 5    | Settings             | behind More                    | Unchanged. Settings are universal.                    |
| —    | **Swaps**            | **omitted**                    | Managers do not swap.                                 |
| —    | **Preferences**      | **omitted**                    | Managers do not submit shift preferences.             |

For an `sm`, Coverage is absent and My Shifts takes the start-destination slot, so their
bottom bar is My Shifts / Open Shifts / House / Hours.

`ShiftDestination.BOTTOM_BAR` is currently a hardcoded four-item list. It becomes
role-derived. Keep the `NavKey` / `@Serializable` contract intact: Nav3 persists back stacks
by serializing these keys.

### 6.1 Coverage — the reason the app exists

A list of `allied_coverage_requests` visible to this manager: **overdue first**, then open by
soonest window, then acknowledged-but-not-closed, with closed requests off the list entirely.

Each row shows the house, the date, the true coverage window (`window_start_at` →
`window_end_at` from the request row, never a reconstructed start + 30m), why it escalated,
which ladder rung currently holds it and who that is, and a live countdown to the next
escalation.

**Empty state:** "All clear. No coverage needed."

**The Respond flow — one job, not two buttons.**

Tapping a request opens the Respond sheet. Opening it **acknowledges the request immediately**,
with no extra tap: the ladder stops, the reminders stop, and every other manager's copy of the
alert reflects that someone has it. The sheet then presents, in order:

1. **Call Allied** as the primary, unmissable action, dialling via a `tel:` intent.
2. Below it: **"Did Allied confirm coverage?"** → **Yes** closes the request as
   `allied_secured` and dismisses. That is the whole happy path: open, call, confirm.
3. Alternatives, less prominent but one tap away: **Covered internally**
   (`covered_internally`), **Desk went unstaffed** (`desk_unstaffed`), **No longer needed**
   (`no_longer_needed`).
4. `desk_unstaffed` requires a written note before the button enables. The server enforces
   this too (`close_allied_coverage_request` raises `note_required`), so the client is a
   convenience, not the guard.
5. **"Not yet"** dismisses the sheet. The request stays acknowledged and open, and remains in
   the list with the persistent banner, because an open request never clears itself.

The words "acknowledge" and "close out" never appear in the UI. The distinction is real and
the record keeps it — you acknowledge at 22:04 and only learn the outcome when the Allied call
connects at 22:11, and `desk_unstaffed` versus overdue-and-never-closed is precisely what the
missed-coverage record exists to capture — but the manager experiences one job: _I've got
this, I'm calling Allied, here's what happened._

Note that `close_allied_coverage_request` already stamps `acknowledged_at` if it was not set,
so a close is safe even if the acknowledge write failed. Rely on that rather than sequencing
two dependent writes.

**Persistent banner and badge.** While any house this manager covers has an **open,
unacknowledged** request, a non-dismissable banner sits on every screen and the Coverage tab
carries a count badge. Once acknowledged it downgrades to a badge only, and the badge persists
until the request is closed. No blocking full-screen takeover: the existing float-ack modal
was deliberately moved off auto-cover for exactly this reason, and a manager who opened the app
to do something else should not be hijacked.

**Force trigger from the request.** `manager/ForceTrigger.kt` already exists. Surface it on the
Respond sheet so a manager can attempt one more internal float before committing to Allied.
Force-trigger is a deliberate manual override and is intentionally not gated by the coverage
floor.

### 6.2 The alert screen

When a coverage alert arrives, tapping the notification opens the Respond sheet of §6.1
directly, over the Coverage tab. On Android this is the full-screen-intent target and it must
render over the lock screen.

Because opening the sheet acknowledges, the app must **force manager mode and re-fetch the
request on open** rather than trusting the notification payload. Delivery is at-least-once by
design, so a stale payload for an already-closed request must resolve to "this is handled"
rather than re-acknowledging it.

**Push actions.** Ship the deep-link path first. An "I've got this" notification action that
acknowledges without unlocking the phone is a good follow-on, but it splits acknowledgement
away from the Call Allied prompt, which is the thing the stakeholder wants kept together. Do
not add a quick-close action: a mis-tap that records `allied_secured` for a desk that actually
went empty corrupts the one record the coverage report exists to surface.

### 6.3 House

Reuse the existing house week grid (`house/` in `commonMain`, already built, already
cross-house capable, already per-worker coloured via `WorkerColors`). Add, gated on
`canBuildForHouse(viewedHouse)`:

- **Assign worker** to a block, via the existing `manager/AssignWorker.kt` and
  `admin_assign_worker`.
- **Remove worker** from a block, via `admin_remove_worker`.
- **Force trigger** a float for a block.

The house switcher spans all 13 houses for `isScheduleAdmin`, and is absent for an `sm`.

Tapping an occupied block keeps its existing behaviour: it opens the occupant's contact card.
The override actions are additive, not a replacement.

### 6.4 Open Shifts

Unchanged from the worker experience: the own-house feed and the other-houses feed, with the
existing week navigator. A manager who holds desk shifts claims from these exactly as a worker
does, subject to the same server-authoritative claimability (`desk_covered` /
`coverage_locked`) and the same weekly cap.

This is ranked third by the stakeholder because it is how a manager sees what is uncovered
_before_ it escalates.

### 6.5 Hours

**New screen.** Per-worker weekly hours for the viewed house, so a manager deciding who to
call at 22:00 can see who is near their cap.

Two levels:

1. **Roster level.** Every active worker at the viewed house for the shown week, with total
   hours held and their effective cap. Sorted by total hours descending, since "who has room"
   is the question being asked. Reuse `WeeklyCapRepository` and the batched
   `effective_weekly_caps` RPC; never re-derive a cap client-side.
2. **Per-worker breakdown**, on tap. For one worker:
   - **Total hours** for the week.
   - **Hours at their home desk.**
   - **Every shift worked outside that desk, listed individually**, each showing its duration,
     its actual time range (from what time to what time), and which house it was at.

The away-shift decomposition mirrors the classification the web report already uses
([`apps/web/lib/data/hours.ts`](../../apps/web/lib/data/hours.ts), which follows
`worker_my_shifts`): `scheduled` and same-house `claimed` are home; `floated_in` /
`pending_float_in` are floated out; `claimed` with `is_cross_house_pickup` is a cross-house
pickup. Each 30-minute block is 0.5h, and contiguous blocks coalesce into one displayed shift
the way every other shift surface in this app already coalesces.

**No new backend is needed for the elevated tier.** The `shift_block_assignments` SELECT
policy (`20260617000006`, USING clause) admits `user_can_build_schedule(auth.uid(), house_id)`,
and since `20260627000002` that predicate is house-agnostic for hm/bm/rsm. So an HM reading a
Harnwell worker's Rodin pickup is already permitted through Postgrest with the manager's own
JWT. Names come from `worker_directory`. Confirm this against the live catalog before building
— `20260726000002_rls_initplan_hoisting.sql` rewrote several policies for planner reasons and
the effective predicate should be read, not assumed.

**An SM's away-shift list is inherently partial**, because `user_can_build_schedule` is
scope-matched for `sm` and their JWT cannot read another house's assignments. Do not paper over
this with a service-role call. Show what they can see and label the away section honestly, e.g.
"Shifts at your house only." Widening an SM's read is a separate stakeholder decision with a
security review attached.

### 6.6 Not in v1

Schedule building, preferences authoring, people admin, house transfers, hours-cap
modification, leave management, the launch gate, the knowledge base, and the coverage /
missed-coverage report. All stay on web.

The coverage report is worth calling out because it is the natural sibling of §6.1 and was
explicitly deferred: reviewing missed-coverage incidents is a calm, retrospective, spreadsheet
-shaped task, and it is the wrong thing to build before the paging path is proven. Resist
scope growth. The app's value is entirely in §6.1 and §6.2 being reliable.

---

## 7. Data contracts

**This app introduces no new tables and no new RPCs.** If you find yourself writing a
migration, stop and re-read §3 and §6.5.

Read, all already RLS-scoped to what the manager may see:

- `allied_coverage_requests` — scoped to `user_can_build_schedule(house_id)` plus a
  `user_is_admin()` clause.
- `notifications` — own rows.
- The house grid views, `worker_directory`, `worker_open_shifts`, `shift_block_assignments`.
- `effective_weekly_caps` for the Hours cap column.

Write, via the same SECURITY DEFINER RPCs the web server actions call:

- `acknowledge_allied_coverage_request(request_id, user_id, now)`
- `close_allied_coverage_request(request_id, user_id, outcome, note, now)`
- `admin_assign_worker` / `admin_remove_worker`
- `force_trigger_float`

Note that these RPCs are `REVOKE`d from `authenticated` and granted to `service_role` only, so
mobile reaches them through an Edge Function the way it reaches every other write, not by
calling Postgrest RPC directly. Check how `ManagerRepository` already routes force-trigger and
follow it.

Live updates: subscribe to `allied_coverage_requests` via Realtime and refetch on any change.
Follow the existing worker pattern in `data/` and carry **no server-side user filter** on the
subscription; RLS already scopes the rows, and the version-variable `postgresChangeFlow` filter
DSL is a known trap (phase-13a note in the root `AGENTS.md`).

Push token registration reuses `register-push-token` unchanged. A manager registers on sign-in
exactly as a worker does. This is the single most important thing to confirm early: the
original problem was that managers had no `push_tokens` row at all, so `dispatch-push`
contacted zero devices and still stamped `delivered_at`.

**Do not queue acknowledgements offline.** The app has a `PendingWriteStore`, and it is the
wrong tool here: a queued acknowledgement that never reaches the server would silence the
manager's own UI while the ladder keeps escalating and the desk keeps heading for empty. Fail
loudly, keep alerting, and let the ladder do its job.

---

## 8. Alert delivery requirements

This is the acceptance bar. An implementation that renders every screen beautifully and fails
any of these has not delivered the feature.

1. A coverage request opened while the manager's phone is **locked and the app is killed**
   produces a visible, audible alert within one delivery cycle.
2. The alert reaches the manager through an active **Focus / Do Not Disturb** mode on iOS via
   the `time-sensitive` interruption level. It is dismissable and respects the ringer switch;
   that is the accepted trade for shipping without an Apple entitlement.
3. On Android the alert uses the **full-screen-intent, high-importance channel** with its own
   sound and appears over the lock screen.
4. Acknowledging on **any** surface — this app, or web — silences the alert everywhere.
   Delivery is at-least-once by design, so the client must be idempotent and must re-check
   state on open rather than trusting the payload.
5. A failed send is **dead-lettered and logged**, never silently swallowed. The existing
   `begin_notification_delivery_attempt` / `record_notification_delivery_failure` backoff in
   `dispatch-push` already does this; keep it.
6. Escalation to the next rung produces a **new** alert to the new recipient, and does not
   silence the prior one until acknowledged.
7. A manager signing in for the first time has a `push_tokens` row before they can be paged,
   and the app surfaces the notification-permission primer rather than silently having no
   permission. Reuse the existing primer; it never touches the OS on "Not now".

---

## 9. Build order

1. **Verify delivery end to end** (§3) and fix the `hmod_urgent` client category (§3.1). Verify
   on a real iOS device, not the simulator: the simulator does not exercise APNs. Do not draw a
   screen until a locked device makes a sound.
2. `ProfileRepository` scope reading + the `isScheduleAdmin` / `canBuildForHouse` flags (§5),
   and the role-derived `ShiftDestination.BOTTOM_BAR`, behind a flag.
3. Shared `manager/coverage/` model and `CoverageViewModel` (pure, snapshot + injected `now`),
   with kotlin.test coverage on the JVM host. **This is the tested surface.** Cover at minimum:
   overdue-first ordering, the acknowledged-but-open state, an already-closed request arriving
   from a stale payload, the `desk_unstaffed` note requirement, and banner/badge derivation.
4. `ManagerRepository` extensions: fetch, acknowledge, close, Realtime subscription.
5. Android Compose UI, then iOS SwiftUI. Validate shared changes with
   `:shared:compileKotlinIosSimulatorArm64` (fast) before assuming KMP-clean; bare `@Volatile`
   in `commonMain` must be `kotlin.concurrent.Volatile` or iOS silently breaks.
6. House-grid overrides (§6.3), then Hours (§6.5). These are independent of the coverage path
   and must not delay it.
7. UI tests via the `ui-testing` skill: Robolectric for Android, XCUITest for iOS, asserting
   only through the `testTag` / `accessibilityIdentifier` contract. Manager mode is a new
   screen set and a new multi-step flow, so this is mandatory, not optional. Watch for the
   SwiftUI `accessibilityIdentifier` container-shadowing trap that bit the onboarding tours.
8. Spec sync: BSpec (new surface, §13 permissions, §14 config keys if any) and
   ARCHITECTURE.md (mechanism), **in the same commit**. A feature is not done until both
   describe it.

---

## 10. Testing and verification gates

- Shared logic: kotlin.test on the JVM host (`:shared:testAndroidHostTest`).
- iOS compile gate: `:shared:linkDebugFrameworkIosSimulatorArm64`.
- Per the root `AGENTS.md`, emulator/simulator verification is **iOS only**; the user drives
  Android builds themselves. Do not launch an Android emulator without being asked.
- End to end: open a real coverage request against the local stack via an orchestrator tick,
  and observe the alert arrive on a locked device.
- `/security-audit` if any RLS policy or SECURITY DEFINER function is touched. It should not
  be, since this app adds none. If §6.5 turns out to need a widened read, that audit becomes
  mandatory.
- Prove each new test detects its bug: revert the behaviour and watch it go red before
  trusting green.

---

## 11. Open questions for the implementing session

Resolved since the first draft: app shape, alert intensity, cross-house scope, SM inclusion,
the ack/close flow, in-app urgency, and navigation. Those are in §2 and are not open.

Still open:

1. **Should the HMOD rung alert differently**, given it is terminal and campus-wide? A rung
   with nobody above it keeps reminding forever, and the HMOD may be receiving a request for a
   house they have never worked at. Recommendation: same intensity, but label the request
   "terminal rung, no further escalation" so the recipient understands nobody is coming.
2. **What should the UI say when the ladder has walked a leave-delegation chain?**
   `resolve_hm_for_house` already follows `hm_leave`, so routing is correct, but a manager
   receiving a request for a house whose HM is on leave should be told that is why, rather than
   wondering if they were paged by mistake.
3. **Does a manager want the Coverage list filtered to their own house by default**, with other
   houses collapsed behind a toggle? Cross-house write was decided, but an HM whose inbox is
   dominated by twelve other houses' requests may want their own surfaced first. Cheap to add
   later; do not guess now, watch what the Harnwell pilot managers do.
4. **Should Hours be week-navigable** like My Shifts and the house grid, or fixed to the
   current week? Fixed is cheaper and matches the 22:00 use case. Recommendation: current week
   only in v1.

---

## 12. What the 2026-07-29 revision superseded

Recorded so a future reader does not resurrect a decision that was deliberately reversed.

1. **"Do not collapse ack and close into one button"** → reversed. §6.1 now specifies one
   Respond flow that acknowledges on open and closes in the same sitting. The two-state record
   is preserved; only the UI is merged.
2. **iOS critical alerts as a day-one prerequisite** → dropped. `time-sensitive` is the shipped
   target and the entitlement is an optional later upgrade. The push presentation layer already
   implements this.
3. **`dispatch-push` as a hard blocking prerequisite** → already landed. §3 replaces it with a
   verification step.
4. **"SM is not manager mode"** → reversed. SM is included, own-house only, without the
   coverage inbox.
5. **House tab read-only, force-trigger only from an alert, hours out of scope** → widened.
   Grid overrides, Open Shifts and a new Hours screen are all in v1, per the stakeholder's
   explicit ranking in §6.
6. **Undecided cross-house question** → decided as full cross-house write, matching web.
