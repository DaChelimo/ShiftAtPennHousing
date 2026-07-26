# Supabase Usage / Cost Waste — Remediation Checklist

Companion to `supabase-usage-waste-audit.md`. One row per finding. A box is checked only
after the fix is implemented **and** verified (measurement, test, or build).

## Product decisions taken (2026-07-26)

| Q                      | Decision                                                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F-04 pre-launch houses | **Skip entirely.** The orchestrator never scans or escalates a house whose `launch_state <> 'live'` while the staggered-launch gate is on.                                                                                           |
| F-14 retention         | **Delete outright at 28 days.** After four weeks the float/notification detail is not acted on. No archive tables.                                                                                                                   |
| F-01 horizon           | **6-week bound on the weekly feed** — _provided permanent openings stay pickable._ Delivered by giving the permanent feed its own, longer 26-week bound. Verified: the horizon drops 27,972 weekly rows and **zero** permanent rows. |
| F-02 debounce          | **500 ms** debounce + conflate on the mobile Realtime refetch.                                                                                                                                                                       |

## Checklist

| #    | Finding                                       | Sev      | Status | Evidence                                                                                                                                               |
| ---- | --------------------------------------------- | -------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F-01 | `worker_open_shifts` unbounded CROSS JOIN     | Critical | [x]    | 130,343 → **1,483 buffers**, 270 → 47 ms. Full-projection diff vs the old definition: 1,752,053 rows, **0 differing**.                                 |
| F-02 | Unfiltered Realtime sub + undebounced refetch | Critical | [x]    | `debounce(500ms).conflate()` in `WorkerShiftsRepository`; KMP + iOS + Android build green.                                                             |
| F-03 | `dispatch-push` unbounded retry loop          | Critical | [x]    | 13 simulated failures → dead-lettered, `delivered_at` still NULL, gone from the queue even at now+10y.                                                 |
| F-04 | `orchestrator-tick` N+1 + no launch filter    | Critical | [x]    | Idle tick **210+ → 9 DB round trips**. Gate on: 10,461 seats/13 houses → **61 seats/1 house**.                                                         |
| F-05 | `worker_my_shifts` per-row RLS predicate      | High     | [x]    | 149 → **5 ms**, 30,478 → 19,223 buffers. RLS visibility byte-identical across 7 role archetypes × 3 tables.                                            |
| F-06 | `processNoAckFloats` scan + N+1               | High     | [x]    | `pending_floats_due_for_no_ack` + partial index; 1 + N round trips → 1.                                                                                |
| F-07 | `getSessionUser()` not memoised               | High     | [x]    | Wrapped in React `cache()`; `tsc --noEmit` clean.                                                                                                      |
| F-08 | `pending_notification_deliveries` seq scan    | High     | [x]    | Live-queue partial index + terminal states; suppressed reminders now leave the queue.                                                                  |
| F-09 | Row-by-row bulk writes detonate subscribers   | High     | [x]    | Capped by F-02 (the audit's own rank-1 remedy). Applies now serialized by advisory lock. Set-based rewrite **deliberately declined** — see note below. |
| F-10 | Swap expiry runs twice a minute               | Medium   | [x]    | `expire_pending_swaps_if_uncronned` defers to the cron; no more RETURNING egress.                                                                      |
| F-11 | iOS 2 channels / 2 refetch loops, no gate     | Medium   | [x]    | Shared refcounted flow (2 channels → 1) + `scenePhase` teardown. iOS `BUILD SUCCEEDED`.                                                                |
| F-12 | `select *` on wide views                      | Medium   | [x]    | Explicit `Columns.list` on both hot feeds and notifications.                                                                                           |
| F-13 | `KnowledgeIntake` 3 s `router.refresh()` poll | Medium   | [x]    | 5 s base with backoff to 30 s; gate unchanged.                                                                                                         |
| F-14 | No retention on floats / notifications        | Medium   | [x]    | Daily 03:20 purge, chunked; never deletes a pending float or a non-terminal notification.                                                              |
| F-15 | Dev sim-clock migration ships to prod         | Low      | [x]    | DB-level trigger, **default deny**; reset-to-zero always allowed.                                                                                      |
| F-16 | KB re-embeds with no content-hash guard       | Low      | [x]    | `kb_embedding_cache` keyed on (sha256, model); metrics still report only what was billed.                                                              |
| F-17 | Desk Assistant per-message spend              | Low      | [x]    | Investigated: the two `users` reads are **different users**, not a redundancy. Routing branch now reuses the first fetch when they coincide.           |
| F-18 | Missing indexes on hot predicates             | Low/Med  | [x]    | Both confirmed indexes added. The third (speculative) one was **measured and rejected** — see note.                                                    |

## Notes on the two deliberate non-changes

**F-18's third index.** The audit proposed `shift_block_assignments (status) WHERE status = 'vacant'`
and flagged it as speculative. It is: 35,956 of 41,836 rows (86%) are vacant, so the planner
correctly prefers a seq scan and the index would only cost writes. A genuinely selective
variant shipped instead — `(block_id) WHERE status = 'vacant' AND vacancy_origin = 'permanent_drop'` —
which is what the permanent-openings scan actually needs.

**F-09's set-based rewrite.** Declined, with a specific reason rather than a preference:
`enforce_block_occupied_headcount` reads `shift_blocks.required_headcount`, and the seat
INSERTs happen in the same loop iteration as the headcount UPDATE. Deferring the UPDATE so it
can be batched makes the trigger evaluate against the old headcount and reject the insert. The
ordering is load-bearing. Layered on that, the headcount-decrease cut order is specified
behaviour with pgTAP coverage. The audit ranks this last of the real findings and says the
F-02 debounce drops it to Medium on its own; that debounce has shipped.

## Must-not-break (audit §5 + AGENTS.md) — all verified intact

1. At-least-once push: `delivered_at` is **never** stamped before a successful send. _(pgTAP asserts it explicitly.)_
2. `loadCoveredBlockIds` still guards the gap builder; the coverage check still runs per row.
3. `MAX_ALLIED_COVERAGE_BLOCKS = 8` / `LOOKAHEAD_MINUTES` unchanged.
4. `apply_compiled_season` dry-run still a rolled-back subtransaction sharing apply's logic.
5. Per-collector Realtime topic uniqueness kept; the _flow_ is shared, not the topic.
6. Dual emission of permanent-drop occurrences preserved _(and now actually asserted — the old test predated it)_.
7. All four `shift_block_assignments` SELECT policies remain separate policies.
8. Harnwell training constraint unchanged, character for character.
9. Headcount-decrease cut order and the grandfathering-aware trigger untouched.
