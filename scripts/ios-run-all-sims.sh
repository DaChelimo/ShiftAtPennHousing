#!/usr/bin/env bash
#
# scripts/ios-run-all-sims.sh  —  build the iOS worker app ONCE, install + launch
# the SAME build on the iPhone 17 Pro and iPhone 17 Pro Max simulators.
#
# Why this exists: running separate Xcode "Run"s per simulator (or building at
# different times) leaves simulators on different binaries. If a simulator's
# app process is still running when its bundle gets replaced by a later build,
# it can become an ORPHANED process — code loaded in memory that no longer
# matches any bundle on disk (`xcrun simctl listapps` shows a Bundle path that
# no longer exists). That looks exactly like a real behavioral bug (e.g. a
# feature working on one simulator/appearance but not another) and is easy to
# chase for an hour before realizing it's just a stale build.
#
# A single arm64 simulator build's .app is installable on ANY booted simulator
# on this (Apple Silicon) Mac, so we build once and fan the same .app out to
# both — no per-simulator rebuild, and no divergence possible.
#
# ONLY touches the two named simulators below — never boots or affects any
# other simulator, so it's safe to run right after a laptop restart (both
# cold: nothing booted yet) or mid-session (both warm: just reinstalls fresh).
#
# Usage:
#   scripts/ios-run-all-sims.sh          # boot-if-needed, build once, install+launch both
#   DEMO=1 scripts/ios-run-all-sims.sh   # build the DemoData (login-bypass) variant
#
# DEMO=1 temporarily blanks Configuration/Config.xcconfig's SUPABASE_URL for the
# build (per iosApp/README.md: "Empty by default -> the app runs on DemoData with
# no backend"), then restores your working tree's SUPABASE_URL exactly as it was
# (trap on EXIT — restores even on failure/Ctrl-C).

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_DIR="$ROOT/apps/mobile/iosApp"
CONFIG="$IOS_DIR/Configuration/Config.xcconfig"
BUNDLE_ID="com.pennhousing.shift"
APP_NAME="Shift PennHousing"
DERIVED_DATA="$ROOT/apps/mobile/iosApp/build/ios-run-all-sims"

# The only two simulators this script ever touches.
SIM_NAMES=("iPhone 17 Pro" "iPhone 17 Pro Max")

c_head=$'\033[1;36m'; c_pass=$'\033[1;32m'; c_fail=$'\033[1;31m'; c_off=$'\033[0m'

# ── Resolve UDIDs by name (prefer an already-booted match) ─────────────────
resolve_udid() {
  local want="$1"
  /usr/bin/python3 - "$want" <<'PY'
import json, subprocess, sys
want = sys.argv[1]
data = json.loads(subprocess.check_output(["xcrun", "simctl", "list", "devices", "-j"]))
matches = [d for devs in data["devices"].values() for d in devs
           if d.get("name") == want and d.get("isAvailable", True)]
if not matches:
    sys.exit(1)
booted = [d for d in matches if d.get("state") == "Booted"]
pick = booted[0] if booted else matches[0]
print(pick["udid"])
PY
}

TARGETS=()
for name in "${SIM_NAMES[@]}"; do
  udid="$(resolve_udid "$name")" || {
    printf '%sNo simulator named "%s" found.%s\n' "$c_fail" "$name" "$c_off"
    exit 1
  }
  TARGETS+=("$udid")
done

printf '%sTargets:%s\n' "$c_head" "$c_off"
for i in "${!SIM_NAMES[@]}"; do
  printf '  - %s (%s)\n' "${SIM_NAMES[$i]}" "${TARGETS[$i]}"
done

# ── Boot only these two, only if needed (never touches other simulators) ───
NEED_OPEN=0
for udid in "${TARGETS[@]}"; do
  state="$(xcrun simctl list devices -j | /usr/bin/python3 -c "
