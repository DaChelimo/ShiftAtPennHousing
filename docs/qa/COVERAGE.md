# Ship Check Coverage

The 15 user journeys, sliced cross-stack. Each slice follows one path end to end: mobile UI
and its ViewModel, the web equivalent, the Edge Function, the RPC, the RLS policy, and the
notification it emits.

Slices are ordered by descending product risk, which is roughly "how many paid hours can this
lose if it is wrong."

Status is one of: `not-started`, `in-progress`, `passed <date>`.

| #   | Journey                                                                                  | Status              | Report                                                                                 | P0  | P1  |
| --- | ---------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------- | --- | --- |
| 1   | Auth, session, and the per-house launch gate                                             | `passed 2026-07-26` | [qa-auth-launch-gate-2026-07-26.md](qa-auth-launch-gate-2026-07-26.md)                 | 3   | 3   |
| 2   | Open shifts: claim, seat allocation, coverage-conditional pickup lock, overlapping feeds | `passed 2026-07-26` | [qa-open-shifts-claim-2026-07-26.md](qa-open-shifts-claim-2026-07-26.md)               | 4   | 2   |
| 3   | Drop and permanent drop                                                                  | `passed 2026-07-26` | [qa-drop-swaps-2026-07-26.md](qa-drop-swaps-2026-07-26.md)                             | 5   | 4   |
| 4   | Swaps: 1:1, partial, multi-leg, permanent, pending guard, expiry                         | `passed 2026-07-26` | [qa-drop-swaps-2026-07-26.md](qa-drop-swaps-2026-07-26.md)                             | 5   | 4   |
| 5   | Floats: lookup, acknowledgement, no-ack void, force trigger, no-takeback                 | `passed 2026-07-26` | [qa-floats-2026-07-26.md](qa-floats-2026-07-26.md)                                     | 6   | 3   |
| 6   | Breaks: calendar picker, FCFS, leftovers into the open feed                              | `passed 2026-07-26` | [qa-breaks-2026-07-26.md](qa-breaks-2026-07-26.md)                                     | 3   | 6   |
| 7   | My Shifts and the personal calendar                                                      | `passed 2026-07-26` | [qa-my-shifts-calendar-2026-07-26.md](qa-my-shifts-calendar-2026-07-26.md)             | 3   | 4   |
| 8   | Preferences, including admin-on-behalf and the deadline override                         | `passed 2026-07-26` | [qa-preferences-2026-07-26.md](qa-preferences-2026-07-26.md)                           | 6   | 9   |
| 9   | Schedule builder, AI scheduling, and publish                                             | `passed 2026-07-26` | [qa-schedule-builder-publish-2026-07-26.md](qa-schedule-builder-publish-2026-07-26.md) | 5   | 4   |
| 10  | Admin: people, hire/fire, house transfers, hours cap, operating seasons                  | `not-started`       |                                                                                        |     |     |
| 11  | House grid, contact card, cross-house view                                               | `not-started`       |                                                                                        |     |     |
| 12  | Notifications and push delivery                                                          | `not-started`       |                                                                                        |     |     |
| 13  | Onboarding: the six tours, notification priming, the widget prompt                       | `not-started`       |                                                                                        |     |     |
| 14  | Desk Assistant and the knowledge base                                                    | `not-started`       |                                                                                        |     |     |
| 15  | Orchestrator, cron, and the paths no journey walks through                               | `not-started`       |                                                                                        |     |     |

## Merge review, 2026-07-26 (slices 1 and 2)

**One defect was found independently by both slices**: the `anon` SELECT grant on
`worker_open_shifts`, re-applied by `20260724000004:196` and `20260726000001:324` after
`20260711000001` explicitly revoked it. Two journeys reaching the same defect from different
directions raises its blast radius above what either slice could see alone. Confirmed against
the live catalog during merge review: `worker_open_shifts | anon=true`, while `worker_my_shifts`
and `worker_pending_floats` are correctly `false`.

