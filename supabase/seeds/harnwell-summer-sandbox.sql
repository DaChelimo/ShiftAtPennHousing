-- supabase/seeds/harnwell-summer-sandbox.sql
-- AUTO-GENERATED. Regenerate with `pnpm seed:sandbox:regen` (scripts/gen-harnwell-sandbox.py).
--
-- SANDBOX: the nine REAL Harnwell Summer 2026 student workers, with the preferences
-- they actually submitted on the paper availability forms, written against the
-- Summer 2026 scheduling period's template week (Mon 2026-06-01 .. Sun 2026-06-07).
-- Purpose: drive the AI schedule builder from real inputs and compare its output to
-- the schedule the student manager actually published ('Final Schedule.xlsx').
--
-- Containment: this touches ONLY (a) preferences + period_targets rows belonging to
-- Harnwell-home users in the Summer 2026 period, and (b) Harnwell draft assignments in
-- that period. It never touches other houses, other periods, live shift assignments,
-- users, or auth. Re-running it fully resets the sandbox to this exact state, which is
-- what makes it safe to iterate on the AI agent and re-test.
--
-- The eight synthetic Harnwell workers (Alice/Ben/Cara/Dan/Erin/Fred/Gina/Hugo) keep
-- their accounts but lose their simulated preferences for this period, which drops them
-- from the builder roster: getAiScheduleContext keeps SUBMITTERS ONLY (>= 1 preference
-- row or a period_targets row). That is how the sandbox isolates the nine real workers
-- without deactivating anybody. Re-run `Simulate worker preferences` on /admin/operations
-- to put the synthetic cast back.
--
-- Sources (one row per worker, provenance recorded):
--   Eleni           target 23h  <- ELENI.xlsx (colour-coded form; hours from the final schedule contact table)
--   Abraham         target 24h  <- no form: stakeholder rule 05:30-08:00 Cannot daily, else Preferred
--   Drew            target 30h  <- ANDREW BUKASA.xlsx (colour-coded form; stated 23-30, upper bound used)
--   Valeria         target 30h  <- Valeria.pdf
--   Aaron           target 23h  <- Aaron Kirui.xlsx
--   Lealem          target 30h  <- Lealem.xlsx
--   Ornella         target 24h  <- no form: derived from the final schedule (worked = Preferred, all else Cannot)
--   Andrew Chelimo  target 40h  <- Andrew Chelimo .xlsx
--   Purity          target 40h  <- Purity.xlsx

BEGIN;

-- 1. Guard: the sandbox is meaningless without its period and its template week.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM scheduling_periods WHERE period_id = '5ea50000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'Summer 2026 period missing. Run `pnpm db:reset:seasons` first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE user_id = 'fbb00000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'Real Harnwell workers missing. Run `pnpm seed:harnwell` first.';
  END IF;
END $$;

-- 2. Abraham is the Harnwell SM and also works the desk (24h on the real schedule),
--    but house_roster_as_of is role = 'sw' only, so without this he can never appear
--    in the builder or AI roster. Grant him the sw role too (roles are additive).
INSERT INTO user_roles (user_id, role, scope_house_id)
SELECT user_id, 'sw', NULL FROM users WHERE email = 'ndlovuab@sas.upenn.edu'
ON CONFLICT DO NOTHING;

-- 3. The submitted grids, as half-hour ranges over the template week.
--    weekday: 0 = Monday .. 6 = Sunday (matches blockWeekSlot).
CREATE TEMP TABLE sandbox_prefs (
  email      text NOT NULL,
  weekday    int  NOT NULL,
  start_min  int  NOT NULL,
  end_min    int  NOT NULL,
  status     preference_status_enum NOT NULL
) ON COMMIT DROP;

