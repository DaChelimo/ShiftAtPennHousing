#!/usr/bin/env bash
# Clone the remote staging Supabase project into the local stack.
#
# WHAT THIS DOES AND DOES NOT COPY
#
#   schema   NOT copied. The local schema is rebuilt from the 152 migrations, so any
#            divergence between the migrations and staging shows up as a load failure,
#            which is information you want rather than drift you inherit silently.
#   data     public + auth + storage schemas, COPY format.
#   files    storage objects, via the Storage API (a DB dump carries only the metadata
#            rows in storage.objects, never the bytes).
#
# RUN THIS WITH QA MODE OFF. It is the one operation that legitimately reads the remote
# project, and scripts/hooks/qa-remote-guard.js blocks remote access while the marker
# exists. Order is: clone (QA off) -> qa-mode.sh on -> run the QA pass.
#
# Cost: the local dataset is ~8 MB across all public tables, so a full pull is a few MB
# over the wire, roughly 0.1% of a Supabase free-tier monthly egress allowance. Running
# a QA pass against the remote project instead would cost hundreds of MB to a few GB,
# so cloning is the cheap option, not the expensive one.
#
# Usage:
#   scripts/qa/clone-remote-to-local.sh [--skip-storage] [--dry-run]
#
# Credentials: `supabase db dump --linked` prompts for the remote database password
# unless SUPABASE_DB_URL is exported. Nothing here writes a credential to disk.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

LOCAL_DB="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
WORK="${TMPDIR:-/tmp}/shift-clone-$$"
SKIP_STORAGE=0
DRY_RUN=0
FROM_DUMP=""

while [ $# -gt 0 ]; do
  case "$1" in
    --skip-storage) SKIP_STORAGE=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --from-dump) shift; FROM_DUMP="${1:?--from-dump needs a file}" ;;
    *) echo "unknown flag: $1" >&2; exit 64 ;;
  esac
  shift
done

red() { printf '\033[31m%s\033[0m\n' "$*"; }
grn() { printf '\033[32m%s\033[0m\n' "$*"; }
ylw() { printf '\033[33m%s\033[0m\n' "$*"; }
step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

KEEP_ON_FAIL=""
cleanup() {
  local rc=$?
  if [ "$rc" -ne 0 ] && [ -n "$KEEP_ON_FAIL" ] && [ -f "$KEEP_ON_FAIL" ]; then
    local kept="${TMPDIR:-/tmp}/shift-clone-last-dump.sql"
    mv "$KEEP_ON_FAIL" "$kept" 2>/dev/null &&
      ylw "Dump kept at $kept. Re-run with:  $0 --from-dump $kept"
  fi
  [ -d "$WORK" ] && rm -rf "$WORK"
  return $rc
}
trap cleanup EXIT

# --- preflight ---------------------------------------------------------------

if [ -f "$REPO_ROOT/.qa-mode" ]; then
  red "QA mode is ON, which blocks remote access. This script must read the remote project."
  echo "Run:  scripts/qa/qa-mode.sh off" >&2
  echo "then re-run this script, then turn QA mode back on." >&2
  exit 2
fi

[ -f supabase/.temp/project-ref ] || { red "No linked project. Run: supabase link"; exit 3; }
REF="$(cat supabase/.temp/project-ref)"

if ! pg_isready -h 127.0.0.1 -p 54322 -q 2>/dev/null; then
  ylw "Local stack is not up. Starting it..."
  supabase start
fi

mkdir -p "$WORK"

echo "Remote project : ${REF:0:6}... (linked)"
echo "Local target   : $LOCAL_DB"
echo "Storage        : $([ "$SKIP_STORAGE" = 1 ] && echo 'SKIPPED' || echo 'included')"
[ "$DRY_RUN" = 1 ] && { ylw "Dry run: stopping before any change."; exit 0; }

# --- 1. pull data from remote ------------------------------------------------

step "1/5  Dumping remote data (public + auth + storage)"
if [ -n "$FROM_DUMP" ]; then
  [ -f "$FROM_DUMP" ] || { red "No such dump: $FROM_DUMP"; exit 4; }
  cp "$FROM_DUMP" "$WORK/data.sql"
  ylw "  reusing $FROM_DUMP (no remote read)"
else
  supabase db dump --linked --data-only --use-copy -s public,auth,storage -f "$WORK/data.sql"
