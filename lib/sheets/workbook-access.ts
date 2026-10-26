import type { PoolClient } from "pg";
import type { WorkbookMember } from "@/lib/db-types";
import { query, tx } from "@/lib/db";
import { can, type Role } from "@/lib/rbac";

export type { WorkbookMember };

export type BoardRole = "owner" | "editor" | "assigned" | "viewer";
export type WorkspaceRole = "owner" | "admin" | "member";

export interface WorkbookAccess {
  workbookId: string;
  workspaceId: string;
  createdBy: string | null;
  /** What the viewer may do on the sheet's grid. */
  role: BoardRole;
  /** The viewer's role in the sheet's workspace, null for app admins who aren't members. */
  workspaceRole: WorkspaceRole | null;
  /** May add, remove and change people on this sheet. */
  canShare: boolean;
  /** Sheet owner, workspace owner/admin or app admin: manages protection and tab visibility. */
  canManage: boolean;
}

type Viewer = { id: string; role: Role };
type Runner = Pick<PoolClient, "query">;

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

interface AccessRow {
  workbook_id: string;
  workspace_id: string;
  created_by: string | null;
  workspace_role: WorkspaceRole | null;
  board_role: BoardRole | null;
  /** Only on tab lookups: who may see the tab (null = everyone with access). */
  visible_to?: string[] | null;
}

const ACCESS_SELECT = `
  SELECT w.id AS workbook_id, w.workspace_id, w.created_by,
         wm.role AS workspace_role, bm.role AS board_role
  FROM monitor_workbooks w
  LEFT JOIN monitor_workspace_members wm ON wm.workspace_id = w.workspace_id AND wm.user_id = $2
  LEFT JOIN monitor_workbook_members bm ON bm.workbook_id = w.id AND bm.user_id = $2`;

/**
 * Sheet access rules:
 * - App admins can open every sheet as an owner.
 * - Everyone else must be a member of the sheet's workspace, and then either
 *   be on the sheet (owner / editor / viewer) or hold "sheet.view_all".
 */
export function resolveAccess(viewer: Viewer, row: AccessRow | undefined): WorkbookAccess | null {
  if (!row) {
    return null;
  }
  const appAdmin = can(viewer.role, "workspace.manage_all");
  let role: BoardRole | null = null;
  if (appAdmin) {
    role = "owner";
  } else if (row.workspace_role) {
    role = row.board_role ?? (can(viewer.role, "sheet.view_all") ? "editor" : null);
  }
  if (!role) {
    return null;
  }
  // Operations managers act as admins in every workspace they belong to.
  const workspaceManager =
    row.workspace_role === "owner" || row.workspace_role === "admin" || (row.workspace_role !== null && can(viewer.role, "sheet.view_all"));
  const canManage = appAdmin || role === "owner" || workspaceManager;
  // A hidden tab is not there at all for people it isn't shown to.
  if (row.visible_to && !canManage && !row.visible_to.includes(viewer.id)) {
    return null;
  }
  return {
    workbookId: row.workbook_id,
    workspaceId: row.workspace_id,
    createdBy: row.created_by,
    role,
    workspaceRole: row.workspace_role,
    canShare:
      appAdmin ||
      role === "owner" ||
      workspaceManager ||
      (role === "editor" && can(viewer.role, "sheet.share")),
    canManage,
  };
}

export async function getWorkbookAccess(
  viewer: Viewer,
  workbookId: string,
  runner?: Runner,
): Promise<WorkbookAccess | null> {
  if (!isUuid(workbookId)) {
    return null;
  }
  const sql = `${ACCESS_SELECT} WHERE w.id = $1 AND w.deleted_at IS NULL`;
  const rows = runner
    ? (await runner.query<AccessRow>(sql, [workbookId, viewer.id])).rows
    : await query<AccessRow>(sql, [workbookId, viewer.id]);
  return resolveAccess(viewer, rows[0]);
}

export async function getSheetAccess(
  viewer: Viewer,
  sheetId: string,
  runner?: Runner,
): Promise<WorkbookAccess | null> {
  if (!isUuid(sheetId)) {
    return null;
  }
  const sql = `${ACCESS_SELECT.replace("bm.role AS board_role", "bm.role AS board_role, s.visible_to")}
    JOIN monitor_sheets s ON s.workbook_id = w.id
    WHERE s.id = $1 AND w.deleted_at IS NULL`;
  const rows = runner
    ? (await runner.query<AccessRow>(sql, [sheetId, viewer.id])).rows
    : await query<AccessRow>(sql, [sheetId, viewer.id]);
  return resolveAccess(viewer, rows[0]);
}

