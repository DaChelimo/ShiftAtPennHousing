# Phase 02 — Users & Roles: Test Session

## Session Metadata

|                          |                                                           |
| ------------------------ | --------------------------------------------------------- |
| **Model**                | Claude Opus 4.7 (`claude-opus-4-7`)                       |
| **Interface**            | Claude Code CLI                                           |
| **Thinking mode**        | Extended thinking — High                                  |
| **TDD role**             | Test author — write tests only, zero implementation       |
| **Skill to invoke**      | `engineering:testing-strategy`                            |
| **Cross-model firewall** | Tests committed before Codex opens implementation session |

---

## Prompt

You are writing tests for Phase 02: Users and Roles.

Branch: `phase-02-users-roles` (already checked out, phase-01 merged).
Tests live in: `supabase/tests/phase-02-users.sql` (pgTAP) and `packages/core/tests/phase-02/` (Vitest).

Sources of truth (read in full before writing any test):

- BEHAVIORAL_SPECIFICATION.md §2 (all sub-sections — Roles, BM-as-substitute, HMOD, leave)
- ARCHITECTURE.md §3.1 (users, user_roles, is_active invariant, broadcast subscription guard)
- AGENTS.md

Use the `engineering:testing-strategy` skill to structure coverage.

---

### Behavioral surfaces to cover

**User model:**

- User creation linked to Supabase `auth.users` via FK
- `is_active` defaults to true; firing flips it to false
- An inactive user cannot appear in any selection pipeline (float lookup, broadcast, schedule builder, claim eligibility, swap counterparty)
- Historical shift assignments retain the fired user's `user_id` (referential integrity preserved)
- Contact lookup on a past shift card may surface a fired worker's info (acceptable per spec §3.1 last para)

**Role model:**

- SW, SM, HM, BM roles assignable with house scope (for SM/HM/BM)
- A user may hold multiple roles simultaneously
- HM role: may hold shift assignments; excluded from float lookup pool; excluded from broadcast subscription
- BM role: admin-only; no shift assignments; excluded from all worker pipelines
- Union-of-roles permission model: holding SM + SW gives union of both

**Broadcast subscription guard:**

- `broadcast_subscribed` defaults to false
- May only be set to true for users holding no HM or BM role
- Attempt to set `broadcast_subscribed = true` for an HM/BM user → rejected (403 or DB-level rejection)
- `broadcast_subscribed = true` is structurally impossible for any user who holds hm/bm role

**Role promotion hook:**

- When a user is granted the `hm` or `bm` role (INSERT into user_roles), their `broadcast_subscribed` is atomically set to false in the same transaction
- This applies even if the user currently has `broadcast_subscribed = true` (e.g., an SM being promoted to HM)
- No notification is sent for this change

**is_active invariant (the exhaustive list from ARCHITECTURE.md §3.1):**
Test that each of these pipelines excludes is_active=false users:

- Float lookup eligibility query
- Broadcast subscriber query
- Schedule-builder roster query
- Claim-eligibility check
- Swap counterparty selection
- HM-leave-replacement picker
- HMOD-rotor population
- Cross-house feed visibility resolver
- Preference-submission reminder job

---

### Edge cases to cover

- A user holds hm + sw roles simultaneously: float lookup excludes them, broadcast excludes them, but they can hold shift assignments
- A user holds bm role: excluded from preferences, schedule roster, claim eligibility, float lookup
- SM promoted to HM mid-period while broadcast_subscribed=true → subscription silently flipped off
- Firing a user mid-float: their float assignments should still exist (handled in phase-07) but user appears inactive
- `replacement_user_id` in `hm_leave` pointing to an inactive user: this should be rejected (can't designate a fired person as replacement)
- A house with no active HM or BM (all on leave with no replacement) — the system should not allow this state per §2.6 rule 7

---

### Test files to create

1. `supabase/tests/phase-02-users.sql` — pgTAP tests for:
   - Schema validation (user table columns, FKs, constraints)
   - DB-level constraints on broadcast_subscribed + role combination
   - Role promotion trigger behavior
   - is_active FK preservation (fired user's historical assignments remain)

2. `packages/core/tests/phase-02/role-eligibility.test.ts` — Vitest tests for:
   - Pure eligibility functions: `isEligibleForFloatLookup(user)`, `isEligibleForBroadcast(user)`, `isEligibleForClaimPool(user)`, `isEligibleForSwapCounterparty(user)`
   - These functions take a user object (no DB coupling) and return boolean + reason

3. `tests/PHASE_02/TEST_PLAN.md` — list every test by name, the spec section it covers, and any ambiguities flagged

---

### What you are NOT to do

- Do NOT write any implementation code (no migrations, no Edge Functions, no SQL functions)
- Do NOT write tests for anything outside §2 and §3.1
- Do NOT assume how the implementation will be structured — test behavior, not code paths
- Do NOT skip edge cases because they are rare — spec is truth

When uncertain about a spec interpretation:

- Write the test for your best interpretation
- Mark it `// AMBIGUOUS: [explain the ambiguity and spec section reference]`
- List it in TEST_PLAN.md under "Ambiguities to resolve"

---

### Commit

```
git commit -m "phase-02 tests: users + roles behavioral surface, broadcast guard, promotion hook, is_active invariant × 9 pipelines"
```
