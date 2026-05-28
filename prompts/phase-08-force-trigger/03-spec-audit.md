# Phase 08 — Force Trigger: Spec Audit

## Session Metadata

|                     |                                     |
| ------------------- | ----------------------------------- |
| **Model**           | Claude Opus 4.7 (`claude-opus-4-7`) |
| **Interface**       | Claude Code CLI                     |
| **Thinking mode**   | High reasoning                      |
| **Skill to invoke** | `engineering:code-review`           |

---

## Prompt

Run a spec-adherence audit on the diff in branch `phase-08-force-trigger`.

Sources: BEHAVIORAL_SPECIFICATION.md §6.6. ARCHITECTURE.md §4.5, §6.

Checklist:

**Validation:**

- [ ] T-2h check is strictly greater than 2h (not "at T-2h" — that's the standard chain's trigger point, not a valid force-trigger window)
- [ ] float_enabled=false → rejected (winter break and non-floating profiles cannot be force-triggered)
- [ ] Entire request rejected if ANY block fails validation — no partial execution

**Block_step_status pre-marking:**

- [ ] Both 'broadcast' AND 'float_lookup' are marked 'completed_via_force_trigger' in the same transaction as creating the float assignment
- [ ] 'hmod_notify_allied' is NOT pre-marked (must remain fireable on decline)

**Decline rollback atomicity:**

- [ ] The rollback (void float + destination vacant + block_step_status rolled_back) is a single DB transaction
- [ ] If the transaction fails mid-way, no partial state is visible

**Chain resume after decline:**

- [ ] The code that resumes the chain does NOT blindly re-fire broadcast — it evaluates offsets from the current time against block_start_at
- [ ] If T-2h is past at rollback time → the code (or the orchestrator's next tick) goes directly to hmod_notify_allied

**No-takeback confirmation:**

- [ ] There is no automated code path that removes a force-triggered pending float except decline by the worker or no-ack trigger
- [ ] Manual override (SM/HM/BM) is a separate code path not covered by this phase (flag as TODO if not yet implemented)

**HMOD authorization:**

- [ ] The HMOD check resolves the HMOD at REQUEST TIME (not at block start time)
- [ ] An HMOD initiating a force-trigger for a non-home house is authorized

Do NOT make code changes. Report findings only.
