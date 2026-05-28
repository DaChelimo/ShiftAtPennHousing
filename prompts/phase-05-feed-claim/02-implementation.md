# Phase 05 — Open Shifts Feed & Claim: Implementation

## Session Metadata

|                   |                                              |
| ----------------- | -------------------------------------------- |
| **Model**         | OpenAI Codex (`codex-1` or latest available) |
| **Interface**     | Codex CLI                                    |
| **Thinking mode** | High reasoning                               |
| **TDD role**      | Implementer                                  |

---

## Prompt

You are implementing Phase 05: Open Shifts Feed and Claiming.

Branch: `phase-05-feed-claim`. Tests committed — do NOT modify them.

Sources of truth:

- BEHAVIORAL_SPECIFICATION.md §5.1–§5.3, §5.5, §5.6, §9
- AGENTS.md
- `tests/PHASE_05/TEST_PLAN.md`

---

### Deliverables

**1. SQL views (RLS-scoped):**

`weekly_feed_for_house(house_id, calling_user_id)` — returns function or view:

- Vacant shift_block_assignments where block_start_at > now() AND block_start_at <= now() + INTERVAL '30 days'
- Excludes blocks past T-2h cutoff (block_start_at <= now() + INTERVAL '2 hours' → unpickable)
- Scoped to the calling user's eligible houses

`permanent_openings_feed(calling_user_id)` — returns grouped permanent vacancies:

```sql
-- Groups by (house_id, day_of_week, block_start_time) to present as recurring slots
SELECT house_id, EXTRACT(DOW FROM block_start_at) as day_of_week,
       block_start_at::time as block_start_time,
       COUNT(*) as weeks_remaining
FROM shift_block_assignments sba
JOIN shift_blocks sb ON sba.block_id = sb.block_id
WHERE sba.status = 'vacant' AND sba.vacancy_origin = 'permanent_drop'
  AND sb.block_start_at > now()
GROUP BY house_id, day_of_week, block_start_time
```

**2. packages/core/src/hours/index.ts:**

```typescript
export function computeWeeklyHours(assignments: Assignment[], weekStart: Date): number;
export function checkHoursCap(
  currentHours: number,
  additionalBlocks: number,
  cap: number,
  enforcement: 'soft' | 'hard',
): { allowed: boolean; warning: boolean; projectedHours: number };
```

**3. packages/core/src/eligibility/cross-house.ts:**

```typescript
export function getCrossHouseEligibility(homeHouseId: string, allHouseIds: string[]): string[];
// Returns array of house IDs the worker can pick up at
// Harnwell worker → all houses
// Quad worker → all 11 single-staff (NOT Harnwell)
// Single-staff worker → Quad + other 10 single-staff (NOT Harnwell)
// Hard-coded Harnwell constraint — NOT configurable via float_routing
```

**4. Edge Function: `supabase/functions/claim-shift/index.ts`**

`POST /claim-shift` with `{ assignment_id, claim_type: 'temporary' | 'permanent' }`

Logic:

1. Fetch the target shift_block_assignments row with a `FOR UPDATE` lock (serializable)
2. Validate status='vacant' and block_start_at > now() + INTERVAL '2 hours' (T-2h check)
3. Validate cross-house eligibility (Harnwell training constraint)
4. Check for time conflicts (no other assignment for this user in the same block)
5. Compute projected hours; if over hard cap → reject; if over soft cap → return warning in response
6. UPDATE shift_block_assignments SET status='claimed', user_id=calling_user, is_cross_house_pickup=(home_house != block_house), source_house_id=(if cross-house: home_house)
7. Return success or specific error code

Race condition protection: `SELECT ... FOR UPDATE NOWAIT` or use a serializable transaction. If the row is already locked (another claim in flight), return a "shift no longer available" error immediately.

**5. Edge Function: `supabase/functions/drop-shift/index.ts`**

`POST /drop-shift` with `{ assignment_ids: string[], drop_type: 'temporary' }` (permanent drop in phase-10)

Logic:

1. Validate calling user owns all assignment_ids
2. Validate assignment_ids form a contiguous block run (30-min blocks only)
3. Check if gap start is within 20 minutes → allow but return `shortNoticeWarning: true`
4. For drop-from-now: round DOWN to nearest 30-min boundary
5. UPDATE assignments to status='vacant', vacancy_origin='temporary_drop', user_id=NULL
6. Schedule escalation: if gap_start within 2h → direct HMOD notification; otherwise enter feed (no immediate action — orchestrator handles T-3h/T-2h)
7. Check if drop leaves desk below required_headcount — if yes AND gap within 2h, fire escalation

---

### Commit

```
git commit -m "phase-05 impl: weekly feed + permanent openings queries, cross-house eligibility module, claim-shift Edge Function (with T-2h + race protection), drop-shift Edge Function, hours cap checks in core/"
```
