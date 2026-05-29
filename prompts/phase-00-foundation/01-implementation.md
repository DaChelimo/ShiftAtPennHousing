# Phase 00 — Foundation: Implementation

## Session Metadata

|                   |                                                                      |
| ----------------- | -------------------------------------------------------------------- |
| **Model**         | Claude Opus 4.7 (`claude-opus-4-7`)                                  |
| **Interface**     | Claude Code CLI                                                      |
| **Thinking mode** | Standard                                                             |
| **TDD split**     | N/A — no business logic in this phase                                |
| **Note**          | Claude Code does this phase end-to-end. No cross-model split needed. |

---

## Prompt

You are setting up the foundation for Shift@PennHousing.

Branch: `phase-00-foundation` (create off main).

Stack:

- Monorepo: pnpm workspaces + Turborepo
- Backend: Supabase (Postgres 15, Edge Functions in Deno/TypeScript)
- Web frontend: Next.js 15 (App Router) + TypeScript
- Mobile: Compose Multiplatform / Kotlin Multiplatform — targets Android AND iOS (both ship in v1)
- Core logic: pure TypeScript in `packages/core`
- Tests: Vitest (TS), pgTAP (SQL), Playwright (web E2E), Maestro (mobile E2E) — install but do not write tests yet

Sources of truth:

- ARCHITECTURE.md §1 (Core principles)
- BEHAVIORAL_SPECIFICATION.md §1 (Operating domain — for house naming context)
- AGENTS.md (create this file as part of this phase — content below)

---

### Repo structure to create

```
shift-pennhousing/
├── AGENTS.md
├── BEHAVIORAL_SPECIFICATION.md        (already exists — do not touch)
├── ARCHITECTURE.md                    (already exists — do not touch)
├── .claudeignore                      (already exists — do not touch)
├── package.json                       (pnpm workspace root)
├── pnpm-workspace.yaml
├── turbo.json
├── .github/
│   └── workflows/
│       └── ci.yml
├── supabase/
│   ├── config.toml
│   ├── migrations/                    (empty for now)
│   ├── functions/                     (empty for now)
│   ├── tests/                         (empty for now)
│   └── seed.sql                       (empty placeholder)
├── packages/
│   ├── core/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   └── index.ts               (placeholder export)
│   │   └── tests/
│   │       └── smoke.test.ts          (1 passing smoke test)
│   └── shared/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           └── index.ts               (placeholder)
└── apps/
    ├── web/
    │   └── (Next.js scaffold)
    └── mobile/                       (Kotlin Multiplatform — Fruitties pattern)
        ├── shared/                   (shared logic + ViewModels)
        │   ├── src/
        │   │   ├── commonMain/kotlin/
        │   │   ├── androidMain/kotlin/
        │   │   └── iosMain/kotlin/
        │   └── build.gradle.kts
        ├── androidApp/               (Jetpack Compose UI → :shared)
        │   ├── src/main/
        │   └── build.gradle.kts
        ├── iosApp/                   (SwiftUI → Shared framework)
        │   ├── iosApp/
        │   └── Configuration/
        ├── gradle/libs.versions.toml
        └── settings.gradle.kts
```

---

### Deliverables

**1. Initialize pnpm workspace.**
Create `pnpm-workspace.yaml`:

