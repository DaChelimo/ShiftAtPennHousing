# Shift@PennHousing — User Guide Site: Design System

**Approved design direction.** This settles how the site looks. It is the companion to
SKETCH.md, which settles what the site is and what is on each page.

Status: approved 2026-08-02. Built 2026-08-02 (phase 1), see §12.
Supersedes: SKETCH.md §10, which recorded the direction as deferred.

---

## 1. The decision

**Direction: technical reference.** A calm documentation surface. Cool grey panels, soft
borders, generous line height, the product's own state colours carried as tinted cards.

Four directions were built out and compared on the same page. The chosen one was picked
because the site's primary job is to be _used_: a student worker landing from a
notification link, a manager reading a runbook under pressure, RHS IT scanning for whether
the system is sane. It reads for longer without fatigue, and its tinted state cards teach
the app's own colour language directly instead of abstracting it.

What was rejected, and why it is worth remembering:

- **Stark and structural** was the runner-up and had more personality. It scans faster and
  holds more on screen, but it reads cold to a first-week nineteen-year-old, which is the
  largest single audience.
- **Editorial** would have made the floating deep dive excellent and every six-step how-to
  slow.
- **Warm and approachable** served workers well and cost credibility with IT and leadership.

### Fixed decisions this direction inherits

| Decision       | Value                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------- |
| Identity       | Shift's own. No Penn marks, no Penn web identity guidelines.                             |
| Not            | Carbon. The product web app is Carbon-derived; this deliberately is not.                 |
| Diagram colour | The product's real shift-state colours, so a diagram and the screenshot beside it agree. |
| Screenshots    | Flat card with a soft lift. No device bezel, no browser chrome.                          |
| Landing page   | Separate treatment, marketing weight, institutional voice.                               |
| Dark mode      | First class, follows the OS, with a toggle.                                              |

---

## 2. Colour

Neutrals are biased slightly cool, toward the accent. This is deliberate: a true neutral
grey next to a saturated blue reads as two unrelated systems.

### Light

```
--bg          #FFFFFF   page ground
--bg-2        #F8F9FB   panel, sidebar, card fill, table header
--bg-3        #F1F3F7   hover, segmented-control track, inline UI label
--ink         #10131A   headings, body
--ink-2       #3F4653   secondary body, table cells
--muted       #737B8A   captions, labels, inactive nav
--rule        #E5E8EE   borders
--rule-2      #EEF0F5   internal hairlines, table rows
--mark        #0061FC   links, active nav, step markers, focus
--mark-bg     #EFF4FF   active nav fill, callout fill, step marker fill
--mark-line   #CFDFFF   callout border, card hover border
```

### Dark

Not an inversion. The ground lifts off pure black so the tinted state cards have somewhere
to sit, and the accent lightens to hold contrast.

```
--bg          #0F1319
--bg-2        #161B23
--bg-3        #1E242E
--ink         #E7EBF2
--ink-2       #B4BDCB
--muted       #8B94A4
--rule        #2A323E
--rule-2      #1E242E
--mark        #5C9BFF
--mark-bg     #12203A
--mark-line   #24365C
```

### Shift-state colours

Load bearing, not decorative. These are the product's own values and must not drift from
`docs/design-brief.md`. Always pair the colour with its text label; never colour alone.

| State             | Light ink | Light fill | Dark ink  | Dark fill              |
| ----------------- | --------- | ---------- | --------- | ---------------------- |
| Float out         | `#8A3FFC` | `#F6F2FF`  | `#B58AFF` | `rgba(138,63,252,.14)` |
| Float in          | `#24A148` | `#DEFBE6`  | `#56C271` | `rgba(36,161,72,.14)`  |
| Pending           | `#B28600` | `#FFF8E1`  | `#D9A800` | `rgba(178,134,0,.16)`  |
| Allied            | `#007D79` | `#D9FBFB`  | `#3BB3AF` | `rgba(0,125,121,.16)`  |
| Permanent opening | `#EE5396` | `#FFF0F7`  | `#FF7FB2` | `rgba(238,83,150,.14)` |
| Urgent            | `#DA1E28` | `#FFF1F1`  | `#FF6168` | `rgba(218,30,40,.14)`  |
| Open, one-time    | `#8D8D8D` | `#FAFAFA`  | `#9AA3B0` | transparent            |

A state card is the fill, plus a border at 24% of the ink colour. The open state uses a
dashed border, matching how the app draws a vacant seat.

**Rule:** `--mark` blue is for interaction only. It is never used to mean a state, and a
state colour is never used to mean a link.

---

## 3. Type

System grotesque. No webfont is loaded.

```
--sans  system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif
--mono  ui-monospace, "SF Mono", Menlo, Consolas, monospace
```

This is a deliberate reversal of SKETCH.md §10's Open Sans. A documentation site is read
on the reader's own machine in their own reading environment; the system face is the one
their eye is already calibrated to, it renders instantly with no layout shift, and it
costs nothing. Nothing on this site needs a display face with personality, because the
personality budget is spent on structure and restraint.