INSERT INTO sandbox_prefs (email, weekday, start_min, end_min, status) VALUES
-- Eleni
  ('elenikan@sas.upenn.edu', 0, 330, 720, 'preferred'),  -- Mon 05:30-12:00
  ('elenikan@sas.upenn.edu', 0, 720, 780, 'available'),  -- Mon 12:00-13:00
  ('elenikan@sas.upenn.edu', 0, 780, 840, 'cannot'),  -- Mon 13:00-14:00
  ('elenikan@sas.upenn.edu', 0, 840, 900, 'available'),  -- Mon 14:00-15:00
  ('elenikan@sas.upenn.edu', 0, 900, 1140, 'preferred'),  -- Mon 15:00-19:00
  ('elenikan@sas.upenn.edu', 0, 1140, 1440, 'cannot'),  -- Mon 19:00-24:00
  ('elenikan@sas.upenn.edu', 1, 330, 1080, 'preferred'),  -- Tue 05:30-18:00
  ('elenikan@sas.upenn.edu', 1, 1080, 1140, 'available'),  -- Tue 18:00-19:00
  ('elenikan@sas.upenn.edu', 1, 1140, 1440, 'cannot'),  -- Tue 19:00-24:00
  ('elenikan@sas.upenn.edu', 2, 330, 540, 'preferred'),  -- Wed 05:30-09:00
  ('elenikan@sas.upenn.edu', 2, 540, 600, 'available'),  -- Wed 09:00-10:00
  ('elenikan@sas.upenn.edu', 2, 600, 660, 'cannot'),  -- Wed 10:00-11:00
  ('elenikan@sas.upenn.edu', 2, 660, 720, 'available'),  -- Wed 11:00-12:00
  ('elenikan@sas.upenn.edu', 2, 720, 1140, 'preferred'),  -- Wed 12:00-19:00
  ('elenikan@sas.upenn.edu', 2, 1140, 1440, 'cannot'),  -- Wed 19:00-24:00
  ('elenikan@sas.upenn.edu', 3, 330, 600, 'preferred'),  -- Thu 05:30-10:00
  ('elenikan@sas.upenn.edu', 3, 600, 660, 'cannot'),  -- Thu 10:00-11:00
  ('elenikan@sas.upenn.edu', 3, 660, 1080, 'preferred'),  -- Thu 11:00-18:00
  ('elenikan@sas.upenn.edu', 3, 1080, 1140, 'available'),  -- Thu 18:00-19:00
  ('elenikan@sas.upenn.edu', 3, 1140, 1440, 'cannot'),  -- Thu 19:00-24:00
  ('elenikan@sas.upenn.edu', 4, 330, 540, 'preferred'),  -- Fri 05:30-09:00
  ('elenikan@sas.upenn.edu', 4, 540, 600, 'available'),  -- Fri 09:00-10:00
  ('elenikan@sas.upenn.edu', 4, 600, 720, 'cannot'),  -- Fri 10:00-12:00
  ('elenikan@sas.upenn.edu', 4, 720, 780, 'available'),  -- Fri 12:00-13:00
  ('elenikan@sas.upenn.edu', 4, 780, 1140, 'preferred'),  -- Fri 13:00-19:00
  ('elenikan@sas.upenn.edu', 4, 1140, 1440, 'cannot'),  -- Fri 19:00-24:00
  ('elenikan@sas.upenn.edu', 5, 330, 1440, 'cannot'),  -- Sat 05:30-24:00
  ('elenikan@sas.upenn.edu', 6, 330, 1440, 'cannot'),  -- Sun 05:30-24:00
-- Abraham
  ('ndlovuab@sas.upenn.edu', 0, 330, 480, 'cannot'),  -- Mon 05:30-08:00
  ('ndlovuab@sas.upenn.edu', 0, 480, 1440, 'preferred'),  -- Mon 08:00-24:00
  ('ndlovuab@sas.upenn.edu', 1, 330, 480, 'cannot'),  -- Tue 05:30-08:00
  ('ndlovuab@sas.upenn.edu', 1, 480, 1440, 'preferred'),  -- Tue 08:00-24:00
  ('ndlovuab@sas.upenn.edu', 2, 330, 480, 'cannot'),  -- Wed 05:30-08:00
  ('ndlovuab@sas.upenn.edu', 2, 480, 1440, 'preferred'),  -- Wed 08:00-24:00
  ('ndlovuab@sas.upenn.edu', 3, 330, 480, 'cannot'),  -- Thu 05:30-08:00
  ('ndlovuab@sas.upenn.edu', 3, 480, 1440, 'preferred'),  -- Thu 08:00-24:00
  ('ndlovuab@sas.upenn.edu', 4, 330, 480, 'cannot'),  -- Fri 05:30-08:00
  ('ndlovuab@sas.upenn.edu', 4, 480, 1440, 'preferred'),  -- Fri 08:00-24:00
  ('ndlovuab@sas.upenn.edu', 5, 330, 480, 'cannot'),  -- Sat 05:30-08:00
  ('ndlovuab@sas.upenn.edu', 5, 480, 1440, 'preferred'),  -- Sat 08:00-24:00
  ('ndlovuab@sas.upenn.edu', 6, 330, 480, 'cannot'),  -- Sun 05:30-08:00
  ('ndlovuab@sas.upenn.edu', 6, 480, 1440, 'preferred'),  -- Sun 08:00-24:00
