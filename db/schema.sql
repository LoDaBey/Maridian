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

-- ---------- workspaces (Monday-style containers for sheets) ----------
CREATE TABLE IF NOT EXISTS monitor_workspaces (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  description  text NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  color        text NOT NULL DEFAULT '#0073ea',
  created_by   uuid REFERENCES monitor_users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Only members see a workspace. Owners and admins invite and manage members.
CREATE TABLE IF NOT EXISTS monitor_workspace_members (
  workspace_id  uuid NOT NULL REFERENCES monitor_workspaces(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES monitor_users(id) ON DELETE CASCADE,
  role          text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  added_by      uuid REFERENCES monitor_users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS monitor_workspace_members_user_idx ON monitor_workspace_members(user_id);

-- A user joins a workspace only by accepting an invitation.
CREATE TABLE IF NOT EXISTS monitor_workspace_invitations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES monitor_workspaces(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES monitor_users(id) ON DELETE CASCADE,
  role          text NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  invited_by    uuid REFERENCES monitor_users(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','cancelled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  responded_at  timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS monitor_workspace_invitations_pending_idx
  ON monitor_workspace_invitations(workspace_id, user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS monitor_workspace_invitations_user_idx
  ON monitor_workspace_invitations(user_id) WHERE status = 'pending';

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

-- Sheet-level role: owner (creator, manages sharing), editor, assigned (edits only items
-- assigned to them or their team), viewer (read-only grid).
ALTER TABLE monitor_workbook_members
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'editor';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'monitor_workbook_members'::regclass
      AND conname = 'monitor_workbook_members_role_check'
  ) THEN
    ALTER TABLE monitor_workbook_members
      ADD CONSTRAINT monitor_workbook_members_role_check CHECK (role IN ('owner','editor','assigned','viewer'));
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'monitor_workbook_members'::regclass
      AND conname = 'monitor_workbook_members_role_check'
      AND pg_get_constraintdef(oid) LIKE '%assigned%'
  ) THEN
    ALTER TABLE monitor_workbook_members DROP CONSTRAINT monitor_workbook_members_role_check;
    ALTER TABLE monitor_workbook_members
      ADD CONSTRAINT monitor_workbook_members_role_check CHECK (role IN ('owner','editor','assigned','viewer'));
  END IF;
END $$;

INSERT INTO monitor_workbook_members (workbook_id, user_id, added_by, role)
SELECT w.id, w.created_by, w.created_by, 'owner'
FROM monitor_workbooks w
WHERE w.created_by IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE monitor_workbook_members m
SET role = 'owner'
FROM monitor_workbooks w
WHERE w.id = m.workbook_id AND w.created_by = m.user_id AND m.role <> 'owner';

-- Every sheet lives in a workspace.
ALTER TABLE monitor_workbooks
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES monitor_workspaces(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS monitor_workbooks_workspace_idx
  ON monitor_workbooks(workspace_id, position) WHERE archived_at IS NULL AND deleted_at IS NULL;

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

-- One-time move of sheets made before workspaces existed into "Main workspace".
-- Everyone who could open a sheet then keeps that access as a workspace member.
DO $$
DECLARE
  ws uuid;
  owner_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM monitor_workbooks WHERE workspace_id IS NULL) THEN
    SELECT id INTO ws FROM monitor_workspaces ORDER BY created_at LIMIT 1;
    IF ws IS NULL THEN
      SELECT id INTO owner_id FROM monitor_users
      WHERE role = 'admin' AND is_active = true
      ORDER BY created_at
      LIMIT 1;
      ws := gen_random_uuid();
      INSERT INTO monitor_workspaces (id, name, created_by) VALUES (ws, 'Main workspace', owner_id);
      INSERT INTO monitor_workspace_members (workspace_id, user_id, role, added_by)
      SELECT DISTINCT ws, m.user_id, 'member', owner_id
      FROM monitor_workbook_members m
      JOIN monitor_users u ON u.id = m.user_id
      WHERE u.is_active = true
      ON CONFLICT DO NOTHING;
      IF owner_id IS NOT NULL THEN
        INSERT INTO monitor_workspace_members (workspace_id, user_id, role, added_by)
        VALUES (ws, owner_id, 'owner', owner_id)
        ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'owner';
      END IF;
    END IF;
    UPDATE monitor_workbooks SET workspace_id = ws WHERE workspace_id IS NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM monitor_workbooks WHERE workspace_id IS NULL) THEN
    ALTER TABLE monitor_workbooks ALTER COLUMN workspace_id SET NOT NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS monitor_columns (
  id          uuid PRIMARY KEY,                        -- client generated
  sheet_id    uuid NOT NULL REFERENCES monitor_sheets(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  type        text NOT NULL CHECK (type IN ('text','long_text','link','date','person','status','number','checkbox','timeline','tags','dropdown','country','priority','rating','files','due_date','created_by','created_at','updated_at','item_id','email','phone','progress')),
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
      AND pg_get_constraintdef(oid) NOT LIKE '%progress%'
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
      CHECK (type IN ('text','long_text','link','date','person','status','number','checkbox','timeline','tags','dropdown','country','priority','rating','files','due_date','created_by','created_at','updated_at','item_id','email','phone','progress'));
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
  type        text NOT NULL CHECK (type IN ('mention','assign','reply','status','due','share')),
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
      AND pg_get_constraintdef(oid) NOT LIKE '%access_request%'
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
      CHECK (type IN ('mention','assign','reply','status','due','share','invitation','access_request'));
  END IF;
END $$;

-- Invitations and access requests aren't about one sheet.
ALTER TABLE monitor_notifications ALTER COLUMN sheet_id DROP NOT NULL;

-- ---------- richer invitations ----------
-- A note from the inviter, an optional sheet to open (with its access) once accepted,
-- and an expiry; "Resend" moves the expiry forward.
ALTER TABLE monitor_workspace_invitations ADD COLUMN IF NOT EXISTS message text NOT NULL DEFAULT '';
ALTER TABLE monitor_workspace_invitations
  ADD COLUMN IF NOT EXISTS workbook_id uuid REFERENCES monitor_workbooks(id) ON DELETE SET NULL;
ALTER TABLE monitor_workspace_invitations
  ADD COLUMN IF NOT EXISTS board_role text CHECK (board_role IN ('editor','assigned','viewer'));
ALTER TABLE monitor_workspace_invitations
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days');

ALTER TABLE monitor_updates
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ---------- protection (Google-Sheets style) ----------
-- A lock on a whole tab, one group, or one column's cells. Only the sheet owner,
-- workspace owners/admins, app admins and the listed editors can change or delete there.
CREATE TABLE IF NOT EXISTS monitor_protections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id    uuid NOT NULL REFERENCES monitor_sheets(id) ON DELETE CASCADE,
  scope       text NOT NULL CHECK (scope IN ('tab','group','column')),
  target_id   uuid,
  editors     uuid[] NOT NULL DEFAULT '{}',
  created_by  uuid REFERENCES monitor_users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'tab') = (target_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS monitor_protections_target_idx
  ON monitor_protections(sheet_id, scope, COALESCE(target_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Who can see a tab. NULL = everyone who can open the sheet. Managers always see it.
ALTER TABLE monitor_sheets ADD COLUMN IF NOT EXISTS visible_to uuid[];

-- ---------- workspace dashboards ----------
-- Shared chart widgets on a workspace dashboard. Each widget reads one or more sheets
-- (all their tabs) and stores its chart settings in `config`.
CREATE TABLE IF NOT EXISTS monitor_dashboard_widgets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES monitor_workspaces(id) ON DELETE CASCADE,
  title         text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 100),
  config        jsonb NOT NULL DEFAULT '{}'::jsonb,
  position      integer NOT NULL DEFAULT 0,
  created_by    uuid REFERENCES monitor_users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS monitor_dashboard_widgets_workspace_idx
  ON monitor_dashboard_widgets(workspace_id, position);

-- ---------- multiple dashboards per workspace ----------
CREATE TABLE IF NOT EXISTS monitor_dashboards (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES monitor_workspaces(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  description   text NOT NULL DEFAULT '' CHECK (length(description) <= 300),
  -- Default dashboard-wide filters (date range, people, column filters).
  filters       jsonb NOT NULL DEFAULT '{}'::jsonb,
  position      integer NOT NULL DEFAULT 0,
  created_by    uuid REFERENCES monitor_users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS monitor_dashboards_workspace_idx ON monitor_dashboards(workspace_id, position);

ALTER TABLE monitor_dashboard_widgets
  ADD COLUMN IF NOT EXISTS dashboard_id uuid REFERENCES monitor_dashboards(id) ON DELETE CASCADE;
-- Grid size: width in 12ths, height in rows.
ALTER TABLE monitor_dashboard_widgets ADD COLUMN IF NOT EXISTS width integer NOT NULL DEFAULT 6;
ALTER TABLE monitor_dashboard_widgets ADD COLUMN IF NOT EXISTS height integer NOT NULL DEFAULT 2;

-- One-time: widgets made before multiple dashboards move into a "Main dashboard".
DO $$
DECLARE
  ws record;
  dash uuid;
BEGIN
  FOR ws IN SELECT DISTINCT workspace_id FROM monitor_dashboard_widgets WHERE dashboard_id IS NULL LOOP
    dash := gen_random_uuid();
    INSERT INTO monitor_dashboards (id, workspace_id, name) VALUES (dash, ws.workspace_id, 'Main dashboard');
    UPDATE monitor_dashboard_widgets SET dashboard_id = dash WHERE workspace_id = ws.workspace_id AND dashboard_id IS NULL;
  END LOOP;
END $$;
CREATE INDEX IF NOT EXISTS monitor_dashboard_widgets_dashboard_idx ON monitor_dashboard_widgets(dashboard_id, position);

-- ---------- teams (a leader and members) ----------
CREATE TABLE IF NOT EXISTS monitor_teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  color       text NOT NULL DEFAULT '#579bfc',
  leader_id   uuid REFERENCES monitor_users(id) ON DELETE SET NULL,
  created_by  uuid REFERENCES monitor_users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS monitor_team_members (
  team_id     uuid NOT NULL REFERENCES monitor_teams(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES monitor_users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS monitor_team_members_user_idx ON monitor_team_members(user_id);

-- ---------- saved views (Google Sheets "filter views", shared on a tab) ----------
CREATE TABLE IF NOT EXISTS monitor_saved_views (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id    uuid NOT NULL REFERENCES monitor_sheets(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  view        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by  uuid REFERENCES monitor_users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS monitor_saved_views_sheet_idx ON monitor_saved_views(sheet_id, created_at);

-- ---------- cell comments (Google Sheets style threads on one cell) ----------
CREATE TABLE IF NOT EXISTS monitor_cell_comments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id     uuid NOT NULL REFERENCES monitor_sheets(id) ON DELETE CASCADE,
  row_id       uuid NOT NULL REFERENCES monitor_rows(id) ON DELETE CASCADE,
  column_id    uuid NOT NULL REFERENCES monitor_columns(id) ON DELETE CASCADE,
  author_id    uuid REFERENCES monitor_users(id) ON DELETE SET NULL,
  body         text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 2000),
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  resolved_by  uuid REFERENCES monitor_users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS monitor_cell_comments_open_idx
  ON monitor_cell_comments(sheet_id, row_id, column_id) WHERE resolved_at IS NULL;

-- ---------- tab versions (named snapshots that can be restored) ----------
CREATE TABLE IF NOT EXISTS monitor_sheet_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id    uuid NOT NULL REFERENCES monitor_sheets(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  row_count   integer NOT NULL DEFAULT 0,
  snapshot    bytea NOT NULL,
  created_by  uuid REFERENCES monitor_users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS monitor_sheet_versions_sheet_idx ON monitor_sheet_versions(sheet_id, created_at DESC);

-- ---------- favourites (starred sheets, per person) ----------
CREATE TABLE IF NOT EXISTS monitor_favorites (
  user_id      uuid NOT NULL REFERENCES monitor_users(id) ON DELETE CASCADE,
  workbook_id  uuid NOT NULL REFERENCES monitor_workbooks(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, workbook_id)
);

-- ---------- updated_at trigger ----------
CREATE OR REPLACE FUNCTION monitor_touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['monitor_users','monitor_teams','monitor_workspaces','monitor_dashboards','monitor_dashboard_widgets','monitor_protections','monitor_workbooks','monitor_sheets','monitor_columns','monitor_rows','monitor_groups','monitor_updates','monitor_update_replies'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t || '_touch') THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION monitor_touch_updated_at()', t || '_touch', t);
    END IF;
  END LOOP;
END $$;