### Scale

| Role                | Size / line height                | Tracking | Weight    |
| ------------------- | --------------------------------- | -------- | --------- |
| Landing hero        | `clamp(32px, 4.8vw, 52px)` / 1.05 | -0.035em | 690       |
| Page H1             | 30px / 1.14                       | -0.026em | 660       |
| Section H2          | 17.5px / 1.4                      | -0.02em  | 640       |
| Body                | 14.5px / 1.62                     | 0        | 400       |
| Secondary body      | 13.5px / 1.55                     | 0        | 400       |
| Caption, table cell | 12.5px / 1.5                      | 0        | 400       |
| Label, eyebrow      | 10.5px, uppercase                 | +0.11em  | 500, mono |

Numbers that align in a column get `font-variant-numeric: tabular-nums` and the mono face.
This covers times, block counts, and hour totals.

Headings take `text-wrap: balance`. Running text is capped near 66 to 70 characters.

The cap is on **text**, not on the page. Paragraphs, lists, callouts, and step lists take
the 68ch measure; tables, diagrams, figures, ladders, state lists, and card grids take the
full content column (860px). Capping a six-panel flow strip at the reading measure forced
it into a horizontal scroll on a desktop that had room for it, which reads as a defect
rather than as restraint.

---

## 4. Layout

```
desktop   218px sidebar  |  fluid content  |  178px on-page contents
tablet    drawer         |  fluid content  |  hidden
mobile    drawer         |  fluid content  |  hidden
```

- Content padding `26px 34px 40px`, sections separated by a 30px gap.
- A section that begins a new idea gets a single `--rule-2` hairline above it, not a box.
- Radius is 6px on cards, panels, and table frames; 5px on nav items; 999px on the landing
  badge and on the numbered step and figure discs. A small control that sits **inside** a
  6px container takes 4px so it nests cleanly: the raised segment of a segmented control,
  an inline UI label, a keyboard hint. Nothing else is rounded.
- Shadow appears in exactly two places: the screenshot card, and the raised segment of a
  segmented control. Everything else is flat with a border.
- Wide content (tables, diagrams, the flow strip) scrolls inside its own
  `overflow-x: auto` container. The page body never scrolls sideways.

---

## 5. Components

Each maps to a content need from SKETCH.md §10.

| Component         | Used on                                     | Treatment                                                                                       |
| ----------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Card grid         | Section overview pages                      | Bordered cards, 9px gap, hover lifts border to `--mark-line` and title to `--mark`              |
| Callout, standard | Anywhere a rule needs its reason            | `--mark-bg` fill, `--mark-line` border, uppercase blue label                                    |
| Callout, critical | The manager runbook only                    | `--ink` fill, ground-colour text. See §6.                                                       |
| Numbered steps    | Every task page                             | 21px blue disc, mono numeral, optional muted second line                                        |
| Screenshot figure | Worker task pages                           | Flat card, soft lift, numbered blue discs keyed to the steps, caption with a mono figure number |
| Comparison table  | Eligibility, outcomes, failure states       | Rounded bordered frame, tinted uppercase header row, hairline rows, no zebra                    |
| Tabs              | iOS / Android / Web, and manager roles only | Segmented control on a `--bg-3` track, raised active segment                                    |
| Flow strip        | Lifecycle and ladder diagrams               | Equal bordered panels, mono step label, terminal panel tinted `--mark-bg`                       |
| State list        | Anywhere the app's states are explained     | Tinted cards per §2                                                                             |
| Ladder            | Escalation and tiebreak sequences           | Three-column rows: when, who, what                                                              |
| Glossary link     | First use of a term per page                | Dashed underline, native `title`                                                                |
| UI label          | Any on-screen control named in prose        | Mono, `--bg-3` fill, 4px radius, bordered                                                       |
| Related footer    | End of every page                           | Bordered link chips, hover to `--mark-bg`                                                       |
| Page contents     | Right rail                                  | Left border track, active item blue                                                             |
| Sidebar search    | Every page                                  | Bordered field with a `⌘K` hint                                                                 |

---

## 6. The one deliberate exception

This direction's weakest moment is `/managers/coverage`, the page most likely to be read
at 2am on a phone. Its single most important sentence, that a coverage request never
clears itself, sits in the same tinted panel as every other note on the site.

**Fix, and it is the only place it is permitted:** the critical callout inverts to a solid
`--ink` block with ground-colour text. One per page maximum, and only where failing to
read it has an operational cost. Currently that is exactly one page.

Do not let this variant spread. The moment a second page uses it, the first one stops
working.

---

## 7. Diagrams

- Flat and geometric, built from the same bordered panels as the rest of the site, so a
  diagram and a screenshot on the same page agree with each other.
- Drawn in the state colours from §2, never in decorative colour.
- The float pages are mostly diagram, since there is no screen that shows a candidate set.
- Every diagram is HTML and CSS, not an image, so it inherits dark mode and reflows on
  mobile for free.

---

## 8. Motion

