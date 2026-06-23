# Float & Escalation — Manual Testing Guide

How to manually reproduce and verify every float / escalation behaviour on the
**local** stack, using the dev sim-clock + the "Run orchestrator now" control.

All times are **America/New_York**. In summer NY is EDT (UTC−4), so the SQL
timestamps below use the `-04` suffix. Use **regular-school-year dates** for
floats — `2026-06-25` onward. (`2026-06-23/24` are `short_break` in the seed, and
`short_break` has _no_ float routing into DuBois, so floats there go straight to
HMOD — that is correct, just not what most of these scenarios test.)

---

## 1. The model (read this once)

**Float routing (regular school year)** — who can cover whose gap:

| Gap in…                | Floater pulled from (in order)                                           |
| ---------------------- | ------------------------------------------------------------------------ |
| **DuBois** (1/block)   | **Quad** (1st choice) → **Harnwell** (2nd)                               |
| **Quad** (3/block)     | **Harnwell**                                                             |
| **Harnwell** (2/block) | _nobody_ — training rule: only Harnwell staff may work the Harnwell desk |

A house can spare `(workers present − 1)` floaters per pass: Quad (3) spares 2,
Harnwell (2) spares 1. A floater's existing shift is **relocated** (their home seat
goes `pending_float_out`); their weekly hours don't change.

**Escalation timeline** for a vacant block starting at `T` (regular school year):

| Offset    | Step               | What happens                                              |
| --------- | ------------------ | --------------------------------------------------------- |
| `T − 3h`  | broadcast          | notify broadcast-subscribed workers at the gap house      |
| `T − 2h`  | **float_lookup**   | run the algorithm, assign a floater (`pending`)           |
| `T − 2h`  | hmod_notify_allied | **only if** float_lookup found nobody → route to HMOD/RSM |
| `T − 10m` | ack deadline       | floater must have acknowledged by now                     |
| `T − 15m` | no-ack sweep       | a still-unacknowledged float is **voided** + re-escalated |

**Time-of-day routing** of the Allied / no-ack escalation (BSpec §10.1):

- **In-hours** (Mon–Fri 08:00–17:00 NY) → the gap house's **RSM**.
- **Off-hours** (evenings / weekends) → the **HMOD on duty** (the `hmod_rotor`).

**The cast** (manual-test seed, password `abc123` for all `@upenn.edu`):

| Who                              | DuBois                     | Quad                | Harnwell           |
| -------------------------------- | -------------------------- | ------------------- | ------------------ |
| Source crew (set by `setup.sql`) | published worker per block | alice/ben/cara-quad | alice/ben-harnwell |
| SM                               | sam-dubois                 | sam-quad            | sam-harnwell       |
| HM                               | hana-dubois                | hana-quad           | hana-harnwell      |
| RSM                              | diana-dubois               | diana-quad          | diana-harnwell     |

`hana-quad` is the **HMOD on duty** for the test weeks (set by `setup.sql`).

---

## 2. One-time setup

```bash
# from the repo root, with the local stack running (supabase start)
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f docs/float-testing/setup.sql
```

This crews Quad + Harnwell contiguously, sets the HMOD rotor, silences the 11
placeholder houses, and clears any stale float state. **Idempotent** — re-run it
any time to get back to a clean baseline. (It does not change DuBois, which the
seed already publishes; DuBois drops are restored to their recurring owner on
re-run / `reset.sql`.)

> Prerequisite: the manual-test seed must be loaded — `pnpm db:reset:manual`.
> Note: `setup.sql` overwrites the period's **Quad/Harnwell** schedule with the
> deterministic test crews (any prior publish/claims for those two houses is
> replaced). DuBois is left as-is.

---

## 3. The test loop (every scenario is a variation of this)

1. **Make a gap** — drop a scheduled worker's shift (`drop_shift`).
2. **Set the sim clock** to a step boundary (web dev-clock card, or SQL below).
3. **Run the orchestrator** — the **"Run orchestrator now"** button on the web
   dev-clock card (top bar), or the curl below.
4. **Inspect** — DB queries / web Coverage + Inbox / the worker phone.
5. **Act** — acknowledge / decline (worker), force-trigger (SM), resolve (HMOD).
6. **Reset** — `reset.sql` between scenarios.

### Copy-paste helpers

