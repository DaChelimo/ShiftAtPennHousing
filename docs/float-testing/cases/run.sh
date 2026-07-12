#!/usr/bin/env bash
# ============================================================================
# Float / Escalation edge-case scenario loader   (LOCAL Supabase only)
#
#   docs/float-testing/cases/run.sh <case> [--tick] [--reset]
#
# Stages ONE edge case from the Notion "Float/Escalation Edge Case Test Matrix"
# in a single command: it clears transient float state, crews the houses,
# carves the exact gap, and parks the simulated clock at the step-fire moment,
# then prints who to log in as and what to click. You never hand-build shifts
# or fiddle the clock.
#
#   <case>   01 02 03 04 05 06 07a 07b 08 09 10 11 12   (see the matrix below)
#   --tick   also fire the orchestrator once and print the DB outcome
#            (no-click self-verify; otherwise you click "Run orchestrator now")
#   --reset  run setup.sql first (rebuild source crews / rotor / silence
#            placeholders) before staging the case
#
# Idempotent: each case owns its own date, so re-running a case (or a different
# case) always lands in the same clean state. Prerequisite once per DB:
#   pnpm db:reset:manual   (creates the 3 houses + period + blocks)
#
# Notion: https://app.notion.com/p/390575b722ec8174b0b5e32a50d14683
# ============================================================================
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
FUNC_URL="${FUNCTIONS_URL:-http://127.0.0.1:54321/functions/v1}"
# Local supabase demo service-role key (constant across local stacks; override
# with SERVICE_ROLE_KEY if yours differs).
SRK="${SERVICE_ROLE_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU}"

CASE="${1:-}"; shift || true
DO_TICK=0; DO_RESET=0
for a in "$@"; do
  case "$a" in
    --tick) DO_TICK=1 ;;
    --reset) DO_RESET=1 ;;
    *) echo "unknown flag: $a" >&2; exit 2 ;;
  esac
done

pq()   { psql "$DB" -v ON_ERROR_STOP=1 -P pager=off -q "$@"; }
psh()  { psql "$DB" -P pager=off -c "$1"; }                  # show (pretty)
tick() { curl -s -X POST "$FUNC_URL/orchestrator-tick" -H "Authorization: Bearer $SRK" -H "Content-Type: application/json" -d '{}'; echo; }

line() { printf '%s\n' "----------------------------------------------------------------------"; }
banner() { line; printf '  CASE %s — %s\n' "$CASE" "$1"; line; }

ensure_helpers() { pq -f "$DIR/_helpers.sql"; }

[ -z "$CASE" ] && { grep -E '^#( |=)' "$0" | sed 's/^# \{0,1\}//'; exit 0; }

if [ "$DO_RESET" = 1 ]; then
  echo "» running setup.sql (rebuild sources / rotor / silence placeholders)"
  pq -f "$DIR/../setup.sql" >/dev/null
fi
ensure_helpers >/dev/null

# --- shared outcome dump (used by --tick) ----------------------------------
show_floats() {
  psh "select split_part(u.email,'@',1) as floater,
              (select b.house_id from shift_block_assignments da
                 join shift_blocks b on b.block_id=da.block_id
                where da.assignment_id = fa.destination_assignment_ids[1]) as dest_house,
              array_length(fa.destination_assignment_ids,1) as blocks, fa.status
       from float_assignments fa join users u on u.user_id=fa.user_id
       order by fa.created_at;"
}
show_allied() {
  psh "select split_part(u.email,'@',1) as recipient, n.type, (n.payload->>'kind') as kind
       from notifications n join users u on u.user_id=n.recipient_user_id
       where n.type='hmod_urgent' order by n.created_at desc limit 10;"
}

case "$CASE" in

# ============================================================================
01) banner "Happy float (DuBois <- Quad)"
  pq <<SQL
select ft_clear();
select ft_rotor_set('2026-06-25','hana-quad@upenn.edu');
select ft_crew('dubois','2026-06-25','08:00','24:00',1);   -- destination covered all day
select ft_vacate('dubois','2026-06-25','20:00','22:00');   -- carve the 2h empty gap
select ft_park('2026-06-25 18:00:00-04');                  -- T-2h (float_lookup fires)
SQL
  cat <<'TXT'
  Setup   : DuBois empty 8:00-10:00 PM Thu Jun 25; Quad fully crewed (3).
  Clock   : parked at 6:00 PM (T-2h) — one tick assigns the float.
  Log in  : web as hana-dubois ; phone as the Quad floater (alice-quad).
  Click   : web Coverage -> "Run orchestrator now" -> a Quad worker shows
            pending on the DuBois gap. Phone: More>Updates -> Acknowledge.
  Expect  : Quad's spare floats the full 2h; Quad stays >=1 present; the
            floater's vacated Quad seat reopens for voluntary pickup.
