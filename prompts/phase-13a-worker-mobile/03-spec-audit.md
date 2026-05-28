# Phase 13a — Worker Mobile: Spec Audit

## Session Metadata

|                     |                                     |
| ------------------- | ----------------------------------- |
| **Model**           | Claude Opus 4.7 (`claude-opus-4-7`) |
| **Interface**       | Claude Code CLI                     |
| **Thinking mode**   | Standard                            |
| **Skill to invoke** | `engineering:code-review`           |

---

## Prompt

Run a spec-adherence audit on the diff in branch `phase-13a-worker-mobile`.

Sources: BEHAVIORAL_SPECIFICATION.md §5.6, §5.2, §5.3, §7.

Checklist:

- [ ] Tab 1 ordering: picked-up shifts at TOP, dropped-but-open in MIDDLE, scheduled at BOTTOM — not sorted by time
- [ ] Tab 3 is EMPTY during winter break for non-Harnwell workers (Harnwell operates; all other houses closed)
- [ ] Claim button is DISABLED (not hidden) at T-2h — shift is visible but not claimable
- [ ] Drop within 20 minutes shows a WARNING before confirming (not blocked — drops are always permitted)
- [ ] Drop-from-now rounds DOWN to nearest 30-min boundary (not up, not to current time)
- [ ] Ack deadline countdown is T-10m before float start — not T-5m, not T-2h
- [ ] iOS and Android push token registration both POST to the same endpoint with the correct platform field
- [ ] Realtime subscription updates without requiring a manual pull-to-refresh

Do NOT make code changes. Report findings only.
