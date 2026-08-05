# Shift@PennHousing — User Guide Site

**Rough sketch. Structure and content only.**
This document settles _what the site is and what is on each page_. It deliberately does
not settle how it looks. The visual design is a separate session (see §10), and the build
is a third.

Status: draft for review
Date: 2026-08-01

---

## 1. Why this exists

Today the only way to explain Shift to someone is a slide deck. Decks work once, in a
room, with a presenter. They do not work as a reference: they grow past the point of
usefulness, they cannot be linked into, and nobody re-reads slide 34 to remember how
floating picks a worker.

This site replaces the deck as the durable explanation. It has to serve four readers who
want very different depths:

| Reader                        | What they came for                                        | Depth      |
| ----------------------------- | --------------------------------------------------------- | ---------- |
| **Student worker**            | "How do I pick up a shift / swap / what is this float?"   | Task-level |
| **Manager (SM, RSM, HM, BM)** | "How do I build a schedule, and what do I do when paged?" | Task-level |
| **RHS IT**                    | "What is this thing, what does it touch, is it sane?"     | System     |
| **Housing leadership**        | "What does it do and why does it behave that way?"        | Concept    |

The site's job is to let each of those four land, orient, and stop reading at the depth
they actually need. Everything else is layout in service of that.

### Non-goals

- Not an internal engineering doc. BEHAVIORAL_SPECIFICATION.md and ARCHITECTURE.md stay
  the source of truth for how it is built. This site restates observable behavior in
  plain language; it does not describe tables, RPCs, or Edge Functions.
- Not a policy document. Where the app enforces a Penn RHS policy, we say what the app
  does, not whether the policy is right.
- Not a changelog or a roadmap.
- Not gated. Public, static, no login. It therefore contains no real names, real phone
  numbers, or real schedules — see §8.

---

## 2. The three sections

The site splits by **who you are and what you are trying to do**, not by device:

1. **For Student Workers** — the mobile app plus the worker web portal, treated as one
   product with two front doors.
2. **For Managers** — the web console: schedule building, coverage, people, hours, admin.
3. **How the System Works** — the concepts that sit underneath both: the coverage ladder,
   floating and its heuristics, hours, roles, the operating calendar.

Section 3 exists because floating, escalation, and hours attribution are not features of
one surface. A worker meets floating as a notification; a manager meets it as a name in
their grid; IT meets it as an algorithm. Documenting it three times inside two
device-shaped sections would guarantee three drifting versions of the same explanation.
Instead, sections 1 and 2 explain _what you do_, and link into section 3 for _why it did
that_.

There is a fourth, thin, top-level thing that is not a section: a **landing page** and a
**Getting started** page, described in §3.

---

## 3. Page map

Every section opens with an **Overview** page that is a real page, not a redirect: a
short framing paragraph, then a linked card grid of everything beneath it. This is the
pattern the Claude Code docs use and it is the single most important structural decision
here. A reader should be able to answer "what is in this section" without expanding the
sidebar, and jump straight to the one page they want.

```
/                                   Landing
/getting-started                    Getting started (role picker → 3 paths)

/workers                            OVERVIEW — For Student Workers
  /workers/signing-in               Signing in and setting up
  /workers/your-week                Your week: My Shifts
  /workers/picking-up               Picking up open shifts
  /workers/dropping                 Dropping a shift
  /workers/dropping-permanently     Dropping every week      ◄ split 2026-08-02
  /workers/swapping                 Swapping and handing off
  /workers/floating                 When you get floated
  /workers/preferences              Submitting availability
  /workers/breaks                   Break shifts
  /workers/your-house               Your house schedule and contacts
  /workers/hours                    Your hours
  /workers/notifications            Notifications and widgets
  /workers/assistant                Asking the desk assistant
  /workers/web-portal               Doing all of this on the web

/managers                           OVERVIEW — For Managers
  /managers/roles                   Which manager are you?
  /managers/building-a-schedule     Building a schedule
  /managers/ai-assist               AI-assisted building
  /managers/publishing              Publishing a schedule
  /managers/editing-published       Editing a published week ◄ split 2026-08-02
  /managers/coverage                The coverage inbox and Allied requests
  /managers/people                  People: hiring, roles, transfers
  /managers/hours                   Hours reporting and caps
  /managers/preferences-admin       Preferences and deadlines
  /managers/breaks-admin            Setting up break periods
  /managers/seasons                 Operating seasons and the calendar
  /managers/knowledge-base          The knowledge base
  /managers/launch                  Launching a house

/system                             OVERVIEW — How the System Works
  /system/concepts                  Core concepts (blocks, seats, houses, desks)
  /system/roles                     Roles and the duty hierarchy
  /system/calendar                  The operating calendar and seasons
  /system/coverage-ladder           How a shift gets covered
  /system/floating                  Floating: overview          ◄ the big one
  /system/floating/deep-dive        Floating: the selection rule ◄ the big one
  /system/swaps-explained           How a swap actually resolves
  /system/hours-rules               Hours, caps, and attribution
  /system/notifications-rules       What triggers a notification
  /system/glossary                  Glossary
```

