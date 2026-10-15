import type { PoolClient } from "pg";
import type { WorkbookMember } from "@/lib/db-types";
import { pool, query, tx } from "@/lib/db";
import { can, type Role } from "@/lib/rbac";

export type { WorkbookMember };

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function userCanAccessWorkbook(
  user: { id: string; role: Role },
  workbookId: string,
): Promise<boolean> {
  if (!isUuid(workbookId)) {
    return false;
  }
  if (can(user.role, "sheet.view_all")) {
    const rows = await query<{ ok: number }>(
      `SELECT 1 AS ok
       FROM monitor_workbooks
       WHERE id = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [workbookId],
    );
    return rows.length > 0;
  }
  const rows = await query<{ ok: number }>(
    `SELECT 1 AS ok
     FROM monitor_workbook_members m
     JOIN monitor_workbooks w ON w.id = m.workbook_id
     WHERE m.workbook_id = $1 AND m.user_id = $2 AND w.deleted_at IS NULL
     LIMIT 1`,
    [workbookId, user.id],
  );
  return rows.length > 0;
}

export async function userCanAccessSheet(
  user: { id: string; role: Role },
  sheetId: string,
): Promise<boolean> {
  if (!isUuid(sheetId)) {
    return false;
  }
  if (can(user.role, "sheet.view_all")) {
    const rows = await query<{ ok: number }>(
      `SELECT 1 AS ok
       FROM monitor_sheets s
       JOIN monitor_workbooks w ON w.id = s.workbook_id
       WHERE s.id = $1 AND w.deleted_at IS NULL
       LIMIT 1`,
      [sheetId],
    );
    return rows.length > 0;
  }
  const rows = await query<{ ok: number }>(
    `SELECT 1 AS ok
     FROM monitor_sheets s
     JOIN monitor_workbooks w ON w.id = s.workbook_id
     JOIN monitor_workbook_members m ON m.workbook_id = s.workbook_id
     WHERE s.id = $1 AND m.user_id = $2 AND w.deleted_at IS NULL
     LIMIT 1`,
    [sheetId, user.id],
  );
  return rows.length > 0;
}

export async function addWorkbookMember(
  client: PoolClient,
  input: { workbookId: string; userId: string; addedBy: string | null },
): Promise<void> {
  await client.query(
    `INSERT INTO monitor_workbook_members (workbook_id, user_id, added_by)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [input.workbookId, input.userId, input.addedBy],
  );
}

export async function addWorkbookMembers(
  client: PoolClient,
  input: { workbookId: string; userIds: string[]; addedBy: string | null },
): Promise<void> {
  for (const userId of input.userIds) {
    await addWorkbookMember(client, {
      workbookId: input.workbookId,
      userId,
      addedBy: input.addedBy,
    });
  }
}

export async function ensureMembersForSheet(
  client: PoolClient,
  input: { sheetId: string; userIds: string[]; addedBy: string },
): Promise<void> {
  if (input.userIds.length === 0) {
    return;
  }
  const sheet = await client.query<{ workbook_id: string }>(
    `SELECT workbook_id FROM monitor_sheets WHERE id = $1`,
    [input.sheetId],
  );
  const workbookId = sheet.rows[0]?.workbook_id;
  if (!workbookId) {
    return;
  }
  await addWorkbookMembers(client, {
    workbookId,
    userIds: input.userIds,
    addedBy: input.addedBy,
  });
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
    created_by: string | null;
    added_at: Date;
  }>(
    `SELECT m.user_id, u.full_name, u.email, u.role, u.avatar_color, w.created_by, m.created_at AS added_at
     FROM monitor_workbook_members m
     JOIN monitor_users u ON u.id = m.user_id
     JOIN monitor_workbooks w ON w.id = m.workbook_id
     WHERE m.workbook_id = $1
     ORDER BY (w.created_by = m.user_id) DESC, u.full_name`,
    [workbookId],
  );
  return rows.map((row) => ({
    userId: row.user_id,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    avatarColor: row.avatar_color,
    isOwner: row.created_by === row.user_id,
    addedAt: row.added_at.toISOString(),
  }));
}

export async function shareWorkbookWithUsers(input: {
  actorId: string;
  workbookId: string;
  userIds: string[];
}): Promise<void> {
  await tx(async (client) => {
    await addWorkbookMembers(client, {
      workbookId: input.workbookId,
      userIds: input.userIds,
      addedBy: input.actorId,
    });
  });
}

export async function unshareWorkbookUser(input: {
  workbookId: string;
  userId: string;
}): Promise<"ok" | "owner" | "missing"> {
  const workbooks = await query<{ created_by: string | null }>(
    `SELECT created_by FROM monitor_workbooks WHERE id = $1 AND deleted_at IS NULL`,
    [input.workbookId],
  );
  const workbook = workbooks[0];
  if (!workbook) {
    return "missing";
  }
  if (workbook.created_by === input.userId) {
    return "owner";
  }
  const result = await pool.query(
    `DELETE FROM monitor_workbook_members
     WHERE workbook_id = $1 AND user_id = $2`,
    [input.workbookId, input.userId],
  );
  return result.rowCount === 0 ? "missing" : "ok";
}
