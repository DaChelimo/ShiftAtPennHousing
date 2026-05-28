# Phase 10 — Permanent Drop & Pickup: Spec Audit

## Session Metadata

|                     |                                     |
| ------------------- | ----------------------------------- |
| **Model**           | Claude Opus 4.7 (`claude-opus-4-7`) |
| **Interface**       | Claude Code CLI                     |
| **Thinking mode**   | High reasoning                      |
| **Skill to invoke** | `engineering:code-review`           |

---

## Prompt

Run a spec-adherence audit on the diff in branch `phase-10-permanent-ops`.

Sources: BEHAVIORAL_SPECIFICATION.md §8.4. ARCHITECTURE.md §7.1, §7.2.

Checklist:

- [ ] Semester boundary uses `scheduling_periods.end_date` — NOT a recursive CTE walk in the runtime path
- [ ] Missing scheduling_periods row → error raised (not silent continuation with unbounded scope)
- [ ] Permanent drop excludes floated_out and pending_float_out blocks (no-takeback rule preserved)
- [ ] Permanent drop skips weeks where the dropping worker is NOT the current owner (someone else claimed it)
- [ ] Permanent drop does NOT affect break-profile dates within the semester (profile_name check in SQL)
- [ ] Permanent pickup: soft cap causes WEEK SKIP for pickup (not a warning — this is stricter than temporary claim)
- [ ] Permanent pickup: re-check at transaction time (not just at popup-generation time)
- [ ] After permanent pickup: slot removed from permanent openings feed even if pickup was partial
- [ ] Skipped pickup weeks enter the WEEKLY FEED, not the permanent openings feed

Do NOT make code changes. Report findings only.
