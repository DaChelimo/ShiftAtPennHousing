#!/usr/bin/env bash
# Two-session race harness for the 2026-07-26 concurrency audit remediation
# (migrations 20260726000009 / 000010 / 000011).
#
# WHY THIS EXISTS. Four of the ten audit findings are fixed by holding a row lock across
# two statements. A lock is only observable when something contends for it, so pgTAP
# cannot show any of them: it runs in ONE session. supabase/tests/concurrency-audit-guards.sql
# covers everything that IS single-session observable (the new constraint, the new return
# value, the new guard predicates); this covers the rest by driving two real psql sessions
# and forcing the interleaving with pg_sleep inside an open transaction.
#
#   F1  drop_shift          a drop must not vacate a seat that changed hands under it
#   F2  accept_swap         an accept must not overwrite a seat that changed hands under it
#   F3  admin_assign_worker two admins on one multi-staff block must not collide on one seat
#   F8  claim_open_shift    one worker's two simultaneous claims must not double-book them
#
# Each test asserts the OUTCOME (who ends up holding the seat), not the error text, so it
# stays honest if the error vocabulary changes.
#
# Fixtures are committed (they have to be: two sessions cannot see each other's open
# transaction) under the dad00000-* uuid space, and torn down by EXACT PRIMARY KEY in the
# trap below -- never by a reconstructed "should be equivalent" filter. See AGENTS.md,
# "Ad-hoc DELETE/UPDATE against the DB: scope-check before you run it."
#
# Usage:  scripts/concurrency/race-harness.sh
# Needs:  a running local Supabase (supabase start). Never point this at production.

set -uo pipefail

DB="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
PASS=0
FAIL=0

q()  { psql "$DB" -tAX -q -c "$1" 2>&1; }
run() { psql "$DB" -tAX -q -c "$1" >/dev/null 2>&1; }

assert_eq() { # expected actual label
  if [[ "$1" == "$2" ]]; then
    printf '  ok   %s\n' "$3"; PASS=$((PASS + 1))
  else
    printf '  FAIL %s\n         expected: %s\n         actual:   %s\n' "$3" "$1" "$2"; FAIL=$((FAIL + 1))
  fi
}

# ── uuid space ───────────────────────────────────────────────────────────────
U_A='dad00001-0000-4000-8000-00000000000a'   # owner / claimer
U_B='dad00001-0000-4000-8000-00000000000b'   # counterparty / second admin target
U_C='dad00001-0000-4000-8000-00000000000c'   # the racer who takes the seat
U_OP='dad00001-0000-4000-8000-0000000000f0'  # the operating SM

B_DROP='dad00002-0000-4000-8000-000000000001'
B_SWAP='dad00002-0000-4000-8000-000000000002'
B_ADMIN='dad00002-0000-4000-8000-000000000003'
B_CLAIM1='dad00002-0000-4000-8000-000000000004'
B_CLAIM2='dad00002-0000-4000-8000-000000000005'

S_DROP='dad00003-0000-4000-8000-000000000001'
S_SWAP='dad00003-0000-4000-8000-000000000002'
S_ADMIN1='dad00003-0000-4000-8000-000000000031'
S_ADMIN2='dad00003-0000-4000-8000-000000000032'
S_CLAIM1='dad00003-0000-4000-8000-000000000041'
S_CLAIM2='dad00003-0000-4000-8000-000000000051'

SWAP_ID='dad00005-0000-4000-8000-000000000001'

cleanup() {
  # Delete by exact PK, children before parents. Never a broad filter.
  run "DELETE FROM swap_requests WHERE swap_id = '$SWAP_ID';"
  run "DELETE FROM shift_block_assignments WHERE assignment_id IN
       ('$S_DROP','$S_SWAP','$S_ADMIN1','$S_ADMIN2','$S_CLAIM1','$S_CLAIM2');"
  run "DELETE FROM block_step_status WHERE block_id IN
       ('$B_DROP','$B_SWAP','$B_ADMIN','$B_CLAIM1','$B_CLAIM2');"
  run "DELETE FROM shift_blocks WHERE block_id IN
       ('$B_DROP','$B_SWAP','$B_ADMIN','$B_CLAIM1','$B_CLAIM2');"
  run "DELETE FROM user_roles WHERE user_id IN ('$U_A','$U_B','$U_C','$U_OP');"
  run "DELETE FROM public.users WHERE user_id IN ('$U_A','$U_B','$U_C','$U_OP');"
  run "DELETE FROM auth.users WHERE id IN ('$U_A','$U_B','$U_C','$U_OP');"
}
trap cleanup EXIT

echo "=== concurrency race harness (audit F1, F2, F3, F8) ==="
cleanup   # in case a previous aborted run left rows behind

