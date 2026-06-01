# Phase 12 — Test Plan: Notification System

This plan enumerates every test for phase-12, the spec section each test covers,
the function/RPC/table contracts the tests pin (TDD-first), and the ambiguities
surfaced and resolved before implementation.

Phase-12 is **the notification system** — the machinery that turns the rows other
phases write into something a worker actually receives. It has four behavioral
surfaces:

1. **The acknowledgment cadence** (BEHAVIORAL_SPECIFICATION.md §7.1). When a float
   is assigned, escalating reminders are scheduled at **6h, 2h, 1h, 30m, 5m before
   the acknowledgment deadline** (which is **T-10m before the float start**). The
   6h and 2h reminders are per-house configurable (and may be disabled); the
   1h/30m/5m reminders are mandatory. The effective cadence is **snapshotted at
   float-assign time** so a later `ack_cadence_config` change never reaches an
   in-flight float (ARCH §2.8). A float assigned with less than a given offset's
   lead time **skips the already-past offsets** and starts from the next one.
2. **`push_tokens`** — the per-device registry (one row per device per user;
   `platform` ∈ {android, ios}; `UNIQUE (user_id, device_token)`).
3. **In-app + push delivery** — a scheduler delivers notifications whose
   `delivered_at IS NULL` and whose `scheduled_for <= now` (a NULL schedule is
   immediate); delivery stamps `delivered_at` and fans a Realtime push to the
   recipient; `acknowledged_at` is stamped when the user opens the updates tab. An
   ack reminder for a float that is **no longer pending** (acknowledged / declined)
   is **silently suppressed**. `dispatch_push` resolves the user's device tokens —
   the two in-app-only permanent-removal alert types are not pushed (ARCH §3.7).
4. **The HM-leave mailto deeplink** (§2.6 rule 3) — the system crafts a pre-filled
   message to the affected house's student workers naming the replacement and
   their role label, and returns a `mailto:` URL. It opens the user's mail app; it
   **does not send mail**.

**The defining invariant of this phase: the cadence a float carries is frozen at
assignment time.** The notification scheduler delivers reminders from the
snapshotted `scheduled_for` values on the rows, never by re-querying
`ack_cadence_config` at delivery time (ARCH §2.8). The 6h/2h offsets live in
`ack_cadence_config` (per-house, disable-able); the 1h/30m/5m offsets are
hardcoded mandatory. The ack deadline is **T-10m before float start**, and **all**
reminder offsets are measured backward from that deadline (§7.1).

The phase spans two behavioral surfaces:

| Surface                                                                                          | Lives in                                               | Tested with |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | ----------- |
| Cadence-offset math, the snapshot, skip-past-offsets, the suppress predicate                     | `packages/core/src/notifications` (PURE) — **TDD-red** | Vitest      |
| `push_tokens` schema, the delivery queue + suppression, dispatch resolution, the mailto deeplink | phase-12 migration table + RPCs — **TDD-red**          | pgTAP       |

**Architecture split (the phase-07 audit's C6a anti-drift rule, carried from
phase-08/09/10/11).** Pure decision surfaces in TypeScript (what the offsets are,
which survive the lead-time filter, whether a reminder should be suppressed);
atomic execution and state in SQL (the device registry, the due-query, the
mark-delivered / mark-read writes, the mailto string assembled from DB-resident
people); no duplicated logic across the two. The SQL snapshot WRITER already
exists (`process_float_lookup_assignment` / batch_f3, covered GREEN by
`phase-07-f-behavioral.sql`); this phase tests the PURE math that mirrors it and
the DELIVERY surface that consumes its rows.

Sources of truth:

