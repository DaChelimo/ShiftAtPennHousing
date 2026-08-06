#!/usr/bin/env node
// Vendor the built @shift/core modules that Edge Functions import into
// supabase/functions/_shared/core/.
//
// WHY THIS EXISTS (production-deploy landmine).
//
// Five Edge Functions run pure logic from @shift/core. They used to reach it with a
// DYNAMIC import of a path outside the functions tree:
//
//     await import('../../../packages/core/dist/orchestrator/evaluate.js')
//
// That works under `supabase start`, because the local edge runtime bind-mounts the
// literal specifiers it discovers. It does NOT survive `supabase functions deploy`: the
// deploy bundler follows STATIC relative imports only, and `packages/core/dist` is both
// outside the function directory and gitignored. So the deploy succeeded, the bundle
// shipped without core, and every invocation died at runtime with
//
//     Module not found: file:///var/tmp/sb-compile-edge-runtime/packages/core/dist/...
//
// Verified against the deployed orchestrator-tick on 2026-08-05: its bundle contained
// only index.ts and floatLookup.ts. The orchestrator scanned 0 blocks and fired 0 steps
// for as long as it had been deployed, so the whole escalation chain was inert.
//
// The fix is to put core INSIDE the functions tree and import it statically, which makes
// the deployed bundle a function of the repo alone. The vendored output is COMMITTED for
// exactly that reason: a gitignored build artifact is what caused the outage, so making
// this one gitignored too would rebuild the same trap.
//
// Usage:
//   node scripts/vendor-core-into-functions.mjs            # write the vendored tree
//   node scripts/vendor-core-into-functions.mjs --check    # verify it is up to date (CI)
//
// Run `pnpm --filter @shift/core build` first; this script reads packages/core/dist.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = join(repoRoot, 'packages', 'core', 'dist');
const functionsRoot = join(repoRoot, 'supabase', 'functions');
const vendorRoot = join(functionsRoot, '_shared', 'core');
const vendorSpecifier = '../_shared/core/';

const checkOnly = process.argv.includes('--check');

// Matches both `from '...'` and `import('...')`.
const IMPORT_RE = /(?:from|import)\s*[(\s]\s*['"]([^'"]+)['"]/g;

function fail(message) {
  console.error(`vendor-core: ${message}`);
  process.exit(1);
}

function walk(dir, predicate) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) return walk(abs, predicate);
    return predicate(abs) ? [abs] : [];
  });
}

// ---------------------------------------------------------------------------
// 1. Discover the entrypoints from the Edge Function sources themselves.
// ---------------------------------------------------------------------------
// Deriving them beats a hardcoded list: adding a core import to a function
// automatically vendors it, so the list cannot silently fall out of date.
function discoverEntrypoints() {
  const sources = walk(functionsRoot, (path) => path.endsWith('.ts')).filter(
    (path) => !path.startsWith(vendorRoot + sep),
  );

  const entrypoints = new Set();
  for (const source of sources) {
    for (const [, specifier] of readFileSync(source, 'utf8').matchAll(IMPORT_RE)) {
      const marker = specifier.indexOf(vendorSpecifier);
      if (marker === -1) continue;
      entrypoints.add(specifier.slice(marker + vendorSpecifier.length));
    }
  }
  return [...entrypoints].sort();
}

