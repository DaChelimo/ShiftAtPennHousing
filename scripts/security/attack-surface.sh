#!/usr/bin/env bash
# Live attack-surface enumeration against the LOCAL Supabase Postgres.
#
# Why this exists: grants are authoritative in the DATABASE, not in any one migration.
# A CREATE FUNCTION in migration 020 may be revoked in 137, and Supabase's
# `ALTER DEFAULT PRIVILEGES` grants EXECUTE to anon/authenticated at CREATE time as
# explicit per-role grants that a `REVOKE ... FROM PUBLIC` does NOT strip. So grepping
# migrations for REVOKE both misses later fixes and reports fixes that never landed.
# Introspect the running catalog, then grep source only to attribute a finding to file:line.
#
# Usage:
#   scripts/security/attack-surface.sh                # all sections
#   scripts/security/attack-surface.sh definers       # one section
#   POLICY_TABLES=a,b scripts/security/attack-surface.sh policies
# Sections: definers | noauthz | views | rls | writes | policies | searchpath | edge | granttests
#
# Requires a running local stack (`supabase start`). Read-only: every query is a SELECT.
# Pair with scripts/security/mint-jwt.sh to attack as a real signed-in worker, not just anon.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB_URL="${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
SECTION="${1:-all}"

if ! psql "$DB_URL" -qtAc 'select 1' >/dev/null 2>&1; then
  echo "FATAL: cannot reach local Postgres at $DB_URL" >&2
  echo "Run 'supabase start' first, or set SUPABASE_DB_URL." >&2
  exit 1
fi

q() { psql "$DB_URL" -X --pset=pager=off -c "$1"; }

# Input args only. proargnames also contains OUT / RETURNS TABLE column names, so matching
# the whole array reports functions whose OUTPUT happens to be called `other_user_id` and
# which take no input at all (worker_pending_swaps was exactly this false positive).
ARGS_IN="coalesce(array_to_string(p.proargnames[1:p.pronargs], ','), '')"
ACTOR_RX="'(user_id|_user|initiator|actor|operator|worker_id|published_by|dropper|calling)'"
CLIENT_REACHABLE="(has_function_privilege('anon', p.oid, 'EXECUTE')
                   or has_function_privilege('authenticated', p.oid, 'EXECUTE'))"

# 1. Confused-deputy candidates: SECURITY DEFINER + client-reachable + takes an actor uuid
# from the caller. Each row is a function a signed-in worker can invoke over
# POST /rest/v1/rpc/<name> while naming somebody else as the actor.
definers() {
  echo "=== [1] SECURITY DEFINER functions callable by anon/authenticated that take an actor argument ==="
  q "select p.proname,
            has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
            (pg_get_functiondef(p.oid) ~ 'auth\.uid\(\)') as mentions_auth_uid,
            exists (select 1 from pg_proc w join pg_namespace wn on wn.oid = w.pronamespace
                    where wn.nspname = 'public' and w.prosecdef
                      and w.proname = p.proname || '_unguarded') as has_unguarded_twin,
            (p.proname ~ '_unguarded$') as is_unguarded_inner,
            $ARGS_IN as in_args
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and $ARGS_IN ~ $ACTOR_RX
       and $CLIENT_REACHABLE
     order by mentions_auth_uid, 1;"
  cat <<'NOTE'
READ THIS:
 * mentions_auth_uid = f is a strong confused-deputy signal (authorizes on a caller-supplied
   uuid with no JWT cross-check). mentions_auth_uid = t is a HINT, NOT A VERDICT: the
   function may mention auth.uid() in a comment, or in a branch other than the authorization
   one. Read the body either way.
 * is_unguarded_inner = t is the trap that made the 2026-07-07 fix look complete. A revoke
   applied to the advisory-lock WRAPPER leaves the inner `_unguarded` function, which holds
   the real authorization check and does the writing, still client-reachable. Check the pair.
 * This section by construction only finds the confused-deputy class. Run `noauthz` for the
   definers that take no actor arg and perform no authorization at all.
NOTE
}

