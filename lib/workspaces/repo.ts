import { query, tx } from "@/lib/db";
import { can, type Role } from "@/lib/rbac";
import { visibleTabSql, visibleWorkbooksSql, type WorkspaceRole } from "@/lib/sheets/workbook-access";

export type { WorkspaceRole };

export class WorkspaceActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceActionError";
  }
}

type Viewer = { id: string; role: Role };

export interface WorkspaceSummary {
  id: string;
  name: string;
  description: string;
  color: string;
  /** The viewer's role. App admins who aren't members act as "owner". */
  role: WorkspaceRole;
  isMember: boolean;
  memberCount: number;
}

export interface WorkspaceBoard {
  id: string;
  name: string;
  workspaceId: string;
  firstTabId: string | null;
}

export interface WorkspaceMemberView {
  userId: string;
  fullName: string;
  email: string;
  avatarColor: string;
  role: WorkspaceRole;
  joinedAt: string;
}

export interface WorkspaceInvitationView {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  avatarColor: string;
  role: "admin" | "member";
  invitedByName: string | null;
  createdAt: string;
  message: string;
  expiresAt: string;
  expired: boolean;
  /** Sheet the invitation also opens, if any. */
  workbookName: string | null;
}

export interface MyInvitation {
  id: string;
  workspaceId: string;
  workspaceName: string;
  workspaceColor: string;
  role: "admin" | "member";
  invitedByName: string | null;
  createdAt: string;
  message: string;
  expiresAt: string;
  expired: boolean;
  workbookName: string | null;
}

/** How long an invitation stays open; "Resend" starts the clock again. */
export const INVITATION_DAYS = 14;

export { WORKSPACE_COLORS } from "./colors";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function isWorkspaceManager(role: WorkspaceRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

interface WorkspaceRow {
  id: string;
  name: string;
  description: string;
  color: string;
  member_role: WorkspaceRole | null;
  member_count: string | number;
}

function mapWorkspace(row: WorkspaceRow, viewer: Viewer): WorkspaceSummary {
  // Operations managers act as admins in every workspace they belong to.
  const role = row.member_role === "member" && can(viewer.role, "sheet.view_all") ? "admin" : (row.member_role ?? "owner");
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    role,
    isMember: row.member_role !== null,
    memberCount: Number(row.member_count),
  };
}

const WORKSPACE_SELECT = `
  SELECT ws.id, ws.name, ws.description, ws.color, me.role AS member_role,
         (SELECT count(*) FROM monitor_workspace_members c WHERE c.workspace_id = ws.id) AS member_count
  FROM monitor_workspaces ws
  LEFT JOIN monitor_workspace_members me ON me.workspace_id = ws.id AND me.user_id = $1`;

/** Workspaces the viewer belongs to. App admins see every workspace. */
export async function listMyWorkspaces(viewer: Viewer): Promise<WorkspaceSummary[]> {
  const all = can(viewer.role, "workspace.manage_all");
  const rows = await query<WorkspaceRow>(
    `${WORKSPACE_SELECT}
     ${all ? "" : "WHERE me.user_id IS NOT NULL"}
     ORDER BY lower(ws.name), ws.created_at`,
    [viewer.id],
  );
  return rows.map((row) => mapWorkspace(row, viewer));
}

export async function getWorkspace(viewer: Viewer, workspaceId: string): Promise<WorkspaceSummary | null> {
  if (!isUuid(workspaceId)) {
    return null;
  }
  const rows = await query<WorkspaceRow>(`${WORKSPACE_SELECT} WHERE ws.id = $2`, [viewer.id, workspaceId]);
  const row = rows[0];
  if (!row) {
    return null;
  }
  if (!row.member_role && !can(viewer.role, "workspace.manage_all")) {
    return null;
  }
  return mapWorkspace(row, viewer);
}

async function requireManager(viewer: Viewer, workspaceId: string): Promise<WorkspaceSummary> {
  const workspace = await getWorkspace(viewer, workspaceId);
  if (!workspace) {
    throw new WorkspaceActionError("Workspace not found.");
  }
  if (!isWorkspaceManager(workspace.role)) {
    throw new WorkspaceActionError("Only workspace owners and admins can do that.");
  }
  return workspace;
}

