# Phase 02 — Users & Roles: Spec Audit

## Session Metadata

|                     |                                     |
| ------------------- | ----------------------------------- |
| **Model**           | Claude Opus 4.7 (`claude-opus-4-7`) |
| **Interface**       | Claude Code CLI                     |
| **Thinking mode**   | High reasoning                      |
| **Skill to invoke** | `engineering:code-review`           |
| **When to run**     | After all phase-02 tests pass       |

---

## Prompt

Run a spec-adherence audit on the diff introduced in branch `phase-02-users-roles`.

Sources of truth:

- BEHAVIORAL_SPECIFICATION.md §2 (all sub-sections)
- ARCHITECTURE.md §3.1

Report format:

- **ENFORCED** — spec rule → file:line
- **MISSING** — spec rule → not in diff
- **DRIFTED** — spec rule → what diff does instead
- **AMBIGUOUS** — implementation made a choice; flag for human review

Specific checklist:

**users table:**

- [ ] `home_house_id` is immutable except by admin override — is there a constraint or trigger preventing SWs from changing it themselves?
- [ ] `broadcast_subscribed` defaults false
- [ ] `is_active` defaults true
- [ ] FK to `auth.users` with CASCADE DELETE

**Broadcast subscription guard (ARCHITECTURE.md §3.1):**

- [ ] DB-level: broadcast_subscribed=true structurally impossible for any user holding hm/bm role
- [ ] The PATCH endpoint returns 403 (not 400, not 500) for hm/bm users
- [ ] Guard fires on INSERT as well as UPDATE (a new user with broadcast_subscribed=true + hm role should be rejected at insert time)

**Role promotion hook:**

- [ ] Runs inside the same transaction as the user_roles INSERT (atomic)
- [ ] Applies to both 'hm' and 'bm' roles
- [ ] Does NOT send any notification when it fires (spec §3.1 explicitly says no notification)

**is_active invariant:**

- [ ] The eligibility functions in packages/core enforce is_active=true for all pipelines listed in §3.1
- [ ] No eligibility function has a code path that returns eligible=true for an inactive user

**BM worker exclusion:**

- [ ] BM role users are excluded from: preferences submission, schedule builder roster, claim eligibility, float lookup
- [ ] BM users CAN appear in HMOD rotor (they are admin-eligible)

**HM worker footprint:**

- [ ] HM users CAN hold shift assignments (they are workers)
- [ ] HM users are excluded from float lookup
- [ ] HM users are excluded from broadcast subscription

Do NOT make code changes. Report findings only.