**42 pages** (written as 39; the map listed 40, and 40 was built; two pages were split in
two on 2026-08-02, see below). That is more than a deck but each one is short: the point of
the split is that no page carries two ideas.

**Two pages were split on 2026-08-02**, when the first drafts written against the editorial
contract failed its single-task gate. `/workers/dropping` carried four paths (this week,
partial, mid-shift, and permanent) and `/managers/publishing` carried two tasks, which its
own title admitted with the word "and". In both cases one task got the steps and the
screenshot while the other got an orphan sentence filed under the wrong heading. The tell is
in the title and in the page's question: **if either needs the word "and", it is two pages.**
That check now runs before a writer is spawned, not after a draft exists.

The map lives in code at `apps/docs/src/nav.ts`, which drives the sidebar, the overview
card grids, and the previous/next links. Adding a page means adding the MDX file **and**
its entry there.

### Sidebar

Left sidebar, three collapsible groups matching the three sections, current page marked.
The overview page of each section is the group header and is itself clickable. No
third-level nesting except under `/system/floating`.

### Tabs, used sparingly

Tabs are for **the same task on a different surface**, never for different content. The
only places tabs earn their keep:

- `/workers/*` task pages where the flow differs between **iOS / Android / Web**.
- `/managers/roles` — one tab per role.

Anywhere else, tabs hide content from search and from a reader scanning the page, so we
use headings instead.

### Cross-linking rules

- Every worker task page that touches a system concept links to `/system/*` **once**, at
  the point of first mention, inline.
- Every `/system/*` page ends with a "Where you see this" list linking back to the worker
  and manager pages it governs.
- Glossary terms get a link on first use per page, not every use.

---

## 4. Section 1 — For Student Workers

The controlling idea: a worker's whole relationship with this app is **five verbs** —
see, pick up, drop, swap, acknowledge. Everything else is context. The section is ordered
so a new hire can read it top to bottom on their first day, and a returning worker can
land on one page from a link.

| Page              | What it covers                                                                                                                                                                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Signing in**    | Getting the app, the one-time code sign-in, what to do if your house is not live yet, allowing notifications and why it matters. Ends with the first-run tour.                                                                                                             |
| **Your week**     | The My Shifts tab: the three groups (picked up / dropped / scheduled), week navigation, what each colour and badge means, past days folding away.                                                                                                                          |
| **Picking up**    | The two feeds — this week's openings vs. permanent openings — and the difference between taking one week and taking a recurring slot for the rest of the term. Picking up at another house. Why a shift you can see might not be claimable. Hours-cap warning vs. refusal. |
| **Dropping**      | Drop this week vs. drop permanently. Dropping part of a shift. Dropping mid-shift and the 30-minute rounding. Reclaiming. What happens after you drop (link to the coverage ladder).                                                                                       |
| **Swapping**      | The full multi-step flow, and the one-sided handoff. This is a deep page — see §6.                                                                                                                                                                                         |
| **Floating**      | The worker-facing half: what a float is, the acknowledgment card, the reminder cadence, declining, what happens if you ignore it. Links to the deep dive for _why you_.                                                                                                    |
| **Preferences**   | The paint-the-week gesture, what "preferred / available / unavailable" mean to the builder, the deadline, and that preferences are input, not a guarantee.                                                                                                                 |
| **Breaks**        | Why breaks work differently: claim-based, the calendar picker, first-come-first-served, the 40-hour cap, what happens to unclaimed break shifts.                                                                                                                           |
| **Your house**    | The house week grid, worker colours, tapping a block to get a contact card, the desk phone number.                                                                                                                                                                         |
| **Your hours**    | The weekly total, the soft cap, and where hours land when you work at another house.                                                                                                                                                                                       |
| **Notifications** | Every notification a worker can receive, in a table: what it means and what it wants from you. Home-screen widgets.                                                                                                                                                        |
| **Assistant**     | What it can answer, what it cannot, and that it reads the knowledge base rather than making things up.                                                                                                                                                                     |
| **Web portal**    | The same tasks in a browser, and the small number of things that are app-only.                                                                                                                                                                                             |