# 2. The class section 1 cannot see: SECURITY DEFINER, client-reachable, no auth.uid()
# anywhere AND no actor argument, so nothing authorizes the call at all. More exploitable
# than a confused deputy, because it needs no victim uuid to enumerate.
noauthz() {
  echo "=== [2] SECURITY DEFINER functions callable by anon/authenticated with NO authorization at all ==="
  q "select p.proname, pg_get_function_identity_arguments(p.oid) as sig,
            has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
            (p.provolatile = 'v') as writes_maybe
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and $CLIENT_REACHABLE
       and pg_get_functiondef(p.oid) !~ 'auth\.uid\(\)'
       and $ARGS_IN !~ $ACTOR_RX
       and p.pronargs > 0
     order by writes_maybe desc, 1;"
  cat <<'NOTE'
READ THIS: writes_maybe = t means VOLATILE, so it may mutate. Prioritise those. A hit here is
only a finding once you confirm the body actually does something privileged: some are pure
read helpers (is_assignment_claimable) and some are orchestrator internals that mutate state
a worker must not control (lock_block_coverage sets the ONE-WAY coverage_locked_at). Probe
with bogus uuids so you prove reachability without mutating a real row.
NOTE
}

# 3. Owner-rights views bypass RLS on their base tables. Safe ONLY if the view body
# self-filters on auth.uid(). security_invoker = true views inherit caller RLS and are fine.
views() {
  echo "=== [3] Views granted to anon/authenticated, by rights mode ==="
  q "select c.relname,
            has_table_privilege('anon', c.oid, 'SELECT') as anon,
            has_table_privilege('authenticated', c.oid, 'SELECT') as auth,
            coalesce((select option_value from pg_options_to_table(c.reloptions)
                      where option_name = 'security_invoker'), 'OFF') as security_invoker,
            (pg_get_viewdef(c.oid) ~ 'auth\.uid\(\)') as self_filters
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'v'
       and (has_table_privilege('anon', c.oid, 'SELECT')
            or has_table_privilege('authenticated', c.oid, 'SELECT'))
     order by security_invoker, self_filters, 1;"
  cat <<'NOTE'
READ THIS:
 * security_invoker = OFF AND self_filters = f AND anon = t is an unauthenticated leak.
   Confirm every hit with an actual anon-key curl (and a row count) before reporting it.
 * self_filters is a regex over the view definition, so it is a HINT, NOT A VERDICT: a view
   mentioning auth.uid() in its SELECT list rather than its WHERE reads as safe but is not.
 * pgTAP harness views (pg_all_foreign_keys, tap_funky) exist only because the test extension
   is installed locally. They are NOT production surface. Check whether a hit ships before
   you report it, or you will file a finding that cannot exist in prod.
NOTE
}

# 4. A table with RLS ON and zero policies is deny-by-default for non-superusers, which is
# SAFE. The real hole is RLS OFF with a client grant.
rls() {
  echo "=== [4] Client-reachable tables with RLS off, or RLS on with zero policies ==="
  q "select c.relname, c.relkind, c.relrowsecurity as rls_enabled,
            c.relforcerowsecurity as rls_forced,
            (select count(*) from pg_policy where polrelid = c.oid) as policies,
            has_table_privilege('anon', c.oid, 'SELECT') as anon_sel,
            has_table_privilege('authenticated', c.oid, 'SELECT') as auth_sel
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
       and (not c.relrowsecurity or (select count(*) from pg_policy where polrelid = c.oid) = 0)
       and (has_table_privilege('anon', c.oid, 'SELECT')
            or has_table_privilege('authenticated', c.oid, 'SELECT'))
     order by c.relrowsecurity, 1;"
  cat <<'NOTE'
READ THIS: rls_enabled = t + policies = 0 is deny-all, so it is SAFE. Do not report it as a
hole; put it in the verified-safe list. rls_enabled = f with any client grant IS a hole.
rls_forced is reported but NOT filtered on: FORCE only matters for the table OWNER, which
here means a SECURITY DEFINER owned by the same role reads the table with RLS bypassed. That
correlation is not automated. Check it by hand for any table a definer writes.
NOTE
}

