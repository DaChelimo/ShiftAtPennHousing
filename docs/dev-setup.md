# Dev Setup Guide

## Prerequisites

| Tool           | Min Version | Purpose                                       | Install               |
| -------------- | ----------- | --------------------------------------------- | --------------------- |
| `node`         | 20+         | TypeScript toolchain                          | https://nodejs.org    |
| `pnpm`         | 9+          | Workspace package manager                     | `npm install -g pnpm` |
| `java`         | 17+         | Gradle / Android builds                       | https://adoptium.net  |
| `xcode`        | 15+         | iOS simulator builds (macOS only)             | Mac App Store         |
| `supabase` CLI | latest      | Local Postgres, migrations, Edge Functions    | See below             |
| `android` CLI  | latest      | Emulator management, device runs, Maestro E2E | See below             |

---

## 1. Supabase CLI

### Install

```bash
brew install supabase/tap/supabase
```

Or on Linux:

```bash
curl -s https://raw.githubusercontent.com/supabase/supabase/master/scripts/install.sh | bash
```

### Start the local stack

```bash
supabase start
```

On first run this pulls Docker images (~500 MB). Once running you'll see output like:

```
API URL: http://localhost:54321
DB URL: postgresql://postgres:postgres@localhost:54322/postgres
Studio URL: http://localhost:54323
...
service_role key: eyJ...
```

### Stop

```bash
supabase stop
```

### Migrations

```bash
# Create a new migration
supabase migration new <description>

# Apply pending migrations
supabase db push

# Run pgTAP tests
supabase test db

# Regenerate TypeScript types after schema changes
supabase gen types typescript --local > packages/shared/src/database.types.ts
```

---

## 2. Supabase MCP Server

The Supabase MCP server gives Claude Code live read/write access to your local Postgres
instance during development sessions — inspect schema, run queries, and validate migrations
without copy-pasting SQL.

### Install

```bash
npm install -g @supabase/mcp-server-supabase
```

### Configure

`.claude/settings.json` (checked in — uses placeholder key):

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
        "<key printed by `supabase start`>"
      ]
    }
  }
}
```

`.claude/settings.local.json` (gitignored — put the real key here):

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

Copy the `service_role key` from `supabase start` output and paste it into
`.claude/settings.local.json`. This file is gitignored — never commit the real key.

**Important:** never point the MCP at the production Supabase URL during development.

---

## 3. Android CLI

The `android` CLI is used for emulator management, device runs, and screen capture
(required for Maestro E2E flows in Phase 13a). It does **not** scaffold KMP projects —
use the JetBrains GitHub template for that (see `AGENTS.md`).

### Install

Follow the official guide: https://developer.android.com/tools/agents/android-cli

Requires Android Studio or the standalone command-line tools installed and `ANDROID_HOME`
set in your shell profile.

### Commands used in this project

| Command                   | Purpose                            |
| ------------------------- | ---------------------------------- |
| `android emulator create` | Create a new AVD                   |
| `android emulator start`  | Start an emulator                  |
| `android emulator stop`   | Stop a running emulator            |
| `android run`             | Run the app on a device/emulator   |
| `android screen capture`  | Capture a screenshot (Maestro E2E) |
| `android info`            | Show device/emulator info          |

---

## 4. Repo setup

```bash
# Clone
git clone <repo-url> shift-pennhousing
cd shift-pennhousing

# Install TS/JS dependencies
pnpm install

# Start the dev server (web)
pnpm --filter @shift/web dev

# Run all tests
pnpm turbo run test

# Build Android APK
cd apps/mobile && ./gradlew :androidApp:assembleDebug

# iOS simulator (macOS only)
cd apps/mobile && ./gradlew :shared:iosSimulatorArm64Test
```