This is the **third** occurrence of the same shape. `20260711000001`'s own header records that
the grant was previously "re-applied verbatim by `20260617000004` and `20260627000001`". The
cause is structural, not careless: the `CREATE OR REPLACE VIEW` migration template carries a
`GRANT SELECT ... TO anon, authenticated, service_role` line, so every later migration that
touches the view resurrects the revoked grant. A prose rule cannot survive a copied template.
By the "recurrence, not pain" rule this has earned mechanical enforcement.

**One P0 was retracted** during merge review, in slice 2: `lock_block_coverage` is not
`anon`-executable (`anon=false`, HTTP 401, target row unmutated). The probe's identity was
assumed rather than established. Recorded here because a QA register that hides its own false
positives cannot be calibrated.

## Merge review, 2026-07-26 (batch A, slices 3 to 6)

Raw per-slice totals were 14 P0 and 13 P1. After merging, **12 P0 and 13 P1**, because three
P0s are one defect seen from three journeys.

### The merged P0: the seat-write surface is anon-executable

All three slices independently proved anon writes on their own journey. Confirmed against the
live catalog during merge review, with the negative control asserted in the same query:

```
drop_shift accept_swap apply_permanent_swap expire_pending_swaps admin_assign_worker
claim_break_blocks force_trigger_float acknowledge_float decline_float
process_no_ack_float process_float_lookup_assignment reopen_float_source_seats
reconcile_float_source_release snapshot_float_ack_reminders
enforce_float_assignment_assignment_ids open_break_claim_calendar close_break_claim_pool
                                                            all anon=true, all SECURITY DEFINER

permanent_drop_slot  permanent_pickup_slot  lock_block_coverage        anon=false
```

**Root cause is one bad idiom, not N mistakes.** Every REVOKE on these functions is
`FROM PUBLIC`, which `supabase/AGENTS.md` documents as a no-op against the per-role grants
Supabase issues at CREATE time. `drop_shift` was "revoked" four times (`20260528000009:112`,
`20260528000020:106`, `20260611000001:135`, `20260623000005:120`) and every one was a no-op.
`20260724000006` is the only migration that named `anon` and `authenticated` explicitly, and
it is the only reason the two permanent-ops functions read false above.

