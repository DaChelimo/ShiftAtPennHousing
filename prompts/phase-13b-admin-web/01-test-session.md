# Phase 13b — Admin Web (Next.js): Test Session

## Session Metadata

|                   |                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| **Model**         | Claude Opus 4.7 (`claude-opus-4-7`)                                                                        |
| **Interface**     | Claude Code CLI                                                                                            |
| **Thinking mode** | Standard                                                                                                   |
| **TDD role**      | Test author — write tests only                                                                             |
| **Note**          | Playwright E2E is the primary test mechanism for UI phases. Unit tests focus on the drag-picker algorithm. |

---

## Prompt

You are writing tests for Phase 13b: Admin Web App (Next.js — SM/HM schedule builder and admin tools).

Branch: `phase-13b-admin-web`.

Sources of truth:

- BEHAVIORAL_SPECIFICATION.md §4.3 (schedule building phases — DESKTOP ONLY)
- BEHAVIORAL_SPECIFICATION.md §2.3 (HM/BM manual override powers)
- BEHAVIORAL_SPECIFICATION.md §2.6 (HM leave)
- BEHAVIORAL_SPECIFICATION.md §2.5 (HMOD rotor)
- AGENTS.md

---

### Behavioral surfaces to cover

**Schedule builder (SM, desktop-only per spec §4.3):**

- Drag-picker spans 2–12 consecutive 30-min blocks (1h–6h)
- Phase 1 card shows workers grouped: preferred / available / blocked (with reason)
- A worker with no preference for any span block → blocked group (not available)
- Blocked workers are non-selectable in Phase 1 (visually disabled)
- Phase 2: all workers visible, cannot/opted-out shown as advisory warning (not hard block)
- Assigning a worker over their target hours shows a warning popup
- Post-publish overrides work same as Phase 2 (direct to shift_block_assignments)

**HM leave management:**

- SM cannot submit HM leave (only HM/BM can)
- Cycle prevention: selected replacement cannot be in the incoming chain
- System generates a pre-filled mailto URL for leave notification email

**HMOD rotor admin:**

- Only HMs/BMs can populate the rotor
- Rotor entries are per-week; each week has exactly one HMOD

---

### Test files

1. `packages/core/tests/phase-13b/phase1-card-algorithm.test.ts` — Vitest: the span → preferred/available/blocked computation (same logic from phase-04 but now wired to the web UI)
2. `apps/web/e2e/schedule-builder.spec.ts` — Playwright E2E:
   - SM logs in, navigates to schedule builder
   - Drags a span, sees workers grouped correctly
   - Assigns a worker, verifies draft updated
   - Publishes, verifies workers see their shifts
3. `apps/web/e2e/hm-leave.spec.ts` — Playwright E2E: HM creates leave, replacement selected, mailto URL generated
4. `tests/PHASE_13b/TEST_PLAN.md`

---

### Commit

```
git commit -m "phase-13b tests: schedule builder Phase 1 grouping, SM drag-picker E2E, HM leave flow E2E"
```
