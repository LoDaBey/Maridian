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

-- ---------- workbooks (home-page files) and sheets (tabs / grids) ----------
CREATE TABLE IF NOT EXISTS monitor_workbooks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  position     text COLLATE "C" NOT NULL,
  created_by   uuid REFERENCES monitor_users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz,
  archived_by  uuid REFERENCES monitor_users(id) ON DELETE SET NULL
);
ALTER TABLE monitor_workbooks
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE monitor_workbooks
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES monitor_users(id) ON DELETE SET NULL;
DROP INDEX IF EXISTS monitor_workbooks_active_idx;
CREATE INDEX IF NOT EXISTS monitor_workbooks_active_idx ON monitor_workbooks(position) WHERE archived_at IS NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS monitor_workbooks_deleted_idx ON monitor_workbooks(deleted_at) WHERE deleted_at IS NOT NULL;

-- Who can see a workbook. Creator is always a member. New sheets start with the creator only.
CREATE TABLE IF NOT EXISTS monitor_workbook_members (
  workbook_id  uuid NOT NULL REFERENCES monitor_workbooks(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES monitor_users(id) ON DELETE CASCADE,
  added_by     uuid REFERENCES monitor_users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workbook_id, user_id)
);
CREATE INDEX IF NOT EXISTS monitor_workbook_members_user_idx ON monitor_workbook_members(user_id);

-- Keep existing sheets visible to everyone who already uses the app.
INSERT INTO monitor_workbook_members (workbook_id, user_id, added_by)
SELECT w.id, u.id, w.created_by
FROM monitor_workbooks w
CROSS JOIN monitor_users u
WHERE u.is_active = true
ON CONFLICT DO NOTHING;

INSERT INTO monitor_workbook_members (workbook_id, user_id, added_by)
SELECT w.id, w.created_by, w.created_by
FROM monitor_workbooks w
WHERE w.created_by IS NOT NULL
ON CONFLICT DO NOTHING;

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

ALTER TABLE monitor_sheets
  ADD COLUMN IF NOT EXISTS workbook_id uuid REFERENCES monitor_workbooks(id) ON DELETE CASCADE;

DO $$
DECLARE
  r record;
  wid uuid;
BEGIN
  FOR r IN
    SELECT id, name, position, created_by, created_at, updated_at, archived_at, archived_by
    FROM monitor_sheets
    WHERE workbook_id IS NULL
  LOOP
    wid := gen_random_uuid();
    INSERT INTO monitor_workbooks (
      id, name, position, created_by, created_at, updated_at, archived_at, archived_by
    )
    VALUES (
      wid, r.name, r.position, r.created_by, r.created_at, r.updated_at, r.archived_at, r.archived_by
    );
    UPDATE monitor_sheets SET workbook_id = wid, name = 'Tab 1' WHERE id = r.id;
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM monitor_sheets WHERE workbook_id IS NULL) THEN
    RAISE EXCEPTION 'monitor_sheets.workbook_id backfill failed';
  END IF;
  BEGIN
    ALTER TABLE monitor_sheets ALTER COLUMN workbook_id SET NOT NULL;
  EXCEPTION
    WHEN others THEN
      NULL;
  END;
END $$;

