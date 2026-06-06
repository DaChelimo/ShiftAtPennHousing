# Design brief — Shift@PennHousing

> A self-contained brief to paste into Claude design to generate the frontend in
> one pass. Primary focus: the **HM** and **SM** desktop web app. Secondary: the
> **SW** companion views. Design system: **IBM Carbon**. Brand primary: `#0061FC`.

---

Design a web product UI for **Shift@PennHousing**, the shift-scheduling and
coverage system for Penn's 13 residential housing desks. Produce a cohesive,
multi-screen high-fidelity design in **IBM Carbon Design System**. Primary focus:
the **Housing Manager (HM)** and **Student Manager (SM)** desktop web app.
Secondary: the **Student Worker (SW)** companion views (responsive/mobile-leaning).

Aesthetic north star: **minimal, sleek, calm, enjoyable** — Carbon's structure
and tokens, expressed the way a modern productivity tool would (think the
restraint of Linear / Vercel / Stripe dashboards, built on Carbon). Generous
whitespace, hairline dividers, one confident blue accent against near-black and
white, data-dense only where the work demands it (the calendar, rosters).

---

## 1. The product in one paragraph

Every weekday a person must be at each of 13 housing desks during operating hours
(08:00–24:00, in 30-minute blocks). Student Managers build each house's weekly
schedule from worker preferences; once published, the live **shift calendar is the
single source of truth**. When a worker drops a shift or a gap appears, an
automated escalation chain tries to fill it (broadcast → automated "float" of a
worker from another desk → human fallback to call external "Allied Security").
Housing Managers supervise, override the live schedule, handle the human-judgment
moments (procure Allied coverage, manage leave, set the hours cap), and rotate as
the after-hours on-call manager (HMOD). The UI's job is to make a complex,
time-critical coverage machine feel legible and calm.

---

## 2. Who uses it (roles — design the nav and permissions around these)

- **SW — Student Worker.** Staffs a desk. Drops/claims shifts, accepts/declines
  float assignments, swaps with peers, submits preferences. _(Secondary, mobile-first.)_
- **SM — Student Manager.** An SW with powers over **their one house**: builds the
  schedule, overrides the live schedule, force-triggers float lookups, initiates
  permanent swaps. _(Primary.)_
- **HM — Housing Manager.** Everything an SM can do **plus** override SM actions,
  work/claim shifts, manage people, go on leave, set the global hours cap, serve
  as HMOD. _(Primary.)_
- **BM — Building Manager.** Same admin powers as an HM but **never works shifts**
  (admin-only). Covers for the HM during leave. _(Shares HM screens.)_
- **HMOD — Housing Manager On Duty.** A duty _mode_, not a person: one HM/BM at a
  time is on-call across **all 13 houses** evenings/weekends. When in HMOD mode the
  house switcher unlocks to all houses and the action inbox spans the whole campus.

Roles stack (an HM is also an SM and SW). Effective permissions are the union.

---

## 3. Domain primitives the UI must represent

- **Houses (13).** **Harnwell** (2 staff, training-restricted — only Harnwell-trained
  workers may ever staff it), **Quad** (3 staff), and **11 single-staff houses**.
  Single-staff desks can't spare anyone (no float-out).
- **Blocks.** Everything is 30-minute blocks on 30-minute boundaries, 08:00–24:00.
  No sub-block UI ever. A "shift" is a contiguous run of blocks.
- **Float.** The system relocates an already-scheduled worker from a multi-staffed
  desk to cover another desk's gap. Hours-neutral. Inbound floats need worker
  **acknowledgment**; unacknowledged/declined floats re-escalate.
- **Escalation timeline.** An open gap moves **T-3h: broadcast → T-2h: automated
  float lookup → fallback: HMOD calls Allied Security.** After T-2h a shift is
  "unpickable." This timeline is a recurring visual motif — show where a gap is on it.
- **Profiles.** Regular school year (SM-built schedules, 20h soft cap), Short break
  (claim-based, mostly 40h hard cap), Winter break (only Harnwell open, 40h hard cap).
  Closed houses render literally as **"Closed."**

---

## 4. Visual language

### Design system

**IBM Carbon (v11).** Use the Carbon UI Shell, type scale, 2x grid, spacing tokens
(8px base), data tables, structured lists, tags, notifications, modals, dropdowns/
combo-boxes, date pickers, toggles. Lean to Carbon's cleaner/expressive end.

### Color

