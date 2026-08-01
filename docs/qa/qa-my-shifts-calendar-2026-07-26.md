# Ship check: My Shifts and the personal calendar

Date: 2026-07-26
Slice: journey 7 (My Shifts and the personal calendar, mobile Android + iOS + web worker portal

- home-screen widgets + `worker_my_shifts` + the Desk Assistant's parallel resolver)

Runtime evidence was gathered against the local stack at
`postgresql://postgres:postgres@127.0.0.1:54322/postgres`. Every mutation used to prove a
finding ran inside a transaction that was rolled back in the same session, and the rollback was
asserted afterwards. No row was left changed. `app_now()` on this stack reads
`2026-07-25 17:59 UTC` against a wall clock of `2026-07-27 03:14 UTC`, so the simulated clock is
about 1.4 days behind; every date in this report is stated as the probe returned it.

Known and already ticketed, cited once and not re-filed: the `anon` SELECT grant on
`worker_open_shifts`; the `anon`-EXECUTE seat-write and float surface widened by the batch A
merge review; the 1000-row PostgREST truncation of the open-shifts feed; `fire_worker` setting
only `is_active`. None of them recur on this journey's read path: I confirmed
`has_table_privilege('anon','worker_my_shifts','SELECT') = false` and
`has_function_privilege('anon','assistant_my_shifts(uuid,date,date)','EXECUTE') = false` against
the live catalog.

---

### [P0] The Desk Assistant tells a worker they still hold a shift they dropped, and overstates their hours to match

**Journey**: A worker drops part of a shift, then asks the in-app Desk Assistant "what am I
working tomorrow" or "how many hours do I have this week" to double check.

**Trigger**:

1. Sign in as any SW holding a multi-block shift. Take Drew's Harnwell shift on 2026-06-03,
   12:00 to 16:00 NY (8 blocks).
2. Drop the last hour (15:00 to 16:00) from My Shifts. Both blocks become
   `status='vacant'`, `vacancy_origin='temporary_drop'`, `dropped_by_user_id=Drew`.
3. My Shifts now correctly shows a 12:00 to 15:00 card under Scheduled and a 15:00 to 16:00 card
   under "Dropped, still open".
4. Open the Assistant and ask about that day. The `get_my_shifts` tool answers with one span,
   12:00 to 16:00, 4.0 hours.

Proven on the live stack inside a rolled-back transaction. Before the drop and after the drop,
`assistant_my_shifts` returned byte-identical rows:

```
                    BEFORE                                        AFTER
Harnwell | 12:00 | 16:00 | scheduled | 8 blocks | 4.0h    Harnwell | 12:00 | 16:00 | scheduled | 8 blocks | 4.0h
```

while `worker_my_shifts` for the same worker and date correctly reported
`15:00 dropped_still_open=t`, `15:30 dropped_still_open=t`. Rollback asserted: 0 rows left
dropped.

**Observed**: Two independent defects compound in
`supabase/migrations/20260713000003_assistant_my_shifts_resolver.sql`.

1. The base CTE at line 55 selects from `worker_my_shifts` with **no
   `dropped_still_open = false` predicate** and never projects the column, so a dropped block is
   indistinguishable from a held one in the tool payload.
2. The island detection partitions on `(house_id, kind)` (line 66) and the final aggregate
   groups on `(house_id, house_name, kind, grp)` (line 92). A dropped block keeps
   `kind = 'scheduled'`, because the view's `CASE` maps every non-`claimed`, non-float status to
   `'scheduled'`
   (`supabase/migrations/20260611000001_dropped_still_open_read_model.sql:169-175`). So the
   dropped tail is _exactly adjacent_ to the held head and gets **merged into the same span**.
   The drop does not even show up as a separate row the model could reason about.

The Edge Function then strips nothing: `supabase/functions/da-ask/index.ts:412-419` maps only
`house`, `start`, `end`, `kind`, `hours`, `cross_house`, and the system prompt at line 431
instructs the model to "Never invent shifts or hours", so it faithfully reports the 4 hours the
tool handed it. The tool description at `supabase/functions/da-ask/index.ts:109-110` even
advertises that it returns "dropped-still-open" shifts, which makes this a known-but-unhandled
case rather than an oversight in one place.

**Expected**: The Assistant must agree with My Shifts, which is the surface the worker acted on.
Either exclude `dropped_still_open` rows entirely, or project the flag and split the island on
it so a dropped run is its own span the model can describe as dropped. BSpec 12 makes the
calendar the source of truth ("The shift calendar is the system's source of truth"), and BSpec
5.6 Tab 1 subsection 2 defines a dropped-still-open shift as something the worker has
"offloaded", not something they hold. The two answer paths to "what am I working" must not
disagree.

**Blast radius**: Every worker who drops any part of a shift and then asks the Assistant
anything about that day or that week. Drops are the single most common worker write in the
product ("Drops are always permitted", BSpec 5.2). The worker is told they are covering a desk
they have given up, and their hours figure is inflated by exactly the dropped amount, which also
misreports their position against the 20-hour soft cap.

**Fix sketch**: New migration replacing `assistant_my_shifts`. Add
`AND m.dropped_still_open = false` to the `base` CTE, or (preferred, since the Assistant should
be able to say "you dropped that") add `m.dropped_still_open` to `base`, include it in the
`PARTITION BY` and the `GROUP BY`, and add it to the `RETURNS TABLE`. Then surface it in
`supabase/functions/da-ask/index.ts:412-419` and extend the system prompt so a dropped span is
described as dropped and excluded from any hours total. Add a pgTAP case in the assistant test
file asserting that a worker with 8 held blocks and 2 dropped blocks gets 3.0 hours, not 4.0.

**Acceptance check**: pgTAP: seed a worker with a contiguous 8-block shift, drop the last 2 via
`drop_shift`, assert `assistant_my_shifts` returns a 3.0-hour held span (and, if the flag is
projected, one 1.0-hour dropped span) and never a single 4.0-hour span. Then ask the live
Assistant "how many hours do I have on <date>" and confirm the number matches the My Shifts
chip.

**Confidence**: verified in code and against the live database (rolled-back transaction, probe
identity printed as `postgres`, which is the same privilege level `da-ask` uses via
`service_role`; this is a data-correctness finding, not an authorization one).

---

### [P0] The web My Shifts hours chip counts shifts the worker dropped, so it contradicts the cards underneath it and the mobile app

**Journey**: A worker on the web portal drops a shift to get under their hours cap, then reads
the hours chip at the top of My Shifts to check where they now stand.

**Trigger**:

1. Sign in to the web worker portal and open `/home/shifts`.
2. Drop any shift (Manage, then Drop shift). The card moves into "Dropped, still open".
3. Read the chip under the week label. It still counts the dropped blocks.

Measured against live data for the current simulated week (2026-07-20), reproducing both
computations side by side in SQL:

```
worker            week        web chip   mobile chip   overstated by
Andrew Chelimo    2026-07-20    25.5h        23.0h         2.5h
```

The worker holds 23 hours. The web says 25.5. The 20-hour soft cap sits between the two numbers,
so the worker is also told they are 5.5 hours over cap when they are 3 over.

**Observed**: `apps/web/lib/data/worker/myShifts.ts:185`:

```ts
const weekHours = cards.reduce((sum, c) => sum + c.blockIds.length, 0) * 0.5;
```

`cards` is the full coalesced set, which is the same array `partitionMyShifts` splits into
`scheduled` / `pickedUp` / `dropped` on the line above (line 182). The `dropped` partition is
exactly the `dropped_still_open` rows, and they are summed in. The comment on line 184 asserts
the opposite of what the code does: "Held hours = every 30-minute block the worker is on this
week".

Both mobile view models carry the guard the web is missing, with a comment saying why:

- `apps/mobile/shared/src/commonMain/kotlin/com/pennhousing/shift/shared/viewmodel/ShiftsScreenViewModel.kt:120-121`
  ("dropped-still-open blocks no longer count")
- `apps/mobile/shared/src/commonMain/kotlin/com/pennhousing/shift/shared/viewmodel/CalendarViewModel.kt:132-134`
- and the shared `weeklyHours` in
  `apps/mobile/shared/src/commonMain/kotlin/com/pennhousing/shift/shared/shifts/Shifts.kt:308-317`

so this is a one-sided drift in a rule that exists twice, which the sweep's cross-platform row
predicts will be silent.

The chip is rendered at `apps/web/components/worker/MyShifts.tsx:313-315` with
`data-testid="myshifts-week-hours"`.

**Expected**: The hours chip must equal the sum of the cards the worker actually holds, which is
`scheduled` plus `pickedUp`. A dropped-still-open shift is not held: BSpec 5.6 Tab 1 subsection 2
defines the section as "Shifts the SW has personally dropped this week that are still open", and
the same spec text is why the mobile filter exists. A confidently wrong hours total on the
surface a worker uses to manage their cap is a false statement about their own schedule.

**Blast radius**: Every web-portal worker who has dropped anything in the shown week. The error
is always an overstatement, sized to the drop, so it is largest exactly when the worker dropped
the most and cares most about the number.

**Fix sketch**: In `apps/web/lib/data/worker/myShifts.ts`, compute `weekHours` from
`[...scheduled, ...pickedUp]` rather than `cards`, or filter `!c.droppedStillOpen`. Better: move
the computation into `packages/core/src/worker-shifts/index.ts` as an exported
`heldWeekHours(cards)` so the Kotlin and TypeScript sides stop being two independent
implementations of one rule, and add it to the mirrored-rule list in `apps/mobile/AGENTS.md`.

**Acceptance check**: Vitest in `packages/core/tests/worker-shifts/`: a card set of 6 held blocks
plus 4 dropped blocks yields 3h, not 5h. Playwright: sign in, drop a 2-hour shift, assert
`myshifts-week-hours` decreases by exactly 2h and equals the sum of the durations rendered in
`section_scheduled` plus `section_picked_up`.

**Confidence**: verified in code and against the live database.

---

### [P0] The Android home-screen widget can tell a worker their shift is tomorrow on the morning it actually happens

**Journey**: A worker adds the Upcoming shifts widget to their home screen so they can see what
they are working without opening the app, which is the widget's stated purpose (BSpec 20.3: "an
upcoming shifts widget showing what is next without opening the app").

**Trigger**:

1. On Android, add the Upcoming shifts widget.
2. Open the app on Tuesday. The widget snapshot is written with the row
   `Harnwell / "Tomorrow" / "9:00 to 1:00 PM"` for the Wednesday shift.
3. Do not open the app again.
4. On Wednesday morning, glance at the widget. It still reads **"Tomorrow, 9:00 to 1:00 PM"**.
   The worker concludes they are not working today and does not go in.

The same applies to the float banner: a float landing Wednesday is labelled "Tomorrow" and stays
that way through Wednesday, past its acknowledgement deadline.

**Observed**: The Android widget stores **pre-formatted display strings**, including the relative
day label, and never recomputes them.

- `apps/mobile/androidApp/src/main/java/com/pennhousing/shift/widget/WidgetSync.kt:123-130`
  builds each row with `dayLabel(startMs, nowMs)`, where `nowMs` is the write-time clock.
- `WidgetSync.kt:148-157` is that label: `"Today"` / `"Tomorrow"` / `"EEE, MMM d"`, resolved once.
- `WidgetSync.kt:109-121` serialises the resulting `{house, day, time}` strings into
  SharedPreferences.
- `ShiftWidget.kt:46-47` reads the snapshot and
  `ShiftWidget.kt:95-103` renders `"${row.dayLabel}, ${row.timeLabel}"` verbatim. There is no
  clock in the widget process and no `end >= now` filter at render time, so an **already-finished
  shift also stays on the tile**.

`android:updatePeriodMillis="1800000"` in
`apps/mobile/androidApp/src/main/res/xml/shift_widget_info.xml` does fire `APPWIDGET_UPDATE`
every 30 minutes, but that only re-renders the same frozen strings, so it does not help.

The only writer is the app foreground:
`apps/mobile/androidApp/src/main/java/com/pennhousing/shift/MainActivity.kt:419-421`
(`LaunchedEffect`) and line 181 on the demo path. There is no `WorkManager`, no `AlarmManager`,
and `push/AppFirebaseMessagingService.kt` does not touch the widget, so nothing corrects the
label until the worker next opens the app. That is the exact condition under which the widget is
supposed to be useful.

iOS is the reference and is correct: `apps/mobile/iosApp/iosApp/WidgetSync.swift:26-28` stores
raw `start` / `end` `Date`s, `UpcomingShiftsWidget.swift:57-61` filters `$0.end > now` and
recomputes `WidgetFormat.dayLabel(s.start, now: now)` at render, and
`UpcomingShiftsWidget.swift:25-33` schedules a 30-minute timeline refresh whose stated purpose is
to "keep the relative Today/weekday labels honest if the app stays closed".

**Expected**: The Android widget must store instants and format at render time, exactly as iOS
does. BSpec 20.3 permits a widget to "briefly lag the app" as a snapshot of _content_; it does
not license the widget to make a _relative time claim_ that has since become false, and neither
BSpec 20.3 nor ARCHITECTURE 18 bounds the staleness of a baked label. Nothing in
`docs/qa/ACCEPTED-RISKS.md` covers this.

**Blast radius**: Every Android worker with the widget installed who does not open the app
between two calendar days, which is the normal case for a worker who added the widget precisely
so they would not have to. The failure mode is a missed shift: lost paid hours for the worker and
an empty desk, which is the canonical harm this product exists to prevent. It is also
directional: a stale label always makes a shift look _later_ than it is, never earlier, so it
never produces a harmless early arrival.

**Fix sketch**: Change `WidgetSnapshot` in
`apps/mobile/androidApp/src/main/java/com/pennhousing/shift/widget/WidgetSync.kt` to carry epoch
millis for `start` / `end` (and the float's `start`) instead of `dayLabel` / `timeLabel` strings.
Move `dayLabel` / `timeRange` into the Glance composable in `ShiftWidget.kt` so they run against
the render clock, and add the `end >= now` filter there rather than in `WidgetSync.update`. Keep
the write-side `!droppedStillOpen` filter. Since `updatePeriodMillis` is already 30 minutes, no
new scheduling is needed.

**Acceptance check**: Robolectric or a plain JVM test over the new snapshot type: write a
snapshot at `T`, render at `T + 26h`, and assert the row that read "Tomorrow" now reads "Today"
and that a row whose `end < now` is absent. Manual: place the widget, open the app, advance the
device date one day without reopening the app, and confirm the label moves.

**Confidence**: verified in code. The write path, the storage format, the render path and the
complete set of writers were each read end to end. Observing it on a physical home screen needs a
device and is the acceptance check above.

---

### [P1] The personal calendar cannot show any week before last week, and tells the worker they had the day off

**Journey**: A worker checking their hours against a paycheck taps back through the personal
calendar to see what they worked two and three weeks ago.

**Trigger**:

1. Open the app, go to My Shifts (the personal calendar).
2. Tap the `<` chevron in the bottom week bar twice. The header reads "2 weeks ago" with that
   week's correct date range.
3. Every day shows "No shifts this day" / "Enjoy the day off, or browse Open Shifts to pick one
   up." The week strip shows no dots. The hours chip reads "2 weeks ago 0h of 20h soft cap".

Measured on the live stack. With `app_now() = 2026-07-25`, the fetch window starts
**2026-07-13** (Monday of that week minus 7 days), so the week of 2026-07-06 is never fetched.
Blocks that exist in that week and are therefore invisible:

```
worker            blocks in week 2026-07-06   blocks in week 2026-07-13
Purity                      61                          61
Ornella                     49                          49
Drew                        48                          48
Lealem                      48                          48
Abraham                     48                          48
Andrew Chelimo              46                          46
```

Drew worked 24 hours in the week the calendar reports as empty.

**Observed**: The read is bounded below at Monday minus one week and the navigation is not
bounded at all.

- `apps/mobile/shared/src/commonMain/kotlin/com/pennhousing/shift/shared/data/WorkerShiftsRepository.kt:752-756`
  (`navigableWindowStart`) and `:786-789` (`gte("start_at", windowStart)`) fix the window at
  Monday(now) minus 7 days.
- `apps/mobile/shared/src/commonMain/kotlin/com/pennhousing/shift/shared/viewmodel/CalendarViewModel.kt:237-239`
  (`previousWeek()` / `nextWeek()`) decrement and increment `weekOffset` with no floor or ceiling.
- `apps/mobile/androidApp/src/main/java/com/pennhousing/shift/ui/calendar/CalendarScreen.kt:255-261`
  wires the chevrons straight to them;
  `apps/mobile/androidApp/src/main/java/com/pennhousing/shift/ui/calendar/WeekNavigation.kt:64-79`
  renders the `<` unconditionally. iOS does the same at
  `apps/mobile/iosApp/iosApp/ContentView.swift:3228` and `:3249`.
- The empty state that gets shown is
  `apps/mobile/androidApp/src/main/java/com/pennhousing/shift/ui/calendar/CalendarScreen.kt:231-236`.
- `apps/mobile/shared/src/commonMain/kotlin/com/pennhousing/shift/shared/calendar/Calendar.kt:398-401`
  (`weekPickerOptions`, offsets `-1..3`) is the only surface that respects the window, so a worker
  who uses the picker sheet never hits this and a worker who uses the arrows always can.

The seam assumption is written down and is false, in **three** places:

- `apps/mobile/shared/src/commonMain/kotlin/com/pennhousing/shift/shared/calendar/Calendar.kt:134-135`
  "The underlying `worker_my_shifts` read is date-unbounded, so other weeks' shifts are already
  in the snapshot."
- `apps/mobile/shared/src/commonMain/kotlin/com/pennhousing/shift/shared/viewmodel/CalendarViewModel.kt:63-64`
  the same claim.
- `apps/mobile/shared/src/commonMain/kotlin/com/pennhousing/shift/shared/viewmodel/ShiftsScreenViewModel.kt:84-85`
  the same claim.

This is the same shape as the already-known false claim at
`.../shifts/Shifts.kt:330-336` about the open-shift read, and these three are separate instances
of it on the My-Shifts read.

The web portal does **not** have this bug: `apps/web/lib/data/worker/myShifts.ts:156-166` queries
`gte(start)` and `lt(end)` for the exact requested week, so `/home/shifts?w=-5` returns real rows.
So the two platforms disagree about how far back a worker can look.

**Expected**: BSpec 12 states plainly: "The calendar is queryable retrospectively. Workers, SMs,
and HMs can scroll backward and view past dates to see who was scheduled to work specific blocks
on past days." Either the mobile read must widen with the requested week (the web pattern), or the
`<` chevron must be disabled at the window edge, and it must never present an unfetched week as a
day off. Silently rendering "Enjoy the day off" for a week the worker actually worked is a false
statement about their own schedule.

**Blast radius**: Every mobile worker who taps back twice, on either platform. This is the exact
gesture a worker makes to reconcile a paycheck, and the answer they get sends them to a manager
to dispute hours that are in fact correct.

**Fix sketch**: Two changes. (1) In `WorkerShiftsRepository`, key the fetch to the shown week
rather than a fixed window: add an `anchor: Instant` parameter and bound `start_at` with
`gte(weekStart)` and `lte(weekEnd)` on `end_at`, the same different-column trick
`fetchHouseScheduleForWeek` already uses at `WorkerShiftsRepository.kt:519-532` (a second filter
on the same column is dropped by supabase-kt). That also removes the 1000-row exposure entirely.
Or (2), the cheap version: clamp `previousWeek()` at the window edge in `CalendarViewModel` and
`ShiftsScreenViewModel` and pass a `canGoBack` flag so `WeekNavigation.WeekNavBar` hides the `<`.
Either way, correct the three doc comments listed above, because they are what will make the next
person reintroduce this.

**Acceptance check**: kotlin.test on `CalendarViewModel`: with a snapshot whose earliest shift is
in week `-1`, `previousWeek()` twice must either fetch week `-3` or leave `weekOffset` at the
floor, never produce an empty agenda for a week the worker worked. Manual against the live stack:
sign in as Drew, tap `<` twice, and assert 48 blocks render for the week of 2026-07-06.

**Confidence**: verified in code and against the live database (window start and per-week block
counts measured).

---

### [P1] A worker who permanently picked up a recurring slot cannot permanently drop it, and it is filed as a one-week pickup forever

**Journey**: A worker takes over a permanently-dropped recurring slot ("pick up permanently",
BSpec 8.4), works it for a month, then wants to give it back for the rest of the semester.

**Trigger**:

1. As an SW, permanently pick up a slot from the permanent openings feed. `permanent_pickup_slot`
   writes each occurrence as `status='claimed'`, `vacancy_origin='none'` (live `prosrc`, lines
   75-89 of the function body).
2. Open My Shifts. Every occurrence shows under **Picked up**, tagged "Picked up", not under
   "Their shifts".
3. Open the manage sheet for one of them. On the web there is no "Every future week (give up the
   slot)" radio at all. On mobile the permanent-drop option is absent.
4. The only route left is dropping one occurrence per week, for every remaining week of the
   semester.

**Observed**: `worker_my_shifts.kind` has no `permanent_pickup` value. The `CASE` at
`supabase/migrations/20260611000001_dropped_still_open_read_model.sql:169-175` maps
`status='claimed'` to `'temp_pickup'` and everything else to `'scheduled'`, and
`permanent_pickup_slot` sets `status='claimed'`. So a permanent pickup is wire-indistinguishable
from a one-week claim.

Every consumer that was written to handle the distinction therefore dead-ends:

- `apps/mobile/shared/src/commonMain/kotlin/com/pennhousing/shift/shared/data/WorkerShiftsRepository.kt:1409-1415`
  has a `"permanent_pickup" -> AssignmentKind.PERMANENT_PICKUP` branch that the server never
  triggers.
- `apps/mobile/shared/src/commonMain/kotlin/com/pennhousing/shift/shared/shifts/Shifts.kt:253-259`:
  `canDropPermanently = (kind == SCHEDULED || kind == PERMANENT_PICKUP) && !breakProfile`. With
  `kind = TEMP_PICKUP` this is false, so the permanent-drop option never appears.
- `apps/web/lib/data/worker/myShifts.ts:139`:
  `slot: card.kind === 'scheduled' && !card.droppedStillOpen ? permanentSlot(card) : null`, and
  `apps/web/components/worker/MyShifts.tsx:141` `canPermanent = card.slot !== null`. Same block on
  web.
- `apps/mobile/shared/src/commonMain/kotlin/com/pennhousing/shift/shared/calendar/Calendar.kt:441`
  filters `buildTypicalWeek` to `kind == AssignmentKind.SCHEDULED`, so the "Recurring template"
  view omits a recurring slot the worker holds every single week.
- Section placement: `Shifts.kt:44-54` (`classifyMyShift`) sends `TEMP_PICKUP` to `PICKED_UP`, and
  `packages/core/src/worker-shifts/index.ts:85-91` does the same on web.

The doc comment at `Shifts.kt:44-48` says the classifier sends "SCHEDULED / PERMANENT_PICKUP /
FLOAT_OUT" to `SCHEDULED`. That is a second false claim in this file, alongside the already-known
one at line 336: the branch is unreachable, and the real behaviour is the opposite of what it
describes.

**Expected**: BSpec 5.6 Tab 1 subsection 3 is explicit: "**Their shifts** (bottom): The SW's
regularly scheduled shifts for the week, assignments from the SM-built schedule **and
permanently-picked-up recurring slots**, that are neither pickups nor personal drops." Subsection
1 scopes "Picked-up shifts" to "Shifts the SW has voluntarily claimed **this week**". A permanent
pickup belongs in Their shifts. BSpec 13 grants an SW the right to "Permanently drop a recurring
slot (or a contiguous portion of it) for the remainder of the current operating profile", and that
right must not depend on how they acquired the slot.

**Blast radius**: Every worker who uses permanent pickup, which BSpec 5.1 describes as the whole
reason the permanent openings feed exists ("so that workers can claim the entire remaining
recurrence in one action rather than picking it up week-by-week"). Giving the slot back is
asymmetric: acquiring it is one action, releasing it is N. A worker whose availability changes
mid-semester has to either drop 10-plus occurrences by hand or ask an SM to remove them, which is
the P1 definition (stuck, needs a manager).

**Fix sketch**: New migration that adds a durable marker for a permanent pickup and surfaces it as
a new `kind`. The cheapest true signal available today is a boolean column on
`shift_block_assignments` (for example `is_permanent_pickup`) set by `permanent_pickup_slot`
alongside `status='claimed'`, then a `CREATE OR REPLACE VIEW worker_my_shifts` whose `CASE`
emits `'permanent_pickup'` when it is set. `parseAssignmentKind` already handles the value, so
mobile needs no client change beyond confirming `dropOptionsFor`. On web, widen
`MyShiftKind` in `packages/core/src/worker-shifts/index.ts:26`, add `permanent_pickup` to the
allow-list at `apps/web/lib/data/worker/myShifts.ts:174`, route it to `scheduled` in
`classifyMyShift`, and compute `slot` for it in `toView`. Re-grant nothing: the view's grants are
unchanged by `CREATE OR REPLACE`, but verify `anon` is still absent afterwards, because that is
how the `worker_open_shifts` grant kept coming back.

**Acceptance check**: pgTAP: run `permanent_pickup_slot` for a worker, then assert
`worker_my_shifts.kind = 'permanent_pickup'` for every assigned occurrence. kotlin.test:
`dropOptionsFor` on a `PERMANENT_PICKUP` shift returns `canDropPermanently = true`, and
`buildTypicalWeek` includes it. Vitest: `partitionMyShifts` puts a `permanent_pickup` card in
`scheduled`, and `toView` gives it a non-null `slot`. Manual: permanently pick up a slot, then
permanently drop it in one action from both clients.

**Confidence**: verified in code (client paths read end to end, `permanent_pickup_slot` body read
from the live catalog).

---

### [P1] Both specs promise a one-tap reclaim of a dropped shift; neither platform ships it, and the web tells the worker the opposite

**Journey**: A worker drops a 4-hour shift, then changes their mind ten minutes later and wants
it back.

**Trigger**:

1. On the web, open `/home/shifts`, click Manage on a shift, and read the confirmation text
   before dropping. It says: "Dropping returns the shift to the open feed for someone else to pick
   up. **You cannot reclaim it yourself.**"
2. Drop it. The card moves to "Dropped, still open" and has no Manage button, so there is no
   action on it.
3. On mobile, drop a shift from the personal calendar. The card simply disappears. There is no
   "Dropped, still open" surface anywhere in the app to find it in.
4. In fact the shift _is_ reclaimable: it sits in the worker's own Open Shifts feed and
   `claim_open_shift` has no exclusion for the original dropper.

**Observed**: Three layers disagree.

The specs guarantee it:

- `BEHAVIORAL_SPECIFICATION.md:517` (5.2): "A worker who has dropped a shift may reclaim it
  themselves, provided no other worker has claimed it in the interim."
- `BEHAVIORAL_SPECIFICATION.md:609` (5.6 Tab 1 subsection 2): the dropped section "helps the SW
  track what they've offloaded and **offers a one-tap path to reclaim** if they change their
  mind."

The database allows it: I searched the live `claim_open_shift` body for any reference to
`dropped_by_user_id` or a dropper exclusion and found none. `worker_open_shifts` cross-joins every
eligible candidate with no self-exclusion, so the dropped block appears in the dropper's own feed.

The clients removed it:

- Web: `apps/web/components/worker/MyShifts.tsx:242` is the false sentence.
  `apps/web/components/worker/MyShifts.tsx:30-36` (`isDroppable`) returns false for a
  `droppedStillOpen` card, so no control is rendered on it at all.
- Mobile: `apps/mobile/shared/src/commonMain/kotlin/com/pennhousing/shift/shared/calendar/Calendar.kt:252-257`
  filters dropped cards out of the agenda and `:169` keeps them off the week strip;
  `apps/mobile/shared/src/commonMain/kotlin/com/pennhousing/shift/shared/viewmodel/CalendarViewModel.kt:194-196`
  states the decision ("there is no reclaim, re-picking it up is a normal claim from the open
  feed"). No My-Shifts dropped section survives on mobile at all (see the P2 below).
- The server-side reclaim call still exists and is wired to nothing:
  `apps/mobile/shared/src/commonMain/kotlin/com/pennhousing/shift/shared/data/WorkerShiftsRepository.kt:269`
  (`reclaimShift`) has zero call sites in `androidApp/` or `iosApp/`, and
  `ShiftsScreenViewModel.reclaim` at `:274-277` is likewise never invoked from UI.

**Expected**: Either the reclaim path ships (the specs' position), or both specs are corrected in
the same change and the web copy is made true. What must not stand is user-facing copy that
denies a capability the system has, shown at the exact moment the worker is deciding whether to
give up paid hours. Per the repo's own rule, a spec sentence that is now false is a P1 because
someone will act on it, and here the person acting on it is the worker.

**Blast radius**: Every worker who hesitates over a drop. The copy makes the drop feel
irreversible, so a worker who drops and immediately regrets it believes 4 paid hours are gone and
does not go looking in Open Shifts. Meanwhile another worker takes them, at which point it really
is irreversible. On mobile the harm is different and slightly worse: after dropping, the worker
has no surface at all that says what they dropped or whether anyone took it, which is the exact
tracking function BSpec 5.6 assigns to that section.

**Fix sketch**: Product decision first, because the mobile removal looks deliberate. If reclaim
stays supported: change `apps/web/components/worker/MyShifts.tsx:242` to say the shift returns to
the open feed and can be claimed back from Open shifts until someone else takes it, and add a
Reclaim control on dropped cards that calls a new `reclaimShift` server action (the web analogue
of `WorkerShiftsRepository.claimBlocks`, one POST per `blockId` with the partial-outcome tally).
On mobile, restore a dropped surface or add a "Dropped, still open" strip to the personal
calendar and wire the existing `reclaimShift`. If reclaim is deliberately gone: delete the
sentence at `BEHAVIORAL_SPECIFICATION.md:517` and rewrite `:609`, remove the dead
`reclaimShift` / `reclaim` / `reclaimDroppedShift` paths, and register the removal so the next
pass does not re-file this.

**Acceptance check**: Playwright: drop a shift, then reclaim it from My Shifts (or from Open
shifts if that is the chosen route) and assert `worker_my_shifts` returns the same `assignment_id`
set for that worker again. Plus a docs check that no shipped string claims a capability the
product does not have.

**Confidence**: verified in code (specs, both clients, and the live `claim_open_shift` body).

---

### [P1] A seat another worker was removed from reappears in your "Dropped, still open" list and inflates the hours the Assistant reports

**Journey**: A worker drops a shift, someone else claims it, and later an admin removes that
person or fires them. The block comes back to the original dropper's schedule.

**Trigger**:

1. Purity drops a Harnwell block. `drop_shift` stamps
   `dropped_by_user_id = Purity`
   (`supabase/migrations/20260611000001_dropped_still_open_read_model.sql:122-131`).
2. Andrew claims it. `claim_open_shift` sets `status='claimed'`, `vacancy_origin='none'`,
   `user_id=Andrew`, and **leaves `dropped_by_user_id = Purity`**. Four such rows exist right now
   on the local stack:
   ```
   assignment_id                        | status  | vacancy_origin | current_holder  | stale_dropped_by
   ce78ca4f-a2ae-4aae-b035-b462a3f00362 | claimed | none           | Andrew Chelimo  | Purity
   948a5135-a7ed-4651-8f62-2875f85fb58b | claimed | none           | Andrew Chelimo  | Purity
   ca86b2d8-6ed9-412d-8be6-290451e36e75 | claimed | none           | Andrew Chelimo  | Purity
   fdbede10-a15a-407a-97ec-aa7ade3ecbd2 | claimed | none           | Andrew Chelimo  | Purity
   ```
3. An admin removes Andrew from that block for this week. `admin_remove_worker` (scope
   `this_week`) sets `status='vacant'`, `vacancy_origin='temporary_drop'`, `user_id=NULL` and does
   not touch `dropped_by_user_id`.
4. The block is now `vacant` + `temporary_drop` + `dropped_by_user_id = Purity`.

Proven on the live stack, inside a rolled-back transaction, applying step 3's write verbatim:

```
BEFORE: worker_my_shifts rows for Purity on that assignment ........ 0

AFTER:  shown_to | house_name | start_ny            | kind      | dropped_still_open
        Purity   | Harnwell   | 2026-07-24 22:00:00 | scheduled | t

AFTER:  assistant_my_shifts(Purity, 2026-07-24, 2026-07-24)
        Harnwell | 12:00 | 20:00 | scheduled | 8.0h
        Harnwell | 22:00 | 22:30 | scheduled | 0.5h   <-- did not exist before
```

Rollback asserted: the 4 stale rows are unchanged.

**Observed**: `dropped_by_user_id` is a write-once marker that nothing ever clears. Only
`drop_shift` (plus the two off-hours Allied ladder functions) ever writes it, per the live
catalog, while **six** functions set `status='vacant', vacancy_origin='temporary_drop'` without
touching it: `admin_remove_worker`, `fire_worker`, `decline_float`, `process_no_ack_float`,
`apply_house_transfer`, and `reopen_float_source_seats`. Any of them landing on a row that once
carried a different worker's drop resurrects that worker's claim on it.

The consumer is the second WHERE arm of the view,
`supabase/migrations/20260611000001_dropped_still_open_read_model.sql:196-199`:
`status='vacant' AND vacancy_origin='temporary_drop' AND dropped_by_user_id IS NOT NULL`, combined
with `user_id = COALESCE(sba.user_id, sba.dropped_by_user_id)` at `:164`. The RLS policy
`"users can select own dropped vacant assignments"` (`dropped_by_user_id = auth.uid()`, live
`pg_policy`) grants the stale dropper read access to it even at another house.

**Expected**: The dropper marker must describe the _current_ vacancy, not a historical one. Either
every write that re-fills a seat clears `dropped_by_user_id` (the correct place is
`claim_open_shift`, `claim_break_shift`, `claim_break_blocks`, `permanent_pickup_slot`,
`process_float_lookup_assignment`, `admin_assign_worker`), or the view's dropped arm additionally
requires `dropped_at` to be the most recent status change. A worker's own schedule must not
acquire rows from another worker's removal.

**Blast radius**: Any block that has been dropped once and re-filled, then vacated by an admin
action, a firing, a float decline, a no-ack void, a house transfer, or a float source reopen.
Every one of those is routine. The consequence lands on top of the two count defects above: the
phantom row inflates the web hours chip and the Assistant's hours for a worker who dropped
nothing that week, so those two tickets can misfire without the worker having taken any action at
all. Filed P1 rather than P0 because the error is always an over-count and the worker loses no
hours directly; what they lose is the ability to trust the number.

**Fix sketch**: New migration adding `dropped_by_user_id = NULL, dropped_at = NULL` to the
re-fill `UPDATE` in each of the six re-fill functions named above (they already set
`vacancy_origin='none'`, so this is the same statement). Belt and braces: add
`AND sba.dropped_at IS NOT NULL AND sba.dropped_at >= <last-vacate marker>` is not available
today, so prefer the clear-on-refill approach and add a pgTAP invariant that no row has
`status <> 'vacant'` together with a non-null `dropped_by_user_id`. That assertion would fail
today on the four rows above, which is the point.

**Acceptance check**: pgTAP: drop a block as A, claim it as B, run `admin_remove_worker` for B,
then assert `worker_my_shifts` returns zero rows for A on that `assignment_id` and that
`assistant_my_shifts` for A is unchanged from before the whole sequence. Plus the schema-wide
invariant test above.

**Confidence**: verified in code and against the live database (chain reproduced on real rows in a
rolled-back transaction).

---

### [P2] Mobile deleted the three My-Shifts subsections BSpec 5.6 specifies, and two agent docs still require the selectors it removed

**Journey**: Reading the spec, or a future agent reading `apps/mobile/AGENTS.md`, to learn what
My Shifts is.

**Trigger**: Open My Shifts on Android or iOS. It is a chronological agenda (week overview, day
drill-in, derived recurring template). There are no Picked up / Dropped / Their shifts sections.
Open `/home/shifts` on the web. It has exactly those three sections.

**Observed**:

- `BEHAVIORAL_SPECIFICATION.md:606-610` still specifies Tab 1 as "divided into three subsections
  from top to bottom" and names all three. It is accurate for web and false for both mobile
  platforms, which are the primary surface.
- `apps/mobile/maestro/01-view-my-shifts.yaml:3-5` records the removal ("the old
  picked-up/dropped/scheduled bucket tab was removed") and the flow was rewritten to assert
  `calendar_screen` / `week_total_chip` / `calendar_view_toggle` / `calendar_week_overview`
  instead. `apps/mobile/maestro/README.md` no longer mentions the three selectors.
- But `apps/mobile/AGENTS.md:99-102` still states as a load-bearing constraint that
  "`section_picked_up`, `section_dropped`, `section_scheduled` must always render, with an
  empty-state placeholder, so `01-view-my-shifts` passes when a section is empty", and cites
  `maestro/README.md` as the authority for it. `apps/mobile/design/DESIGN_TOKENS.md:200-203`
  repeats it and tells the reader to use `ShiftSection`, a component that no longer exists in
  `androidApp/` at all (the only surviving reference is the iOS gallery at
  `iosApp/iosApp/Kit/ShiftGallery.swift:60`).
- `buildMyShiftsTab` and `ShiftsUiState.myShifts`
  (`.../viewmodel/ShiftsScreenViewModel.kt:114`) are still computed on every snapshot and are
  rendered by neither client; the only consumer left is
  `apps/mobile/iosApp/iosApp/ContentView.swift:48`, feeding `inDisplayOrder()` to the widget.

**Expected**: Per the repo's own "Specs Are Ground Truth" rule, the behavior change should have
shipped with the spec edit. BSpec 5.6 Tab 1 needs rewriting to describe the two structures that
actually exist (chronological agenda on mobile, three sections on web) or the platforms need to be
reconciled. The two stale agent-doc constraints must be deleted, because they will make the next
agent "restore" containers whose Maestro flow no longer wants them. The mobile AGENTS.md note was
handed to this pass as fact; it is not.

**Blast radius**: No worker harm today. It is a correctness trap for the next change to this
screen, and it is why the reclaim surface silently vanished on mobile (see the P1 above).

**Fix sketch**: Rewrite `BEHAVIORAL_SPECIFICATION.md` 5.6 Tab 1 in the same commit as whatever
reconciles the two platforms. Delete `apps/mobile/AGENTS.md:99-102` constraint 1 and
`apps/mobile/design/DESIGN_TOKENS.md:200-203`'s section-container sentence, replacing them with
the selectors `01-view-my-shifts.yaml` actually asserts. Delete `buildMyShiftsTab` and
`ShiftsUiState.myShifts` if nothing but the widget needs them, and give the widget a purpose-built
projection instead.

**Confidence**: verified in code.

---

### [P2] On the Monday of a fall-back week, the web "next week" arrow shows the current week again

**Journey**: A worker on the web portal early on Monday morning taps the forward arrow on My
Shifts to see next week.

**Trigger**: Open `/home/shifts` when the NY time is between Monday 00:00 and 01:00 in a week
containing the November fall-back Sunday (Mon 2026-10-26 through Sun 2026-11-01; the transition is
2026-11-01 02:00 EDT to 01:00 EST). Click the `>` arrow once. The range label still reads
"Oct 26 to Nov 1". Click it again to reach Nov 2.

Proven by running the shipped `weekRange` in `packages/core`:

```
now                        = Mon, Oct 26, 2026, 00:30
weekRange(now,-1) start = Mon, Oct 19, 2026, 00:00
weekRange(now, 0) start = Mon, Oct 26, 2026, 00:00
weekRange(now, 1) start = Mon, Oct 26, 2026, 00:00   <-- same week as offset 0
weekRange(now, 2) start = Mon, Nov 2,  2026, 00:00
```

**Observed**: `packages/core/src/worker-shifts/index.ts:305-311`:

```ts
const shifted = new Date(now.getTime() + weekOffset * 7 * 24 * 60 * 60 * 1000);
const start = weekStart(shifted);
```

Adding a fixed 168 real hours moves the NY wall clock by 167 hours across a fall-back Sunday, so
`Monday 00:30 + 1 week` lands on the preceding Sunday 23:30 and `weekStart` snaps it back to the
same Monday. The symmetric case (a `-1` from Sunday 23:00 to 24:00 in a spring-forward week) has
the same shape.

The Kotlin equivalent guards against exactly this and says so:
`apps/mobile/shared/src/commonMain/kotlin/com/pennhousing/shift/shared/calendar/Calendar.kt:187-199`
(`shiftWeekAnchor`) does `LocalDate` arithmetic and reconstructs at noon local "so a DST-transition
midnight can never skew which week the result lands in (invariant #6)". The TypeScript port did not
carry the guard. This is another one-sided drift in a rule that exists twice.

The range label is derived from the same `start` / `end`, so it stays truthful about what is on
screen. Nothing false is asserted; the arrow just does not move. That is why this is P2 and not
P0.

**Expected**: `weekRange(now, n)` must always land in the week `n` calendar weeks from now.
AGENTS.md hard invariant 6 forbids wall-clock arithmetic across DST, and the Kotlin side shows the
intended pattern.

**Blast radius**: One hour per year per direction, on the web portal only. Cheap to fix and
cheaper to regression-test than to rediscover.

**Fix sketch**: In `packages/core/src/worker-shifts/index.ts`, compute the shifted anchor from the
week start rather than from `now`: `weekStart(now)` first, then add `weekOffset * 7` days and
re-normalise, or add the days in NY local calendar terms via `toZonedTime` / `fromZonedTime` and
anchor at noon, mirroring `shiftWeekAnchor`. Note that `weekRange` is also called at
`apps/web/lib/data/worker/openShifts.ts:193`, always with offset 0, so that call site is
unaffected.

**Acceptance check**: Vitest in `packages/core/tests/worker-shifts/`: for `now` at each hour of
Mon 2026-10-26 and Sun 2027-03-14 NY, assert `weekRange(now, n).start` differs from
`weekRange(now, 0).start` by exactly `n` calendar weeks for `n` in `-2..4`.

**Confidence**: verified in code and by executing the shipped function.

---

### [P2] The web hours chip is labelled "This week" no matter which week is shown

**Journey**: A worker on the web portal pages forward to next week to see how many hours they are
holding.

**Trigger**: Open `/home/shifts?w=2`. The range label reads the correct future range, and directly
beneath it the chip reads "This week - 12h".

**Observed**: `apps/web/components/worker/MyShifts.tsx:313-315` hardcodes the string:

```tsx
<span className="t-meta" data-testid="myshifts-week-hours">
  This week - {formatHours(board.weekHours)}
</span>
```

`board.weekOffset` is available on the same object (it is used two lines above to build the
prev/next hrefs) and is ignored. Mobile solved this and left a note saying why:
`apps/mobile/androidApp/src/main/java/com/pennhousing/shift/ui/common/ShiftChrome.kt:76-85`
("The label follows the shown week so the hours never read as 'this week' when the worker has
navigated forward/back") with the same mapping on iOS at
`apps/mobile/iosApp/iosApp/ContentView.swift:5214-5223`. Third one-sided drift in this slice.

**Expected**: The label must name the week the number describes. Both mobile platforms already
produce "This week" / "Next week" / "Last week" / "In N weeks" / "N weeks ago" from the offset.

**Blast radius**: Any web worker who navigates off the current week. The number itself is correct
for the shown week (modulo the dropped-hours P0 above); only the label misattributes it, so a
worker who reads the chip without reading the range above it thinks their current week is heavier
or lighter than it is.

**Fix sketch**: Extract the offset-to-label mapping into `packages/core/src/worker-shifts/` as a
shared `weekOffsetLabel(offset)` so web and the Kotlin mirror stop diverging, and use it at
`apps/web/components/worker/MyShifts.tsx:314`.

**Confidence**: verified in code.

---

### [P3] The iOS home-screen widget renders an en dash in every shift time range

**Journey**: Any iOS worker looking at the Upcoming shifts or Open shifts widget.

**Trigger**: Add either widget on iOS. Every row's time reads `4:00<U+2013>8:00 PM`: the separator is an en
dash (U+2013), not a hyphen.

**Observed**: `apps/mobile/iosApp/ShiftWidgets/WidgetStyle.swift:65`:

```swift
return "\(s)<U+2013>\(e)"   // the literal character in source is U+2013
```

The doc comment on line 59 writes the same en dash. It is the only instance of an em or en dash in
a user-facing string across this whole slice (I grepped `apps/mobile/iosApp/ShiftWidgets/`,
`apps/mobile/androidApp/.../widget/`, `apps/web/components/worker/MyShifts.tsx`,
`apps/web/lib/data/worker/myShifts.ts`, `apps/web/components/calendar/`,
`packages/core/src/worker-shifts/`, and the shared `shifts/` and `calendar/` packages; everything
else that matched was a code comment, which the rule exempts).

It is also a cross-platform divergence: the Android widget renders " to "
(`apps/mobile/androidApp/src/main/java/com/pennhousing/shift/widget/WidgetSync.kt:145`,
`"$start to ${...}"`) and the shared in-app formatter renders " - "
(`apps/mobile/shared/.../shifts/MyShiftPresentation.kt:62-66`), so the same shift reads three
different ways across the three surfaces.

**Expected**: AGENTS.md Conventions: "Any string a user can ever see ... must NOT contain an em
dash (U+2014) or en dash (U+2013) ... This applies to BOTH platforms (web + mobile)". `WidgetStyle.swift`
is a widget-target file, which is probably why it escaped the sweep that fixed the rest.

**Blast radius**: Cosmetic and consistent. Nothing is lost and nothing is blocked, which is why
this is P3 despite being a stated repo convention: the honest severity is polish.

**Fix sketch**: Change `WidgetStyle.swift:65` to `"\(s) to \(e)"` to match Android, and fix the
comment on line 59. Extend whatever grep guard enforces the dash rule to cover
`apps/mobile/iosApp/ShiftWidgets/` (this file being missed suggests the guard's path list stops at
`iosApp/iosApp/`).

**Confidence**: verified in code.

---

## Verified clean

Each of these was walked on this journey and I believe it is genuinely sound, with the guard named.

- **`worker_my_shifts` is not readable by `anon`.** Checked against the live catalog, not the
  migration text: `has_table_privilege('anon','worker_my_shifts','SELECT') = false`, and
  `relacl` is `{postgres=...,authenticated=...,service_role=...}` with no `anon=` entry. The guard
  is `supabase/migrations/20260711000001_revoke_anon_worker_reads.sql:25`, and unlike
  `worker_open_shifts` it has survived, because the two later migrations that touch this view
  (`20260611000001`, and `20260726000002`'s policy rewrite) re-grant only `anon, authenticated,
service_role`... which does in fact name `anon`. The reason it reads false today is that
  `20260611000001` predates the revoke and nothing has re-created the view since. **This is fragile
  for the same structural reason the open-shifts grant kept coming back:** the next
  `CREATE OR REPLACE VIEW worker_my_shifts` will carry the template `GRANT ... TO anon` on line 206
  of that migration and silently undo it. I am not filing it (the class is already ticketed) but any
  fix to this view must drop that grant line.
- **`assistant_my_shifts` is service-role only.** `has_function_privilege` is false for both `anon`
  and `authenticated`; `proacl` is `{postgres=X,service_role=X}`. The header comment at
  `supabase/migrations/20260713000003:17-23` explains the confused-deputy risk it is avoiding and
  the grant matches the comment. The `p_user_id` is bound server-side from the verified bearer token
  at `supabase/functions/da-ask/index.ts:407-411`, not from a model-supplied parameter.
- **Cross-worker schedule reads on this journey add no new leak.** `worker_my_shifts` is
  `security_invoker=true` (confirmed in `pg_class.reloptions`) and does not self-filter, so a worker
  can query `?user_id=eq.<coworker>`. The four OR-ed SELECT policies on
  `shift_block_assignments` (read from `pg_policy`) limit that to the caller's own rows anywhere plus
  any worker's rows at the caller's own home house, plus `user_is_rsm`. The own-house half is
  already deliberately public to authenticated workers through `house_schedule_grid_any` (the
  2026-06-23 cross-house ruling), so nothing is exposed here that the House tab does not already
  show by design. I looked for a cross-house leak specifically and did not find one.
- **Voided blocks self-exclude from the personal calendar.** `worker_my_shifts` has no
  `voided_at IS NULL` guard (confirmed: the live view definition does not mention `voided_at`), so I
  checked the void writer instead. `reconcile_config_blocks` flips occupied seats to
  `cancelled_config` and then runs `DELETE FROM shift_block_assignments WHERE block_id = ... AND
status = 'vacant'` before stamping `voided_at` (live `prosrc`). `cancelled_config` is outside the
  view's status list and the delete removes the dropped-still-open arm's rows too, so a voided block
  leaves the worker's calendar with no guard needed in the view. The AGENTS.md
  [Operating-seasons] claim that voiding is "self-excluding on every status-filtered read path"
  holds for this view.
- **A pending float does not double-count the worker's hours.** `process_float_lookup_assignment`
  sets the source seats to `pending_float_out` (live `prosrc`, the `UPDATE` at the end of the
  function) in the same transaction that creates the `pending_float_in` destination rows. The view's
  status list admits `pending_float_in` and excludes `pending_float_out` and `floated_out`
  (`20260611000001:194-196`), so the worker sees exactly one card for the window and the hours chip
  is net-zero, which is what hard invariant 4 requires.
- **The 1000-row PostgREST cap does not truncate the personal calendar on current data.** The mobile
  read is unbounded above (`WorkerShiftsRepository.kt:786-789`), so I measured it rather than
  assuming. From the live window start (2026-07-13), the heaviest worker returns 457 rows
  (Purity), the next 364, and no worker reaches the 1000-row cutoff at all; the furthest available
  block is 2026-09-06. The ascending order plus the window is doing its job here. This is a
  data-dependent clean, not a structural one: a worker at the 40h break cap for a full semester
  would reach 1000 rows in about 12 weeks, so the lower-bound fix proposed in the P1 above (bound
  both ends per shown week) is what makes it structurally safe.
- **Both platforms' week-boundary arithmetic in the shared Kotlin is DST-correct.** `mondayOf`
  (`Calendar.kt:94-100`) and `shiftWeekAnchor` (`:192-199`) both go through `LocalDate` and
  reconstruct at noon; `calendarWeekBounds` (`:218-228`) does the same. Contiguity in
  `coalesceMyShifts` compares instants (`Coalesce.kt:93-111`), never wall-clock fields. The
  block-start reconstruction for a permanent slot adds real durations and formats each block
  NY-local independently, on both platforms (`WorkerShiftsRepository.kt:1572-1595` and
  `apps/web/lib/data/worker/myShifts.ts:116-118`), so a span labelled across a DST transition is
  labelled correctly. The one exception is the TypeScript `weekRange`, filed as P2 above.
- **The `dropped_still_open` exclusions are consistent within mobile.** The agenda
  (`Calendar.kt:252-257`), the week strip dots (`:169`), the derived template (`:441`), the hours
  chips (`ShiftsScreenViewModel.kt:121`, `CalendarViewModel.kt:134`, `Shifts.kt:311`), and both
  widget write paths (`WidgetSync.kt:62` and `:82`, `WidgetSync.swift:25`) all filter it. Mobile is
  self-consistent; the web and the Assistant are the two places that are not, and both are ticketed.
- **The Assistant's date-range handling is bounded and validated.**
  `supabase/functions/da-ask/index.ts:399-406` rejects non-ISO input, forces `to >= from`, and caps
  the span at `MAX_SCHEDULE_WINDOW_DAYS = 62`, so a model-supplied range cannot make the resolver
  scan a semester. `addDays` at `:64-71` is UTC date-only arithmetic, which is DST-safe for calendar
  dates.

## Not checked

- **`apps/web/components/calendar/*` and `apps/web/app/(app)/calendar/page.tsx`.** Listed in the
  scoping for this slice, but that route is manager-gated: `apps/web/app/(app)/calendar/page.tsx:37-48`
  returns "Managers only" for anyone failing `canBuildSchedule`, and tells a worker their own shifts
  are on the Dashboard. A Student Worker cannot reach it, so it is not on this journey. It belongs
  to slice 11 (house grid, contact card, cross-house view). I read `format.ts` far enough to confirm
  its 24:00 handling is grid-origin arithmetic (`blockLabel`, lines 20-25) with per-card times
  derived from the real timestamp (`nyMinutesOfIso`, lines 35-48) rather than from the shared origin,
  and found nothing to file, but I did not walk `Grid.tsx`, `HouseCalendar.tsx`,
  `ShiftDetailPanel.tsx`, `ShiftInfoPopover.tsx`, `WeekPicker.tsx`, or `ShiftOverrideEditor.tsx`.
- **The web drop toast's claim that a dropped shift "is now in the open feed".** BSpec 5.2 says a
  drop more than 30 days out is "accepted and held" until the horizon, which would make
  `apps/web/components/worker/MyShifts.tsx:169` false for a far-future drop. Deciding that requires
  measuring `worker_open_shifts`, and the batch A merge review established that
  `20260726000001_open_shifts_horizon_bound.sql` is **not applied** on this stack (I re-confirmed:
  the live view definition contains no 6-week or 26-week bound, though it does contain a "30 days"
  reference). I will not measure a truthfulness claim against a view I have been told is stale, so
  this is left open rather than filed half-proven. It should be re-checked by whoever runs slice 2's
  re-run against a fully migrated stack.
- **Whether the Android widget staleness is observable on a real home screen.** The code path is
  closed (write-time formatting, single foreground writer, no background refresh, render-time
  passthrough), but I did not place the widget on a device and advance the clock. Per
  `AGENTS.md` Conventions, emulator verification in this repo is iOS-only, and iOS is the platform
  that is correct here, so the confirming run needs the user's Android setup. The acceptance check on
  that ticket is written to be runnable from the JVM host once the snapshot carries instants.
- **Realtime and staleness of the web portal after a mutation elsewhere.** Mobile has a Realtime
  subscription plus a manual refresh signal (`WorkerShiftsRepository.rawWorkerWeek`, lines 870-915).
  The web `/home/shifts` is a server component with `router.refresh()` only on the worker's own drop,
  so an admin edit or an inbound float never reaches an open tab. I did not file this: it is a
  property of every SSR page in the portal rather than a defect specific to this journey, and pricing
  it needs a product decision about whether the web portal is expected to be live.
- **The simulated clock's interaction with this journey.** `worker_my_shifts` contains no clock
  reference at all, so the view is sim-clock-independent, and both clients pass the business `now`
  into their window computation (`WorkerShiftsRepository.fetchWorkerWeek`'s `now` parameter, and
  `simNow()` at `apps/web/app/(worker)/home/shifts/page.tsx:20`). I did not exercise
  `20260726000008_time_travel_environment_gate.sql` or move the offset, because the stack is shared
  with another agent running slices 8 and 9 and moving the clock would corrupt their fixtures.
- **`packages/core/src/worker-shifts/index.ts` `myShiftsInWeek`.** Exported and tested but not called
  from `apps/web`; the web week-scopes in SQL instead. I did not chase whether it is dead.
- **Slices 8 and 9 territory.** I did not read or write `preferences`,
  `draft_block_assignments`, or the publish path, and I did not touch `permanent_drop_slot` /
  `permanent_pickup_slot` beyond reading their bodies from the catalog.

## Overlap to merge rather than re-file

- The P1 on the stale `dropped_by_user_id` names `apply_house_transfer` and `admin_remove_worker`
  among the six functions that resurrect the marker. Both are slice 10 (admin: people, hire/fire,
  house transfers) write paths. The read-side consequence is on this journey and is ticketed here;
  if slice 10 finds the same functions from the write side, it is one defect.
- The P0 on the Desk Assistant resolver sits on slice 14 (Desk Assistant and the knowledge base) as
  well as this one. It is filed here because the harm is a false statement about the worker's own
  schedule, which is this journey's core promise, and because the fix is in the resolver's
  relationship to `worker_my_shifts` rather than in anything Assistant-specific.
- The `dropped_still_open` marker is written by `drop_shift`, which is slice 3. Slice 3 passed
  without noting that the marker is never cleared; that is the input to the P1 here.
