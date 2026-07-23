-- Migration: hire_worker seeds a real user_house_memberships row.
--
-- Follow-up to 20260719000001_house_transfers.sql. hire_worker (20260611000004)
-- predates user_house_memberships and only ever wrote users.home_house_id, so a
-- newly hired worker had ZERO membership rows. Every read path already tolerated
-- this via a COALESCE-to-home_house_id fallback (membership_house_for_date) and
-- transfer_worker self-heals a missing row by backdating it to a 2000-01-01
-- sentinel — so nothing was functionally broken. But that sentinel is a fake
-- start date, not the worker's real hire date, which makes the membership table
-- an incomplete audit trail for anyone hired after 20260719000001 shipped and
-- transferred before it self-healed.
--
-- Fix: hire_worker now inserts one open-ended, already-applied membership row
-- (house_id = the hire's home house, effective_from = today, applied_at = now)
-- alongside the existing users/user_roles inserts, in the same transaction. This
-- makes a fresh hire's history correct from day one; transfer_worker's self-heal
-- path becomes dead code for every hire made from here on (still needed for
-- workers hired before this migration).

CREATE OR REPLACE FUNCTION hire_worker(
  p_initiator     uuid,
  p_user_id       uuid,
  p_name          text,
  p_email         text,
  p_home_house_id text,
  p_role          user_role_enum DEFAULT 'sw',
  p_phone         text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name  text := btrim(p_name);
  v_email text := lower(btrim(p_email));
  v_scope text;
BEGIN
  -- ============================================================
  -- ① authz — people-admin is HM/BM-only, scoped to the hire's home house
  --    (§6.6/§2.3/§2.6). An SM or any non-admin is rejected; an HM/BM of a
  --    DIFFERENT house is rejected (they cannot hire into a house they do not
  --    administer).
  -- ============================================================
  IF NOT user_has_house_admin_role(p_initiator, p_home_house_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- ============================================================
  -- ② input validation
  -- ============================================================
  IF v_name = '' THEN
    RAISE EXCEPTION 'name_required';
  END IF;

  -- Minimal email shape check (the EF's auth.admin.createUser also validates;
  -- this keeps the RPC self-defending when called directly).
  IF v_email = '' OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'invalid_email';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM houses WHERE id = p_home_house_id) THEN
    RAISE EXCEPTION 'house_not_found';
  END IF;

  -- A new hire holds standard worker/admin capabilities; the initial role is one
  -- of the four. (BM is admin-only; sm/hm/bm require a house scope — set below.)
  IF p_role NOT IN ('sw', 'sm', 'hm', 'bm') THEN
    RAISE EXCEPTION 'invalid_role';
  END IF;

  -- Re-hiring (an existing public.users row) is not this RPC's job — fire/rehire
  -- is the reactivation path, and a duplicate insert would otherwise surface as a
  -- raw PK violation. Surface a clean reason.
  IF EXISTS (SELECT 1 FROM users WHERE user_id = p_user_id) THEN
    RAISE EXCEPTION 'worker_already_exists';
  END IF;

  -- ============================================================
  -- ③ create the app rows. sw → no scope; sm/hm/bm → scoped to the home house
  --    (user_roles_scope_required_check). is_active=true is the activation moment.
  -- ============================================================
  INSERT INTO users (user_id, name, email, phone, home_house_id, is_active, broadcast_subscribed)
  VALUES (p_user_id, v_name, v_email, NULLIF(btrim(COALESCE(p_phone, '')), ''),
          p_home_house_id, true, false);

  v_scope := CASE WHEN p_role = 'sw' THEN NULL ELSE p_home_house_id END;

  INSERT INTO user_roles (user_id, role, scope_house_id)
  VALUES (p_user_id, p_role, v_scope);

  -- ③b. Seed the worker's real house-membership history (20260719000001), so it
  --     reflects their actual hire date instead of transfer_worker's later
  --     self-heal sentinel. Open-ended, already applied (a hire is "the moment
  --     of activation" — there is nothing to defer).
  INSERT INTO user_house_memberships (user_id, house_id, effective_from, effective_to, applied_at, created_by)
  VALUES (p_user_id, p_home_house_id, (app_now() AT TIME ZONE 'America/New_York')::date, NULL, app_now(), p_initiator);

  -- ============================================================
  -- ④ return the created identity (the EF echoes this to the web layer)
  -- ============================================================
  RETURN jsonb_build_object(
    'hired',         true,
    'user_id',       p_user_id,
    'name',          v_name,
    'email',         v_email,
    'home_house_id', p_home_house_id,
    'role',          p_role
  );
END;
$$;

REVOKE ALL ON FUNCTION hire_worker(uuid, uuid, text, text, text, user_role_enum, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hire_worker(uuid, uuid, text, text, text, user_role_enum, text) TO service_role;

-- rollback:
-- (restore hire_worker to its 20260611000004 body, without the membership insert)
