"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth/current-user";
import { query, tx } from "@/lib/db";
import { insertNotifications } from "@/lib/notifications/repo";
import { emitToSheet, emitToUser } from "@/lib/realtime/emit";
import { getSheetAccess } from "@/lib/sheets/workbook-access";

export interface CellComment {
  id: string;
  rowId: string;
  columnId: string;
  authorName: string;
  authorColor: string;
  body: string;
  createdAt: string;
  mine: boolean;
}

const cellSchema = z.object({ sheetId: z.uuid(), rowId: z.uuid(), columnId: z.uuid() });

/** Open (unresolved) comments on a tab. Anyone who can open the tab can read and add them. */
export async function listCellComments(sheetId: string): Promise<CellComment[]> {
  const user = await requireUser();
  const id = z.uuid().safeParse(sheetId);
  if (!id.success || !(await getSheetAccess(user, id.data))) {
    return [];
  }
  const rows = await query<{
    id: string;
    row_id: string;
    column_id: string;
    author_id: string | null;
    full_name: string | null;
    avatar_color: string | null;
    body: string;
    created_at: Date;
  }>(
    `SELECT c.id, c.row_id, c.column_id, c.author_id, u.full_name, u.avatar_color, c.body, c.created_at
     FROM monitor_cell_comments c LEFT JOIN monitor_users u ON u.id = c.author_id
     WHERE c.sheet_id = $1 AND c.resolved_at IS NULL
     ORDER BY c.created_at
     LIMIT 5000`,
    [id.data],
  );
  return rows.map((row) => ({
    id: row.id,
    rowId: row.row_id,
    columnId: row.column_id,
    authorName: row.full_name ?? "Someone",
    authorColor: row.avatar_color ?? "#0073ea",
    body: row.body,
    createdAt: row.created_at.toISOString(),
    mine: row.author_id === user.id,
  }));
}

export async function addCellComment(input: { sheetId: string; rowId: string; columnId: string; body: string }): Promise<{ error: string }> {
  const user = await requireUser();
  const cell = cellSchema.safeParse(input);
  const body = z.string().trim().min(1, "Write a comment.").max(2000).safeParse(input.body);
  if (!cell.success) {
    return { error: "Cell not found." };
  }
  if (!body.success) {
    return { error: body.error.issues[0]?.message ?? "Write a comment." };
  }
  if (!(await getSheetAccess(user, cell.data.sheetId))) {
    return { error: "You don't have access to this sheet." };
  }
  const inserted = await query<{ id: string }>(
    `INSERT INTO monitor_cell_comments (sheet_id, row_id, column_id, author_id, body)
     SELECT $1, r.id, c.id, $4, $5
     FROM monitor_rows r JOIN monitor_columns c ON c.sheet_id = r.sheet_id
     WHERE r.sheet_id = $1 AND r.id = $2 AND c.id = $3
     RETURNING id`,
    [cell.data.sheetId, cell.data.rowId, cell.data.columnId, user.id, body.data],
  );
  if (inserted.length === 0) {
    return { error: "Cell not found." };
  }
  // Everyone else in the thread hears about the reply.
  const others = await query<{ author_id: string }>(
    `SELECT DISTINCT author_id FROM monitor_cell_comments
     WHERE sheet_id = $1 AND row_id = $2 AND column_id = $3 AND resolved_at IS NULL AND author_id IS NOT NULL AND author_id <> $4`,
    [cell.data.sheetId, cell.data.rowId, cell.data.columnId, user.id],
  );
  if (others.length > 0) {
    const created = await tx((client) =>
      insertNotifications(
        client,
        others.map((other) => ({
          userId: other.author_id,
          type: "reply" as const,
          sheetId: cell.data.sheetId,
          rowId: cell.data.rowId,
          actorId: user.id,
          payload: { excerpt: `commented: “${body.data.slice(0, 80)}”`, columnId: cell.data.columnId },
        })),
      ),
    );
    for (const notification of created) {
      emitToUser(notification.userId, "notification:created", notification);
    }
  }
  emitToSheet(cell.data.sheetId, "cell-comments:changed", { sheetId: cell.data.sheetId });
  return { error: "" };
}

/** Closes the thread on a cell (Google Sheets "Resolve"). */
export async function resolveCellComments(input: { sheetId: string; rowId: string; columnId: string }): Promise<{ error: string }> {
  const user = await requireUser();
  const cell = cellSchema.safeParse(input);
  if (!cell.success) {
    return { error: "Cell not found." };
  }
  const access = await getSheetAccess(user, cell.data.sheetId);
  if (!access || access.role === "viewer") {
    return { error: "Only people who can edit this sheet can resolve comments." };
  }
  await query(
    `UPDATE monitor_cell_comments SET resolved_at = now(), resolved_by = $4
     WHERE sheet_id = $1 AND row_id = $2 AND column_id = $3 AND resolved_at IS NULL`,
    [cell.data.sheetId, cell.data.rowId, cell.data.columnId, user.id],
  );
  emitToSheet(cell.data.sheetId, "cell-comments:changed", { sheetId: cell.data.sheetId });
  return { error: "" };
}