Almost none.

- Nav hover and focus transitions, 120ms.
- The mobile sidebar drawer.
- One animated figure, on `/workers/preferences`, because the paint-the-week gesture is a
  drag and a still cannot show it.

Everything honours `prefers-reduced-motion: reduce`.

---

## 9. Accessibility

- Every interactive element has a visible focus ring: 2px `--mark`, 2px offset.
- Colour is never the only signal. Every state card carries its text label.
- Every screenshot carries alt text stating what it shows, because alt text is what a
  reader on a slow connection or a screen reader gets instead.
- Body text meets AA at 14.5px against both grounds; `--muted` is reserved for
  supplementary text and never for anything a reader must read.
- Tabs are real tabs: `role="tablist"`, `aria-selected`, arrow-key navigation.

---

## 10. Framework

The design is fully specified, which changes the framework calculation: anything shipping
its own opinionated design system now costs more to override than it saves.

**Recommendation: Astro, plain, with MDX and Pagefind.**

- Static output by default, zero JS on pages that need none.
- MDX authoring, so content reviews as text in a PR.
- Total control of layout and CSS, with no theme to fight.
- Pagefind gives client-side search over the built output with no service and no index to
  maintain.
- Sidebar from the file tree, on-page contents, and heading anchors are a small amount of
  code against Astro's content collections, not a dependency.

Starlight was the obvious alternative and is rejected for one reason: it brings a complete
design system that this document would substantially replace. Overriding it is supported
but is more work than not having it. Fumadocs and Docusaurus lose on the same point, and
Next.js in `apps/docs` would additionally couple docs deploys to the product app's
toolchain, which SKETCH.md §11 explicitly wants to avoid.

Location: `apps/docs`, in the pnpm workspace, its own build, deployed independently.

Two dependencies beyond that list turned out to be load bearing and are not optional:
`sharp`, because Astro's image pipeline needs it to emit the optimised screenshots (the
build fails outright without it), and `rehype-autolink-headings`, which is what puts an
anchor on every heading. Pagefind indexes `dist/` **after** Astro finishes, so there is no
index under `astro dev`; the search dialog says so rather than failing silently, and search
can only be tested against a production build.

---

## 11. What is still open

Carried from SKETCH.md §12, unchanged by this session:

1. Deploy URL, and whether RHS IT is comfortable linking to it.
2. Ownership after handover, which decides how much the authoring format matters.
3. Whether the manager section describes the staged rollout or the steady state.
4. Whether a printable export is needed.

---

## 12. As built

Phase 1 shipped on 2026-08-02: scaffold, the design system above, the nav shell, every
route in the SKETCH.md §3 map, and the finished pages that establish the pattern.

### Where each part of this document lives in code

| Section here        | In `apps/docs`                                                      |
| ------------------- | ------------------------------------------------------------------- |
| §2 Colour           | `src/styles/tokens.css`, both grounds and all seven state colours   |
| §3 Type, §4 Layout  | `src/styles/base.css`                                               |
| §5 Components       | `src/components/`, one file per component                           |
| §6 Critical callout | `<Callout critical>`, used on `/managers/coverage` and nowhere else |
| §7 Diagrams         | `FlowStrip`, `Ladder`, `StateList`, all HTML and CSS, no images     |
| §10 Framework       | `astro.config.mjs`, `package.json`                                  |

The §5 set is ambient in MDX through `src/mdx-components.ts`, so a page imports nothing.
The page map is `src/nav.ts` and drives the sidebar, the overview card grids, and the
previous/next pager from one place.

### Decisions the build had to settle

- **The measure applies to text only** (§3), so diagrams are not squeezed into a scroll.
- **Small controls nested in a 6px container take 4px** (§4).
- **The state vocabulary is a typed list**, `src/states.ts`, shared by `StateCard` and
  `Ladder`, so a state name cannot be misspelled into a colourless card.
- **Screenshots are copied into `src/assets/screenshots/`** rather than reached for across
  the repo, so the docs build is self-contained. See SKETCH.md §8.
- **Tabs take their panels as named slots** (`<Fragment slot="panel-0">`). Astro requires
  static slot names, so the component renders the panels itself and injects them.
- **Dark mode** follows the OS by default; the toggle stamps `data-theme` on the root and
  wins in both directions, and the stored choice is applied in `<head>` before paint.

### Verified at build

`astro check` clean, production build green, 40 routes with zero broken internal links,
zero em or en dashes in the built output, Pagefind returning ranked results against the
built index, tabs driven by click and by arrow keys with `aria-selected` and panel
visibility in step, and no horizontal body scroll at 390px.

### Not yet written

32 of the 40 pages are structured stubs carrying real frontmatter and their section's
skeleton headings, marked `draft: true` so the page tells the reader rather than looking
finished and empty. Written so far, eight: the landing page, `/getting-started`, the three
section overviews, `/workers/your-week`, `/system/floating`, and `/managers/coverage`.
Phases 2 to 6 of SKETCH.md §11 are the remaining work.
