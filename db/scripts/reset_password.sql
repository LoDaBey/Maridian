-- Set a new password, force a password change, and delete that user's sessions.
--
-- psql:
--   psql "$DATABASE_URL" -v email='amal@company.com' -v password='Temp-Pass-2026!' -f db/scripts/reset_password.sql
--
-- GUI (pgAdmin, DBeaver, Render shell): replace each psql variable with a quoted literal, then run the whole script.
--   :'email'    -> 'amal@company.com'
--   :'password' -> 'Temp-Pass-2026!'
--
-- Passwords typed on the command line can remain in shell history.

WITH updated AS (
  UPDATE monitor_users
  SET
    password_hash = crypt(:'password', gen_salt('bf', 12)),
    must_change_password = true
  WHERE email = lower(:'email')
  RETURNING id, email, full_name, role, is_active, must_change_password
),
removed AS (
  DELETE FROM monitor_user_sessions
  WHERE user_id IN (SELECT id FROM updated)
  RETURNING id
)
SELECT
  email,
  full_name,
  role,
  is_active,
  must_change_password,
  (SELECT count(*) FROM removed) AS sessions_deleted
FROM updated;