-- Drew
  ('dbukasa@sas.upenn.edu', 0, 330, 480, 'cannot'),  -- Mon 05:30-08:00
  ('dbukasa@sas.upenn.edu', 0, 480, 1440, 'preferred'),  -- Mon 08:00-24:00
  ('dbukasa@sas.upenn.edu', 1, 330, 480, 'cannot'),  -- Tue 05:30-08:00
  ('dbukasa@sas.upenn.edu', 1, 480, 1440, 'preferred'),  -- Tue 08:00-24:00
  ('dbukasa@sas.upenn.edu', 2, 330, 480, 'cannot'),  -- Wed 05:30-08:00
  ('dbukasa@sas.upenn.edu', 2, 480, 1260, 'preferred'),  -- Wed 08:00-21:00
  ('dbukasa@sas.upenn.edu', 2, 1260, 1440, 'available'),  -- Wed 21:00-24:00
  ('dbukasa@sas.upenn.edu', 3, 330, 480, 'cannot'),  -- Thu 05:30-08:00
  ('dbukasa@sas.upenn.edu', 3, 480, 1260, 'preferred'),  -- Thu 08:00-21:00
  ('dbukasa@sas.upenn.edu', 3, 1260, 1440, 'available'),  -- Thu 21:00-24:00
  ('dbukasa@sas.upenn.edu', 4, 330, 480, 'cannot'),  -- Fri 05:30-08:00
  ('dbukasa@sas.upenn.edu', 4, 480, 1020, 'preferred'),  -- Fri 08:00-17:00
  ('dbukasa@sas.upenn.edu', 4, 1020, 1320, 'available'),  -- Fri 17:00-22:00
  ('dbukasa@sas.upenn.edu', 4, 1320, 1440, 'cannot'),  -- Fri 22:00-24:00
  ('dbukasa@sas.upenn.edu', 5, 330, 1440, 'cannot'),  -- Sat 05:30-24:00
  ('dbukasa@sas.upenn.edu', 6, 330, 1440, 'cannot'),  -- Sun 05:30-24:00
