-- Deactivate a user and delete that user's sessions.
--
-- psql:
--   psql "$DATABASE_URL" -v email='amal@company.com' -f db/scripts/deactivate_user.sql
--
-- GUI (pgAdmin, DBeaver, Render shell): replace the psql variable with a quoted literal, then run the whole script.
--   :'email' -> 'amal@company.com'

WITH updated AS (
  UPDATE monitor_users
  SET is_active = false
  WHERE email = lower(:'email')
  RETURNING id, email, full_name, role, is_active
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
  (SELECT count(*) FROM removed) AS sessions_deleted
FROM updated;
