# Phase 11 — Break Claim Scheduling: Spec Audit

## Session Metadata

|                     |                                     |
| ------------------- | ----------------------------------- |
| **Model**           | Claude Opus 4.7 (`claude-opus-4-7`) |
| **Interface**       | Claude Code CLI                     |
| **Thinking mode**   | Standard                            |
| **Skill to invoke** | `engineering:code-review`           |

---

## Prompt

Run a spec-adherence audit on the diff in branch `phase-11-break-claim`.

Sources: BEHAVIORAL_SPECIFICATION.md §4.4, §3.2. ARCHITECTURE.md §2.9.

Checklist:

- [ ] Phase offsets (T-14d, T-3d, T-1d) are anchored to `break_periods.start_date` — NOT to each individual date within the break
- [ ] T-1d close is ATOMIC — the entire break period's claim pool closes at once, not date by date
- [ ] Dropped break shifts during claim window → return to calendar pool (not open-shifts feed)
- [ ] Dropped break shifts after T-1d → enter open-shifts feed (not calendar pool)
- [ ] T-3d nag: workers who claimed ≥1 shift receive NO nag (even partial claimers are exempted)
- [ ] Break phase transitions are idempotent (can run twice without duplicate effects)
- [ ] Hours cap during break uses the correct cap per break type (spring_fling = 20h soft, others = 40h hard — from break_periods.break_type)

Do NOT make code changes. Report findings only.
