# Float & Escalation — UI Testing Walkthrough

Click-by-click recipes for exercising every float / escalation behaviour using the
**web admin** (your cockpit) and the **worker app** (the worker's actions). The only
terminal steps are the one-time DB setup and the between-run reset; everything else
is buttons and taps.

> **The clock is shared.** You change time in one place — the web dev-clock card —
> and it drives the orchestrator, the website, **and** the worker app. The worker
> app re-reads the clock whenever it returns to the foreground, so after you change
> the time on the web, just switch back to the phone and it catches up (the screen
> refreshes). No relaunch needed.

Each step below is tagged **(phone)** or **(web)** so you always know where you are.

---

## 0. Prerequisites (one-time, terminal)

```bash
# 1. fresh manual-test database
pnpm db:reset:manual

# 2. float-test fixtures (crews Quad + Harnwell, sets the HMOD rotor, silences placeholders)
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f docs/float-testing/setup.sql
```

Then run the two apps:

- **Web admin:** `pnpm --filter @shift/web dev` → open the URL it prints (usually
  `http://localhost:3000`).
- **Worker app:** the **live** build (the one with a login screen), pointed at your
  local Supabase, on an emulator/simulator. (Android emulator reaches the host at
  `10.0.2.2:54321`; see `apps/mobile/maestro/README.md` / the mobile build notes.)

> Use **regular-school-year dates — June 25 2026 onward**. June 23–24 are
> `short_break`, which intentionally has no float routing into DuBois.

---

## 1. Who to log in as (password is `abc123` for everyone)

| Surface         | When                                               | Log in as                                       |
| --------------- | -------------------------------------------------- | ----------------------------------------------- |
| **Worker app**  | drop / ack / decline a **DuBois** shift            | a DuBois SW, e.g. `alice-dubois@upenn.edu`      |
| **Worker app**  | drop a **Quad** shift (Quad-as-destination)        | a Quad SW, e.g. `alice-quad@upenn.edu`          |
| **Web cockpit** | clock, run orchestrator, coverage, force-trigger   | the gap house's HM: `hana-dubois` / `hana-quad` |
| **Web inbox**   | read the Allied alert **in-hours** (Mon–Fri 08–17) | the gap house's RSM, e.g. `diana-dubois`        |
| **Web inbox**   | read the Allied alert **off-hours** (eve/weekend)  | the HMOD on duty: `hana-quad`                   |

The Allied alert is delivered to exactly one person (the RSM or the HMOD), so to read
it in the **Action inbox** you log in **as that person**. The **Coverage** page shows
the gap and its escalation progress to any house admin.

---

## 2. The web controls you'll use

- **Dev-clock card** — top bar (a pill reading `LIVE` or `SIM TIME`). Click it for a
  panel with: a **date/time picker** + quick-jumps (−1h / +15m / +1h / +3h / +1d), a
  **Set time** button, a **Run orchestrator now** button, and **Reset**.
- **Coverage** (left nav) — the gaps board: each gap shows its window, an escalation
  chip (Broadcast → Float lookup → Allied), any pending floater, and a
  **Force-trigger float** button while it's at the broadcast stage.
- **Action inbox** (left nav) — Allied/HMOD alerts; each has a **Resolved** checkbox.

---

## 3. Walkthrough — DuBois needs a floater, Quad covers (the happy path)

1. **(phone, `alice-dubois`)** Open **My Shifts**, find an upcoming weekday shift
   (June 25+), and note its **date + start time** (say **Thu Jun 25, 2:00 PM**).
2. **(phone)** Tap that shift → **Drop this shift** → confirm. It leaves My Shifts —
   it's now an open gap.
3. **(web, `hana-dubois`)** Click the **clock pill** → set the picker to the shift's
   date at **~1 hour before** it starts (Jun 25, **1:00 PM**) → **Set time**.
4. **(web)** Click **Run orchestrator now** → you'll see `Ticked · N scanned · 1 fired …`.
5. **(web)** Open **Coverage** → the DuBois gap now shows a **pending floater** (a
   **Quad** worker) with the chip at "Float lookup".
6. **(phone)** Log in as that Quad floater → bring the app to the foreground (it
   re-reads the clock) → **More → Updates** → tap the **"Float assignment"** entry.
7. **(phone)** The **acknowledgment hero** opens (house, when, "starts in…") → tap
   **Acknowledge**.
8. **(web)** Refresh **Coverage** → the gap is covered. ✅

> Why a Quad worker? DuBois pulls its floater from Quad first (then Harnwell). The
> floater's own Quad shift is relocated to DuBois — their weekly hours don't change.

---

## 4. Walkthrough — No acknowledgement → void + escalation

1. Do steps 1–5 of Walkthrough 3 (gap → pending Quad floater), then **don't ack**.
2. **(web)** Click the **clock pill** → set the time to the shift's **start time** (or
   a few minutes before) — past the ack deadline (T−10m) → **Set time**.
3. **(web)** Click **Run orchestrator now**.
4. **(web)** **Coverage** → the float is gone, the gap is back, escalated to **Allied**
   (last chip node). That worker is now temporarily excluded from re-floating.
5. **(web, as the recipient)** Log in as the DuBois **RSM** `diana-dubois` (in-hours)
   or the HMOD `hana-quad` (off-hours) → **Action inbox** → the red **Allied coverage**
   alert is there.

