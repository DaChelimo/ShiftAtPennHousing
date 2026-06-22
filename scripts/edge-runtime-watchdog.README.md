# Edge Runtime watchdog (local dev)

Keeps the local Supabase **Edge Runtime** (functions) container alive.

## Why

The Supabase CLI creates every local container with `--restart unless-stopped`
**except** the edge-runtime container, which it creates with `--restart no`. When
that container crashes (observed `Exited (255)` mid-session) Docker does **not**
revive it — it stays dead until restarted by hand.

This is a silent failure: REST reads go through Kong and keep working (the worker
app still shows live data), but every worker **write** (drop / claim / swap /
preferences) goes through an Edge Function and gets **503**. Because the mobile app
is best-effort + optimistic, a failed write looks just like a success until you
notice the change never reached the DB or the web live calendar.

> The app-layer fix (surfacing EF write failures + reverting the optimistic card)
> lives in `apps/mobile`. This watchdog fixes the _infra_ half so the runtime never
> silently stays down on a dev machine.

## What `edge-runtime-watchdog.sh` does (idempotent)

1. Re-applies `--restart unless-stopped` to the edge-runtime container (the CLI
   resets it to `no` on every `supabase start`). Once applied, Docker self-heals a
   crash even between watchdog ticks.
2. If the container is not running, or `/functions/v1/` returns 503 / is
   unreachable, it `docker start`s the container.

Health semantics (Kong → edge runtime): **UP** → 404/401/200; **DOWN** → 503 or 000.

## One-off / manual

```bash
scripts/edge-runtime-watchdog.sh        # single check
watch -n 30 scripts/edge-runtime-watchdog.sh
```

## Install as a launchd agent (runs every 60s while logged in)

```bash
REPO_PATH="/Users/DaChelimo/Documents/TechWork/Shift@PennHousing"   # your absolute checkout
mkdir -p ~/Library/LaunchAgents
sed "s#REPO_PATH#${REPO_PATH}#g" \
  "$REPO_PATH/scripts/com.pennhousing.shift.edge-watchdog.plist" \
  > ~/Library/LaunchAgents/com.pennhousing.shift.edge-watchdog.plist
launchctl unload ~/Library/LaunchAgents/com.pennhousing.shift.edge-watchdog.plist 2>/dev/null || true
launchctl load   ~/Library/LaunchAgents/com.pennhousing.shift.edge-watchdog.plist
```

- Tail the log: `tail -f scripts/edge-watchdog.log`
- Uninstall: `launchctl unload ~/Library/LaunchAgents/com.pennhousing.shift.edge-watchdog.plist`

> The plist sets `PATH` to `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin` so it
> finds `docker` (Apple-silicon vs Intel Homebrew). Docker Desktop must be running;
> launchd agents only run while you are logged in (sufficient for local dev).
