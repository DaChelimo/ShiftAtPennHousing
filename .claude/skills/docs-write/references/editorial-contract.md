# Editorial contract

Every writer persona and the editor load this file. It is the shared half of the job; the
per-voice agent files hold only what differs by audience.

Upstream authority, in order: `BEHAVIORAL_SPECIFICATION.md` (what is true),
`docs/user-guide-site/SKETCH.md` (what each page covers, §3 to §6), this file (how it
reads). Where the site and the spec disagree, the spec wins and the page is wrong.

---

## 1. The gates

These are pass/fail. The editor scores them and rejects. "It reads fine" is not a score.

| Gate                | Threshold                                                                          |
| ------------------- | ---------------------------------------------------------------------------------- |
| Prose budget        | Task page 120 to 250, overview 80 to 150, explainer 180 to 250, deep dive ≤600     |
| Total page budget   | Task page ≤600 words, overview ≤300, deep dive uncapped                            |
| Longest sentence    | ≤25 words. No exceptions.                                                          |
| Median sentence     | ≤15 words                                                                          |
| First sentence      | States what the page is for. Names the thing. No preamble.                         |
| Because-clauses     | Every rule states why, in the same sentence or the next one                        |
| Banned phrases      | Zero occurrences (§2)                                                              |
| Reading grade       | Workers 8, managers 10, system 12                                                  |
| Dashes              | Zero em dashes and en dashes anywhere in the page                                  |
| Second person       | "You", never "the user" or "the worker" on worker and manager pages                |
| Acceptance criteria | Present, and every claim in it is satisfied by the page                            |
| Single task         | The page's QUESTION states one task. "And" in the question or title is a fail      |
| Sourcing            | Every threshold, cap, cutoff, and permission traced to BSpec, ARCH, or a migration |

**Prose words** are words in sentences you wrote: paragraphs, step text, step notes,
callout bodies, table cells, **component prop text (`FlowStrip` step labels, `Figure`
captions, `StateCard` bodies, `Ladder` cells)**. Frontmatter, component names, headings,
and link labels do not count. **Total words** is everything a reader reads.

Prop text counts because a reader reads it and you wrote it. Without this, a third of a
page can be moved into component props to pass the budget, which is gaming the gate rather
than meeting it.

### The budget is a range, not a ceiling

The first three pages written against this contract came back at 249, 250, and 252 prose
words against a 250 ceiling. That is not coincidence; a stated ceiling becomes a target,
and the damage is not padding. It is **even thinness**: coverage spread uniformly instead
of proportionally to what can hurt the reader, so the one irreversible action on a page
gets the same 24 words as a precondition nobody can get wrong. No individual sentence is
guilty, which is exactly why an editor cutting sentence by sentence cannot recover it.

So:

- **Land inside the range.** A page at the ceiling is not "efficient", it is suspect.
- **A page within 10 words of its ceiling must justify the length in UNRESOLVED.** If you
  cannot say why this page needs every word, it does not.
- **Weight by consequence, not by section.** The thing a reader cannot walk back gets the
  most words on the page. A precondition gets a clause, not a step.
- **Do not count your own words and do not report a count.** The editor counts. Writers who
  self-report drift toward the number and have reported a passing figure for a sentence
  that actually breached a hard gate.

---

## 2. Banned phrases

Delete on sight. Each one is a sentence that has not decided what it is saying.

- "It is important to note that"
- "Keep in mind that"
- "You may want to"
- "Simply" / "just" (as in "simply tap")
- "In order to" (use "to")
- "As mentioned above" / "as we discussed"
- "This section will cover" / "In this guide"
- "Please note"
- "Be aware that"
- "There are a number of"
- "It should be noted"
- "Feel free to"

Also banned as a shape: any sentence whose first six words carry no information.

**Before:** "It is important to note that a shift you drop will leave your week."
**After:** "A shift you drop leaves your week."

---

## 3. Page skeletons

Do not invent structure. Pick the skeleton the page's type calls for.

### Task page (`/workers/*`, most of `/managers/*`)

```
frontmatter: title, description, minutes
One sentence: what this is for.
IMAGE placeholder
## Do it              numbered <Steps>, one action per step
## What you'll see    the result state
## Rules that apply   short bullets, each with its reason, each linking to /system/*
## If it goes wrong   the 2 or 3 real failure states and what they mean
<Related> 3 links
```

### Overview page (`/workers`, `/managers`, `/system`)

```
frontmatter
Framing paragraph: what this section is and who it is for.
## <grouping heading>   <CardGrid> of the pages beneath, grouped by job not alphabetically
```

### Explainer page (`/system/*`)

```
frontmatter
One sentence: the question this page answers.
## <the mechanism>     prose plus a FlowStrip or Ladder diagram
## Why it works this way
## What this means for you
<Related> 3 links
```

A page that does not fit one of these three is a scoping problem. Say so in the acceptance
criteria instead of inventing a fourth shape.

---

## 4. Image placeholders

You do not add images. You mark where one belongs, in a format the screenshot pass can
grep for. MDX comments are inert, so they never break the build:

```jsx
{
  /* IMAGE: workers/dropping/drop-sheet.png
   MUST SHOW: the manage-shift sheet open on a scheduled shift, with the drop and swap
   intent cards visible and the scope selector set to this week only.
   WHY: the sheet merges two actions and the step text cannot carry that alone. */
}
```