# 5. Direct table writes let a hostile client skip every RPC guard and write rows itself,
# bounded only by the WITH CHECK expression of the INSERT/UPDATE policies.
writes() {
  echo "=== [5] Direct write grants to anon/authenticated, with CLIENT-facing write policies ==="
  q "with wp as (
       select pp.polrelid,
              count(*) filter (
                where exists (select 1 from pg_roles r
                              where r.oid = any(pp.polroles) and r.rolname <> 'service_role')
                   or pp.polroles = '{0}'::oid[]
              ) as client_write_policies,
              count(*) as all_write_policies
       from pg_policy pp
       where pp.polcmd in ('a','w','d','*')
       group by 1)
     select c.relname,
            has_table_privilege('authenticated', c.oid, 'INSERT') as a_ins,
            has_table_privilege('authenticated', c.oid, 'UPDATE') as a_upd,
            has_table_privilege('authenticated', c.oid, 'DELETE') as a_del,
            has_table_privilege('anon', c.oid, 'INSERT') as anon_ins,
            has_table_privilege('anon', c.oid, 'UPDATE') as anon_upd,
            has_table_privilege('anon', c.oid, 'DELETE') as anon_del,
            coalesce(wp.client_write_policies, 0) as client_write_policies,
            coalesce(wp.all_write_policies, 0) as all_write_policies
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     left join wp on wp.polrelid = c.oid
     where n.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity
       and (has_table_privilege('authenticated', c.oid, 'INSERT')
            or has_table_privilege('authenticated', c.oid, 'UPDATE')
            or has_table_privilege('authenticated', c.oid, 'DELETE')
            or has_table_privilege('anon', c.oid, 'INSERT')
            or has_table_privilege('anon', c.oid, 'UPDATE')
            or has_table_privilege('anon', c.oid, 'DELETE'))
       and coalesce(wp.client_write_policies, 0) > 0
     order by client_write_policies desc, 1;"
  cat <<'NOTE'
READ THIS: this section deliberately shows ONLY tables with a write policy that some role
other than service_role can satisfy. Nearly every table here carries a `service-role bypass`
ALL policy which is permissive but inert for a hostile client, so counting all write policies
made this section pure noise (24 of 40 rows were the bypass alone). client_write_policies > 0
is a REAL client write path: dump its WITH CHECK via `policies` and attack that expression.
An empty result here is a good result. `all_write_policies` is shown only for contrast.
NOTE
}

# 6. The exact boolean a hostile row must satisfy. Read the expression, then build a
# counterexample row that satisfies it while violating a documented invariant.
policies() {
  local tables="${POLICY_TABLES:-shift_block_assignments,users,user_roles,float_assignments,system_config,user_house_memberships,shift_blocks,hmod_rotor,notifications}"
  echo "=== [6] Full policy expressions for sensitive tables (${tables}) ==="
  # A renamed or mistyped table returns zero rows, which reads as "no policies, safe". Warn.
  local missing
  missing=$(psql "$DB_URL" -X -qtAc "
    select string_agg(t, ', ') from unnest(string_to_array('${tables}', ',')) as t
    where not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                      where n.nspname = 'public' and c.relname = t);")
  if [[ -n "${missing// /}" ]]; then
    echo "WARNING: requested table(s) do not exist in schema public: ${missing}"
    echo "WARNING: their absence below means NOT FOUND, not 'no policies'. Fix the name."
  fi
  q "select c.relname as tbl, pol.polname,
            case pol.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
                            when 'w' then 'UPDATE' when 'd' then 'DELETE' else 'ALL' end as cmd,
            pol.polpermissive as permissive,
            coalesce(nullif(array_to_string(array(select rolname from pg_roles
                     where oid = any(pol.polroles)), ','), ''), 'PUBLIC') as roles,
            pg_get_expr(pol.polqual, pol.polrelid) as using_expr,
            pg_get_expr(pol.polwithcheck, pol.polrelid) as with_check
     from pg_policy pol join pg_class c on c.oid = pol.polrelid
     where c.relname = any (string_to_array('${tables}', ','))
     order by 1, 3, 2;"
  cat <<'NOTE'
READ THIS:
 * roles = service_role is NOT an attack surface. roles = PUBLIC or authenticated/anon is.
 * An UPDATE policy with a using_expr but a NULL with_check is read-scoped and write-open:
   the caller can move a row to a state the USING clause would never have let them read.
 * Multiple permissive policies for the same cmd OR together, so the WIDEST one wins. Read
   each clause separately, especially where an OR was added for one surface (the
   shift_block_assignments own-assignment clause is load-bearing for float-out visibility).
 * A restrictive policy (permissive = f) ANDs instead, and can be the only thing saving an
   otherwise-open permissive policy. Do not read a permissive policy in isolation.
NOTE
}

