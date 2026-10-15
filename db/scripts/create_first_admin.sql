-- Create the first admin only when no admin exists. Prints the created row without the password hash.
-- Running this again creates nothing.
--
-- psql:
--   psql "$DATABASE_URL" -v email='admin@company.com' -v name='Monitor Admin' -v password='Temp-Pass-2026!' -f db/scripts/create_first_admin.sql
--
-- GUI (pgAdmin, DBeaver, Render shell): replace each psql variable with a quoted literal, then run the whole script.
--   :'email'    -> 'admin@company.com'
--   :'name'     -> 'Monitor Admin'
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
  SELECT
    lower(:'email'),
    :'name',
    'admin',
    crypt(:'password', gen_salt('bf', 12)),
    false
  WHERE NOT EXISTS (
    SELECT 1
    FROM monitor_users
    WHERE role = 'admin'
  )
  RETURNING
    id,
    email,
    full_name,
    role,
    is_active,
    must_change_password,
    created_at
)
SELECT
  'created' AS result,
  id,
  email,
  full_name,
  role,
  is_active,
  must_change_password,
  created_at
FROM inserted
UNION ALL
SELECT
  'already_exists' AS result,
  id,
  email,
  full_name,
  role,
  is_active,
  must_change_password,
  created_at
FROM monitor_users
WHERE role = 'admin'
  AND NOT EXISTS (SELECT 1 FROM inserted);
