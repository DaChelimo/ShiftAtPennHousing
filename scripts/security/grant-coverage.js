#!/usr/bin/env node
// Audit the pgTAP grant assertions in supabase/tests for the weakness that hid the
// REVOKE-FROM-PUBLIC root cause for months.
//
// `has_function_privilege('public', fn, 'EXECUTE') = false` PASSES while anon and
// authenticated still hold EXECUTE, because Supabase grants those two roles explicitly at
// CREATE time via ALTER DEFAULT PRIVILEGES. So a test suite can be fully green while every
// "service_role only" function is callable by any signed-in user.
//
// The gate is PER TARGET FUNCTION, not per file. A per-file gate passes a mixed file that
// asserts anon/authenticated for function X while function Y in the same file is only ever
// checked against 'public', leaving Y uncovered while the file looks covered.
//
// Usage: node scripts/security/grant-coverage.js <repo-root>
'use strict';
const fs = require('fs');
const path = require('path');

const root = process.argv[2] || process.cwd();
const dir = path.join(root, 'supabase', 'tests');

// Target arg is either a single-quoted signature (which MAY contain commas, e.g.
// 'hire_worker(uuid, text, text)') or a bare expression such as p.oid. Matching the target
// as [^,]+ silently drops every multi-arg signature, which is the bug this replaced.
const RX = /has_function_privilege\(\s*'([a-z_]+)'\s*,\s*('(?:[^']|'')*'|[^,)]+?)\s*,\s*'EXECUTE'/g;

const targets = new Map();
const files = fs.existsSync(dir)
  ? fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
  : [];

for (const file of files) {
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  // Precompute line starts so a match offset becomes a line number.
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (idx) => {
    let lo = 0,
      hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= idx) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  for (const m of text.matchAll(RX)) {
    const role = m[1];
    const raw = m[2].trim();
    // 'name(args)', 'schema.name(args)', or 'name' -> attribute to the bare function name.
    // The schema qualifier is optional and must be tolerated: this suite writes
    // 'public.permanent_drop_slot(uuid,...)', which a name-only pattern misreads.
    // Anything else is a catalog-loop target we cannot resolve statically.
    const lit = raw.match(/^'\s*(?:[a-z0-9_]+\s*\.\s*)?([a-z0-9_]+)\s*(?:\(|')/i);
    const key = lit ? lit[1] : `<dynamic: ${file}>`;
    if (!targets.has(key)) targets.set(key, { roles: new Set(), sites: [] });
    const t = targets.get(key);
    t.roles.add(role);
    t.sites.push(`${file}:${lineOf(m.index)}`);
  }
}

const weak = [];
const strong = [];
for (const [key, t] of [...targets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  (t.roles.has('anon') || t.roles.has('authenticated') ? strong : weak).push([key, t]);
}

for (const [key, t] of weak) {
  console.log(`WEAK  ${key}`);
  console.log(`      roles asserted: ${[...t.roles].sort().join(', ')}`);
  console.log(`      at: ${t.sites.slice(0, 4).join(' ')}`);
}
if (!weak.length) console.log('(no target asserted only against public/service_role)');

console.log('');
console.log(`test files scanned: ${files.length}`);
console.log(`targets with real coverage (anon or authenticated named): ${strong.length}`);
if (strong.length) console.log(`  ${strong.map(([k]) => k).join(', ')}`);
console.log(`targets asserted ONLY against public/service_role: ${weak.length}`);
