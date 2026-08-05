# Harnwell-only pilot: manager-directed floating

Working document. Settled behaviour gets promoted into BEHAVIORAL_SPECIFICATION.md and
ARCHITECTURE.md as each workstream lands (root AGENTS.md, "Specs Are Ground Truth").

Branch: `feat/harnwell-only-pilot`. Target: Fall semester, Harnwell only.

## The situation

Harnwell is the only live house. The other 12 exist as rows and as float destinations, but
they are not staffed, have no schedule, and none of their workers are on the platform.

This breaks the automated float model in a specific way: the escalation chain sources
floaters _from other houses into_ the gap. With one live house there is nobody to source, so
the float-lookup step can only ever find nothing. Meanwhile the real operational need runs the
other way: a manager regularly needs to send a Harnwell worker _out_ to cover another house.

So the pilot inverts floating. It stops being an automated coverage mechanism and becomes a
manual staffing directive a manager issues from the calendar.

## Decisions (stakeholder, 2026-08-01)

1. **Destination seats are materialised on demand.** Picking a house plus a time range mints
   the destination blocks and one occupied float seat for exactly that range.
2. **A float is a directive.** Acknowledgement is a read receipt, not consent. No decline, no
   no-ack void, no float exclusion.
3. **Ack reminders stay; Allied fallback does not.** A T-10min Allied fallback for an
   unacknowledged float was considered and rejected: procuring Allied coverage pulls in the
   other houses' RSMs, which is exactly the cross-house coordination the pilot exists to
   avoid. The reminders carry the whole burden of getting the worker to see the float.
4. **Manager surfaces are gated on `user_can_build_schedule`** (SM, RSM, HM, BM), not
   RSM-only. Revises the earlier RSM-only framing.
5. **Pilot scope is configuration, not code.** One place to widen the pilot to more houses or
   to all of them. See "Pilot configuration" below.
6. **A float frees a Harnwell seat and pushes every eligible Harnwell worker**, immediately,
   at any distance from the shift.
7. **The manager can shrink, extend, or cancel a float** for its whole life.
8. **On a shrink conflict, the claim wins.** If the released Harnwell seat was already
   claimed, the claimer keeps it and the floater loses those hours.
9. **Open Shifts is scoped to live houses.** Feed only. The house switcher, cross-house
   calendar view, and the swap/handoff recipient directory are untouched.
10. **Floats are swappable regardless of ack state**, including partially.
11. **The floaters view spans the same window as Shifts**: last week through four weeks
    ahead.
12. **The Desk Assistant (Snoopy) comes off the app**, including the kiosk desk surface.
    Entry points and their web glue removed on both platforms; the KB and Edge Functions stay.
13. **Destination houses are unreachable by design.** They have nobody on the app. Workers
    can call a destination desk, but that desk cannot see or reach them back.

## What already exists and is reused unchanged

Worth stating explicitly, because most of this feature is wiring rather than building.

| Capability                          | Where                                                             |
| ----------------------------------- | ----------------------------------------------------------------- |
| Float write, TOCTOU-guarded, atomic | `force_trigger_float` (20260529000001)                            |
| Source seat reopens on float-out    | `reopen_float_source_seats` (20260623000002)                      |
| Ack reminder cadence snapshot       | `snapshot_float_ack_reminders` (20260601000002)                   |
| "A shift opened" push + recipients  | `notify_shift_opened` (20260729000013), `shift_opened` enum value |
| Float swap, reassigns the float     | `accept_swap` float branch (20260530000001:400)                   |
| Sub-range picker + action segments  | `components/calendar/ShiftOverrideEditor.tsx`                     |
| Web glue to the force-trigger EF    | `lib/actions/forceTrigger.ts` (kept, dormant since 2026-06-24)    |
| Manager capability gating on mobile | `shared/.../manager/ManagerCapability.kt`, `ForceTrigger.kt`      |

## Pilot configuration