fi
grn "  dumped $(wc -c < "$WORK/data.sql" | tr -d ' ') bytes"
# Keep the dump if a later step fails, so a reload does not re-pull 8 MB. Deleted on success.
KEEP_ON_FAIL="$WORK/data.sql"

if [ "$SKIP_STORAGE" = 0 ]; then
  step "2/5  Pulling storage objects"
  # --experimental is REQUIRED: without it the CLI refuses with LegacyExperimentalRequiredError,
  # which this block used to swallow into a blank warning line, so the clone silently shipped
  # zero storage bytes while claiming storage was "included".
  if supabase storage ls --linked --experimental > "$WORK/buckets.raw" 2>"$WORK/storage.err"; then
    # The experimental CLI emits JSON, not bare names: {"paths":["kb-uploads/"],"message":""}.
    # Feeding that line straight to `cp` produced LegacyStorageUrlParseError ("first path
    # segment in URL cannot contain colon"), which the old loop reported as a bucket named
    # after the whole JSON blob. Pull the names out and address them as ss:///<bucket>.
    tr ',' '\n' < "$WORK/buckets.raw" \
      | sed -n 's/.*"\([A-Za-z0-9._-]*\)\/*".*/\1/p' \
      | grep -v '^$' | sort -u > "$WORK/buckets.txt"
    mkdir -p "$WORK/files"
    while read -r b; do
      [ -z "$b" ] && continue
      echo "  bucket: $b"
      supabase storage cp -r --linked --experimental "ss:///$b" "$WORK/files" \
        2>>"$WORK/storage.err" || ylw "    could not pull $b (see storage errors below)"
    done < "$WORK/buckets.txt"
    [ -s "$WORK/storage.err" ] && sed 's/^/    /' "$WORK/storage.err" >&2
  else
    ylw "  storage ls FAILED; continuing without files. Metadata rows still load."
    sed 's/^/    /' "$WORK/storage.err" >&2 2>/dev/null || true
  fi
else
  step "2/5  Storage skipped"
fi

# --- 2. rebuild local schema from migrations ---------------------------------

step "3/5  Rebuilding local schema from migrations (no seed)"
ylw "  This DROPS the local database. Local only. The remote project is untouched."
read -r -p "  Proceed? [y/N] " ok
[ "$ok" = "y" ] || [ "$ok" = "Y" ] || { red "Aborted."; exit 1; }
supabase db reset --local --no-seed

# --- 3. load ------------------------------------------------------------------

step "4/5  Loading data into local"

# A freshly reset database is NOT empty, for two reasons, and both collide with a
# data-only COPY load:
#
#   1. Migrations insert rows. 20260725000001 inserts `allied-house` into `houses`;
#      others seed `system_config`, `routing_rules` and `dev_sim_clock`. The first
#      COPY then dies on `houses_pkey`.
#   2. `supabase db reset` does NOT clear `auth` and `storage`. Verified 2026-07-29:
#      after a reset with --no-seed, auth.users still held 24 rows whose xmin was
#      NEWER than the migration-inserted rows, so the CLI restores them after the
#      migration run. Stale logins would otherwise survive every clone.
#
# So: truncate exactly the tables the dump carries, derived from the dump itself, and
# nothing else. Bookkeeping tables (auth.schema_migrations, storage.migrations) are
# absent from the dump and therefore untouched. Every dumped table is repopulated by
# the load, so this cannot leave a table emptier than the source.
#
# The local `postgres` role is NOT a superuser and does not own the `storage` tables, so
# it cannot TRUNCATE or INSERT into storage.buckets_vectors, storage.vector_indexes or
# storage.migrations. Those are Storage-internal and the dump carries them empty. Rather
# than hardcode that list, ask the catalog, and abort loudly if a table we cannot write
# to actually has rows to load, since silently skipping it would be data loss.
grep -o '^COPY "[a-z_]*"\."[a-z_]*"' "$WORK/data.sql" | sed 's/^COPY //' | sort -u > "$WORK/tables.txt"
[ -s "$WORK/tables.txt" ] || { red "Dump carries no COPY blocks. Refusing to load."; exit 5; }