CREATE INDEX IF NOT EXISTS monitor_sheets_workbook_idx
  ON monitor_sheets(workbook_id, position) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS monitor_columns (
  id          uuid PRIMARY KEY,                        -- client generated
  sheet_id    uuid NOT NULL REFERENCES monitor_sheets(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  type        text NOT NULL CHECK (type IN ('text','long_text','link','date','person','status','number','checkbox','timeline','tags','dropdown','country','priority','rating','files','due_date','created_by','created_at','updated_at','item_id')),
  position    text COLLATE "C" NOT NULL,
  width       integer NOT NULL DEFAULT 180 CHECK (width BETWEEN 60 and 800),
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,     -- e.g. status options, person multi
  created_by  uuid REFERENCES monitor_users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS monitor_columns_sheet_idx ON monitor_columns(sheet_id, position) WHERE deleted_at IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'monitor_columns'::regclass
      AND conname = 'monitor_columns_type_check'
      AND pg_get_constraintdef(oid) NOT LIKE '%due_date%'
  ) THEN
    ALTER TABLE monitor_columns DROP CONSTRAINT monitor_columns_type_check;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'monitor_columns'::regclass
      AND conname = 'monitor_columns_type_check'
  ) THEN
    ALTER TABLE monitor_columns
      ADD CONSTRAINT monitor_columns_type_check
      CHECK (type IN ('text','long_text','link','date','person','status','number','checkbox','timeline','tags','dropdown','country','priority','rating','files','due_date','created_by','created_at','updated_at','item_id'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS monitor_groups (
  id          uuid PRIMARY KEY,
  sheet_id    uuid NOT NULL REFERENCES monitor_sheets(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  color       text NOT NULL DEFAULT '#579bfc' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  position    text COLLATE "C" NOT NULL,
  created_by  uuid REFERENCES monitor_users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS monitor_groups_sheet_idx ON monitor_groups(sheet_id, position) WHERE deleted_at IS NULL;

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

ALTER TABLE monitor_rows
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES monitor_groups(id) ON DELETE SET NULL;
ALTER TABLE monitor_rows
  ADD COLUMN IF NOT EXISTS item_number integer;

INSERT INTO monitor_groups (id, sheet_id, name, color, position, created_by, created_at)
SELECT gen_random_uuid(), s.id, 'Items', '#579bfc', 'a0', s.created_by, s.created_at
FROM monitor_sheets s
WHERE NOT EXISTS (
  SELECT 1 FROM monitor_groups g WHERE g.sheet_id = s.id AND g.deleted_at IS NULL
);

UPDATE monitor_rows r
SET group_id = g.id
FROM (
  SELECT DISTINCT ON (sheet_id) id, sheet_id
  FROM monitor_groups
  WHERE deleted_at IS NULL
  ORDER BY sheet_id, position, created_at
) g
WHERE r.sheet_id = g.sheet_id AND r.group_id IS NULL;

WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY sheet_id ORDER BY created_at, id) AS n
  FROM monitor_rows
  WHERE item_number IS NULL
)
UPDATE monitor_rows r
SET item_number = numbered.n
FROM numbered
WHERE r.id = numbered.id;

CREATE UNIQUE INDEX IF NOT EXISTS monitor_rows_item_number_idx
  ON monitor_rows(sheet_id, item_number);
CREATE INDEX IF NOT EXISTS monitor_rows_group_idx
  ON monitor_rows(sheet_id, group_id, position) WHERE deleted_at IS NULL;

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
CREATE TABLE IF NOT EXISTS monitor_sheet_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  payload     jsonb NOT NULL DEFAULT '{"tabs":[]}'::jsonb,
  created_by  uuid REFERENCES monitor_users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS monitor_sheet_templates_created_idx ON monitor_sheet_templates(created_at DESC);

CREATE INDEX IF NOT EXISTS monitor_activity_sheet_idx ON monitor_activity_log(sheet_id, id DESC);
CREATE INDEX IF NOT EXISTS monitor_activity_row_idx   ON monitor_activity_log(row_id, id DESC);

CREATE TABLE IF NOT EXISTS monitor_updates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id    uuid NOT NULL REFERENCES monitor_sheets(id) ON DELETE CASCADE,
  row_id      uuid NOT NULL REFERENCES monitor_rows(id) ON DELETE CASCADE,
  body        text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 8000),
  author_id   uuid NOT NULL REFERENCES monitor_users(id) ON DELETE CASCADE,
  mentions    uuid[] NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS monitor_updates_row_idx
  ON monitor_updates(sheet_id, row_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS monitor_update_replies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  update_id   uuid NOT NULL REFERENCES monitor_updates(id) ON DELETE CASCADE,
  sheet_id    uuid NOT NULL REFERENCES monitor_sheets(id) ON DELETE CASCADE,
  row_id      uuid NOT NULL,
  body        text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 8000),
  author_id   uuid NOT NULL REFERENCES monitor_users(id) ON DELETE CASCADE,
  mentions    uuid[] NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS monitor_update_replies_update_idx
  ON monitor_update_replies(update_id, created_at) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS monitor_update_reactions (
  update_id   uuid NOT NULL REFERENCES monitor_updates(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES monitor_users(id) ON DELETE CASCADE,
  emoji       text NOT NULL DEFAULT '👍' CHECK (length(emoji) BETWEEN 1 AND 16),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (update_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS monitor_update_reads (
  update_id   uuid NOT NULL REFERENCES monitor_updates(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES monitor_users(id) ON DELETE CASCADE,
  seen_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (update_id, user_id)
);

CREATE TABLE IF NOT EXISTS monitor_notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES monitor_users(id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN ('mention','assign','reply','status','due')),
  sheet_id    uuid NOT NULL REFERENCES monitor_sheets(id) ON DELETE CASCADE,
  row_id      uuid,
  actor_id    uuid REFERENCES monitor_users(id) ON DELETE SET NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);
CREATE INDEX IF NOT EXISTS monitor_notifications_user_idx
  ON monitor_notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS monitor_notifications_unread_idx
  ON monitor_notifications(user_id, created_at DESC) WHERE read_at IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'monitor_notifications'::regclass
      AND conname = 'monitor_notifications_type_check'
      AND pg_get_constraintdef(oid) NOT LIKE '%due%'
  ) THEN
    ALTER TABLE monitor_notifications DROP CONSTRAINT monitor_notifications_type_check;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'monitor_notifications'::regclass
      AND conname = 'monitor_notifications_type_check'
  ) THEN
    ALTER TABLE monitor_notifications
      ADD CONSTRAINT monitor_notifications_type_check
      CHECK (type IN ('mention','assign','reply','status','due'));
  END IF;
END $$;

ALTER TABLE monitor_updates
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ---------- updated_at trigger ----------
CREATE OR REPLACE FUNCTION monitor_touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['monitor_users','monitor_workbooks','monitor_sheets','monitor_columns','monitor_rows','monitor_groups','monitor_updates','monitor_update_replies'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t || '_touch') THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION monitor_touch_updated_at()', t || '_touch', t);
    END IF;
  END LOOP;
END $$;
