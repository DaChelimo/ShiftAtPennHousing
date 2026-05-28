# Phase 07 — Orchestrator & Escalation: Spec Audit

## Session Metadata

|                     |                                     |
| ------------------- | ----------------------------------- |
| **Model**           | Claude Opus 4.7 (`claude-opus-4-7`) |
| **Interface**       | Claude Code CLI                     |
| **Thinking mode**   | Extended thinking — Max             |
| **Skill to invoke** | `engineering:code-review`           |

---

## Prompt

Run a spec-adherence audit on the diff in branch `phase-07-orchestrator`.

Sources: BEHAVIORAL_SPECIFICATION.md §5.4, §7.3, §10. ARCHITECTURE.md §4 (all), §4.6.

Checklist:

**Idempotency:**

- [ ] block_step_status INSERT uses ON CONFLICT DO NOTHING — double-tick cannot double-fire
- [ ] The no-ack trigger cannot fire twice for the same float (check the query or status filter)

**Chain step sequencing:**

- [ ] hmod_notify_allied is only fired by the chain AFTER float_lookup fails — it does NOT fire in parallel with float_lookup
- [ ] The 'rolled_back' status causes the orchestrator to re-evaluate the step — it does not re-fire past steps if their offsets are already expired

**No-ack trigger atomicity:**

- [ ] Steps 2–6 of no-ack handling are in a single DB transaction — partial state is impossible
- [ ] The transaction writes block_step_status rollback AND void float AND source reconciliation atomically
- [ ] hmod_notify_allied fires AFTER the transaction commits (not inside it)

**No-ack → hmod_notify_allied path:**

- [ ] At T-15m (no-ack trigger time), the code always goes to hmod_notify_allied regardless of whether the float was automated or force-triggered
- [ ] The comment/code reflects that T-2h is always past at T-15m — there's no branch that tries to re-fire broadcast or float_lookup

**Source-side reconciliation on no-ack:**

- [ ] Code checks the current state of the source-side gap (not assumed to still be vacant)
- [ ] Restored floater gets back status='scheduled' (or their original status — not 'vacant')
- [ ] Displaced floater gets vacancy_origin='displaced_decliner' — NOT 'temporary_drop'

**Notification routing (ARCHITECTURE.md §4.6):**

- [ ] At exactly 08:00 local time → notification goes to HM (inclusive lower bound)
- [ ] At exactly 17:00 local time → notification goes to HMOD (exclusive upper bound)
- [ ] Weekend escalation always goes to HMOD (no HM working hours on weekends)
- [ ] If blockStartAt is outside HM working hours but escalation fires during HM hours → HMOD notified (per §4.6: routing depends on BOTH when escalation fires AND block start time)

**Broadcast step:**

- [ ] No role filter in the broadcast query — relies solely on broadcast_subscribed=true being structurally impossible for HM/BM (enforced in phase-02 trigger)

Do NOT make code changes. Report findings only.