Each task page follows the same skeleton, which is worth fixing now so the design session
has something concrete to style:

```
H1  Task name
    One sentence: what this is for.
    ┌ Screenshot or diagram ─────────┐
    └────────────────────────────────┘
H2  Do it            → numbered steps, one action per step
H2  What you'll see  → the result state
H2  Rules that apply → short bullets, each linking to /system/*
H2  If it goes wrong → the 2-3 real failure states and what they mean
    ── Related: 3 links ──
```

---

## 5. Section 2 — For Managers

The controlling idea: managers do two unrelated jobs — **build ahead** and **respond
now** — and the console mixes them. The section separates them explicitly and says which
role does which.

- **Build ahead:** preferences → build → AI assist → publish → edit a published week.
- **Respond now:** the coverage inbox, Allied requests and the three-rung ladder,
  force-triggering a float, overriding an assignment.
- **Administer:** people, transfers, hours and caps, seasons, breaks, knowledge base,
  launching a house.

`/managers/roles` is load-bearing and comes first: SM, RSM, HM, BM and Admin have
genuinely different powers (own-house vs. cross-house, who can be paged, who is in the
duty rotor), and a manager reading the wrong page's instructions will hit a permission
error and assume the app is broken. One tab per role, each answering: what you can see,
what you can change, what you get paged for.

`/managers/coverage` is the page most likely to be read under pressure. It is written as
a runbook, not prose: what the alert means, the three rungs, acknowledge vs. close out,
the four close-out outcomes, and the rule that a request never clears itself.

---

## 6. The two hard flows

The user is right that swapping and floating are where a linear how-to falls apart. Both
are multi-party and stateful. The fix is the same in both cases: **one page that shows the
shape of the whole thing, then a second page for the machinery.**

### 6.1 Swapping — `/workers/swapping`

A swap is four decisions by one person and one decision by another, and the app's
segmented picker makes some of those decisions at once. The page structure:

1. **The shape**, as a single diagram before any instructions:

   ```
   You pick a shift  →  You pick who  →  You pick how much  →  You send
                                                                  ↓
                                                    They accept / decline
                                                                  ↓
                                              Both calendars change at once
   ```

2. **Walk it**, numbered, one screenshot slot per step.
3. **The variants**, as their own short blocks because they are what confuses people:
   - **Even swap** — you both give and take.
   - **One-sided handoff** — one side is empty; you are giving hours away or taking them.
     The app names this differently on purpose; say so.
   - **Partial swap** — you swap part of a shift, and the timeline splits into segments.
   - **Permanent swap** — every future week, and the weeks it will skip.
4. **The waiting state** — what both people see while it is pending, and that it is
   visible immediately to both without a refresh.
5. **How it can end** — accepted, declined, expired, invalidated. A four-row table with
   the expiry rule for each swap type.

### 6.2 Floating — `/system/floating` + `/system/floating/deep-dive`

This is the reason the site exists in a form a deck cannot match. Floating is the one
behavior that is simultaneously the most operationally important, the least intuitive,
and the most frequently asked about ("why me?").

**Page A — Floating: overview.** Written for a worker or a housing leader. No algorithm.

- What a float is, in one sentence: your hours move to another desk for part of your
  shift, and then you come back.
- The three facts that answer most questions:
  1. Floating never adds hours. It relocates hours you were already scheduled to work.
  2. Your own desk is never left empty to cover someone else's.
  3. Only Quad and Harnwell workers can be floated out; nobody who is not Harnwell-trained
     can be floated in to Harnwell.
- The lifecycle, as one diagram: gap appears → nobody claims it → system looks for a
  floater → you are notified → you acknowledge → you work it → you go back.
- What you must do: acknowledge. What happens if you do not.
- Then: "Want to know how the system chose you? → deep dive."

**Page B — Floating: the selection rule (deep dive).** Written for IT, managers, and the
curious worker. This is the only long page on the site and that is deliberate — it is the
page people will link to when they argue about fairness.

Structure, following the actual rule:

1. **When a float lookup even runs.** The coverage floor: the system only chases coverage
   for a desk that would be **completely empty**. A Quad evening with one worker on is
   covered, and its other empty seats are not floated. This single point defuses most of
   the "why is the system floating people when we have staff" objection, and it needs to
   be first.
