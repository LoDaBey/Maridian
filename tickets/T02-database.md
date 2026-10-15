# T02: Database schema and SQL scripts

> Read `tickets/00-README.md` first. **Scope rule:** change only what this ticket asks. Touch only the files under "Allowed changes". If something else seems needed, stop and ask in the hand-off.

## Goal
Create the full Postgres schema (all tables prefixed `monitor_`) as one **idempotent** SQL file, a migration runner, and the admin SQL scripts used to add and manage users directly in the Render DB.

## Allowed changes
`db/schema.sql`, `db/scripts/create_first_admin.sql`, `db/scripts/add_user.sql`, `db/scripts/reset_password.sql`, `db/scripts/deactivate_user.sql`, `db/scripts/list_users.sql`, `db/README.md`, `scripts/db-migrate.ts`, `package.json` (scripts only), `lib/db-types.ts`.

## Spec

### 1. `db/schema.sql`: use exactly this, re-runnable without errors
```sql
-- Monitor Sheets schema. Safe to run repeatedly.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- users & auth ----------
CREATE TABLE IF NOT EXISTS monitor_users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 text NOT NULL UNIQUE CHECK (email = lower(email) AND position('@' in email) > 1),
  full_name             text NOT NULL CHECK (length(trim(full_name)) > 0),
  role                  text NOT NULL DEFAULT 'employee'
                        CHECK (role IN ('employee','team_leader','project_manager','operations_manager','admin')),
  password_hash         text NOT NULL,                 -- bcrypt ($2a$/$2b$), cost 12
  is_active             boolean NOT NULL DEFAULT true,
  must_change_password  boolean NOT NULL DEFAULT true,
  avatar_color          text NOT NULL DEFAULT '#0073ea',
  last_login_at         timestamptz,
  created_by            uuid REFERENCES monitor_users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS monitor_user_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES monitor_users(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,                  -- sha256(hex) of the cookie token
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  ip            text,
  user_agent    text
);
CREATE INDEX IF NOT EXISTS monitor_user_sessions_user_idx ON monitor_user_sessions(user_id);
CREATE INDEX IF NOT EXISTS monitor_user_sessions_expires_idx ON monitor_user_sessions(expires_at);

-- ---------- sheets ----------
CREATE TABLE IF NOT EXISTS monitor_sheets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  position     text COLLATE "C" NOT NULL,             -- fractional index for tab order
  direction    text NOT NULL DEFAULT 'rtl' CHECK (direction IN ('rtl','ltr')),
  version      bigint NOT NULL DEFAULT 0,             -- bumped on every op; total order per sheet
  created_by   uuid REFERENCES monitor_users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz,
  archived_by  uuid REFERENCES monitor_users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS monitor_sheets_active_idx ON monitor_sheets(position) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS monitor_columns (
  id          uuid PRIMARY KEY,                        -- client generated
  sheet_id    uuid NOT NULL REFERENCES monitor_sheets(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  type        text NOT NULL CHECK (type IN ('text','long_text','link','date','person','status','number','checkbox')),
  position    text COLLATE "C" NOT NULL,
  width       integer NOT NULL DEFAULT 180 CHECK (width BETWEEN 60 and 800),
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,     -- e.g. status options, person multi
  created_by  uuid REFERENCES monitor_users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS monitor_columns_sheet_idx ON monitor_columns(sheet_id, position) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS monitor_rows (
  id          uuid PRIMARY KEY,                        -- client generated
  sheet_id    uuid NOT NULL REFERENCES monitor_sheets(id) ON DELETE CASCADE,
  position    text COLLATE "C" NOT NULL,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,     -- { "<column_id>": <value>, ... }
  created_by  uuid REFERENCES monitor_users(id) ON DELETE SET NULL,
  updated_by  uuid REFERENCES monitor_users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS monitor_rows_sheet_idx ON monitor_rows(sheet_id, position) WHERE deleted_at IS NULL;

-- ---------- audit ----------
CREATE TABLE IF NOT EXISTS monitor_activity_log (
  id             bigserial PRIMARY KEY,
  sheet_id       uuid REFERENCES monitor_sheets(id) ON DELETE CASCADE,
  user_id        uuid REFERENCES monitor_users(id) ON DELETE SET NULL,
  action         text NOT NULL,            -- op type, e.g. 'cell.set', 'row.insert', 'user.create'
  row_id         uuid,
  column_id      uuid,
  old_value      jsonb,
  new_value      jsonb,
  sheet_version  bigint,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS monitor_activity_sheet_idx ON monitor_activity_log(sheet_id, id DESC);
CREATE INDEX IF NOT EXISTS monitor_activity_row_idx   ON monitor_activity_log(row_id, id DESC);

-- ---------- updated_at trigger ----------
CREATE OR REPLACE FUNCTION monitor_touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['monitor_users','monitor_sheets','monitor_columns','monitor_rows'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t || '_touch') THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION monitor_touch_updated_at()', t || '_touch', t);
    END IF;
  END LOOP;
END $$;
```