export async function createWorkspace(input: {
  actor: Viewer;
  name: string;
  description: string;
  color: string;
}): Promise<{ id: string }> {
  if (!can(input.actor.role, "workspace.create")) {
    throw new WorkspaceActionError("You don't have permission to create workspaces.");
  }
  return tx(async (client) => {
    const created = await client.query<{ id: string }>(
      `INSERT INTO monitor_workspaces (name, description, color, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [input.name, input.description, input.color, input.actor.id],
    );
    const id = created.rows[0]!.id;
    await client.query(
      `INSERT INTO monitor_workspace_members (workspace_id, user_id, role, added_by)
       VALUES ($1, $2, 'owner', $2)`,
      [id, input.actor.id],
    );
    return { id };
  });
}

export async function updateWorkspace(input: {
  actor: Viewer;
  workspaceId: string;
  name: string;
  description: string;
  color: string;
}): Promise<void> {
  await requireManager(input.actor, input.workspaceId);
  await query(
    `UPDATE monitor_workspaces SET name = $2, description = $3, color = $4 WHERE id = $1`,
    [input.workspaceId, input.name, input.description, input.color],
  );
}

/** Sheets whose protection and tab visibility this viewer manages. */
export async function listManagedWorkbookIds(viewer: Viewer): Promise<string[]> {
  if (can(viewer.role, "workspace.manage_all")) {
    const rows = await query<{ id: string }>(`SELECT id FROM monitor_workbooks WHERE deleted_at IS NULL`);
    return rows.map((row) => row.id);
  }
  const rows = await query<{ id: string }>(
    `SELECT w.id
     FROM monitor_workbooks w
     WHERE w.deleted_at IS NULL AND (
       EXISTS (
         SELECT 1 FROM monitor_workbook_members bm
         JOIN monitor_workspace_members wm ON wm.workspace_id = w.workspace_id AND wm.user_id = bm.user_id
         WHERE bm.workbook_id = w.id AND bm.user_id = $1 AND bm.role = 'owner'
       )
       OR EXISTS (
         SELECT 1 FROM monitor_workspace_members wm
         WHERE wm.workspace_id = w.workspace_id AND wm.user_id = $1
           AND (wm.role IN ('owner', 'admin')${can(viewer.role, "sheet.view_all") ? " OR TRUE" : ""})
       )
     )`,
    [viewer.id],
  );
  return rows.map((row) => row.id);
}

/** Sheets in a workspace the viewer can open, for the sidebar. */
export async function listWorkspaceBoards(viewer: Viewer): Promise<WorkspaceBoard[]> {
  const rows = await query<{ id: string; name: string; workspace_id: string; first_tab_id: string | null }>(
    `SELECT w.id, w.name, w.workspace_id,
            (SELECT s.id FROM monitor_sheets s
             WHERE s.workbook_id = w.id AND s.archived_at IS NULL AND ${visibleTabSql(viewer)}
             ORDER BY s.position LIMIT 1) AS first_tab_id
     FROM monitor_workbooks w
     WHERE w.archived_at IS NULL AND w.deleted_at IS NULL AND ${visibleWorkbooksSql(viewer)}
     ORDER BY w.position`,
    [viewer.id],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    workspaceId: row.workspace_id,
    firstTabId: row.first_tab_id,
  }));
}

export async function listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMemberView[]> {
  const rows = await query<{
    user_id: string;
    full_name: string;
    email: string;
    avatar_color: string;
    role: WorkspaceRole;
    created_at: Date;
  }>(
    `SELECT m.user_id, u.full_name, u.email, u.avatar_color, m.role, m.created_at
     FROM monitor_workspace_members m
     JOIN monitor_users u ON u.id = m.user_id
     WHERE m.workspace_id = $1
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.full_name`,
    [workspaceId],
  );
  return rows.map((row) => ({
    userId: row.user_id,
    fullName: row.full_name,
    email: row.email,
    avatarColor: row.avatar_color,
    role: row.role,
    joinedAt: row.created_at.toISOString(),
  }));
}

export async function listPendingInvitations(workspaceId: string): Promise<WorkspaceInvitationView[]> {
  const rows = await query<{
    id: string;
    user_id: string;
    full_name: string;
    email: string;
    avatar_color: string;
    role: "admin" | "member";
    invited_by_name: string | null;
    created_at: Date;
    message: string;
    expires_at: Date;
    workbook_name: string | null;
  }>(
    `SELECT i.id, i.user_id, u.full_name, u.email, u.avatar_color, i.role,
            inviter.full_name AS invited_by_name, i.created_at, i.message, i.expires_at, wb.name AS workbook_name
     FROM monitor_workspace_invitations i
     JOIN monitor_users u ON u.id = i.user_id
     LEFT JOIN monitor_users inviter ON inviter.id = i.invited_by
     LEFT JOIN monitor_workbooks wb ON wb.id = i.workbook_id AND wb.deleted_at IS NULL
     WHERE i.workspace_id = $1 AND i.status = 'pending'
     ORDER BY i.created_at DESC`,
    [workspaceId],
  );
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    fullName: row.full_name,
    email: row.email,
    avatarColor: row.avatar_color,
    role: row.role,
    invitedByName: row.invited_by_name,
    createdAt: row.created_at.toISOString(),
    message: row.message,
    expiresAt: row.expires_at.toISOString(),
    expired: row.expires_at.getTime() < Date.now(),
    workbookName: row.workbook_name,
  }));
}

export async function listMyInvitations(userId: string): Promise<MyInvitation[]> {
  const rows = await query<{
    id: string;
    workspace_id: string;
    workspace_name: string;
    workspace_color: string;
    role: "admin" | "member";
    invited_by_name: string | null;
    created_at: Date;
    message: string;
    expires_at: Date;
    workbook_name: string | null;
  }>(
    `SELECT i.id, i.workspace_id, ws.name AS workspace_name, ws.color AS workspace_color, i.role,
            inviter.full_name AS invited_by_name, i.created_at, i.message, i.expires_at, wb.name AS workbook_name
     FROM monitor_workspace_invitations i
     JOIN monitor_workspaces ws ON ws.id = i.workspace_id
     LEFT JOIN monitor_users inviter ON inviter.id = i.invited_by
     LEFT JOIN monitor_workbooks wb ON wb.id = i.workbook_id AND wb.deleted_at IS NULL
     WHERE i.user_id = $1 AND i.status = 'pending'
     ORDER BY i.created_at DESC`,
    [userId],
  );
  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    workspaceColor: row.workspace_color,
    role: row.role,
    invitedByName: row.invited_by_name,
    createdAt: row.created_at.toISOString(),
    message: row.message,
    expiresAt: row.expires_at.toISOString(),
    expired: row.expires_at.getTime() < Date.now(),
    workbookName: row.workbook_name,
  }));
}

/** Creates pending invitations. Skips people who are already members or already invited. */
export async function inviteToWorkspace(input: {
  actor: Viewer;
  workspaceId: string;
  userIds: string[];
  role: "admin" | "member";
  message?: string;
  /** Also open this sheet (in this workspace) for them once they accept. */
  workbookId?: string;
  boardRole?: "editor" | "assigned" | "viewer";
  /** The caller already checked the actor may share that sheet. */
  allowSheetSharer?: boolean;
}): Promise<string[]> {
  const workspace = await getWorkspace(input.actor, input.workspaceId);
  if (!workspace) {
    throw new WorkspaceActionError("Workspace not found.");
  }
  const manager = isWorkspaceManager(workspace.role);
  if (!manager && !input.allowSheetSharer && !(workspace.isMember && can(input.actor.role, "workspace.invite"))) {
    throw new WorkspaceActionError("Only workspace admins and project managers can invite people.");
  }
  if (!manager && input.role === "admin") {
    throw new WorkspaceActionError("Only workspace owners and admins can invite admins.");
  }
  // Re-inviting someone with an open invitation refreshes it (new note, sheet and expiry).
  const invited = await query<{ user_id: string }>(
    `INSERT INTO monitor_workspace_invitations (workspace_id, user_id, role, invited_by, message, workbook_id, board_role, expires_at)
     SELECT $1, u.id, $3, $4, $5,
            (SELECT w.id FROM monitor_workbooks w WHERE w.id = $6::uuid AND w.workspace_id = $1 AND w.deleted_at IS NULL),
            $7, now() + make_interval(days => $8)
     FROM monitor_users u
     WHERE u.id = ANY($2::uuid[])
       AND u.is_active = true
       AND NOT EXISTS (
         SELECT 1 FROM monitor_workspace_members m WHERE m.workspace_id = $1 AND m.user_id = u.id
       )
     ON CONFLICT (workspace_id, user_id) WHERE status = 'pending' DO UPDATE
       SET message = EXCLUDED.message,
           workbook_id = COALESCE(EXCLUDED.workbook_id, monitor_workspace_invitations.workbook_id),
           board_role = COALESCE(EXCLUDED.board_role, monitor_workspace_invitations.board_role),
           expires_at = EXCLUDED.expires_at
     RETURNING user_id`,
    [
      input.workspaceId,
      input.userIds,
      input.role,
      input.actor.id,
      (input.message ?? "").trim().slice(0, 500),
      input.workbookId ?? null,
      input.workbookId ? (input.boardRole ?? "editor") : null,
      INVITATION_DAYS,
    ],
  );
  return invited.map((row) => row.user_id);
}

export async function cancelInvitation(input: {
  actor: Viewer;
  invitationId: string;
}): Promise<{ userId: string; workspaceId: string }> {
  const rows = await query<{ workspace_id: string; user_id: string }>(
    `SELECT workspace_id, user_id FROM monitor_workspace_invitations WHERE id = $1 AND status = 'pending'`,
    [input.invitationId],
  );
  const invitation = rows[0];
  if (!invitation) {
    throw new WorkspaceActionError("Invitation not found.");
  }
  await requireManager(input.actor, invitation.workspace_id);
  await query(
    `UPDATE monitor_workspace_invitations SET status = 'cancelled', responded_at = now() WHERE id = $1`,
    [input.invitationId],
  );
  return { userId: invitation.user_id, workspaceId: invitation.workspace_id };
}

/** Moves the expiry forward. Workspace managers or whoever sent it may resend. */
export async function resendInvitation(input: { actor: Viewer; invitationId: string }): Promise<{ userId: string; workspaceId: string }> {
  const rows = await query<{ workspace_id: string; user_id: string; invited_by: string | null }>(
    `SELECT workspace_id, user_id, invited_by FROM monitor_workspace_invitations WHERE id = $1 AND status = 'pending'`,
    [input.invitationId],
  );
  const invitation = rows[0];
  if (!invitation) {
    throw new WorkspaceActionError("Invitation not found.");
  }
  if (invitation.invited_by !== input.actor.id) {
    await requireManager(input.actor, invitation.workspace_id);
  }
  await query(
    `UPDATE monitor_workspace_invitations SET expires_at = now() + make_interval(days => $2) WHERE id = $1`,
    [input.invitationId, INVITATION_DAYS],
  );
  return { userId: invitation.user_id, workspaceId: invitation.workspace_id };
}

export async function respondToInvitation(input: {
  userId: string;
  invitationId: string;
  accept: boolean;
}): Promise<{ workspaceId: string; workbookId: string | null }> {
  return tx(async (client) => {
    const rows = await client.query<{
      workspace_id: string;
      role: "admin" | "member";
      invited_by: string | null;
      workbook_id: string | null;
      board_role: "editor" | "assigned" | "viewer" | null;
      expired: boolean;
    }>(
      `SELECT workspace_id, role, invited_by, workbook_id, board_role, expires_at < now() AS expired
       FROM monitor_workspace_invitations
       WHERE id = $1 AND user_id = $2 AND status = 'pending'
       FOR UPDATE`,
      [input.invitationId, input.userId],
    );
    const invitation = rows.rows[0];
    if (!invitation) {
      throw new WorkspaceActionError("This invitation is no longer available.");
    }
    if (input.accept && invitation.expired) {
      throw new WorkspaceActionError("This invitation has expired. Ask the person who invited you to resend it.");
    }
    await client.query(
      `UPDATE monitor_workspace_invitations
       SET status = $2, responded_at = now()
       WHERE id = $1`,
      [input.invitationId, input.accept ? "accepted" : "declined"],
    );
    if (input.accept) {
      await client.query(
        `INSERT INTO monitor_workspace_members (workspace_id, user_id, role, added_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (workspace_id, user_id) DO NOTHING`,
        [invitation.workspace_id, input.userId, invitation.role, invitation.invited_by],
      );
      if (invitation.workbook_id) {
        await client.query(
          `INSERT INTO monitor_workbook_members (workbook_id, user_id, added_by, role)
           SELECT w.id, $2, $3, $4 FROM monitor_workbooks w WHERE w.id = $1 AND w.deleted_at IS NULL
           ON CONFLICT (workbook_id, user_id) DO NOTHING`,
          [invitation.workbook_id, input.userId, invitation.invited_by, invitation.board_role ?? "editor"],
        );
      }
    }
    return { workspaceId: invitation.workspace_id, workbookId: input.accept ? invitation.workbook_id : null };
  });
}

async function countOwners(workspaceId: string): Promise<number> {
  const rows = await query<{ count: string }>(
    `SELECT count(*) FROM monitor_workspace_members WHERE workspace_id = $1 AND role = 'owner'`,
    [workspaceId],
  );
  return Number(rows[0]?.count ?? 0);
}

async function memberRole(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
  const rows = await query<{ role: WorkspaceRole }>(
    `SELECT role FROM monitor_workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, userId],
  );
  return rows[0]?.role ?? null;
}

export async function changeMemberRole(input: {
  actor: Viewer;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
}): Promise<void> {
  const workspace = await requireManager(input.actor, input.workspaceId);
  const current = await memberRole(input.workspaceId, input.userId);
  if (!current) {
    throw new WorkspaceActionError("That person isn't in this workspace.");
  }
  // Only owners can make or unmake owners.
  if ((current === "owner" || input.role === "owner") && workspace.role !== "owner") {
    throw new WorkspaceActionError("Only a workspace owner can change owners.");
  }
  if (current === "owner" && input.role !== "owner" && (await countOwners(input.workspaceId)) <= 1) {
    throw new WorkspaceActionError("A workspace needs at least one owner.");
  }
  await query(
    `UPDATE monitor_workspace_members SET role = $3 WHERE workspace_id = $1 AND user_id = $2`,
    [input.workspaceId, input.userId, input.role],
  );
}

/**
 * Removes someone from a workspace and from every sheet in it.
 * Returns the sheet tab ids they lost, so open sessions can be closed.
 */
export async function removeMember(input: {
  actor: Viewer;
  workspaceId: string;
  userId: string;
}): Promise<string[]> {
  const leaving = input.actor.id === input.userId;
  const current = await memberRole(input.workspaceId, input.userId);
  if (!current) {
    throw new WorkspaceActionError("That person isn't in this workspace.");
  }
  if (!leaving) {
    const workspace = await requireManager(input.actor, input.workspaceId);
    if (current === "owner" && workspace.role !== "owner") {
      throw new WorkspaceActionError("Only a workspace owner can remove an owner.");
    }
  }
  if (current === "owner" && (await countOwners(input.workspaceId)) <= 1) {
    throw new WorkspaceActionError(
      leaving
        ? "You're the only owner. Make someone else an owner before leaving."
        : "A workspace needs at least one owner.",
    );
  }
  return tx(async (client) => {
    const sheets = await client.query<{ id: string }>(
      `SELECT s.id
       FROM monitor_sheets s
       JOIN monitor_workbooks w ON w.id = s.workbook_id
       WHERE w.workspace_id = $1`,
      [input.workspaceId],
    );
    await client.query(
      `DELETE FROM monitor_workbook_members bm
       USING monitor_workbooks w
       WHERE w.id = bm.workbook_id AND w.workspace_id = $1 AND bm.user_id = $2 AND bm.role <> 'owner'`,
      [input.workspaceId, input.userId],
    );
    await client.query(
      `DELETE FROM monitor_workspace_members WHERE workspace_id = $1 AND user_id = $2`,
      [input.workspaceId, input.userId],
    );
    return sheets.rows.map((row) => row.id);
  });
}

/** Active users who can still be invited (not members, no pending invitation). */
export async function listInvitableUsers(workspaceId: string): Promise<
  Array<{ id: string; fullName: string; email: string; avatarColor: string }>
> {
  const rows = await query<{ id: string; full_name: string; email: string; avatar_color: string }>(
    `SELECT u.id, u.full_name, u.email, u.avatar_color
     FROM monitor_users u
     WHERE u.is_active = true
       AND NOT EXISTS (SELECT 1 FROM monitor_workspace_members m WHERE m.workspace_id = $1 AND m.user_id = u.id)
       AND NOT EXISTS (
         SELECT 1 FROM monitor_workspace_invitations i
         WHERE i.workspace_id = $1 AND i.user_id = u.id AND i.status = 'pending'
       )
     ORDER BY u.full_name`,
    [workspaceId],
  );
  return rows.map((row) => ({
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    avatarColor: row.avatar_color,
  }));
}