TXT
  ;;

# ============================================================================
02) banner "Sub-hour spare (CURRENT code: single block absorbed, not rejected)"
  pq <<SQL
select ft_clear();
select ft_rotor_set('2026-06-26','hana-quad@upenn.edu');
select ft_crew('dubois','2026-06-26','08:00','24:00',1);
select ft_vacate('dubois','2026-06-26','20:00','22:00');
select ft_crew('quad','2026-06-26','08:00','24:00',1);       -- Quad at floor (no spare)
select ft_add_worker('quad','2026-06-26','20:00','20:30',2);  -- ...except one spare 8:00-8:30
select ft_crew('harnwell','2026-06-26','08:00','24:00',1);    -- Harnwell no spare -> remainder to Allied
select ft_park('2026-06-26 18:00:00-04');
SQL
  cat <<'TXT'
  Setup   : DuBois empty 8-10 PM; Quad sparable ONLY 8:00-8:30 PM (1 block);
            Harnwell has no spare.
  Clock   : parked at 6:00 PM (T-2h).
  NOTE    : The Notion page says "no float -> Allied" (old 2-block floor).
            Current code has MIN_FLOAT_CHUNK_BLOCKS=1, so the single sparable
            block IS floated and only the remainder escalates. This case
            asserts the CURRENT behavior (per your decision).
  Expect  : 8:00-8:30 floated from Quad; 8:30-10:00 escalates to Allied.
TXT
  ;;

# ============================================================================
03) banner "Coverage floor (>=1 present -> no escalation)"
  pq <<SQL
select ft_clear();
select ft_rotor_set('2026-06-29','hana-quad@upenn.edu');
select ft_crew('dubois','2026-06-29','08:00','24:00',1);   -- keep DuBois covered (no noise)
select ft_crew('quad','2026-06-29','08:00','24:00',2);     -- Quad 2 of 3 present: 1 seat short
select ft_park('2026-06-29 18:00:00-04');
SQL
  cat <<'TXT'
  Setup   : Quad has 2 of 3 present 8-10 PM (a multi-staff desk one short);
            DuBois fully covered.
  Clock   : parked at 6:00 PM.
  Expect  : NO escalation anywhere. Quad's desk isn't empty (>=1 present), so
            its short seat is passively claimable only, never floated/Allied.
            (Remapped from the page's "DuBois 2nd seat" — DuBois is single-staff.)
TXT
  ;;

# ============================================================================
04) banner "Harnwell training constraint (no inbound float -> Allied)"
  pq <<SQL
select ft_clear();
select ft_rotor_set('2026-06-30','hana-quad@upenn.edu');
select ft_crew('dubois','2026-06-30','08:00','24:00',1);    -- keep DuBois covered
select ft_crew('harnwell','2026-06-30','08:00','24:00',2);
select ft_vacate('harnwell','2026-06-30','20:00','22:00');  -- Harnwell desk empty
-- Quad stays fully crewed (3) from setup: has spare, but may NOT enter Harnwell.
select ft_park('2026-06-30 18:00:00-04');
SQL
  cat <<'TXT'
  Setup   : Harnwell desk empty 8-10 PM; Quad has spare capacity.
  Clock   : parked at 6:00 PM (T-2h).
  Expect  : No Quad (or any) worker floats INTO Harnwell (training ban). The
            Harnwell shortfall escalates straight to Allied.
TXT
  ;;

# ============================================================================
05) banner "Harnwell as source (outbound float allowed)"
  pq <<SQL
select ft_clear();
select ft_rotor_set('2026-07-01','hana-quad@upenn.edu');
select ft_crew('dubois','2026-07-01','08:00','24:00',1);
select ft_vacate('dubois','2026-07-01','20:00','22:00');
select ft_crew('quad','2026-07-01','08:00','24:00',1);   -- Quad at floor -> DuBois falls to Harnwell (p2)
-- Harnwell stays 2 from setup: 1 spare, floats OUT to DuBois.
select ft_park('2026-07-01 18:00:00-04');
SQL
  cat <<'TXT'
  Setup   : DuBois empty 8-10 PM; Quad has no spare (forces the p2 source);
            Harnwell double-staffed.
  Clock   : parked at 6:00 PM.
  Expect  : A HARNWELL worker floats OUT to DuBois (outbound from Harnwell is
            allowed; only inbound is banned).
TXT
  ;;

# ============================================================================
06) banner "Single-staff house can't source (INVARIANT — no live scenario)"
  cat <<'TXT'
  Single-staff houses (DuBois + lower-quad..13) are never float SOURCES. This is
  structural, not timing: there is no scenario to click. Two proofs below.
