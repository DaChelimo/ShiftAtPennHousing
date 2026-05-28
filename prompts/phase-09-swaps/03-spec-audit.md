# Phase 09 — Swaps: Spec Audit

## Session Metadata

|                     |                                     |
| ------------------- | ----------------------------------- |
| **Model**           | Claude Opus 4.7 (`claude-opus-4-7`) |
| **Interface**       | Claude Code CLI                     |
| **Thinking mode**   | Standard                            |
| **Skill to invoke** | `engineering:code-review`           |

---

## Prompt

Run a spec-adherence audit on the diff in branch `phase-09-swaps`.

Sources: BEHAVIORAL_SPECIFICATION.md §8.1–§8.3. ARCHITECTURE.md §3.5.

Checklist:

- [ ] Shift swap expiry is T-3h of the EARLIER span (not the later)
- [ ] Float swap expiry is 24h after LATEST end-time (not earliest)
- [ ] Permanent swap expiry is 7 days (not 24h, not 48h)
- [ ] Permanent swap acceptance skips weeks where Worker A no longer owns the slot
- [ ] Permanent swap applies ONLY to regular_school_year profile — break shifts cannot be permanently swapped
- [ ] Eligibility guard runs TWICE: at creation time (pre-creation guard) AND at acceptance time (acceptance guard)
- [ ] If acceptance guard fails, the swap is rejected at acceptance time (not silently accepted)
- [ ] Float swap accepted retroactively: no cap re-check is performed
- [ ] SM/HM is NOT involved in permanent swap creation or approval — workers act directly

Do NOT make code changes. Report findings only.
