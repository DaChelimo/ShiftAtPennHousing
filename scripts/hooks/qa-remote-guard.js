#!/usr/bin/env node
// PreToolUse(Bash) guard: while QA mode is on, the remote Supabase project is off limits.
//
// This is the half of QA mode that makes "strictly must use the local database" a
// guarantee rather than a convention. Pointing the environment at local only redirects
// tools that READ the environment; it does nothing about an agent that types a remote
// connection string, a project ref, or a *.supabase.co URL directly. The first
// ship-check pass produced a retracted P0 precisely because an agent believed it was
// talking to one identity while talking to another, so "the agent will use the right
// target" is not a safety property.
//
// TWO RULES, WITH DIFFERENT SCOPES
//
//  1. While `.qa-mode` exists: DENY any Bash command naming the remote project ref or
//     a *.supabase.co host. This is the QA containment rule.
//
//  2. ALWAYS, regardless of QA mode: DENY `supabase db reset|push` combined with
//     `--linked` or a remote --db-url. `supabase db reset --linked` wipes the remote
//     database. No workflow in this repo needs it, and the repo already carries a
//     standing rule against unauthorised resets.
//
// The remote ref is read from supabase/.temp/project-ref rather than hardcoded, so
// relinking to a different project keeps the guard correct with no edit here.
//
// Hard `deny`, matching em-dash-guard and anon-grant-guard: a false positive costs one
// retry and the reason text says exactly what to do, while a false negative is the
// data-crossover incident this whole mechanism exists to prevent.

const fs = require('fs');
const path = require('path');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function deny(reason) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

function main() {
  let input;
  try {
    input = JSON.parse(readStdin());
  } catch {
    process.exit(0);
  }

  const command = input?.tool_input?.command;
  if (typeof command !== 'string' || command.length === 0) process.exit(0);

  const cwd = process.cwd();

  // Rule 2: always on. A remote-targeted destructive supabase command.
  const isDestructiveSupabase = /\bsupabase\s+db\s+(reset|push)\b/i.test(command);
  const targetsRemote = /--linked\b/.test(command) || /--db-url\s+\S*supabase\.co/i.test(command);
  if (isDestructiveSupabase && targetsRemote) {
    deny(
      'Blocked: this runs a destructive `supabase db` command against the REMOTE project.\n\n' +
        '`supabase db reset --linked` drops and rebuilds the remote database, and `db push` ' +
        'mutates its schema. Neither is part of any workflow in this repo, and the staging ' +
        'project is the fixture your physical device depends on.\n\n' +
        'If you meant the local stack, drop `--linked` (local is the default target). If you ' +
        'genuinely intend to rebuild the remote project, do it yourself from the Supabase ' +
        'dashboard so the confirmation is a human one.',
    );
  }

  // Rule 1: QA containment. Only while the marker exists.
  const marker = path.join(cwd, '.qa-mode');
  if (!fs.existsSync(marker)) process.exit(0);

  let ref = '';
  try {
    ref = fs.readFileSync(path.join(cwd, 'supabase', '.temp', 'project-ref'), 'utf8').trim();
  } catch {
    /* not linked: fall through to the host check alone */
  }

  const hits = [];
  if (ref && command.includes(ref)) hits.push(`the remote project ref (${ref.slice(0, 6)}...)`);
  if (/\b[a-z0-9-]+\.supabase\.(co|in)\b/i.test(command)) hits.push('a *.supabase.co host');
  if (/--linked\b/.test(command)) hits.push('`--linked` (targets the remote project)');

  if (hits.length === 0) process.exit(0);

  deny(
    `Blocked: QA mode is ON, so the remote Supabase project is off limits. This command names ` +
      `${hits.join(' and ')}.\n\n` +
      `QA passes must run strictly against the LOCAL stack (http://127.0.0.1:54321, ` +
      `postgresql://postgres:postgres@127.0.0.1:54322/postgres). The QA agents probe ` +
      `destructively: they build seat-race fixtures, and lock_block_coverage is one-way with ` +
      `no unlock function in any of the 152 migrations. Running that against staging corrupts ` +
      `the dataset your physical device depends on.\n\n` +
      `Use the local connection string instead.\n\n` +
      `The one sanctioned exception is READ-ONLY catalog parity (has_table_privilege, ` +
      `has_function_privilege, pg_policies, pg_proc). If that is what you are doing, ask the ` +
      `user to run it, or turn QA mode off deliberately with "scripts/qa/qa-mode.sh off" and ` +
      `state why.`,
  );
}

main();