```bash
# Shell shortcuts (paste once per terminal)
PSQL() { PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -tAc "$1"; }
SR="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
ANON="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"

# Set the sim clock to an instant (NY/EDT)
setclock() { PSQL "update dev_sim_clock set offset_seconds = extract(epoch from ('$1'::timestamptz - now())) where id;"; }
#   e.g.  setclock '2026-06-25 12:01:00-04'

# Run the orchestrator once (same as the web button)
tick() { curl -s -X POST 'http://127.0.0.1:54321/functions/v1/orchestrator-tick' -H "Authorization: Bearer $SR" -H "apikey: $SR" -d '{}'; echo; }

# Worker action via the real Edge Function (derives the user from their JWT)
worker_token() { curl -s -X POST "http://127.0.0.1:54321/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"abc123\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])'; }
ack()     { curl -s -X POST 'http://127.0.0.1:54321/functions/v1/acknowledge-float' -H "Authorization: Bearer $(worker_token $1)" -H "apikey: $ANON" -H 'Content-Type: application/json' -d "{\"float_id\":\"$2\"}"; echo; }
decline() { curl -s -X POST 'http://127.0.0.1:54321/functions/v1/decline-float'    -H "Authorization: Bearer $(worker_token $1)" -H "apikey: $ANON" -H 'Content-Type: application/json' -d "{\"float_id\":\"$2\"}"; echo; }
```

### Find a gap's blocks, and drop them

```bash
# Show the DuBois worker + assignment ids for a 90-min window on a chosen date:
PSQL "select to_char(b.block_start_at at time zone 'America/New_York','Dy HH24:MI') ny,
             a.assignment_id, u.email
      from shift_block_assignments a join shift_blocks b on b.block_id=a.block_id
      join users u on u.user_id=a.user_id
      where b.house_id='dubois' and a.status='scheduled'
        and b.block_start_at at time zone 'America/New_York' >= '2026-06-25 14:00'
        and b.block_start_at at time zone 'America/New_York' <  '2026-06-25 15:30'
      order by b.block_start_at;"

# Drop that worker's window (pass the 4 ids + the worker + an as_of well BEFORE the shift):
PSQL "select * from drop_shift(
        ARRAY['<id1>','<id2>','<id3>','<id4>']::uuid[],
        (select user_id from users where email='<worker>@upenn.edu'),
        '2026-06-25 08:00:00-04'::timestamptz);"
```

> Tip: `drop_shift` refuses to drop a block that has already started, and returns
> `direct_hmod_notification = true` if it drops within 2h of the shift (which fires
> an immediate HMOD alert instead of the normal chain). Use an `as_of` several
> hours before the shift to exercise the full chain.

### Drive the chain (two ticks: broadcast, then float)

```bash
setclock '2026-06-25 11:01:00-04'; tick   # T-3h: broadcast fires
setclock '2026-06-25 12:01:00-04'; tick   # T-2h: float_lookup assigns a floater
```

The orchestrator fires only the _latest-reached_ unfired step per tick, so step
into each boundary on its own tick (this mirrors the once-a-minute cron). To watch
the **no-ack** sweep, add a later tick past `T − 15m` (see Scenario H).

### Inspect the result

```bash
# Who got floated where (latest float)
PSQL "select u.email floater, u.home_house_id source, f.status,
             (select b.house_id from shift_block_assignments a join shift_blocks b on b.block_id=a.block_id
              where a.assignment_id=f.destination_assignment_ids[1]) dest_house,
             f.initiated_by
      from float_assignments f join users u on u.user_id=f.user_id
      order by f.created_at desc limit 5;"

# Allied / HMOD escalations and who they went to
PSQL "select u.email recipient,
             (select string_agg(r.role::text,',') from user_roles r where r.user_id=n.recipient_user_id) roles,
             (n.payload->>'house_id') house
      from notifications n join users u on u.user_id=n.recipient_user_id
      where n.type='hmod_urgent' order by n.created_at desc limit 5;"
```

Or open the **web app** (logged in as an SM/HM): **Coverage** shows the gap + its
escalation chip + any pending floater; **Action inbox** shows `hmod_urgent` alerts.