import json, sys
d = json.load(sys.stdin)
udid = '$udid'
for v in d['devices'].values():
    for x in v:
        if x.get('udid') == udid:
            print(x.get('state', 'Unknown'))
            sys.exit(0)
print('Unknown')
")"
  if [ "$state" != "Booted" ]; then
    printf '%sBooting%s %s...\n' "$c_head" "$c_off" "$udid"
    xcrun simctl boot "$udid"
    NEED_OPEN=1
  fi
done
if [ "$NEED_OPEN" = "1" ]; then
  open -a Simulator
  for udid in "${TARGETS[@]}"; do
    xcrun simctl bootstatus "$udid" -b >/dev/null 2>&1 || true
  done
fi

# ── Optionally blank SUPABASE_URL for a DemoData build (restored on exit) ──
RESTORE_CONFIG=0
if [ "${DEMO:-0}" = "1" ]; then
  cp "$CONFIG" "$CONFIG.bak"
  RESTORE_CONFIG=1
  # Only the SUPABASE_URL line changes; SUPABASE_ANON_KEY etc. are untouched.
  /usr/bin/sed -i '' -E 's/^SUPABASE_URL = .*/SUPABASE_URL =/' "$CONFIG"
  printf '%sDEMO=1%s: building with SUPABASE_URL blanked (DemoData build)\n' "$c_head" "$c_off"
fi
cleanup() {
  if [ "$RESTORE_CONFIG" = "1" ]; then
    mv "$CONFIG.bak" "$CONFIG"
    printf '%sRestored%s Config.xcconfig to its prior state.\n' "$c_head" "$c_off"
  fi
}
trap cleanup EXIT

# ── Build once ───────────────────────────────────────────────────────────────
BUILD_DEST="${TARGETS[0]}"
printf '%sBuilding once%s (destination udid=%s, derivedData=%s)...\n' "$c_head" "$c_off" "$BUILD_DEST" "$DERIVED_DATA"

cd "$IOS_DIR"
if ! xcodebuild -project iosApp.xcodeproj -scheme iosApp -configuration Debug \
    -destination "platform=iOS Simulator,id=$BUILD_DEST" \
    -derivedDataPath "$DERIVED_DATA" build \
    2>&1 | tee "$DERIVED_DATA.log" | tail -40; then
  printf '%sBUILD FAILED%s — see %s\n' "$c_fail" "$c_off" "$DERIVED_DATA.log"
  exit 1
fi

APP_PATH="$DERIVED_DATA/Build/Products/Debug-iphonesimulator/$APP_NAME.app"
if [ ! -d "$APP_PATH" ]; then
  printf '%sBuild succeeded but app bundle not found at%s %s\n' "$c_fail" "$c_off" "$APP_PATH"
  exit 1
fi
printf '%sBuild succeeded:%s %s\n' "$c_pass" "$c_off" "$APP_PATH"

# ── Install + launch the SAME build on both ─────────────────────────────────
FAIL=0
for i in "${!TARGETS[@]}"; do
  udid="${TARGETS[$i]}"
  printf '\n%s-- %s (%s) --%s\n' "$c_head" "${SIM_NAMES[$i]}" "$udid" "$c_off"
  xcrun simctl terminate "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  xcrun simctl uninstall "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  if xcrun simctl install "$udid" "$APP_PATH" && xcrun simctl launch "$udid" "$BUNDLE_ID" >/dev/null; then
    printf '%sinstalled + launched%s\n' "$c_pass" "$c_off"
  else
    printf '%sinstall/launch FAILED%s on %s\n' "$c_fail" "$c_off" "$udid"
    FAIL=1
  fi
done

if [ "$FAIL" -eq 0 ]; then
  printf '\n%sBoth simulators are running the same fresh build.%s\n' "$c_pass" "$c_off"
else
  printf '\n%sOne or more targets failed — see above.%s\n' "$c_fail" "$c_off"
fi
exit "$FAIL"
