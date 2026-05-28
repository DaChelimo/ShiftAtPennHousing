# Phase 12 — Notifications: Test Session

## Session Metadata

|                     |                                     |
| ------------------- | ----------------------------------- |
| **Model**           | Claude Opus 4.7 (`claude-opus-4-7`) |
| **Interface**       | Claude Code CLI                     |
| **Thinking mode**   | Standard                            |
| **TDD role**        | Test author — write tests only      |
| **Skill to invoke** | `engineering:testing-strategy`      |

---

## Prompt

You are writing tests for Phase 12: Notification System.

Branch: `phase-12-notifications`.

Sources of truth:

- BEHAVIORAL_SPECIFICATION.md §7 (float acknowledgment + ack cadence)
- BEHAVIORAL_SPECIFICATION.md §2.6 (HM leave emails — mailto deeplink)
- ARCHITECTURE.md §2.8 (ack_cadence_config — snapshot semantics)
- ARCHITECTURE.md §3.7 (notifications table)
- AGENTS.md

---

### Behavioral surfaces to cover

**Ack cadence reminders (§7.1):**

- Reminders fire at: 6h, 2h, 1h, 30m, 5m before the ack deadline (T-10m before float start)
- The 6h and 2h reminders are configurable per house via ack_cadence_config; can be disabled
- The 1h, 30m, 5m reminders are mandatory and not configurable
- Cadence is SNAPSHOTTED at float-assignment time — subsequent ack_cadence_config changes do NOT affect in-flight floats
- If float assigned with <6h to deadline: skip reminders whose offsets are already past; start from the next applicable offset

**push_tokens table:**

- One row per device per user
- platform: 'android' | 'ios'
- Unique constraint on (user_id, device_token)

**In-app delivery:**

- Notifications with delivered_at=NULL and scheduled_for<=NOW() are delivered
- Delivery = mark delivered_at, trigger Realtime push to the recipient's subscription
- acknowledged_at set when user opens updates tab

**Push notification dispatch:**

- Android: FCM via Firebase Admin SDK (in Edge Function)
- iOS: APNs via Firebase Admin SDK (unified path — Firebase handles APNs routing)
- dispatch_push(user_id, payload): resolves all device tokens for user, dispatches to each

**HM leave mailto deeplink:**

- System crafts a pre-filled email message per §2.6 rule 3
- API returns a mailto: URL (not an actual email send)
- Content: informs workers HM is on leave, names replacement + their role

---

### Edge cases

- Worker with no push_tokens (never registered a device) → in-app only delivery
- Worker with 2 devices (Android + iOS) → dispatch to both
- Ack reminder fires but float already acknowledged → reminder is silently suppressed (do not deliver reminder for an already-acknowledged float)
- ack_cadence_config changed after float assigned → the snapshotted values on the notification rows are used, not the new config
- Notification scheduled_for in the past when checked → deliver immediately

---

### Test files

1. `packages/core/tests/phase-12/ack-cadence.test.ts` — Vitest: cadence offset computation, snapshot semantics, skip-past-offsets
2. `supabase/tests/phase-12-notifications.sql` — pgTAP: table structure, delivery queue query
3. `tests/PHASE_12/TEST_PLAN.md`

---

### Commit

```
git commit -m "phase-12 tests: ack cadence (snapshot semantics, skip-past-offsets), push_tokens schema, notification delivery queue"
```
