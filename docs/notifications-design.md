# Notifications — Design Brief

Status: **DRAFT for review** · Owner: TBD · Created 2026-06-27

Goal: a worker-facing, **user-customizable** notification system covering floating,
shift-start, and break-claim openings — built on the delivery plumbing that already
exists, not a rewrite. This brief proposes the data model, the event catalog, and the
customization controls, then a phased build plan. Nothing here is implemented yet;
it exists to be argued with before code.

> Source-of-truth note: where this brief touches notification _timing_ it defers to
> BEHAVIORAL_SPECIFICATION.md §7 (float ack cadence) and §14 (system params). New
> behavior (shift-start reminders, per-worker prefs) is **not yet in the spec** — if we
> proceed, the spec gets the authoritative version and this brief becomes the rationale.

---

## 1. What already exists (reuse, don't rebuild)

The delivery pipeline is real and working end-to-end:

| Piece                             | Where        | Notes                                                                                                                                                              |
| --------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `notifications` table             | schema       | `recipient_user_id`, `type`, `scheduled_for`, `payload jsonb`, `delivered_at`, `acknowledged_at`                                                                   |
| `notification_type` enum          | schema       | 8 values: `personal_shift`, `broadcast`, `hmod_urgent`, `ack_reminder`, `swap_request`, `hm_leave_notice`, `sm_permanent_drop_alert`, `sw_permanent_removal_alert` |
| `push_tokens`                     | schema       | per-device FCM token (`platform` android/ios), Firebase routes both FCM + APNs                                                                                     |
| `deliver_pending_notifications()` | cron (1/min) | enqueues `dispatch-push` via pg_net; re-checks before sending (at-least-once)                                                                                      |
| `dispatch-push` Edge Function     | EF           | re-validates, sends through Firebase                                                                                                                               |
| `snapshot_float_ack_reminders()`  | RPC          | materializes the §7.1 float ack cadence rows (6h/2h/1h/30m/5m) at assignment time                                                                                  |
| `ack_cadence_config`              | table        | **per-house** float-reminder config (6h/2h offset + enabled), HM/BM-settable                                                                                       |

**What this means:** scheduling a future notification = INSERT a `notifications` row with a
`scheduled_for`; the cron + dispatch-push already deliver it. New event types mostly need
(a) an enum value, (b) something that inserts the scheduled row, (c) a per-worker
preference check. The transport is solved.

## 2. The gaps (what we're actually building)

1. **No "your shift is about to begin" notification.** No enum value, no scheduler. This
   is the single most-requested missing piece.
2. **No per-worker customization.** The only tuning that exists is the _per-house_ float
   ack cadence, set by managers — workers cannot opt in/out, change lead time, or pick how
   many reminders. Everything else is hard-coded or mandatory.
3. **Break-claim opening is partial.** `send_break_nag` notifies when the FCFS claim pool
   opens/alerts, but it's not worker-tunable and not modeled as a first-class preference.

## 3. Proposed event catalog

Each row is a _notification class_ a worker can tune. "Mandatory" classes can be
**reordered/retimed but not disabled** (mirrors §7.1's mandatory 1h/30m/5m float reminders —
coverage-critical messages must reach the worker).

| Class                                | Trigger                                     | Default lead(s)                                   | Customizable                  | Mandatory floor                                      |
| ------------------------------------ | ------------------------------------------- | ------------------------------------------------- | ----------------------------- | ---------------------------------------------------- |
| `float_request`                      | float assigned to you                       | immediate + 6h/2h/1h/30m/5m before T-10m deadline | lead set + count (6h/2h only) | 1h/30m/5m cannot be disabled (§7.1)                  |
| `shift_start` (**new**)              | your scheduled/claimed/floated shift begins | e.g. 60m + 10m before start                       | on/off, lead(s), count        | none — fully optional                                |
| `break_claim_open` (**new/promote**) | FCFS break pool opens for a house you're in | at pool open                                      | on/off, +reminder             | none                                                 |
| `swap_request`                       | counterparty proposes/accepts a swap        | immediate                                         | on/off                        | none                                                 |
| `broadcast`                          | open shift broadcast to your house          | immediate                                         | on/off                        | none (coverage-relevant but not personally assigned) |

