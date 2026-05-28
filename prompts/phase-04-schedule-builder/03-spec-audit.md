# Phase 04 — Schedule Builder: Spec Audit

## Session Metadata

|                     |                                     |
| ------------------- | ----------------------------------- |
| **Model**           | Claude Opus 4.7 (`claude-opus-4-7`) |
| **Interface**       | Claude Code CLI                     |
| **Thinking mode**   | High reasoning                      |
| **Skill to invoke** | `engineering:code-review`           |

---

## Prompt

Run a spec-adherence audit on the diff in branch `phase-04-schedule-builder`.

Sources of truth: BEHAVIORAL_SPECIFICATION.md §4.1–§4.3, ARCHITECTURE.md §2.10, §3.6, §3.9.

Report format: ENFORCED / MISSING / DRIFTED / AMBIGUOUS.

Checklist:

**Publish operation (highest risk — most commonly wrong):**

- [ ] Every shift_blocks row in the period with NO draft assignment becomes a vacant row with vacancy_origin='never_assigned'. Verify the query covers all blocks for the period's date range, not just the ones with draft rows.
- [ ] publish_schedule is fully atomic — if step 4 (vacant creation) fails, steps 2–3 also roll back
- [ ] draft_block_assignments rows are deleted in the same transaction, not after
- [ ] scheduling_periods.published_at is set in the same transaction
- [ ] Re-publishing an already-published period is rejected (not silently re-run)

**Draft isolation:**

- [ ] Workers' calendar query does NOT touch draft_block_assignments
- [ ] Orchestrator vacancy scan (status='vacant') does NOT touch draft_block_assignments
- [ ] RLS prevents workers from SELECTing draft_block_assignments

**Preference scoping:**

- [ ] preferences.period_id ensures per-period isolation (new period doesn't overwrite old)
- [ ] Preference writes are rejected after preference_deadline

**Phase 1 grouping:**

- [ ] A worker with no preference for any block in the span is in the 'blocked' group (not 'available'). This is the most commonly missed rule — verify it's explicitly handled.
- [ ] A worker marked 'cannot' on one block is blocked even if they marked 'preferred' on all others

**Reminders:**

- [ ] Workers who opted_out=true receive no reminders (they made an affirmative choice)
- [ ] Workers who submitted any preferences receive no reminders
- [ ] Reminders do NOT fire if preference_deadline is NULL

Do NOT make code changes. Report findings only.
