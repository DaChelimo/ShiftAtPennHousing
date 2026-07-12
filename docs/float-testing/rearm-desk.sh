#!/usr/bin/env bash
# Re-arm a single desk's escalation state on the LOCAL Supabase DB so the
# orchestrator re-fires broadcast -> float_lookup -> hmod_notify_allied for it.
#
#   docs/float-testing/rearm-desk.sh <house_id> [from-NY] [to-NY]
#
# Examples:
#   docs/float-testing/rearm-desk.sh dubois
#       re-arm every block for dubois from the sim-clock "now" onward
#   docs/float-testing/rearm-desk.sh dubois '2026-06-30 19:00' '2026-07-01 00:00'
#       re-arm just the 7:00 PM .. 12:00 AM (NY) window
#
# Window bounds are NY-local and half-open [from, to). Does NOT reset the sim
# clock and does NOT touch other houses. See rearm-desk.sql for details.
set -euo pipefail

HOUSE="${1:-}"
FROM="${2:-}"
TO="${3:-}"

if [[ -z "$HOUSE" ]]; then
  echo "usage: $0 <house_id> [from-NY 'YYYY-MM-DD HH:MM'] [to-NY 'YYYY-MM-DD HH:MM']" >&2
  echo "  with no window, re-arms all blocks for the house from app_now() onward" >&2
  exit 1
fi

DIR="$(cd "$(dirname "$0")" && pwd)"
export PGPASSWORD=postgres
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  -X -q -v ON_ERROR_STOP=1 \
  -v house="$HOUSE" -v p_from="$FROM" -v p_to="$TO" \
  -f "$DIR/rearm-desk.sql"
