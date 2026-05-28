# Phase 13b — Admin Web: Implementation

## Session Metadata

|                   |                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------- |
| **Model**         | Claude Opus 4.7 (`claude-opus-4-7`)                                                |
| **Interface**     | Claude Code CLI                                                                    |
| **Thinking mode** | Standard                                                                           |
| **TDD role**      | Implementer                                                                        |
| **Note**          | Claude Code for UI phases — Codex's sandbox advantage is minimal for Next.js work. |

---

## Prompt

You are implementing Phase 13b: Admin Web App (Next.js).

Branch: `phase-13b-admin-web`. Tests committed — do NOT modify them.

Sources of truth:

- BEHAVIORAL_SPECIFICATION.md §4.3, §2.3, §2.6, §2.5
- AGENTS.md
- `tests/PHASE_13b/TEST_PLAN.md`

---

### Deliverables

**1. Auth-gated routing in `apps/web/app/`:**

- `/schedule-builder` — SM/HM/BM only, enforced via Supabase Auth + role check
- `/admin/leave` — HM/BM only
- `/admin/rotor` — HM/BM only
- Redirect unauthenticated users to `/login`

**2. Schedule Builder page (`/schedule-builder`):**

Desktop-only: add a viewport guard — if window.innerWidth < 1024, show "Please use a desktop browser" message.

Drag-picker component:

- Renders the week's block grid for the house
- User drags over 2–12 contiguous blocks to define a span
- On release: fetch the Phase 1 card via Edge Function (pass span block IDs)
- Card shows workers in three sections: Preferred / Available / Blocked
- Blocked workers rendered with disabled state and tooltip showing blocking reason
- Click a worker → drafts that worker for the span (POST to draft endpoint)
- Assigning over target hours → Warning modal ("Worker is at X/20h target. Assign anyway?")

Phase 2 toggle: button switches card to Phase 2 mode (all workers, no hard blocks, advisory warnings).

Publish button: calls `/permanent-publish` Edge Function, shows confirmation modal with stats.

**3. HM Leave page (`/admin/leave`):**

- Form: select leave dates, select replacement (picker excludes incoming-chain members)
- Submit: calls Edge Function; on success shows mailto: link for the pre-filled leave notification email
- "I'm back" button on active leaves → early return

**4. HMOD Rotor page (`/admin/rotor`):**

- Grid view of weeks for the semester
- Dropdown per week to select HMOD from eligible HMs/BMs
- Save: upserts hmod_rotor rows

**5. Manual override panel (accessible from schedule builder and from workers' shift cards):**

- SM/HM/BM can assign/remove workers from individual blocks
- Shows warning if the worker has cannot preference or opted out (Phase 2 advisory behavior)

---

### Commit

```
git commit -m "phase-13b impl: Next.js schedule builder (drag-picker, Phase 1/2 card, publish), HM leave form with mailto deeplink, HMOD rotor admin, manual override panel"
```