---

## 5. Walkthrough — Worker declines

1. Do steps 1–5 of Walkthrough 3 (gap → pending Quad floater).
2. **(phone, the floater)** **More → Updates** → tap the float → **Decline**.
3. **(web)** **Coverage** → the gap reopens immediately (that worker is now excluded).
4. **(web)** Click **Run orchestrator now** again → the lookup picks a _different_
   eligible worker, or escalates to Allied if none remain.

---

## 6. Walkthrough — Force-trigger (skip the wait)

1. **(phone)** Create a DuBois gap (steps 1–2 of Walkthrough 3).
2. **(web, `hana-dubois`)** Click the **clock pill** → set the time **more than 2 hours
   before** the shift (e.g. that morning) → **Set time**. (Force-trigger is blocked
   inside the final 2h — that's when the automated lookup runs anyway.)
3. **(web)** Open **Coverage** → the gap card shows **Force-trigger float** → click it
   → confirm in the dialog.
4. **(web)** A floater is assigned **immediately**, ahead of the normal timing; the
   chip shows the steps completed via force-trigger.
5. **(phone)** Acknowledge as in Walkthrough 3 (Updates → the float → Acknowledge).

---

## 7. Walkthrough — Allied resolved (HMOD clears an alert)

1. Produce an Allied alert (Walkthrough 4).
2. **(web, as the recipient)** Log in as `diana-dubois` (in-hours) or `hana-quad`
   (off-hours) → **Action inbox** → find the **Allied coverage** alert.
3. **(web)** Tick its **Resolved** checkbox → it leaves the main inbox and moves under
   **Inbox → Resolved**. ("Resolved" only clears the alert — it doesn't change coverage.)

---

## 8. Walkthrough — Time of day decides the recipient (RSM vs HMOD)

Run Walkthrough 4 twice, changing only the clock — the Allied alert goes to a
different person:

- **In-hours:** set the clock to a **weekday afternoon** (e.g. Thu 1:00 PM, void at
  ~2:00 PM) → alert goes to the DuBois **RSM** (`diana-dubois`).
- **Off-hours:** drop a **Saturday** DuBois shift and run the ticks on Saturday →
  alert goes to the **HMOD on duty** (`hana-quad`).

Log in as each to confirm the alert lands in the right inbox. The 17:00 boundary is
exact: firing at 16:55 → RSM, at 17:05 → HMOD.

---

## 9. Walkthrough — Quad needs a floater, Harnwell covers it

Same flow, gap in **Quad** instead of DuBois:

1. **(phone, `alice-quad`)** **My Shifts** → drop an upcoming Quad shift.
2. **(web, `hana-quad`)** Clock → ~1h before the shift → **Set time** → **Run
   orchestrator now**.
3. **(web)** **Coverage** (Quad) → the floater is a **Harnwell** worker (Harnwell is
   the only source for Quad). Acknowledge on the phone as that Harnwell worker.

> Nothing ever floats **into** Harnwell (training rule). Drop a Harnwell shift and run
> the orchestrator and you'll see it escalate straight to Allied — no floater.

---

## 10. Appendix — "a source has no floater" (the one case that needs a SQL line)

To test **Quad has nobody → Harnwell covers**, or **nobody at all → Allied**, you must
make a fully-staffed source _unavailable_ — there's no button for that, so use one SQL
line (it inserts the same exclusion a real decline/no-ack would create).

Make the **Quad** crew unavailable for a DuBois gap window (then run Walkthrough 3 —
the floater comes from **Harnwell**):

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "
insert into float_exclusions (user_id, window_start_at, window_end_at, destination_house_id, reason, excluded_at)
select u.user_id, '2026-06-25 14:00:00-04', '2026-06-25 16:00:00-04', 'dubois', 'no_acknowledgment', now()
from users u where u.email in ('alice-quad@upenn.edu','ben-quad@upenn.edu','cara-quad@upenn.edu');"
```

For **nobody available → Allied**, add the Harnwell crew to that `in (...)` list
(`'alice-harnwell@upenn.edu','ben-harnwell@upenn.edu'`). Then the gap escalates to
Allied with no float. (`reset.sql` clears these exclusions.)

---

## 11. Reset & troubleshooting

**Between scenarios** (terminal):

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f docs/float-testing/reset.sql
```

Clears floats / exclusions / alerts, restores the source crews and any dropped DuBois
shifts, and sets the clock back to real time. Re-run `setup.sql` for a full rebuild.

- **The float went straight to Allied (no floater)** — the date is probably a
  `short_break` day, or the source crew is excluded from a prior run. Use June 25+ and
  run `reset.sql`.
- **"Run orchestrator now" did nothing** — the dropped shift must start _after_ the sim
  clock and within ~3 hours of it (set the clock to ~1h before the shift).
- **The phone shows the old time** — background it and reopen; it re-reads the clock on
  resume. If it still lags, relaunch.
- **Can't acknowledge ("too late")** — the worker can only act before T−10m; if the
  clock is past that, the no-ack sweep has already voided the float.
- **Don't see the Allied alert in the inbox** — you're not logged in as its recipient
  (RSM in-hours, HMOD off-hours). The Coverage page shows the escalation regardless.

---

_The original terminal-driven recipes (scriptable, no UI) are preserved in the file
history if you prefer driving everything from `psql` + `curl`._