2. **Who is eligible**, as a checklist with the reason beside each item:
   - Permitted source house (the direction rules).
   - Their own desk keeps at least one worker after they leave. ← the hard guard
   - Not already floating in that window; not on a cross-house pickup.
   - Not a manager.
   - Has not already declined a float overlapping this window.
3. **How it picks** — the chunking algorithm, in plain language with a worked example:
   - Quad is exhausted before Harnwell is considered.
   - Within a source, the worker who can cover the **longest unbroken run** wins that run.
   - Repeat on what is left. Multiple floaters covering one gap is normal, not a failure.
   - The floor is one 30-minute block, so small gaps get absorbed rather than bought.
4. **Ties**, as a three-step ladder: starts at the span start → ends at the span end →
   arbitrary. Say plainly that step three is arbitrary; pretending otherwise invites a
   fairness argument the system cannot win.
5. **When nobody fits** — partial coverage, then Allied, and the 4-hour cap on how much
   is secured at once.
6. **The rules that constrain the outcome**, each with its one-line rationale:
   - No takeback: once assigned, automation will not recall you.
   - Harnwell can send but never receive.
   - Hours caps are not consulted, because floats are hours-neutral.
   - A manager can override any of this by hand; the system cannot.
7. **A worked example, end to end.** One gap, one table of candidates, and the decision
   traced line by line to the assignment. This is the section people will actually read.
8. **What a manager can force.** Force-triggering early, and what "pending" means on
   everyone's calendar.

Both pages get diagrams rather than screenshots for the algorithm parts, since there is no
screen that shows a candidate set.

---

## 7. Landing and getting started

**Landing** answers "what is this" in about fifteen seconds and then routes:

- One line: what Shift is.
- Three or four sentences on the problem it replaces (the manual coverage scramble).
- Three big cards: I'm a student worker / I'm a manager / I want to understand the system.
- A short "what it does" strip: build schedules from preferences, cover gaps
  automatically, move staff between houses when a desk would be empty, track hours.

**Getting started** is the role picker expanded: pick your role, get the five pages you
actually need in order, with an estimated read time. This is the page to hand to a new
hire or to RHS IT as "start here."

---

## 8. Screenshots

**Decision: reuse the existing pitch set only** (23 images in `docs/pitch/screenshots/`,
manifest at `docs/pitch/screenshot-manifest.md`). Captured 2026-07-27, iOS demo build on
iPhone 17 Pro, and web at 3200x2000.

They are demo data, which is exactly right for a public site: no real worker names, no
real schedules.

**They are copied into `apps/docs/src/assets/screenshots/`, not referenced across the
repo** (settled at build, 2026-08-02). It duplicates about 18MB under a second path, and
buys a docs build that is self-contained and cannot break because something moved under
`docs/`. Astro optimises them on the way out, so the 307KB phone capture ships as a 30KB
webp. When a capture is replaced, replace it in both places or delete the pitch copy.

### What we can illustrate

| Page                     | Existing asset                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `/workers/your-week`     | `slide-10a-ios-my-shifts.png`                                                                                      |
| `/workers/your-house`    | `slide-10b-ios-house-week-grid.png`, `slide-10c-ios-contact-card-call.png`                                         |
| `/workers/picking-up`    | `slide-12a-ios-open-shifts-feed.png`                                                                               |
| `/workers/swapping`      | `slide-12b-ios-incoming-swap.png` (the receiving side only)                                                        |
| `/workers/breaks`        | `slide-12c-ios-break-picker.png`, `-alt-...-claiming.png`                                                          |
| `/workers/floating`      | `slide-13a-ios-float-card-home.png`                                                                                |
| `/workers/notifications` | `slide-11a-ios-home-screen-widget.png`, `slide-13b-ios-widget-pending-float.png`, and the six notification mockups |
| `/workers/assistant`     | `slide-19a-ios-ask-snoopy.png`                                                                                     |
| `/managers/ai-assist`    | `slide-14a-web-schedule-builder-ai-panel.png`                                                                      |
| `/managers/hours`        | `slide-15a-web-hours-report.png`                                                                                   |
| `/managers/coverage`     | `extra-web-action-inbox.png`                                                                                       |
| `/managers/people`       | `extra-web-people.png`                                                                                             |
| `/system/*` (context)    | `slide-16a-web-live-calendar.png`, `slide-19b-web-ask-snoopy.png`                                                  |