-- Valeria
  ('mercadov@sas.upenn.edu', 0, 330, 480, 'cannot'),  -- Mon 05:30-08:00
  ('mercadov@sas.upenn.edu', 0, 480, 720, 'preferred'),  -- Mon 08:00-12:00
  ('mercadov@sas.upenn.edu', 0, 720, 1020, 'available'),  -- Mon 12:00-17:00
  ('mercadov@sas.upenn.edu', 0, 1020, 1260, 'preferred'),  -- Mon 17:00-21:00
  ('mercadov@sas.upenn.edu', 0, 1260, 1440, 'available'),  -- Mon 21:00-24:00
  ('mercadov@sas.upenn.edu', 1, 330, 480, 'cannot'),  -- Tue 05:30-08:00
  ('mercadov@sas.upenn.edu', 1, 480, 720, 'preferred'),  -- Tue 08:00-12:00
  ('mercadov@sas.upenn.edu', 1, 720, 1020, 'available'),  -- Tue 12:00-17:00
  ('mercadov@sas.upenn.edu', 1, 1020, 1260, 'preferred'),  -- Tue 17:00-21:00
  ('mercadov@sas.upenn.edu', 1, 1260, 1440, 'available'),  -- Tue 21:00-24:00
  ('mercadov@sas.upenn.edu', 2, 330, 480, 'cannot'),  -- Wed 05:30-08:00
  ('mercadov@sas.upenn.edu', 2, 480, 720, 'preferred'),  -- Wed 08:00-12:00
  ('mercadov@sas.upenn.edu', 2, 720, 1020, 'available'),  -- Wed 12:00-17:00
  ('mercadov@sas.upenn.edu', 2, 1020, 1260, 'preferred'),  -- Wed 17:00-21:00
  ('mercadov@sas.upenn.edu', 2, 1260, 1440, 'available'),  -- Wed 21:00-24:00
  ('mercadov@sas.upenn.edu', 3, 330, 480, 'cannot'),  -- Thu 05:30-08:00
  ('mercadov@sas.upenn.edu', 3, 480, 720, 'preferred'),  -- Thu 08:00-12:00
  ('mercadov@sas.upenn.edu', 3, 720, 1020, 'available'),  -- Thu 12:00-17:00
  ('mercadov@sas.upenn.edu', 3, 1020, 1260, 'preferred'),  -- Thu 17:00-21:00
  ('mercadov@sas.upenn.edu', 3, 1260, 1440, 'available'),  -- Thu 21:00-24:00
  ('mercadov@sas.upenn.edu', 4, 330, 480, 'cannot'),  -- Fri 05:30-08:00
  ('mercadov@sas.upenn.edu', 4, 480, 720, 'preferred'),  -- Fri 08:00-12:00
  ('mercadov@sas.upenn.edu', 4, 720, 1020, 'available'),  -- Fri 12:00-17:00
  ('mercadov@sas.upenn.edu', 4, 1020, 1260, 'preferred'),  -- Fri 17:00-21:00
  ('mercadov@sas.upenn.edu', 4, 1260, 1440, 'available'),  -- Fri 21:00-24:00
  ('mercadov@sas.upenn.edu', 5, 330, 1440, 'cannot'),  -- Sat 05:30-24:00
  ('mercadov@sas.upenn.edu', 6, 330, 1440, 'cannot'),  -- Sun 05:30-24:00
-- Aaron
  ('akkirui@sas.upenn.edu', 0, 330, 1440, 'cannot'),  -- Mon 05:30-24:00
  ('akkirui@sas.upenn.edu', 1, 330, 1200, 'cannot'),  -- Tue 05:30-20:00
  ('akkirui@sas.upenn.edu', 1, 1200, 1320, 'available'),  -- Tue 20:00-22:00
  ('akkirui@sas.upenn.edu', 1, 1320, 1440, 'cannot'),  -- Tue 22:00-24:00
  ('akkirui@sas.upenn.edu', 2, 330, 1440, 'cannot'),  -- Wed 05:30-24:00
  ('akkirui@sas.upenn.edu', 3, 330, 1200, 'cannot'),  -- Thu 05:30-20:00
  ('akkirui@sas.upenn.edu', 3, 1200, 1320, 'available'),  -- Thu 20:00-22:00
  ('akkirui@sas.upenn.edu', 3, 1320, 1440, 'cannot'),  -- Thu 22:00-24:00
  ('akkirui@sas.upenn.edu', 4, 330, 1200, 'cannot'),  -- Fri 05:30-20:00
  ('akkirui@sas.upenn.edu', 4, 1200, 1320, 'available'),  -- Fri 20:00-22:00
  ('akkirui@sas.upenn.edu', 4, 1320, 1440, 'cannot'),  -- Fri 22:00-24:00
  ('akkirui@sas.upenn.edu', 5, 330, 480, 'cannot'),  -- Sat 05:30-08:00
  ('akkirui@sas.upenn.edu', 5, 480, 540, 'available'),  -- Sat 08:00-09:00
  ('akkirui@sas.upenn.edu', 5, 540, 900, 'preferred'),  -- Sat 09:00-15:00
  ('akkirui@sas.upenn.edu', 5, 900, 960, 'available'),  -- Sat 15:00-16:00
  ('akkirui@sas.upenn.edu', 5, 960, 1200, 'cannot'),  -- Sat 16:00-20:00
  ('akkirui@sas.upenn.edu', 5, 1200, 1440, 'preferred'),  -- Sat 20:00-24:00
  ('akkirui@sas.upenn.edu', 6, 330, 480, 'cannot'),  -- Sun 05:30-08:00
  ('akkirui@sas.upenn.edu', 6, 480, 540, 'available'),  -- Sun 08:00-09:00
  ('akkirui@sas.upenn.edu', 6, 540, 900, 'preferred'),  -- Sun 09:00-15:00
  ('akkirui@sas.upenn.edu', 6, 900, 1200, 'cannot'),  -- Sun 15:00-20:00
  ('akkirui@sas.upenn.edu', 6, 1200, 1440, 'preferred'),  -- Sun 20:00-24:00
