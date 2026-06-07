# Web Remediation Program — STATUS

Live tracker for [PLAN.md](PLAN.md). One row per session; update at session end.
Status: ☐ todo · ◐ in-progress · ☑ done.

| Session | Decision / audit            | Title                                                   | Effort | Depends on    | Status     | Branch                   | Notes                                                                                                                                                                                                                                                               |
| ------- | --------------------------- | ------------------------------------------------------- | ------ | ------------- | ---------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S1**  | 1 / #1                      | Admin override + calendar inline assign/reassign/remove | L      | —             | ☑          | design/ui-implementation | DONE & GREEN — 587 Vitest / 1068 pgTAP / 23 e2e / build clean. Same-house only; cross-house + float-committed seats deferred (see sessions/S1/NOTES.md)                                                                                                             |
| **S2**  | 2 / #2                      | Force-trigger float (wire existing EF)                  | M      | —             | ◐          | design/ui-implementation | Web wiring DONE & GREEN (597 Vitest / e2e 27✓ 2-skip / build). NOT functional e2e: the force-trigger EF (+ all core-importing EFs) fail to boot in local Deno (.js→.ts dynamic import) — pre-existing systemic infra bug; HIGH follow-up (see sessions/S2/NOTES.md) |
| **S3**  | 3 / #3                      | Allied resolved-state + unresolved-only inbox           | M      | S2 (files)    | ☐          | —                        | new `resolved_at` column + RPC                                                                                                                                                                                                                                      |
| **S4**  | 4 / #4                      | `fire_worker` orchestrating RPC                         | L      | —             | ☐          | —                        | tests very thorough (user ask)                                                                                                                                                                                                                                      |
| **S5**  | 5 / #5                      | Hire worker (auth provisioning + roster)                | M      | S1; S4 (file) | ☐          | —                        | auth.admin createUser + provision_user                                                                                                                                                                                                                              |
| **S6**  | 6+ / #8,#9,#18a             | HMOD context: multi-house + Friday-anchor               | M–L    | S1,S2,S3      | ☐          | —                        | fix rotor anchor first                                                                                                                                                                                                                                              |
| **S7**  | 6+ / #10,#11                | Config completeness                                     | M      | —             | ☐          | —                        | touches orchestrator offsets                                                                                                                                                                                                                                        |
| **S8**  | 6+ / #7                     | Builder resize-by-drag + Phase-2 search                 | M      | —             | ☐          | —                        | preserve testid drag contract                                                                                                                                                                                                                                       |
| **S9**  | 6+ / #6,#12,#13,#14,#16,#17 | Polish & hygiene batch                                  | S×6    | —             | ☐          | —                        | #6 set-deadline = cheapest win                                                                                                                                                                                                                                      |
| —       | 6+ / #15                    | Health integration cards                                | —      | —             | ⊘ deferred | —                        | no backend until integrations exist                                                                                                                                                                                                                                 |
| —       | 6+ / #9 (closed)            | Closed-house "Closed" state                             | —      | —             | ⊘ deferred | —                        | needs `houses.is_open` column                                                                                                                                                                                                                                       |

## Recommended order

1. **S9 #6 (set-deadline)** or **S2 (force-trigger)** first — fastest value, self-contained.
2. **S1** next — foundational; unblocks S5 and post-publish edits.
3. **S4** — isolate; thorough tests.
4. Then S3 (after S2), S5 (after S1), S6 (after S1/S2/S3), and S7/S8 anytime.

## Per-session checklist (copy into each session)

- [ ] Lead: read cited BSpec/ARCH §; write `sessions/S<n>/TEST_PLAN.md` behavior contract.
- [ ] Test Author: tests red; list test names.
- [ ] Implementer (firewalled — no test files): code to the contract.
- [ ] Lead: run suite; relay failure _paraphrases_ (not assertions); loop to green.
- [ ] Lead: invariant re-check (Harnwell / float / no-takeback / blocks / TZ).
- [ ] `supabase gen types` if migration changed.
- [ ] Repo gate: type-check + lint + build + test (+ pgTAP, + e2e if touched).
- [ ] Update this table; write `sessions/S<n>/NOTES.md`.
