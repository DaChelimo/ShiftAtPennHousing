-- Migration: T2-6 — Hire a worker (hire_worker RPC).
--
-- Spec sources:
--   BEHAVIORAL_SPECIFICATION.md §4.5 (hiring — "A new hire is added at any time
--     during a period and starts with no assigned shifts. From the moment of
--     activation, the new hire holds all standard SW capabilities." — they acquire
--     shifts only through the standard pathways: override-assign, permanent pickup,
--     weekly claim, float eligibility);
--   §6.6 / §2.3 / §2.6 (people-admin is HM/BM-only — use user_has_house_admin_role,
--     NOT the schedule-builder helper; do NOT widen to SM);
--   AGENTS.md hard invariant #1 (Harnwell training — a hire only sets a home house +
--     role; it assigns no shift, so it cannot place a non-Harnwell worker on the
--     Harnwell desk. The constraint bites at assignment-write points, which a new
--     hire reaches only through the standard gated pathways above. No extra guard
--     is required here beyond setting home_house_id truthfully).
--
-- Split (per the chunk contract): creating a worker spans auth.users (admin API /
-- service-role) + public.users + public.user_roles. The auth.admin.createUser call
-- lives in the `hire-worker` Edge Function (it is the only step that cannot run in
-- SQL); this RPC owns everything that CAN — the authz re-check, input validation,
-- and the two app-table inserts — so the contract is pgTAP-testable. The EF creates
-- the auth user, then calls this RPC with the resulting uuid IN ONE transaction
-- (the public rows + role). users.user_id FKs auth.users(id) DEFERRABLE.
--
-- Atomic: the users + user_roles inserts share one statement-level transaction; the
-- user_roles BM/worker-exclusion + scope-required triggers (20260527000003) and the
-- houses FK enforce the rest. A new hire is ALWAYS is_active=true,
-- broadcast_subscribed=false (the §4.5 "moment of activation"; HM/BM hires also have
-- the prevent_hm_bm_broadcast trigger guarding the flag).

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
-- DROP FUNCTION IF EXISTS hire_worker(uuid, uuid, text, text, text, user_role_enum, text);