# ── fixtures ─────────────────────────────────────────────────────────────────
# 2029 dates: outside every seeded calendar, so nothing here collides with real data.
run "
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('$U_A','00000000-0000-0000-0000-000000000000','authenticated','authenticated','dad-a@test.local'),
  ('$U_B','00000000-0000-0000-0000-000000000000','authenticated','authenticated','dad-b@test.local'),
  ('$U_C','00000000-0000-0000-0000-000000000000','authenticated','authenticated','dad-c@test.local'),
  ('$U_OP','00000000-0000-0000-0000-000000000000','authenticated','authenticated','dad-op@test.local');

INSERT INTO public.users (user_id, name, email, home_house_id, is_active) VALUES
  ('$U_A','RA A','dad-a@test.local','quad',true),
  ('$U_B','RA B','dad-b@test.local','quad',true),
  ('$U_C','RA C','dad-c@test.local','quad',true),
  ('$U_OP','RA OP','dad-op@test.local','quad',true);

INSERT INTO public.user_roles (user_id, role, scope_house_id) VALUES ('$U_OP','sm','quad');

INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount) VALUES
  ('$B_DROP','quad',   ('2029-11-16 09:00'::timestamp AT TIME ZONE 'America/New_York'), 1),
  ('$B_SWAP','quad',   ('2029-11-16 10:00'::timestamp AT TIME ZONE 'America/New_York'), 1),
  ('$B_ADMIN','quad',  ('2029-11-16 11:00'::timestamp AT TIME ZONE 'America/New_York'), 2),
  -- Two houses, SAME start instant: the shape that double-books one worker.
  ('$B_CLAIM1','quad',    ('2029-11-16 12:00'::timestamp AT TIME ZONE 'America/New_York'), 1),
  ('$B_CLAIM2','harrison',('2029-11-16 12:00'::timestamp AT TIME ZONE 'America/New_York'), 1);

INSERT INTO public.shift_block_assignments (assignment_id, block_id, user_id, status, vacancy_origin) VALUES
  ('$S_DROP','$B_DROP','$U_A','scheduled','none'),
  ('$S_SWAP','$B_SWAP','$U_A','scheduled','none'),
  ('$S_ADMIN1','$B_ADMIN',NULL,'vacant','never_assigned'),
  ('$S_ADMIN2','$B_ADMIN',NULL,'vacant','never_assigned'),
  ('$S_CLAIM1','$B_CLAIM1',NULL,'vacant','temporary_drop'),
  ('$S_CLAIM2','$B_CLAIM2',NULL,'vacant','temporary_drop');
"

# =============================================================================
# F1 -- a drop must not vacate a seat that changed hands under it.
#
# Session 1 hands A's seat to C (an accepted swap / an admin reassignment) and holds the
# transaction open. Session 2 starts a drop for A one second later, while session 1 is
# still uncommitted, so the ownership check would read the PRE-race owner. Before the fix,
# the vacate ran `WHERE assignment_id = ANY(...)` with no predicate at all and wiped C's
# seat; the drop lock plus the compare-and-swap now make it a clean refusal.
# =============================================================================
echo "F1 drop_shift vs a concurrent reassignment"
( run "BEGIN; UPDATE shift_block_assignments SET user_id='$U_C', status='claimed'
       WHERE assignment_id='$S_DROP'; SELECT pg_sleep(3); COMMIT;" ) &
sleep 1
DROP_OUT=$(q "SELECT drop_shift(ARRAY['$S_DROP']::uuid[], '$U_A'::uuid, now());")
wait

assert_eq "claimed|$U_C" "$(q "SELECT status||'|'||user_id FROM shift_block_assignments WHERE assignment_id='$S_DROP';")" \
  "F1: the seat still belongs to the worker who actually took it"
assert_eq "yes" "$(grep -qi 'drop_not_owned' <<<"$DROP_OUT" && echo yes || echo no)" \
  "F1: the losing drop is refused loudly (drop_not_owned), not silently applied"

# =============================================================================
# F2 -- an accept must not overwrite a seat that changed hands under it.
#
# Note the racer changes ONLY user_id, leaving status alone: that is deliberate, because
# void_pending_swaps_for_vacated_seat fires on a status TRANSITION, so this is exactly the
# mutation the swap-voiding trigger is blind to. It is the pure form of the bug.
# =============================================================================
echo "F2 accept_swap vs a concurrent reassignment"
run "INSERT INTO swap_requests (swap_id, initiator_user_id, counterparty_user_id, swap_type,
       status, initiator_assignment_ids, counterparty_assignment_ids, expires_at)
     VALUES ('$SWAP_ID','$U_A','$U_B','handoff','pending',
       ARRAY['$S_SWAP']::uuid[], ARRAY[]::uuid[], '2029-12-01 00:00'::timestamptz);"

