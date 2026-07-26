#!/usr/bin/env node
// PreToolUse(Bash) guard against unscoped ad-hoc DELETE/UPDATE run via psql.
//
// Mechanical backstop for the incident in AGENTS.md's "Ad-hoc DELETE/UPDATE against
// the DB" convention (memory: feedback_scoped_destructive_sql). A prose rule in
// AGENTS.md relies on the agent remembering to apply it mid-command; this hook does
// not — it inspects every Bash call that touches psql and asks the human to confirm
// before a DELETE/UPDATE not wrapped in an explicit transaction runs.
//
// Deliberately a SOFT gate (permissionDecision "ask", never "deny"): a false
// positive costs one extra confirmation click, not a broken workflow. This is a
// heuristic text scan, not a SQL parser — it does not need to be perfect, only to
// catch the case that actually bit us (a filter that looked scoped but wasn't).
//
// Scope: only fires on commands that mention `psql`. SELECT/INSERT-only SQL, and
// any DELETE/UPDATE already wrapped in BEGIN;...COMMIT;/ROLLBACK;, passes silently.
// npm/pnpm script invocations (`pnpm seed:sandbox`, `supabase db reset`, etc.) never
// contain the literal string `psql` in the Bash command Claude runs, so they are
// unaffected even though the underlying script does call psql.
//
// Also narrowed to REMOTE targets only: a command that resolves to the local
// Supabase Postgres (127.0.0.1/localhost, the project's local port 54322, or no
// host at all — psql's own default is local) passes silently even with an
// unwrapped DELETE/UPDATE. Local data is disposable (`supabase db reset` restores
// it); the incident this guard exists for was a mutation that could have hit a
// real/shared environment, not local dev data.

const fs = require('fs');
const path = require('path');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function stripSqlComments(sql) {
  return sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

// Best-effort extraction of `-f <path>` arguments so we can also scan the
// referenced file's contents (inline -c SQL and heredocs are already part of
// the raw command text and need no extraction).
function extractDashFPaths(command) {
  const paths = [];
  const re = /(?:^|\s)-f\s+("([^"]+)"|'([^']+)'|(\S+))/g;
  let m;
  while ((m = re.exec(command)) !== null) {
    paths.push(m[2] ?? m[3] ?? m[4]);
  }
  return paths;
}

// Local Supabase Postgres is always 127.0.0.1/localhost on the project's
// local port (supabase/config.toml -> db.port, 54322 here), or psql invoked
// with no host/connection-string at all (psql's own default is local). A
// connection string or -h/-d flag pointing anywhere else is treated as remote.
const LOCAL_PORT = '54322';

function isLocalTarget(command) {
  const hasConnString = /postgres(?:ql)?:\/\/[^\s"']+/i.test(command);
  if (hasConnString) {
    return new RegExp(
      `postgres(?:ql)?://[^\\s"']*@?(127\\.0\\.0\\.1|localhost)(?::${LOCAL_PORT})?/`,
      'i',
    ).test(command);
  }

  const hasRemoteHostFlag = /(^|\s)(-h|--host(?:=|\s))\s*(?!(127\.0\.0\.1|localhost)\b)\S+/i.test(
    command,
  );
  if (hasRemoteHostFlag) return false;

  const hasHostEnvVar = /\bPGHOST=(?!['"]?(127\.0\.0\.1|localhost)\b)\S+/i.test(command);
  if (hasHostEnvVar) return false;

  // No connection string, no -h/--host, no PGHOST override: psql defaults to
  // the local Unix socket / localhost.
  return true;
}

function main() {
  let input;
  try {
    input = JSON.parse(readStdin());
  } catch {
    process.exit(0); // malformed input — never block on our own parse failure
  }

  const command = input?.tool_input?.command;
  if (typeof command !== 'string' || !/psql/i.test(command)) {
    process.exit(0);
  }

  if (isLocalTarget(command)) process.exit(0);

  let scanText = command;
  for (const p of extractDashFPaths(command)) {
    try {
      const abs = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
      scanText += '\n' + fs.readFileSync(abs, 'utf8');
    } catch {
      // Unreadable/relative-to-unknown-cwd file: fall back to scanning the
      // command text alone rather than failing the hook.
    }
  }

  const scan = stripSqlComments(scanText);

  // A standalone DELETE/UPDATE statement — word boundaries so this matches
  // whether the keyword sits after whitespace, a semicolon, or a shell/SQL quote
  // character (`-c "DELETE FROM ...` has DELETE immediately after `"`, which is
  // not whitespace but IS a \b transition).
  const hasMutation = /\b(DELETE\s+FROM|UPDATE)\s+\S/i.test(scan);
  if (!hasMutation) process.exit(0);

  // Real transaction wrapping is a standalone `BEGIN;` ... `COMMIT;`/`ROLLBACK;`
  // pair. Deliberately NOT satisfied by a PL/pgSQL `DO $$ BEGIN ... END $$;`
  // block: that BEGIN is a procedural-block opener, immediately followed by more
  // statement body (not `;`), so it never matches `BEGIN\s*;`.
  const hasBegin = /\bBEGIN\s*;/i.test(scan);
  const hasCommitOrRollback = /\b(COMMIT|ROLLBACK)\s*;/i.test(scan);
  if (hasBegin && hasCommitOrRollback) process.exit(0);

  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason:
          'This psql command runs a DELETE or UPDATE that is not wrapped in an explicit ' +
          'BEGIN;...COMMIT; transaction. AGENTS.md (Conventions) requires verifying the WHERE ' +
          "clause is scoped against the table's real schema before running ad-hoc mutations " +
          '— tables often lack a direct scope column (e.g. draft_block_assignments has no ' +
          'house_id, only block_id via a join to shift_blocks) and a filter that looks scoped ' +
          'can silently hit far more rows than intended. Confirm the scope is correct (ideally ' +
          'verified via a SELECT count(*) first) before proceeding.',
      },
    }),
  );
}

main();