export async function userCanAccessWorkbook(viewer: Viewer, workbookId: string): Promise<boolean> {
  return (await getWorkbookAccess(viewer, workbookId)) !== null;
}

export async function userCanAccessSheet(viewer: Viewer, sheetId: string): Promise<boolean> {
  return (await getSheetAccess(viewer, sheetId)) !== null;
}

/**
 * SQL condition (alias `w` = monitor_workbooks) limiting rows to sheets the
 * viewer may open. `$1` must be the viewer id.
 */
export function visibleWorkbooksSql(viewer: Viewer): string {
  if (can(viewer.role, "workspace.manage_all")) {
    // Still references $1 so callers can always pass the viewer id.
    return "$1::uuid IS NOT NULL";
  }
  const viewAll = can(viewer.role, "sheet.view_all");
  return `EXISTS (
      SELECT 1 FROM monitor_workspace_members wm
      WHERE wm.workspace_id = w.workspace_id AND wm.user_id = $1
    ) AND (${viewAll ? "TRUE" : "FALSE"} OR EXISTS (
      SELECT 1 FROM monitor_workbook_members bm
      WHERE bm.workbook_id = w.id AND bm.user_id = $1
    ))`;
}

/**
 * SQL condition (alias `s` = monitor_sheets) limiting tabs to those the viewer may
 * see. `param` is the placeholder holding the viewer id.
 */
export function visibleTabSql(viewer: Viewer, param = "$1"): string {
  if (can(viewer.role, "workspace.manage_all")) {
    return `${param}::uuid IS NOT NULL`;
  }
  return `(s.visible_to IS NULL OR ${param}::uuid = ANY(s.visible_to)
    OR EXISTS (
      SELECT 1 FROM monitor_workbook_members tbm
      WHERE tbm.workbook_id = s.workbook_id AND tbm.user_id = ${param}::uuid AND tbm.role = 'owner'
    )
    OR EXISTS (
      SELECT 1 FROM monitor_workbooks tw
      JOIN monitor_workspace_members twm ON twm.workspace_id = tw.workspace_id
      WHERE tw.id = s.workbook_id AND twm.user_id = ${param}::uuid
        AND (twm.role IN ('owner', 'admin')${can(viewer.role, "sheet.view_all") ? " OR TRUE" : ""})
    ))`;
}

// ---------- protection ----------

export type ProtectionScope = "tab" | "group" | "column";

export interface Protection {
  id: string;
  scope: ProtectionScope;
  targetId: string | null;
  editors: string[];
}

/** What one person may not touch on a tab. */
export interface LockView {
  tab: boolean;
  columns: string[];
  groups: string[];
}

export async function loadProtections(sheetId: string, runner?: Runner): Promise<Protection[]> {
  const sql = `SELECT id, scope, target_id, editors FROM monitor_protections WHERE sheet_id = $1`;
  const rows = runner
    ? (await runner.query<{ id: string; scope: ProtectionScope; target_id: string | null; editors: string[] }>(sql, [sheetId])).rows
    : await query<{ id: string; scope: ProtectionScope; target_id: string | null; editors: string[] }>(sql, [sheetId]);
  return rows.map((row) => ({ id: row.id, scope: row.scope, targetId: row.target_id, editors: row.editors }));
}

/** Managers are never locked out; everyone else is unless a lock lists them. */
export function locksFor(access: WorkbookAccess, viewerId: string, protections: Protection[]): LockView {
  const view: LockView = { tab: false, columns: [], groups: [] };
  if (access.canManage) {
    return view;
  }
  for (const protection of protections) {
    if (protection.editors.includes(viewerId)) {
      continue;
    }
    if (protection.scope === "tab") {
      view.tab = true;
    } else if (protection.scope === "column" && protection.targetId) {
      view.columns.push(protection.targetId);
    } else if (protection.scope === "group" && protection.targetId) {
      view.groups.push(protection.targetId);
    }
  }
  return view;
}