psql "$LOCAL_DB" -tA -F'|' -v ON_ERROR_STOP=1 -q > "$WORK/privs.txt" <<SQL
CREATE TEMP TABLE _t(q text);
\copy _t FROM '$WORK/tables.txt'
SELECT q,
       has_table_privilege(q, 'TRUNCATE')::text,
       has_table_privilege(q, 'INSERT')::text
FROM _t ORDER BY q;
SQL

TRUNCATE_LIST="$(awk -F'|' '$2=="true"{print $1}' "$WORK/privs.txt" | paste -sd, -)"
# Strip the SQL quoting here: the shell needs bare schema.table to rebuild the COPY header,
# while TRUNCATE_LIST keeps the quotes because it goes straight back into SQL.
NO_INSERT="$(awk -F'|' '$3!="true"{gsub(/"/, "", $1); print $1}' "$WORK/privs.txt")"
[ -n "$TRUNCATE_LIST" ] || { red "No truncatable tables resolved. Refusing to load."; exit 5; }

# Strip the COPY blocks we have no INSERT right to, but only after proving each is empty.
if [ -n "$NO_INSERT" ]; then
  for q in $NO_INSERT; do
    sch="${q%%.*}"; tbl="${q##*.}"
    rows="$(awk -v s="\"$sch\".\"$tbl\"" '
      index($0, "COPY " s) == 1 { inblk=1; next }
      inblk && $0 == "\\." { inblk=0; next }
      inblk { n++ } END { print n+0 }' "$WORK/data.sql")"
    if [ "$rows" -gt 0 ]; then
      red "$q carries $rows rows but this role cannot INSERT into it. Aborting."
      exit 6
    fi
    ylw "  skipping $q (not writable by $(whoami)'s db role, and empty in the dump)"
  done
  awk -v skip="$(echo "$NO_INSERT" | paste -sd' ' -)" '
    BEGIN { n=split(skip, a, " "); for (i=1;i<=n;i++) { split(a[i],p,"."); k["COPY \"" p[1] "\".\"" p[2] "\""]=1 } }
    { for (key in k) if (index($0, key) == 1) { inblk=1 } }
    inblk { if ($0 == "\\.") inblk=0; next }
    { print }' "$WORK/data.sql" > "$WORK/data.filtered.sql"
  mv "$WORK/data.filtered.sql" "$WORK/data.sql"
fi

echo "  clearing $(echo "$TRUNCATE_LIST" | tr ',' '\n' | wc -l | tr -d ' ') tables the dump replaces"

# session_replication_role=replica disables triggers and FK checks for the load. This
# schema has trigger-enforced invariants (check_membership_no_overlap,
# enforce_block_occupied_headcount, the float_routing legality trigger) that would
# either reject valid staging rows or make the load quadratic. The local `postgres` role
# is not a superuser but is granted this setting. It is reset to origin immediately after.
psql "$LOCAL_DB" -v ON_ERROR_STOP=1 -q <<SQL
SET session_replication_role = replica;
TRUNCATE $TRUNCATE_LIST CASCADE;
\i $WORK/data.sql
SET session_replication_role = origin;
SQL
grn "  loaded"

if [ "$SKIP_STORAGE" = 0 ] && [ -d "$WORK/files" ]; then
  for d in "$WORK/files"/*; do
    [ -d "$d" ] || continue
    echo "  pushing $(basename "$d")"
    supabase storage cp -r --local --experimental "$d" "ss:///$(basename "$d")" \
      || ylw "    push failed for $(basename "$d")"
  done
fi

# --- 4. verify ----------------------------------------------------------------

step "5/5  Verifying"
psql "$LOCAL_DB" -tA -F' | ' -c "
SELECT c.relname, COALESCE(s.n_live_tup, 0)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
WHERE n.nspname = 'public' AND c.relkind = 'r' AND COALESCE(s.n_live_tup, 0) > 0
ORDER BY 2 DESC LIMIT 12;"

echo
psql "$LOCAL_DB" -tA -c "SELECT 'auth.users: ' || count(*) FROM auth.users;"

cat <<'DONE'

Clone complete.

Next:
  scripts/qa/qa-mode.sh on          # point everything at local, block the remote
  scripts/qa/catalog-parity.sh      # diff remote vs local grants; differences are findings

Remember the ordering rule: catalog parity reads the REMOTE catalog, so run it BEFORE
turning QA mode on, or the guard will (correctly) block it.
DONE