### Reset between scenarios

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f docs/float-testing/reset.sql
```

---

## 4. Source / topology scenarios

For each: make a **DuBois** gap (unless noted), then run the two ticks. The
difference is which sources are available.

### A — DuBois needs a floater, Quad has one → Quad covers

- Setup: drop a DuBois worker's window. (Quad crew is available by default.)
- Run broadcast + float ticks.
- **Expect:** a float to a **Quad** worker (alice/ben/cara-quad), DuBois seats
  `pending_float_in`, that Quad worker's Quad seats `pending_float_out`.

### B — Quad has nobody, Harnwell needed → Harnwell covers (2nd choice)

- Make Quad unavailable for that window by **excluding the Quad crew** (this is
  exactly what happens after they decline / no-ack):
  ```bash
  PSQL "insert into float_exclusions (user_id, window_start_at, window_end_at, destination_house_id, reason, excluded_at)
        select u.user_id, '2026-06-25 14:00:00-04','2026-06-25 16:00:00-04','dubois','no_acknowledgment', now()
        from users u where u.email in ('alice-quad@upenn.edu','ben-quad@upenn.edu','cara-quad@upenn.edu');"
  ```
  (Alternative lever: temporarily delete the `quad→dubois` row from `float_routing`.)
- Drop a DuBois worker, run the ticks.
- **Expect:** a float to a **Harnwell** worker (alice/ben-harnwell).

### C — Both Quad and Harnwell have floaters → Quad covers (precedence 1)

- Both crews available (default). Drop a DuBois worker, run the ticks.
- **Expect:** a **Quad** floater (Quad is preferred over Harnwell for DuBois).

### D — Nobody available → Allied escalation (no float)

- Exclude **both** crews for the window:
  ```bash
  PSQL "insert into float_exclusions (user_id, window_start_at, window_end_at, destination_house_id, reason, excluded_at)
        select u.user_id, '2026-06-25 14:00:00-04','2026-06-25 16:00:00-04','dubois','no_acknowledgment', now()
        from users u where u.email in ('alice-quad@upenn.edu','ben-quad@upenn.edu','cara-quad@upenn.edu',
                                       'alice-harnwell@upenn.edu','ben-harnwell@upenn.edu');"
  ```
- Drop a DuBois worker, run the ticks.
- **Expect:** **no float** created; an `hmod_urgent` alert is raised (recipient per
  the time-of-day rule — see L/M). The Coverage chip shows the gap at the Allied step.

### E — Quad needs a floater, Harnwell has one → Harnwell covers Quad

- Drop **one Quad crew member** to open a Quad gap (Quad drops to 2/3):
  ```bash
  PSQL "select string_agg(a.assignment_id::text,',') from shift_block_assignments a
        join shift_blocks b on b.block_id=a.block_id
        where b.house_id='quad' and a.user_id=(select user_id from users where email='cara-quad@upenn.edu')
          and b.block_start_at at time zone 'America/New_York' >= '2026-06-25 14:00'
          and b.block_start_at at time zone 'America/New_York' <  '2026-06-25 15:30';"
  # drop those ids as cara-quad, then run the ticks
  ```
- **Expect:** a float of a **Harnwell** worker **into Quad**.

### F — Quad needs a floater, Harnwell lacks one → Allied escalation

- Open a Quad gap as in E, **and** exclude the Harnwell crew for that window
  (`destination_house_id = 'quad'`). Run the ticks.
- **Expect:** **no float**; `hmod_urgent` for Quad.

### (negative) Harnwell never receives a floater

- Drop a Harnwell crew member to open a Harnwell gap; run the ticks.
- **Expect:** **no float into Harnwell** ever (training constraint). It broadcasts
  then escalates straight to HMOD/RSM. Confirms the hard invariant.

---

## 5. Lifecycle scenarios (apply on top of any float above)

Start each from a **successful float** (Scenario A), then:

### G — Happy path: worker acknowledges

- Before `T − 10m`, the floater acknowledges:
  ```bash
  FL=$(PSQL "select float_id from float_assignments where status='pending' order by created_at desc limit 1;")
  ack alice-quad@upenn.edu "$FL"     # or do it on the phone (Updates → the float → Acknowledge)
  ```
- **Expect:** float `acknowledged`; DuBois seats `floated_in`, source seats
  `floated_out`. `acknowledged_at` is stamped at the **simulated** time.

### H — No acknowledgement: void + exclusion + re-escalation

- Do **not** acknowledge. Advance past the no-ack sweep and tick:
  ```bash
  setclock '2026-06-25 13:52:00-04'; tick    # > T-15m for a 14:00 block
  ```
- **Expect:** float `voided`; a `float_exclusion` for the floater (reason
  `no_acknowledgment`); their source seats restored to `scheduled`; the DuBois
  seats back to `vacant`; an `hmod_urgent` alert (recipient per L/M).

### I — Worker declines

- The floater declines:
  ```bash
  decline alice-quad@upenn.edu "$FL"     # or on the phone: the float → Decline
  ```
- **Expect:** float `declined`; a `float_exclusion` (reason `declined`); source
  restored; DuBois gap reopened (`vacant`). A later tick re-runs float_lookup,
  which now skips the excluded worker and picks another (or escalates to Allied).

### J — Force-trigger (SM short-circuits the timing)

- More than 2h before the shift (so the auto-lookup hasn't fired), the SM triggers
  the lookup now. **Easiest in the web app:** open **Coverage** as `sam-dubois`,
  find the broadcast-stage gap, click **"Force-trigger float"**.
- Via curl (the EF builds the `block_ids` JSON array for you here):
  ```bash
  setclock '2026-06-25 11:30:00-04'      # broadcast stage, > 2h out
  # block_ids as a JSON array of the vacant DuBois blocks for the window:
  BODY=$(PSQL "select json_build_object('destination_house_id','dubois','block_ids',
                 coalesce(json_agg(b.block_id),'[]'))::text
               from shift_block_assignments a join shift_blocks b on b.block_id=a.block_id
               where b.house_id='dubois' and a.status='vacant'
                 and b.block_start_at at time zone 'America/New_York' >= '2026-06-25 14:00'
                 and b.block_start_at at time zone 'America/New_York' <  '2026-06-25 15:30';")
  curl -s -X POST 'http://127.0.0.1:54321/functions/v1/force-trigger/force-trigger' \
    -H "Authorization: Bearer $(worker_token sam-dubois@upenn.edu)" -H "apikey: $ANON" \
    -H 'Content-Type: application/json' -d "$BODY"; echo
  ```
- **Expect:** a float assigned immediately (`initiated_by = force_triggered`,
  `force_triggered_by = sam-dubois`); broadcast + float_lookup marked
  `completed_via_force_trigger`; ack-reminders snapshotted. Force-trigger is
  **rejected within 2h** of the shift (`within_two_hours`).

### K — Allied resolved (HMOD clears an alert)

- After an `hmod_urgent` exists (Scenarios D/F/H), the recipient marks it resolved.
  In the web **Action inbox**, tick the "Resolved" checkbox on the alert. Via SQL:
  ```bash
  PSQL "with t as (select notification_id, recipient_user_id from notifications
                   where type='hmod_urgent' order by created_at desc limit 1)
        select set_allied_resolved(t.notification_id, t.recipient_user_id, true, app_now()) from t;"
  ```
- **Expect:** `resolved_at` / `resolved_by` set; the alert moves out of the default
  inbox into **Inbox → Resolved** (`?show=resolved`). Resolved ≠ covered — it
  changes no coverage state.

---

## 6. Time-of-day routing (run with D or H to see the recipient change)

The Allied / no-ack escalation recipient depends on **when it fires**:

### L — In-hours → RSM

- Use a **weekday** gap whose escalation fires Mon–Fri 08:00–17:00 NY (e.g. a
  14:00 block, no-ack sweep at 13:52).
- **Expect:** `hmod_urgent` to the gap house's **RSM** (e.g. `diana-dubois`).

### M — Off-hours → HMOD on duty

- Use a **weekend** gap, or a weekday gap whose escalation fires after 17:00:
  ```bash
  # DuBois gap on Saturday 2026-06-27; ticks at Sat times
  setclock '2026-06-27 11:01:00-04'; tick
  setclock '2026-06-27 12:01:00-04'; tick
  setclock '2026-06-27 13:52:00-04'; tick   # no-ack sweep, off-hours
  ```
- **Expect:** `hmod_urgent` to the **HMOD on duty** (`hana-quad` in the test rotor),
  not the RSM.
- **Boundary:** `is_hm_working_time` flips at exactly 17:00 — a block whose
  escalation fires at 16:55 routes to the RSM, at 17:05 to the HMOD.

> The HMOD on duty comes from `hmod_rotor` (Friday-anchored weeks). `setup.sql`
> sets `hana-quad` for the test weeks; change that row to test a different HMOD.

---

## 7. Mobile (worker phone) checks

The worker app follows the sim-clock once it has launched (it captures `app_now()`
at start — so **set the clock, then launch/relaunch** the worker build). Use it to
confirm, for a pending float:

- the **Updates** tab shows the float with a correct "respond by … left" countdown;
- opening it shows the **acknowledgment hero** (house, when, "starts in …");
- **Acknowledge** / **Decline** drive Scenarios G / I (and reconcile on the next
  Realtime push). Run the worker build against the local stack (not the demo build).

---

## 8. Troubleshooting

- **No float, gap escalates straight to HMOD** — check the date isn't `short_break`
  (`select profile_name from operating_calendar where date='<date>'`); short_break
  has no float routing into DuBois. Use `2026-06-25`+.
- **A different worker than expected floats** — leftover `float_exclusions` from a
  prior no-ack/decline. Run `reset.sql`.
- **Nothing happens on a tick** — confirm the block is `vacant` and within the
  ~3h lookahead of the sim clock, and that you stepped onto the right boundary
  (broadcast at T−3h, float at T−2h, no-ack after T−15m).
- **Ack/decline "too late"** — the floater can only act before `T − 10m`; advance
  the clock past it and the no-ack sweep voids the float instead.
- **Back to a clean slate** — `reset.sql` (fast) or `setup.sql` (full re-crew).