export async function addWorkbookMember(
  client: Runner,
  input: { workbookId: string; userId: string; addedBy: string | null; role?: BoardRole },
): Promise<void> {
  await client.query(
    `INSERT INTO monitor_workbook_members (workbook_id, user_id, added_by, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [input.workbookId, input.userId, input.addedBy, input.role ?? "editor"],
  );
}

/** People assigned in a person column join the sheet, if they're in its workspace. */
export async function ensureMembersForSheet(
  client: Runner,
  input: { sheetId: string; userIds: string[]; addedBy: string },
): Promise<void> {
  if (input.userIds.length === 0) {
    return;
  }
  await client.query(
    `INSERT INTO monitor_workbook_members (workbook_id, user_id, added_by, role)
     SELECT s.workbook_id, wm.user_id, $3, 'editor'
     FROM monitor_sheets s
     JOIN monitor_workbooks w ON w.id = s.workbook_id
     JOIN monitor_workspace_members wm ON wm.workspace_id = w.workspace_id
     WHERE s.id = $1 AND wm.user_id = ANY($2::uuid[])
     ON CONFLICT DO NOTHING`,
    [input.sheetId, input.userIds, input.addedBy],
  );
}

export async function listWorkbookMembers(workbookId: string): Promise<WorkbookMember[]> {
  if (!isUuid(workbookId)) {
    return [];
  }
  const rows = await query<{
    user_id: string;
    full_name: string;
    email: string;
    role: Role;
    avatar_color: string;
    board_role: BoardRole;
    added_at: Date;
  }>(
    `SELECT m.user_id, u.full_name, u.email, u.role, u.avatar_color, m.role AS board_role,
            m.created_at AS added_at
     FROM monitor_workbook_members m
     JOIN monitor_users u ON u.id = m.user_id
     WHERE m.workbook_id = $1
     ORDER BY (m.role = 'owner') DESC, u.full_name`,
    [workbookId],
  );
  return rows.map((row) => ({
    userId: row.user_id,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    avatarColor: row.avatar_color,
    boardRole: row.board_role,
    isOwner: row.board_role === "owner",
    addedAt: row.added_at.toISOString(),
  }));
}

/** Adds workspace members to a sheet. Returns the ids that were newly added. */
export async function shareWorkbookWithUsers(input: {
  actorId: string;
  workbookId: string;
  userIds: string[];
  role: Exclude<BoardRole, "owner">;
}): Promise<string[]> {
  return tx(async (client) => {
    const added = await client.query<{ user_id: string }>(
      `INSERT INTO monitor_workbook_members (workbook_id, user_id, added_by, role)
       SELECT w.id, wm.user_id, $3, $4
       FROM monitor_workbooks w
       JOIN monitor_workspace_members wm ON wm.workspace_id = w.workspace_id
       WHERE w.id = $1 AND wm.user_id = ANY($2::uuid[])
       ON CONFLICT DO NOTHING
       RETURNING user_id`,
      [input.workbookId, input.userIds, input.actorId, input.role],
    );
    return added.rows.map((row) => row.user_id);
  });
}

export async function setWorkbookMemberRole(input: {
  workbookId: string;
  userId: string;
  role: Exclude<BoardRole, "owner">;
}): Promise<"ok" | "owner" | "missing"> {
  const rows = await query<{ role: BoardRole }>(
    `SELECT role FROM monitor_workbook_members WHERE workbook_id = $1 AND user_id = $2`,
    [input.workbookId, input.userId],
  );
  if (!rows[0]) {
    return "missing";
  }
  if (rows[0].role === "owner") {
    return "owner";
  }
  await query(
    `UPDATE monitor_workbook_members SET role = $3 WHERE workbook_id = $1 AND user_id = $2`,
    [input.workbookId, input.userId, input.role],
  );
  return "ok";
}

export async function unshareWorkbookUser(input: {
  workbookId: string;
  userId: string;
}): Promise<"ok" | "owner" | "missing"> {
  const rows = await query<{ role: BoardRole }>(
    `SELECT role FROM monitor_workbook_members WHERE workbook_id = $1 AND user_id = $2`,
    [input.workbookId, input.userId],
  );
  if (!rows[0]) {
    return "missing";
  }
  if (rows[0].role === "owner") {
    return "owner";
  }
  await query(`DELETE FROM monitor_workbook_members WHERE workbook_id = $1 AND user_id = $2`, [
    input.workbookId,
    input.userId,
  ]);
  return "ok";
}

export async function listSheetIdsForWorkbooks(workbookIds: string[]): Promise<string[]> {
  if (workbookIds.length === 0) {
    return [];
  }
  const rows = await query<{ id: string }>(
    `SELECT id FROM monitor_sheets WHERE workbook_id = ANY($1::uuid[])`,
    [workbookIds],
  );
  return rows.map((row) => row.id);
}
