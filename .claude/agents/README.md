# Personas

A **persona** is a subagent: its own system prompt, its own context window, spawned by the
main session to do one job. A **skill** is instructions loaded into the _current_ session.
The difference is not size, it is posture.

Reach for a skill when the current session should keep doing what it is doing, with more
guidance. Reach for a persona when the job needs a different mind: one whose defaults,
scepticism, and definition of "done" would be actively wrong for ordinary feature work, and
which would be diluted if it shared context with the session that wrote the code.

That last clause is the real test. A persona that reviews work the main session just produced
must not inherit that session's belief that the work is correct. Separate context is the
mechanism, not a side effect.

## The roster

| Persona               | Posture                                          | Spawned by                       |
| --------------------- | ------------------------------------------------ | -------------------------------- |
| `security-auditor`    | Attacker. Assumes the gate is missing.           | `.claude/skills/security-audit/` |
| `ship-check`          | Burned PM. Assumes the feature is broken.        | `.claude/skills/ship-check/`     |
| `perf-surgeon`        | Empiricist. Assumes the diagnosis is wrong.      | invoked directly                 |
| `docs-writer-worker`  | Author. Reader is nineteen and in a hurry.       | `.claude/skills/docs-write/`     |
| `docs-writer-manager` | Author. Reader is accountable, maybe at 2am.     | `.claude/skills/docs-write/`     |
| `docs-writer-system`  | Author. Reader is technical, has no repo.        | `.claude/skills/docs-write/`     |
| `docs-editor`         | Editor. Assumes the draft is a quarter too long. | `.claude/skills/docs-write/`     |

The four `docs-*` personas are **authors, not inspectors**, which is why they hold `Edit`
against the exception below. They are bounded by path instead: prose under
`apps/docs/src/content/docs/` only, never components, styles, layouts, `nav.ts`, or config.
The writer/editor split exists for the same reason the review personas exist: a writer
cannot judge its own draft's length, so the standard is scored in separate context.

## Conventions

- One file per persona: `.claude/agents/<name>.md`, frontmatter `name` / `description` /
  `tools` / `model`.
- The `description` is what the Agent tool matches on. Write it as trigger conditions
  ("invoke when X, Y, Z"), not as a job title.
- Scope `tools` to the minimum. Report-only personas get read tools plus `Write`, never
  `Edit`: an inspector that can edit product code stops being an inspector.
- Personas read `AGENTS.md` and the nested `AGENTS.md` for the directory they are working in.
  The invariants there bound their solution space.
- Pair a persona with a thin skill when it needs an invocation ritual (scoping, parallel
  fan-out, merging reports). The skill is the ritual; the persona is the judgement.
