---
name: docs-write
description: Draft or rewrite pages on the user guide site (apps/docs) using the three voice personas and the adversarial editor. Invoke when writing any new guide page, when rewriting an existing one that reads as verbose or unclear, when filling in draft pages, or when asked to "write the docs", "draft this page", "make this page clearer", or "tighten the guide". Routes each page to the right voice by its path, then runs the editor gate. Not for site design, components, or styling.
---

# Writing the user guide

Content only. This skill writes and edits `.mdx` prose under
`apps/docs/src/content/docs/`. It never touches components, styles, layouts, `nav.ts`, or
config. Site design decisions live in `docs/user-guide-site/DESIGN.md` and are settled.

## Why this exists

The site's editorial rules already existed in SKETCH.md §9 and the first pages still came
out verbose and indirect. Prose guidance does not bind: a writer reads "be clear," believes
it complied, and ships 999 words. So the voice lives in a persona and the standard lives in
gates that a separate adversarial editor scores pass/fail.

The editor is the load-bearing part. Do not skip it to save a turn.

## Routing

A page's path picks its voice. There is no judgement call here.

| Path                                     | Persona               | Reader                               |
| ---------------------------------------- | --------------------- | ------------------------------------ |
| `content/docs/workers/**`                | `docs-writer-worker`  | Nineteen, on a phone, one question   |
| `content/docs/managers/**`               | `docs-writer-manager` | Accountable, may be reading at 2am   |
| `content/docs/system/**`                 | `docs-writer-system`  | Technically literate, no codebase    |
| `getting-started.mdx`, section overviews | `docs-writer-worker`  | Broadest audience, so plainest voice |

Every page then goes to `docs-editor`, regardless of voice.

## Running it

### 1. Scope

Establish which pages are in play before spawning anything.

```bash
cd apps/docs/src/content/docs && grep -rl "^draft: true" . | sort
```

Confirm the list with the user when it is more than about five pages. A full sweep is
expensive and the voice should be calibrated on a small batch first.

### 2. Scope-check before you spend a draft

Read each target page's title and its SKETCH.md row. **If the title or the page's question
contains "and", it is probably two pages.** Resolve that before spawning a writer.

Two of the first three pages written against this contract failed this way
(`workers/dropping` carried four paths, `managers/publishing` carried two tasks). Both were
caught only after a full draft, which turned a free fix into an expensive one. The rule
existed; nobody ran it early.

Splitting a page changes `SKETCH.md` §3 and `apps/docs/src/nav.ts`, so it is the user's
call, not yours. Raise it before writing.

### 3. Brief each page

Each writer needs, in its prompt:

- the target file path and whether it exists,
- the page's row from SKETCH.md §4 (workers), §5 (managers), or §6 (the two hard flows),
- the spec sections it must verify against, **including a reminder to search migrations**,
  since a permission or threshold absent from both specs is often gated in a migration,
- the sibling pages it should link to, from SKETCH.md §3.

Do not make a writer hunt for its own brief. It will guess, and guessing is how a wrong
threshold gets into a guide.

**Do not ask a writer to report word counts.** The editor counts. Writers who self-report
drift toward the ceiling, and one has already reported a passing sentence length for a
sentence that breached a hard gate. Ask instead for what it could not verify, and what it
cut and why.

**Do not put an unverified fact in the brief.** A writer that trusts you will write it. One
already caught a wrong staffing claim in its own brief and refused it; do not rely on that.

### 4. Write, then gate

Pipeline it. Each page goes writer, then editor, independently. There is no reason to hold
a finished page while another is still drafting.

For a single page, spawn the writer, then spawn `docs-editor` on the result.

For a batch, use a workflow so each page flows through both stages without a barrier, and
so a FAIL on one page does not stall the others. Only fan out after a pilot has been read
and approved by the user.

### 5. Handle the verdict

- **PASS** — report the numbers, move on.
- **FAIL** — send it back to the same writer persona with the editor's list. One retry. If
  it fails twice, stop and bring the specific gate to the user; a page that cannot pass
  twice usually has a scoping problem, not a prose problem.

Never mark a page done on a FAIL. Never edit around the editor yourself to force a pass.

## What ships with a page

1. The `.mdx` prose.
2. Image placeholders in the contract's grep-able format (contract §4). No real images:
   the screenshot pass is separate and later.
3. An acceptance criteria block as an MDX comment (contract §7), left in the file.
4. `draft: true` removed from the frontmatter, but only after a PASS.

## Boundaries

- A new page also needs an entry in `apps/docs/src/nav.ts`. Personas cannot write it.
  Add it yourself, in the main session, after the page passes.
- Behavior changes ship a spec edit first (AGENTS.md). If writing a page surfaces a
  behavior that is true in code and absent from both specs, that is a spec defect: stop and
  use the `spec-sync` skill rather than documenting it only on the guide site.
- If the two specs contradict each other, that is a P0 per AGENTS.md. Stop and raise it.

## Reference

`references/editorial-contract.md` — the gates, banned phrases, page skeletons, image
placeholder format, component vocabulary, and AC block. Every persona loads it. Change a
standard there, not in the three voice files.
