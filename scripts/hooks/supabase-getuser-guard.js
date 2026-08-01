#!/usr/bin/env node
// PostToolUse(Write|Edit) advisory: `supabase.auth.getUser()` in apps/web server code
// is an HTTP round trip to GoTrue on every call -- measured 101-150ms against this
// project's hosted Supabase (perf audit, 2026-07-29), and it used to run TWICE per
// navigation (once in proxy.ts, once in getSessionUser()) because nothing deduped
// across that boundary.
//
// `supabase.auth.getClaims()` verifies the session JWT's signature locally instead
// (this project signs ES256, so it is a local crypto check against a JWKS fetched
// once per process): measured 3-6ms after the first call. It still refreshes an
// expired session first (calls getSession() internally) and falls back to getUser()
// itself when local verification is not possible, so it is not a weaker check, just a
// cheaper one when the token can be verified locally, which it always can here.
//
// ADVISORY, NOT BLOCKING: unlike the anon-grant regression, there IS a legitimate use
// for getUser() -- when a code path needs a field that only a fresh GoTrue lookup can
// answer (email-just-confirmed, phone-just-verified) rather than what is embedded in
// the JWT's claims. A hook cannot tell which case it is looking at.
//
// Scoped to apps/web server code: a 'use client' file calling this from the browser is
// a different cost model (one client-side network call, not a hop that stacks with
// other server-side round trips inside the same request) and is out of scope here.

const fs = require('fs');
const path = require('path');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  let payload;
  try {
    payload = JSON.parse(readStdin() || '{}');
  } catch {
    process.exit(0);
  }

  const input = payload.tool_input || {};
  const filePath = input.file_path || '';
  if (!filePath) process.exit(0);
  if (!/apps[\\/]web[\\/].*\.tsx?$/.test(filePath)) process.exit(0);

  const candidate =
    payload.tool_name === 'Write'
      ? input.content || ''
      : payload.tool_name === 'Edit'
        ? input.new_string || ''
        : '';
  if (!candidate) process.exit(0);

  if (/agents-allow-getuser/i.test(candidate)) process.exit(0);
  if (!/\.auth\.getUser\s*\(/.test(candidate)) process.exit(0);

  // Best-effort client-side exclusion: check the whole current file content (Edit's
  // new_string is only the changed fragment and would miss a directive higher up).
  const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  let fullText = candidate;
  try {
    fullText = fs.readFileSync(abs, 'utf8');
  } catch {
    /* file may not exist yet on a fresh Write; candidate is the best we have */
  }
  if (/^\s*['"]use client['"]/.test(fullText)) process.exit(0);

  const rel = path.relative(process.cwd(), abs) || filePath;
  const message =
    `${rel} calls supabase.auth.getUser(), which is an HTTP round trip to GoTrue on ` +
    `every call (101-150ms measured against this project's hosted Supabase). Prefer ` +
    `supabase.auth.getClaims() -- this project's tokens are ES256, so it verifies ` +
    `locally (3-6ms) instead, still refreshes an expired session first, and falls ` +
    `back to getUser() itself when local verification is not possible. See ` +
    `getSessionUser() in lib/auth.ts and proxy.ts for the pattern. If this call site ` +
    `genuinely needs a field only a fresh GoTrue lookup can answer (not something in ` +
    `the JWT claims), put "agents-allow-getuser" in a comment on the line and say why.`;

  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: message,
      },
    }),
  );
}

main();
