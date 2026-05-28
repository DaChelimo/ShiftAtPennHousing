# Phase 05 — Open Shifts Feed & Claim: Spec Audit

## Session Metadata

|                     |                                     |
| ------------------- | ----------------------------------- |
| **Model**           | Claude Opus 4.7 (`claude-opus-4-7`) |
| **Interface**       | Claude Code CLI                     |
| **Thinking mode**   | High reasoning                      |
| **Skill to invoke** | `engineering:code-review`           |

---

## Prompt

Run a spec-adherence audit on the diff in branch `phase-05-feed-claim`.

Sources: BEHAVIORAL_SPECIFICATION.md §5.1–§5.3, §5.5, §5.6, §9.

Checklist:

**T-2h boundary (most commonly drifted):**

- [ ] The T-2h check is `block_start_at <= now() + INTERVAL '2 hours'` — claims at EXACTLY T-2h fail (spec §5.3: "strictly before T-2 hours succeed")
- [ ] The feed shows unpickable shifts as visible but not claimable — they don't disappear from the feed at T-2h

**Harnwell invariant:**

- [ ] Cross-house eligibility function hard-codes the Harnwell training constraint — it does NOT consult float_routing or any other config table
- [ ] A Quad worker attempting to claim a Harnwell shift is rejected at the Edge Function level
- [ ] A single-staff worker attempting to claim a Harnwell shift is rejected

**Hours cap:**

- [ ] Hard cap (40h) blocks the claim at the Edge Function (not just a warning)
- [ ] Soft cap (20h) produces a warning but DOES NOT block (worker can proceed)
- [ ] Cross-house hours count at the worker's HOME house, not the destination house
- [ ] Float-out hours ARE counted in the worker's weekly total (they're hours-neutral, not hours-exempt)

**Drop rules:**

- [ ] Drop rounds DOWN (not up) to the nearest 30-min boundary for "drop-from-now"
- [ ] Dropping a shift the worker is currently floating out from triggers re-escalation at the destination (flag this as a TODO if not yet implemented — it connects to phase-07)
- [ ] A shift dropped more than 30 days away is NOT immediately visible in the weekly feed

**Race condition:**

- [ ] The claim function uses FOR UPDATE lock or serializable transaction — not just a read-then-write pattern
- [ ] The error returned on a failed race is descriptive ("shift no longer available")

**Permanent openings feed:**

- [ ] Grouped by (house_id, day_of_week, block_start_time) — not raw individual blocks
- [ ] Shows weeks_remaining count

Do NOT make code changes. Report findings only.
