# Prompt Library — Shift@PennHousing

This folder contains copy-paste prompts for each implementation phase.
It is listed in `.claudeignore` and must never be read by any coding agent.

## How to use

1. Open the phase folder you're working on.
2. Copy the content of the relevant `.md` file.
3. Paste it directly into the interface specified at the top of the file.
4. Do NOT let any agent read sibling files in this folder during a session.

## Session order per phase

| File                   | Role                              | When                              |
| ---------------------- | --------------------------------- | --------------------------------- |
| `01-test-session.md`   | Claude Code writes tests          | Before any implementation         |
| `02-implementation.md` | Codex (or Claude Code) implements | After tests are committed         |
| `03-spec-audit.md`     | Claude Code audits diff           | After implementation passes tests |

Phases 0 and 1 have no test session (data-only work).

## Cross-model firewall rules

- The test session agent commits before the implementation session opens.
- The implementation agent reads test FILE NAMES only — never test bodies.
- The implementation agent may not modify any file under `tests/` or `*.test.*` or `*.test.sql`.
- If a test seems wrong, re-open the test session to fix it — do not patch in the impl session.

## Phase index

| Phase | Branch                      | Description                                                     |
| ----- | --------------------------- | --------------------------------------------------------------- |
| 00    | `phase-00-foundation`       | Monorepo, Supabase, KMP (Android + iOS), Next.js, CI, AGENTS.md |
| 01    | `phase-01-config`           | 10 config tables + houses seed + RLS placeholders               |
| 02    | `phase-02-users-roles`      | users, user_roles, broadcast guard, role promotion hook         |
| 03    | `phase-03-blocks-calendar`  | shift_blocks/assignments, calendar generation, time helpers     |
| 04    | `phase-04-schedule-builder` | preferences, draft schedule, publish operation                  |
| 05    | `phase-05-feed-claim`       | Open shifts feeds, claiming, cross-house pickup, hours cap      |
| 06    | `phase-06-float-algorithm`  | Pure TS float lookup algorithm — the critical phase             |
| 07    | `phase-07-orchestrator`     | pg_cron, escalation chain, no-ack trigger                       |
| 08    | `phase-08-force-trigger`    | Force-trigger endpoint + rollback semantics                     |
| 09    | `phase-09-swaps`            | Shift, float, and permanent swap workflows                      |
| 10    | `phase-10-permanent-ops`    | Permanent drop and permanent pickup                             |
| 11    | `phase-11-break-claim`      | Claim-based scheduling for winter break and short breaks        |
| 12    | `phase-12-notifications`    | Notification delivery, push (FCM + APNs), ack cadence           |
| 13a   | `phase-13a-worker-mobile`   | Compose Multiplatform — Android + iOS worker app                |
| 13b   | `phase-13b-admin-web`       | Next.js — SM/HM schedule builder + admin tools                  |
| 14    | `phase-14-admin-extras`     | system_config UI, cap admin, observability                      |
