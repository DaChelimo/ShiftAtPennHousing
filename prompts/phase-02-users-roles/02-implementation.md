# Phase 02 — Users & Roles: Implementation

## Session Metadata

|                          |                                                                               |
| ------------------------ | ----------------------------------------------------------------------------- |
| **Model**                | OpenAI Codex (`codex-1` or latest available)                                  |
| **Interface**            | Codex CLI or ChatGPT with Codex agent                                         |
| **Thinking mode**        | High reasoning                                                                |
| **TDD role**             | Implementer — satisfy tests without reading test bodies                       |
| **Cross-model firewall** | You may read test FILE NAMES only. Do NOT open or read any test file content. |

---

## Prompt

You are implementing Phase 02: Users and Roles.

Branch: `phase-02-users-roles`. Tests have been committed — do NOT modify them.

Sources of truth (read before writing any code):

- BEHAVIORAL_SPECIFICATION.md §2 (Roles — all sub-sections)
- ARCHITECTURE.md §3.1 (users, user_roles, is_active invariant, broadcast subscription guard)
- AGENTS.md
- `tests/PHASE_02/TEST_PLAN.md` (behavioral checklist — names only, do not read test bodies)

Cross-model firewall rule: you may read the NAMES of test files under `supabase/tests/` and `packages/core/tests/phase-02/` to know what behaviors are expected. You MAY NOT open or read the content of any test file. Implement against the spec, not the tests.

---

### Deliverables

**1. Migrations:**

`users` table:

```sql
CREATE TABLE users (
  user_id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text NOT NULL,
  email           text NOT NULL,
  phone           text,
  home_house_id   text NOT NULL REFERENCES houses(id),
  is_active       boolean NOT NULL DEFAULT true,
  broadcast_subscribed boolean NOT NULL DEFAULT false
);
```

Constraint: `CHECK (broadcast_subscribed = false OR is_active = true)` — inactive users cannot be subscribed.

`user_roles` table:

```sql
CREATE TABLE user_roles (
  user_id         uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('sw', 'sm', 'hm', 'bm')),
  scope_house_id  text REFERENCES houses(id),
  PRIMARY KEY (user_id, role, scope_house_id)
);
```

DB-level constraint: `broadcast_subscribed` cannot be true for any user holding hm/bm role.
Implement as a trigger: `BEFORE INSERT OR UPDATE ON users` that checks `user_roles` for any hm/bm role. If found and `broadcast_subscribed = true`, raise an exception.

Alternatively, implement as a DB-level CHECK using a function — whichever approach is cleaner and guaranteed atomic.

**Role promotion hook:**
`BEFORE INSERT ON user_roles` trigger: when inserting a row with `role IN ('hm', 'bm')`, atomically set `users.broadcast_subscribed = false` for that `user_id` in the same transaction.

**RLS policies:**

- `users`: authenticated users can SELECT their own row (`auth.uid() = user_id`); HMs/BMs of a house can SELECT all users of that house; service-role bypass.
- `user_roles`: similar scope.

**2. packages/core/src/eligibility/index.ts:**

Pure TypeScript module — zero Supabase imports:

```typescript
export type UserEligibilityProfile = {
  userId: string;
  homeHouseId: string;
  roles: Array<{ role: 'sw' | 'sm' | 'hm' | 'bm'; scopeHouseId: string | null }>;
  isActive: boolean;
  broadcastSubscribed: boolean;
};

export function isEligibleForFloatLookup(user: UserEligibilityProfile): {
  eligible: boolean;
  reason?: string;
};
export function isEligibleForBroadcast(user: UserEligibilityProfile): {
  eligible: boolean;
  reason?: string;
};
export function isEligibleForClaimPool(user: UserEligibilityProfile): {
  eligible: boolean;
  reason?: string;
};
export function isEligibleForSwapCounterparty(user: UserEligibilityProfile): {
  eligible: boolean;
  reason?: string;
};
export function isEligibleForScheduleRoster(user: UserEligibilityProfile): {
  eligible: boolean;
  reason?: string;
};
export function hasRole(
  user: UserEligibilityProfile,
  role: 'sw' | 'sm' | 'hm' | 'bm',
  houseId?: string,
): boolean;
```

All functions must handle the union-of-roles model: a user holding both `sm` and `hm` has union of both roles' capabilities.

**3. Edge Function: `supabase/functions/users-broadcast-subscription/index.ts`**

`PATCH /users/:id/broadcast_subscribed`

- Authenticated user can only modify their own row
- Fetch the target user's roles; if any role is `hm` or `bm`, return 403 with body `{ error: "HMs and BMs cannot subscribe to broadcast notifications" }`
- Otherwise update `broadcast_subscribed` field

**4. Regenerate types:**

```bash
supabase gen types typescript --local > packages/shared/src/database.types.ts
```

**5. Update AGENTS.md:**
Under "Phase-Specific Notes" append:

```
- [Phase 02] The broadcast_subscribed guard is enforced at both DB trigger level AND
  Edge Function level. The DB trigger is authoritative; the EF layer is UX guard.
- [Phase 02] eligibility functions live in packages/core/src/eligibility/index.ts
  and are used by phases 05, 06, 07. They take UserEligibilityProfile, not DB rows.
```

---

### Implementation discipline

1. Read all spec sections listed above in full before writing code.
2. Write out a plan (list of files + functions to create) before writing any code.
3. Implement the migration first, then the trigger, then the Edge Function, then the core module.
4. Run tests only at the END — do not iterate by running tests mid-implementation.
5. If a test fails, report the failing test NAME only (not the test body). Do not modify test files.

---

### Verification

- [ ] `supabase db reset` applies all migrations cleanly
- [ ] `supabase test db` — all phase-02 pgTAP tests pass
- [ ] `pnpm turbo run test --filter=core` — all Vitest phase-02 tests pass
- [ ] Trigger behavior: inserting a user_roles row with role=hm for a user with broadcast_subscribed=true flips broadcast_subscribed to false atomically

---

### Commit

```
git commit -m "phase-02 impl: users + user_roles tables, broadcast guard trigger, role promotion hook, eligibility module in core/"
```
