-- Warmer, first-person copy for the HM/BM leave notification email (§2.6). The leaving
-- manager opens and sends this mailto themselves, so it reads as "I" rather than a
-- third-person notice, and drops the replacement's role label for a simpler close-off.
CREATE OR REPLACE FUNCTION craft_hm_leave_mailto(p_leave_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_leaving_name     text;
  v_replacement_name text;
  v_house_id         text;
  v_start_date       date;
  v_end_date         date;
  v_recipients       text;
  v_subject          text;
  v_body             text;
BEGIN
  SELECT leaving_user.name,
         replacement_user.name,
         leaving_user.home_house_id,
         hm_leave.start_date,
         hm_leave.end_date
    INTO v_leaving_name,
         v_replacement_name,
         v_house_id,
         v_start_date,
         v_end_date
  FROM hm_leave
  JOIN users AS leaving_user
    ON leaving_user.user_id = hm_leave.user_id
  LEFT JOIN users AS replacement_user
    ON replacement_user.user_id = hm_leave.replacement_user_id
  WHERE hm_leave.leave_id = p_leave_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT string_agg(DISTINCT users.email, ',' ORDER BY users.email)
    INTO v_recipients
  FROM users
  JOIN user_roles
    ON user_roles.user_id = users.user_id
   AND user_roles.role = 'sw'
  WHERE users.home_house_id = v_house_id
    AND users.is_active = true;

  v_subject := format('%s will be away from the desk', v_leaving_name);
  v_body := format(
    'Hey team, I wanted to let you know that I will not be at the office from %s to %s. If you have any problems, feel free to reach out to %s.',
    v_start_date,
    v_end_date,
    COALESCE(v_replacement_name, 'the project administrator')
  );

  RETURN 'mailto:' || COALESCE(v_recipients, '') ||
    '?subject=' || url_encode_mailto_component(v_subject) ||
    '&body=' || url_encode_mailto_component(v_body);
END;
$$;