TXT
  echo "  (1) No single-staff house appears as a source in float_routing:"
  psh "select distinct source_house_id from float_routing order by 1;"
  echo "  (2) The 11 placeholder houses have no generated blocks to staff at all:"
  psh "select count(*) as placeholder_blocks from shift_blocks where house_id like 'house-%';"
  cat <<'TXT'
  So even over-staffed, a single-staff desk is never selected to float out; the
  ban is enforced by routing AND by the algorithm's source filter. Nothing to
  stage or tick.
TXT
  exit 0
  ;;

# ============================================================================
07a) banner "Recipient routing IN-HOURS -> RSM"
  pq <<SQL
select ft_clear();
select ft_rotor_set('2026-07-02','hana-quad@upenn.edu');
select ft_crew('dubois','2026-07-02','08:00','24:00',1);
select ft_vacate('dubois','2026-07-02','12:00','14:00');   -- midday gap
select ft_crew('quad','2026-07-02','08:00','24:00',1);      -- no source spare -> forces Allied
select ft_crew('harnwell','2026-07-02','08:00','24:00',1);
select ft_park('2026-07-02 10:00:00-04');                   -- Thu 10 AM = HM working hours
SQL
  cat <<'TXT'
  Setup   : DuBois empty 12-2 PM Thu; both sources unavailable -> Allied.
  Clock   : parked Thu 10:00 AM (inside Mon-Fri 8-5 HM hours).
  Log in  : web inbox as diana-dubois (the DuBois RSM).
  Expect  : the Allied/no-ack alert routes to the house RSM (diana-dubois),
            not the HMOD. (17:00 boundary is exact.)
TXT
  ;;

07b) banner "Recipient routing OFF-HOURS -> HMOD"
  pq <<SQL
select ft_clear();
select ft_rotor_set('2026-07-02','hana-quad@upenn.edu');
select ft_crew('dubois','2026-07-02','08:00','24:00',1);
select ft_vacate('dubois','2026-07-02','20:00','22:00');   -- evening gap
select ft_crew('quad','2026-07-02','08:00','24:00',1);
select ft_crew('harnwell','2026-07-02','08:00','24:00',1);
select ft_park('2026-07-02 18:00:00-04');                   -- 6 PM = outside HM hours
SQL
  cat <<'TXT'
  Setup   : DuBois empty 8-10 PM Thu; both sources unavailable -> Allied.
  Clock   : parked 6:00 PM (outside HM hours).
  Log in  : web inbox as hana-quad (the HMOD on duty this week).
  Expect  : the Allied alert routes to the HMOD-on-duty (hana-quad), not the RSM.
TXT
  ;;

# ============================================================================
08) banner "Dead-on-arrival guard (T-15m -> skip float, straight to Allied)"
  pq <<SQL
select ft_clear();
select ft_rotor_set('2026-07-06','hana-quad@upenn.edu');
select ft_crew('dubois','2026-07-06','08:00','24:00',1);
select ft_vacate('dubois','2026-07-06','20:00','20:30');   -- single block gap
-- Quad fully crewed (3): a floater EXISTS, but it's too late to use one.
select ft_park('2026-07-06 19:50:00-04');                   -- T-10m (block start still future, inside DOA window)
SQL
  cat <<'TXT'
  Setup   : DuBois empty 8:00-8:30 PM (one block); Quad has a floater available.
  Clock   : parked 8:20 PM = 10 min before the block (inside the T-15m DOA guard).
  Expect  : float lookup is SKIPPED (no doomed pending float created); the gap
            escalates straight to Allied.
TXT
  ;;

# ============================================================================
09) banner "No-ack -> void + Allied (two-phase, pre-armed)"
  pq <<SQL
select ft_clear();
select ft_rotor_set('2026-07-07','hana-quad@upenn.edu');
select ft_crew('dubois','2026-07-07','08:00','24:00',1);
select ft_vacate('dubois','2026-07-07','20:00','22:00');
select ft_park('2026-07-07 18:00:00-04');                   -- phase 1: T-2h
SQL
  echo "» phase 1 tick: assigning the pending float (nobody will ack it)"
  tick >/dev/null
  pq -c "select ft_park('2026-07-07 19:45:00-04');" >/dev/null   # phase 2: T-15m (no-ack window)
  cat <<'TXT'
  Setup   : DuBois empty 8-10 PM; a Quad float was assigned and left UN-acked.
  Clock   : now parked 7:45 PM (the no-ack window). One more tick voids it.
  Log in  : web Coverage as hana-dubois ; inbox as hana-quad (off-hours HMOD).
  Click   : "Run orchestrator now" -> the float voids and the gap goes to Allied.
  Expect  : float_no_acknowledgment void; gap escalates to Allied; that worker
            is temporarily excluded from re-floating.
