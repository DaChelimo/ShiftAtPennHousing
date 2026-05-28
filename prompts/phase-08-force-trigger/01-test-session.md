# Phase 08 — Force Trigger: Test Session

## Session Metadata

|                     |                                     |
| ------------------- | ----------------------------------- |
| **Model**           | Claude Opus 4.7 (`claude-opus-4-7`) |
| **Interface**       | Claude Code CLI                     |
| **Thinking mode**   | Extended thinking — High            |
| **TDD role**        | Test author — write tests only      |
| **Skill to invoke** | `engineering:testing-strategy`      |

---

## Prompt

You are writing tests for Phase 08: Force-Trigger Pathway.

Branch: `phase-08-force-trigger`.

Sources of truth:

- BEHAVIORAL_SPECIFICATION.md §6.6 (force-triggered float — all 9 sub-rules)
- ARCHITECTURE.md §4.5 (force-trigger pathway — detailed)
- ARCHITECTURE.md §6 (force-trigger endpoint validation)
- AGENTS.md (no-takeback rule)

---

### Behavioral surfaces to cover

**Initiation validation (§6.6 rule 1, ARCHITECTURE.md §6.2):**

- Initiator must be SM/HM/BM of the destination house OR the currently-on-duty HMOD
- All target blocks must currently be status='vacant'
- Earliest block start must be MORE than 2 hours in the future
- No block in the request may already have a pending_float_in assignment
- The block's date must be under a profile with float_enabled=true
- Each of these: if check fails → request rejected with specific error, no partial execution

**Successful assignment path:**

- Force-trigger immediately runs float lookup (bypasses T-3h/T-2h wait)
- Creates float_assignments with initiated_by='force_triggered'
- Destination blocks → pending_float_in
- Source blocks → pending_float_out
- Block_step_status: INSERT (block_id, 'broadcast', 'completed_via_force_trigger') AND (block_id, 'float_lookup', 'completed_via_force_trigger') in same transaction
- hmod_notify_allied step NOT pre-marked (must remain available if decline happens)
- Source-side gap (if source drops below required_headcount): immediately creates vacant rows + enters open-shifts feed

**No floater found path:**

- Float lookup returns empty → immediately fire hmod_notify_allied
- Standard T-3h/T-2h chain does NOT re-fire for this gap

**No-takeback rule applies to force-triggered floats:**

- A pending force-triggered float cannot be recalled by the automated system
- Only manual SM/HM/BM override can remove it

**Decline path (§6.6 rule 7):**

- Float voided + destination returns to 'vacant'
- Decliner excluded from further float lookup for this gap
- Standard chain RESUMES from the beginning:
  - If T-3h not yet reached → broadcast fires at T-3h normally
  - If T-3h past but T-2h not → broadcast skipped, float_lookup fires at T-2h (with decliner excluded)
  - If T-2h past → immediately hmod_notify_allied
- Block_step_status rows (broadcast + float_lookup) set to 'rolled_back' in the same transaction as the void

**Source-side reconciliation on decline (same as no-ack):**

- Source gap still vacant → restore floater's original assignment
- Source gap claimed/allied → floater displaced (vacancy_origin='displaced_decliner')

---

### Edge cases

- HMOD (not house SM) initiates force-trigger for a house not their home → should be allowed if they're the current HMOD
- Force-trigger initiated at T-2h exactly → rejected (must be MORE than 2h, not at T-2h)
- Force-trigger on a winter-break block (float_enabled=false) → rejected
- Force-trigger on a block that already has a force-triggered float pending → rejected (pending_float_in exists)
- Multiple blocks in the request, some vacant some not → entire request rejected (not partial)
- Force-trigger succeeds, floater acknowledges, then drops their home shift → the float commitment stands (no-takeback); source desk triggers independent escalation
- Chain resumes after decline at T-3h boundary exactly → broadcast step fires at T-3h, not immediately

---

### Test files

1. `packages/core/tests/phase-08/force-trigger-validation.test.ts` — Vitest: all 5 validation checks
2. `packages/core/tests/phase-08/force-trigger-block-step-status.test.ts` — Vitest: block_step_status state machine for force-trigger lifecycle
3. `packages/core/tests/phase-08/decline-chain-resume.test.ts` — Vitest: all 3 decline scenarios (T-3h not reached, T-3h passed, T-2h passed)
4. `supabase/tests/phase-08-force-trigger.sql` — pgTAP: transaction atomicity tests
5. `tests/PHASE_08/TEST_PLAN.md`

---

### Commit

```
git commit -m "phase-08 tests: force-trigger validation (5 checks), block_step_status lifecycle, decline chain-resume (3 scenarios), source-side reconciliation"
```