-- Lealem
  ('lmelesse@seas.upenn.edu', 0, 330, 480, 'preferred'),  -- Mon 05:30-08:00
  ('lmelesse@seas.upenn.edu', 0, 480, 840, 'cannot'),  -- Mon 08:00-14:00
  ('lmelesse@seas.upenn.edu', 0, 840, 1260, 'available'),  -- Mon 14:00-21:00
  ('lmelesse@seas.upenn.edu', 0, 1260, 1440, 'cannot'),  -- Mon 21:00-24:00
  ('lmelesse@seas.upenn.edu', 1, 330, 480, 'preferred'),  -- Tue 05:30-08:00
  ('lmelesse@seas.upenn.edu', 1, 480, 840, 'cannot'),  -- Tue 08:00-14:00
  ('lmelesse@seas.upenn.edu', 1, 840, 1260, 'available'),  -- Tue 14:00-21:00
  ('lmelesse@seas.upenn.edu', 1, 1260, 1440, 'cannot'),  -- Tue 21:00-24:00
  ('lmelesse@seas.upenn.edu', 2, 330, 480, 'preferred'),  -- Wed 05:30-08:00
  ('lmelesse@seas.upenn.edu', 2, 480, 840, 'cannot'),  -- Wed 08:00-14:00
  ('lmelesse@seas.upenn.edu', 2, 840, 1320, 'preferred'),  -- Wed 14:00-22:00
  ('lmelesse@seas.upenn.edu', 2, 1320, 1440, 'cannot'),  -- Wed 22:00-24:00
  ('lmelesse@seas.upenn.edu', 3, 330, 480, 'preferred'),  -- Thu 05:30-08:00
  ('lmelesse@seas.upenn.edu', 3, 480, 840, 'cannot'),  -- Thu 08:00-14:00
  ('lmelesse@seas.upenn.edu', 3, 840, 1320, 'preferred'),  -- Thu 14:00-22:00
  ('lmelesse@seas.upenn.edu', 3, 1320, 1440, 'cannot'),  -- Thu 22:00-24:00
  ('lmelesse@seas.upenn.edu', 4, 330, 480, 'preferred'),  -- Fri 05:30-08:00
  ('lmelesse@seas.upenn.edu', 4, 480, 840, 'cannot'),  -- Fri 08:00-14:00
  ('lmelesse@seas.upenn.edu', 4, 840, 1320, 'preferred'),  -- Fri 14:00-22:00
  ('lmelesse@seas.upenn.edu', 4, 1320, 1440, 'cannot'),  -- Fri 22:00-24:00
  ('lmelesse@seas.upenn.edu', 5, 330, 600, 'preferred'),  -- Sat 05:30-10:00
  ('lmelesse@seas.upenn.edu', 5, 600, 840, 'available'),  -- Sat 10:00-14:00
  ('lmelesse@seas.upenn.edu', 5, 840, 1440, 'cannot'),  -- Sat 14:00-24:00
  ('lmelesse@seas.upenn.edu', 6, 330, 780, 'cannot'),  -- Sun 05:30-13:00
  ('lmelesse@seas.upenn.edu', 6, 780, 1200, 'available'),  -- Sun 13:00-20:00
  ('lmelesse@seas.upenn.edu', 6, 1200, 1440, 'cannot'),  -- Sun 20:00-24:00
