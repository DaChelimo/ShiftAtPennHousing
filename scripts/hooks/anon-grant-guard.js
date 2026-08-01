#!/usr/bin/env node
// PreToolUse(Write|Edit) guard: do not re-grant to `anon` an object that an earlier
// migration deliberately revoked from `anon`.
//
// WHY THIS IS A HOOK AND NOT A PARAGRAPH
//
// This exact regression has now happened three times:
//   * 20260605000001 created the worker read-model views with the boilerplate
//     `GRANT SELECT ... TO anon, authenticated, service_role`.
//   * 20260711000001 deliberately revoked anon from them, and its own header records
//     that the grant had ALREADY been re-applied verbatim by 20260617000004 and
//     20260627000001.
//   * 20260724000004:196 and 20260726000001:324 re-applied it again. As of the
//     2026-07-26 ship-check pass, `worker_open_shifts` is readable by `anon` in the
//     live catalog, and two independent QA slices found it from different directions.
//
// Nobody was careless. The cause is structural: `CREATE OR REPLACE VIEW` cannot carry
// its own grants forward, so every migration that touches a view copies a GRANT block
// from the previous migration, and the copied block predates the revoke. A prose rule
// cannot survive a copied template, because the copy is the part nobody re-reads.
// (.claude/skills/ship-check/references/lessons.md, "recurrence, not pain")
//
// THE PROTECTED SET IS DERIVED, NOT HARDCODED
//
// Any object that some migration explicitly REVOKEs from `anon` is protected from then
// on. That means the guard extends itself: revoke a new view from anon and it is
// defended automatically, with no edit here. It also means the guard cannot drift out
// of sync with the migrations, which is the failure mode of a hardcoded list.
//
// HARD GATE (deny), matching em-dash-guard rather than the psql/ship-check "ask"
// guards: the fix is mechanical (drop `anon` from the TO list) and the rule has no
// legitimate exception that is not a deliberate policy reversal. For that reversal,
// put `agents-allow-anon-grant` on the line, same escape-hatch pattern as
// `agents-allow-dash`.

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join('supabase', 'migrations');

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

// `a, public.b, "c"` -> ['a','b','c']
function parseObjectList(raw) {
  return raw
    .split(',')
    .map((s) =>
      s
        .trim()
        .replace(/^public\./i, '')
        .replace(/"/g, '')
        .toLowerCase(),
    )
    .filter((s) => /^[a-z0-9_]+$/.test(s));
}

function roleListHasAnon(raw) {
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .includes('anon');
}

// GRANT <privs> ON [TABLE] <objects> TO <roles>;
const GRANT_RE =
  /\bGRANT\s+[\s\S]*?\s+ON\s+(?:TABLE\s+|ALL\s+TABLES\s+IN\s+SCHEMA\s+)?([\w".,\s]+?)\s+TO\s+([\w,\s"]+?)\s*;/gi;

// REVOKE <privs> ON [TABLE] <objects> FROM <roles>;
const REVOKE_RE =
  /\bREVOKE\s+[\s\S]*?\s+ON\s+(?:TABLE\s+|ALL\s+TABLES\s+IN\s+SCHEMA\s+)?([\w".,\s]+?)\s+FROM\s+([\w,\s"]+?)\s*;/gi;

function anonGrantsIn(sql) {
  const out = [];
  const clean = stripSqlComments(sql);
  let m;
  GRANT_RE.lastIndex = 0;
  while ((m = GRANT_RE.exec(clean)) !== null) {
    if (!roleListHasAnon(m[2])) continue;
    for (const obj of parseObjectList(m[1])) out.push(obj);
  }
  return out;
}

// Every object any migration has explicitly revoked from anon.
function buildProtectedSet(cwd) {
  const dir = path.join(cwd, MIGRATIONS_DIR);
  const protectedSet = new Map(); // object -> migration filename that revoked it
  let files;
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
  } catch {
    return protectedSet;
  }
  for (const f of files) {
    let sql;
    try {
      sql = stripSqlComments(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch {
      continue;
    }
    if (!/\bREVOKE\b/i.test(sql)) continue;
    let m;
    REVOKE_RE.lastIndex = 0;
    while ((m = REVOKE_RE.exec(sql)) !== null) {
      if (!roleListHasAnon(m[2])) continue;
      for (const obj of parseObjectList(m[1])) {
        if (!protectedSet.has(obj)) protectedSet.set(obj, f);
      }
    }
  }
  return protectedSet;
}

function main() {
  let payload;
  try {
    payload = JSON.parse(readStdin() || '{}');
  } catch {
    process.exit(0);
  }

  const tool = payload.tool_name || '';
  const input = payload.tool_input || {};
  const filePath = input.file_path || '';

  if (!filePath) process.exit(0);
  if (!/supabase[\\/]migrations[\\/].*\.sql$/i.test(filePath)) process.exit(0);

  let candidate = '';
  if (tool === 'Write') candidate = input.content || '';
  else if (tool === 'Edit') candidate = input.new_string || '';
  else process.exit(0);

  if (/agents-allow-anon-grant/i.test(candidate)) process.exit(0);

  // Cheap early exit: no anon grant, nothing to do.
  const granted = anonGrantsIn(candidate);
  if (granted.length === 0) process.exit(0);

  const protectedSet = buildProtectedSet(process.cwd());
  const violations = granted
    .filter((o) => protectedSet.has(o))
    .map((o) => ({ object: o, revokedBy: protectedSet.get(o) }));

  if (violations.length === 0) process.exit(0);

  const detail = violations
    .map((v) => `  - ${v.object}  (revoked from anon by ${v.revokedBy})`)
    .join('\n');

  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          `Blocked: this migration grants to "anon" an object a previous migration ` +
          `deliberately revoked from "anon".\n\n${detail}\n\n` +
          `This exact regression has shipped three times, because CREATE OR REPLACE VIEW ` +
          `does not carry grants forward and the GRANT block gets copied from a migration ` +
          `that predates the revoke. The 2026-07-26 ship-check pass found worker_open_shifts ` +
          `readable by anon in the live catalog as a result.\n\n` +
          `Fix: drop "anon" from the TO list, keeping authenticated and service_role. RLS ` +
          `does not save you here, because an owner-rights view runs as its owner.\n\n` +
          `If you are deliberately REVERSING the revoke as a policy decision, put ` +
          `"agents-allow-anon-grant" in a comment on that line and say so in the migration ` +
          `header.`,
      },
    }),
  );
}

main();