- `BEHAVIORAL_SPECIFICATION.md`
  §7.1 (the acknowledgment cadence — ack deadline = T-10m before float start; "All
  reminder offsets are measured from this T-10m deadline"; reminders at "6 hours, 2
  hours, 1 hour, 30 minutes, and 5 minutes before the deadline"; the 6h/2h are
  per-house configurable and disable-able, the 1h/30m/5m are mandatory; "Changes to
  these offsets take effect for float assignments created after the change; existing
  float assignments retain the cadence that was in effect when they were assigned";
  "If the float was assigned with less than 6 hours of lead time before the
  deadline, the cadence starts at whichever interval is next reached. For a float
  assigned exactly at T-2h, only the 1h, 30m, and 5m reminders fire"), §7.2 / §7.3
  (a declined / voided / no-acked float is no longer pending — its reminders must
  not be delivered), §2.6 rule 3 (HM-leave: crafts an email to the house's student
  workers naming the replacement + their role label, opens the mail app via a
  mailto link — the user sends it)
- `ARCHITECTURE.md`
  §2.8 (`ack_cadence_config` — the 6h/2h offsets are per-house; null = system
  default of −6h / −2h before the deadline; "disabled" = suppressed; the 1h/30m/5m
  are mandatory and NOT stored here; the **snapshot-at-assignment-time** semantics),
  §3.7 (`notifications` — `delivered_at` null = pending; `scheduled_for` = the
  future-cadence delivery instant; `acknowledged_at` populated when the user opens
  the updates tab; `sm_permanent_drop_alert` / `sw_permanent_removal_alert` are
  in-app only — no push)
- `AGENTS.md` — hard invariant #6 (timestamptz in America/New_York). The ack
  offsets are measured-before-deadline **durations**, so a DST boundary inside the
  interval is carried by the instant itself — no calendar-day anchoring is needed
  here (that rule applies to date-anchored break offsets, phase-11, not to
  "N minutes before a fixed deadline").

Test files:

- `packages/core/tests/phase-12/ack-cadence.test.ts` — Vitest: the cadence
  constants + ack-deadline derivation, `snapshotAckCadence` (resolve the per-house
  config to the frozen offset set, including disable + custom offsets), the
  long-lead schedule, the skip-past-offsets rule (incl. the strictly-future
  boundary and the T-2h worked example), the snapshot semantics (a later config
  change is a no-op for an in-flight float), and the already-acknowledged
  suppression predicate. Imports `../../src/notifications/index.js`, which does not
  exist yet → **TDD-red**. **28 cases.**
- `supabase/tests/phase-12-notifications.sql` — pgTAP: the `push_tokens`
  table/columns/types/PK/FK/RLS + the platform CHECK and the
  `(user_id, device_token)` UNIQUE constraint; `notification_is_pushable` per type;
  `notification_push_targets` dispatch resolution (0 devices → in-app only; 2
  devices → both); `pending_notification_deliveries` (the due-query, the inclusive
  `<= now` boundary, the NULL-schedule-is-immediate rule, the exclusion of
  future/delivered rows, and the ack-reminder suppression for acknowledged /
  declined floats); `deliver_notification` (stamp once, idempotent, leaves the
  queue); `mark_notification_read` (stamp `acknowledged_at`, non-recipient no-op);
  and `craft_hm_leave_mailto` (a `mailto:` URL to the house's SWs naming the
  replacement + role label). References functions/tables the phase-12 migration has
  not yet added → **TDD-red**. **55 assertions.**

This plan does **not** add a `fixtures.ts` — the pure surface is small enough that
the one Vitest file holds its own builders inline (the phase-11 precedent), while
it still imports the contract types from `../../src/notifications/types.js` so any
drift surfaces as a TypeScript error (the phase-06/…/11 discipline).

---

## The Function / Table Contracts (TDD-first)

The implementation goes in `packages/core/src/notifications/` and the phase-12
migration. Until they land, the test files that import/call them fail at the first
import line / first function call — the intended TDD-red state, identical to
phase-06/07/08/09/10/11.

### Pure decision surfaces

```ts
// packages/core/src/notifications/types.ts
export interface AckCadenceConfig {
  // The per-house ack_cadence_config row (ARCH §2.8), as the snapshot consumes it.
  reminder6hEnabled: boolean; // false = disabled (suppressed)
  reminder6hOffsetMinutes: number | null; // null = system default (360 = 6h)
  reminder2hEnabled: boolean;
  reminder2hOffsetMinutes: number | null; // null = system default (120 = 2h)
}
export interface AckReminderOffset {
  minutesBeforeDeadline: number;
  mandatory: boolean; // true for 1h/30m/5m, false for 6h/2h
  label: string; // '6h' | '2h' | '1h' | '30m' | '5m'
}
export interface AckCadenceSnapshot {
  offsets: AckReminderOffset[]; // frozen at assignment time; largest-first
}
export interface AckReminderScheduleInput {
  ackDeadline: Date; // = floatStart − 10m
  assignedAt: Date; // `now` at float-assign time
  snapshot: AckCadenceSnapshot;
}
export interface AckReminderSlot {
  scheduledFor: Date;
  minutesBeforeDeadline: number;
  mandatory: boolean;
  label: string;
}
export interface FloatAckState {
  status: 'pending' | 'acknowledged' | 'declined' | 'voided' | 'completed';
  acknowledgedAt: Date | null;
  declinedAt: Date | null;
}

// packages/core/src/notifications/index.ts
export const ACK_DEADLINE_LEAD_MINUTES = 10; // T-10m before float start
export const MANDATORY_ACK_OFFSETS_MINUTES = [60, 30, 5]; // 1h / 30m / 5m
export const DEFAULT_CONFIGURABLE_ACK_OFFSETS_MINUTES = {
  sixHourMinutes: 360,
  twoHourMinutes: 120,
};
export const DEFAULT_ACK_CADENCE_CONFIG: AckCadenceConfig; // both enabled, offsets null

export function ackDeadlineFromFloatStart(floatStart: Date): Date;
//   floatStart − ACK_DEADLINE_LEAD_MINUTES.

export function snapshotAckCadence(config: AckCadenceConfig): AckCadenceSnapshot;
//   Always includes the mandatory 60/30/5. Includes 6h iff reminder6hEnabled
//   (at reminder6hOffsetMinutes ?? 360), 2h iff reminder2hEnabled (?? 120).
//   Sorted largest-minutes-first (= earliest-fired first).

export function computeAckReminderSchedule(input: AckReminderScheduleInput): AckReminderSlot[];
//   For each snapshot offset: scheduledFor = ackDeadline − minutesBeforeDeadline.
//   Keep only scheduledFor > assignedAt (skip-past-offsets; strictly-future).
//   Returned chronologically (earliest scheduled_for first).

export function shouldSuppressAckReminder(state: FloatAckState): boolean;
//   true iff status <> 'pending' OR acknowledgedAt <> null OR declinedAt <> null.
```

All functions are PURE: no I/O, no `Date.now()`, no DB. The float-assign Edge
Function / orchestrator snapshots the `ack_cadence_config` row and calls these to
write the scheduled `notifications` rows; the delivery scheduler consults
`shouldSuppressAckReminder`'s SQL twin at delivery time.

### SQL contracts (documented here; implemented in the phase-12 migration)

```
-- The per-device push registry.
push_tokens(
  push_token_id uuid PK default gen_random_uuid(),
  user_id       uuid NOT NULL FK users(user_id) ON DELETE CASCADE,
  platform      text NOT NULL CHECK (platform IN ('android','ios')),
  device_token  text NOT NULL,
  created_at    timestamptz NOT NULL default now(),
  UNIQUE (user_id, device_token))
  -- RLS enabled in the same migration (service-role bypass + own-row policies).

-- Per-type pushability — push for all types EXCEPT the two in-app-only alerts.
notification_is_pushable(p_type notification_type) RETURNS boolean
  -- false for 'sm_permanent_drop_alert' / 'sw_permanent_removal_alert'; else true.

-- dispatch_push token resolution (the Edge Function fans FCM/APNs over these).
notification_push_targets(p_user_id uuid) RETURNS SETOF push_tokens
  -- all device rows for the user; empty for a user who never registered a device.

-- The delivery queue.
pending_notification_deliveries(p_now timestamptz) RETURNS SETOF notifications
  -- delivered_at IS NULL
  --   AND (scheduled_for IS NULL OR scheduled_for <= p_now)   [NULL = immediate]
  --   AND NOT (type='ack_reminder' AND the payload.float_id's float is no longer
  --            pending — acknowledged / declined / voided / completed).  [suppression]

deliver_notification(p_notification_id uuid, p_now timestamptz) RETURNS boolean
  -- UPDATE ... SET delivered_at = p_now WHERE notification_id = id AND delivered_at IS NULL;
  -- returns whether a row was stamped (idempotent: the second call returns false).
  -- (The Realtime push fan-out to the recipient's subscription is the caller's job.)

mark_notification_read(p_notification_id uuid, p_user_id uuid, p_now timestamptz) RETURNS boolean
  -- UPDATE ... SET acknowledged_at = p_now WHERE notification_id = id
  --   AND recipient_user_id = p_user_id AND acknowledged_at IS NULL;
  -- returns whether stamped (a non-recipient is a no-op → false). Updates-tab open.

-- The HM-leave mailto deeplink (§2.6 rule 3). Returns a URL; never sends.
craft_hm_leave_mailto(p_leave_id uuid) RETURNS text
  -- 'mailto:' || <house student workers' emails> || '?subject=…&body=…'
  -- where the body says the HM is on leave and names the replacement + their role
  -- label (bm → "Building Manager", hm → "House Manager"). The affected house is
  -- the leaving HM's home house; recipients are that house's active 'sw' workers.
```

The snapshot WRITER is NOT re-implemented in this phase: batch_f3's
`process_float_lookup_assignment` already snapshots the ack-reminder rows at
float-assign time (covered GREEN by `phase-07-f-behavioral.sql`). Phase-12 supplies
the PURE math that mirrors it (so the Edge layer has a tested, DB-free decision
surface) and the DELIVERY surface that reads its rows.

---

## Pinned Decisions

The spec leaves several implementation choices implicit. The decisions below are
pinned by the test suite — the implementation MUST match them, and any future
reinterpretation requires updating both the tests and this plan.

| #   | Topic                                       | Decision                                                                                                                                                                                                                                                                                      | Why                                                                                                                                                                                                         |
| --- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Ack deadline = T-10m before float start     | All five reminder offsets are measured backward from `floatStart − 10m`, not from the float start and not from the T-2h lookup trigger. `ackDeadlineFromFloatStart` and `ACK_DEADLINE_LEAD_MINUTES = 10` pin it.                                                                              | BSpec §7.1 ("the acknowledgment deadline, which is 10 minutes before the float start time … All reminder offsets are measured from this T-10m deadline"); the batch_f3 SQL twin.                            |
| 2   | Offsets, largest-first                      | 6h(360) / 2h(120) / 1h(60) / 30m(30) / 5m(5) minutes-before-deadline; the snapshot is sorted largest-minutes-first (= earliest-fired first), which also makes the schedule chronological.                                                                                                     | BSpec §7.1 list. Largest-first is the natural fire order.                                                                                                                                                   |
| 3   | Mandatory vs configurable                   | 1h/30m/5m are ALWAYS present (`mandatory: true`) and cannot be disabled; 6h/2h are present iff their `…Enabled` flag is true (`mandatory: false`), at their configured offset or the system default (360/120).                                                                                | BSpec §7.1 ("The 1-hour, 30-minute, and 5-minute reminders are mandatory and cannot be modified"); ARCH §2.8 (6h/2h per-house, disable-able).                                                               |
| 4   | `null` offset = system default, not absent  | A null `reminder6hOffsetMinutes` with `reminder6hEnabled = true` means the system default (360), NOT "no 6h reminder". Presence is governed by the `…Enabled` flag alone; the offset column only re-times an enabled reminder.                                                                | ARCH §2.8 (three states: default = null, custom = interval, disabled = enabled-false). The two-column encoding from `20260527000001`.                                                                       |
| 5   | Snapshot decouples from live config         | `computeAckReminderSchedule` consumes an `AckCadenceSnapshot`, never an `AckCadenceConfig`. There is no code path from a later config change to an already-snapshotted schedule — recomputing from the frozen snapshot is identical regardless of subsequent config edits.                    | BSpec §7.1 ("existing float assignments retain the cadence … in effect when they were assigned"); ARCH §2.8 (snapshot at assignment time).                                                                  |
| 6   | Skip-past-offsets is strictly-future        | A reminder is scheduled iff `scheduledFor > assignedAt`. An offset landing EXACTLY on `assignedAt` is skipped. A float assigned at T-2h (1h50m of lead to the deadline) fires only 1h/30m/5m; a float assigned inside the final 5m schedules NO reminders.                                    | BSpec §7.1 ("less than 6 hours of lead time … starts at whichever interval is next reached"; the T-2h worked example). Mirrors batch_f3 `WHERE t > p_now`.                                                  |
| 7   | Suppression = float no longer pending       | `shouldSuppressAckReminder` is true iff `status <> 'pending'` OR `acknowledgedAt <> null` OR `declinedAt <> null`. The `acknowledgedAt`/`declinedAt` checks are defensive (suppress even if the status flip lags a tick).                                                                     | BSpec §7.2 / §7.3 (a declined / voided / no-acked float is gone — no reminder for it). The "already-acknowledged → silently suppressed" edge.                                                               |
| 8   | `platform` is a CHECK-constrained text      | `push_tokens.platform` is `text CHECK (platform IN ('android','ios'))`, not an enum. `'web'` is rejected. (Tested via insert, not just `has_column`.)                                                                                                                                         | The "platform: 'android' \| 'ios'" surface; matches the float/ack CHECK-column style over a one-off enum.                                                                                                   |
| 9   | One row per device per user                 | `UNIQUE (user_id, device_token)` — a duplicate device for the same user is rejected; the same `device_token` string for a DIFFERENT user is allowed (a token is unique within a user, not globally).                                                                                          | The "one row per device per user" + "Unique constraint on (user_id, device_token)" surface.                                                                                                                 |
| 10  | Delivery due-query                          | `pending_notification_deliveries(now)` returns rows with `delivered_at IS NULL` AND `(scheduled_for IS NULL OR scheduled_for <= now)`. The `<= now` boundary is inclusive (a row scheduled exactly at `now` is due); a NULL schedule is immediate; future and already-delivered are excluded. | BSpec/ARCH §3.7 ("delivered_at=NULL and scheduled_for<=NOW() are delivered"; "scheduled_for in the past → deliver immediately"). NULL-immediate is a defensive pin (a no-schedule row is an immediate one). |
| 11  | Suppression lives in the queue              | `pending_notification_deliveries` excludes an `ack_reminder` whose `payload.float_id` float is no longer pending — so a reminder that "fires" for an acknowledged float is never delivered. Non-ack types carry no float dependency and are never suppressed.                                 | BSpec §7.2 / §7.3 (the SQL twin of decision #7); the "already-acknowledged → silently suppressed" edge case.                                                                                                |
| 12  | Delivery + read are idempotent / scoped     | `deliver_notification` stamps `delivered_at` only when it was NULL (re-delivery → false); a delivered row leaves the queue. `mark_notification_read` stamps `acknowledged_at` only for the recipient (a non-recipient → false, no write).                                                     | ARCH §3.7 (`delivered_at` once; `acknowledged_at` when the recipient opens the updates tab). At-least-once schedulers must not double-deliver.                                                              |
| 13  | Pushability excludes the in-app-only alerts | `notification_is_pushable` is false for `sm_permanent_drop_alert` and `sw_permanent_removal_alert`, true for every other type. `dispatch_push` (the Edge Function) gates on it; `notification_push_targets` resolves the device rows it fans over.                                            | ARCH §3.7 ("Both notifications are in-app only (no push)").                                                                                                                                                 |
| 14  | dispatch resolution by user                 | `notification_push_targets(user)` returns ALL of the user's `push_tokens` rows: zero for a user with no device (in-app only), both for a user with an Android + an iOS device (Firebase routes APNs on the unified path).                                                                     | The dispatch_push surface + the two device edge cases.                                                                                                                                                      |
| 15  | mailto is a URL, never a send               | `craft_hm_leave_mailto(leave_id)` returns a `mailto:` URL addressed to the affected house's student workers, with a body that says the HM is on leave and names the replacement + their role label (bm → "Building Manager", hm → "House Manager"). It does not send mail.                    | BSpec §2.6 rule 3 ("opens the user's mail application … with the message pre-filled. The user sends the email themselves"). Role-label mapping pinned here.                                                 |

---

## Test File Coverage Map

### `ack-cadence.test.ts` (Vitest) — TDD-red

| Surface                                                                                                                                    | Cases | Pinned decisions |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ---------------- |
| Constants & ack-deadline derivation — `ACK_DEADLINE_LEAD_MINUTES`, mandatory/configurable offset values, default config                    | 4     | #1, #2, #3       |
| `snapshotAckCadence` — default 5 offsets; mandatory/configurable flags; disable 6h; disable 2h; disable both; custom offsets; null=default | 7     | #2, #3, #4       |
| Long-lead schedule — all five at `deadline − offset`, chronological; label/mandatory carried through                                       | 2     | #1, #2           |
| Skip-past-offsets — T-2h fires only 1h/30m/5m; offset == now skipped; 1m before 6h keeps all; inside final 5m none; composes with disabled | 5     | #6               |
| Snapshot semantics — recompute from frozen snapshot ignores a later config change; post-change assign snapshots the new config             | 2     | #5               |
| `shouldSuppressAckReminder` — pending delivers; acknowledged / declined / voided / completed suppress; acked-at-with-pending suppresses    | 6     | #7               |
| Purity — non-mutating; deterministic                                                                                                       | 2     | —                |

**Total: 28 cases.**

### `phase-12-notifications.sql` (pgTAP) — TDD-red

| Section / Surface                                                                                                                                                                                | Assertions |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| A. `push_tokens` — table; 5 columns; 5 col-types; PK; FK→users; RLS; platform CHECK (android ✓ / ios ✓ / web ✗); UNIQUE(user_id, device_token) (dup ✗ / cross-user ✓)                            | 19         |
| B. `notification_is_pushable` — exists; personal_shift / ack_reminder / hm_leave_notice → true; the two permanent-removal alerts → false                                                         | 6          |
| C. `notification_push_targets` — exists; 0 devices → 0 rows; 2 devices → 2 rows; both platforms present                                                                                          | 4          |
| D. `pending_notification_deliveries` — exists; due present; `== now` inclusive; future absent; delivered absent; NULL-schedule immediate; acked suppressed; declined suppressed; non-ack present | 9          |
| E. `deliver_notification` — exists; stamps + returns true; delivered_at set; idempotent false; leaves the queue                                                                                  | 5          |
| F. `mark_notification_read` — exists; non-recipient no-op (false, stays NULL); recipient stamps + true; acknowledged_at set                                                                      | 5          |
| G. `craft_hm_leave_mailto` — exists; `mailto:%`; addresses sw1; addresses sw2; names the replacement; role label "Building Manager"; says "leave"                                                | 7          |

**Total: 55 assertions.**

---

## What This Phase Does NOT Cover

- **The push-dispatch HTTP layer.** The Firebase Admin SDK call that actually
  pushes to FCM (Android) / APNs (iOS, unified path) lives in the dispatch Edge
  Function; this phase ends at `notification_push_targets` (which tokens to fan
  over) and `notification_is_pushable` (whether to push this type at all). The
  network call, retry/backoff, and stale-token pruning are Edge-Function territory,
  like the rest of the HTTP layer in phases 07–11.
- **The Realtime fan-out.** `deliver_notification` stamps `delivered_at`; the
  Supabase Realtime publish to the recipient's subscription is the caller's
  responsibility and is not a DB-testable contract.
- **The notification scheduler cron.** The job that periodically calls
  `pending_notification_deliveries(now())` and dispatches each row is the
  orchestrator/cron layer; this phase pins only the due-query and the per-row
  delivery/read transitions it drives.
- **The ack-reminder snapshot WRITER.** `process_float_lookup_assignment` (batch_f3)
  already writes the scheduled `ack_reminder` rows and is covered GREEN by
  `phase-07-f-behavioral.sql`. Phase-12 supplies the PURE math mirror
  (`snapshotAckCadence` / `computeAckReminderSchedule`) for the Edge layer and the
  DELIVERY surface that consumes the rows — it does not re-test the writer.
- **The `ack_cadence_config` write UI.** Who may edit the 6h/2h offsets (HM/BM/admin
  per §7.1) and the admin form are out of scope; the table + its `enabled`/offset
  columns already exist (`20260526000009` + `20260527000001`). This phase consumes a
  config snapshot; it does not test the config write path.
- **`hm_leave` resolution / cascade.** The acting-HM resolution graph, cycle
  prevention, and "I'm back" flow (§2.6 rules 4/6) are the leave subsystem; this
  phase tests only that `craft_hm_leave_mailto` assembles the §2.6 rule-3 message
  from a given leave row. The §2.6 rule-6 "back from leave" mailto follows the same
  contract and is not separately pinned here.

---

## Why TDD-Red (and how the contracts were validated)

Phase-06/07/08/09/10/11 established the TDD-red pattern: tests import a
not-yet-existing module path / call a not-yet-existing RPC and fail; the
implementation lands in a follow-up commit and turns them green. Phase-12 follows
it for both surfaces:

- `ack-cadence.test.ts` imports `../../src/notifications/index.js`, which does not
  exist yet → red at the import line.
- `phase-12-notifications.sql` references the `push_tokens` table and calls
  `notification_is_pushable` / `notification_push_targets` /
  `pending_notification_deliveries` / `deliver_notification` /
  `mark_notification_read` / `craft_hm_leave_mailto`, none of which the phase-12
  migration has added yet → red (the `has_table` / `has_function` checks fail; the
  first call of a missing function aborts the run, exactly as phase-10/11's pgTAP
  does on its missing RPCs).

The contracts in this plan were verified implementable and the expected values
verified correct against the live local schema:

- A scratch `packages/core/src/notifications/` matching the pinned decisions turned
  all 28 Vitest cases green and type-checked clean against the workspace's strict
  config (`tsconfig.test.json`, `noUncheckedIndexedAccess`), then was removed so the
  deliverable remains tests-only — the same dry-run the phase-10/11 plans describe.
- A scratch phase-12 migration (the `push_tokens` table + the six functions)
  matching the SQL contracts turned all 55 pgTAP assertions green against the live
  local database — the float-array existence trigger required real
  `shift_block_assignments` backing rows (AGENTS phase-06 note), the platform CHECK
  rejected `'web'` (23514), the UNIQUE rejected the duplicate device (23505), the
  delivery queue suppressed the acknowledged / declined ack-reminders, and the
  mailto contained the SW emails + replacement name + "Building Manager" + "leave" —
  then was removed so the deliverable remains tests-only, and the suite re-confirmed
  red on the missing objects exactly as intended.
