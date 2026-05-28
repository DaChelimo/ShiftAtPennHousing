# Phase 12 — Notifications: Spec Audit

## Session Metadata

|                     |                                     |
| ------------------- | ----------------------------------- |
| **Model**           | Claude Opus 4.7 (`claude-opus-4-7`) |
| **Interface**       | Claude Code CLI                     |
| **Thinking mode**   | Standard                            |
| **Skill to invoke** | `engineering:code-review`           |

---

## Prompt

Run a spec-adherence audit on the diff in branch `phase-12-notifications`.

Sources: BEHAVIORAL_SPECIFICATION.md §7, §2.6. ARCHITECTURE.md §2.8, §3.7.

Checklist:

- [ ] Ack cadence values are SNAPSHOTTED at float-assignment time onto the notification rows — the delivery job reads the snapshotted values, not the live ack_cadence_config
- [ ] 1h, 30m, 5m reminders are NOT configurable — they are always created at float-assignment time
- [ ] 6h and 2h reminders: if null in ack_cadence_config → they are SUPPRESSED (not created)
- [ ] Past reminders (whose scheduled_for < float_assigned_at) are NOT created
- [ ] Reminder for an already-acknowledged float → not delivered
- [ ] Both Android (FCM) and iOS (APNs) are dispatched for the same notification if user has both device types registered
- [ ] Worker with no registered device tokens → notification created (for in-app) but no push dispatch error

Do NOT make code changes. Report findings only.
