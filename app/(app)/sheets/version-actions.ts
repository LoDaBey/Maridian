"use server";

import { gunzipSync, gzipSync } from "node:zlib";
import { z } from "zod";
import { requireUser } from "@/lib/auth/current-user";
import { query, tx } from "@/lib/db";
import { emitToSheet } from "@/lib/realtime/emit";
import { loadSnapshot, type SheetSnapshot } from "@/lib/sheets/snapshot";
import { getSheetAccess } from "@/lib/sheets/workbook-access";

/** Versions kept per tab; the oldest go first. */
const KEEP = 50;

export interface SheetVersion {
  id: string;
  name: string;
  rowCount: number;
  createdByName: string | null;
  createdAt: string;
}

async function snapshotVersion(sheetId: string, name: string, userId: string): Promise<void> {
  const snapshot = await loadSnapshot(sheetId);
  if (!snapshot) {
    return;
  }
  const body = gzipSync(JSON.stringify({ groups: snapshot.groups, columns: snapshot.columns, rows: snapshot.rows }));
  await query(
    `INSERT INTO monitor_sheet_versions (sheet_id, name, row_count, snapshot, created_by) VALUES ($1, $2, $3, $4, $5)`,
    [sheetId, name.slice(0, 80), snapshot.rows.length, body, userId],
  );
  await query(
    `DELETE FROM monitor_sheet_versions WHERE sheet_id = $1 AND id NOT IN (
       SELECT id FROM monitor_sheet_versions WHERE sheet_id = $1 ORDER BY created_at DESC LIMIT ${KEEP})`,
    [sheetId],
  );
}

export async function listVersions(sheetId: string): Promise<{ versions: SheetVersion[]; canRestore: boolean; canSave: boolean }> {
  const user = await requireUser();
  const id = z.uuid().safeParse(sheetId);
  const access = id.success ? await getSheetAccess(user, id.data) : null;
  if (!id.success || !access) {
    return { versions: [], canRestore: false, canSave: false };
  }
  const rows = await query<{ id: string; name: string; row_count: number; full_name: string | null; created_at: Date }>(
    `SELECT v.id, v.name, v.row_count, u.full_name, v.created_at
     FROM monitor_sheet_versions v LEFT JOIN monitor_users u ON u.id = v.created_by
     WHERE v.sheet_id = $1 ORDER BY v.created_at DESC`,
    [id.data],
  );
  return {
    versions: rows.map((row) => ({
      id: row.id,
      name: row.name,
      rowCount: row.row_count,
      createdByName: row.full_name,
      createdAt: row.created_at.toISOString(),
    })),
    canRestore: access.canManage,
    canSave: access.role !== "viewer",
  };
}

export async function saveVersion(input: { sheetId: string; name: string }): Promise<{ error: string }> {
  const user = await requireUser();
  const id = z.uuid().safeParse(input.sheetId);
  const name = z.string().trim().min(1, "Name this version.").max(80).safeParse(input.name);
  if (!id.success) {
    return { error: "Sheet not found." };
  }
  if (!name.success) {
    return { error: name.error.issues[0]?.message ?? "Name this version." };
  }
  const access = await getSheetAccess(user, id.data);
  if (!access || access.role === "viewer") {
    return { error: "Only people who can edit this sheet can save versions." };
  }
  await snapshotVersion(id.data, name.data, user.id);
  return { error: "" };
}

/**
 * Puts the tab back the way it was in a version: columns, groups and rows. The current
 * state is saved as a version first, so a restore can itself be undone.
 */
