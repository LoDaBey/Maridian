-- Add a user. The email is stored in lower case. An existing email is left unchanged.
-- An invalid role is rejected by the monitor_users role check.
--
-- psql:
--   psql "$DATABASE_URL" -v email='amal@company.com' -v name='Amal Mahmoud' -v role='employee' -v password='Temp-Pass-2026!' -f db/scripts/add_user.sql
--
-- GUI (pgAdmin, DBeaver, Render shell): replace each psql variable with a quoted literal, then run the whole script.
--   :'email'    -> 'amal@company.com'
--   :'name'     -> 'Amal Mahmoud'
--   :'role'     -> 'employee'
--   :'password' -> 'Temp-Pass-2026!'
--
-- Passwords typed on the command line can remain in shell history.

WITH inserted AS (
  INSERT INTO monitor_users (
    email,
    full_name,
    role,
    password_hash,
    must_change_password
  )
  VALUES (
    lower(:'email'),
    :'name',
    :'role',
    crypt(:'password', gen_salt('bf', 12)),
    true
  )
  ON CONFLICT (email) DO NOTHING
  RETURNING id, email, full_name, role, is_active, must_change_password
)
SELECT
  'created' AS result,
  id,
  email,
  full_name,
  role,
  is_active,
  must_change_password
FROM inserted
UNION ALL
SELECT
  'already_exists' AS result,
  id,
  email,
  full_name,
  role,
  is_active,
  must_change_password
FROM monitor_users
WHERE email = lower(:'email')
  AND NOT EXISTS (SELECT 1 FROM inserted);