```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

**2. Initialize Supabase.**
Run `supabase init` in the repo root. Verify `supabase start` brings up local Postgres. Commit the generated `supabase/config.toml`.

**3. Initialize Next.js in `apps/web`.**
Use `create-next-app` with TypeScript, App Router, Tailwind CSS, ESLint. Verify `pnpm dev` in `apps/web` starts the dev server.

**4. Kotlin Multiplatform mobile in `apps/mobile` (Fruitties pattern).**
The mobile app follows Google's Fruitties sample — **shared logic, native UI per
platform**, NOT Compose Multiplatform shared UI. Three pieces:

- `:shared` — a KMP library (`com.android.kotlin.multiplatform.library` + the
  Kotlin Multiplatform plugin) with `commonMain` / `androidMain` / `iosMain`,
  three iOS targets (iosX64, iosArm64, iosSimulatorArm64) producing the `Shared`
  framework, and SKIE for Swift interop. Namespace `com.pennhousing.shift.shared`;
  exports `androidx.lifecycle.viewmodel` so the shared ViewModel is visible in Swift.
- `:androidApp` — the Android Jetpack Compose app (`applicationId`
  `com.pennhousing.shift`), depends on `:shared`.
- `iosApp/` — the SwiftUI app; links the `Shared` framework via a
  `./gradlew :shared:embedAndSignAppleFrameworkForXcode` run-script. Bundle id
  `com.pennhousing.shift`. The Xcode project + signing is maintained in Xcode
  (see `apps/mobile/iosApp/README.md`).

Toolchain (mirrors Fruitties): AGP 8.13.1 / Kotlin 2.2.21 / Gradle 9.2.1, defined
in `gradle/libs.versions.toml`.

Verify:

- `./gradlew :androidApp:assembleDebug` succeeds (Android APK)
- `./gradlew :shared:testAndroidHostTest` passes (shared unit tests on the JVM host)
- `./gradlew :shared:linkDebugFrameworkIosSimulatorArm64` succeeds (iOS framework; macOS + Xcode)
- `./gradlew :shared:iosSimulatorArm64Test` passes (shared unit tests on Kotlin/Native)

Note: the `android` CLI is for emulator/device operations only; it does not
scaffold KMP projects.

**5. Create `packages/core`.**
TypeScript package with Vitest. Add one placeholder export and one passing smoke test (`expect(1 + 1).toBe(2)`).

**6. Create `packages/shared`.**
TypeScript package, empty for now. Will hold `database.types.ts` (generated from Supabase) and `domain.types.ts` (hand-written).

**7. Set up Turborepo.**
`turbo.json` with pipelines: `test`, `build`, `lint`, `type-check`. Each pipeline defined with correct `dependsOn` and `outputs`.

**8. Linting and formatting.**

- ESLint + Prettier for all TypeScript (shared config at root).
- `ktlint` for Kotlin (via Gradle plugin in `apps/mobile`).
- Husky + lint-staged: pre-commit runs lint + format on staged files.

**9. GitHub Actions CI.**
`.github/workflows/ci.yml` with these jobs:

- `lint-and-typecheck`: runs on `ubuntu-latest`, checks all TS packages
- `test-core`: runs Vitest for `packages/core`
- `test-supabase`: runs pgTAP via `supabase test db` on `ubuntu-latest`
- `build-android`: runs `./gradlew :androidApp:assembleDebug :shared:testAndroidHostTest` on `ubuntu-latest`
- `build-ios`: runs `./gradlew :shared:linkDebugFrameworkIosSimulatorArm64 :shared:iosSimulatorArm64Test` on `macos-latest` (macOS runner required for iOS)
  All jobs run on every PR and push to main.

**10. Create `AGENTS.md` at repo root.**
Use exactly this content:

```markdown
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
```

**11. Set up Supabase MCP and document dev tooling.**
Create `docs/dev-setup.md` with the following required local dependencies and their setup instructions:

**a) Supabase MCP** — gives Claude Code live read/write access to the local Supabase Postgres instance during development sessions (inspect schema, run queries, validate migrations without copy-pasting):

```bash
npm install -g @supabase/mcp-server-supabase
```

Configure in `.claude/settings.json` at repo root (checked in — uses local URL only, never production):

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": [
        "-y",
        "@supabase/mcp-server-supabase@latest",
        "--supabase-url",
        "http://localhost:54321",
        "--service-role-key",
        "<key printed by `supabase start` — never commit the real value here>"
      ]
    }
  }
}
```

Add `.claude/settings.local.json` (gitignored) for the actual service role key:

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": [
        "-y",
        "@supabase/mcp-server-supabase@latest",
        "--supabase-url",
        "http://localhost:54321",
        "--service-role-key",
        "YOUR_LOCAL_SERVICE_ROLE_KEY"
      ]
    }
  }
}
```

**b) Android CLI** — required for emulator management, device runs, and screen capture (used in Maestro E2E flows in Phase 13a). Does NOT scaffold KMP projects — see Step 4.
Install: https://developer.android.com/tools/agents/android-cli
Commands used in this project: `android emulator create`, `android emulator start`, `android emulator stop`, `android run`, `android screen capture`, `android info`.

Add both to `AGENTS.md` under a new `## Required Local Tools` section (see content in Step 10 below — the section is already included there).

**12. `tests/` directory at repo root.**
Create `tests/PHASE_PLAN.md` — paste the 14-phase table from the implementation plan. This is for human reference only.

---

### What you are NOT to do

- Do NOT create any database tables, migrations, or seed data.
- Do NOT scaffold any app routes, screens, or UI components beyond framework defaults.
- Do NOT install ORMs (Prisma, Drizzle, etc.). We use raw SQL migrations + `supabase-js` client + `supabase-kt` for Kotlin.
- Do NOT write any business logic.
- Do NOT touch `BEHAVIORAL_SPECIFICATION.md` or `ARCHITECTURE.md`.
- Do NOT touch `.claudeignore`.

---

### Verification checklist before committing

- [ ] `pnpm install` from repo root succeeds.
- [ ] `pnpm turbo run lint type-check` passes.
- [ ] `pnpm turbo run test` passes (smoke test in packages/core).
- [ ] `supabase start` brings up local Postgres with no errors.
- [ ] `supabase stop` cleanly stops it.
- [ ] `cd apps/web && pnpm dev` starts Next.js dev server.
- [ ] `cd apps/mobile && ./gradlew :androidApp:assembleDebug` builds the Android APK.
- [ ] `cd apps/mobile && ./gradlew :shared:linkDebugFrameworkIosSimulatorArm64` links the iOS `Shared` framework (macOS + Xcode).
- [ ] `cd apps/mobile && ./gradlew :shared:iosSimulatorArm64Test` passes the shared Kotlin/Native unit tests.
- [ ] `AGENTS.md` exists at repo root with the content above.
- [ ] `.claudeignore` is untouched and still lists `prompts/`.
- [ ] `.claude/settings.json` exists and contains the Supabase MCP config (with placeholder key).
- [ ] `.claude/settings.local.json` is listed in `.gitignore` (never committed).
- [ ] `docs/dev-setup.md` exists and documents Supabase MCP and Android CLI setup.

---

### Commit

```
git add .
git commit -m "phase-00: monorepo foundation (pnpm + Turborepo), Supabase init, Next.js, Compose Multiplatform (Android + iOS), CI (Android + macOS runners), AGENTS.md"
```

Then open a PR from `phase-00-foundation` → `main` and run the Claude Code spec-audit (there is no Phase 00 spec-audit file — foundation is structural, not behavioral).
