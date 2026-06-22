#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Manual-testing launcher for the worker mobile apps.
#
# The worker apps run LIVE against local Supabase (iOS: Config.xcconfig ->
# 127.0.0.1; Android: local.properties -> 10.0.2.2). The @upenn.edu test
# accounts live ONLY in supabase/seeds/manual-test.sql, which is a layer
# applied AFTER `supabase db reset`. A plain reset reverts to the default
# seed.sql (@pennhousing.test users) and the @upenn.edu logins fail.
#
# This script GUARANTEES the manual-test seed is present, then builds and
# launches the app — so every manual run uses the manual-testing config.
#
# Usage:  ./run-manual-test.sh ios       # default
#         ./run-manual-test.sh android
#
# Default test login (chosen profile): alice-dubois@upenn.edu  /  abc123
# ---------------------------------------------------------------------------
set -euo pipefail

# GUI launchers (Android Studio / IntelliJ) hand scripts a stripped PATH that
# omits Homebrew and nvm. Restore the dev tools this script needs (supabase,
# psql, xcodegen via Homebrew; pnpm/node via nvm) so it works from the Run menu.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
for _nb in "$HOME"/.nvm/versions/node/*/bin; do [ -d "$_nb" ] && PATH="$_nb:$PATH"; done
[ -d "$HOME/Library/Android/sdk/platform-tools" ] && PATH="$HOME/Library/Android/sdk/platform-tools:$PATH"
export PATH

PLATFORM="${1:-ios}"
SIM_DEVICE="${SIM_DEVICE:-iPhone 17 Pro}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB="postgresql://postgres:postgres@127.0.0.1:54322/postgres"

echo "==> Repo root: $ROOT"

# 1. Make sure local Supabase is up.
if ! supabase status >/dev/null 2>&1; then
  echo "==> Starting local Supabase…"
  (cd "$ROOT" && supabase start)
fi

# 2. Ensure the manual-test (@upenn.edu) seed is applied.
count="$(psql "$DB" -tAc "select count(*) from auth.users where email like '%@upenn.edu';" 2>/dev/null || echo 0)"
count="${count//[[:space:]]/}"
if [ "${count:-0}" -lt 1 ]; then
  echo "==> @upenn.edu users missing -> full reset + manual-test seed (pnpm db:reset:manual)…"
  (cd "$ROOT" && pnpm db:reset:manual)
else
  echo "==> Re-applying manual-test seed (idempotent; $count @upenn.edu users present)…"
  psql "$DB" -v ON_ERROR_STOP=1 -f "$ROOT/supabase/seeds/manual-test.sql" >/dev/null
fi
echo "==> Manual-test config ready. Login: alice-dubois@upenn.edu / abc123"

# 3. Build + launch the chosen platform.
case "$PLATFORM" in
  ios)
    cd "$ROOT/apps/mobile/iosApp"
    [ -d iosApp.xcodeproj ] || xcodegen generate
    echo "==> Booting simulator '$SIM_DEVICE'…"
    xcrun simctl boot "$SIM_DEVICE" 2>/dev/null || true
    open -a Simulator
    echo "==> Building iOS app…"
    xcodebuild -project iosApp.xcodeproj -scheme iosApp -configuration Debug \
      -sdk iphonesimulator -destination "platform=iOS Simulator,name=$SIM_DEVICE" \
      -derivedDataPath build/dd build >/tmp/ios-manual-build.log 2>&1 \
      || { echo "BUILD FAILED — see /tmp/ios-manual-build.log"; tail -30 /tmp/ios-manual-build.log; exit 1; }
    APP="$(find build/dd/Build/Products -maxdepth 2 -name "*.app" | head -1)"
    echo "==> Installing $APP"
    xcrun simctl install booted "$APP"
    xcrun simctl launch booted com.pennhousing.shift
    echo "==> iOS app launched. Sign in as alice-dubois@upenn.edu / abc123"
    ;;
  android)
    cd "$ROOT/apps/mobile"
    echo "==> Installing Android debug build (reads local.properties for live config)…"
    ./gradlew :androidApp:installDebug
    adb shell monkey -p com.pennhousing.shift -c android.intent.category.LAUNCHER 1 >/dev/null
    echo "==> Android app launched. Sign in as alice-dubois@upenn.edu / abc123"
    ;;
  *)
    echo "Unknown platform '$PLATFORM' (use: ios | android)"; exit 1 ;;
esac