**Cell value shapes** (document these in `db/README.md`. T07 enforces them):
| type | JSON value |
|---|---|
| text, long_text | `"string"` (max 10 000 chars) |
| link | `{ "url": "https://…", "label": "optional" }` |
| date | `"YYYY-MM-DD"` |
| person | `["<user uuid>", …]` (multi) |
| status | `"<option id>"`. Options live in `column.settings.options: [{ id, label, color }]` |
| number | `123.45` |
| checkbox | `true / false` |
| empty | key absent (never store `null` or `""`, delete the key instead) |

### 2. `scripts/db-migrate.ts` + `package.json` script `"db:migrate": "tsx scripts/db-migrate.ts"`
Reads `db/schema.sql` and runs it in one transaction using `lib/db.ts`. Prints "Schema applied". Exits non-zero on error.

### 3. Admin SQL scripts (pgcrypto bcrypt, so they're compatible with `bcryptjs.compare`)
Each script works **both** in `psql` with `-v` variables **and** by hand-editing the clearly marked placeholders in a GUI (pgAdmin/DBeaver/Render shell). Put the psql usage line at the top as a comment.

- `create_first_admin.sql`: inserts the first admin **only if no admin exists**:
  `crypt(:'password', gen_salt('bf', 12))`, `role='admin'`, `must_change_password=false`. Prints the created row (no hash).
- `add_user.sql`: params `email`, `name`, `role`, `password`. Lower-cases the email. Inserts with `must_change_password=true`. `ON CONFLICT (email) DO NOTHING`, then `RAISE NOTICE`/select so the admin sees whether it was created or already existed. Rejects invalid roles through the CHECK.
- `reset_password.sql`: params `email`, `password`. Sets the hash, sets `must_change_password=true`, and **deletes that user's sessions**.
- `deactivate_user.sql`: param `email`. Sets `is_active=false` and deletes sessions.
- `list_users.sql`: email, full_name, role, is_active, last_login_at, ordered by role then name.

Example usage line:
```
psql "$DATABASE_URL" -v email='amal@company.com' -v name='Amal Mahmoud' -v role='employee' -v password='Temp-Pass-2026!' -f db/scripts/add_user.sql
```

### 4. `lib/db-types.ts`
TypeScript row types for every table (`MonitorUser` without `password_hash` + `MonitorUserWithHash`, `Role` union, `ColumnType` union, `Sheet`, `Column`, `Row`, `ActivityEntry`).

### 5. `db/README.md`
How to run the migration against Render (External URL + `DATABASE_SSL=true`), how to run each script (psql + GUI), the cell value table, and a warning that passwords typed into SQL may stay in shell history.

## Acceptance criteria
- [ ] `npm run db:migrate` succeeds on an empty Render DB **and** again on the same DB (idempotent).
- [ ] `create_first_admin.sql` creates exactly one admin. Running it again creates nothing.
- [ ] A hash made by `add_user.sql` verifies with `bcryptjs.compare(password, hash)`. Prove it with a one-off check and paste the output (true).
- [ ] An invalid role or an upper-case email insert is rejected or normalised as specified.
- [ ] `reset_password.sql` and `deactivate_user.sql` delete that user's sessions.
- [ ] Every table name starts with `monitor_`.

## Out of scope
Any app code that reads these tables (T03+). Seed sheets (T06 creates a default sheet).
