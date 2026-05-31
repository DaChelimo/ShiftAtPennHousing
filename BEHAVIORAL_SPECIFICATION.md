# Shift@PennHousing — Behavioral Specification (v2)

This document defines the operational truth of the Shift@PennHousing system. It states what is true about Penn Housing desk operations as deterministic rules, independent of any implementation. Every rule here is what the software must guarantee; every architecture decision is derived from this document, not the other way around.

This document does not describe code, schema, or infrastructure. It describes behavior.

---

## 1. Operating Domain

### 1.1 Houses

Penn Housing operates 13 college houses. They are not interchangeable.

**Harnwell** is the system's emergency call center. Workers at Harnwell receive additional training that workers at other houses do not. Because of this training requirement, no worker from another house may be assigned to cover the Harnwell desk under any circumstance.

**Quad** is a multi-staff training-equivalent house whose workers can cover any other house except Harnwell. Workers at all other 11 houses share the same training and procedures as Quad workers, so a Quad worker can substitute at any of those 11 houses without issue.

**The 11 single-staff houses** (every house other than Harnwell and Quad) are operationally equivalent to each other. Workers at any of these 11 houses cannot float to other houses; they only work their home desk.

### 1.2 Float Direction Rules

In any period where floating is permitted:

- A Quad worker may NOT float to Harnwell. A Quad worker may float to any of the 11 single-staff houses.
- A Harnwell worker may float to any house (Quad or any of the 11 single-staff houses).
- A worker hired at one of the 11 single-staff houses may never float.

These rules exist because of training equivalency, not distance or convenience. They are absolute when floating is permitted.

The float lookup algorithm (Section 6) MUST enforce these rules as eligibility checks, independent of any routing configuration data, so that data-entry errors cannot bypass them.

Cross-house pickup (Section 5.3) is governed by a separate, more permissive eligibility rule than floating because the worker is acquiring an additional shift rather than abandoning their home desk; the source-side staffing constraints that restrict floating do not apply. Only the Harnwell training constraint carries over: no worker without Harnwell training may staff the Harnwell desk, regardless of mechanism.

### 1.3 House Identity Is Permanent

A worker is hired at one house. That house is their home house for the entire period of employment. A worker cannot transfer between houses informally or opt in to work at a different house during periods their home house is closed. A worker may, however, appear at a non-home house through one of two mechanisms:

- **Floating** — system-assigned coverage during the escalation chain (Section 6), or voluntarily via the force-trigger path. The float direction rules of Section 1.2 apply.
- **Cross-house pickup** — voluntary claiming of an open shift at an eligible non-home house, drawn from the Open Shifts feed of that house (Section 5.3). Governed by the more permissive eligibility matrix in Section 5.3.

Both mechanisms respect the absolute Harnwell training constraint: only Harnwell-trained workers may staff the Harnwell desk.

### 1.4 Time Conventions

All times in this specification are stated in 24-hour format for logical clarity. The user interface presents times in either 12-hour or 24-hour format based on each user's display preference. Midnight is represented as 00:00 (the start of a day); the end of a shift day that runs until midnight ends at 24:00 of that day or, equivalently, 00:00 of the next day. The system stores all times as 24-hour and resolves display formatting at render time.

**Time zone.** All operational times are anchored to Penn's local zone (`America/New_York`). All wall-clock times in this specification (08:00, T-2h, Monday 00:00, etc.) refer to that zone. The system stores timestamps with their zone explicitly recorded; conversions to user-local display are out of scope (all users are co-located at Penn). DST transitions are handled by the underlying timestamp library: a shift block whose `block_start_at` straddles a DST transition still has a fixed wall-clock start and a fixed 30-minute duration in elapsed real time.

**Date attribution at block boundaries.** A block belongs to the date of its `block_start_at` for all purposes: profile lookup, week assignment, day-of-week resolution, and staffing pattern matching. A block starting at 23:30 on date N belongs to date N even though it ends at 00:00 of date N+1. Weekly hours rollover occurs at Monday 00:00; a block whose `block_start_at` is Monday 00:00 belongs to the new week.

### 1.5 Time Blocks

The system's atomic unit of scheduled time is the **time block** (also called a "block"): a 30-minute span starting on the hour or half-hour. All shift-related operations — assignment, drop, claim, float, swap, hour counting — operate on blocks, not on continuous time ranges.

A **shift** is a list of one or more contiguous time blocks assigned to a worker. A shift may become non-contiguous (containing gaps) after a partial drop; in that case, the calendar displays it as multiple visual cards, one per contiguous run.

Block durations are uniformly 30 minutes, so 1 hour equals 2 blocks and a worker's weekly hours are computed as the count of their assigned blocks multiplied by 0.5.

---

## 2. Roles

The system has five roles. Workers may hold more than one. The roles are: Student Worker, Student Manager, Housing Manager, Building Manager, and Housing Manager On Duty.

### 2.1 Student Worker (SW)

Staffs the desk during their assigned shifts. May drop shifts, claim open shifts within their home house, accept or decline float assignments, and initiate shift swaps and float swaps with other workers.

### 2.2 Student Manager (SM)

An SM is a Student Worker with additional capabilities. SMs have their own scheduled shifts, can be floated, can drop and claim shifts, can swap, and participate in every SW workflow. The SM role adds:

- Building the initial schedule for their house each period (regular school year only).
- Manually overriding the live schedule at any time during a period: adding workers to shifts, removing workers from shifts, reassigning workers between blocks.
- Initiating permanent shift swaps between two workers (Section 8.3).
- Force-triggering a float lookup for a known coverage gap before the standard escalation timing (Section 6.6).

An SM's elevated permissions are scoped to their house only.

### 2.3 Housing Manager (HM) and Building Manager (BM)

Every house has both a Housing Manager and a Building Manager. The BM is organizationally senior to the SM and exists primarily to cover for the HM during HM leave. Both HMs and BMs hold identical _administrative_ powers, but their _worker_ footprints differ:

- **HMs can hold shift assignments.** An HM may work scheduled shifts at their home desk and pick up open shifts (in-house or cross-house, per the standard eligibility matrix). An HM is never automatically floated by the system and never receives broadcast notifications for open shifts at their house; the broadcast feature is intended for SWs/SMs, and HMs subscribe to neither. HMs may, of course, view the open-shifts feed manually and choose to pick up.
- **BMs are admin-only.** A BM does not work shifts: they hold no scheduled assignments, cannot claim open shifts, cannot be floated, and do not appear in worker-eligibility lists for the schedule builder or the float lookup. The BM's role is supervisory and substitutional (covering for HM during leave).

Administratively (the powers shared by both HM and BM):

- Manually override the live schedule for their house (same capabilities as the SM, plus authority to override SM actions).
- Force-trigger a float lookup (Section 6.6).
- Receive real-time notifications for events requiring human attention within their working hours, per the routing in Section 10.1 (HM is the primary recipient; BM is the default replacement when HM is on leave).
- Place calls to Allied Security when the system has determined Allied coverage is required.
- Serve as HMOD on rotation (Section 2.5).
- Go on leave and designate a replacement (Section 2.6).

HMs and BMs work Monday through Friday, from 08:00 (inclusive) through 17:00 (exclusive). A notification or escalation event that fires at exactly 08:00 on a weekday is within HM working hours; one that fires at exactly 17:00 is within HMOD hours. Outside these hours and on all weekends, the Housing Manager On Duty (HMOD) covers all HM/BM responsibilities for all 13 houses.

Throughout this document, "HM" used in administrative contexts (notifications, overrides, force-triggers, leave) applies equally to BMs unless explicitly qualified. "HM" used in worker contexts (shift assignment, float, broadcast) applies only to HMs, never to BMs.

### 2.4 The BM-as-Substitute Pattern

The BM exists primarily to cover for the HM during HM leave (Section 2.6). On any normal day, both the HM and BM of a house are active and have identical permissions. When the HM goes on leave, the BM (by default) inherits the HM's substitution responsibilities for the leave period, including any HMOD duty that fell to the HM during that period.

### 2.5 Housing Manager On Duty (HMOD)

A single person — either an HM or BM from any of the 13 houses — serves as HMOD at any given time. HMOD duty rotates on a weekly cadence: each HMOD assignment runs from Friday 08:00 (inclusive) through the following Friday 08:00 (exclusive). This places the weekend continuous interval (Friday 17:00 → Monday 08:00) — the heaviest HMOD duty — at the start of the duty week, so one HMOD owns a weekend plus the following four weekday evenings without a mid-weekend rotation.

The HMOD rotor is planned by the HMs and BMs themselves at the start of each semester (fall, spring). The rotor is then in effect for that entire semester, including any short breaks and the winter break that fall within or between those semesters.

The HMOD is on duty:

- Monday through Friday from 17:00 (inclusive) through midnight.
- Continuously from Friday 17:00 (inclusive) through Monday 08:00 (exclusive).

**Academic-year scope of the rotor.** The HMOD rotor exists only for academic-year dates. The first rotor week of an academic year begins on the Friday 08:00 that opens the week containing the first operating date of fall semester (the Friday 08:00 on, or immediately preceding, that date); any pre-semester days inside that first week carry no operating activity and need no coverage. The last rotor entry of an academic year is the Friday-anchored week containing the last operating day of spring semester, **truncated** so that no rotor interval extends into the summer non-operating period. Concretely: the final rotor interval ends at the end of the last spring operating day (e.g., Sunday 23:59) rather than continuing through the following Friday 08:00. Summer dates have no HMOD assignment at all; coverage during summer is handled entirely off-platform per Section 3.1.

At exactly Monday 08:00, HM working hours begin and the HMOD's weekend duty ends. If a notification fires at exactly Monday 08:00, it is routed to the HM (HM time begins at the closed boundary). The HMOD's weekly assignment spans Friday 08:00 through the following Friday 07:59 for rotor-tracking purposes, but during the HM-hours windows within that span the HMOD receives no operational notifications — HMs handle those.

The HMOD is the system's escape hatch. In a healthy operational week, the HMOD receives no notifications from the system because all coverage gaps are resolved by automated floating before they require human intervention. The HMOD is only contacted when:

- A coverage gap cannot be resolved through floating and Allied Security must be secured.
- A coverage gap exists for a shift starting outside HM working hours and Allied procurement is needed.
- A coverage gap exists at any time during a weekend.

The HMOD does not receive a stacked digest of events — only real-time notifications requiring action.

### 2.6 HM/BM Leave

An HM or BM may indicate one or more days of leave by selecting dates in the system. When leave is set:

1. The system designates a replacement for the leave period. By default, the replacement is the same house's BM (if an HM is going on leave) or HM (if a BM is going on leave). The user may instead select any other HM or BM in the system as their replacement, in which case the user is responsible for verbally confirming the replacement's availability before submission.

2. If the user being placed on leave is currently the HMOD-of-the-week (or scheduled to be during their leave dates), the replacement also assumes HMOD duty for those dates. Because HMOD runs from Friday 08:00 to the following Friday 07:59 and includes the weekend at the start of the duty week, an HM whose HMOD week is the leave period needs a replacement whose availability includes the weekend.

   **HMOD interval transfer is start-date-based.** Date-based leave maps to time-based HMOD intervals by the rule: every HMOD on-duty interval whose **start moment** falls on a leave date transfers to the replacement. An overnight interval starting Tuesday 17:00 and extending into Wednesday morning belongs to Tuesday for transfer purposes; if the leave covers Wednesday only (not Tuesday), that overnight interval stays with the original HMOD. A weekend continuous interval (Friday 17:00 → Monday 08:00) belongs to Friday; if Friday is not in the leave dates, the entire weekend stays with the original HMOD even if some weekend days are.

   **HMOD interval transfer is profile-agnostic.** The start-date rule applies regardless of operating-profile boundaries. An HMOD interval that starts on the last Friday of fall semester and extends into the first Monday of winter break belongs to that Friday. If Friday is a leave date, the entire interval (including the portion falling in winter break) transfers to the replacement. The profile transition does not split the interval or alter which date it belongs to for transfer purposes.