Three fields, always: the intended path, what the shot must show, and why the page needs
it. "WHY: it looks nice" means delete the placeholder.

A page needs at most two images. If you want a third, you are compensating for prose that
has not been cut.

Where the app has no screen to show (float candidate selection, the coverage ladder), use
a `<FlowStrip>` or `<Ladder>` diagram instead of a placeholder and say so.

---

## 5. Component vocabulary

Available without import, from `apps/docs/src/mdx-components.ts`:

`Callout` (label, critical) · `Card` · `CardGrid` · `Figure` · `FlowStrip` · `Ladder` ·
`Related` · `RoleCard` · `StateCard` · `StateList` · `Steps` · `Table` · `Tabs` · `Term` ·
`UI`

Rules:

- `Table` wraps a markdown table. Blank line before and after the table inside it.
- `Steps` takes `<li>`; a second line goes in `<span class="step-note">`.
- `UI` is for any on-screen control you name: `<UI>Open Shifts</UI>`.
- `Term` is for a glossary term's first use on the page.
- `Callout critical` is reserved for `/managers/coverage` and nowhere else. Using it a
  second time on the site breaks the first one. See DESIGN.md §6.
- `Tabs` only for iOS / Android / Web splits and for manager roles.

Do not add CSS. Do not touch components, layouts, tokens, `nav.ts`, or config. If a page
needs something the vocabulary cannot express, say so in the acceptance criteria and write
the page without it.

---

## 6. Grounding

- **Behavior only.** No table names, no function names, no HTTP, no file paths. If a
  sentence needs the codebase open to parse, it belongs in the spec.
- **Ground every rule in the spec.** Before writing a threshold, a cutoff, a permission, or
  a cap, read it in `BEHAVIORAL_SPECIFICATION.md` or the migration. Do not write a number
  you have not verified. A wrong number in a guide is worse than a missing one, because a
  reader will act on it.
- **Say what is arbitrary.** Where the system makes a genuinely arbitrary choice, say so.
  Do not manufacture a rationale.
- **Do not invent UI.** If you cannot confirm a control exists, do not name it.

---

## 7. Acceptance criteria block

Every page ends its draft with an AC block, as an MDX comment, so it ships with the page
and the editor can score against it. Strip nothing; it stays in the file.

```jsx
{
  /* ACCEPTANCE CRITERIA
   QUESTION: What one question does a reader arrive with?
   AFTER READING, THEY CAN:
     1. ...
     2. ...
     3. ...
   FAILURE STATES COVERED: ..., ...
   VERIFIED AGAINST: BSpec §5.3, migration 20260627000001
   UNRESOLVED: anything you could not confirm, or "none" */
}
```

A page whose QUESTION needs the word "and" is two pages. Say that in UNRESOLVED rather
than writing both.

---

## 8. Working method

**Step 0, before anything else: the scope check.** Write the page's QUESTION as one
sentence, then apply the real test:

> **Does the page need two separate procedures, each with its own Steps list?**

If yes, it is two pages: stop and report a scoping problem instead of writing. If no, it is
one page, however its title reads.

An "and" in the title is a **prompt to run this test, not a verdict**. Many titles join two
facets of a single task and are fine: "Signing in and setting up" is one flow, "Hours, caps,
and attribution" is one explainer. What made `workers/dropping` and `managers/publishing`
genuinely two pages was that each carried two distinct procedures, and in both cases one
procedure got the Steps list and the screenshot while the other got an orphan sentence
filed under the wrong heading. That asymmetry is the symptom to look for.

Two facets of one task, sharing one procedure, stay on one page. Do not split a page merely
because its title is compound.

This is step 0 because it is where the first two pages written against this contract
failed. Both carried two tasks in one skeleton. Both were predicted by this rule and both
had already been written by the time anyone applied it, which made the fix expensive
instead of free. The symptom is always the same: one half gets steps, an image, and a
callout; the other half gets an orphan sentence filed under the wrong heading.

A page that fails step 0 produces a one-paragraph scoping report, not a draft:
the proposed split, which half owns which sections, and what each new page's QUESTION is.

Then:

1. Read the page's brief in SKETCH.md (§4 for workers, §5 for managers, §6 for the two
   hard flows, §3 for the map).
2. Read the spec sections the page depends on. Verify every number. **A claim you cannot
   find in BEHAVIORAL_SPECIFICATION.md, ARCHITECTURE.md, or a migration does not go on the
   page**, however true it looks in the app. Product code and UI copy are not sources: they
   tell you what the app does today, not what it guarantees. Search all three, including
   migrations, before you record something as unverifiable.
3. Read one adjacent finished page for house style. The reference pages are the ones that
   have actually passed this contract:
   - Worker task page: `workers/dropping.mdx`
   - Manager task page: `managers/publishing.mdx`
   - Explainer: `system/concepts.mdx`

   **Do not use `workers/your-week.mdx` or `managers/coverage.mdx` as style references.**
   Both predate this contract and were written in the register it exists to correct;
   `your-week.mdx` is 583 prose words against a 250 ceiling, so a writer copying its rhythm
   inherits the problem. They are still correct on the facts and still the best description
   of what those screens do. They are queued for a rewrite. Read them for content if the
   page you are writing overlaps them, never for voice.

4. Write the AC block first. It is the outline.
5. Write the page. Give the most words to the thing the reader cannot undo.
6. Cut it by a quarter before you hand it over. The draft you like is the draft that is
   too long.
