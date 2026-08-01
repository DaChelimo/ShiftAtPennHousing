# Accepted Risks

Deliberate tradeoffs. The `ship-check` persona reads this file before reporting and must not
re-raise anything registered here.

This register exists because the fastest way to make a recurring QA function get ignored is to
have it rediscover the same known tradeoff every pass. A re-raised accepted risk is an error
on the persona's part, not a harmless duplicate.

## How to use it

**Adding an entry.** A risk belongs here when the behavior is _known, deliberate, and priced_.
"We have not gotten to it yet" is a backlog item, not an accepted risk. If nobody made a
decision, do not register it, because registering it silences the next person who finds it.

**Challenging an entry.** An accepted risk is falsifiable. A tradeoff is priced against
conditions, and conditions change. The persona may challenge a registered risk, but must say
explicitly that it is doing so and argue what changed. That is different from forgetting to
look, which is the thing this file prevents.

**Retiring an entry.** When the risk is fixed, delete the entry and note the migration or
commit that closed it. Do not leave tombstones; a stale acceptance is worse than no register.

## Format

```
### <short name>
**Behavior**: what the system actually does
**Why accepted**: the tradeoff, and what the alternative would have cost
**Decided**: YYYY-MM-DD, by whom
**Bound**: what keeps the blast radius small
**Revisit when**: the condition that would make this no longer acceptable
**Source**: file:line or spec section
```

## Register

### Push delivery is at-least-once

**Behavior**: The once-a-minute `deliver_pending_notifications` cron can re-enqueue an
in-flight notification, so a dispatch straddling a minute boundary may push twice.
**Why accepted**: BSpec 10.1 makes personal notifications mandatory. The alternative (stamping
`delivered_at` before sending) converts a rare duplicate into a possible lost push, which is
strictly worse for a worker who needs to know their shift changed.
**Decided**: Phase 12, recorded in `AGENTS.md`.
**Bound**: `dispatch-push` re-checks `pending_notification_deliveries` before sending, and
`deliver_notification` is idempotent.
**Revisit when**: duplicate pushes are observed often enough that workers start ignoring them.
**Source**: `AGENTS.md` Phase 12 note.

### Force-trigger bypasses the coverage floor

**Behavior**: `force_trigger_float` is not gated by the "desk would be EMPTY" coverage floor
that gates automated escalation.
**Why accepted**: It is a deliberate manual override by an authorized admin. The floor exists
to stop the _automated_ chain from over-floating a still-staffed desk; a human choosing to
float a covered desk is exercising judgement the automation does not have.
**Decided**: 2026-06-23, with the coverage-floor change.
**Bound**: Restricted to schedule admins. Every other invariant (Harnwell training, float
direction, no-takeback) still applies at the write point.
**Revisit when**: force-trigger starts being used routinely rather than exceptionally.
**Source**: `AGENTS.md` [Coverage] note.

### Force-trigger does not set the coverage lock marker

**Behavior**: The force-trigger path does not set `shift_blocks.coverage_locked_at`, so a
force-triggered float does not lock the source seats against pickup the way the orchestrator
path does.
**Why accepted**: Flagged at implementation time and deliberately deferred, because
force-trigger is dormant in the shipped product.
**Decided**: 2026-06-27, with migration `20260627000001`.
**Bound**: The path is not reachable in normal operation today.
**Revisit when**: force-trigger ships to real users. At that point this becomes a live P1, not
an accepted risk.
**Source**: `AGENTS.md` [Coverage-lock] note.
