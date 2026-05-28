# Phase 12 — Notifications: Implementation

## Session Metadata

|                   |                                              |
| ----------------- | -------------------------------------------- |
| **Model**         | OpenAI Codex (`codex-1` or latest available) |
| **Interface**     | Codex CLI                                    |
| **Thinking mode** | Standard                                     |
| **TDD role**      | Implementer                                  |

---

## Prompt

You are implementing Phase 12: Notification System.

Branch: `phase-12-notifications`. Tests committed — do NOT modify them.

Sources of truth:

- BEHAVIORAL_SPECIFICATION.md §7, §2.6
- ARCHITECTURE.md §2.8, §3.7
- AGENTS.md
- `tests/PHASE_12/TEST_PLAN.md`

---

### Deliverables

**1. Migration: `push_tokens` table**

```sql
CREATE TABLE push_tokens (
  token_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  platform      text NOT NULL CHECK (platform IN ('android', 'ios')),
  device_token  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  UNIQUE (user_id, device_token)
);
```

**2. packages/core/src/notifications/ack-cadence.ts:**

```typescript
const MANDATORY_OFFSETS_MINUTES = [60, 30, 5]; // before ack deadline
const DEFAULT_CONFIGURABLE_OFFSETS_MINUTES = [360, 120]; // 6h, 2h

export function computeAckReminderSchedule(params: {
  floatStartAt: Date;
  ackDeadlineOffsetMinutes: number; // default 10 (deadline = start - 10min)
  configuredOffsets: { offset6h: number | null; offset2h: number | null };
  floatCreatedAt: Date;
}): Date[];
// Returns sorted array of reminder timestamps (past ones excluded)
```

Snapshot semantics: when a float is created, the current ack_cadence_config values are fetched and baked into the scheduled notification rows. The function above operates on the snapshotted values.

**3. Edge Function: `supabase/functions/dispatch-push/index.ts`**

```typescript
// Called by notification delivery job
POST /dispatch-push { user_id, notification_id }
```

- Fetch all push_tokens for user_id
- If no tokens → skip (in-app only)
- Dispatch to Firebase Admin SDK (both FCM and APNs via the same Firebase project)
- Update push_tokens.last_used_at
- Mark notification.delivered_at

**4. pg_cron: notification delivery job**

```sql
SELECT cron.schedule('deliver-notifications', '* * * * *',
  $$SELECT deliver_pending_notifications()$$
);
```

SQL function: SELECT notifications WHERE delivered_at IS NULL AND scheduled_for <= NOW(); for each, call dispatch-push Edge Function.

**5. Supabase Realtime:**
Enable Realtime on the `notifications` table (publication). Mobile/web clients subscribe to `notifications` filtered by `recipient_user_id = auth.uid()`. On INSERT (delivered notification) → client receives in-app notification.

**6. Edge Function: `supabase/functions/generate-leave-mailto/index.ts`**
`GET /leave-mailto?leave_id=...` — returns `{ mailtoUrl: string }` with pre-filled subject + body per §2.6 rule 3.

**7. HM leave ack email:**
`POST /register-push-token { platform, device_token }` — authenticated; upserts into push_tokens.

---

### Commit

```
git commit -m "phase-12 impl: push_tokens table, ack cadence snapshot computation, dispatch-push Edge Function (FCM + APNs via Firebase), Realtime on notifications, leave mailto generator"
```