# 7. search_path hijacking is the standard Postgres SECURITY DEFINER privesc. This is 0 today;
# the probe exists so a regression is caught while the number is still 0.
searchpath() {
  echo "=== [7] SECURITY DEFINER functions with no pinned search_path ==="
  q "select p.proname, pg_get_function_identity_arguments(p.oid) as sig,
            $CLIENT_REACHABLE as client_reachable
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
                       where cfg like 'search\_path=%')
     order by client_reachable desc, 1;"
  echo "READ THIS: any row is a finding. Zero rows is the expected state; say so in"
  echo "verified-safe. A definer with a mutable search_path can be hijacked into running an"
  echo "attacker-created function of the same name from a schema earlier in the path."
}

# 8. Edge Function posture. A function with verify_jwt = false is reachable with no token,
# so its own authorization checks are the only thing standing between it and the internet.
edge() {
  echo "=== [8] Edge Functions and their verify_jwt posture ==="
  local dir="$REPO_ROOT/supabase/functions"
  local total
  total=$(find "$dir" -maxdepth 1 -mindepth 1 -type d ! -name '_*' | wc -l | tr -d ' ')
  echo "deployable functions (excluding _shared): $total"
  find "$dir" -maxdepth 1 -mindepth 1 -type d ! -name '_*' -exec basename {} \; | sort | paste -sd' ' -
  echo
  echo "--- explicit verify_jwt overrides in supabase/config.toml ---"
  if grep -n -B3 'verify_jwt' "$REPO_ROOT/supabase/config.toml" 2>/dev/null; then :; else
    echo "(none: every function inherits the default verify_jwt = true)"
  fi
  cat <<'NOTE'
READ THIS: state coverage as "N of TOTAL functions reviewed" so a partial pass cannot read as
a full one. verify_jwt = true only proves SOME valid JWT was presented. It does NOT check
whose. A function that then trusts a userId/houseId from the request body is still a confused
deputy, and that is the thing to grep each function body for.
NOTE
}

# 9. The pgTAP convention that hid the root cause for months: asserting only against the
# PUBLIC pseudo-role, which passes while anon and authenticated still hold EXECUTE.
granttests() {
  echo "=== [9] Grant assertions in pgTAP tests that do not name anon/authenticated ==="
  # Gate PER TARGET FUNCTION, not per file. A per-file gate passes a mixed file that asserts
  # anon/authenticated for function X while function Y in the same file is only ever checked
  # against 'public' -- and Y then has no real coverage while the file looks covered.
  node "$REPO_ROOT/scripts/security/grant-coverage.js" "$REPO_ROOT"
  cat <<'NOTE'
READ THIS: has_function_privilege('public', ...) = false PASSES while anon and authenticated
still hold EXECUTE, because Supabase grants them explicitly at CREATE time. Every WEAK target
above has no real grant coverage no matter how many assertions surround it. A `<dynamic: file>`
key is a catalog-loop assertion whose target cannot be resolved statically: open that file and
judge it by hand rather than assuming either way.
NOTE
}

case "$SECTION" in
  definers) definers ;;
  noauthz) noauthz ;;
  views) views ;;
  rls) rls ;;
  writes) writes ;;
  policies) policies ;;
  searchpath) searchpath ;;
  edge) edge ;;
  granttests) granttests ;;
  all) for s in definers noauthz views rls writes policies searchpath edge granttests; do
         "$s"; echo; done ;;
  *) echo "unknown section: $SECTION" >&2
     echo "want: definers|noauthz|views|rls|writes|policies|searchpath|edge|granttests|all" >&2
     exit 2 ;;
esac
