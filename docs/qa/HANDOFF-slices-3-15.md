# Handoff: run ship-check slices 3 to 15

Paste the block below into a fresh coding session at the repo root. Run one batch per session,
because 3 slice agents already consume most of a context window.

## Can batches run in parallel?

Partly. Context is not the constraint, since separate sessions have separate context windows.
**The single shared local Postgres is** (`supabase/config.toml` pins API 54321 / DB 54322, one
instance). Slice agents do not only read it: the first pass built a two-session race fixture
with `pg_sleep` interleaving to test seat allocation, and restored the rows it mutated. Two
batches mutating `shift_block_assignments` at once produce garbage that _looks like a finding_,
because a seat changing underneath you is exactly what a double-booking bug looks like. A
restore written against assumed-exclusive state can also revert another agent's fixture.

| Batch                                    | Shared-state writes                                                                       | Parallel-safe |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- | ------------- |
| A (drop, swaps, floats, breaks)          | Heavy: `shift_block_assignments`, `float_assignments`, seat races                         | No            |
| C (admin, transfers, seasons)            | Destructive: `apply_compiled_season` cancels assignments, `transfer_worker` vacates seats | No            |
| Slice 15 (orchestrator/cron, in D)       | Global: a tick mutates escalation state across all houses                                 | No            |
| B (My Shifts, preferences, builder)      | Mostly `preferences` / `draft_block_assignments`; publish touches shifts                  | Partly        |
| Slices 13, 14 (onboarding, Assistant/KB) | Own tables, largely read-only                                                             | Yes           |

**Recommended**: run B in parallel with slices 13 and 14; serialize A, C, and 15. Roughly three
sequential sessions instead of four, without inventing a class of phantom P0s.

True four-way parallelism needs isolation, not coordination: a git worktree per session plus a
distinct port block in each `supabase/config.toml` and its own `supabase start`. That is four
full Docker stacks. Worth it only if wall-clock beats the setup cost and the RAM.

`docs/qa/COVERAGE.md` is the one file every session writes. Have each session write only its own
report and update `COVERAGE.md` at the end, or accept last-writer-wins knowingly.

---

Run the `ship-check` QA pass on the journey slices listed under BATCH below.

Repo: `/Users/DaChelimo/Documents/TechWork/Shift@PennHousing`

## How to run it

Invoke the `/ship-check` skill. It scopes the slice, spawns the `ship-check` persona
(`.claude/agents/ship-check.md`) once per slice in parallel, merges and dedupes findings, and
writes one report per slice to `docs/qa/qa-<slice>-<YYYY-MM-DD>.md`.

Read `.claude/skills/ship-check/SKILL.md` first. Do not improvise a different procedure.

**Precondition**: the local stack must be up, because grants are authoritative in the running
catalog and not in the migrations.

```bash
supabase status >/dev/null 2>&1 || supabase start
```

Run the slice agents in the background. Each needs its own context and takes roughly 20 minutes.

## BATCH

Pick one:

- **Batch A (highest product risk)**: slices 3+4 as ONE agent (drop, permanent drop, and swaps:
  they share the recurring-assignment write path and will otherwise file the same ticket twice),
  slice 5 (floats: lookup, ack, no-ack void, force trigger, no-takeback), slice 6 (breaks:
  calendar picker, FCFS, leftovers into the open feed).
- **Batch B**: slice 7 (My Shifts and the personal calendar), slice 8 (preferences, including
  admin-on-behalf and the deadline override), slice 9 (schedule builder, AI scheduling, publish).
- **Batch C**: slice 10 (admin: people, hire/fire, house transfers, hours cap, operating
  seasons), slice 11 (house grid, contact card, cross-house view), slice 12 (notifications and
  push delivery).
- **Batch D**: slice 13 (onboarding: the six tours, notification priming, the widget prompt),
  slice 14 (Desk Assistant and the knowledge base), slice 15 (orchestrator, cron, and the paths
  no journey walks through).