**This supersedes the standing ticket rather than duplicating it.** The prior ticket names four
functions. The real scope is the entire seat-write and float surface, including two destructive
break functions (`open_break_claim_calendar` mass-vacates a house's claimed break shifts).

### The local stack was partially migrated, so some runtime evidence is provisional

Discovered when the breaks agent declined to measure the leftovers leg against a view it could
not trust. Verified during merge review: the CLI ledger stops at `20260724000002`, but later
objects are live, applied out of order and outside the ledger.

| Object                                                                 | From           | Live   | Discriminator used                                       |
| ---------------------------------------------------------------------- | -------------- | ------ | -------------------------------------------------------- |
| `claim_open_shift` per-block seat pick                                 | 20260724000003 | yes    | `SKIP LOCKED` in `prosrc`                                |
| `permanent_*_slot` anon revoked                                        | 20260724000006 | yes    | `has_function_privilege('anon', ...)`                    |
| `drop_shift` / `accept_swap` / `apply_permanent_swap` compare-and-swap | 20260726000009 | yes    | `GET DIAGNOSTICS` + `ORDER BY assignment_id` in `prosrc` |
| `shift_block_assignments_one_seat_per_worker`                          | 20260726000010 | yes    | `pg_indexes`                                             |
| `lock_block_coverage` returns boolean                                  | 20260726000011 | yes    | `pg_get_function_result`                                 |
| `worker_open_shifts` horizon bound                                     | 20260726000001 | **no** | `definition ~ '26 weeks\|6 weeks'`                       |

Consequence, narrower than it first appeared: the seat-write and float bodies ARE the shipped
ones, so the drop/swap and float runtime evidence stands, including the race-harness run in the
drop/swap report's Verified clean. Only `worker_open_shifts` is stale, which is exactly the one
surface the breaks agent declined to measure.

**A caution for the next pass, learned here.** Two of the three discriminators used in the first
merge-review probe were wrong and produced a false "not applied" verdict for `20260726000009`:
`SKIP LOCKED` is absent from those functions by design (they lock named `assignment_id`s rather
than picking seats), and `horizon` appears only in `20260726000001`'s comments, which
`pg_views.definition` strips. Choose a discriminator that the migration's SQL body must contain,
then confirm the migration file actually contains it before trusting a negative.

The anon-grant finding is unaffected either way, and in fact `20260726000009` being live is what
makes it current: it re-creates all three functions (lines 41, 166, 395) with no REVOKE of its own.

The breaks agent's decision to drop a half-finding rather than file it against a stale view is
the behavior this register wants to reward. It cost coverage and bought credibility.

### Accepted risk challenged

The float slice challenged "force-trigger does not set the coverage lock marker" on the
grounds that force-trigger is **not** dormant: a live "Get coverage now" control ships on
Android (`house_force_trigger`) and iOS (`HouseGridView.swift:93`). If that holds, the entry's
own "revisit when" condition has fired and it converts to a live P1. Not yet adjudicated.

## Merge review, 2026-07-26 (batch B, slices 7 to 9)

Raw per-slice totals were 14 P0 and 17 P1. After merging, **12 P0 and 16 P1**, because two
defects were each found by two journeys.

### Merged P0 A: `user_is_schedule_admin` excludes `sm`, on three tables

Slice 9 found it on `draft_block_assignments` (an SM's draft DELETE matches zero rows, the
action returns `{ok:true}`, and publish then materialises the shifts the SM deleted). Slice 8
found the same substitution on `preferences` and `period_targets`, and filed it as a spec
contradiction between `AGENTS.md:358` and `AGENTS.md:515`. One migration,
`20260627000002_cross_house_schedule_admin.sql`, replaced house-keyed policies with a bare
`user_is_schedule_admin` call on all three tables.

Confirmed against the live catalog during merge review, which showed a scope larger than
either slice could see alone:

```
user_is_schedule_admin body:  role IN ('hm', 'bm', 'rsm', 'admin')        'sm' absent
12 policies gated by it, across draft_block_assignments, period_targets, preferences
```

`period_targets` is a third affected table that neither slice was scoped to. The policy names
are the tell: `house schedule-builders can insert drafts` and
`house admins can update house preferences` both name a role the predicate does not admit.
Two journeys reaching this from different directions raises the blast radius, so slice 8's P1
is absorbed into slice 9's P0 rather than kept as its own ticket.

### Merged P0 B: four more write functions are anon-executable and trust a caller-supplied actor

Slice 8 proved it for `submit_preferences` (overwrite any worker's preferences, set
`opted_out` for a whole period) and `set_preference_deadline` (move or close the global
deadline by naming any manager's uuid). Slice 9 proved it for `publish_schedule` (any signed-in
`sw` publishes any house, authority taken from `p_published_by`) and
`apply_compiled_season_unguarded`.

**Same idiom as the batch A merged P0, and none of these four are in its enumerated list**, so
this widens that ticket rather than duplicating it. Every REVOKE involved is `FROM PUBLIC`,
which `supabase/AGENTS.md` documents as a no-op against Supabase's per-role CREATE-time grants.
`submit_preferences` adds a second, independent hole: its guard is

```
IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN RAISE EXCEPTION
```

which is false when `auth.uid()` is NULL, so anon passes straight through to the write.

Confirmed during merge review with the negative controls asserted in the same query:

```
submit_preferences  set_preference_deadline  publish_schedule
apply_compiled_season_unguarded  admin_assign_worker  admin_remove_worker
admin_override_cap_assessment                                    all anon=true, all SECURITY DEFINER

apply_compiled_season  permanent_drop_slot  permanent_pickup_slot        anon=false
admin_submit_preferences  admin_seed_preferences                         anon=false
```

The `apply_compiled_season` / `apply_compiled_season_unguarded` pair demonstrates the rename
trap that `supabase/AGENTS.md:31` documents: the guarded wrapper is locked while the unguarded
body it delegates to is open, because `20260726000007:91-100` renamed the function and the
grants followed the body. The four `anon=false` rows are the negative control, and they are
what makes the true readings measurements rather than assumptions.

### The em-dash and grant-template classes have both now recurred enough for enforcement

All three slices found user-visible em or en dashes: `DeadlineEditor.tsx:20,23,87`,
`ScheduleBuilder.tsx:616,930`, `override.ts:48`, `WidgetStyle.swift:65` (an en dash in every
iOS widget time range), and `BEHAVIORAL_SPECIFICATION.md:394`. Left at P2 and P3 in the
per-slice reports rather than consolidated, because they are separate files. This is the one
class in batch B with no mechanical guard, and by the same "recurrence, not pain" rule that
produced `scripts/hooks/anon-grant-guard.js`, three independent slices finding it is the
argument for a lint check.

The GRANT-template class, by contrast, is already enforced and needs no new action. Slice 7
noted that `20260611000001:206` still carries a commented `GRANT SELECT ... TO anon` line
covering `worker_my_shifts`, and filed it inside **Verified clean** rather than as a ticket.
Checked during merge review: `anon-grant-guard.js` builds its protected set by scanning every
migration for `REVOKE ... FROM anon`, and `20260711000001:25` revokes
`ALL ON worker_my_shifts FROM anon, PUBLIC`, so the view is in the protected set and a future
`CREATE OR REPLACE VIEW` that re-grants it is blocked at `Write`/`Edit` time. The hook is
registered at `.claude/settings.json:42`.

### Stale premises found, beyond the two we handed the agents

The instruction to distrust handed premises paid for itself. Falsified this batch:
`ARCHITECTURE.md:706-708` (publish vacant-seat accounting), `ARCHITECTURE.md:1601` and
`AGENTS.md:599` (preference board resolves house at period start; mobile uses
`users.home_house_id`), `AGENTS.md:547` (publish needs no summer special cases),
`AGENTS.md:602` (Harnwell training checked against the shift's date), BSpec 4.2, BSpec 5.2:517,
BSpec 5.6:609, and `AGENTS.md:358` against `AGENTS.md:515`.

Slice 7 also found the `Shifts.kt:336` pattern is not isolated: three more doc comments assert
a "date-unbounded" read that is in fact bounded (`Calendar.kt:134`, `CalendarViewModel.kt:63`,
`ShiftsScreenViewModel.kt:84`), and one of them sits over a P1 where the mobile calendar cannot
reach any week before last week.

### Two half-findings were dropped rather than softened, which is the behavior to reward

Slice 7 declined to file a web drop-toast claim because proving it required
`worker_open_shifts`, which batch A established is stale locally, and re-confirmed the staleness
itself. Slice 9 declined to run `apply_compiled_season` or a real publish against the shared
stack and marked the affected evidence `needs runtime check` instead. Both moved the finding to
**Not checked** rather than hedging it into a P2.

### No new accepted risks registered

Two candidates were considered and rejected. Slice 9's "publish emits no notification" is not
recorded as a decision in either spec, and slice 8's BSpec 4.2 contradiction (preferences
remain editable after the deadline) is spec drift with a false spec sentence, not a priced
tradeoff. Both are backlog items, and per the register's own rule, registering them would
silence the next person who finds them.

The batch A challenge to **Force-trigger does not set the coverage lock marker** remains
unadjudicated. Nothing in batch B bears on it.

## Notes on slicing

Slices 3 and 4 share a write path (a permanent drop and a permanent swap both rewrite
recurring assignments). Run them together or accept that they will file overlapping tickets.

Slice 15 exists because the other 14 are journeys, and a journey-shaped pass structurally
cannot see code no journey walks through. Cron paths, the orchestrator tick, and the no-ack
void fire on a timer with no user present, which means nobody notices when they are wrong.

## Re-running a slice

A `passed` slice is passed as of that date and that commit, not forever. Re-run when the
journey's write path changes. The commit guard (`scripts/hooks/ship-check-guard.js`) treats a
report as covering a change only when the report is newer than every staged file, so a stale
report stops clearing commits automatically.