-- Ornella
  ('ornellar@sas.upenn.edu', 0, 330, 480, 'preferred'),  -- Mon 05:30-08:00
  ('ornellar@sas.upenn.edu', 0, 480, 1440, 'cannot'),  -- Mon 08:00-24:00
  ('ornellar@sas.upenn.edu', 1, 330, 480, 'preferred'),  -- Tue 05:30-08:00
  ('ornellar@sas.upenn.edu', 1, 480, 1200, 'cannot'),  -- Tue 08:00-20:00
  ('ornellar@sas.upenn.edu', 1, 1200, 1440, 'preferred'),  -- Tue 20:00-24:00
  ('ornellar@sas.upenn.edu', 2, 330, 480, 'preferred'),  -- Wed 05:30-08:00
  ('ornellar@sas.upenn.edu', 2, 480, 1440, 'cannot'),  -- Wed 08:00-24:00
  ('ornellar@sas.upenn.edu', 3, 330, 480, 'preferred'),  -- Thu 05:30-08:00
  ('ornellar@sas.upenn.edu', 3, 480, 1440, 'cannot'),  -- Thu 08:00-24:00
  ('ornellar@sas.upenn.edu', 4, 330, 480, 'preferred'),  -- Fri 05:30-08:00
  ('ornellar@sas.upenn.edu', 4, 480, 1440, 'cannot'),  -- Fri 08:00-24:00
  ('ornellar@sas.upenn.edu', 5, 330, 960, 'cannot'),  -- Sat 05:30-16:00
  ('ornellar@sas.upenn.edu', 5, 960, 1440, 'preferred'),  -- Sat 16:00-24:00
  ('ornellar@sas.upenn.edu', 6, 330, 1440, 'cannot'),  -- Sun 05:30-24:00
-- Andrew Chelimo
  ('chelimo@seas.upenn.edu', 0, 330, 720, 'cannot'),  -- Mon 05:30-12:00
  ('chelimo@seas.upenn.edu', 0, 720, 1440, 'preferred'),  -- Mon 12:00-24:00
  ('chelimo@seas.upenn.edu', 1, 330, 600, 'cannot'),  -- Tue 05:30-10:00
  ('chelimo@seas.upenn.edu', 1, 600, 720, 'available'),  -- Tue 10:00-12:00
  ('chelimo@seas.upenn.edu', 1, 720, 1020, 'preferred'),  -- Tue 12:00-17:00
  ('chelimo@seas.upenn.edu', 1, 1020, 1200, 'cannot'),  -- Tue 17:00-20:00
  ('chelimo@seas.upenn.edu', 1, 1200, 1440, 'preferred'),  -- Tue 20:00-24:00
  ('chelimo@seas.upenn.edu', 2, 330, 600, 'cannot'),  -- Wed 05:30-10:00
  ('chelimo@seas.upenn.edu', 2, 600, 720, 'available'),  -- Wed 10:00-12:00
  ('chelimo@seas.upenn.edu', 2, 720, 1200, 'preferred'),  -- Wed 12:00-20:00
  ('chelimo@seas.upenn.edu', 2, 1200, 1260, 'cannot'),  -- Wed 20:00-21:00
  ('chelimo@seas.upenn.edu', 2, 1260, 1440, 'preferred'),  -- Wed 21:00-24:00
  ('chelimo@seas.upenn.edu', 3, 330, 600, 'cannot'),  -- Thu 05:30-10:00
  ('chelimo@seas.upenn.edu', 3, 600, 720, 'available'),  -- Thu 10:00-12:00
  ('chelimo@seas.upenn.edu', 3, 720, 1020, 'preferred'),  -- Thu 12:00-17:00
  ('chelimo@seas.upenn.edu', 3, 1020, 1200, 'cannot'),  -- Thu 17:00-20:00
  ('chelimo@seas.upenn.edu', 3, 1200, 1440, 'preferred'),  -- Thu 20:00-24:00
  ('chelimo@seas.upenn.edu', 4, 330, 600, 'cannot'),  -- Fri 05:30-10:00
  ('chelimo@seas.upenn.edu', 4, 600, 720, 'available'),  -- Fri 10:00-12:00
  ('chelimo@seas.upenn.edu', 4, 720, 1440, 'preferred'),  -- Fri 12:00-24:00
  ('chelimo@seas.upenn.edu', 5, 330, 1440, 'cannot'),  -- Sat 05:30-24:00
  ('chelimo@seas.upenn.edu', 6, 330, 1440, 'cannot'),  -- Sun 05:30-24:00
