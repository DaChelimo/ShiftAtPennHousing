# Phase 02 — Test Plan: Users and Roles

This plan enumerates every test written for phase-02, the spec section
each test covers, and ambiguities flagged for resolution before or during
implementation.

Sources of truth: `BEHAVIORAL_SPECIFICATION.md` §2, `ARCHITECTURE.md` §3.1.

Test files:

- `supabase/tests/phase-02-users.sql` — pgTAP, 58 assertions
- `packages/core/tests/phase-02/role-eligibility.test.ts` — Vitest pure-logic suite

---

## pgTAP — `supabase/tests/phase-02-users.sql`

### §1. Schema existence (4)

| Test                                       | Spec         |
| ------------------------------------------ | ------------ |
| `users table exists`                       | ARCH §3.1    |
| `user_roles table exists`                  | ARCH §3.1    |
| `user_role_enum type exists`               | ARCH §3.1    |
| `user_role_enum has labels sw, sm, hm, bm` | BEH §2.1–2.3 |

### §2. `users` column shape (15)

Column existence, types, primary key, NOT NULL on `is_active` /
`broadcast_subscribed`, and defaults (`is_active=true`,
`broadcast_subscribed=false`) per ARCH §3.1.

### §3. `user_roles` column shape (7)

Columns, role enum type, NOT NULL on `user_id` / `role`, and the unique
key over `(user_id, role, scope_house_id)` so the union-of-roles model
of BEH §2.7 holds without duplicates.

### §4. Foreign keys (8)

- `users.user_id → auth.users(id)` — links the application user to the
  Supabase auth identity (BEH §2 implicitly, ARCH §3.1).
- `users.home_house_id → houses(id)` — ARCH §3.1.
- `user_roles.user_id → users(user_id)`.
- `user_roles.scope_house_id → houses(id)`.
- `hm_leave.user_id` and `hm_leave.replacement_user_id → users` — these
  are the deferred FKs noted in `20260526000008_hm_leave.sql`.
- `ack_cadence_config.modified_by → users` — deferred FK from phase-01.
- `weekly_cap_overrides.modified_by → users` — deferred FK from phase-01.

### §5. RLS enabled (2)

Both new tables have RLS enabled (service-role bypass; user-scoped
policies arrive in later phases per AGENTS.md).

### §6. `scope_house_id` enforcement (4)

