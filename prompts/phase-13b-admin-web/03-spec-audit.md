# Phase 13b — Admin Web: Spec Audit

## Session Metadata

|                     |                                     |
| ------------------- | ----------------------------------- |
| **Model**           | Claude Opus 4.7 (`claude-opus-4-7`) |
| **Interface**       | Claude Code CLI                     |
| **Thinking mode**   | Standard                            |
| **Skill to invoke** | `engineering:code-review`           |

---

## Prompt

Run a spec-adherence audit on the diff in branch `phase-13b-admin-web`.

Sources: BEHAVIORAL_SPECIFICATION.md §4.3, §2.3, §2.6, §2.5.

Checklist:

**Schedule builder:**

- [ ] Desktop-only guard is enforced (mobile users see a clear message, not a broken UI)
- [ ] Drag span is constrained to 2–12 blocks (1h–6h) — under 2 blocks produces no card
- [ ] A worker with no preference for any block in the span is in BLOCKED group (not Available)
- [ ] Phase 2 advisory: cannot/opted-out workers are shown with warnings, NOT hard-blocked

**HM leave:**

- [ ] System generates a mailto: URL — it does NOT send the email itself
- [ ] Cycle prevention: the replacement picker EXCLUDES anyone in the incoming delegation chain
- [ ] Cycle prevention runs again at submission time (not just at picker-load time)
- [ ] "I'm back" sets cancelled_at timestamp and changes status to 'cancelled_early'

**Permissions:**

- [ ] An SM cannot access the HM leave page (role-gated)
- [ ] An SW cannot access the schedule builder (role-gated)

Do NOT make code changes. Report findings only.
