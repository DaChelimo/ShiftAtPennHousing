# Phase 09 — Swaps: Test Session

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

You are writing tests for Phase 09: Swaps.

Branch: `phase-09-swaps`.

Sources of truth:

- BEHAVIORAL_SPECIFICATION.md §8.1 (temporary shift swap)
- BEHAVIORAL_SPECIFICATION.md §8.2 (temporary float swap)
- BEHAVIORAL_SPECIFICATION.md §8.3 (permanent shift swap)
- ARCHITECTURE.md §3.5 (swap_requests schema)
- AGENTS.md

---

### Behavioral surfaces to cover

**Temporary shift swap (§8.1):**

- Either worker can initiate; the other must accept/reject
- Until accepted, shifts remain with original owners
- On acceptance, both assignments swap atomically
- Expiry: T-3h of the EARLIER of the two spans
- Invalidation: if either span is dropped or auto-floated before acceptance → silently voided
- A worker cannot create or accept a swap that touches a block in another pending swap of theirs
- Pre-creation eligibility guard (Harnwell training constraint applies symmetrically)
- Acceptance guard re-runs eligibility checks at acceptance time

**Temporary float swap (§8.2):**

- At least one swapped span must include an active float assignment
- Same eligibility constraints as shift swap (symmetric Harnwell check)
- Expiry: 24 hours after the LATEST end-time among swapped spans
- If accepted after shift has been worked → calendar updates retroactively; no cap re-check
- On retroactive acceptance: destination SMs/HMs notified of corrected floater identity

**Permanent shift swap (§8.3):**

- SM/HM is NOT the initiator or approver — workers handle this directly
- Expiry: 7 days after creation
- On acceptance: bulk-update all future weeks where Worker A currently owns the slot
- SKIP weeks where A no longer owns the slot (already swapped/claimed by someone else)
- Confirmation popup must list skipped weeks before acceptance
- Permanent swaps apply ONLY to regular school year (not break profiles)

**Expiry cron behavior:**

- swap_requests with status='pending' and expires_at <= now() → status='expired'
- Idempotent (running twice doesn't change already-expired rows)

---

### Edge cases

- Worker tries to swap a block involved in a force-triggered pending float → pre-creation guard should catch or flag this
- Worker A has cross-house pickup; Worker B wants to swap with it → B must be eligible at the pickup's destination house (Harnwell training)
- Permanent swap: all future weeks are claimed by another worker → swap succeeds but affects 0 weeks (edge: is this allowed? confirm popup shows 0 weeks)
- Float swap accepted retroactively → destination calendar shows corrected floater
- Two workers swap, then one drops the newly received shift → the dropped shift belongs to the new owner

---

### Test files

1. `packages/core/tests/phase-09/swap-eligibility.test.ts` — Vitest: symmetric eligibility checks
2. `packages/core/tests/phase-09/permanent-swap-scope.test.ts` — Vitest: week scoping, skip logic
3. `supabase/tests/phase-09-swaps.sql` — pgTAP: expiry cron, schema, atomic acceptance
4. `tests/PHASE_09/TEST_PLAN.md`

---

### Commit

```
git commit -m "phase-09 tests: shift swap, float swap, permanent swap — eligibility guards, expiry policies, atomic acceptance, retroactive float swap"
```