( run "BEGIN; UPDATE shift_block_assignments SET user_id='$U_C'
       WHERE assignment_id='$S_SWAP'; SELECT pg_sleep(3); COMMIT;" ) &
sleep 1
SWAP_OUT=$(q "SELECT accept_swap('$SWAP_ID'::uuid, '$U_B'::uuid, now());")
wait

assert_eq "$U_C" "$(q "SELECT user_id FROM shift_block_assignments WHERE assignment_id='$S_SWAP';")" \
  "F2: the seat still belongs to the worker who actually took it"
assert_eq "yes" "$(grep -qi 'span_invalidated' <<<"$SWAP_OUT" && echo yes || echo no)" \
  "F2: the accept reports span_invalidated instead of a false success"
assert_eq "voided" "$(q "SELECT status FROM swap_requests WHERE swap_id='$SWAP_ID';")" \
  "F2: and the swap is voided rather than left pending"

# =============================================================================
# F3 -- two admins assigning two different workers to one multi-staff block.
#
# The block has TWO free seats, so the correct outcome is that BOTH assignments land, one
# per seat. Before the fix both admins' unlocked DISTINCT ON picked the same (lowest)
# assignment_id and the second silently overwrote the first, while both were told
# assigned_count = 1.
# =============================================================================
echo "F3 two admins assigning onto one multi-staff block"
( run "BEGIN; SELECT admin_assign_worker('$U_OP'::uuid, ARRAY['$B_ADMIN']::uuid[], '$U_A'::uuid,
       'this_week', true, '2029-11-16 08:00'::timestamptz); SELECT pg_sleep(3); COMMIT;" ) &
sleep 1
q "SELECT admin_assign_worker('$U_OP'::uuid, ARRAY['$B_ADMIN']::uuid[], '$U_B'::uuid,
   'this_week', true, '2029-11-16 08:00'::timestamptz);" >/dev/null
wait

assert_eq "2" "$(q "SELECT count(DISTINCT user_id) FROM shift_block_assignments
                    WHERE block_id='$B_ADMIN' AND status IN ('scheduled','claimed');")" \
  "F3: both admins' workers land, one per seat (neither assignment is lost)"

# =============================================================================
# F8 -- one worker firing two claims at the same instant, for two different houses at the
# SAME block start. Exactly one may land; the other must be refused as a time conflict.
# =============================================================================
#
# Unlike F1-F3, this race cannot be staged with a sleeping transaction: both sides are the
# SAME rpc and neither can be paused from outside. Two psql processes launched with `&`
# do not reliably overlap either -- process startup jitter is larger than the window, and
# the harness silently passes for the wrong reason (verified: it did).
#
# So both sessions spin up first and then busy-wait on a shared wall-clock barrier inside
# the server, which puts their claims microseconds apart. Repeated ROUNDS times because
# one scheduling fluke would otherwise read as a pass; the assertion is over the WORST
# round, not the last.
echo "F8 one worker, two simultaneous claims at the same block start"
ROUNDS=5
WORST=0
SAW_CONFLICT=no
for _ in $(seq "$ROUNDS"); do
  run "UPDATE shift_block_assignments SET user_id=NULL, status='vacant', vacancy_origin='temporary_drop',
       is_cross_house_pickup=false, source_house_id=NULL
       WHERE assignment_id IN ('$S_CLAIM1','$S_CLAIM2');"
  BARRIER=$(q "SELECT (clock_timestamp() + interval '2 seconds')::text;")
  OUT1=$(mktemp); OUT2=$(mktemp)
  ( q "SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM (TIMESTAMPTZ '$BARRIER' - clock_timestamp()))));
       SELECT claim_open_shift('$S_CLAIM1'::uuid, '$U_A'::uuid, '2029-11-16 08:00'::timestamptz);" >"$OUT1" ) &
  ( q "SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM (TIMESTAMPTZ '$BARRIER' - clock_timestamp()))));
       SELECT claim_open_shift('$S_CLAIM2'::uuid, '$U_A'::uuid, '2029-11-16 08:00'::timestamptz);" >"$OUT2" ) &
  wait
  HELD=$(q "SELECT count(*) FROM shift_block_assignments sba JOIN shift_blocks sb USING (block_id)
            WHERE sba.user_id='$U_A' AND sba.status IN ('scheduled','claimed')
              AND sb.block_start_at = ('2029-11-16 12:00'::timestamp AT TIME ZONE 'America/New_York');")
  [[ "$HELD" -gt "$WORST" ]] && WORST=$HELD
  grep -qi 'time_conflict' "$OUT1" "$OUT2" && SAW_CONFLICT=yes
  rm -f "$OUT1" "$OUT2"
done

assert_eq "1" "$WORST" \
  "F8: across $ROUNDS synchronised rounds the worker never holds two seats at one instant"
assert_eq "yes" "$SAW_CONFLICT" \
  "F8: the losing claim is refused with time_conflict"

echo
echo "=== $PASS passed, $FAIL failed ==="
[[ $FAIL -eq 0 ]]
