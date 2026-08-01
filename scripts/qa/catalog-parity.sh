#!/usr/bin/env bash
# Diff the REMOTE catalog against the LOCAL one. Read-only on both sides, a few KB.
#
# Run this with QA MODE OFF, before starting a QA pass. It is a human-run setup step by
# design: it is the one thing that must read the remote project, and QA mode blocks
# exactly that. Ordering: clone -> catalog-parity -> qa-mode.sh on -> run the pass.
#
# Every difference is a finding. A grant or policy that exists in staging but not in a
# fresh migration replay means the migrations do not describe reality; the reverse means
# staging has drifted from the migrations. Both are reportable.
#
# Usage:
#   scripts/qa/catalog-parity.sh                 # prompts for the remote password
#   SUPABASE_DB_URL=postgresql://... scripts/qa/catalog-parity.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

LOCAL_DB="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
PROBE="scripts/qa/catalog-parity.sql"
OUT="${TMPDIR:-/tmp}/shift-parity"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
grn() { printf '\033[32m%s\033[0m\n' "$*"; }
ylw() { printf '\033[33m%s\033[0m\n' "$*"; }

if [ -f "$REPO_ROOT/.qa-mode" ]; then
  red "QA mode is ON, which blocks remote access. Parity must read the remote catalog."
  echo "Run 'scripts/qa/qa-mode.sh off', run this, then turn QA mode back on." >&2
  exit 2
fi

mkdir -p "$OUT"

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  ylw "SUPABASE_DB_URL is not set."
  echo "Get the pooler/direct connection string from the Supabase dashboard"
  echo "(Project Settings > Database > Connection string), then:"
  echo "  SUPABASE_DB_URL='postgresql://...' scripts/qa/catalog-parity.sh"
  exit 3
fi

echo "==> probing REMOTE (read-only)"
psql "$SUPABASE_DB_URL" -tA -F'|' -f "$PROBE" | sort > "$OUT/remote.txt"
grn "    $(wc -l < "$OUT/remote.txt" | tr -d ' ') catalog rows"

echo "==> probing LOCAL (read-only)"
psql "$LOCAL_DB" -tA -F'|' -f "$PROBE" | sort > "$OUT/local.txt"
grn "    $(wc -l < "$OUT/local.txt" | tr -d ' ') catalog rows"

echo
if diff -u "$OUT/local.txt" "$OUT/remote.txt" > "$OUT/parity.diff"; then
  grn "IDENTICAL. Local (rebuilt from migrations) matches the remote catalog exactly."
  echo "The migrations describe deployed reality. No drift findings."
  exit 0
fi

red "DIVERGENCE. The migrations and the remote catalog disagree."
echo "  '-' lines are LOCAL (what the migrations produce)"
echo "  '+' lines are REMOTE (what is actually deployed)"
echo
head -60 "$OUT/parity.diff"
echo
echo "Full diff: $OUT/parity.diff"
echo
ylw "Each of these is a ship-check finding. File them before starting the slices."
exit 1
