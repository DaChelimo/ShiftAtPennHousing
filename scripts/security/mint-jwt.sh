#!/usr/bin/env bash
# Mint a LOCAL-ONLY Supabase user JWT so the auditor can attack as a real signed-in worker.
#
# Why this exists: the anon key only instantiates the anonymous attacker. Roughly half this
# schema is `anon=f, auth=t` (worker_directory, house_schedule_grid_any, da_is_kb_admin,
# author_break_period, ...), so without an authenticated JWT that surface cannot be tested
# at all and an audit silently covers half of what it claims.
#
# This signs with the LOCAL dev JWT secret, which is a fixed, published value in every
# Supabase local stack. It cannot forge a token for any deployed project. Never point it at
# a real JWT secret, and never commit a minted token.
#
# Usage:
#   scripts/security/mint-jwt.sh                        # first active sw, role authenticated
#   scripts/security/mint-jwt.sh <user_uuid>            # that user
#   scripts/security/mint-jwt.sh <user_uuid> service_role
#   scripts/security/mint-jwt.sh --list                 # candidate users by role
#
# Then attack as that worker:
#   TOKEN=$(scripts/security/mint-jwt.sh)
#   curl -s "$REST/worker_directory?select=*&limit=1" \
#     -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN"
set -euo pipefail

DB_URL="${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
JWT_SECRET="${SUPABASE_JWT_SECRET:-super-secret-jwt-token-with-at-least-32-characters-long}"

if [[ "${1:-}" == "--list" ]]; then
  psql "$DB_URL" -X --pset=pager=off -c "
    select u.user_id, u.name, u.home_house_id,
           coalesce(string_agg(distinct r.role::text, ',' order by r.role::text), 'sw') as roles
    from users u left join user_roles r on r.user_id = u.user_id
    where u.is_active
    group by 1,2,3 order by 4, 2 limit 40;"
  exit 0
fi

USER_ID="${1:-}"
ROLE="${2:-authenticated}"

# Default to a plain Student Worker: `sw` is an explicit row in user_roles here, so the
# unprivileged case is "only sw, or no role row at all", NOT "no role row". Prefer a
# non-Harnwell worker, because that is the persona the Harnwell training invariant forbids
# from staffing the Harnwell desk, which makes it the useful attacker for invariant #1.
if [[ -z "$USER_ID" ]]; then
  read -r USER_ID HOME_HOUSE < <(psql "$DB_URL" -X -qtAF' ' -c "
    select u.user_id, u.home_house_id from users u
    where u.is_active
      and not exists (select 1 from user_roles r
                      where r.user_id = u.user_id and r.role::text <> 'sw')
    order by (u.home_house_id = 'harnwell'), u.user_id limit 1;")
  if [[ -z "${USER_ID:-}" ]]; then
    echo "FATAL: no active unprivileged worker found. Pass a uuid, or run --list." >&2
    exit 1
  fi
  echo "using unprivileged worker: $USER_ID (home_house=$HOME_HOUSE)" >&2
fi

node -e '
const c = require("crypto");
const [sub, role, secret] = process.argv.slice(1);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
// Claim set PostgREST/GoTrue actually reads: role drives the Postgres SET ROLE, sub becomes
// auth.uid(). aud/iss must match what the local stack expects or the token is rejected.
const payload = {
  aud: "authenticated", iss: "supabase-demo", sub,
  role, email: "auditor@local.invalid",
  app_metadata: { provider: "email" }, user_metadata: {},
  iat: now, exp: now + 3600,
};
const signing = b64({ alg: "HS256", typ: "JWT" }) + "." + b64(payload);
const sig = c.createHmac("sha256", secret).update(signing).digest("base64url");
process.stdout.write(signing + "." + sig);
' "$USER_ID" "$ROLE" "$JWT_SECRET"
echo
