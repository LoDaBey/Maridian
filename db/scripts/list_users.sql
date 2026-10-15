-- List users without password hashes.
--
-- psql:
--   psql "$DATABASE_URL" -f db/scripts/list_users.sql
--
-- GUI (pgAdmin, DBeaver, Render shell): run this script as-is.

SELECT email, full_name, role, is_active, last_login_at
FROM monitor_users
ORDER BY role, full_name;
