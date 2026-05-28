# Phase 14 — Admin Extras: Test Session

## Session Metadata

|                   |                                                                           |
| ----------------- | ------------------------------------------------------------------------- |
| **Model**         | Claude Sonnet 4.6 (`claude-sonnet-4-6`)                                   |
| **Interface**     | Claude Code CLI                                                           |
| **Thinking mode** | Standard                                                                  |
| **TDD role**      | Test author                                                               |
| **Note**          | Sonnet is sufficient here — this is configuration UI, not algorithm work. |

---

## Prompt

You are writing tests for Phase 14: Admin Extras.

Branch: `phase-14-admin-extras`.

Sources of truth:

- BEHAVIORAL_SPECIFICATION.md §9.3 (hours cap modification)
- ARCHITECTURE.md §3.10 (system_config)
- BEHAVIORAL_SPECIFICATION.md §3.2 (profile definitions)
- AGENTS.md

---

### Behavioral surfaces to cover

**Cap modification (§9.3):**

- HM or BM (of ANY house) can modify the cap for any calendar week
- Modification is global — applies to all 13 houses simultaneously
- SM cannot modify cap
- Can set to 20 (soft, overridable) or 40 (hard)
- Effect on existing state: workers already over the new cap are NOT retroactively unassigned
- Pending float assignments for over-cap workers survive the cap change
- New claims after the cap change respect the new cap

**system_config admin UI:**

- Only project administrator can modify system_config values
- Changes take effect within the next orchestrator tick (~60 seconds)
- Audit trail: modified_by + modified_at + notes column

---

### Test files

1. `packages/core/tests/phase-14/cap-modification.test.ts` — Vitest: cap application logic, retroactive non-effect
2. `apps/web/e2e/cap-modification.spec.ts` — Playwright: HM modifies cap, SM is blocked
3. `tests/PHASE_14/TEST_PLAN.md`

---

### Commit

```
git commit -m "phase-14 tests: cap modification (HM/BM only, global, retroactive non-effect), system_config admin"
```
