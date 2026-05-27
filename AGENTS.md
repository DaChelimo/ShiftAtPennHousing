# Shift@PennHousing — Agent Briefing

This file is read by Claude Code and Codex at session start.
It supplements but does not replace BEHAVIORAL_SPECIFICATION.md and ARCHITECTURE.md.

## Source of Truth Hierarchy

1. BEHAVIORAL_SPECIFICATION.md — what the system must do
2. ARCHITECTURE.md — how the schema and code enforce it
3. This file — repo conventions and agent guardrails
4. Test names — behavioral checklist (do not infer behavior from test bodies)

## Hard Invariants (Behavioral §1.2, §1.5; Architecture §1.5)

1. **Harnwell training constraint**: no worker whose home_house != Harnwell may staff the
   Harnwell desk under any mechanism (scheduled, claimed, floated, picked up, force-triggered).
   Enforce in code at every assignment write point — not only in config tables.

2. **Float direction rules**: 11-single-staff-house workers cannot be float sources, ever.
   Quad workers cannot float to Harnwell. Enforce algorithmically; do not trust float_routing
   table alone.

3. **No-takeback rule**: once a float is `pending` or `acknowledged`, automated systems may
   not revoke it. Only manual SM/HM/BM override may.

4. **Hours cap is not checked on float assignment.** Floats relocate already-scheduled hours;
   total weekly hours unchanged. Cap checks apply to claim, swap, pickup — never float.

5. **Block atomicity**: every shift operation works in 30-minute blocks on 30-minute boundaries.
   No sub-block operations exist. Ever.

6. **Time zone**: all timestamps are `timestamptz` in America/New_York. Never use naive
   timestamps. Never do wall-clock arithmetic for DST-crossing intervals — use duration arithmetic.

## Conventions

- Migrations: pure SQL files in `supabase/migrations/YYYYMMDDHHMMSS_description.sql`.
  Reversible where possible. Idempotent re-application.
- Pure business logic: `packages/core/src/`. Edge Functions are thin wrappers around it.
  packages/core has zero Supabase SDK imports.
- RLS: every new table gets RLS policies in the same migration that creates it.
  Service-role bypasses all RLS (for Edge Functions and orchestrator).
- Tests: pgTAP for DB-layer behavior, Vitest for TypeScript logic.
  Never skip a test because a behavior is "unlikely" — the spec is the truth.
- Mobile: Compose Multiplatform targets Android + iOS. Platform-specific code uses
  expect/actual declarations in src/androidMain and src/iosMain.
  Both platforms ship together in every release.
- Mobile scaffolding: always use the JetBrains GitHub template clone for new KMP modules.
  Never use kmp.jetbrains.com or `android create` for KMP — the latter has no KMP template.
- Type generation: after any migration change, run:
  `supabase gen types typescript --local > packages/shared/src/database.types.ts`
- Supabase MCP: configured in `.claude/settings.local.json` (gitignored). When active,
  Claude Code can query the local Postgres directly — use this to validate schema before
  writing migrations. Never point the MCP at the production URL during development.

## Required Local Tools

| Tool           | Purpose                                                        | Install                                                |
| -------------- | -------------------------------------------------------------- | ------------------------------------------------------ |
| `supabase` CLI | Local Postgres, migrations, Edge Functions                     | https://supabase.com/docs/guides/cli                   |
| `android` CLI  | Emulator management, device runs, screen capture (Maestro E2E) | https://developer.android.com/tools/agents/android-cli |
| `pnpm`         | Workspace package manager                                      | `npm install -g pnpm`                                  |
| `node` 20+     | TypeScript toolchain                                           | https://nodejs.org                                     |
| `java` 17+     | Gradle / Android builds                                        | https://adoptium.net                                   |
| `xcode` 15+    | iOS simulator builds (macOS only)                              | Mac App Store                                          |

Note: `android` CLI is for emulator/device operations only. KMP project scaffolding uses
the JetBrains GitHub template (see Conventions above).

## Excluded from Agent Reads

- `prompts/` directory — these are human-operated copy-paste prompts.
  The .claudeignore file enforces this. Never read from prompts/.

## What Agents Commonly Get Wrong Here

(This section grows as the project progresses. Append findings at the end of each phase.)

- [Phase 00] TODO: populate as issues arise.

## Phase-Specific Notes

(Append at end of each phase with critical learnings.)

- [Phase 00] House names: 11 single-staff houses use placeholder names House-3 through
  House-13. Real names are a TODO before launch.