`docs/qa/COVERAGE.md` is the register. Mark each slice `passed <date>` with its report link and
its P0/P1 counts when done.

## Slice by journey, never by platform

Each slice follows ONE path end to end: mobile UI and its ViewModel, the web equivalent, the
Edge Function, the RPC, the RLS policy, and the notification it emits.

This is not a style preference. It is what the first pass proved: the worst finding (the web
portal claims 30 minutes of a multi-hour card and toasts that it claimed the whole shift) lives
exactly at a seam, where web passes one `assignment_id` and mobile passes `blockIds`. A pass
ordered by platform cannot see that, because neither side contradicts itself locally.

At every hop, ask the seam question: **what does this layer assume the previous one guaranteed,
and is that assumption written down anywhere or just believed?**

## Calibration from the first pass (slices 1 and 2, 2026-07-26)

Read `docs/qa/qa-auth-launch-gate-2026-07-26.md` and
`docs/qa/qa-open-shifts-claim-2026-07-26.md` before you start. They set the bar: 7 P0 and 5 P1,
every ticket grounded at `file:line` with a concrete trigger sequence.

**Do not re-file these. They are open, known, and already ticketed.** They surface on nearly
every journey, so when you hit one, cite the existing ticket in one line and move on:

- `worker_open_shifts` is `anon`-readable in the live catalog. `claim_open_shift`,
  `fire_worker`, `hire_worker`, and `user_has_house_admin_role` are `anon`-EXECUTE-able and
  trust caller-supplied ids. This is one class of hole, not N findings.
- The open-shifts feed is silently truncated at PostgREST's 1000-row cap.
- Firing a manager sets only `is_active`; no authorization helper reads it.

**A P0 was retracted in the first pass. Do not repeat the mistake.** `lock_block_coverage` was
reported as `anon`-executable on the strength of an `HTTP 204` that only `service_role` can
produce; the shell variable did not hold the anon key. A probe proves a capability exists, it
does not prove _who holds it_. Establish the identity inside the same command that exercises
the hole, and assert the negative control too. See `feedback_probe_identity` in memory and
rule 2 of the persona.

**Read `docs/qa/ACCEPTED-RISKS.md` and do not re-raise what is registered there.** Push delivery
is intentionally at-least-once. Force-trigger deliberately bypasses the coverage floor.
Re-reporting a known tradeoff is how a recurring check gets classified as noise.

## Verify the premises you are handed, including these

Two `AGENTS.md` notes were found stale during the first pass. Assume there are more:

- The claim that `permanent_pickup_slot` "still lacks a per-block limit" is **stale**. Fixed by
  `20260724000005`, live body confirmed.
- The doc comment at `apps/mobile/.../Shifts.kt:336` asserting the open-shift read is
  date-unbounded is **false**, and is the seam assumption behind the 1000-row truncation.

When a note in `AGENTS.md` or a spec disagrees with the code, that is a reportable finding, not
a reason to trust the note.

## Bar for the output

A findings list with no P0 or P1 and a pile of P3s is a **failed pass**, not a clean one. It
means the surface was inspected and the seams were not. Walk concurrency, time, and
authorization, which is where P0s live.

Severity is measured in user harm: P0 is someone loses paid hours, gets locked out, is told
something false about their schedule, or an `AGENTS.md` Hard Invariant breaks.

Every finding needs a `file:line` and a trigger sequence. **A finding you cannot ground gets
dropped, not softened.** Close every report with the mandatory **Verified clean** and **Not
checked** sections.

No em dashes or en dashes anywhere in the reports.

## Do not

- Do not fix anything. The persona is report-only by construction. Findings become their own
  commits, decided by the user.
- Do not run the full security methodology; that is the `security-audit` skill. File a hole if
  it sits on your journey and move on.
- Do not review code quality; that is `architecture-review`.