The requirement is that widening the pilot, to more houses or to all of them, is one change
in one place rather than a hunt through the code for everything that was cut.

A single boolean like `pilot_mode` would satisfy that literally but fails the moment the
pilot has two houses, because at that point float lookup should come back on while other
cut-downs stay.

The better answer turned out to be that **the pilot needs no flag of its own at all.** Both
remaining cut-downs derive from something that already exists, and the third (Snoopy) is a
permanent product removal rather than a pilot-scoped one, so it is not configuration either.

**Derive from the live-house set.**

`houses.launch_state` plus `is_house_live()` and `is_staggered_launch_enabled()` already
exist from the staggered launch (20260712000001), with an admin UI at `/admin/launch`. Both
pilot cut-downs are not really pilot decisions at all, they are consequences of how many
houses are live:

- **Float lookup** is meaningful exactly when two or more live houses can source floats.
  Rather than a switch, `floatLookupStep` short-circuits when the live-house count is below
  two. Launch a second house and automated floating returns by itself, correctly, with no
  config edit.
- **Open Shifts scoping** is the live-house set, not a hardcoded Harnwell. `worker_open_shifts`
  filters on `is_house_live()`. Launch a second house and its seats appear, subject to the
  worker's existing `open_shifts_other_houses` preference.

This is strictly better than a pilot flag for these two, because the thing that changes when
the pilot widens is the live-house set, and an operator will definitely remember to launch a
house. They may well forget a separate flag, and a forgotten flag here means workers silently
cannot see a live house's open shifts.

So widening the pilot is: launch the house. That is the single place, and it is a place an
operator cannot forget, because launching is the act of widening.

**What is deliberately not configuration.**

- **Snoopy's removal.** Confirmed 2026-08-01 as permanent, not pilot-scoped, so it is a
  straight removal rather than a flag. See workstream H.
- **The manager-directed float.** Additive and useful at any number of houses. Gating it
  would mean it stops working the day the pilot widens, which is backwards.

**Recommendation: do not build a `pilot_profile` abstraction yet.**

The earlier draft of this plan proposed one, on the assumption there would be several
non-derivable cut-downs. There is now exactly zero. A profile map with no members is
premature abstraction of the kind `.claude/skills/architecture-review` exists to catch, and
an empty indirection layer makes the next reader hunt for flags that do not exist.

If a genuinely non-derivable cut-down appears later, `packages/core/src/pilot/` is the
designated home for it and this paragraph is the pointer. Building it before then buys
nothing.

## Workstreams

### A. Pilot scoping

**A1. Float lookup short-circuits below two live houses.** `orchestrator-tick`'s
`floatLookupStep` returns early per Layer 1. It must still mark `block_step_status` and still
call `lock_block_coverage()`, because the T-2h coverage lock is recorded at that step (AGENTS
`[Coverage-lock]`) and skipping it would leave seats claimable past the cutoff on an empty
desk. Broadcast and the Allied/HMOD escalation are untouched and still fire for Harnwell gaps.

**A2. Open Shifts filters on live houses.** `worker_open_shifts` gains an `is_house_live()`
filter per Layer 1. Worker feed only. The existing `open_shifts_other_houses` preference
(20260728000001) already defaults off, but the feed is the surface workers actually see, so
this is enforced server-side rather than relying on a per-worker default.

### B. Manager-directed float

**B1. Destination block minting.** New `shift_blocks.origin` marker (`'generated'` default,
`'manual_float'` for minted blocks) so nothing downstream mistakes a minted block for a
staffed one. `UNIQUE (house_id, block_start_at)` means minting is
`INSERT ... ON CONFLICT DO NOTHING`, and `required_headcount = 1` satisfied by the single
float seat, so a minted block is never vacant and never enters escalation or the open-shifts
feed. When a float is cancelled or shrunk past a block, the seat _and_ the now-orphaned block
are deleted together, so an empty `required_headcount = 1` block never lingers.