export async function restoreVersion(input: { sheetId: string; versionId: string }): Promise<{ error: string }> {
  const user = await requireUser();
  const sheetId = z.uuid().safeParse(input.sheetId);
  const versionId = z.uuid().safeParse(input.versionId);
  if (!sheetId.success || !versionId.success) {
    return { error: "Version not found." };
  }
  const access = await getSheetAccess(user, sheetId.data);
  if (!access?.canManage) {
    return { error: "Only the sheet owner or a workspace admin can restore a version." };
  }
  const found = await query<{ name: string; snapshot: Buffer }>(
    `SELECT name, snapshot FROM monitor_sheet_versions WHERE id = $1 AND sheet_id = $2`,
    [versionId.data, sheetId.data],
  );
  const version = found[0];
  if (!version) {
    return { error: "Version not found." };
  }
  const saved = JSON.parse(gunzipSync(version.snapshot).toString("utf8")) as Pick<SheetSnapshot, "groups" | "columns" | "rows">;
  await snapshotVersion(sheetId.data, `Before restoring “${version.name}”`, user.id);

  await tx(async (client) => {
    await client.query(`SELECT id FROM monitor_sheets WHERE id = $1 FOR UPDATE`, [sheetId.data]);
    // Groups and columns: bring back the saved ones as they were, retire the rest.
    await client.query(
      `INSERT INTO monitor_groups (id, sheet_id, name, color, position)
       SELECT g.id, $1, g.name, g.color, g.position FROM jsonb_to_recordset($2::jsonb) AS g(id uuid, name text, color text, position text)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color, position = EXCLUDED.position, deleted_at = NULL`,
      [sheetId.data, JSON.stringify(saved.groups)],
    );
    await client.query(
      `UPDATE monitor_groups SET deleted_at = now()
       WHERE sheet_id = $1 AND deleted_at IS NULL AND NOT (id = ANY($2::uuid[]))`,
      [sheetId.data, saved.groups.map((group) => group.id)],
    );
    await client.query(
      `INSERT INTO monitor_columns (id, sheet_id, name, type, position, width, settings)
       SELECT c.id, $1, c.name, c.type, c.position, c.width, c.settings
       FROM jsonb_to_recordset($2::jsonb) AS c(id uuid, name text, type text, position text, width int, settings jsonb)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, position = EXCLUDED.position,
         width = EXCLUDED.width, settings = EXCLUDED.settings, deleted_at = NULL`,
      [sheetId.data, JSON.stringify(saved.columns)],
    );
    await client.query(
      `UPDATE monitor_columns SET deleted_at = now()
       WHERE sheet_id = $1 AND deleted_at IS NULL AND NOT (id = ANY($2::uuid[]))`,
      [sheetId.data, saved.columns.map((column) => column.id)],
    );
    // Rows: restore saved values (keeping item numbers), soft-delete rows added since.
    await client.query(
      `UPDATE monitor_rows SET deleted_at = now()
       WHERE sheet_id = $1 AND deleted_at IS NULL AND NOT (id = ANY($2::uuid[]))`,
      [sheetId.data, saved.rows.map((row) => row.id)],
    );
    for (let offset = 0; offset < saved.rows.length; offset += 5000) {
      const slice = saved.rows.slice(offset, offset + 5000).map((row) => ({
        id: row.id,
        position: row.position,
        data: row.data,
        group_id: row.groupId,
        item_number: row.itemNumber || null,
        created_by: row.createdBy,
      }));
      await client.query(
        `INSERT INTO monitor_rows (id, sheet_id, position, data, group_id, item_number, created_by, updated_by)
         SELECT r.id, $1, r.position, r.data,
                (SELECT g.id FROM monitor_groups g WHERE g.id = r.group_id),
                r.item_number, (SELECT u.id FROM monitor_users u WHERE u.id = r.created_by), $3
         FROM jsonb_to_recordset($2::jsonb) AS r(id uuid, position text, data jsonb, group_id uuid, item_number int, created_by uuid)
         ON CONFLICT (id) DO UPDATE SET position = EXCLUDED.position, data = EXCLUDED.data, group_id = EXCLUDED.group_id,
           deleted_at = NULL, updated_by = $3
         WHERE monitor_rows.sheet_id = $1`,
        [sheetId.data, JSON.stringify(slice), user.id],
      );
    }
    await client.query(`UPDATE monitor_sheets SET version = version + 1 WHERE id = $1`, [sheetId.data]);
  });
  emitToSheet(sheetId.data, "sheet:reset", { sheetId: sheetId.data });
  return { error: "" };
}
