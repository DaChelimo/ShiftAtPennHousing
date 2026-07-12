# Swap Edge Cases

Behavioral reference for shift/float/permanent swaps and handoffs, with emphasis
on timing edge cases. Use this to orchestrate or manually test these scenarios.

Source of truth ordering still applies: BEHAVIORAL_SPECIFICATION.md (esp. §8 swaps,
§5 coverage/escalation) and ARCHITECTURE.md win over this file where they conflict.
This file documents intent and the concrete behavior we expect from the code.

## Core principle

A swap is a **private agreement between two consenting workers**. Its validity is
governed by the **proposal timeout**, NOT by the shift's start/end clock. A swap
timing out must NEVER, by itself, create a coverage hole.

Two separate mechanisms, do not conflate them:

- **Swap** moves *held hours* between two workers who both agree. Until the
  counterparty accepts, the initiator remains the assigned worker and the desk
  reads as covered. Nothing escalates.
- **Drop** is how a worker who cannot make a shift relinquishes it. A drop is what
  triggers coverage escalation (broadcast at T-3h, float lookup, then Allied). If a
  swap is not accepted and the worker genuinely cannot work, the worker DROPS.

So the failure path for "I can't make my shift and nobody will swap" is **drop**,
not "the swap expired." Expiry just closes the offer; it changes no assignments.

## Timeout windows (set at creation, in `create-swap`)

| Swap type      | Expiry anchor                              |
| -------------- | ------------------------------------------ |
| Shift swap     | **Creation time + 2 days**                 |
| Handoff        | **Creation time + 2 days** (same as shift) |
| Float swap     | Latest block end + 24h (retroactive OK)    |
| Permanent swap | Creation time + 7 days                     |

Enforcement: a once-a-minute cron flips `pending` swaps to `expired` when
`expires_at <= now()`, and `accept_swap` / `apply_permanent_swap` re-check expiry
at accept time. Expiring a swap only changes its `status`; it touches no
assignments and never reopens a seat.

### What changed and why

Shift swaps (and handoffs) previously expired at **T-3h before the earlier shift
starts**. That anchored swap validity to the shift clock, so a last-minute swap for
an imminent or in-progress shift was created already expired and could never be
accepted. We replaced that with a fixed 2-day-from-creation window. There is no
"block already started" / `block_start_at < now` rejection anywhere in the swap
path, and there never was. Float swaps already allowed retroactive acceptance
(BSpec §8.2); shift swaps now follow the same spirit.

## Scenario A: last-minute relief swap (the motivating case)

Setup (all times same day):

- Bob works the desk until 11:00.
- Ben is scheduled to relieve and work 11:00 to 16:00.
- 11:05: Ben calls in, cannot work right now, and proposes a swap: Bob covers
  11:00 to 14:00 of Ben's shift, and Ben takes one of Bob's future shifts in
  exchange.

Expected behavior:

| Moment        | Expected result                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| 11:05 propose | **Succeeds.** Swap row created `pending`, `expires_at = 11:05 + 2 days`. Not auto-expired by the shift clock. |
| 11:05 to accept | Ben remains the assigned worker for 11:00 to 16:00. Desk reads **covered**. No broadcast / float / Allied.  |
| 11:10 accept  | **Succeeds.** Transfer applies retroactively: Bob owns 11:00 to 14:00, Ben owns Bob's future shift. Ben keeps 14:00 to 16:00. |
| After accept  | No coverage escalation fires (the desk was never vacant). Hours move with the blocks; roughly neutral.       |

If Bob (or anyone) does NOT accept and Ben truly cannot work: Ben **drops** the
11:00 to 14:00 portion. The drop, not the unaccepted swap, is what opens the seat
and starts escalation.

## Scenario B: swap for an already-started shift

A worker proposes a swap whose earliest block start is already in the past.

- Proposal **succeeds** (no past-shift gating).
- Acceptance **succeeds** up to the 2-day timeout and applies retroactively
  (calendar updates for the already-worked portion, BSpec §8.2).
- Staffing is unaffected at propose time; the initiator stays assigned until accept.

## Scenario C: swap proposed, never accepted, shift arrives

- The swap stays `pending` until `creation + 2 days`, even across the shift itself.
- The desk stays covered by the original (initiator) assignment the whole time.
- If the initiator cannot work, they must DROP before the shift to trigger
  escalation. Relying on the swap to "fall through" does nothing to coverage.
- At `creation + 2 days` the cron marks it `expired`; no assignment changes.

## Scenario D: span invalidated before accept

Between propose and accept, one side's seat changes (dropped, floated out, pulled
into another pending swap, no longer owned by the original worker).

- `accept_swap` returns `span_invalidated` and changes nothing.
- A seat already in another pending swap is blocked (no double-promising a block).
- A block in `pending_float_in` / `pending_float_out` is not swappable.

## Scenario E: interaction with coverage escalation and Allied

- A `pending` swap does **not** suppress or trigger escalation by itself; escalation
  keys off actual coverage (present worker on the block), per the coverage floor
  (one present worker = covered).
- If the initiator drops instead of waiting on the swap, escalation proceeds
  normally: broadcast (T-3h, still claimable), float lookup (locks the seat at
  T-2h if the desk would be empty), then HMOD-notify-Allied.
- Accepting a swap that re-fills a desk does NOT retroactively cancel an Allied
  request already secured (no-takeback applies to floats/Allied, not to the swap).
  An Allied window, once secured, stays secured.
- Accepting a swap never un-locks a seat that already hit its one-way T-2h coverage
  lock.

## Scenario F: invariants that still hold during any swap

These are assignment-level and apply regardless of swap timing:

- **Harnwell training**: a non-Harnwell-home worker can never receive a Harnwell
  block via swap.
- **Float direction**: single-staff-house workers cannot receive float assignments;
  Quad cannot float to Harnwell.
- **Block atomicity**: swaps move 30-minute blocks on 30-minute boundaries only.
- **No-takeback**: a `pending`/`acknowledged` float or secured Allied window is not
  revoked by a later swap.
- **Time zone**: all timing is America/New_York `timestamptz`.

## Manual test / orchestration checklist

1. Propose a shift swap whose earlier block starts in < 3h (or already started).
   Confirm the row is `pending` with `expires_at ≈ now + 2 days`, not pre-expired.
2. Accept it after the shift start. Confirm retroactive transfer and that no
   float/Allied escalation was triggered by the swap.
3. Let a shift swap sit unaccepted past the shift and up to 2 days. Confirm the
   desk stayed covered by the initiator and the swap expires at `creation + 2 days`.
4. Drop (not swap) an imminent shift. Confirm escalation fires (broadcast → float →
   Allied) per the coverage floor.
5. Invalidate a span mid-swap (drop one side). Confirm `accept_swap` →
   `span_invalidated`.
6. Repeat 1 and 2 for a **handoff** (also 2-day window now).
