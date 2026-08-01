# Where lessons live

Loaded on demand, not every session. This file is the routing decision for "we learned
something, where does it go."

The question is never "project or global." It is two independent axes:

1. **Does it generalize past this repo?**
2. **What does it cost to keep it loaded?**

Those two answers pick the home. Getting this wrong is expensive in a way that is invisible at
the time: a lesson written into the wrong slot either burns context on every task forever, or
sits somewhere nobody reads at the moment it would have helped.

## The distillation test, which is also the router

Strip every proper noun from the lesson.

- If the sentence **dies** without `draft_block_assignments` or `apps/mobile`, it is a **fact**.
  It stays project-scoped.
- If it **survives** as something like "verify a WHERE clause scopes to what you intend before
  you run it," it is a **lesson**. It belongs globally.

Store the **surviving sentence as the headline** and the incident underneath it as evidence.
Never the reverse. A lesson filed as "the time we broke X" is retrievable only by someone who
already remembers X, which is exactly the person who does not need it.

## The routing table

| Kind of lesson                          | Home                                                        | Why                                                                                                                                                             |
| --------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mechanically checkable, repo-specific   | `scripts/hooks/` + registered in `.claude/settings.json`    | A rule a machine can check should never be a paragraph a model has to remember                                                                                  |
| Mechanically checkable, universal       | `~/.claude/hooks/` + global `settings.json`                 | Same, globally. Precedent: `grep-before-agent-guard.js`                                                                                                         |
| Repo invariant needed on _every_ task   | `AGENTS.md` hard invariants                                 | Always loaded. The most expensive slot in the repo. This is why it is 664 lines. Budget it like memory, because it is                                           |
| Repo-specific, needed only when doing X | `.claude/skills/<x>/SKILL.md`                               | Loaded on demand. **Most project lessons belong here**, not in `AGENTS.md`                                                                                      |
| Cross-project craft lesson              | `~/.claude/skills/<name>/SKILL.md`                          | On demand, global. Precedent: `agent-config-playbook`, which this repo stubs from `docs/`                                                                       |
| Cross-project, needed literally always  | `~/.claude/<topic>.md` + `@import` in `~/.claude/CLAUDE.md` | Loaded into _every session in every project_. The most expensive slot in the entire system. It currently holds two entries. It should hold about three, forever |
| Narrative: what we built and why        | project memory dir                                          | Recall-based, not enforced. Good for context, wrong for rules                                                                                                   |
| Product behavior                        | `BEHAVIORAL_SPECIFICATION.md` / `ARCHITECTURE.md`           | Already governed by spec-sync                                                                                                                                   |

## Two rules

### Prefer the cheapest home that still works

A lesson in a hook costs nothing per session and cannot be ignored. A lesson in `AGENTS.md`
costs tokens on every single task forever, and competes for attention with every other line
there. Promote upward only when the cheaper home **demonstrably failed to prevent a
recurrence**.

The corollary matters more than the rule: when something goes wrong, the reflex is to write it
into the most-read file, because that feels like taking it seriously. That reflex is how
`AGENTS.md` reaches 664 lines, and a 664-line always-loaded file is not read carefully, it is
skimmed. Adding to it can make the repo _less_ safe.

### A lesson earns its place by recurrence, not by pain

One incident is an anecdote. Write it in memory. The second time the same **shape** appears,
promote it and encode it.

Pain is a terrible signal, because the most painful incident is usually the one you have
already fixed and will never repeat, while the cheap recurring one quietly costs more in
aggregate. Route on shape and frequency, not on how bad it felt.

This rule cuts both ways, and the second direction is the one people skip: if a lesson has
recurred and is still living in prose, that is evidence the prose home failed. Move it down
into a hook. `20260711000001` revoked an `anon` grant that two later migrations re-applied,
which was itself the second re-application. Three occurrences is not a memory problem.

## Applied: lessons from building ship-check, 2026-07-26

### Encoded mechanically

**A corrective migration cannot defend an invariant that a copied template keeps re-asserting.**
`scripts/hooks/anon-grant-guard.js`, registered. Three occurrences of the same shape: a
deliberate `REVOKE ... FROM anon` undone by the boilerplate `GRANT SELECT ... TO anon,
authenticated, service_role` that rides along with every `CREATE OR REPLACE VIEW`. Repo
specific (it names the worker view family), mechanically checkable, and long past the
recurrence threshold. This is the textbook case for the top row of the table.

**Prove a new hook fires before you ship it.** Repo convention, recorded here rather than in
`AGENTS.md`. A hook is a script plus a registration, and only the registration is load-bearing.
Feed the script a synthetic stdin payload for the firing case, the silent case, and the
override case, and read the output. This costs one Bash call and is the only thing separating a
guard from a file nobody runs.

### Encoded in the persona

**A probe that proves a capability exists has not proved who holds it.** Added to
`.claude/agents/ship-check.md`, and it applies equally to `security-auditor.md`. An
authorization probe must establish its own identity inside the same command that exercises the
hole; a key read from ambient shell state is an assumption wearing the costume of a
measurement. This cost a retracted P0 on the first real pass: `lock_block_coverage` was reported
as `anon`-executable on the strength of an `HTTP 204` that only `service_role` can produce.

Corollary worth keeping attached: the probe used a bogus uuid to avoid mutating a real row,
which also removed the write that would have contradicted its conclusion. **A read-only probe
is safer and weaker at the same time.** When a finding turns on a side effect, verify the side
effect happened.

### Left in memory, deliberately not promoted

Both of the following are genuine cross-project craft lessons and both would survive the
distillation test. Neither has recurred. By the rule above they stay anecdotes until they
appear a second time, which is the doctrine constraining its own author rather than decorating
the file.

- **Verify a brief's premises before building on them.** The "what already exists, do not
  rediscover this" section of this task's own prompt was wrong twice.
- **Slice a review by the path a user takes, not by the layer it lives in.** Layer-shaped
  passes structurally cannot see assumptions that cross layers. Currently encoded in
  `.claude/skills/ship-check/SKILL.md`, which is the cheapest home that works.

### Not written anywhere as a rule

The findings themselves. Seven P0s and five P1s are **defects**, not lessons. They belong in
`docs/qa/` as fix tickets and then in commits. Writing "remember to check the anon grant" into
a document is what you do _instead_ of fixing it.
