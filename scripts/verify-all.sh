#!/usr/bin/env bash
#
# scripts/verify-all.sh  —  e2e-lifecycle chunk S1, "verification baseline".
#
# One command that answers "is everything green?" and records the REAL state of
# every test layer in PLAN.md §2.1.
#
# Design notes (read before editing):
#   * NOT `set -e` across layers. The S1 exit gate requires EVERY layer's status
#     to be recorded, so a failing layer must not abort the run. The script is
#     fail-AWARE: it runs all layers, records each, and exits non-zero iff any
#     graded layer failed.
#   * DB layers reset+seed the LOCAL stack (it must be running — `supabase status`).
#     `supabase db reset` is run before pgTAP (so all migrations, including any
#     not-yet-applied ones, are present) and again before Playwright (so the web
#     E2E sees the documented baseline: published_at NULL, empty drafts — see
#     apps/web/e2e/README.md). Resets touch only the LOCAL db; never a remote URL.
#   * Mobile layers (6–8) need the Android/iOS toolchain (+ emulator for Maestro)
#     and are SKIPPED unless RUN_MOBILE=1. Maestro (booted emulator + installed
#     app) is never auto-run.
#
# Usage:
#   bash scripts/verify-all.sh               # graded layers 1–5 (+ mobile = skipped)
#   RUN_MOBILE=1 bash scripts/verify-all.sh  # also run mobile shared-unit + Android build
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LOGDIR="$(mktemp -d "${TMPDIR:-/tmp}/verify-all-XXXXXX")"
SUMMARY=()
OVERALL=0

c_head=$'\033[1;36m'; c_pass=$'\033[1;32m'; c_fail=$'\033[1;33m'; c_skip=$'\033[1;90m'; c_off=$'\033[0m'

note() { printf '\n%s== %s ==%s\n' "$c_head" "$*" "$c_off"; }

# run_layer "<label>" "<shell command>"  — graded layer; failure sets OVERALL=1.
run_layer() {
  local label="$1" cmd="$2"
  note "LAYER: ${label}"
  local log start end dur rc
  log="${LOGDIR}/$(printf '%s' "$label" | tr -c 'A-Za-z0-9' '_').log"
  start=$(date +%s)
  bash -c "$cmd" 2>&1 | tee "$log"
  rc=${PIPESTATUS[0]}
  end=$(date +%s); dur=$((end - start))
  if [ "$rc" -eq 0 ]; then
    SUMMARY+=("$(printf '%sPASS%s  %-42s %4ss' "$c_pass" "$c_off" "$label" "$dur")")
  else
    SUMMARY+=("$(printf '%sFAIL%s  %-42s %4ss  rc=%s' "$c_fail" "$c_off" "$label" "$dur" "$rc")")
    SUMMARY+=("        └─ log: ${log}")
    OVERALL=1
  fi
}

# run_prep "<label>" "<shell command>"  — infrastructure step (db reset). Recorded
# but not graded; a failure is surfaced and will cascade into the dependent layer.
run_prep() {
  local label="$1" cmd="$2"
  note "PREP: ${label}"
  local log rc
  log="${LOGDIR}/prep_$(printf '%s' "$label" | tr -c 'A-Za-z0-9' '_').log"
  bash -c "$cmd" 2>&1 | tee "$log"
  rc=${PIPESTATUS[0]}
  if [ "$rc" -eq 0 ]; then
    SUMMARY+=("$(printf '%s prep%s %-42s   ok' "$c_skip" "$c_off" "[$label]")")
  else
    SUMMARY+=("$(printf '%s prep%s %-42s   rc=%s  log=%s' "$c_fail" "$c_off" "[$label]" "$rc" "$log")")
  fi
}

skip_layer() {
  local label="$1" why="$2"
  note "SKIP: ${label}"
  printf '%s(skipped: %s)%s\n' "$c_skip" "$why" "$c_off"
  SUMMARY+=("$(printf '%sSKIP%s  %-42s        %s' "$c_skip" "$c_off" "$label" "$why")")
}

note "verify-all  ·  root=${ROOT}  ·  logs=${LOGDIR}"
note "preflight: supabase stack must be running"
if ! supabase status >/dev/null 2>&1; then
  printf '%sFATAL%s supabase stack is not running (run `supabase start`).\n' "$c_fail" "$c_off"
  exit 2
fi

# ── Non-DB layers (fast, no stack needed) ────────────────────────────────────
run_layer "1. Static (lint + type-check)"      "TURBO_UI=false pnpm turbo run lint type-check"
run_layer "2. TS logic (Vitest @shift/core)"   "pnpm --filter @shift/core test"
run_layer "3. Web build (next build)"          "pnpm --filter @shift/web build"

# ── DB layers ────────────────────────────────────────────────────────────────
run_prep  "db reset → migrate+seed (pre-pgTAP)" "supabase db reset"
run_layer "4. DB logic (pgTAP)"                "supabase test db"
run_prep  "db reset → seeded baseline (pre-E2E)" "supabase db reset"
run_layer "5. Web E2E (Playwright)"            "pnpm --filter @shift/web e2e"

# ── Mobile layers (optional) ─────────────────────────────────────────────────
if [ "${RUN_MOBILE:-0}" = "1" ]; then
  run_layer "6. Mobile shared unit (JVM host)" "cd apps/mobile && ./gradlew --no-daemon :shared:testAndroidHostTest"
  run_layer "7. Mobile Android build"          "cd apps/mobile && ./gradlew --no-daemon :androidApp:assembleDebug"
else
  skip_layer "6. Mobile shared unit (JVM host)" "RUN_MOBILE!=1 (needs Android/JVM toolchain)"
  skip_layer "7. Mobile Android build"          "RUN_MOBILE!=1 (needs Android toolchain)"
fi
skip_layer "8. Mobile iOS link / Maestro E2E"  "manual only (needs Xcode / booted emulator + app)"

# ── Summary ──────────────────────────────────────────────────────────────────
printf '\n%s######## VERIFY-ALL SUMMARY ########%s\n' "$c_head" "$c_off"
for line in "${SUMMARY[@]}"; do printf '%s\n' "$line"; done
if [ "$OVERALL" -eq 0 ]; then
  printf '%sOVERALL: PASS%s (all graded layers green)\n' "$c_pass" "$c_off"
else
  printf '%sOVERALL: FAIL%s (≥1 graded layer red — triage above)\n' "$c_fail" "$c_off"
fi
printf 'logs: %s\n' "$LOGDIR"
printf '%s####################################%s\n' "$c_head" "$c_off"
exit "$OVERALL"
