# Phase 14 — Admin Extras: Implementation

## Session Metadata

|                   |                                              |
| ----------------- | -------------------------------------------- |
| **Model**         | OpenAI Codex (`codex-1` or latest available) |
| **Interface**     | Codex CLI                                    |
| **Thinking mode** | Standard                                     |
| **TDD role**      | Implementer                                  |

---

## Prompt

You are implementing Phase 14: Admin Extras.

Branch: `phase-14-admin-extras`. Tests committed — do NOT modify them.

Sources of truth:

- BEHAVIORAL_SPECIFICATION.md §9.3, §3.2
- ARCHITECTURE.md §3.10
- AGENTS.md
- `tests/PHASE_14/TEST_PLAN.md`

---

### Deliverables

**1. Edge Function: `supabase/functions/modify-weekly-cap/index.ts`**

- POST `/modify-weekly-cap { week_start_date, hours_cap, cap_enforcement }`
- Caller must hold hm or bm role (not sm, not sw)
- Upsert into weekly_cap_overrides
- Does NOT retroactively change existing assignments

**2. Next.js page: `/admin/cap`**

- Calendar-style week picker
- Set cap to 20 (soft) or 40 (hard) per week
- Shows current effective cap per week (from weekly_cap_overrides or profile default)
- SM role → route is 403 (role-gated)

**3. Next.js page: `/admin/config`**

- List of system_config key-value pairs
- Editable only by project administrator role
- Inline edit with audit trail (modified_by, modified_at, notes)
- Changes reflected in orchestrator within next tick

**4. Observability (basic):**

- Edge Function logging: all orchestrator ticks log a summary (blocks scanned, steps fired, errors)
- Log to Supabase's built-in function logs
- A simple `/admin/health` page showing last orchestrator tick timestamp and any errors

---

### Commit

```
git commit -m "phase-14 impl: weekly cap modification (HM/BM only, global), system_config admin UI, basic orchestrator health page"
```