### What has no screenshot, and how each page compensates

This is the real cost of reusing only the pitch set, stated plainly so it is a choice and
not a surprise:

| Page                                                               | Missing                              | Compensation                                                          |
| ------------------------------------------------------------------ | ------------------------------------ | --------------------------------------------------------------------- |
| `/workers/signing-in`                                              | login, one-time code, house-not-live | Numbered text steps                                                   |
| `/workers/swapping`                                                | the 4-step creation flow             | **Step diagram** (§6.1) + text; only the receiving screenshot is real |
| `/workers/dropping`                                                | the manage-shift sheet               | Text steps                                                            |
| `/workers/floating`                                                | the acknowledgment modal             | Text + the float notification mockups                                 |
| `/workers/preferences`                                             | the paint gesture                    | **Animated diagram or text**; a still cannot show a drag anyway       |
| `/managers/building-a-schedule`                                    | the builder grid                     | Text + the AI-panel shot, which shows the grid behind it              |
| `/managers/seasons`, `/breaks-admin`, `/launch`, `/knowledge-base` | all admin screens                    | Text steps only                                                       |

**Recommendation to revisit later, not now:** the swap creation flow and the
manage-shift sheet are the two places where text-only is genuinely weaker than the
alternative, because both are gesture-driven. If the site reads thin at those two points
after the design pass, a targeted capture of ~6 shots would close it. Everything else is
fine as text.

### Rules for any screenshot on the site

- Demo data only. Never a real roster.
- One device frame style, consistently applied, decided in the design session.
- Every image gets alt text that states what it shows, because the alt text is what a
  reader on a slow connection or a screen reader gets instead.
- Annotate with callout numbers keyed to the numbered steps, rather than arrows and
  scribbles.

---

## 9. Content principles

These are the editorial rules the build session should hold to.

> **Enforcement, added 2026-08-02.** The nine principles below were in place for the first
> seven pages and those pages still came out verbose and indirect, because a prose rule
> does not bind: a writer reads "lead with the answer," believes it complied, and ships 999
> words. The principles are now backed by measurable gates in
> `.claude/skills/docs-write/references/editorial-contract.md` (word budgets, a 25-word
> sentence ceiling, a banned-phrase list, per-audience reading grade) and scored pass/fail
> by the `docs-editor` persona in separate context from whoever wrote the page. Write pages
> through the `docs-write` skill rather than by hand. The three voices (worker, manager,
> system) are three personas, routed by the page's path.

1. **One idea per page.** If a page needs two H1-level ideas, it is two pages.
2. **Overview pages are real pages.** Framing paragraph, then linked cards. Never a
   redirect and never a bare list of links.
3. **Lead with the answer.** Every page's first sentence states what the page is for.
   No "In this section we will explore."
4. **Rules carry their reason.** Every constraint gets a short because-clause. "Harnwell
   needs training" is why non-Harnwell workers cannot be floated in; without the reason it
   reads as arbitrary and people work around it.
5. **Say what is arbitrary.** Where the system genuinely makes an arbitrary choice (the
   third tiebreaker), say so. Do not manufacture a rationale.
6. **No em dashes or en dashes in any user-facing copy on the site**, matching the
   product's own copy rule.
7. **Failure states are content, not an appendix.** Each task page ends with the two or
   three things that actually go wrong.
8. **Behavior only.** No table names, no function names, no HTTP. If a sentence cannot be
   understood by a student worker or an IT manager without the codebase open, it belongs in
   the spec instead.
9. **The specs stay upstream.** Where this site and BEHAVIORAL_SPECIFICATION.md disagree,
   the spec wins and the site is wrong. Any behavior change ships a spec edit first
   (AGENTS.md rule) and a site edit second.

---

## 10. Design direction — SETTLED, see DESIGN.md

The design session ran on 2026-08-02. **The direction is decided and lives in
[DESIGN.md](./DESIGN.md)**, which is now the authority on how this site looks. The brief
below is kept as the record of what was asked for going in, and is superseded wherever the
two disagree.

**What the session changed from this brief:**

- **Type is the system grotesque, not Open Sans.** Reasoning in DESIGN.md §3.
- **Colour is not monochrome.** The product's real shift-state colours are used in
  diagrams and state lists, so a diagram and the screenshot beside it agree with each
  other. `#0061FC` stays interaction-only.
- **Dark mode does not use pure black.** The ground lifts to `#0F1319` so the tinted state
  cards have somewhere to sit.