Risk to close during build: `apply_compiled_season` reconciles future blocks, and publish
regenerates them. Both must skip `origin = 'manual_float'`. The pilot is a school-year
period so the season path should not fire, but the guard is cheap and the failure mode
(a floater's destination seat silently deleted) is severe.

**B2. `manager_float_worker` RPC.** One transaction: validate the initiator, mint destination
blocks and seats, then reuse the `force_trigger_float` body for the source side, the seat
reopen, and the reminder snapshot. Sets `initiated_by = 'force_triggered'`,
`force_triggered_by = the acting manager`, so the existing schema CHECK and every downstream read path
keep working with no change.

Hard invariant #1 is unaffected in the outbound direction, and Harnwell is already barred as
a float destination by both the short-circuit in `float-lookup/index.ts` and the
`float_routing` legality trigger. The house picker must exclude Harnwell for the same
reason, and the RPC must re-check it rather than trusting the client.

**B3. Directive semantics.** Ack stays as the read receipt. Removed for manager floats only:
the decline path, the no-ack void, the resulting float exclusion, and the Allied fallback.
The 6h/2h reminders stay, since their purpose (make sure the worker has seen it) is exactly
the read-receipt purpose. Automated floats keep every one of these behaviours.

Per decision 3, an unacknowledged manager float has **no** terminal escalation. It does not
reach Allied at T-10min or at any other point, because Allied procurement pulls in the other
houses' RSMs. The consequence to accept knowingly: a worker who never opens the app is
expected at the destination anyway, and the only mitigations are the reminders and the
manager seeing "awaiting confirmation" in the floaters view. That is a deliberate trade, and
the floaters view is what makes it survivable, so its state indicator is load-bearing rather
than cosmetic.

Note this does not violate hard invariant #3. No-takeback governs _automated_ revocation;
a manager edit is a sanctioned manual action, the same reasoning that lets `transfer_worker`
and `fire_worker` void live floats.

**B4. Authorisation.** `user_can_build_schedule`, so SM, RSM, HM, and BM, plus admin through
the existing unconditional clause. No new predicate. This reuses the same gate as the
schedule builder and the calendar override editor, which is where the float control lives,
so a manager who can already edit a seat can also float it. Cross-house behaviour follows
that predicate unchanged: the elevated tier acts on any house, SM on their own.

### C. Editing a float

Shrink, extend, and cancel, for the float's whole life including mid-shift.

**Shrink** releases the trailing or leading destination seats and deletes their minted
blocks. For each released Harnwell block, if the reopened seat is still vacant the worker
returns to it; if it was claimed, per decision 6 the claimer keeps it and the worker simply
loses those hours. That second outcome needs a notification to the worker, because otherwise
hours disappear from their calendar with no explanation.

**Extend** mints the additional destination seats, reopens the corresponding Harnwell seats,
and fires `notify_shift_opened` for the newly freed blocks only.

**Cancel** is a shrink to zero, with the same claim-wins reconciliation.

All three run through one `manager_edit_float` RPC taking the desired final range, so the
diff against the current range is computed server-side. A client sending "the new range"
rather than "the delta" cannot desynchronise from concurrent claims.

### D. Swap interaction

**D1. Relax `block_in_pending_float`.** The guard at
`20260530000001_phase_09_swaps.sql:265` rejects any swap touching a float while
`float_assignments.status = 'pending'`. Under the directive model a float can sit pending
indefinitely because the worker never taps the button, which would make it permanently
unswappable. Scope the guard to `initiated_by = 'automated'`, where a genuinely undecided
float still needs protecting from a racing swap.

**D2. Partial float swap splits the float row.** This is the sharp edge.

`float_assignments` has one `user_id` for the whole record, and `accept_swap` reassigns it by
taking the lowest-sorting destination seat's owner (`ORDER BY sba.assignment_id LIMIT 1`,
line 401-411). With every seat owned by one person that is correct. After a partial swap the
seats have two owners and the result is arbitrary: the float record claims one person owns
hours the other is actually working.

