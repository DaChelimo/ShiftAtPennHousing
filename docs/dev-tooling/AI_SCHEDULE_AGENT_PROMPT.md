# Build prompt — AI scheduling agent for a single house

This is a self-contained build-spec prompt for the (separate, future) preference-respecting
AI scheduling agent. It is NOT the deterministic "Auto-build balanced schedule" dev tool
(see PLAN.md Feature B) — that one ignores preferences and just balances coverage. This
agent's whole point is to respect preferences as a thoughtful SM would.

Hand the block below to a coding agent (or use it as the feature's design brief):

```
BUILD SPEC — AI scheduling agent for a single house (Shift@PennHousing)

GOAL
Build an AI-driven feature that ingests every worker's submitted shift preferences for
one house + one scheduling period and produces a "favorable" published-ready schedule:
one that respects preferences as well as a thoughtful SM would, while satisfying every
hard operational constraint. The output is a set of draft_block_assignments for the
house's template week, ready for publish_schedule.

WHY AGENTIC, NOT ONE-SHOT
A previous attempt failed by asking ChatGPT to emit a whole schedule in one shot. That
fails because (a) the constraint space is large and interacting (headcount per block,
per-worker weekly cap, Harnwell training rule, contiguity, coverage floor), (b) an LLM
cannot reliably hold a 7-day x ~34-block-per-day x N-worker grid in its head and stay
feasible, and (c) there is no feedback when it violates a constraint. The fix is an
agentic loop: the LLM PROPOSES assignments in small, reviewable units; a deterministic
VALIDATOR (pure TypeScript, reusing existing constraint code) checks feasibility and
returns precise violations; the LLM REPAIRS; a SCORER ranks candidate schedules on a
preference-satisfaction + balance objective; the loop iterates until feasible and the
score plateaus. The LLM does the judgment ("who would most want this block, given the
whole week"); the code guarantees correctness.

INPUTS (snapshot once, pure data — mirror how the pure float algorithm is snapshotted)
- House id + scheduling period (period_id, start_date/end_date).
- The house's template-week blocks: for each block { block_id, block_start_at,
  ny_weekday (0=Mon..6=Sun), minute_of_day, required_headcount }. Blocks are already
  materialized by generate_blocks_for_date / apply_compiled_season; required_headcount
  is authoritative per block (summer bands vary intraday, e.g. Harnwell single AM /
  double PM). Source: shift_blocks (voided_at IS NULL).
- Roster: every active worker with home_house_id = this house (plus role), from users +
  user_roles. Harnwell may ONLY be staffed by home_house = harnwell workers.
- Preferences: preferences rows for the period { user_id, block_id, status } where
  status in preferred | available | cannot | none. Missing row = available.
- Targets: period_targets { user_id, target_hours, opted_out }. opted_out => 0 hours.
- Weekly hours cap (default 20h; respect weekly_cap_overrides if present).

HARD CONSTRAINTS (the validator MUST enforce; never trust the LLM to self-police)
1. Per block, occupied seats <= required_headcount (mirror enforce_block_occupied_headcount
   / enforce_draft_block_headcount).
2. Harnwell training invariant: no worker with home_house != harnwell on a harnwell block,
   under any path (AGENTS hard invariant #1).
3. No worker double-booked in the same block; a worker's shift blocks are contiguous runs.
4. Per-worker weekly scheduled hours <= cap.
5. status = cannot is a HARD no for that worker+block (unlike a real coverage-first
   auto-build, the AI agent treats preferences as first-class).
6. Block atomicity: 30-min blocks on 30-min boundaries only (AGENTS invariant #5).
7. Every required seat that CAN be legally filled by some available/preferred worker
   should be filled (coverage). Genuinely unfillable seats are left vacant, surfaced,
   never fabricated.

SOFT OBJECTIVES (the scorer; higher is better)
- Preference satisfaction: reward assigning "preferred" blocks; mild reward for
  "available"; treat "cannot" as infeasible (hard).
- Target-hours fit: each worker's assigned hours close to their target_hours (penalize
  both under and over).
- Shift-length quality: reward 2-5h contiguous shifts; penalize 1h (2-block) shifts and
  penalize excessively long single shifts; reward variety across the week.
- Fairness/balance: spread desirable (preferred) blocks and total hours across the roster
  rather than loading a few workers.
- Contiguity: penalize fragmented days (many short disjoint shifts for one worker).

AGENT LOOP (implement as a bounded, deterministic-harness agentic loop)
1. PLAN: partition the week into work units (e.g. per NY-day, or per coverage lane) so
   each LLM turn reasons over a bounded slice with full week context provided as summary.
2. PROPOSE: LLM emits assignments for the current unit as structured data (block_id ->
   user_id runs), plus a one-line rationale. Force structured tool output; no prose grid.
3. VALIDATE: pure validator returns { feasible, violations[] } with precise,
   machine-readable reasons (e.g. HARNWELL_TRAINING, OVER_HEADCOUNT, CAP_EXCEEDED,
   CANNOT_CONFLICT, DOUBLE_BOOK, ONE_HOUR_SHIFT). No DB writes during the loop.
4. REPAIR: feed violations back; LLM revises only the conflicting assignments.
5. SCORE: when a full-week candidate is feasible, compute the objective. Keep the best.
   Optionally run N independent candidate schedules (different seeds/orders) and keep the
   top-scoring — a judge-panel / best-of-N pattern beats one-attempt-iterated here.
6. STOP when feasible AND score improvement < epsilon for K iterations, or budget hit.
7. MATERIALIZE: write the winning candidate to draft_block_assignments (respecting the
   (period_id, block_id, user_id) unique key + headcount trigger + Harnwell trigger),
   leave publish_schedule as a separate explicit human step.

REUSE (do not reinvent)
- Snapshot-then-pure pattern: copy how the float lookup algorithm is a pure function fed a
  snapshot (packages/core/src/float-lookup) and the orchestrator writes results.
- Block/time helpers: blockWeekSlot() and the NY-tz seams in packages/core/src/preferences.
- Constraint mirrors: enforce_block_occupied_headcount, Harnwell training trigger,
  weekly cap logic. Put the validator in packages/core so it is unit-testable with zero
  Supabase imports, exactly like the existing pure cores.
- Write path: draft_block_assignments then publish_schedule(period, publisher, house)
  (recurring-weekly-pattern version). The agent NEVER writes shift_block_assignments
  directly.

DELIVERABLES
- packages/core/src/ai-schedule/ : types, pure validator, pure scorer, loop harness
  (LLM calls injected as an interface so the core stays testable/deterministic).
- An Edge Function / server action that snapshots inputs, runs the loop (LLM via
  Anthropic API), and writes drafts. Admin/schedule-admin gated.
- A web surface to trigger it per house, preview the proposed schedule + its score +
  any unfilled seats, and accept (write drafts) or discard.
- Tests: validator + scorer unit tests (feasibility edge cases, Harnwell, caps,
  1h-shift penalty), and a golden end-to-end on a seeded house.

NON-GOALS
- Not the deterministic "coverage-first auto-build" dev tool (that is a separate feature
  that ignores preferences and just balances shift lengths). This AI agent is
  preference-respecting and is the real product surface to iterate on.
- Do not auto-publish. Human reviews and publishes.

Build the pure core + validator + scorer first with tests, then the loop harness with a
mockable LLM interface, then wire the real Anthropic call and the web trigger last.
```
