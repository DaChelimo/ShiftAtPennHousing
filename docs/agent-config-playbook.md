# Agent Config Playbook — moved

This playbook now lives globally at `~/.claude/skills/agent-config-playbook/SKILL.md`, so
every project's agent sessions can reach it on demand without carrying a local copy that
drifts from the canonical version.

It is a **skill**, not an always-loaded file: Claude Code discovers it automatically in any
project and invokes it when relevant (bootstrapping a new `AGENTS.md`, auditing an existing
one, deciding where a rule should live, writing a hook or skill). You can also invoke it
directly by name.

The full history of how this was developed against this repo (the 664→252 line cut, the
hooks, the skills) is in git history for this file and in commit messages from 2026-07-23.

See also: [AGENTS.md](../AGENTS.md) §3, which points here before authoring any new hook or
skill in this repo.
