#!/usr/bin/env bash
#
# scripts/edge-runtime-watchdog.sh  —  keep the local Supabase Edge Runtime alive.
#
# WHY THIS EXISTS
# ---------------
# The Supabase CLI creates EVERY local container with `--restart unless-stopped`
# EXCEPT the edge-runtime (functions) container, which it creates with
# `--restart no`. So when that one container crashes (it has been seen to
# `Exited (255)` mid-session) Docker does not revive it — it stays dead until a
# human restarts it.
#
# That is a SILENT, confusing failure: REST reads go through Kong and keep working
# (the worker app still shows live data), but every worker WRITE — drop, claim,
# swap, preferences — goes through an Edge Function and returns 503. The mobile app
# is best-effort + optimistic, so a failed write looks identical to a success until
# you notice the change never reached the DB / web live calendar.
#
# WHAT IT DOES (idempotent; safe to run on a timer)
#   1. Re-applies `--restart unless-stopped` to the edge-runtime container. The CLI
#      resets this to `no` on every `supabase start`, so we re-apply each run; once
#      applied, Docker self-heals a crash even between watchdog ticks.
#   2. If the container is not running OR the functions gateway is unreachable / 503,
#      it `docker start`s the container.
#
# Health semantics (Kong → edge runtime): UP → 404/401/200 on /functions/v1/*;
# DOWN → 503 (upstream unavailable) or 000 (refused/timeout).
#
# USAGE
#   scripts/edge-runtime-watchdog.sh           # one check (for cron/launchd/manual)
#   watch -n 30 scripts/edge-runtime-watchdog.sh
# Install as a launchd agent that runs every 60s: see scripts/edge-runtime-watchdog.README.md
#
set -euo pipefail

HEALTH_URL="${SUPABASE_FUNCTIONS_URL:-http://127.0.0.1:54321/functions/v1/}"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') edge-watchdog: $*"; }

if ! command -v docker >/dev/null 2>&1; then
  log "docker not on PATH — nothing to do"; exit 0
fi

name="$(docker ps -a --filter 'name=supabase_edge_runtime' --format '{{.Names}}' | head -1)"
if [ -z "$name" ]; then
  log "no supabase_edge_runtime container (supabase not started?) — nothing to do"; exit 0
fi

# (1) Make Docker auto-revive future crashes. Re-applied every run because
# `supabase stop/start` recreates the container with restart=no.
current_policy="$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$name" 2>/dev/null || echo '')"
if [ "$current_policy" != "unless-stopped" ]; then
  docker update --restart unless-stopped "$name" >/dev/null 2>&1 \
    && log "set restart policy unless-stopped on $name (was '${current_policy:-unknown}')"
fi

# (2) Restart if down or unhealthy.
running="$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null || echo false)"
# curl's `-w %{http_code}` already prints 000 on a refused/timed-out request, so
# `|| true` only keeps the exit status from tripping `set -e` (no double "000").
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" 2>/dev/null || true)"

if [ "$running" != "true" ] || [ "$code" = "503" ] || [ "$code" = "000" ]; then
  log "unhealthy (running=$running http=$code) → restarting $name"
  docker start "$name" >/dev/null 2>&1 || log "docker start failed"
  sleep 3
  code2="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" 2>/dev/null || true)"
  log "after restart: http=$code2 ($([ "$code2" = 503 ] || [ "$code2" = 000 ] && echo STILL-DOWN || echo OK))"
else
  log "healthy (http=$code)"
fi