Open question for §7: should `shift_start` be suppressible entirely, or is there a
floor (e.g. a single mandatory T-10m "you're on in 10 minutes")? Recommend **fully
optional** — it's a convenience nudge, not a coverage mechanism.

## 4. Per-worker preference model

New table, one row per `(user_id, notification_class)`:

```
notification_preferences
  user_id              uuid     -> users(user_id)   (RLS: own rows only + service bypass)
  notification_class   text     -- 'float_request' | 'shift_start' | 'break_claim_open' | ...
  enabled              boolean  NOT NULL DEFAULT true
  lead_offsets         interval[] -- e.g. {'1 hour','10 minutes'} ; empty = "at event time"
  PRIMARY KEY (user_id, notification_class)
```

Rules:

- **Absent row = system default** (so we never have to backfill every worker). The resolver
  reads the row if present, else falls back to the class default in §3.
- **Mandatory floors enforced in code, not config:** the resolver unions the worker's
  `lead_offsets` with the class's mandatory set and ignores `enabled=false` for mandatory
  classes. Same pattern as the existing float cadence (null offset ≠ suppressed).
- Quiet hours / channel choice (push vs in-app only) are **out of scope v1** — listed in §7.

Why a generic table over per-class columns: the event catalog will grow (leave notices,
permanent-drop alerts could become tunable later); a `(class, prefs)` row scales without a
migration per event.

## 5. Architecture — where each event gets scheduled

- **`float_request`**: already materialized by `snapshot_float_ack_reminders`. Change =
  have it read `notification_preferences` for the 6h/2h offsets (per-worker) layered over
  the per-house `ack_cadence_config`. Precedence question for §7: worker vs house — recommend
  **house sets the envelope, worker tunes within it**.
- **`shift_start`** (new): a scheduler that, for each assignment, inserts `scheduled_for =
block_start_at − lead` rows. Two options:
  - (a) **Cron sweep** (like `deliver_pending_notifications`): once/min, find shifts starting
    within the max lead window with no row yet, insert. Simple, self-healing, handles
    late claims/drops naturally. **Recommended.**
  - (b) **Materialize on assignment** (like float reminders): insert at claim/publish time.
    Fewer scans but must be torn down on drop/swap — more edges.
  - Recommend (a): a shift-start nudge is non-critical, so a 1-minute granularity sweep is
    fine and avoids the teardown bookkeeping (a) sidesteps.
- **`break_claim_open`**: promote `send_break_nag`'s insert to honor `notification_preferences`.
- All classes flow through the **existing** `deliver_pending_notifications` → `dispatch-push`.
  No new transport.

DST/timezone: every `scheduled_for` is `timestamptz`; leads are `interval` subtraction off
`block_start_at` (already NY-anchored) — no wall-clock math (AGENTS invariant #6).

## 6. Phased plan

1. **P1 — Preferences foundation**: `notification_preferences` table + RLS + a pure
   resolver (`packages/core`) that takes (class, worker prefs, defaults) → effective
   lead set. Unit-tested. No behavior change yet.
2. **P2 — Shift-start reminders**: enum value `shift_start`, the cron sweep (5a), wire to
   the resolver. Mobile: a settings surface to toggle + set lead. pgTAP for the scheduler.
3. **P3 — Float prefs**: `snapshot_float_ack_reminders` consults the resolver; worker can
   tune 6h/2h within the house envelope. Spec §7.1 update.
4. **P4 — Break + the rest**: promote `break_claim_open`; make `swap_request`/`broadcast`
   toggleable. Mobile settings screen consolidated.

Each phase ships independently and is behind the "absent row = default" rule, so partial
rollout never regresses existing delivery.

## 7. Open questions (need decisions before P1)

- **Mandatory floors**: confirm which classes have an undisablable reminder (proposed: only
  `float_request`'s 1h/30m/5m, per §7.1; everything else fully optional).
- **Float pref precedence**: worker overrides house, or house caps worker? (Recommend house
  envelope, worker tunes within.)
- **Quiet hours / channels**: v1 scope-out, or table-stakes? (Recommend defer.)
- **Count control**: is "how many reminders" just "which lead offsets are set," or a separate
  cap? (Recommend the former — offsets _are_ the count.)
- **Spec ownership**: who writes the §7/§14 authoritative version once shape is agreed.