Brand primary is a bright, professional blue — note it sits right next to Carbon's
own Blue 60, so keep them harmonized. Pair it with a near-black neutral family.

| Token                          | Hex                            | Use                                                  |
| ------------------------------ | ------------------------------ | ---------------------------------------------------- |
| **Primary / interactive**      | `#0061FC`                      | Primary buttons, links, active nav, focus, selection |
| Primary hover / active         | `#0050D6` / `#0043B3`          | States                                               |
| Primary subtle / selected tint | `#EDF3FF` bg, `#D0DFFF` border | Selected rows, drag highlight                        |
| **Near-black (text/UI)**       | `#161616`                      | Body text, headings, dark surfaces                   |
| Dark surface / heading         | `#262626` / `#393939`          | Side-nav dark, emphasis                              |
| Secondary text                 | `#6F6F6F`                      | Captions, meta                                       |
| Border / divider               | `#E0E0E0`                      | Hairlines                                            |
| App background / surface       | `#F4F4F4` / `#FFFFFF`          | Canvas / cards                                       |

**Semantic shift-state colors — these are load-bearing, not decorative.** The live
calendar encodes mechanism in color; reproduce these meanings exactly, and _always_
pair color with a text tag + icon (never color alone):

| State                                                                         | Treatment                                                                                                          |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Normal scheduled (home)                                                       | Default white/`#F4F4F4` card, `#161616` text                                                                       |
| **Float-in** (non-home worker covering this desk)                             | Light green card `#DEFBE6`, accent `#24A148`, tag "Float-in", shows worker's home house                            |
| **Cross-house pickup** (at this desk)                                         | Same green **+ small 8px filled circle** (pickup dot) + home-house label                                           |
| **Float-out** (your personal calendar — you're away at another desk)          | Light purple card `#F6F2FF`, accent `#8A3FFC`                                                                      |
| **Cross-house pickup** (your personal calendar)                               | Purple **+ 8px pickup dot** + destination house                                                                    |
| **Pending float** (force-triggered, not yet acknowledged)                     | Base color (green in / purple out) **+ amber "(Pending)" tag** `#B28600`                                           |
| **Allied-covered**                                                            | Distinct teal/neutral `#D9FBFB`/`#007D79`, **"Allied" tag**                                                        |
| **Break shift** (short/winter)                                                | **Golden border** `#F1C21B` around the card                                                                        |
| Vacant — one-time gap                                                         | Dashed `#C6C6C6` border, `#6F6F6F` "Open"                                                                          |
| **Vacant — permanent opening** (owner permanently dropped the recurring slot) | Distinct magenta `#EE5396` border / `#FFF0F7`, **"Permanent opening" tag** — visibly different from a one-time gap |
| Picked-up at home desk                                                        | Default card **+ 8px pickup dot**                                                                                  |
| Over-cap / blocked / urgent (needs Allied)                                    | Carbon Red `#DA1E28`                                                                                               |

### Type & feel

**IBM Plex Sans** for UI, **IBM Plex Mono** for times/IDs. Carbon productive type
scale. Tight, confident headings; 14px body; 12px meta. Subtle, fast micro-motion
(120–160ms). Tone of voice: precise, plain, reassuring. Provide **light theme
primary** and a **Carbon Gray 100 dark theme** variant for the calendar-heavy screens.

---

## 5. Global app frame

- **Carbon UI Shell**: top header (product name, global house-context switcher,
  HMOD-on-duty indicator, notification bell with count, user menu) + collapsible
  left side-nav.
- **House context switcher**: locked to home house for SM/HM; unlocked to all 13
  when acting as HMOD or admin. Closed houses show a "Closed" state.
- **Role-aware nav.** Surface only what the role can do. Suggested groups:
  _Calendar · Schedule builder · Coverage · Inbox · People · Hours & cap · Leave ·
  HMOD rotor · System (admin)._
- Desktop-first for HM/SM. SW views are responsive and read like a phone app.

---

## 6. PRIMARY screens (HM / SM) — design these in full

### 6.1 Live house calendar — _the centerpiece_

The source of truth. A time grid: rows = 30-min blocks 08:00→24:00, columns = days
(week view) with a single-day focus view too. Each cell shows assigned worker(s) as
cards using the **§4 state colors/tags**. Multi-staff desks (Harnwell 2, Quad 3)
stack multiple cards per block; gaps render as separate cards. Include: house
switcher, week navigation with **retrospective scroll** (past days are queryable),
a persistent **state legend**, and a "now" line. Clicking any card opens a
**shift detail / contact panel** (worker, time span, status, phone — "Call" action,
e.g. to check a floater's ETA). HM/SM can **override inline** here: add / remove /
reassign a worker on a block, with this-week-only vs permanent options, and a
warning-confirm when overriding a worker's "cannot" / opt-out. Show closed houses as
"Closed."

### 6.2 Schedule builder (SM/HM, desktop-only)

Build a house's week from preferences, in two phases then publish.

- A drag-picker over the same time grid: drag a span of **2–12 consecutive blocks**;
  a **side card** appears.
- **Phase 1 (preference-assisted):** side card groups submitted workers into
  **Preferred / Available / Blocked**; blocked rows are non-selectable and show the
  blocking reason (e.g. "Cannot — 18:30" or "No preference submitted"). Each row:
  name, status, **hours-remaining vs target**. Assigning over target → warning popup
  (dismissible; soft cap).
- **Phase 2 (manual override):** side card lists the **entire house roster**,
  searchable, scrollable, sorted by name, with assigned-hours; any worker assignable;
  "cannot"/opt-out downgraded to an **advisory confirm**.
- A Phase 1 / Phase 2 toggle, a "selected-blocks" override panel, and a **Publish**
  flow (confirm modal → published badge with "N scheduled" stat).
- Show the **desktop-only** empty state for narrow viewports.

### 6.3 Coverage & open-shifts monitor

A live operational board of everything needing coverage at the house (and all
houses in HMOD mode): the **weekly feed** (gaps within 30 days) and the **permanent
openings feed** (recurring slots whose owner permanently dropped them). Each gap
shows house, time window, and **where it is on the escalation timeline** (T-3h
broadcast / T-2h float lookup / awaiting Allied), plus inbound-float
**acknowledgment status** as a passive indicator (e.g. "Floater: Maya — pending ack,
2h reminder sent"). Primary action per gap: **Force-trigger float** (6.5).

### 6.4 Action inbox / notifications (critical HM surface)

The human-in-the-loop queue. HMs get **real-time, action-required** alerts during
working hours (Mon–Fri 08:00–17:00); the HMOD gets them off-hours/weekends across
all houses. The signature item is an **Allied-procurement alert** — a Carbon
actionable notification carrying exactly: **house, time window of needed coverage,
and the reason** ("no floater found in Quad or Harnwell" / "floater Maya declined") —
with a single **"Call Allied / Mark covered"** action. Also surfaces SM in-app items
(a worker permanently dropped a slot at your house) and leave/coverage changes.
Design read/unread, urgency, grouping, and a clean empty state ("All clear — no
action needed"). This is the product's quiet hero: most healthy weeks it's empty.

### 6.5 Force-trigger float (modal/flow)

From a known gap, an SM/HM invokes the float lookup early. Confirm dialog →
on success show the assigned **pending** floater(s) (who, from which source house,
appearing as "(Pending)" on calendars); on no candidate, route to HMOD-for-Allied.
Respect the **no-takeback** rule (once pending, automation can't revoke — only manual
override). Gate it out during non-floating profiles (winter break) with a clear note.

### 6.6 People / roster (HM/BM)

A Carbon data table of the house's workers: name, role(s), home house, weekly hours
vs cap, status. Actions: **Hire** (add worker, then assign via override — one-time or
permanent) and **Fire** (a destructive confirm modal: explains it vacates all their
shifts, voids their floats, and deactivates the account; mid-shift gaps escalate
immediately). Role badges; HM/BM nuances (BM = admin-only, no shifts).

### 6.7 Leave management (HM/BM)

Set leave dates, pick a **replacement** (default = the house's BM/HM) from a combo-box
that **excludes anyone who would create a delegation cycle** (with a helper note).
On submit, show a "leave recorded" state with an **"Open pre-filled email"** action
(the user emails their student workers themselves). List **active leaves** with cover
name and an **"I'm back"** early-return action (also yields a pre-filled email).

### 6.8 HMOD rotor (HM/BM)

Plan the semester's on-call rotation: a table of **weeks (Friday-08:00 handoffs)** ×
an HMOD assignee dropdown per week. Save action with saved/error states. Empty state
when no active semester.

### 6.9 Weekly hours cap (HM/BM)

A **global** control (applies to all 13 houses at once — make that prominent). Pick a
week, set **20h (soft, overridable)** or **40h (hard, enforced)**, add audit notes →
shows who/when/notes. Below: a table of upcoming weeks with effective cap and source
(profile default vs manual override).

### 6.10 Hours reports

Per-worker weekly hours **decomposed** into _worked at home / worked while floated-out
/ worked via cross-house pickup_, against the week's cap. Clean table + a small
breakdown viz.

### 6.11 Preferences oversight (SM)

Set the submission **deadline**; track who has/hasn't submitted (submitted / "no
hours" / not-yet) and reminder status (5d/3d/1d). A roster-completion view that sets
up the builder.

### 6.12 System config + orchestrator health (project admin)

- **Config:** editable list of system parameters (escalation offsets, ack cadence,
  drop horizon, expiries…) each with value + audit notes + last-modified-by.
- **Health:** a compact read-out of the once-a-minute orchestrator tick (last tick,
  blocks scanned, steps fired, floats voided, swaps expired, errors).

---

## 7. SECONDARY screens (SW) — responsive, phone-leaning

### 7.1 Shifts (the SW home) — 3 tabs + Updates

- **My Shifts:** three stacked sections — **Picked-up**, **Dropped** (with one-tap
  **Reclaim**), **Their shifts** (scheduled). Empty-state each section.
- **Open Shifts in My House:** weekly feed + permanent openings; **Claim** per card,
  disabled past T-2h (still visible, labeled "Unpickable").
- **Open Shifts in Other Houses:** cross-house-eligible feeds grouped by house;
  empty when none (e.g. winter break).
- **Updates:** in-app notifications; a **pending float** surfaces here and opens the
  ack flow (7.5).

### 7.2 Personal calendar

The worker's own week with **§4 personal treatments**: float-out = purple, pickup
dot, break = golden border, "(Pending)" labels. Tap a card → detail/contact.

### 7.3 Preference submission

Calendar where the worker marks each block **Preferred / Available / Cannot**, sets a
**target weekly hours** (0–cap), or taps **"No hours."** Submit before deadline;
post-deadline = read-only.

### 7.4 Break claim picker

For winter/short breaks: the break period is **highlighted**; workers **claim** empty
shifts first-come-first-served, can **drop back to the pool** until T-1d, or tap
**"No break hours."**

### 7.5 Float acknowledgment

A focused **Acknowledge / Decline** screen for an assigned float: destination house,
time, deadline (10 min before float start) and the escalating-reminder context. Hard
cap context where relevant.

### 7.6 Drop / claim / swap flows (modals)

- **Drop:** "this occurrence vs permanently"; short-notice warning if <20 min out;
  mid-shift drop snaps to 30-min boundaries.
- **Claim:** soft-cap → "Claim anyway"; hard-cap → blocked.
- **Swaps:** initiate/accept temporary shift swap, float swap, permanent shift swap;
  show eligibility and the skipped-weeks summary for permanent ones.

---

## 8. Cross-cutting components & states (please include a style-tile/components frame)

- Buttons (primary blue / secondary / danger / ghost), tags & status pills (the shift
  states), Carbon notifications (inline, toast, **actionable**), modals (incl. danger),
  combo-box & dropdown, date picker, toggle (broadcast subscription — **hidden for
  HM/BM**), data table, structured list, tabs, empty states, skeleton/loading, error.
- The **escalation-timeline** chip/visual and the **8px pickup dot** as reusable atoms.
- Show each meaningful screen's **empty / loading / error** and **light + dark**.

## 9. Accessibility & responsiveness

- WCAG 2.1 AA contrast on all text and the state colors. **Never encode meaning in
  color alone** — every shift state carries a text tag + icon.
- Full keyboard nav, Carbon focus rings (`#0061FC`).
- HM/SM admin = desktop-first (schedule builder is desktop-only). SW views = responsive
  down to phone.

## 10. Deliverables & priority

Produce high-fidelity frames in this order:

1. **Style tile / components** (color, type, the shift-state legend, key Carbon parts).
2. **Live house calendar** (week view, light + dark) + shift detail/contact panel.
3. **Schedule builder** (Phase 1 and Phase 2, with the side card + a confirm modal).
4. **Coverage monitor** and **Action inbox** (incl. an Allied-procurement alert).
5. Admin set: **People/roster**, **Leave**, **HMOD rotor**, **Weekly cap**.
6. **SW Shifts** (3 tabs + Updates), **personal calendar**, **float acknowledgment**,
   **preference submission** (phone frames).
7. Supporting: hours report, config, health, login.
   Keep one consistent system across all frames.