TXT
  ;;

# ============================================================================
10) banner "One-way coverage lock (locked desk stays locked when re-staffed)"
  pq <<SQL
select ft_clear();
select ft_rotor_set('2026-07-08','hana-quad@upenn.edu');
select ft_crew('dubois','2026-07-08','08:00','24:00',1);
select ft_vacate('dubois','2026-07-08','20:00','22:00');
select ft_crew('quad','2026-07-08','08:00','24:00',1);      -- no float source -> desk truly locks at T-2h
select ft_crew('harnwell','2026-07-08','08:00','24:00',1);
select ft_park('2026-07-08 18:00:00-04');                   -- T-2h: the lock step
SQL
  echo "» arming: tick at T-2h so the empty desk passes its lock step"
  tick >/dev/null
  echo "» simulating coverage returning: re-staffing the DuBois seat"
  pq -c "select ft_crew('dubois','2026-07-08','20:00','22:00',1);" >/dev/null
  cat <<'TXT'
  Setup   : an empty DuBois desk passed its T-2h lock, then got staffed again.
  Expect  : the block's coverage_locked_at stays set and the open-shifts feed
            still reports it locked / not claimable — coverage returning does
            NOT reopen it to voluntary pickup (one-way lock, BSpec §5.5).
  Verify  : the query below should show coverage_locked_at NOT NULL.
TXT
  psh "select (b.block_start_at at time zone 'America/New_York')::time t,
              b.coverage_locked_at is not null as locked
       from shift_blocks b
       where b.house_id='dubois' and (b.block_start_at at time zone 'America/New_York')::date='2026-07-08'
         and (b.block_start_at at time zone 'America/New_York')::time between '20:00' and '21:30' order by t;"
  exit 0
  ;;

# ============================================================================
11) banner "Concurrent demand, one shared source (ADVANCED)"
  cat <<'TXT'
  This case needs TWO block-having destinations that both draw from the SAME
  single-spare source. In the manual-test seed the only block-having Quad
  destination is DuBois (placeholder houses have no blocks), so a faithful
  two-gap/one-source scenario can't be staged without generating blocks for a
  second house first. Left as a documented caveat rather than a click-through.

  The behavior under test (from the code): within ONE tick, gaps are resolved
  in block-start order and the earliest-start destination wins the shared
  floater deterministically; the loser escalates to Allied. Cross-gap floater
  reservation is NOT coordinated in-tick, so the same worker can be *offered*
  to two gaps in a single tick before one commits. See CASES.md for the manual
  block-generation recipe if you want to stage it live.
TXT
  exit 0
  ;;

# ============================================================================
12) banner "Terminal fallback (empty rotor + no RSM -> project_administrator)"
  ADMIN_EMAIL="${ADMIN_EMAIL:-hana-dubois@upenn.edu}"
  pq <<SQL
select ft_clear();
select ft_rotor_clear('2026-07-10');                        -- no HMOD on duty
select ft_crew('dubois','2026-07-10','08:00','24:00',1);
select ft_vacate('dubois','2026-07-10','20:00','22:00');
select ft_crew('quad','2026-07-10','08:00','24:00',1);       -- no source -> Allied
select ft_crew('harnwell','2026-07-10','08:00','24:00',1);
-- point the terminal contact at an admin user (unset it to test the WARNING path)
insert into system_config (config_key, config_value, value_type)
select 'project_administrator_user_id', u.user_id::text, 'uuid' from users u where u.email = '$ADMIN_EMAIL'
on conflict (config_key) do update set config_value = excluded.config_value, value_type = 'uuid';
select ft_park('2026-07-10 18:00:00-04');
SQL
  cat <<TXT
  Setup   : off-hours DuBois gap; sources unavailable; HMOD rotor EMPTY for the
            week; project_administrator_user_id -> $ADMIN_EMAIL.
  Clock   : parked 6:00 PM.
  Log in  : web inbox as $ADMIN_EMAIL.
  Expect  : the urgent alert routes to project_administrator_user_id. If you
            instead UNSET it (delete the system_config row), the tick logs a
            RAISE WARNING and creates NO hmod_urgent row (check function logs).
TXT
  ;;

*) echo "unknown case: '$CASE'  (try: 01 02 03 04 05 06 07a 07b 08 09 10 11 12)"; exit 2 ;;
esac

echo
echo "» staged. app_now() is now:"
psh "select app_now();"

if [ "$DO_TICK" = 1 ]; then
  echo "» --tick: firing orchestrator once"
  tick
  echo "» floats:";  show_floats
  echo "» Allied/urgent alerts:"; show_allied
else
  echo "» (add --tick to fire the orchestrator here and print the outcome, or"
  echo "   click \"Run orchestrator now\" in the web dev-clock card.)"
fi