Worked example. Puity floats to Rodin 08:00 to 24:00. Andrew swaps his Harnwell 08:00-10:00
shift for the first two hours of her float. Correct end state:

- Andrew: Rodin float 08:00-10:00
- Puity: Harnwell 08:00-10:00 (Andrew's old seat), then Rodin float 10:00-24:00
- Puity's _original_ Harnwell 08:00-24:00 seat stays open from the initial float, still
  claimable by a third worker. On a double-staffed desk that is correct, not a duplicate.

So `accept_swap` must, when a float swap covers a strict subset of
`destination_assignment_ids`, split the row into one `float_assignments` per resulting owner,
each carrying its own source and destination arrays and its own ack state. The new floater's
row starts unacknowledged with a fresh reminder snapshot; the original floater's remaining
row keeps whatever ack state it had. Both appear as separate lines in the floaters view,
which is the honest representation.

Existing `float_swap` handling of a _whole_ float stays on the current path.

### E. Floaters view

Web and mobile, gated on `user_can_build_schedule` per B4. One list, sorted by shift start
ascending so the most imminent float is first. Each row: worker, destination house, date,
time range, and state (awaiting confirmation / confirmed). Empty state says plainly that
nobody is floating.

The state indicator is the only signal that an unacknowledged float may be about to go
uncovered, since per B3 nothing escalates it. It should be prominent rather than a subtle
badge, and awaiting-confirmation rows should sort or group ahead of confirmed ones at the
same start time.

**Window.** The same span as Shifts, per decision 11: last week through four weeks ahead.
This is already expressed as `MIN_WEEK_OFFSET = -1` / `MAX_WEEK_OFFSET = 4` in
`viewmodel/HouseScheduleViewModel.kt:97`, with `WeekHeaderCard` and `WeekPickerSheet` already
parameterised and shared between Calendar and My Shifts (AGENTS `[Phase 13a]`). Reuse the
constants and both components rather than restating the bounds, so the floaters view cannot
drift from Shifts if the window ever changes.

Within the shown week the sort stays start-ascending, so "soonest first" holds inside a week
and the week picker handles the rest.

Mobile lands in `shared/.../manager/`, which already has the capability gating and role
cache. Web lands as a new route rather than growing an existing component.

Edit entry points: the floaters view row, and the Harnwell calendar where the worker shows as
floated out. Both open the same editor.

### F. Notification on the freed seat

`notify_shift_opened` already resolves recipients correctly, including hard invariant #1
(only home-Harnwell workers hear about a Harnwell seat). Its migration explicitly scoped out
float-out reopening: "Float-out seat reopening and admin removal are deliberately NOT wired
here (scoped out 2026-07-29)". Decision 6 reverses that for the float path. Call it from
`reopen_float_source_seats`, once per float rather than once per block, matching the existing
span-collapsing behaviour that keeps a 4-hour float from firing 8 pushes.

### G. Calendar entry point

"Float" joins Swap and Remove in the `ShiftOverrideEditor` action row. The existing sub-range
picker supplies the duration, so the only new UI is the destination house picker (12 houses,
Harnwell excluded). The action row is currently a two-segment pill in
`calendar.css:828`; it becomes three.

### H. Remove the Desk Assistant entry points

Decision 12. **Status check, 2026-08-01: this has not been done.** It was believed removed by
an earlier session; it is not. Snoopy is live on both platforms today:

- Web nav: `app/(app)/layout.tsx:126` and `app/(worker)/layout.tsx:41`.
- Web routes: `app/(app)/assistant/`, `app/(worker)/home/assistant/`, and the whole kiosk
  route group `app/(assistant)/` (`layout.tsx`, `assistant/AssistantChat.tsx`,
  `assistant/desk/page.tsx`). The kiosk desk surface goes too, confirmed 2026-08-01.
- Mobile: `shared/.../assistant/`, `androidApp/.../AssistantScreen.kt`, the Ask chip
  (`AskChipPlacementTest.kt` pins its placement), `iosApp/AssistantScreen.swift`, and a
  reference in `iosApp/Onboarding.swift`.

Scope is **entry points only**. The backend stays: the pgvector knowledge base, the four
Edge Functions, and `packages/core/src/desk-assistant/` are untouched. Removing a nav item
and a screen is cheap to reverse; deleting a whole subsystem is not, and nothing about the
pilot requires it.

With the kiosk gone there is no caller left for the web glue either: `app/api/assistant/ask/`
(the SSE endpoint) and `lib/actions/assistant.ts` both drop to zero consumers. Remove them
with the UI. An HTTP endpoint that reaches a live AI backend and answers to nobody is not
worth keeping around for reversibility, and the Edge Functions behind it are what actually
makes restoring cheap.

Two things to handle rather than trip over: the onboarding tour and the guide content
reference the assistant, so their steps need pruning in the same change, and the Android and
iOS UI tests that pin the chip and screen become orphaned. Per AGENTS, orphaned tests get
flagged and removed with the UI they covered rather than left to rot.

## Resolved questions

Recorded because the reasoning matters later, not just the answer.

1. **Floaters view history**: last week through four weeks ahead, same as Shifts. Decision 11.
2. **Destination house reachability**: a non-issue. Those houses have nobody on the app, so
   there is no one to reach. Desk phone numbers will be populated for all 13 houses so a
   floated worker can call the desk they are going to; the call is one-way by nature, and the
   destination desk sees nothing about them. So the contact card needs the numbers seeded, and
   nothing more.
3. **Timesheet approval**: works already and is genuinely out of scope. Floated hours and
   home-desk hours are both recorded by the app, so approval is additive with no change. The
   one uncovered case is an informal off-app arrangement between workers at different houses,
   which stays an email conversation and is out of the product's scope by design.
4. **The third cut-down** was Snoopy. See workstream H.

## Build order

Each step is independently verifiable, and nothing is committed until its spec edit is
written alongside it.

1. **A, pilot scoping** (the two live-house derivations). Smallest, and independent of
   everything else.
2. **H, removing the Snoopy entry points.** Also independent, and worth doing early so the
   onboarding tour and orphaned-test cleanup are not competing with float work for attention.
3. **B, the manager float**, back to front: minted blocks, then the RPC, then the calendar
   action, then the notification wiring in F.
4. **E, the floaters view**, once there are floats to look at.
5. **C, editing**, which needs both a float and somewhere to see it.
6. **D, the swap interaction**, last, because the partial-swap split is the hardest piece and
   benefits from everything above being real.

Steps 1 and 2 are independent of 3 through 6 and of each other, so they can be split across
sessions freely. Steps 3 through 6 are a chain.

## Test obligations

- pgTAP: `manager_float_worker` authorisation matrix (including SM allowed, SW refused),
  Harnwell-as-destination rejection, minted-block lifecycle, shrink with and without a
  competing claim, extend, cancel, and the partial-swap float split.
- pgTAP: `worker_open_shifts` shows only live houses; a second launched house restores
  cross-house seats with no config change. This is the load-bearing claim of the whole
  configuration section, so it gets asserted rather than assumed.
- Mobile: `ui-testing` skill for the floaters view, per AGENTS (a new screen is a major UI
  change). Its week navigation should assert the same bounds as Shifts.
- Mobile and web: the tests pinning the Snoopy chip and screens are orphaned by workstream H
  and get removed with the UI they covered, not left failing or skipped.
- Regression: the automated float path must be provably unchanged. Every relaxation in this
  plan (D1 especially) is scoped by `initiated_by`, so the existing suite passing is the
  check that the scoping held.
