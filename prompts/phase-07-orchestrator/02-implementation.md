# Phase 07 — Orchestrator & Escalation: Implementation

## Session Metadata

|                   |                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Model**         | OpenAI Codex (`codex-1` or latest available)                                                                           |
| **Interface**     | Codex CLI                                                                                                              |
| **Thinking mode** | High reasoning                                                                                                         |
| **TDD role**      | Implementer                                                                                                            |
| **Note**          | The no-ack trigger and rollback semantics are the hardest parts. Implement them last after the happy-path chain works. |

---

## Prompt

You are implementing Phase 07: Orchestrator and Escalation Chain.

Branch: `phase-07-orchestrator`. Tests committed — do NOT modify them.

Sources of truth:

- BEHAVIORAL_SPECIFICATION.md §5.4, §7.3, §10
- ARCHITECTURE.md §4 (all sub-sections), §4.6
- AGENTS.md
- `tests/PHASE_07/TEST_PLAN.md`

---

### Deliverables

**1. Migration: `block_step_status` table (ARCHITECTURE.md §4.1)**

```sql
CREATE TABLE block_step_status (
  block_id    uuid NOT NULL REFERENCES shift_blocks(block_id),
  step_name   text NOT NULL,   -- 'broadcast', 'float_lookup', 'hmod_notify_allied'
  status      text NOT NULL CHECK (status IN ('fired', 'completed_via_force_trigger', 'rolled_back')),
  fired_at    timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (block_id, step_name)
);
```

**2. Migration: `notifications` table (ARCHITECTURE.md §3.7)**

```sql
CREATE TYPE notification_type AS ENUM (
  'personal_shift', 'broadcast', 'hmod_urgent', 'ack_reminder',
  'swap_request', 'hm_leave_notice', 'sm_permanent_drop_alert', 'sw_permanent_removal_alert'
);

CREATE TABLE notifications (
  notification_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id   uuid NOT NULL REFERENCES users(user_id),
  type                notification_type NOT NULL,
  delivered_at        timestamptz,
  scheduled_for       timestamptz,
  payload             jsonb NOT NULL DEFAULT '{}',
  acknowledged_at     timestamptz
);
```

**3. packages/core/src/escalation/:**

`step-evaluator.ts`:

```typescript
export function shouldFireStep(
  stepName: string,
  stepOffsetSeconds: number, // negative = before block start
  blockStartAt: Date,
  stepStatus: 'not_fired' | 'fired' | 'completed_via_force_trigger' | 'rolled_back',
  now: Date,
): boolean;
```

Rule: fire if `now >= blockStartAt + stepOffsetSeconds` AND status is 'not_fired' or 'rolled_back'.

`notification-router.ts`:

```typescript
export function resolveNotificationTarget(params: {
  blockStartAt: Date;
  escalationFiredAt: Date;
  blockHouseId: string;
  hmWorkingHoursStart: string; // '08:00'
  hmWorkingHoursEnd: string; // '17:00'
  timezone: string; // 'America/New_York'
}): 'hm' | 'hmod';
```

Rules:

- 'hm' if: escalationFiredAt is Mon–Fri, [08:00, 17:00) local time AND blockStartAt is Mon–Fri, [08:00, 17:00)
- 'hmod' otherwise (including weekends, outside HM hours, or if blockStartAt is outside HM hours)
- At exactly 08:00 → 'hm' (inclusive lower bound)
- At exactly 17:00 → 'hmod' (exclusive upper bound for HM)

**4. Supabase Edge Function: `supabase/functions/orchestrator-tick/index.ts`**

Called by pg_cron every minute.

Logic:

1. Query vacant blocks within lookahead window (next 3 hours + 5 min buffer):

   ```sql
   SELECT sba.*, sb.block_start_at, sb.house_id
   FROM shift_block_assignments sba
   JOIN shift_blocks sb ON sba.block_id = sb.block_id
   WHERE sba.status = 'vacant'
     AND sb.block_start_at BETWEEN now() AND now() + INTERVAL '3 hours 5 minutes'
   ```

2. For each block: load its profile's escalation_chain, evaluate steps via `shouldFireStep`, fire any due steps not yet in block_step_status.

3. INSERT INTO block_step_status on first fire. Use `ON CONFLICT (block_id, step_name) DO NOTHING` to prevent double-firing.

4. Scan float_assignments WHERE status='pending' AND block_start_at <= now() + INTERVAL '15 minutes' → trigger no-ack logic for unacknowledged ones.

5. Scan swap_requests WHERE status='pending' AND expires_at <= now() → set status='expired'.

**5. Chain step Edge Functions (or inline handlers):**

`broadcast_step(blockId)`:

- SELECT users WHERE broadcast_subscribed=true AND home_house_id=:houseId AND is_active=true
- INSERT notifications for each (no role filter — guard at write time ensures no HM/BM subscribed)

`float_lookup_step(blockId)`:

- Fetch all necessary data (vacant blocks, source house workers, exclusions, float_routing)
- Call `findFloaters` from packages/core
- If assignments: write float_assignments rows + update shift_block_assignments to pending_float_in/out
- If empty: immediately call `hmod_notify_allied_step`

`hmod_notify_allied_step(blockId)`:

- Resolve notification target via `resolveNotificationTarget`
- If 'hm': resolve effective HM via hm_leave chain; INSERT notification
- If 'hmod': resolve HMOD via hmod_rotor + hm_leave; INSERT notification

**6. pg_cron setup:**

```sql
SELECT cron.schedule(
  'orchestrator-tick',
  '* * * * *',  -- every minute
  $$SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/orchestrator-tick',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key'))
  )$$
);
```

**7. No-ack trigger logic (in orchestrator-tick or separate Edge Function):**
For each overdue pending float (T-15m before float start with no ack/decline):

1. BEGIN TRANSACTION
2. UPDATE float_assignments SET status='voided', declined_at=now()
3. UPDATE shift_block_assignments SET status='vacant', vacancy_origin=... for destination blocks
4. INSERT INTO float_exclusions (reason='no_acknowledgment')
5. UPDATE block_step_status SET status='rolled_back' for broadcast + float_lookup rows (if force_triggered)
6. Source-side reconciliation:
   - Check if source-side gap (worker's original seat) is still vacant
   - If still vacant → UPDATE source assignment back to original status ('scheduled' or 'claimed')
   - If claimed/allied → leave; worker is displaced (vacancy_origin='displaced_decliner')
7. INSERT notification for hmod_notify_allied (T-2h always past at T-15m)
8. COMMIT

---

### Commit

```
git commit -m "phase-07 impl: block_step_status + notifications migrations, orchestrator tick Edge Function (pg_cron), escalation chain steps (broadcast, float_lookup, hmod_notify_allied), no-ack trigger with source-side reconciliation"
```