// ---------------------------------------------------------------------------
// 1b. Every core alias a file USES must be imported IN THAT FILE.
// ---------------------------------------------------------------------------
// Caught a real regression on 2026-08-05: floatLookup.ts kept its `coreFindFloaters(...)`
// call but lost the matching import line in a concurrent edit. Nothing objected --
// packages/core's tsc never sees supabase/functions, and eslint does not type-check Deno
// sources -- so it deployed. The bundler saw no import, shipped no float-lookup module,
// and the float step would have thrown at runtime: the ORIGINAL outage, relocated.
//
// The alias vocabulary is derived, not hardcoded: any name bound to a _shared/core import
// anywhere under supabase/functions, plus the repo's `coreXxx` convention. So a file that
// drops an import while still using the alias fails here instead of in production.
//
// This is deliberately narrow. The general tool for it is `deno check`, which resolves the
// https: specifiers these functions use and would catch every undefined reference, not
// just core ones. Worth adding to CI; this check is the zero-dependency floor.
function verifyCoreAliasesAreImported() {
  const sources = walk(functionsRoot, (path) => path.endsWith('.ts')).filter(
    (path) => !path.startsWith(vendorRoot + sep),
  );

  const importedPerFile = new Map();
  const vocabulary = new Set();

  for (const source of sources) {
    const text = readFileSync(source, 'utf8');
    const aliases = new Set();
    const importRe =
      /import\s+(?:\*\s+as\s+(\w+)|\{([^}]*)\})\s+from\s+['"][^'"]*_shared\/core\/[^'"]+['"]/g;

    for (const match of text.matchAll(importRe)) {
      if (match[1] !== undefined) aliases.add(match[1]);
      if (match[2] !== undefined) {
        for (const clause of match[2].split(',')) {
          const name = clause.trim();
          if (name === '') continue;
          aliases.add((name.split(/\s+as\s+/)[1] ?? name).trim());
        }
      }
    }
    aliases.forEach((alias) => vocabulary.add(alias));
    importedPerFile.set(source, { text, aliases });
  }

  const problems = [];
  for (const [source, { text, aliases }] of importedPerFile) {
    const used = new Set();
    for (const [, name] of text.matchAll(/\b(\w+)\b/g)) {
      if (vocabulary.has(name) || /^core[A-Z]/.test(name)) used.add(name);
    }
    for (const name of used) {
      if (!aliases.has(name)) {
        problems.push(`${relative(repoRoot, source)}: uses '${name}' with no _shared/core import`);
      }
    }
  }

  if (problems.length > 0) {
    console.error('vendor-core: core alias used without importing it.\n');
    problems.forEach((line) => console.error(`  ${line}`));
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// 2. Walk the transitive closure over BOTH the .js and its .d.ts sibling.
// ---------------------------------------------------------------------------
// The .d.ts closure can be wider than the runtime one (a module may reference a
// types-only file that erases to nothing at runtime), so both are followed. The
// .d.ts files are what give the static imports real types at the call sites.
function collectClosure(entrypoints) {
  const files = new Set();
  const bareSpecifiers = new Set();
  const queue = [];

  for (const entry of entrypoints) {
    queue.push(entry, entry.replace(/\.js$/, '.d.ts'));
  }

  while (queue.length > 0) {
    const rel = queue.shift();
    if (files.has(rel)) continue;

    const abs = join(distRoot, rel);
    if (!existsSync(abs)) {
      // A .d.ts may legitimately be absent for a JS-only emit; a missing .js is fatal.
      if (rel.endsWith('.d.ts')) continue;
      fail(`${rel} not found in packages/core/dist. Run: pnpm --filter @shift/core build`);
    }
    files.add(rel);

    for (const [, specifier] of readFileSync(abs, 'utf8').matchAll(IMPORT_RE)) {
      if (!specifier.startsWith('.')) {
        bareSpecifiers.add(specifier);
        continue;
      }
      const resolved = normalize(join(dirname(rel), specifier))
        .split(sep)
        .join('/');
      queue.push(resolved, resolved.replace(/\.js$/, '.d.ts'));
    }
  }

  // Deno cannot resolve a bare specifier from a vendored file, and core's only runtime
  // dependency (date-fns-tz) is not reachable from any Edge Function entrypoint today.
  // If that changes this must fail loudly rather than ship a bundle that dies on boot.
  if (bareSpecifiers.size > 0) {
    fail(
      `vendored core reaches bare specifier(s) Deno cannot resolve: ${[...bareSpecifiers].join(', ')}`,
    );
  }

  return [...files].sort();
}

// ---------------------------------------------------------------------------
// 3. Write (or verify) the vendored tree.
// ---------------------------------------------------------------------------
const header = (rel) =>
  `// GENERATED FILE. DO NOT EDIT.\n` +
  `// Vendored from packages/core/dist/${rel} by scripts/vendor-core-into-functions.mjs.\n` +
  `// Edit packages/core/src and re-run: pnpm vendor:core\n`;

const entrypoints = discoverEntrypoints();
if (entrypoints.length === 0) {
  fail(`no '${vendorSpecifier}*' imports found under supabase/functions`);
}

verifyCoreAliasesAreImported();

const closure = collectClosure(entrypoints);
const expected = new Map(
  closure.map((rel) => [rel, header(rel) + readFileSync(join(distRoot, rel), 'utf8')]),
);

if (checkOnly) {
  const actual = walk(vendorRoot, () => true).map((abs) =>
    relative(vendorRoot, abs).split(sep).join('/'),
  );
  const drift = [];

  for (const [rel, content] of expected) {
    const abs = join(vendorRoot, rel);
    if (!existsSync(abs)) drift.push(`missing: ${rel}`);
    else if (readFileSync(abs, 'utf8') !== content) drift.push(`stale: ${rel}`);
  }
  for (const rel of actual) {
    if (!expected.has(rel)) drift.push(`orphaned: ${rel}`);
  }

  if (drift.length > 0) {
    console.error('vendor-core: supabase/functions/_shared/core is out of date.\n');
    drift.forEach((line) => console.error(`  ${line}`));
    console.error('\nRun: pnpm vendor:core');
    process.exit(1);
  }
  console.log(`vendor-core: up to date (${expected.size} files).`);
  process.exit(0);
}

// Rewrite from scratch so a module that stops being reachable is actually removed.
rmSync(vendorRoot, { recursive: true, force: true });
for (const [rel, content] of expected) {
  const abs = join(vendorRoot, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

console.log(
  `vendor-core: wrote ${expected.size} files to supabase/functions/_shared/core ` +
    `(entrypoints: ${entrypoints.join(', ')}).`,
);
