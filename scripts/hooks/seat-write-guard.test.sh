#!/usr/bin/env bash
# Calibration harness for seat-write-guard.js.
#
# A guard is only worth stopping for if it is quiet on code that is fine. Run this after ANY
# change to the guard's rule and check both numbers:
#
#   * corpus firing rate -- how many existing migrations it flags. These are the repo's own
#     accepted history, so anything it flags is a false positive unless you can show the
#     migration is genuinely unsafe. The first draft of this guard sat at 32/148 (22%) and
#     was rewritten; treat anything above a handful as a rule that needs narrowing.
#   * the two fixtures -- it must still FIRE on the shape that recurred, and stay SILENT on
#     the lock-then-write-by-id shape that is correct.
#
# Usage: scripts/hooks/seat-write-guard.test.sh
set -uo pipefail
cd "$(dirname "$0")/../.."

GUARD=scripts/hooks/seat-write-guard.js
FAIL=0

feed() { # file_path content_file
  node -e "
    const fs = require('fs');
    process.stdout.write(JSON.stringify({
      tool_input: { file_path: process.argv[1], content: fs.readFileSync(process.argv[2],'utf8') },
    }));
  " "$1" "$2" | node "$GUARD" >/dev/null 2>&1
}

echo "== corpus firing rate =="
hits=0; total=0; flagged=()
for f in supabase/migrations/*.sql; do
  total=$((total + 1))
  if ! feed "$f" "$f"; then hits=$((hits + 1)); flagged+=("$f"); fi
done
echo "  $hits of $total migrations flagged"
for f in "${flagged[@]:-}"; do [ -n "$f" ] && echo "    $f"; done

echo "== fixtures =="
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# MUST FIRE: the shape that recurred three times. No predicate, no lock anywhere.
cat > "$TMP/bad.sql" <<'SQL'
CREATE OR REPLACE FUNCTION vacate(p_ids uuid[], p_user uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE shift_block_assignments
  SET status = 'vacant', user_id = NULL
  WHERE assignment_id = ANY (p_ids);
END;
$$;
SQL
if feed supabase/migrations/99990101000000_bad.sql "$TMP/bad.sql"; then
  echo "  FAIL: did not fire on an unprotected occupancy write"; FAIL=1
else
  echo "  ok: fires on an unprotected occupancy write"
fi

# MUST STAY SILENT: lock first, re-validate, then write by id. Correct and common here.
cat > "$TMP/locked.sql" <<'SQL'
CREATE OR REPLACE FUNCTION assign(p_ids uuid[], p_user uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM (
    SELECT assignment_id FROM shift_block_assignments
    WHERE assignment_id = ANY (p_ids) AND status = 'vacant'
    FOR UPDATE
  ) locked;
  IF v_n < cardinality(p_ids) THEN RETURN; END IF;

  UPDATE shift_block_assignments
  SET status = 'pending_float_in', user_id = p_user
  WHERE assignment_id = ANY (p_ids);
END;
$$;
SQL
if feed supabase/migrations/99990101000001_locked.sql "$TMP/locked.sql"; then
  echo "  ok: silent when the function takes a row lock"
else
  echo "  FAIL: fired on a correctly locked write"; FAIL=1
fi

# MUST STAY SILENT: no lock, but the write carries its own compare-and-swap predicate.
cat > "$TMP/cas.sql" <<'SQL'
CREATE OR REPLACE FUNCTION vacate_cas(p_ids uuid[], p_user uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE shift_block_assignments
  SET status = 'vacant', user_id = NULL
  WHERE assignment_id = ANY (p_ids)
    AND user_id = p_user
    AND status IN ('scheduled', 'claimed');
END;
$$;
SQL
if feed supabase/migrations/99990101000002_cas.sql "$TMP/cas.sql"; then
  echo "  ok: silent when the write carries its own predicate"
else
  echo "  FAIL: fired on a compare-and-swap write"; FAIL=1
fi

# MUST STAY SILENT: the documented escape hatch, for writes serialised at a higher level.
cat > "$TMP/allow.sql" <<'SQL'
CREATE OR REPLACE FUNCTION bulk_cancel(p_ids uuid[])
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- seat-write-allow: admin config reconcile, serialised by an advisory lock; there is no
  -- expected prior owner because it cancels whoever is there.
  UPDATE shift_block_assignments
  SET status = 'cancelled_config', vacancy_origin = 'none'
  WHERE assignment_id = ANY (p_ids);
END;
$$;
SQL
if feed supabase/migrations/99990101000003_allow.sql "$TMP/allow.sql"; then
  echo "  ok: silent when the statement carries a justified seat-write-allow"
else
  echo "  FAIL: escape hatch did not work"; FAIL=1
fi

echo
[ "$FAIL" -eq 0 ] && echo "fixtures pass" || echo "FIXTURES FAILED"
exit "$FAIL"