- **Screenshots get no device frame.** Flat card, soft lift.

**What survived unchanged:** not Carbon; three columns collapsing to a drawer; capped
measure; both modes first class; and the component list below, which DESIGN.md §5 designs
one by one.

The original brief, for the record:

- **Not Carbon.** The product web app uses Carbon-derived styling; this site deliberately
  does not. It is a document, not a console.
- **Sleek, minimal, elegant, professional.** Generous whitespace, strong typographic
  hierarchy, very few borders, no decorative colour.
- **Palette:** white in light mode, black in dark mode, Penn blue (`#0061FC`, the product's
  brand blue) reserved for links, the active nav item, and a small number of emphasis
  elements. Nothing else is coloured. Both modes are first-class, with a toggle.
- **Type:** Open Sans throughout, for its readability at long-form sizes.
- **Layout:** three columns on desktop (left nav, content, on-page table of contents),
  collapsing to a single column with a drawer on mobile. Content column capped at a
  comfortable measure.
- **Components the content needs**, so the design session knows what to design:
  card grid (overview pages), callout/note, step list with numbered screenshot callouts,
  comparison table, tabbed block, inline diagram frame, glossary term link,
  "related pages" footer, code-free keyboard/UI-label styling.

---

## 11. Build

**Target: a new `apps/docs` static site in the monorepo. Built 2026-08-02.** Standalone, its own styling,
builds to static HTML, deploys independently of the product app. Chosen so the different
visual direction cannot collide with the product's design system and so a docs deploy can
never break the app.

**Framework: Astro, plain, with MDX and Pagefind.** Decided in the design session on the
grounds that a fully specified design makes any framework with its own design system cost
more to override than it saves. Full reasoning and the rejected alternatives are in
[DESIGN.md](./DESIGN.md) §10. The requirements it satisfies:

- Static output, no server, no database, no auth.
- MDX or Markdown authoring, so content is reviewable as text in a PR.
- Full control over layout and CSS. Anything that fights custom design is disqualified.
- Built-in or easily added: sidebar nav from the file tree, on-page table of contents,
  client-side search, dark mode, anchor links on every heading.
- Deploys as a static bundle.

**Phasing:**

| Phase | Scope                                                               | Status                                                       |
| ----- | ------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1     | Scaffold, design system, nav, finished pages as the pattern         | **Done 2026-08-02**                                          |
| 2     | Section 3 (`/system/*`), written first because 1 and 2 link into it | Stubs only                                                   |
| 3     | Section 1 (`/workers/*`)                                            | Stubs only                                                   |
| 4     | Section 2 (`/managers/*`)                                           | Stubs only                                                   |
| 5     | Landing, getting started, glossary, search, screenshot pass         | Landing, getting started and search done; glossary is a stub |
| 6     | Review with a real student worker and a real manager, then deploy   | Not started                                                  |

Phase 1 shipped every route in §3, the full component set, and eight written pages: the
landing page, `/getting-started`, the three section overviews, `/workers/your-week`,
`/system/floating`, and `/managers/coverage`. The remaining 32 are structured stubs with
real frontmatter and their section's skeleton headings, flagged `draft: true` so the page
tells the reader it is unwritten instead of looking finished and empty. Details of what was
built are in DESIGN.md §12.

**Page skeletons as built.** §4 fixes the worker task-page skeleton. The other two
sections got their own, and the stubs carry them:

```
/managers/*     What this is for → Do it → What you'll see → If it goes wrong
/system/*       The short version → How it works → Where you see this
```

`Where you see this` is the back-link list required by the cross-linking rules in §3.

Section 3 goes first on purpose. It holds the definitions the other two sections depend
on, and writing it first stops the same concept being explained three slightly different
ways.

---

## 12. Open questions

1. **Where does it deploy, and at what URL?** Needs to be somewhere RHS IT is comfortable
   linking to.
2. **Who owns it after handover?** If RHS IT is expected to keep it current, the authoring
   format and the edit path matter more than they otherwise would.
3. **Does the manager section need to reflect the pilot's staged rollout** (Harnwell only,
   houses going live one at a time), or describe the steady state and treat the rollout as
   a separate note?
4. **Is a printable or PDF export needed** for anyone who still wants a leave-behind?
5. ~~**Penn branding.**~~ **Settled in the design session:** Shift's own identity, no Penn
   marks and no Penn web identity guidelines. See DESIGN.md §1.

```

```
