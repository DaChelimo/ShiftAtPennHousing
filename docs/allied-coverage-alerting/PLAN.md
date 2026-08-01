# Allied Coverage Alerting — Manager Escalation Ladder

Status: PLAN (not built). Authored 2026-07-29.
Owner decisions captured in this document are stakeholder-confirmed unless marked OPEN.

Working document. When this lands, promote the settled behavior into
BEHAVIORAL_SPECIFICATION.md (§5.4, §10.1, §13, §14) and ARCHITECTURE.md (§4.2, §4.6),
per the root AGENTS.md spec-sync rule, in the same commit.

---

## 1. Why this exists

When the escalation chain exhausts every internal option, the desk is going to be empty
unless a human procures Allied. That moment is the single highest-consequence event the
system produces, and today it terminates in a database row and nothing else.

### What was verified in the current code (2026-07-29)

Traced end to end against source. The local stack was down (Docker paused), so this is a
static trace; a live tick repro is listed as a gate in §8.

| #   | Finding                                                                                                                                                                                                                                                                                                                                   | Evidence                                                                                                                                                                                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The alert is inserted and the Action Inbox renders it correctly, with a working Resolved checkbox and a live `postgres_changes` subscription. This part is not missing.                                                                                                                                                                   | [process_hmod_notify_allied_step](../../supabase/migrations/20260713000001_offhours_allied_ladder.sql#L504), [inbox/page.tsx](<../../apps/web/app/(app)/inbox/page.tsx>), [ActionInbox.tsx:16](../../apps/web/components/inbox/ActionInbox.tsx#L16)                                                     |
| 2   | **No manager is ever pushed.** `hmod_urgent` is pushable, but `dispatch-push` only targets `push_tokens`, which only the worker mobile app writes. A web-only RSM/HM has none, so zero devices are attempted and `deliver_notification` still stamps `delivered_at`. The system records the alert as delivered having contacted no human. | [notification_is_pushable](../../supabase/migrations/20260601000001_phase_12_notifications.sql#L46), [dispatch-push:138](../../supabase/functions/dispatch-push/index.ts#L138)                                                                                                                          |
| 3   | Even with the mobile app installed, **iOS displays nothing**: `dispatch-push` sends a data-only FCM message with no `notification` block, no `apns` config, no `content-available`. Android rebuilds it locally; the iOS `AppDelegate` only implements `willPresent`, which never fires. Affects workers too.                             | [dispatch-push:183](../../supabase/functions/dispatch-push/index.ts#L183), [AppFirebaseMessagingService.kt:42](../../apps/mobile/androidApp/src/main/java/com/pennhousing/shift/push/AppFirebaseMessagingService.kt#L42), [AppDelegate.swift:78](../../apps/mobile/iosApp/iosApp/AppDelegate.swift#L78) |
| 4   | **It fires once, to one person, and gives up.** `block_step_status` `ON CONFLICT DO NOTHING` retires the step. No reminder, no re-page, no second recipient.                                                                                                                                                                              | [20260528000007:45](../../supabase/migrations/20260528000007_phase_07_hmod_notify_rpc.sql#L45)                                                                                                                                                                                                          |
| 5   | **An unactioned alert deletes itself.** `alliedLifecycle` archives at coverage-window end "resolved or NOT", then discards after 24h. A desk that went unstaffed leaves a clean-looking inbox the next morning, and no report anywhere records it.                                                                                        | [inbox/index.ts:67](../../packages/core/src/inbox/index.ts#L67)                                                                                                                                                                                                                                         |
| 6   | **The bell is stale and undifferentiated.** `getUnreadCount` is computed once per server render with no realtime subscription; only `/inbox` itself updates live. A swap request and an unstaffed desk produce the same grey badge.                                                                                                       | [hmod.ts:30](../../apps/web/lib/data/hmod.ts#L30), [AppShell.tsx:309](../../apps/web/components/AppShell.tsx#L309)                                                                                                                                                                                      |
| 7   | The one mechanism with timeouts is **off by default and skips managers**: the off-hours ladder pages dropper → SM → desk, and `is_offhours_ladder_enabled()` defaults `false`.                                                                                                                                                            | [20260713000001:44](../../supabase/migrations/20260713000001_offhours_allied_ladder.sql#L44)                                                                                                                                                                                                            |

Findings 4, 5 and 6 are fixed by this plan. Finding 2 is structurally fixed by Phase 2
(manager mobile mode). Finding 3 is a prerequisite for Phase 2 and is tracked in §7.

### Reusable precedent

The Desk Assistant paging subsystem already models critical alerts: undismissable
presentation, iOS `critical` / `time-sensitive` interruption levels, an Android
full-screen-intent channel, degraded-mode fallbacks, and reminder cadence
([`_shared/desk-assistant-pages.ts:148`](../../supabase/functions/_shared/desk-assistant-pages.ts#L148)).
Phase 2 must reuse this model rather than introduce a second one.

---

## 2. Scope

**Phase 1 (this plan, web).** Turn the one-shot `hmod_urgent` notification into an
acknowledged, escalating, close-out-required coverage request, and make it impossible to
miss inside the web app.

**Phase 2 (spec'd here, built after).** A role-gated manager mode in the existing mobile
app, carrying the same request objects with real critical-alert push.

Explicitly **not** in Phase 1, per stakeholder decision: SMS, voice, email, and browser
web push. Phase 1 is in-app only. This is a deliberate, time-boxed acceptance of the
reachability gap, not a claim that the gap is closed. See §9.

---

## 3. The escalation ladder (stakeholder-confirmed)

Exactly three rungs, all house-scoped except the last. Never fanned out to any other
manager, and never to other RSMs.

```
rung 1  RSM               resolve_rsm_for_house(house, now)
rung 2  Housing Manager   resolve_hm_for_house(house, now)     -- walks hm_leave delegation
rung 3  HMOD on duty      resolve_hmod_on_duty(now)            -- campus rotor
```

All three resolvers already exist and are already used by the current Allied path, so
the ladder is a sequencing layer over known-good routing, not new routing.

**Rung timeout: 60 minutes** (stakeholder-set), configurable as
`allied_ladder_rung_timeout_minutes`.

> **Flagged concern, proceeding as directed.** Escalation reaches this step at roughly
> T-2h before the block. A 60-minute rung means the RSM holds it until T-1h, the HM until
> T-0, and the HMOD is first contacted only as the desk goes empty. In practice the ladder
> would rarely reach rung 3 in time to act. My recommendation is **20 minutes** (RSM to
> T-100m, HM to T-80m, HMOD with over an hour to procure Allied), or a timeout that
> compresses as `block_start_at` approaches. Because the value is a `system_config` key,
> this is a one-row change after launch and does not need to block the build. Both specs
> should record 60 as the shipped default and note the compression option as unbuilt.

**Rung skipping.** If a rung's resolver returns NULL (no RSM for the house, entire HM
leave chain on leave), advance immediately to the next rung rather than burning the
timeout on an unreachable seat. If all three return NULL, fall back to
`system_config('project_administrator_user_id')` exactly as the current code does, and
`RAISE WARNING` if that is unset.

**Rung 3 is terminal.** The HMOD is not timed out to anyone. The request stays open,
unacknowledged and overdue, and surfaces in the missed-coverage report (§5.4). Nothing
auto-closes it.

**Reminders within a rung.** The current holder is re-notified every
`allied_ladder_reminder_minutes` (default 15) until they acknowledge or the rung times
out. Acknowledgment stops reminders and stops the ladder; it does **not** close the
request.

**Acknowledge vs. close.** Two distinct states, deliberately.

- _Acknowledged_ means "I have seen this and I am handling it." Stops escalation.
- _Closed_ means "here is what actually happened." Requires an outcome (§5.3).

A request acknowledged but never closed is exactly the case finding 5 loses today, so it
must remain visible.

### Relationship to the existing off-hours pilot ladder — OPEN

The dropper → SM → desk ladder ([20260713000001](../../supabase/migrations/20260713000001_offhours_allied_ladder.sql))
targets different people for a different action (a desk worker phoning Allied directly).
Two options:

- **(A, recommended)** The manager ladder is the always-on spine. The pilot ladder, when
  `offhours_ladder_enabled`, runs in parallel as a fast path, since it can secure coverage
  in minutes without waking a manager. An acknowledgment on either resolves both.
- **(B)** The pilot ladder pre-empts the manager ladder off-hours, and the manager ladder
  starts only if the pilot exhausts its three rungs.

A needs an explicit cross-resolution link; B risks 30 silent minutes before a manager
learns anything. Needs a decision before implementation.

---

## 4. Data model

New migration `supabase/migrations/2026XXXXXXXXXX_allied_coverage_ladder.sql`.

```sql
CREATE TYPE allied_coverage_outcome AS ENUM (
  'allied_secured',      -- Allied was booked for the window
  'covered_internally',  -- a worker picked it up / was assigned
  'desk_unstaffed',      -- nobody covered it; the desk was empty
  'no_longer_needed'     -- the block was voided or the vacancy resolved itself
);

CREATE TABLE allied_coverage_requests (
  request_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id          uuid NOT NULL REFERENCES shift_blocks (block_id) ON DELETE CASCADE,
  house_id          text NOT NULL REFERENCES houses (id),
  window_start_at   timestamptz NOT NULL,   -- the capped gap (<= MAX_ALLIED_COVERAGE_BLOCKS)
  window_end_at     timestamptz NOT NULL,
  reason            text NOT NULL,
  current_rung      text NOT NULL CHECK (current_rung IN ('rsm','hm','hmod','admin')),
  rung_fired_at     timestamptz NOT NULL,
  last_reminder_at  timestamptz,
  current_recipient uuid REFERENCES users (user_id),
  acknowledged_at   timestamptz,
  acknowledged_by   uuid REFERENCES users (user_id),
  closed_at         timestamptz,
  closed_by         uuid REFERENCES users (user_id),
  outcome           allied_coverage_outcome,
  close_note        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT closed_has_outcome CHECK ((closed_at IS NULL) = (outcome IS NULL))
);

-- One live request per block. A closed request does not block a genuine re-escalation.
CREATE UNIQUE INDEX allied_coverage_requests_one_open_per_block
  ON allied_coverage_requests (block_id) WHERE closed_at IS NULL;

CREATE INDEX allied_coverage_requests_ladder_scan
  ON allied_coverage_requests (rung_fired_at)
  WHERE acknowledged_at IS NULL AND closed_at IS NULL;

CREATE INDEX allied_coverage_requests_open
  ON allied_coverage_requests (house_id, window_start_at) WHERE closed_at IS NULL;
```

**RLS.** Enabled. One SELECT policy for `user_can_build_schedule(house_id)` (sm/hm/bm/rsm,
matching who may already see the Action Inbox) plus an unconditional `user_is_admin()`
clause. No client INSERT/UPDATE policy: every write goes through a SECURITY DEFINER RPC.
Per `supabase/AGENTS.md`, each new function needs
`REVOKE EXECUTE ... FROM anon, authenticated;` naming the roles explicitly, not just
`FROM PUBLIC`.

**Notifications.** No new `notification_type` value. Each rung inserts a fresh
`hmod_urgent` row for the new recipient, and the payload gains `request_id`, `rung`, and
`rung_deadline_at` alongside today's `target` / `reason` / `block_id` / `house_id` /
`block_start_at` / `block_end_at`. Existing consumers keep working unchanged.

---

## 5. Behavior

### 5.1 Opening a request

`process_hmod_notify_allied_step` and `process_no_ack_float` stop inserting a bare
`hmod_urgent` and instead call `open_allied_coverage_request(...)`, which inserts the row
at rung `rsm`, resolves the recipient, and emits the first notification in the same
transaction. The existing `block_step_status` claim semantics are untouched, so a block
still cannot open two requests. The window comes from the already-capped contiguous gap
(`MAX_ALLIED_COVERAGE_BLOCKS = 8`), so a request is always at most 4 hours.

### 5.2 Advancing

`advance_allied_coverage_ladder(p_now timestamptz, p_limit integer)` scans open,
unacknowledged requests and, per row:

- past `rung_fired_at + timeout` → advance to the next rung, resolve, notify, stamp;
- otherwise past `last_reminder_at + reminder interval` → re-notify the same recipient;
- rung `hmod` past its timeout → stay put, mark overdue, notify no one new.

Called from `orchestrator-tick`, which already runs each minute and already calls
`advance_offhours_allied_ladder` ([orchestrator-tick:754](../../supabase/functions/orchestrator-tick/index.ts#L754)).
No new cron.

### 5.3 Acknowledging and closing

- `acknowledge_allied_coverage_request(request_id, user_id, now)` — permitted for the
  current recipient, any prior rung holder, or an admin. Stops escalation and reminders.
- `close_allied_coverage_request(request_id, user_id, outcome, note, now)` — permitted for
  `user_can_build_schedule(house)`. Requires an outcome. Idempotent on an already-closed
  request.

Both follow the existing web pattern: a server action calls the RPC through the service
client passing the signed-in `user_id`, and the RPC re-checks authorization itself
([actions/inbox.ts](../../apps/web/lib/actions/inbox.ts)).

`no_longer_needed` may also be set **by the system**, and only in that one case: when the
block is voided by a config change or the desk regains a present worker. Nothing else
auto-closes a request. This is a status write, not coverage revocation, so hard invariant
#3 (no-takeback) is untouched.

### 5.4 Lifecycle — the archive rule changes

`alliedLifecycle` in `packages/core/src/inbox/` is amended: **an open request never
archives.** Once `window_end_at` passes it becomes `overdue` and stays in the Coverage tab
with an unmistakable treatment until a human closes it. Archive is reachable only through
close-out, and `discarded` is removed for coverage requests.

New pure state, computed by `@shift/core` from the request row plus `now`:

```
awaiting_ack -> acknowledged -> closed        (the healthy path)
awaiting_ack -> overdue                       (window passed, nobody acknowledged)
acknowledged -> overdue                       (acknowledged, window passed, never closed)
```

Every request closed `desk_unstaffed`, and every request that reaches `overdue`, is a
**missed-coverage incident** and appears in the report in §6.4.

---

## 6. Web surfaces

### 6.1 App-wide alert, not just a page

A new `<CoverageAlertBanner />` mounted in `AppShell` for anyone with
`canBuildSchedule`. When an open, unacknowledged request exists, it renders a persistent
red bar directly under the header on **every** page, with house, date, window, the rung
deadline counting down, and two buttons: "I am handling this" and "Open inbox". It is not
dismissable while the request is open. The bell alone is not enough; it is a small grey
number on a page nobody is looking at.

Also: an audible chime on arrival (one short tone, user-mutable via a header toggle
persisted in `localStorage`), and a `document.title` prefix of `(1) ` while any request is
unacknowledged so the alert is visible in a background browser tab.

### 6.2 Realtime and the bell

Lift the `notifications` realtime subscription out of `ActionInbox` into a small shell-level
provider subscribed to both `notifications` and `allied_coverage_requests`, calling
`router.refresh()`. This fixes finding 6 for every page, not just `/inbox`.

Split the bell count into `urgentCount` (open coverage requests) and `unreadCount`
(everything else), rendered as a red badge and a grey badge respectively. An unstaffed desk
must never look like a swap request.

### 6.3 Action Inbox changes

- Coverage tab groups: **Overdue** (open, window passed), **Needs acknowledgment**,
  **Acknowledged, awaiting close-out**, in that order.
- The Resolved checkbox is replaced by two explicit controls: "I am handling this"
  (acknowledge) and "Close out" (opens the outcome modal). The current checkbox conflates
  the two and writes no outcome.
- Each card shows the ladder state plainly: which rung is holding it, who that is, and how
  long until it escalates. A manager should never have to guess whether someone else has it.
- The outcome modal is four radio options plus an optional note, and the note is
  **required** when the outcome is `desk_unstaffed`.

Copy must contain no em dash or en dash (root AGENTS.md).

### 6.4 Missed-coverage report

New page `/admin/coverage`, gated to `user_can_build_schedule`, listing every request over
a selectable date range with house, window, reason, ladder path taken, time to
acknowledgment, outcome and note. Filter for incidents only. This is the artifact that
today's silent archive destroys, and it is what makes the whole system auditable at the end
of a semester.

---

## 7. Phase 2 — manager mode in the existing app

Confirmed shape: **the same KMP app, role-gated**, not a second app. One codebase, one
login, one Firebase project, one push pipeline. A manager signing in gets a manager tab set
(Coverage, House, People) instead of the worker tab set; a user who is both keeps a
switcher, mirroring the existing web worker/admin switch.

**Prerequisite, and it is a real one.** Finding 3 must be fixed first: `dispatch-push` must
send platform-aware payloads, not data-only. Concretely, an `apns` block carrying
`interruption-level` and a sound, and an `android` block carrying priority and the
full-screen-intent channel, reusing `resolvePageAlertPresentation`. Until that lands, a
manager app would install cleanly and still never make a sound, which is a worse failure
than the web-only state because it looks solved.

Then: register manager push tokens on sign-in (the existing `register-push-token` function
needs no change), route coverage requests as critical alerts, and require an in-app
acknowledgment that calls the same RPC as the web. iOS critical alerts need an Apple
entitlement request; that has a lead time and should be started early.

---

## 8. Build order and gates

1. Migration: table, enum, RLS, four RPCs, explicit `REVOKE ... FROM anon, authenticated`.
   pgTAP covering each rung transition, rung skipping on a NULL resolver, terminal rung
   behavior, the one-open-per-block index, close-out authorization, and the RLS read scope.
2. `packages/core`: the pure lifecycle state machine, replacing the archive-on-window-end
   rule. Vitest, including a test that fails against the current `alliedLifecycle` body.
3. `orchestrator-tick`: call `advance_allied_coverage_ladder`.
4. Web: shell provider, banner, split bell, inbox rework, close-out modal, `/admin/coverage`.
   Playwright for the acknowledge and close-out journeys.
5. Regenerate `database.types.ts`, rebuild `@shift/shared`.
6. Spec sync: BSpec §5.4 / §10.1 / §13 / §14 and ARCH §4.2 / §4.6, in the same commit.
   Grep both specs for the superseded "resolved or not, archives at window end" statement
   and correct it in place.

**Gates before this is called done.**

- A live orchestrator tick against a seeded vacancy produces a request, and the RSM sees
  the banner without reloading. This is the repro I could not run today.
- Simulated no-acknowledgment advances rsm → hm → hmod at the configured timeout.
- An unacknowledged request whose window has passed is still on screen the next morning.
- `pnpm test:quick`, the pgTAP suite, and the Playwright inbox specs pass.
- `/security-audit`, since this adds a table, four SECURITY DEFINER functions and an RLS
  policy.

---

## 9. What this plan does not fix

Stated plainly so it is not mistaken for solved.

**A manager who is not looking at a browser will not learn that a desk is about to go
unstaffed.** Phase 1 makes the alert impossible to miss _inside_ the app, adds escalation
so it reaches a second and third person, and makes a missed desk permanently visible after
the fact. It does not make anyone's phone ring. The 2am case is only genuinely closed by
Phase 2's critical-alert push, or by an SMS/voice rung, which is currently out of scope by
decision.

If the pilot runs before Phase 2 ships, the operational mitigation is a human one: the
Coverage tab must be someone's explicit responsibility during the hours the RSM is not at a
desk, and the `/admin/coverage` report should be reviewed daily.