-- Purity
  ('liseche1@nursing.upenn.edu', 0, 330, 600, 'cannot'),  -- Mon 05:30-10:00
  ('liseche1@nursing.upenn.edu', 0, 600, 660, 'available'),  -- Mon 10:00-11:00
  ('liseche1@nursing.upenn.edu', 0, 660, 1020, 'preferred'),  -- Mon 11:00-17:00
  ('liseche1@nursing.upenn.edu', 0, 1020, 1140, 'cannot'),  -- Mon 17:00-19:00
  ('liseche1@nursing.upenn.edu', 0, 1140, 1440, 'preferred'),  -- Mon 19:00-24:00
  ('liseche1@nursing.upenn.edu', 1, 330, 600, 'cannot'),  -- Tue 05:30-10:00
  ('liseche1@nursing.upenn.edu', 1, 600, 660, 'available'),  -- Tue 10:00-11:00
  ('liseche1@nursing.upenn.edu', 1, 660, 1440, 'preferred'),  -- Tue 11:00-24:00
  ('liseche1@nursing.upenn.edu', 2, 330, 600, 'cannot'),  -- Wed 05:30-10:00
  ('liseche1@nursing.upenn.edu', 2, 600, 660, 'available'),  -- Wed 10:00-11:00
  ('liseche1@nursing.upenn.edu', 2, 660, 1020, 'preferred'),  -- Wed 11:00-17:00
  ('liseche1@nursing.upenn.edu', 2, 1020, 1140, 'cannot'),  -- Wed 17:00-19:00
  ('liseche1@nursing.upenn.edu', 2, 1140, 1440, 'preferred'),  -- Wed 19:00-24:00
  ('liseche1@nursing.upenn.edu', 3, 330, 600, 'cannot'),  -- Thu 05:30-10:00
  ('liseche1@nursing.upenn.edu', 3, 600, 660, 'available'),  -- Thu 10:00-11:00
  ('liseche1@nursing.upenn.edu', 3, 660, 1440, 'preferred'),  -- Thu 11:00-24:00
  ('liseche1@nursing.upenn.edu', 4, 330, 600, 'cannot'),  -- Fri 05:30-10:00
  ('liseche1@nursing.upenn.edu', 4, 600, 660, 'available'),  -- Fri 10:00-11:00
  ('liseche1@nursing.upenn.edu', 4, 660, 1440, 'preferred'),  -- Fri 11:00-24:00
  ('liseche1@nursing.upenn.edu', 5, 330, 1440, 'cannot'),  -- Sat 05:30-24:00
  ('liseche1@nursing.upenn.edu', 6, 330, 1440, 'cannot')  -- Sun 05:30-24:00
;

CREATE TEMP TABLE sandbox_targets (email text NOT NULL, target_hours int NOT NULL) ON COMMIT DROP;
INSERT INTO sandbox_targets (email, target_hours) VALUES
  ('elenikan@sas.upenn.edu', 23),
  ('ndlovuab@sas.upenn.edu', 24),
  ('dbukasa@sas.upenn.edu', 30),
  ('mercadov@sas.upenn.edu', 30),
  ('akkirui@sas.upenn.edu', 23),
  ('lmelesse@seas.upenn.edu', 30),
  ('ornellar@sas.upenn.edu', 24),
  ('chelimo@seas.upenn.edu', 40),
  ('liseche1@nursing.upenn.edu', 40)
;

-- 4. The template week's Harnwell blocks, keyed by (weekday, minute-of-day).
CREATE TEMP TABLE sandbox_blocks AS
SELECT b.block_id,
       (EXTRACT(isodow FROM b.block_start_at AT TIME ZONE 'America/New_York')::int - 1) AS weekday,
       (EXTRACT(hour FROM b.block_start_at AT TIME ZONE 'America/New_York')::int * 60
        + EXTRACT(minute FROM b.block_start_at AT TIME ZONE 'America/New_York')::int) AS minute_of_day
FROM shift_blocks b
WHERE b.house_id = 'harnwell'
  AND b.voided_at IS NULL
  AND b.block_start_at >= TIMESTAMPTZ '2026-06-01 00:00:00-04'
  AND b.block_start_at <  TIMESTAMPTZ '2026-06-08 00:00:00-04';

DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM sandbox_blocks;
  IF v_n <> 259 THEN
    RAISE EXCEPTION 'Expected 259 Harnwell template-week blocks (37 x 7), found %.', v_n;
  END IF;
END $$;

-- 5. Open the preference window for the write. enforce_preference_deadline fires on
--    INSERT/UPDATE *and DELETE* and is not service-role-bypassed, so the delete below
--    must happen inside the reopened window too. NULL deadline = open. Restored in 9.
CREATE TEMP TABLE sandbox_saved_deadline ON COMMIT DROP AS
SELECT preference_deadline FROM scheduling_periods
WHERE period_id = '5ea50000-0000-4000-8000-000000000001' FOR UPDATE;

UPDATE scheduling_periods SET preference_deadline = NULL
WHERE period_id = '5ea50000-0000-4000-8000-000000000001';

-- 6. Clear every Harnwell-home user's preferences/targets for this period (real AND
--    synthetic), so the sandbox is the only thing left standing. Other houses untouched.
DELETE FROM preferences p
USING users u
WHERE u.user_id = p.user_id
  AND u.home_house_id = 'harnwell'
  AND p.period_id = '5ea50000-0000-4000-8000-000000000001';

DELETE FROM period_targets t
USING users u
WHERE u.user_id = t.user_id
  AND u.home_house_id = 'harnwell'
  AND t.period_id = '5ea50000-0000-4000-8000-000000000001';

-- 7. Write the nine grids. Every block gets an explicit status, exactly like the
--    in-app painter's full-grid upsert (buildSubmitPayload).
INSERT INTO preferences (user_id, block_id, period_id, status)
SELECT u.user_id, sb.block_id, '5ea50000-0000-4000-8000-000000000001', sp.status
FROM sandbox_prefs sp
JOIN users u ON u.email = sp.email
JOIN sandbox_blocks sb
  ON sb.weekday = sp.weekday
 AND sb.minute_of_day >= sp.start_min
 AND sb.minute_of_day <  sp.end_min
ON CONFLICT (user_id, block_id, period_id) DO UPDATE SET status = EXCLUDED.status;

INSERT INTO period_targets (user_id, period_id, target_hours, opted_out)
SELECT u.user_id, '5ea50000-0000-4000-8000-000000000001', st.target_hours, false
FROM sandbox_targets st JOIN users u ON u.email = st.email
ON CONFLICT (user_id, period_id) DO UPDATE
  SET target_hours = EXCLUDED.target_hours, opted_out = EXCLUDED.opted_out;

-- 8. Clear Harnwell drafts for the period so each AI run starts from an empty grid.
DELETE FROM draft_block_assignments d
USING shift_blocks b
WHERE b.block_id = d.block_id
  AND b.house_id = 'harnwell'
  AND d.period_id = '5ea50000-0000-4000-8000-000000000001';

-- 9. Restore the deadline exactly as found (the sandbox never changes the window).
UPDATE scheduling_periods sp SET preference_deadline = s.preference_deadline
FROM sandbox_saved_deadline s
WHERE sp.period_id = '5ea50000-0000-4000-8000-000000000001';

-- 10. Verify: 9 workers x 259 blocks = 2331 preference rows, 9 targets, 0 drafts.
DO $$
DECLARE v_p int; v_t int;
BEGIN
  SELECT count(*) INTO v_p FROM preferences p JOIN users u USING (user_id)
   WHERE u.home_house_id = 'harnwell' AND p.period_id = '5ea50000-0000-4000-8000-000000000001';
  SELECT count(*) INTO v_t FROM period_targets t JOIN users u USING (user_id)
   WHERE u.home_house_id = 'harnwell' AND t.period_id = '5ea50000-0000-4000-8000-000000000001';
  IF v_p <> 2331 OR v_t <> 9 THEN
    RAISE EXCEPTION 'Sandbox verification failed: % preference rows (want 2331), % targets (want 9).', v_p, v_t;
  END IF;
  RAISE NOTICE 'Harnwell summer sandbox ready: 9 workers, % preference rows, % targets.', v_p, v_t;
END $$;

COMMIT;
