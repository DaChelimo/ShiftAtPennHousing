#!/usr/bin/env node
// PreToolUse(Bash) auto-sync for the Mac's LAN IP into mobile build config.
//
// Emulator/simulator builds never need this: apps/mobile/iosApp/Configuration/
// Config.xcconfig's SUPABASE_HOST defaults to 127.0.0.1 and
// apps/mobile/local.properties' SUPABASE_URL defaults to 10.0.2.2, both permanent
// host aliases that work regardless of network. Only a REAL PHYSICAL DEVICE needs
// the Mac's actual LAN IP, and that IP changes whenever the Mac switches networks
// (observed twice in one day during Harnwell pilot testing) — this hook detects a
// build/install command that targets a real device, checks the Mac's current LAN
// IP against what's stored in the relevant config file, and rewrites the file if
// they differ. Runs before the tool call, so the build that follows in the same
// command already reads the corrected value; no second run needed.
//
// Scope is intentionally narrow (rule: fire on the delta, and only when a real
// device is actually in play) so ordinary simulator/emulator builds are silently
// unaffected:
//   iOS real device:  xcodebuild ... -destination 'platform=iOS,...'  (no "Simulator"),
//                      or any `devicectl` invocation.
//   Android real device: `adb -s <serial>` where <serial> does not start with
//                      "emulator-" (that prefix is how the Android tooling names
//                      emulator instances; a real device's serial never has it).
//
// Never blocks. It only performs the file rewrite (if needed) and reports it.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const IOS_CONFIG = path.join(ROOT, 'apps/mobile/iosApp/Configuration/Config.xcconfig');
const ANDROID_LOCAL_PROPS = path.join(ROOT, 'apps/mobile/local.properties');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function currentLanIp() {
  for (const iface of ['en0', 'en1']) {
    try {
      const ip = execSync(`ipconfig getifaddr ${iface}`, { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
      if (ip) return ip;
    } catch {
      // interface down or absent — try the next one
    }
  }
  return null;
}

function syncIosConfig(lanIp) {
  if (!fs.existsSync(IOS_CONFIG)) return null;
  const text = fs.readFileSync(IOS_CONFIG, 'utf8');
  const re = /(SUPABASE_HOST\s*=\s*)([\d.]+)(:54321)/;
  const match = text.match(re);
  if (!match || match[2] === lanIp) return null;
  const updated = text.replace(re, `$1${lanIp}$3`);
  fs.writeFileSync(IOS_CONFIG, updated);
  return { file: 'apps/mobile/iosApp/Configuration/Config.xcconfig', from: match[2], to: lanIp };
}

function syncAndroidConfig(lanIp) {
  if (!fs.existsSync(ANDROID_LOCAL_PROPS)) return null;
  const text = fs.readFileSync(ANDROID_LOCAL_PROPS, 'utf8');
  const re = /(SUPABASE_URL\s*=\s*http:\/\/)([\d.]+)(:54321)/;
  const match = text.match(re);
  if (!match || match[2] === lanIp) return null;
  const updated = text.replace(re, `$1${lanIp}$3`);
  fs.writeFileSync(ANDROID_LOCAL_PROPS, updated);
  return { file: 'apps/mobile/local.properties', from: match[2], to: lanIp };
}

function main() {
  let payload;
  try {
    payload = JSON.parse(readStdin() || '{}');
  } catch {
    process.exit(0);
  }

  const command = payload?.tool_input?.command;
  if (typeof command !== 'string') process.exit(0);

  const targetsIosDevice =
    /xcodebuild/.test(command) && (/platform=iOS\s*,/.test(command) || /devicectl/.test(command));
  const targetsAndroidDevice = /\badb\b[^\n]*-s\s+(?!emulator-)\S+/.test(command);

  if (!targetsIosDevice && !targetsAndroidDevice) process.exit(0);

  const lanIp = currentLanIp();
  if (!lanIp) process.exit(0);

  const changes = [];
  if (targetsIosDevice) {
    const change = syncIosConfig(lanIp);
    if (change) changes.push(change);
  }
  if (targetsAndroidDevice) {
    const change = syncAndroidConfig(lanIp);
    if (change) changes.push(change);
  }

  if (changes.length === 0) process.exit(0);

  const summary = changes.map((c) => `${c.file}: SUPABASE host IP ${c.from} -> ${c.to}`).join('; ');

  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: `Real-device build detected; Mac's LAN IP changed since the config was last set. Synced before the build ran: ${summary}.`,
      },
    }),
  );
}

main();