3. The system crafts an email notification to the affected house's student workers explaining that the HM is on leave and that emergency contact should go to the replacement (including the replacement's role label and name). The system then opens the user's mail application (via a mailto link on web, via an Intent on mobile) with the message pre-filled. The user sends the email themselves.

4. Layered/cascading leave is supported. Leave delegations form a directed graph: each leave record names exactly one immediate replacement. The system resolves the acting HM for any given (date, house) by walking forward through active leave records until it reaches someone not on leave for that date.

   **Cycle prevention at selection time.** When an HM picks a replacement, the system computes their _incoming chain_ — the set of all HMs/BMs whose active leave delegation currently resolves through the HM going on leave. These HMs are excluded from the replacement picker: selecting any of them would create a cycle. The project administrator is always a valid terminal selection and is never excluded.

   **Cycle prevention at submission time.** Because another HM may create a leave between picker-load and submit, the incoming-chain check is re-run inside the submission transaction. If the selected replacement is now in the incoming chain, the request is rejected and the user must re-select.

   **Depth limit.** The resolution walk is bounded at depth 10. If this limit is reached, the system flags a configuration error, notifies the project administrator and every HM in the detected chain exactly once (plus the HMOD on duty), and routes all notifications for that house to the HMOD on duty until the situation is manually resolved.

   **No eligible replacement.** If the cycle-prevention rule excludes all HMs and BMs, the project administrator is the only available option. This is the guaranteed exit from any chain.

   **Example.** If HM_A is on leave with BM as replacement, and the BM also needs leave for 3 of those 7 days, the BM may designate a different replacement for those 3 days — but the cycle-prevention rule prevents the BM from selecting HM_A. Each day resolves to the correct acting person: BM for 4 days, the designated third party for 3.

5. When the leave period ends, the HM automatically returns to their full responsibilities at the start of the day following the last leave date.

6. An HM on leave may click an **"I'm back"** button at any time during their leave to end the leave early. When clicked:
   - The HM resumes responsibilities from that moment forward.
   - Any leave days that have already elapsed remain attributed to the replacement (the system does not retroactively re-attribute prior actions).
   - The system crafts a "back from leave" email to student workers and opens the mail application with the message pre-filled. The user sends it.
   - The current replacement is notified (in-app) that they are no longer covering.

7. If both the HM and BM of a single house need to be on leave on the same day with no overlap in coverage, the system requires that at least one of them designates a replacement from a different house. The system does not allow a house to have neither HM nor BM (nor designated replacement) active on any operating day.

### 2.7 Multiple Roles

A single person may hold multiple roles concurrently — for example, an SM is also implicitly an SW, and an HM is implicitly an SM and SW for that house's workflows. When a person holds multiple roles, their effective permissions are the union of the roles they hold.

---

## 3. The Operating Calendar and Seasons

### 3.1 The Calendar

The operating calendar covers the academic year: fall semester, winter break, spring semester, and any short breaks within those semesters. Every operating date is assigned to exactly one operating-rules profile. There are no overlaps and no ambiguity. The assignment for each date is data; the rules that fire on that date are determined entirely by which profile the date references.

Summer (the period between the end of spring semester and the start of fall semester) is **not** an operating period for this system. Summer dates have no profile assigned and the system is fully dormant for those dates. The decision to scope summer out is deliberate: summer schedules at Penn Housing are essentially static (workers plan their summer lives around the schedule rather than the reverse, so drops and float requests are rare), Harnwell does not float in summer, the Quad is closed, and the few houses that are double-staffed are double-staffed only on some days. When a coverage gap does occur in summer, the operating practice is to call HMOD immediately rather than run an escalation chain. The system's primary value — automated float lookup, broadcast escalation, and drop-driven recovery — does not apply. Summer is therefore left for possible future implementation; until then, summer coverage is handled entirely off-platform.

### 3.2 Operating-Rules Profiles

The system recognizes three profiles. Each profile defines a complete set of rules that govern every date assigned to it.

**Regular School Year** (fall and spring semesters)

- Shift bounds: 08:00 to 24:00.
- Weekly hours cap: 20 hours, soft warning, overridable.
- Scheduling mode: SM-built with worker preferences submitted in advance.
- Floating: permitted, subject to runtime headcount checks.
- Escalation chain: broadcast at T-3h, automated float lookup at T-2h, HMOD-then-Allied if float lookup fails.

**Winter Break**

- Shift bounds: 08:00 to 24:00.
- Weekly hours cap: 40 hours, hard ceiling, not overridable.
- Scheduling mode: claim-based (same workflow as short break — see Section 4.4).
- Floating: prohibited at the profile level. Only Harnwell is operational during winter break; all other 12 houses are fully closed.
- Escalation chain: broadcast at T-3h, HMOD notification at T-2h for Allied procurement; no float lookup step.

During winter break, all houses other than Harnwell are completely inactive. SWs, SMs, HMs, and BMs of closed houses have no active responsibilities. Their accounts show no shifts, no UI for picking up shifts, no schedule-building tools, no preference submission, and no notifications. The single exception is that an HM or BM of a closed house may serve as HMOD on the rotor, in which case they are notified only for HMOD-relevant events at Harnwell.

**Short Break** (Thanksgiving, fall break, spring break, spring fling, and other named multi-day breaks within a semester)

- Shift bounds: 08:00 to 24:00.
- Weekly hours cap depends on the specific break: 40 hours for Thanksgiving, fall break, and spring break (hard ceiling, not overridable); 20 hours for spring fling (soft, overridable). See Section 9.3 for the cap-modification mechanism.
- Scheduling mode: claim-based, first-come-first-served. No SM-built schedule.
- Floating: permitted, subject to runtime headcount checks.
- Escalation chain: broadcast at T-3h, automated float lookup at T-2h, HMOD-then-Allied if float lookup fails.

A date that falls within a short break has the short-break profile, regardless of whether it falls within a fall or spring semester. The calendar resolves the precedence at assignment time, not at runtime.

### 3.3 Staffing Patterns

Staffing patterns define how many workers each desk requires at each time of day. They are keyed by (profile, house) and resolved per day-type (weekday vs weekend). Patterns do not vary across individual weekdays; if a future requirement needs per-day-of-week granularity, the storage layer can be extended without changing the resolution model.

**Regular School Year**

- Harnwell: 2 workers, 08:00 to 24:00, every day.
- Quad: 3 workers, 08:00 to 24:00, every day.
- Each of the 11 single-staff houses: 1 worker, 08:00 to 24:00, every day.

**Winter Break**

- Harnwell: 1 worker, 08:00 to 24:00, every day.
- All 12 other houses: closed, no shifts scheduled.

**Short Break**

- Harnwell: 2 workers, 08:00 to 24:00, every day.
- Quad: 3 workers, 08:00 to 24:00, every day.
- Each of the 11 single-staff houses: 1 worker, 08:00 to 24:00, every day.

When a desk is single-staffed at a given time, no worker scheduled there can be floated out (no source slack exists). When a desk is multi-staffed, workers at that desk are potentially floatable subject to the rule that at least one worker must remain at the source desk.

### 3.4 Closed Houses

When a house is closed for a period (only Lauder and the other 10 single-staff houses during winter break, plus Quad), the house has no scheduled shifts for those dates. Workers hired at closed houses do not work during the closure period. They cannot opt in to work at another open house, including Harnwell. They are simply off the schedule and their UI shows no operational content for those dates.

### 3.5 Floatability as a Runtime Check

Whether a worker can be floated at any given moment depends on two conditions:

1. The profile in effect on that date permits floating at all.
2. The source desk (the worker's home house) would have **at least one worker remaining** after the float. The floor is one worker, not the staffing pattern's required headcount: a Quad with required headcount 3 and three workers on shift can float two of them out, leaving one. A single-staff house with one scheduled worker cannot float (no source slack).

Both must hold. Additionally, a worker in **pending-float** status (Section 6.6) is counted as already absent from the source desk for the duration of their pending float, even though they have not yet acknowledged.

A source-side gap created by floating below the required headcount enters the source's open-shifts feed and proceeds through normal escalation, per Section 6.6 #5. The principle is that destinations with zero coverage take priority over sources operating below required headcount but still staffed.

Floating is therefore not a binary system-wide flag; it is checked at the moment a float opportunity arises.

---

## 4. Schedule Creation

### 4.1 Preference Submission

Before the start of any period that uses SM-built scheduling (regular school year only), workers submit their preferences for the upcoming period.

Workers access a calendar view of the period and select time blocks. For each block, a worker marks one of three statuses:

- **Preferred:** the worker wants to work this block.
- **Available:** the worker can work this block if needed but does not specifically want to.
- **Cannot:** the worker is unavailable for this block and must not be scheduled.

A worker who wants no hours at all for the period clicks a "no hours" button. This worker is not assigned any shifts by the SM during the preference-assisted phase. They may still pick up open shifts during the period via claiming if they later change their mind.

Workers also indicate a target weekly hour count for the period: any integer from 0 up to the period's hours cap (20 hours for regular school year). The target is a guideline that informs the SM during schedule building.

Winter break and short break do not use preference submission; they are claim-based (Section 4.4).

### 4.2 The Submission Deadline

The SM sets a deadline for preference submission. The system sends reminders to workers who have not yet submitted preferences at 5 days, 3 days, and 1 day before the deadline. Workers who have submitted (including those who clicked "no hours") receive no further reminders.

Preferences cannot be changed after the deadline. The SM begins building the schedule only after the deadline has passed.

Workers who neither submitted preferences nor clicked "no hours" before the deadline are treated as **none / unspecified** (status: no-preference-on-record). The SM sees them in the Phase-2 full roster only — not in the preference-grouped Phase-1 side card. They are assignable during Phase 2 at the SM's discretion. The system does not assign them automatically during Phase 1, and they are not flagged for mandatory manual review; the SM may choose to assign them or leave them unscheduled.

### 4.3 Schedule Building — Three Phases

Schedule building proceeds through three distinct phases.

**Phase 1: Preference-Assisted Build**

The SM uses a desktop-only drag-picker interface. The SM drags over a span on the calendar — a span of 2 to 12 consecutive 30-minute blocks (1 hour to 6 hours). A side card appears showing workers grouped by their preference status for the dragged span:

- A worker is shown as **preferred** for the span if they marked preferred for at least one block in it and at least available for every other block.
- A worker is shown as **available** for the span if they marked at least available for every block in it.
- A worker is shown as **blocked** for the span if they marked cannot for any block in it. The card explicitly identifies which block triggered the block.

A worker shown as **blocked** is rendered as non-selectable in Phase 1: the SM cannot click them to assign. To assign a "cannot"-marked worker, the SM must switch to Phase 2 (Section 4.3 Phase 2), where blocked status is downgraded to advisory with an explicit confirmation step.

Workers who left some blocks in the dragged span entirely unmarked (i.e., no preferred / available / cannot status submitted for those specific blocks) are treated, **for Phase 1 grouping purposes only**, as if they had marked "cannot" for those blocks: they appear in the **blocked** group with the reason "no preference submitted for block [HH:MM]." This prevents the SM from accidentally assigning a worker to time they never affirmed. To assign such a worker, the SM switches to Phase 2.

Each worker entry shows their name, their span status (preferred, available, or blocked with the blocking reason), and their hours-remaining figure (target hours minus hours already assigned this week). The SM assigns workers to shifts by selecting them from the card.

If assigning a worker would push them over their target hours, the system displays a warning popup. The SM may dismiss the warning and continue. The 20-hour cap during regular school year is soft and overridable.

**Phase 2: Manual Override**

After the preference-assisted build, the SM enters a manual editing phase. In this phase, the drag-picker still works but the card behavior changes: when the SM drags a span, the card shows every worker in the house, sorted by name, with their total assigned hours. The card has a search bar for finding specific workers and is height-clipped with scrolling. The SM can assign any worker to any span, regardless of preferences. This phase is for handling cases the preference-assisted phase cannot.

The Phase-1 hard constraints (a worker's "cannot" markings, and a worker's "no hours" opt-out) are downgraded to advisory in Phase 2: the SM may assign such a worker but the card surfaces a warning label ("Marked cannot for this block" or "Opted out — no hours") and the SM must explicitly confirm to proceed. The same warning behavior applies during post-publish manual overrides.

**Phase 3: Live Publishing**

When the SM publishes the schedule, it becomes live. Workers can see their assignments. The schedule is the source of truth from this moment forward.

The SM retains override capability after publishing. The SM can add workers to shifts, remove workers from shifts, and reassign blocks at any point during the period. The same card UI from Phase 2 (full house roster, search bar) is used for these post-publish edits. HMs share these same override capabilities.

### 4.4 Claim-Based Scheduling for Winter Break and Short Breaks

Winter break and short breaks do not use SM-built schedules. The flow is identical for both:

All time offsets in this section (T-14d, T-3d, T-1d) are measured from the **first day of the break period**. The picker opens, the alert fires, and the picker closes based on the break's start date — not on each individual date within the break. A five-day Thanksgiving break (Wednesday–Sunday) opens its picker 14 days before the Wednesday, sends the T-3d alert on the Sunday before, and closes the picker at the moment T-1d before the Wednesday. All dates within the break share these same phase boundaries.

- **T-14 days from the break start:** the system clears the calendar for the entire break period for the house (or in winter, for Harnwell only). Existing assignments for those dates are removed. The break period is visually highlighted on the calendar with a distinct background to signal the special period.

- **T-14 days through T-1 day (inclusive):** workers see empty shifts on the calendar for the break period and can claim shifts directly via the calendar picker. Claims are first-come-first-served. A worker who claims a shift owns it; they can drop it back into the unclaimed pool any time up until T-1 day. Dropped break shifts during this window return to the **calendar claim pool**, not to the open-shifts feed. The shift remains claimable by any worker via the calendar picker.

- **T-3 days:** the system alerts workers who have not claimed any shifts and have not affirmatively indicated they want zero hours for the break (see "Indicating zero break hours" below).

- **T-1 day (exact moment T-1d):** the calendar picker for the **entire break period** closes simultaneously. Any shifts still unclaimed at this moment enter the **open-shifts feed** for normal processing. From this point onward:
  - Workers wanting to pick up a break shift must go through the open-shifts feed, not the calendar.
  - A worker who drops a previously-claimed break shift during the T-1d-to-T-2h window sends that shift into the open-shifts feed (not back into the calendar picker, which is now closed).
  - A worker who reclaimed a previously-dropped shift via the open-shifts feed may drop it again, and it returns to the feed.
  - Standard open-shifts mechanics apply: the shift becomes unpickable at T-2h (Section 5.3).

**Indicating zero break hours.** A worker who wants no hours for a given break clicks a "no break hours" control on that break's calendar — the break analogue of the regular-year "no hours" button (Section 4.1), scoped to the specific break rather than to a semester. This records an opt-out for that worker and that break, which (a) suppresses the T-3d alert above and (b) signals that the worker is intentionally sitting the break out. The opt-out is **per break**: opting out of one break has no effect on any other break (a worker may sit out Thanksgiving yet want spring-break hours). It is **advisory** — it does not prevent the worker from later claiming a break shift via the calendar picker, or via the open-shifts feed after T-1d, if they change their mind (the same latitude Section 4.1 grants the regular-year opt-out worker); claiming during the window is itself sufficient to suppress the alert. The opt-out is stored in `break_optouts` (ARCHITECTURE.md §2.9).

During the claim phase (T-14 to T-1 day inclusive), break shifts do not appear in the open-shifts feed to avoid cluttering it.

The hours cap during the break is strictly enforced (40 for Thanksgiving/fall/spring break, 20 for spring fling) unless modified by an authorized HM/BM per Section 9.3.

The exact same workflow governs Harnwell's winter-break schedule: the calendar claim picker is open during the T-14d-to-T-1d window for each date in the winter period.

### 4.5 Firing and Mid-Period Worker Changes

Workers can be terminated or hired at any time during a period.

**Firing.** Firing is mechanically equivalent to a permanent drop (Section 8.4.1) applied across every shift the fired worker currently owns, plus an immediate account deactivation. Specifically:

- **Currently in-progress block.** If the fired worker is mid-shift at the time of firing, the in-progress block is immediately vacated. The system checks whether removing this worker leaves the desk **below its required headcount** for that block (per the staffing pattern). If so, the block enters float escalation immediately — skipping the T-3h broadcast and going directly to float lookup, then HMOD-and-Allied if the lookup fails. This is treated identically to a mid-shift temporary drop at the moment of firing.
- Every recurring slot the fired worker currently owns within the current operating profile is permanently dropped. Future occurrences surface in the permanent openings feed; individual occurrences enter the weekly feed as they cross the 30-day horizon and undergo standard escalation from there.
- Every non-recurring assignment the fired worker holds — temporary claims, claimed break shifts — is vacated. Within-horizon occurrences enter the open-shifts feed immediately; occurrences beyond the 30-day horizon are held until their start times cross it, then enter the feed.
- Any pending or acknowledged float assignments held by the fired worker are voided. For each voided float: the system immediately runs a float lookup for the destination block with the fired worker excluded. If the lookup succeeds, a new floater is assigned. If it fails, the HMOD is notified for Allied procurement. The no-takeback rule (Section 6.4) does not protect a float when the floater is no longer employed; firing is an external HR event the system must honor.
- The worker's account is deactivated; they no longer appear in scheduling UIs, the float lookup eligibility pool, or the manual-override roster.

The mid-period firing flow shares its mechanics with the permanent-drop pathway; no separate "fired-worker" vacancy state exists.

**Hiring.** A new hire is added at any time during a period and starts with no assigned shifts. From the moment of activation, the new hire holds all standard SW capabilities. They acquire shifts through any combination of the following standard pathways:

- The SM or HM/BM of their house may assign them to a slot via the manual override interface. The override may be one-time (this week only) or permanent (for the rest of the operating profile), mirroring the SM/HM permanent-removal capability (Section 8.4.2) in reverse. The interface presents both options explicitly. On a permanent assignment, the new hire receives an in-app notification identifying the slot, the operator, and the period affected, which persists in their updates tab.
- The new hire may permanently pick up any slot currently in the permanent openings feed (Section 8.4.3).
- The new hire may temporarily claim shifts from the weekly open-shifts feed (Section 5.3) and is eligible for float assignments per the standard eligibility rules (Section 6).

**Permanent shift swaps.** Workers may agree off-system (verbally or by text) to permanent shift swaps for the remainder of a period. Permanent swaps use an in-app accept-reject flow (Section 8.3). Permanent swaps apply only to SM-built schedules (regular school year). Short break and winter break shifts are claim-based and individually owned; they may only be temporarily swapped via the shift swap workflow.

---

## 5. The Coverage Lifecycle

### 5.1 The Open Shifts Feed

The open shifts feed shows shifts that need coverage. It has two distinct surfaces:

**The Weekly Feed.** Shows shifts that need coverage within the next 30 days. A shift appears in the weekly feed when:

- A worker temporarily drops a regular-schedule shift (not a break shift) that starts within 30 days.
- A break shift remains unclaimed at the T-1 day checkpoint, or is dropped after T-1 day.
- A worker is fired and their shifts cross into the 30-day horizon.
- A permanently-dropped recurring slot's next occurrence enters the 30-day horizon (each weekly occurrence surfaces here as it approaches).

Each house has its own weekly feed. A worker sees their home house's weekly feed plus the weekly feed of any non-home house where they are eligible to pick up per the matrix in Section 5.3 — surfaced through distinct UI tabs (Section 5.6). Open shifts in the weekly feed remain claimable until the T-2 hour escalation point of that shift, at which point they become unpickable.

A dropped regular-schedule shift more than 30 days in the future remains in the system but is hidden from the weekly feed until its start time crosses the 30-day horizon, at which point it surfaces automatically.

**The Permanent Openings Feed.** Shows recurring slots whose owners have permanently dropped them — slots needing a permanent picker for the remainder of the current operating profile. A recurring slot appears in the permanent openings feed when:

- A worker permanently drops a recurring slot (Section 8.4).
- An SM or HM/BM permanently removes a worker from a recurring slot (Section 8.4).

The permanent openings feed is always visible to all SWs at the affected house, regardless of broadcast subscription status, and to SMs and HMs/BMs of that house. It is also visible to SWs at other houses who are eligible to pick up at the affected house per the matrix in Section 5.3, surfaced through the cross-house tab (Section 5.6). Each entry shows the recurring slot's definition (house, day-of-week, time band) and how many weeks remain in the period.

A permanently-dropped slot's individual weekly occurrences still surface in the **weekly feed** as they cross the 30-day horizon, where they undergo standard escalation. The permanent openings feed exists in parallel so that workers can claim the entire remaining recurrence in one action rather than picking it up week-by-week.

A slot is removed from the permanent openings feed when:

- Another worker permanently picks it up (Section 8.4).
- The operating profile ends. New profiles are scheduled fresh; permanent drops do not carry over.

### 5.2 Dropping a Shift

A worker may drop any of their assigned shifts (or any contiguous portion thereof, snapped to 30-minute block boundaries). Drops are always permitted.

There are two drop types: **temporary** (drop only the specified occurrence — "this week only") and **permanent** (drop all future occurrences of the recurring slot — Section 8.4). The system asks the worker which type they want via a popup at drop initiation. The default behavior described in this section refers to temporary drops; permanent drops are covered in Section 8.4.

Temporary drop rules:

- A worker may drop a shift starting within 20 minutes of the current time. The system allows this but shows a warning popup informing the worker that this is short notice.
- **Mid-shift drops are permitted.** A worker currently in a shift may drop any portion of the remaining time, including both the "I'm leaving now" case and the "I want to skip this future part of my shift" case. The rules:
  - **Drop granularity.** Drops must be in whole 30-minute chunks (minimum 30 min, then 60, 90, 120 min, etc.). The system always operates on 30-minute block boundaries — there is no sub-block representation.
  - **Drop-from-now case.** If the worker is dropping from the current moment onward, the system rounds _down_ to the most recent 30-minute boundary to determine the chunk start. A drop initiated at 17:51 of a shift ending at 19:00 produces a gap of 17:30–19:00. The worker forfeits credit for the 21 minutes they actually worked between 17:30 and 17:51; the system's atomic hours unit remains the 30-minute block, and partial credit is intentionally not tracked. This is the accepted cost of dropping mid-block.
  - **Forward-future drop case.** If the worker is dropping a future portion of their current shift (not the current moment), they select the chunk explicitly. A worker on a 15:00–24:00 shift may at 15:21 drop the 18:00–20:00 chunk. The dropper continues working their other blocks; the dropped chunk is a future gap.
  - **Escalation timing follows standard rules based on the gap's start.** A mid-shift drop is not automatically immediate-escalation. The dropped chunk enters escalation as if it were any other open shift, anchored to the gap's start time:
    - **If gap start is more than 2 hours away** (e.g., the 15:00–24:00 shift dropping 18:00–20:00 at 15:21 — gap starts in 2h 39m), the chunk enters the weekly open-shifts feed and proceeds through the standard T-3h/T-2h chain.
    - **If gap start is within 2 hours** (e.g., a 16:23 drop of the 16:30–17:30 chunk during a 15:00–18:00 shift — gap starts in 7 minutes), the chunk skips broadcast and float lookup (no time for either to be useful) and goes directly to HMOD for Allied procurement.
  - **Below-required-headcount check.** Escalation only fires when the drop leaves the desk below its required headcount for the affected blocks. If the desk remains at or above required headcount (an overstaffed multi-staff desk), no escalation fires — the chunk enters the weekly feed as a normal open shift available for claiming.
- A worker may drop only a portion of a shift (e.g., drop a 19:00 to 20:00 segment from a 19:00 to 24:00 shift), leaving the surrounding blocks intact. The remaining blocks may be non-contiguous; they display as separate cards.
- A worker who is currently assigned to a float (or is actively floating) may drop their shift. The float assignment becomes invalid; the destination desk now has a coverage gap that triggers a new float lookup (Section 5.5).
- A worker who has dropped a shift may reclaim it themselves, provided no other worker has claimed it in the interim.

A drop horizon of 30 days governs only whether the dropped shift appears in the weekly feed; drops of regular-schedule shifts more than 30 days in advance are accepted and held until the 30-day horizon is reached. Break shifts may only be dropped during the claim phase or after the shift enters the open-shifts feed (T-1d onward); they cannot be dropped before T-14d because they do not exist as claimable shifts until then. Permanent drops do not apply during break profiles.

When a worker temporarily drops a shift, the dropped block(s) enter the weekly feed if within 30 days of starting (or, for break shifts dropped before T-1d, return to the calendar claim pool). The drop triggers the escalation chain based on the shift's start time.

### 5.3 Claiming an Open Shift

A worker may claim any open shift at their home house, plus any open shift at a non-home house where they are eligible to pick up per the cross-house eligibility matrix below. The system supports two pickup types:

- **Temporary claim** ("pick up this week"): claim a single occurrence from the weekly feed. This is the default for occurrences appearing in the weekly feed.
- **Permanent pickup** ("pick up permanently"): claim a permanently-dropped recurring slot from the permanent openings feed, becoming the owner for the remainder of the operating profile. Covered in Section 8.4. Cross-house permanent pickup follows the same eligibility matrix.

**Cross-house pickup eligibility.** Pickup eligibility is governed by the Harnwell training constraint: only Harnwell-trained workers may staff the Harnwell desk. All other cross-house pickups are permitted. The matrix:

| Source (worker's home house) | Can pick up at Harnwell?  | Can pick up at Quad? | Can pick up at any 11 single-staff house?   |
| ---------------------------- | ------------------------- | -------------------- | ------------------------------------------- |
| Harnwell SW                  | YES (their home)          | YES                  | YES                                         |
| Quad SW                      | NO (no Harnwell training) | YES (their home)     | YES                                         |
| 11-single-staff-house SW     | NO (no Harnwell training) | YES                  | YES (their own home and any other 11-house) |

This matrix is intentionally more permissive than the float direction rules (Section 1.2). Floating restricts 11-single-staff-house workers as sources because their departure would leave a single-staff desk unattended; cross-house pickup imposes no such restriction because the worker is acquiring an additional shift on top of (or independent of) their home schedule, not abandoning it. The only invariant carried over is the Harnwell training requirement.

A temporary claim is permitted when:

- The shift is at the worker's home house, OR the worker is eligible to pick up at the destination house per the matrix above.
- The shift's escalation has not reached the float-lookup step (T-2 hour for that shift has not yet passed). The T-2h unpickable cutoff applies uniformly to in-house and cross-house claims.
- Claiming the shift would not push the worker over the applicable hours cap.
- **No time conflict.** The claimed blocks must not overlap any block the worker is already assigned to that week (at any house, in any status — scheduled, claimed, float-in, pickup). This check applies across the entire system, not just the home house.

Hours from a cross-house picked-up shift count at the worker's home house (consistent with the float attribution rule of Section 9.1) and count toward the worker's weekly cap. The decomposition on the worker's hours report shows hours-worked-at-home, hours-worked-while-floated-out, and hours-worked-from-cross-house-pickup as distinct categories.

**Cross-house pickup makes the worker unavailable at home for the pickup window.** Once a worker accepts a cross-house pickup, they cannot simultaneously be scheduled at, claim a shift at, or be floated to a third house for the overlapping blocks. The pickup is treated as an exclusive assignment at the destination house for those blocks: the worker is counted in the destination's headcount, not in their home house's. Their home house's headcount may consequently fall below required and trigger an open-shifts gap; that gap proceeds through normal escalation independently. The picker is free to make the pickup regardless of their home house's current staffing state — pickups are a personal scheduling choice and do not require the home house to be adequately staffed.

**Cross-house picked-up workers are not floatable.** A worker actively assigned to a cross-house pickup at house X cannot be floated to a third house during that pickup window. They are also not floatable from house X (their pickup is voluntary; the system does not redirect them). Standard float eligibility (Section 6.1) excludes cross-house pickers.

Claiming over the 20-hour regular school year cap (or 20-hour spring fling cap) is permitted with a warning. Claiming over the 40-hour break cap is prohibited.

A worker may also temporarily claim a single occurrence of a permanently-dropped slot that has surfaced in the weekly feed (because that specific week is within 30 days). This is a temporary claim — Bob takes just that one week. The permanent ownership of the slot is unchanged; the slot remains in the permanent openings feed and other future weeks still need a permanent picker. Cross-house workers may make such temporary occurrence claims subject to the same eligibility matrix.

When two workers attempt to claim the same shift at effectively the same moment, the system resolves the conflict by ordering claims by timestamp. The first claim succeeds; the second receives an error indicating the shift is no longer available. This applies uniformly to in-house and cross-house claim attempts.

**Broadcast scope unchanged.** Broadcast notifications (Section 5.4) continue to go only to subscribed SWs at the shift's home house. Cross-house-eligible workers see eligible shifts when they open the Shifts screen (Section 5.6); they do not receive push broadcasts for non-home houses. This avoids notification spam across houses while still surfacing the shift to anyone who looks.

### 5.4 The Escalation Chain

When a shift is open (unclaimed), it progresses through a timed escalation chain. The chain steps and timings depend on the profile in effect for the shift's date.

**Regular School Year and Short Break Profiles**

1. **T-3 hours: Broadcast.** The system sends a notification to all subscribed Student Workers at the shift's home house, informing them that an open shift is available. The shift remains in the open-shifts feed and is claimable. Broadcast subscription is opt-in and defaults to off; workers must explicitly enable it. The subscription toggle is not available to users holding an `hm` or `bm` role. Personal notifications (your own shift, your own float) are not subject to subscription and are always delivered.

2. **T-2 hours: Float Lookup.** If the shift is still unclaimed, the system runs an automated float lookup. The shift becomes unpickable at this exact moment; any claim attempt strictly after T-2 hours fails. If a claim is in progress at exactly T-2 hours, it fails. Only claims completed strictly before T-2 hours succeed.

   The float lookup attempts to assign one or more floaters following the rules in Section 6. If a floater is identified, they are automatically assigned with no human approval step. If no floater is identified, the system proceeds to step 3 immediately.

3. **T-2 hours (on float lookup failure): HMOD Notification.** If float lookup returns no candidate, the HMOD is notified that Allied coverage is required. The notification contains the time of needed coverage and the house. The HMOD places the call to Allied. Allied coverage is the terminal step; once Allied is assigned, the gap is considered resolved.

**Winter Break Profile**

1. **T-3 hours: Broadcast.** Same as above. Only Harnwell workers receive these broadcasts during winter since only Harnwell operates.

2. **T-2 hours: HMOD Notification.** No float lookup step exists in winter; the system goes directly to HMOD notification for Allied procurement.

### 5.5 Escalation Is One-Way (with the Float-Drop Exception)

Escalation never moves backward through the same chain. Once a shift reaches the T-2 hour float-lookup step, the open-shifts feed status changes to unpickable and cannot revert.

The single exception is that if a worker drops a shift while they have a float assignment — whether they drop their home shift, the float destination, or any portion of either — all positions covered by that worker become uncovered and trigger independent new escalations:

- **The float destination** goes through float lookup immediately (skipping the broadcast step, since the destination house has already been told the gap was covered). The float lookup runs with the dropping worker excluded; if it fails, escalation proceeds to HMOD-then-Allied.
- **The home desk** runs a "below required headcount?" check. If removing the worker drops the home desk below its required headcount for the affected blocks, the home-desk gap proceeds through its own escalation independently: if the gap is within 2 hours of start, float lookup fires immediately; otherwise the standard T-3h/T-2h chain applies. If the home desk remains at or above required headcount even after the drop, no escalation fires for the home desk. Both escalations are independent of each other.

### 5.6 The Shifts Screen UI

The Shifts screen is the SW's primary workspace for managing their week. It is a three-tab layout:

**Tab 1 — My Shifts.** A consolidated view of the SW's current week, divided into three subsections from top to bottom:

1. **Picked-up shifts** (top): Shifts the SW has voluntarily claimed this week from any open-shifts feed — both home-house and cross-house pickups. Each card is marked with the picked-up indicator (Section 11.2) and, for cross-house pickups, identifies the destination house.
2. **Dropped shifts** (middle): Shifts the SW has personally dropped this week that are still open — i.e., have not yet been claimed by another worker or covered by Allied. This view helps the SW track what they've offloaded and offers a one-tap path to reclaim if they change their mind. A shift disappears from this section once it is claimed by another worker, covered by Allied, or otherwise resolved (e.g., voided).
3. **Their shifts** (bottom): The SW's regularly scheduled shifts for the week — assignments from the SM-built schedule and permanently-picked-up recurring slots — that are neither pickups nor personal drops.

**Tab 2 — Open Shifts in My House.** The weekly open-shifts feed and the permanent openings feed for the SW's home house. Shifts here can be claimed via the standard temporary or permanent pickup flows (Section 5.3, Section 8.4).

**Tab 3 — Open Shifts in Other Houses.** The weekly open-shifts feed and the permanent openings feed for every non-home house at which the SW is eligible to pick up per the matrix in Section 5.3. Shifts are grouped by house. The resolved set depends on the SW's home house:

- For a Harnwell SW: Quad + all 11 single-staff houses.
- For a Quad SW: all 11 single-staff houses (Harnwell excluded by training).
- For an SW at any of the 11 single-staff houses: Quad + the other 10 single-staff houses.

Tab 3 is empty when no eligible cross-house feed is available — e.g., during winter break, when only Harnwell is operating and only Harnwell SWs are active, every Harnwell SW's Tab 3 is empty.

The Shifts screen replaces no existing surface; it composes the open-shifts feeds (Section 5.1) and the worker's personal calendar (Section 11.2) into a single action-oriented view.

---

## 6. The Float Selection Rule

The float selection rule is invoked when the system needs to identify which workers can cover a destination's coverage gap. It runs after floatability has been confirmed (the profile permits floating and at least one source desk has slack).

### 6.1 Eligibility

A worker is eligible to be floated to a destination if all of the following hold:

- They are at a permitted source house for that destination per the absolute rules of Section 1.2:
  - Quad workers can float to any house except Harnwell.
  - Harnwell workers can float to any house.
  - Workers at the 11 single-staff houses cannot float to any destination.
- Their home desk would still have at least one worker remaining after they leave, accounting for any other workers from the same source already in pending-float or assigned-float status (Section 3.5).
- They are not already assigned to a float (acknowledged or pending) during the destination's time window.
- They are not currently working a cross-house pickup during the destination's time window. A worker on a cross-house pickup at house X is treated as a worker at house X for headcount purposes but is not floatable from there.
- They are not a Housing Manager or Building Manager (HMs may work shifts at their home desk but are never selected as floaters; BMs do not hold shift assignments at all — see Section 2.3 / 2.4).
- They have not previously declined (or failed to acknowledge) a float at this same destination house whose time window **overlaps** the current gap's window. "Overlaps" means any block-level intersection, however small; full overlap is not required. Exclusions for declines at _different_ destination houses or non-overlapping windows do not apply.
- The worker is `is_active = true` (not fired or otherwise deactivated).

**Hours cap is not checked at float assignment.** A floater works the same total hours they were already scheduled to work; the float relocates a portion of those hours from the home desk to the destination desk. A Quad worker scheduled 19:00–24:00 (5h) who is floated 21:00–22:00 to Lauder still works 5 hours total that day — 2h at Quad, 1h at Lauder, 2h at Quad again. Because floats are net-zero on weekly hours, neither the 20-hour soft cap nor the 40-hour hard cap is consulted during the float lookup or at float-acknowledgment time. (This is in contrast to claim, swap, and pickup operations, which _do_ add hours and are subject to cap checks per Section 9.)

**Harnwell as a destination.** Because Harnwell training is required and no worker hired at a non-Harnwell house can be a source, the float lookup for a Harnwell vacancy returns no candidates. Harnwell coverage gaps therefore bypass the float lookup result and proceed directly to HMOD-for-Allied at T-2h. (Off-duty Harnwell workers may still claim the open shift via the weekly feed before T-2h.)

### 6.2 The Multi-Floater Chunking Algorithm

The system never assumes a single floater must cover the entire destination gap. The gap is divided into 30-minute blocks. The system attempts to cover the gap with one or more floaters, in this order:

1. **Source priority.** The system first checks Quad for eligible workers, then Harnwell. Quad is exhausted before Harnwell is considered.

2. **Largest consecutive block run per source.** Within a source house, the system identifies the worker who can cover the largest consecutive sequence of 30-minute blocks in the destination's gap. That worker is assigned that span as their float — subject to the minimum-chunk-size rule (point 4 below). The algorithm then looks at the remaining uncovered blocks within the same source house and repeats. This continues until no more eligible workers in that source can cover any remaining consecutive runs of at least 2 blocks.

3. **Move to next source.** Once Quad is exhausted, the algorithm runs the same chunking process at Harnwell for the remaining uncovered blocks.

4. **Minimum chunk size — non-negotiable.** Any individual floater's assigned span MUST be at least 2 consecutive 30-minute blocks (a full hour). If the largest consecutive coverage a worker can provide is only one 30-minute block, that block is not assigned to them and is left for Allied. This minimum applies to every selection, including those resulting from the tiebreaker rules in Section 6.3 and the partial-coverage fallback below.

5. **Partial-coverage fallback.** If, within a source, no eligible worker can cover the full gap (or the current uncovered run), the algorithm accepts partial coverage: select the worker who can cover the _longest leading portion_ of the gap starting from the gap's start, provided that portion is at least 2 blocks. If multiple workers tie on that portion, apply the tiebreaker chain (Section 6.3) to break the tie. Allied is procured for the uncovered tail. This is a fallback, not a tiebreaker — it only applies when no worker can cover the full largest-consecutive run.

6. **Allied fills the rest.** After Quad and Harnwell have been exhausted, any remaining uncovered blocks (including those that failed the minimum-chunk-size check) are escalated to HMOD for Allied procurement.

Each floater receives their own float assignment. A 19:00 to 24:00 destination gap covered by worker B (19:00 to 21:00 from Harnwell) and worker D (21:00 to 24:00 from Harnwell) results in two distinct float assignment records.

### 6.3 Selecting Among Equally-Eligible Workers Within a Source

When the chunking algorithm has identified the largest-consecutive-coverage span and multiple workers at the source house can cover that exact span, the system selects which one to float using a tiebreaker chain. The 1-hour minimum from Section 6.2 point 4 applies to each check; a check that would select a worker who cannot meet the minimum is skipped.

Each check operates on an active **candidate set** that begins as all eligible workers covering the same largest-consecutive span (or, when the partial-coverage fallback in §6.2 #5 is active, all eligible workers covering the same longest leading portion). If a check produces multiple satisfiers rather than one, the algorithm narrows the candidate set to those satisfiers and advances to the next check on the narrowed set.

1. **Check 1 — Alignment at start.** A worker whose shift starts at exactly the float span start is a Check-1 satisfier. If exactly one candidate satisfies Check 1, float them. If multiple, narrow the candidate set and advance to Check 2.

2. **Check 2 — Alignment at end.** Within the current candidate set: a worker whose shift ends at exactly the float span end. If exactly one candidate satisfies Check 2, float them. If multiple, narrow and advance to Check 3.

3. **Check 3 — Arbitrary.** If the candidate set still contains multiple workers after Checks 1–2, the choice is arbitrary among the remaining candidates.

The minimum-2-blocks rule from §6.2 #4 applies at every check. A candidate who cannot meet the minimum is not in the candidate set to begin with.

(The previous Check 3 — "shift ends within the float span" — has been folded into the partial-coverage fallback of §6.2 #5, where it logically belongs. Tiebreakers are only invoked once the algorithm has identified workers who all cover the same selected span.)

### 6.4 The No-Takeback Rule

Once a worker has been assigned a float (whether acknowledged or pending), the **automated escalation system** will not recall them from that float to fill a gap at their source house, even if the source house later becomes understaffed.

The system does not recall the floater. Instead, the source house's gap enters the open-shifts feed and proceeds through normal escalation; if no SW claims it, the source procures Allied.

The principle is that once a float is committed, the destination is owed that coverage. Pulling the floater back via automation would leave the destination uncovered.

**Manual overrides bypass no-takeback.** An SM/HM/BM at either the source or destination house may manually remove a worker from a float assignment via the override interface. The no-takeback rule constrains automated escalation, not human authority. A manual removal voids the float; the destination block returns to `vacant` status and re-enters escalation with the removed worker excluded from any subsequent float lookup for that gap.

### 6.5 The Planned Handoff Distinction

The no-takeback rule applies to emergency recalls triggered by source-side drops. It does not apply to planned multi-worker float handoffs.

In a planned handoff (Section 6.2), worker B might be floated 21:00 to 22:00 and then return to their home desk to work 22:00 to 24:00. This return is part of the original float assignment, not a recall. The float was always going to end at 22:00; B going back is the planned end of the float, not a reversal.

### 6.6 Force-Triggered Float (SM/HM Override)

An SM, HM, or BM of a house may force-trigger a float lookup for a known coverage gap at their house before the standard escalation timing would fire. This is intended for situations where the house's manager knows in advance that no local SW will claim the shift (e.g., everyone is traveling during a break).

Rules:

1. **Initiation window.** A force-trigger may be initiated at any time from when the gap exists up to T-2 hours. Initiating a force-trigger later than T-2 hours is redundant because the standard escalation has already fired by then; the system rejects late force-trigger requests.

   **Profile gate.** Force-trigger requires the current operating profile to have floating enabled. Force-triggers are rejected during winter break and any other non-floating profile; the SM/HM has no useful path to invoke the float lookup mechanism when no source pool exists. For non-floating-profile gaps, the standard escalation chain (broadcast → HMOD-for-Allied) is the only route.

2. **Behavior.** The force-trigger bypasses the broadcast step (T-3h) entirely and bypasses the wait-for-T-2h check. It invokes the float lookup algorithm of Section 6.2 immediately with the current state of eligible workers.

3. **Floater assignment.** If the algorithm identifies one or more floaters, each is assigned a float in **pending** status. The float appears on:
   - The destination house's calendar with the worker's name and a small "(Pending)" label.
   - The source house's calendar showing the worker as floated-out with "(Pending)" label.
   - The worker's personal calendar with "(Pending)" label.

4. **Pending-float treatment.** A worker in pending-float status is counted as already absent from their source desk for the duration of their pending float. Other float lookups during the same window will not consider this worker as a source-house resource. This means a single source house can become source-exhausted via pending floats even though no worker has yet acknowledged.

5. **Source-side gap from pending float.** Because the source desk now treats the pending floater as gone, the source house may become understaffed. The resulting source-side gap immediately enters the source house's open-shifts feed where other SWs at the source house can claim it. If no one claims it, it proceeds through normal escalation (which, given the urgency, may go straight to Allied if T-2h has already passed for the source-side gap).

6. **Acknowledgment.** The pending floater receives the standard acknowledgment cadence (Section 7) and must acknowledge or decline. Upon acknowledgment, the "(Pending)" label is removed.

7. **Decline of a force-triggered float.** If the floater declines, the float assignment is voided and the destination block returns to `vacant` status, entering the open-shifts feed. The declining worker is excluded from any further float lookup for this specific gap. The standard escalation chain then resumes from the beginning: if T-3h has not yet been reached, the broadcast fires at T-3h normally; if T-3h has already passed but T-2h has not, the broadcast is skipped and float lookup fires at T-2h (with the decliner excluded); if T-2h has already passed, the gap goes directly to HMOD-for-Allied.

   **Source-side reconciliation on decline.** When the pending float was created, the source desk treated the floater as absent, which may have caused a source-side gap to enter the open-shifts feed (and possibly be claimed by another worker or covered by Allied). On decline:
   - If the source-side slot the floater would have vacated is **still vacant** (no claim, no Allied), the original floater is restored to it. Their schedule is unchanged from the pre-force-trigger state.
   - If the source-side slot **was claimed** by another worker or covered by Allied in the interim, the original floater is displaced: their schedule shows no assignment at all for the float-window blocks (neither source nor destination). The claimer or Allied retains the source-side slot; the destination remains vacant and proceeds through the escalation chain above.

8. **No recall of force-triggered floats.** The no-takeback rule (Section 6.4) applies to force-triggered floats with no exception, including pending ones. Once force-triggered, the float commitment is firm even if the floater has not yet acknowledged.

9. **Algorithm fallback.** If the force-trigger float lookup finds no eligible floater (the algorithm returns empty), the gap is escalated directly to HMOD for Allied. The standard escalation chain at T-3h/T-2h does NOT re-fire for this gap; the force-trigger has already exhausted the chain.

---

## 7. Float Acknowledgment

### 7.1 The Acknowledgment Cadence

When a float is assigned to a worker (whether through automated lookup or force-trigger), the system sends an immediate notification. The worker must acknowledge or decline the float by the **acknowledgment deadline**, which is **10 minutes before the float start time**. The deadline is decoupled from the T-2h float lookup trigger so that automated T-2h floats (assigned at T-2h) still have a meaningful acknowledgment window — roughly 1 hour 50 minutes from assignment to deadline. All reminder offsets are measured from this T-10m deadline.

If the worker has not acknowledged or declined, the system sends escalating reminders before the deadline at: **6 hours, 2 hours, 1 hour, 30 minutes, and 5 minutes** before the deadline (corresponding to 6h10m, 2h10m, 1h10m, 40m, and 15m before float start).

- The 6-hour and 2-hour reminders are configurable by HMs/BMs or the project administrator on a per-house basis, not by individual workers. Changes to these offsets take effect for float assignments created after the change; existing float assignments retain the cadence that was in effect when they were assigned.
- The 1-hour, 30-minute, and 5-minute reminders are mandatory and cannot be modified.

If the float was assigned with less than 6 hours of lead time before the deadline, the cadence starts at whichever interval is next reached. For a float assigned exactly at T-2h, only the 1h, 30m, and 5m reminders fire (the 6h and 2h reminders are already in the past).

The destination house's SM and HM can see the acknowledgment status of an inbound float on their dashboard as a passive indicator. They do not receive notifications about unacknowledged floats.

### 7.2 Declining a Float

A worker may explicitly decline a float at any point before the acknowledgment deadline. Declining is a distinct action from ignoring. When a worker declines:

- The float assignment is immediately voided.
- The declining worker is excluded from consideration for this specific gap.
- The destination block returns to `vacant` status and re-enters the open-shifts feed.
- Standard escalation continues from where it left off; if the T-2h float lookup has already run (in the case of a force-triggered float or an in-flight decline), the gap stays open until T-2h is reached on the standard chain, or until another worker claims it.

Declines do not trigger an immediate replacement cascade. The system relies on the standard escalation pathway to find a replacement or procure Allied.

### 7.3 Unacknowledged Floats and the No-Ack Trigger

If a float remains neither acknowledged nor declined at 5 minutes before the **acknowledgment deadline** (i.e., 15 minutes before the float start time), the system treats this as a probable no-acknowledgment. At this moment, the system triggers the decline-equivalent behavior:

- The float assignment is voided.
- The unresponsive worker is excluded from any further float lookup for this specific gap (per the overlap rule in Section 6.1).
- The destination block returns to `vacant` status and enters the open-shifts feed.
- Because the standard T-2h float lookup has already run (the float is post-T-2h by definition at this point), the gap goes directly to HMOD for Allied procurement. The 15-minute window before the float start is too short for another worker to commute, but if a worker happens to claim it via the open-shifts feed before HMOD acts, the claim resolves the gap.

When the destination is briefly uncovered while a replacement transits, the operational expectation is that the previous shift's worker at the destination (if any) does not leave until their relief arrives. This is an operational norm, not a system-enforced rule; the system captures assigned time, not actually-worked time. Workers may look up the floater's contact details on the calendar and call to get an ETA if needed.

The no-ack trigger offset (5 minutes before deadline) is a system-wide configurable parameter (Section 14).

The system does not distinguish "the worker was sick" from "the worker forgot" in this flow.

---

## 8. Swaps

The system supports three swap types: temporary shift swap, temporary float swap, and permanent shift swap.

### 8.1 Temporary Shift Swap

Workers A and B agree off-system to swap two specific shift spans (one or more contiguous blocks each) for one occurrence. Either worker can initiate the swap request, selecting their own shift span and the target shift span. A swap request is created. Until the counterparty accepts, the shifts remain assigned to the original workers; the calendar shows the pre-swap state.

The counterparty can accept or reject. On acceptance, both shift assignments update atomically: A now has B's original span, B now has A's original span. The calendar reflects this immediately.

Under the block-based shift model, temporary shift swaps may be for any contiguous block run, including partial shifts.

A temporary shift swap may involve float assignments, with eligibility enforced at two points:

**Pre-creation guard (UX).** Before creating a swap request, the system checks float and cross-house eligibility symmetrically for both sides: if A's span includes a float or cross-house assignment, B must be eligible for that destination per Sections 1.2, 5.3, and 6.1; if B's span includes a float or cross-house assignment, A must be eligible for that destination. The Harnwell training constraint applies in both directions. If either side fails, the system prevents the swap from being created.

**Acceptance guard (backstop).** At the moment B accepts, the system re-runs the symmetric eligibility checks. If either party is now ineligible for any assignment in the other's span, the acceptance is rejected. This backstop protects against eligibility changes between request creation and acceptance.

If both guards pass, accepting the swap transfers each party's assignments (including floats and cross-house pickups) to the other; affected destination calendars update accordingly.

**Expiry:** the swap request expires at T-3 hours of the earlier of the two spans. If no acceptance has occurred by expiry, the request is silently voided.

**Invalidation:** if either span is dropped or floated by automation before acceptance, the swap request is silently voided.

**Conflicts:** a worker cannot create or accept a shift swap request that touches a block already involved in another pending swap request of theirs.

### 8.2 Temporary Float Swap

Two workers, each independently assigned to either a desk shift or a float, agree to swap their destinations for one shift. At least one of the two swapped spans must include an active float assignment; otherwise the workers should use a temporary shift swap (Section 8.1) instead. Float swap requests are created the same way as shift swaps.

**Eligibility (symmetric).** The same Harnwell training, float direction, and cross-house eligibility constraints applied to shift swaps (Section 8.1) apply to float swaps in both directions. Pre-creation and acceptance-time checks are both run. A swap that would place a non-Harnwell-trained worker at Harnwell, or leave a single-staff desk uncovered, is rejected.

**Expiry:** the float swap request expires 24 hours after the latest end-time among the swapped spans (typically the float end time when at least one float is involved). This longer window exists because float swaps are often physical handshakes executed in real time, and the formal acceptance is a paperwork-catchup.

If the request is accepted after the shift has been worked, the calendar updates retroactively. No hours cap re-check is run against the retroactive state; the swap is accepted regardless of either worker's current cap position. If the request expires without acceptance, the calendar continues to show the original (pre-swap) assignment.

**Acceptance updates destination calendars.** When a float swap is accepted, the affected destination houses' calendars update to show the corrected floater identity, and the destination SMs and HMs are notified of the change.

### 8.3 Permanent Shift Swap

Two workers agree (off-system, verbally or by text) to swap their recurring shifts for the remainder of the period (typically a full semester). Either worker initiates the swap in-app by selecting their own recurring slot and identifying the counterparty's recurring slot to swap with. The system creates a permanent_swap request.

The SM/HM is not the executor of the swap. They may be informed but do not approve or initiate; the two affected workers handle approval directly. If the SM/HM wants to reassign a slot themselves, they use the manual override interface (Section 4.5 / Section 8.4.2), which is a distinct mechanism.

The counterparty (the second worker in the swap) receives an in-app notification and must accept or reject the swap.

**Expiry:** the permanent_swap request expires 7 days after creation. If not accepted within 7 days, it is silently voided.

**On acceptance:** the swap is executed across all affected future shift assignments in a single atomic operation. The operation applies only to weeks where Worker A currently owns the slot at the time of acceptance. Weeks where A no longer owns the slot — because A temporarily dropped it and another worker has since claimed it, or because it was swap-transferred to someone else — are skipped. The confirmation popup before acceptance lists the skipped weeks so both parties understand the scope of the exchange.

**On rejection or expiry:** no shifts are modified.

Permanent swaps apply only to SM-built schedules (regular school year). Permanent swaps do not apply to short break or winter break shifts because those shifts are claim-based and individually owned. Workers wanting to swap break shifts use the temporary shift swap workflow.

### 8.4 Permanent Shift Drop and Permanent Shift Pickup

The system supports two operations on recurring slots that affect every future occurrence within the current operating profile: **permanent drop** and **permanent pickup**. Both apply only under SM-built scheduling (regular school year); break profiles are claim-based, and each occurrence is owned individually with no recurring relationship.

#### 8.4.1 Permanent Drop

A worker who can no longer (or no longer wants to) work a recurring slot for the remainder of the operating profile initiates a permanent drop. The flow:

1. The worker selects the shift on their calendar and clicks drop.
2. A popup asks: "Drop this week only, or drop permanently for the rest of the period?"
3. If permanent is chosen, the system displays a confirmation summary: "You will drop all future occurrences of this recurring slot through [end of current profile]. This affects [N] future weeks." The worker confirms.

On confirmation, the system performs an atomic bulk operation on every future occurrence of the recurring slot where the current owner is the dropping worker. Specifically: for every shift block assignment whose house, day-of-week, and block-start-time match the recurring slot, whose date is strictly after the moment of the drop, whose date is within the **current semester's regular school year period**, and whose current owner is the dropping worker, the assignment's user is removed and the block becomes vacant. The block is flagged as part of a permanent drop so that the permanent openings feed can identify it.

**Semester scope, not contiguous-profile-run scope.** "Current operating profile" here means the current semester's regular_school_year period — fall semester (or spring semester) in its entirety, **not** the contiguous run of regular_school_year dates between break interruptions. A permanent drop made in October continues through Thanksgiving and onward to the end of fall semester. Short breaks embedded within a semester (Thanksgiving, fall break, spring break, spring fling) are claim-based and do not have recurring slots, so they are naturally excluded from the drop's scope; the recurring slot resumes for regular_school_year dates after the break. The drop does **not** continue into the next semester: a fall-semester drop has no effect on spring semester, which is built fresh.

The operation skips:

- **The current occurrence if it is mid-shift.** A drop initiated mid-shift does not include the shift currently being worked; the worker finishes that shift. Future occurrences are affected.
- **Past occurrences in the current week.** If the recurring slot's occurrence has already passed for this week, that occurrence is untouched. The drop applies only to future occurrences.
- **Occurrences not currently owned by the dropping worker.** If the slot's occurrence for some future week is currently owned by a different worker (e.g., it was swap-transferred to Bob for week 3, or Bob temporarily claimed week 5), those weeks are skipped. Only weeks where the dropping worker is the current owner are affected.

The dropping worker may permanently drop only a portion of their recurring slot (a contiguous subset of the slot's blocks). For example, a worker whose recurring slot is 19:00 to 24:00 may permanently drop just 22:00 to 24:00, retaining 19:00 to 22:00 each week.

After the drop, the affected slot's information appears in the permanent openings feed for the affected house. The SM of the house receives an in-app notification that shows the next time they open the app and persists in their updates tab. The dropping worker also has a record of the permanent drop in their own updates tab so they can refer to what they dropped and when.

#### 8.4.2 SM/HM-Initiated Permanent Removal

An SM, HM, or BM of a house may permanently remove a worker from a recurring slot through the manual override interface. The capability mirrors permanent drop: it bulk-updates all future occurrences of the recurring slot where the worker is the current owner, subject to the same exclusions (mid-shift, past, not-currently-owned).

When an SM or HM/BM permanently removes a worker, the affected worker receives an in-app notification ("Your recurring [day-of-week] [time-band] shift at [house] has been permanently removed from your schedule by [SM/HM name] for the rest of [profile name]"). The notification appears the next time the worker opens the app and persists in their updates tab. The SM/HM who initiated the removal also has a record of the action in their own updates tab.

The SM/HM is also responsible for indicating whether the removal is temporary (this week only — a standard override) or permanent. The manual override interface presents both options explicitly.

#### 8.4.3 Permanent Pickup

A worker who wants to claim a permanently-dropped recurring slot for the remainder of the operating profile initiates a permanent pickup. The slot may be at the worker's home house or at any non-home house where they are eligible per the cross-house pickup matrix (Section 5.3). The flow:

1. The worker views the permanent openings feed for their home house (Tab 2 of the Shifts screen) or for an eligible non-home house (Tab 3 of the Shifts screen). They may also see a permanently-dropped occurrence in the weekly feed marked with the permanent-drop visual indicator — Section 11.
2. The worker selects the slot. If they entered through the weekly feed, the system shows a popup offering two options: "pick up this week only" or "pick up permanently." If they entered through the permanent openings feed, only the permanent pickup flow is offered (a single-week temporary claim from this surface is handled by switching to the weekly feed entry for that week).
3. If permanent is chosen, the system evaluates the pickup across all future occurrences of the slot within the current operating profile, applying these rules to each week:
   - **Time conflict check.** For each future week, the system checks whether any block in the recurring slot's occurrence overlaps with another shift the worker is already assigned to that week. For weeks with overlap, only the non-overlapping blocks are picked up; conflicting blocks are skipped for that specific week. If all blocks conflict for a given week, the entire week is skipped.
   - **Hours cap check.** For each future week, the system computes the worker's projected total hours after the non-conflicting blocks of that week's slot occurrence are added. If the projected total would exceed the applicable cap for that week, **the entire week is skipped from the permanent pickup, regardless of whether the cap is soft or hard.** Permanent pickup is treated more conservatively than one-off temporary claims: because a single user action commits to many weeks at once, silently crossing the soft cap across many weeks would be undesirable. The skip-if-exceeded rule applies uniformly to both 20-hour soft-cap weeks and 40-hour hard-cap weeks. (A worker who specifically wants to exceed soft cap on a given week may still pick up that week individually via the weekly open-shifts feed, where the standard soft-cap warning-with-override flow applies.)

4. The system displays a confirmation popup summarizing the outcome: "You will pick up this recurring shift for [N] of [M] remaining weeks. Skipped weeks: [list of dates with reason — time conflict or hours cap]."
5. The worker confirms. On confirmation, the system performs an atomic bulk operation assigning the worker as the new owner of every applicable block. Skipped weeks remain vacant; their occurrences continue through standard weekly escalation as they approach their start times.

After permanent pickup, the slot is removed from the permanent openings feed regardless of whether the pickup was complete or partial. The worker becomes the new owner for the weeks they picked up. Skipped weeks (due to time conflicts or hours cap violations) do not keep the slot in the permanent openings feed — they surface individually in the weekly feed as they approach the 30-day horizon and undergo standard weekly escalation. There is no mechanism for another worker to permanently pick up only the skipped weeks; partial pickups are final, and skipped weeks are handled exclusively through the weekly open-shifts pathway.

The worker may, at any future point, permanently drop the slot themselves (Section 8.4.1), which returns it to the permanent openings feed with ownership reset to "vacant" — no record of prior owners is retained beyond the calendar's current state.

#### 8.4.4 Boundary Cases

- **A worker on a permanent pickup wave who also has a one-time claim conflict for one specific week:** the one-time claim takes precedence; that week is skipped from the permanent pickup. The one-time claim is not affected.
- **A worker permanently drops a slot, then later wants to permanently pick up the same slot:** allowed if the slot is still in the permanent openings feed and not yet picked up by another worker. The worker becomes the owner again.
- **A worker permanently picks up a slot, then drops a specific week temporarily:** allowed. That specific week enters the weekly feed; the rest of the recurring slot stays owned by the worker.
- **An operating profile ends with a slot still in the permanent openings feed:** the slot ceases to exist. The next operating profile's schedule is built fresh.

#### 8.4.5 Interaction with Existing Workflows

Permanent drop and permanent pickup are distinct from and coexist with:

- **Temporary drop** (Section 5.2): drops one occurrence; the recurring assignment persists.
- **Temporary claim** (Section 5.3): claims one occurrence; the recurring ownership is unchanged.
- **Temporary shift swap** (Section 8.1): swaps two specific spans; recurring ownership is unchanged.
- **Permanent shift swap** (Section 8.3): two workers atomically exchange recurring slots. Functionally distinct from permanent drop + permanent pickup: a permanent swap is one atomic operation between two willing parties; permanent drop + permanent pickup are two independent operations with an open period between them during which the slot is available to anyone and may receive Allied coverage on each weekly occurrence.

---

## 9. Hours

### 9.1 Hours Attribution

Every hour a worker works counts toward their weekly total at their home house, regardless of where they physically worked. A Quad worker floated to Lauder for 2 hours has those 2 hours counted at Quad, with a category indicator showing they were worked while floated. A Quad worker who voluntarily picked up a Lauder open shift via cross-house pickup (Section 5.3) is treated identically for attribution purposes: hours count at Quad, with a category indicator showing they were worked via cross-house pickup.

A worker's hours report shows their total hours for the week, decomposed into hours worked at home, hours worked while floated out, and hours worked via cross-house pickup.

The system counts **assigned** time, not actually-worked time. If a worker stays past their shift end because a floater is late, those extra minutes are not captured.

### 9.2 The Weekly Window

A "week" for the purposes of the hours cap is a strict calendar week: Monday 00:00 through Sunday 23:59 (inclusive). This is not a rolling 7-day window. Each calendar week resolves independently.

### 9.3 The Hours Cap and Boundary Weeks

Each calendar week has a single hours cap that applies to that week for all workers across all houses.

**Default rules for setting the cap of a week:**

- A week in which every day is regular school year defaults to 20 hours (soft cap).
- A week in which every day is winter break defaults to 40 hours (hard cap).
- A week containing one or more days of Thanksgiving, fall break, or spring break defaults to 40 hours (hard cap).
- A week containing one or more days of spring fling (but no other break) defaults to 20 hours (soft cap).
- A week straddling regular school year and a 40-hour break (Thanksgiving, fall, spring, winter) defaults to 40 hours (hard cap), on the safe side.

**Manual cap modification.** An HM or BM (of any house) may modify the cap of any specific calendar week via the system-wide cap-modifier UI. The modification is global: it applies to all 13 houses simultaneously. The HM/BM may set a week to either 20 (soft, overridable) or 40 (hard, not overridable). This prevents redundant per-house configuration and ensures uniform enforcement across campus.

The modification is instant and requires no approval. SMs cannot modify the cap; the authority is restricted to HMs and BMs.

**Effect of a cap reduction on existing state.** When the cap is lowered mid-week:

- Workers whose existing assignments already exceed the new cap are not retroactively unassigned. Their existing shifts stand.
- Pending float assignments already assigned to over-cap workers (both acknowledged floats and floats that are assigned but not yet accepted by the worker) are honored and are not voided by the cap change.
- New claims, swap acceptances, and new float assignments are blocked if they would push a worker over the new cap.
- In-flight weekly-feed claims that have not yet been submitted are validated against the new cap at submission time.

**Soft cap (20 hours).** When a worker attempts to claim a shift that would push them over 20 hours, the system shows a warning popup. The worker can dismiss the warning and proceed.

**Hard cap (40 hours).** No worker can claim a shift, be assigned a non-float shift via SM/HM override, accept a swap, or take a cross-house pickup that would push them over 40 hours in a calendar week. The cap cannot be overridden, even by an HM.

**Caps and floats.** Float assignments do not consult either cap. A floater works hours they were already scheduled to work (relocated from their home desk to the destination desk); the float is hours-neutral on the worker's weekly total. See Section 6.1.

---

## 10. Notifications

### 10.1 The Notification Routing Rules

Notifications are routed by recipient role and urgency. The system does not deliver stacked digests to HMs or BMs; HMs and BMs receive only real-time notifications during their working hours for events requiring action.

**Personal notifications** (your own shift was dropped, you've been assigned a float, your acknowledgment is overdue) are sent immediately to the affected worker. These notifications are mandatory and cannot be silenced.

**Open shift broadcasts** (T-3 hour notifications about an unclaimed shift) are sent only to subscribed SWs and SMs at the shift's home house. Broadcast subscription is opt-in and defaults to off. HMs and BMs cannot subscribe: the subscription toggle is not shown to users holding an `hm` or `bm` role, and the backend rejects any attempt to enable subscription for these roles. An SM promoted to HM has their subscription automatically revoked at the moment of role assignment.

**HM/BM notifications** are sent in real-time to **the HM only** (not the BM) when **both** the current time and the affected block's start time fall within HM working hours (Monday-Friday, [08:00, 17:00)). The BM is silent unless the HM is on leave, in which case the BM is the default replacement (Section 2.4) and receives the notification via the leave-resolution chain (Section 2.6). If either the current time or the block start time is outside HM hours, the notification is routed to the HMOD on duty instead. The HM/BM/HMOD places the call to Allied.

**SM in-app notifications.** SMs receive in-app notifications (visible on next app open, persisting in the updates tab) for events affecting their house that do not require immediate action but warrant their awareness. The primary such event is a worker permanently dropping a recurring slot at their house (Section 8.4). The SM is the operational decision-maker for whether to actively search for a permanent picker or let the weekly escalations run. SMs do not receive push notifications for these events; they appear in-app only.

**Worker in-app notifications.** Workers receive in-app notifications (visible on next app open, persisting in the updates tab) when an SM/HM permanently removes them from a recurring slot. The notification identifies the affected slot, the operator who initiated the removal, and the time period affected.

**Outside HM working hours and on weekends, no notifications go to the HM or BM.** The HMOD covers all such events. The HM does not receive a morning digest of overnight events; they may consult the calendar if they want to see what happened.

**HMOD notifications** are sent in real-time during HMOD on-duty hours (Monday-Friday 17:00 to 24:00, all day Friday 17:00 through Monday 08:00) for any event requiring Allied procurement or other immediate action.

### 10.2 Specific Routing Cases

**A drop happens at 23:00 on a Tuesday for a shift starting Wednesday at 08:00.** The shift starts at the boundary of the HM's working day. T-2 (escalation point) is 06:00 Wednesday, which is HMOD time. The HMOD is notified for Allied procurement in real-time.

**A drop happens at 23:00 on a Tuesday for a shift starting Wednesday at 15:00.** T-2 is 13:00 Wednesday, which is HM working hours. If float lookup fails, the HM receives a real-time notification at 13:00 Wednesday for Allied procurement. (Note: under the new shift-granularity rules, shifts begin only on 30-minute boundaries; 15:00 is valid.)

**A drop happens at 14:00 on a Wednesday for a shift starting that evening at 22:00.** T-2 is 20:00 Wednesday, which is outside HM working hours. The HMOD receives the escalation notification in real-time. The HM does not receive any notification.

**A drop happens at 15:00 on a Saturday for a shift starting Sunday at 14:00.** HMs do not work weekends. The HMOD handles this event from the moment of the drop through the entire escalation, in real-time.

**A float is assigned.** The floater receives a personal notification immediately. The destination house's SM and HM see the float as a passive indicator on their dashboard (no notification).

**A float fails (e.g., the worker declined or did not acknowledge by T-5 minutes).** The system runs the replacement search. If Allied is needed, the HMOD is notified in real-time regardless of the time of day, because the gap is immediate.

**An HM goes on leave or returns from leave.** The system crafts the appropriate email to the house's student workers and opens the HM's mail application with the message pre-filled (Section 2.6). The replacement (or returning HM) receives an in-app notification.

### 10.3 Information Content of Notifications

A notification to the HM or HMOD about a coverage gap requiring Allied procurement contains:

- The house needing coverage.
- The time window of needed coverage.
- The reason the system reached this step (e.g., "no floater found in Quad or Harnwell," or "floater [name] declined").

This is sufficient for the HM to place the call to Allied without consulting the app for additional information.

---

## 11. Visual Indicators

### 11.1 Shift Display on House Calendars

The shift calendar is the source of truth for who is scheduled to work where. When viewed for any specific house, shifts are displayed with the following visual treatments:

- **Normal scheduled shifts** are displayed with a default background.
- **Float-in shifts** (a worker from another house covering this house's desk via the float mechanism) are displayed with a light green background.
- **Cross-house picked-up shifts** (a worker from another house covering this house's desk because they voluntarily claimed it from this house's open-shifts feed — Section 5.3) are displayed with a light green background plus the picked-up indicator (the small circle defined in Section 11.2). The light green signals "non-home worker at this desk"; the circle distinguishes the voluntary-pickup mechanism from a system-assigned float. The worker's home house is shown adjacent to their name.
- **Pending floats** (force-triggered floats not yet acknowledged) are displayed with a small "(Pending)" label adjacent to the worker's name.
- **Allied-covered shifts** are displayed with an "Allied" label and a distinct background.
- **Shifts with gaps** (post-partial-drop) display as multiple visually separated cards covering each contiguous run.
- **Permanently-dropped shifts** (vacant occurrences of a recurring slot whose owner has permanently dropped it) are displayed with a distinct color or indicator that visually distinguishes them from one-time-vacant shifts. This makes it immediately clear when a vacancy is part of an ongoing permanent-openings situation versus an isolated this-week drop.

### 11.2 Shift Display on Personal Calendars

A worker viewing their own calendar sees their shifts with the following treatments:

- **Normal scheduled shifts** at their home desk are displayed with a default background.
- **Float-out shifts** (the worker floating to another house via the system float mechanism) are displayed with a light purple background.
- **Pending float-out shifts** are displayed with a light purple background and a small "(Pending)" label.
- **Picked-up shifts at the home desk** (claimed open shifts beyond the worker's original schedule) are marked with a small circle indicator (approximately 8 pixels) on the shift card. This applies during all operating profiles, including short break.
- **Cross-house picked-up shifts** (the worker voluntarily claimed an open shift at a non-home house — Section 5.3) are displayed with a light purple background plus the picked-up circle indicator. The light purple matches float-out semantics ("you are at a non-home desk this period"); the circle distinguishes the voluntary mechanism. The destination house is shown on the card.
- **Short break and winter break shifts** are marked with a golden border to signal they fall outside the worker's regular schedule pattern.

### 11.3 Closed Houses

When viewing the calendar for a closed house (e.g., Lauder during winter break), the house's calendar displays as "Closed" for the closure dates. No shifts are present; no open-shifts feed exists for those dates.

### 11.4 Contact Lookup from a Shift Card

Tapping or clicking any shift card reveals details about the shift, including the assigned worker's contact information. This enables a worker at the desk to call a floater (or any other scheduled worker) to confirm their ETA or status. This applies to all shift types — regular, floated, pending, and Allied.

---

## 12. The Source of Truth

The shift calendar is the system's source of truth. The current state of every block, including who is assigned, is shown on the calendar. When a drop, claim, swap, float, or Allied procurement occurs, the calendar updates immediately.

The calendar is queryable retrospectively. Workers, SMs, and HMs can scroll backward and view past dates to see who was scheduled to work specific blocks on past days.

The system does not maintain a separate audit log of state changes. The calendar's current state is sufficient for operational purposes. Float-assignment records older than 14 days past the float end date are auto-deleted to control storage growth; the calendar itself retains the assignment record permanently.

---

## 13. Permissions Summary

**Student Workers** can:

- View their own schedule, the open-shifts feeds at their home house (both the weekly feed and the permanent openings feed), and the open-shifts feeds of any non-home house where they are pickup-eligible per the matrix in Section 5.3.
- Submit preferences during scheduling windows (regular school year only).
- Claim shifts during break claim phases (calendar picker) or via the open-shifts feed (after T-1d).
- Drop their own shifts temporarily at any time. Drops for shifts more than 30 days out are accepted and held; the dropped occurrence enters the weekly feed when its start crosses the 30-day horizon. For break shifts, drops are permitted any time during the claim phase or after T-1d.
- Permanently drop a recurring slot (or a contiguous portion of it) for the remainder of the current operating profile. Available only under SM-built scheduling.
- Claim open shifts temporarily (this week only) or permanently (taking ownership of a recurring slot for the rest of the operating profile) at their home house OR at any non-home house where they are pickup-eligible per the cross-house matrix.
- Acknowledge or decline float assignments to them.
- Initiate shift swaps, float swaps, and permanent shift swaps with other workers.
- Subscribe or unsubscribe to broadcast notifications.

**Student Managers** can do everything an SW can do, plus, for their home house only:

- Build the initial schedule (regular school year).
- Override the live schedule, including temporary removal of a worker from a specific week's slot and permanent removal of a worker from a recurring slot for the rest of the operating profile. The manual override interface presents both options explicitly.
- Initiate permanent shift swap requests.
- Force-trigger a float lookup before T-2h.

**Housing Managers (HM)** can do everything an SM can do for their home house, plus:

- Override SM actions in their house, including permanent removal.
- Override cross-house workers at their desk. Both the destination-house SM/HM (the house where the cross-house worker is assigned) and the source-house SM/HM (the worker's home house) may override or remove a cross-house worker's assignment. Both sides have authority; the last write wins.
- Work scheduled shifts at their own desk and claim open shifts (in-house or cross-house per the standard eligibility matrix).

HMs are explicitly **excluded** from the float lookup eligibility pool and from broadcast notification subscriptions. They never receive system-assigned floats. The subscription toggle is not available to users holding the `hm` role; any existing subscription is revoked automatically at the moment of HM role assignment.

**Building Managers (BM)** hold the same administrative powers as HMs (overrides, force-triggers, notifications, leave, HMOD eligibility) but are **admin-only as workers**:

- BMs do not hold scheduled shifts.
- BMs cannot claim open shifts, submit preferences, or be assigned via the schedule-builder.
- BMs are excluded from the float lookup eligibility pool.
- BMs are excluded from broadcast notifications.

Both HMs and BMs can:

- Receive escalation notifications during HM working hours (HM is the primary recipient; BM receives notifications only when HM is on leave and BM is the resolved replacement per Section 2.6).
- Place Allied calls.
- Set or end their own leave (and select a replacement).
- Modify the global weekly hours cap for any calendar week.
- Serve as HMOD on rotation.

**Housing Manager On Duty** holds HM permissions across all 13 houses while on duty, with notifications routed per the HMOD schedule.

---

## 14. System-Wide Configurable Parameters

The following parameters are system-wide configurable by the project administrator. They are initialized with the defaults shown but may be modified post-launch:

- **Escalation chain offsets** (per profile): broadcast at T-3h, float lookup at T-2h, HMOD notification at T-2h.
- **Acknowledgment deadline**: 10 minutes before float start (decoupled from the T-2h float lookup trigger so that automated T-2h floats have a meaningful acknowledgment window).
- **No-ack trigger offset**: 5 minutes before the acknowledgment deadline (i.e., 15 minutes before float start). Configurable system-wide.
- **Acknowledgment cadence**: 6h (configurable per house by HM/BM or project administrator), 2h (configurable per house by HM/BM or project administrator), 1h (mandatory), 30m (mandatory), 5m (mandatory) before the **acknowledgment deadline**. Changes to the 6h and 2h offsets apply to float assignments created after the change; existing assignments retain the cadence in effect at creation time.
- **Claim-phase checkpoints**: T-14d (open), T-3d (alert), T-1d (close to calendar picker, enter open-shifts feed).
- **Drop horizon**: 30 days.
- **Shift block granularity**: 30 minutes.
- **Float assignment retention**: 14 days past float end date.
- **Permanent swap expiry**: 7 days.
- **Float swap expiry**: 24 hours after float end time.
- **Shift swap expiry**: T-3h of the earlier shift.
- **Minimum float chunk size**: 2 blocks (1 hour). Non-negotiable in the algorithm.
- **HM working hours**: Monday-Friday 08:00 to 17:00.
- **HMOD rotor cadence**: weekly, Friday 08:00 handoff.

Once finalized via project committee feedback, the administrator may update these. All updates apply system-wide and take effect at the start of the next orchestrator tick. Individual users do not have direct control over these values except for the per-worker tweakable acknowledgment reminders (6h and 2h).

---

## 15. Pending Items

The following items are marked as pending and will be resolved before launch:

- **Additional winter break operational specifics.** Winter break has some specifics not yet captured here. These will be added once observed during the upcoming winter or learned during training.
- **Short break list.** The exact dates of fall break, Thanksgiving, spring break, spring fling, and any other named short breaks for each academic year are populated by an administrator using the published academic calendar.
- **Pending global configuration.** The project administrator may identify additional parameters that should be made globally modifiable based on project committee feedback. Section 14 will be updated accordingly.

---

## Appendix A: Confirmed Decisions Captured in v2

The following decisions were confirmed during v2 drafting:

1. **Force-trigger source-side gap behavior:** When a force-trigger creates a pending float and the source desk becomes understaffed, the source-side gap enters the source's open-shifts feed immediately.
2. **Decline behavior:** When a worker declines (or fails to acknowledge by the T-5-pre-deadline trigger), the float is voided and the gap re-opens to the standard escalation pathway. The declining worker is excluded from re-consideration for that gap. The system does not run an immediate cascade.
3. **Acknowledgment cadence anchor:** All reminder offsets (6h, 2h, 1h, 30m, 5m) are measured from the **acknowledgment deadline**, not from the float start time. **[Errata]** This item originally said "T-2h deadline"; the canonical deadline (per §7.1, §4.4, Appendix B, and the implementation) is **T-10m before float start**. Read "acknowledgment deadline" as T-10m before float start.
4. **Global cap modification authority:** HM/BM only; SMs cannot modify the weekly cap. Instant, no approval workflow.
5. **Permanent swap rejection:** Replaces the prior unilateral-SM-execution model with an in-app accept-reject flow with 7-day expiry. The SM is excluded from the swap; the two workers approve directly.
6. **Float-assignment auto-deletion:** Acceptable to lose acknowledgment timing data after 14 days; the calendar retains the float-shift record (which is the operationally relevant data).
7. **HMOD rotor location:** Stored as a separate table keyed by Friday-of-week (Friday 08:00 duty-week start).
8. **Winter claim-phase checkpoints:** Same as short break (T-14d / T-3d / T-1d) for each date in the winter period.
9. **"I'm back" attribution:** Past actions during the leave remain attributed to the replacement; the HM resumes from the moment of click forward.
10. **Force-trigger granularity:** Spans are snapped to 30-minute block boundaries.

## Appendix B: Permanent Drop and Permanent Pickup (v3 Addition)

The following decisions govern the permanent drop and permanent pickup workflows added in v3:

1. **Scope:** Permanent drop and permanent pickup apply only under SM-built scheduling (regular school year). Break profiles are claim-based and each occurrence is owned individually; permanent drop and pickup do not apply.
2. **Persistence:** "Permanent" means "for the remainder of the current operating profile." Drops do not carry over into the next profile; the next profile's schedule is built fresh.
3. **Drop initiation:** Triggered by a popup at temporary-drop time. The popup asks "drop this week only, or drop permanently for the rest of the period?"
4. **Mid-shift exclusion:** A permanent drop initiated mid-shift does not include the currently-running occurrence; it affects only future occurrences.
5. **Ownership boundary:** A permanent drop only affects future occurrences where the dropping worker is the current owner. Occurrences swapped to another worker, claimed by another, or held by anyone else are not touched.
6. **Partial permanent drops:** Supported on contiguous block runs within a recurring slot.
7. **SM/HM-initiated permanent removal:** SMs, HMs, and BMs can permanently remove a worker from a recurring slot through the manual override interface, which presents temporary-only and permanent-only options explicitly. The affected worker receives an in-app notification.
8. **Permanent openings feed:** A separate tab in the open-shifts UI showing recurring slots with permanent vacancies. Visible to all SWs, SMs, and HMs/BMs of the affected house regardless of broadcast subscription.
9. **Pickup conflict resolution:** Lenient — for each week in scope, time conflicts cause specific conflicting blocks to be skipped for that week; hours cap violations cause the entire week to be skipped. Other weeks are picked up normally.
10. **Notifications:** Both SW and SM/HM get an in-app notification (no push) and a persistent record in their respective updates tabs whenever a permanent drop or removal occurs.
11. **No history retention:** Calendar holds only the current state; no log of past ownership beyond what's currently assigned.