- `sw` may have NULL scope (SW is house-agnostic per BEH §2.1).
- `sm`, `hm`, `bm` reject NULL scope (ARCH §3.1: "the house their role
  covers").

### §7. Multiple roles (1)

A single user can hold `sw` + `sm` at the same house — BEH §2.7.

### §8. Broadcast subscription guard (4)

- UPDATE flipping `broadcast_subscribed=true` for an HM → rejected.
- Same for a BM → rejected.
- Pure SW/SM may set `broadcast_subscribed=true` and the change persists.

### §9. Role promotion hook (6)

- Pre-promotion: SM with `broadcast_subscribed=true` is a valid state.
- INSERT of `hm` role for that SM succeeds and atomically flips
  `broadcast_subscribed` to false (ARCH §3.1 "Role promotion hook").
- Same for `bm` promotion.
- System-wide invariant: zero rows with HM/BM role and broadcast=true.

### §10. `is_active` default + firing (2)

- New user defaults to `is_active=true`.
- Setting `is_active=false` persists.

### §11. `hm_leave.replacement_user_id` rejects inactive users (3)

- Insert with inactive replacement → rejected.
- Insert with active replacement → succeeds.
- Insert with NULL replacement → succeeds (terminal = project
  administrator per BEH §2.6).

### §12. Firing preserves user_roles rows (1)

Firing a user must not cascade-delete their role assignments — the
calendar still needs to show who held what role historically.
Shift-assignment FK preservation lands in phase-03.

### §13. Guard survives the round-trip (1)

A single UPDATE that tries to flip `broadcast_subscribed=true` _and_
`is_active=true` for an HM is still rejected — the guard is not
defeatable by combining writes.

---

## Vitest — `packages/core/tests/phase-02/role-eligibility.test.ts`

Four pure predicates, each returning `{ eligible, reason }`:

### `is_active` invariant (20 — 5 personas × 4 predicates)

Per ARCHITECTURE §3.1, every selection pipeline filters
`is_active=true`. The four pure pipelines tested here are:

1. Float lookup eligibility
2. Broadcast subscriber selection
3. Claim-eligibility
4. Swap counterparty

The other five pipelines named in §3.1 (schedule-builder roster,
HM-leave-replacement picker, HMOD-rotor population, cross-house feed
visibility resolver, preference-submission reminder job) are DB queries
or UI surfaces that do not yet exist; they are tracked under
**Deferred coverage** below.

### `isEligibleForFloatLookup` (8)

SW✓, SM✓, HM✗, BM✗, SW+HM✗ (HM dominates), SW+SM+HM✗, SW+BM✗, no roles✗.

### `isEligibleForBroadcast` (7)

SW✓, SM✓, HM✗, BM✗, SW+HM✗, SW+SM+HM✗, SW+SM+BM✗.

### `isEligibleForClaimPool` (7)

SW✓, SM✓, **HM✓** (BEH §2.3 — HMs may claim), SW+HM✓, BM✗, SW+BM✗,
HM+BM✗.

### `isEligibleForSwapCounterparty` (5)

SW✓, SM✓, HM✓, BM✗, SW+BM✗.

### Union semantics (2)

- SM-only (no explicit SW) is treated as a worker (BEH §2.7).
- SW+SM yields identical eligibility to SM-only across all four
  predicates.

---

## Deferred coverage (not in phase-02)

The following surfaces from the prompt's "behavioral surfaces to cover"
list are deferred because the relevant tables, queries, or UI do not
exist in phase-02. They will be covered in the indicated phase:

| Surface                                                    | Deferred to                         | Reason                                                                                                           |
| ---------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `is_active` filter on schedule-builder roster query        | phase-04                            | Schedule-builder query lives in phase-04                                                                         |
| `is_active` filter on HMOD-rotor population UI             | phase-02 implementation OR phase-12 | UI surface — out of scope for schema/pure-logic tests                                                            |
| `is_active` filter on cross-house feed visibility          | phase-05                            | Cross-house feed defined in phase-05                                                                             |
| `is_active` filter on preference-submission reminder job   | phase-04                            | Reminder cron lives with preferences                                                                             |
| Fired user's historical `shift_block_assignments` retained | phase-03                            | `shift_block_assignments` table created in phase-03                                                              |
| Contact lookup on past shift card surfaces fired-user info | phase-13                            | UI surface                                                                                                       |
| §2.6 rule 7: house cannot end up with no active HM/BM      | phase-02 (impl) OR later            | Cross-table invariant; requires more than schema-level constraints. Likely a trigger or application-layer check. |

---

## Ambiguities to resolve

Each item below is marked `// AMBIGUOUS` in the corresponding test file.
Implementer should re-check against the spec and adjust the test (and
this list) if the chosen interpretation differs.

1. **`user_roles` unique-key columns** (pgTAP §3). Spec does not pin
   which columns form the unique key. The test asserts the most
   defensible interpretation: `(user_id, role, scope_house_id)`. If the
   implementation uses `(user_id, role)` instead (forbidding the same
   role at multiple house scopes), the test must change. BEHAVIORAL §2.7
   is silent on this.

2. **`scope_house_id` enforcement mechanism** (pgTAP §6). The test
   asserts behavior — insert without scope for `sm/hm/bm` is rejected.
   It does not pin whether the enforcement is a `CHECK`, a partial
   unique index, or a trigger. Any of those satisfies the spec.

3. **Broadcast-subscribed guard mechanism** (pgTAP §8, §9, §13).
   ARCHITECTURE §3.1 specifies the _behavior_ (HM/BM cannot have
   `broadcast_subscribed=true`) and the _role-promotion hook_ (insert of
   hm/bm flips broadcast to false). It does not specify whether the
   write-time guard is a trigger, a `CHECK` over a denormalized column,
   or application-layer only. Since AGENTS.md mandates DB-layer
   integrity for hard invariants, the tests assert DB-layer behavior.

4. **`hm_leave.replacement_user_id → inactive user`** (pgTAP §11). Spec
   §2.6 implies you cannot designate a fired person but does not
   explicitly mandate DB-layer enforcement. The prompt's edge-case list
   pins this as a hard rule, so the test asserts DB-layer rejection.

5. **Float-lookup predicate for a user with no roles** (Vitest). Spec
   does not say "no roles → ineligible" explicitly, but every worker
   pipeline structurally requires a worker role. Test asserts ineligible.

6. **BM + SW role combination** (Vitest claim-pool, swap). ARCH §3.1
   says BM is "exclusive of worker roles for scheduling purposes." It is
   unclear whether the schema permits the combination at all (i.e., is
   `INSERT (bm, x)` allowed for a user who already has `sw`?). The pure
   predicates assume the combination can be constructed in memory and
   behave correctly; if the schema bars it, the pgTAP suite would need
   a test for that as well — currently NOT asserted.

7. **HM as swap counterparty** (Vitest swap). BEHAVIORAL §8 does not
   enumerate HMs as swap counterparties but does not exclude them. Since
   HMs hold shift assignments (§2.3), the test assumes they may swap.
   If implementation finds an excluded clause, this changes.

8. **SM implies SW** (Vitest union-semantics). BEHAVIORAL §2.7 says "an
   SM is also implicitly an SW." The test asserts that an SM-only user
   (no explicit SW row in `user_roles`) is treated as a worker by all
   four predicates. The implementation may instead require an explicit
   SW row alongside SM at write time, in which case this test stays
   green trivially because both rows always exist.

---

## How to run

```bash
# pgTAP (requires `supabase start` first)
supabase test db

# Vitest (will fail at import until eligibility.ts exists — TDD-first)
pnpm --filter @shift/core test
```
