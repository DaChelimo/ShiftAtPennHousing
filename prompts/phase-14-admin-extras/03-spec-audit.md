# Phase 14 — Admin Extras: Spec Audit

## Session Metadata

|                     |                                         |
| ------------------- | --------------------------------------- |
| **Model**           | Claude Sonnet 4.6 (`claude-sonnet-4-6`) |
| **Interface**       | Claude Code CLI                         |
| **Thinking mode**   | Standard                                |
| **Skill to invoke** | `engineering:code-review`               |

---

## Prompt

Run a spec-adherence audit on the diff in branch `phase-14-admin-extras`.

Sources: BEHAVIORAL_SPECIFICATION.md §9.3. ARCHITECTURE.md §3.10.

Checklist:

- [ ] Cap modification is restricted to HM and BM roles — SM is explicitly blocked
- [ ] Cap modification is GLOBAL (all 13 houses, not per-house)
- [ ] Can only set to 20 or 40 — not arbitrary values
- [ ] Existing over-cap workers' assignments are NOT affected by a cap reduction
- [ ] Pending floats for over-cap workers survive the cap change
- [ ] system_config changes are restricted to the project administrator role
- [ ] Orchestrator tick health log is visible in `/admin/health`

Do NOT make code changes. Report findings only.
