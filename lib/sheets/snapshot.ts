import type { ColumnType, SheetDirection } from "@/lib/db-types";
import { pool } from "@/lib/db";
import type { JsonValue } from "@/lib/sheets/ops";

const ROW_WARNING = 20_000;

export interface SnapshotColumn {
  id: string;
  name: string;
  type: ColumnType;
  position: string;
  width: number;
  settings: Record<string, JsonValue>;
}

export interface SnapshotGroup {
  id: string;
  name: string;
  color: string;
  position: string;
}

export interface SnapshotRow {
  id: string;
  position: string;
  data: Record<string, JsonValue>;
  groupId: string | null;
  itemNumber: number;
  createdBy: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
}

export interface SheetSnapshot {
  sheet: {
    id: string;
    name: string;
    direction: SheetDirection;
    version: number;
  };
  groups: SnapshotGroup[];
  columns: SnapshotColumn[];
  rows: SnapshotRow[];
}

export async function loadSnapshot(sheetId: string): Promise<SheetSnapshot | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const sheet = await client.query<{
      id: string;
      name: string;
      direction: SheetDirection;
      version: string | number;
    }>(
      `SELECT id, name, direction, version
       FROM monitor_sheets
       WHERE id = $1`,
      [sheetId],
    );
    const locked = sheet.rows[0];
    if (!locked) {
      await client.query("COMMIT");
      return null;
    }

    const groups = await client.query<{
      id: string;
      name: string;
      color: string;
      position: string;
    }>(
      `SELECT id, name, color, position
       FROM monitor_groups
       WHERE sheet_id = $1 AND deleted_at IS NULL
       ORDER BY position`,
      [sheetId],
    );
    const columns = await client.query<{
      id: string;
      name: string;
      type: ColumnType;
      position: string;
      width: number;
      settings: Record<string, JsonValue>;
    }>(
      `SELECT id, name, type, position, width, settings
       FROM monitor_columns
       WHERE sheet_id = $1 AND deleted_at IS NULL
       ORDER BY position`,
      [sheetId],
    );
    const rows = await client.query<{
      id: string;
      position: string;
      data: Record<string, JsonValue>;
      group_id: string | null;
      item_number: number | null;
      created_by: string | null;
      created_at: Date;
      updated_by: string | null;
      updated_at: Date;
    }>(
      `SELECT id, position, data, group_id, item_number, created_by, created_at, updated_by, updated_at
       FROM monitor_rows
       WHERE sheet_id = $1 AND deleted_at IS NULL
       ORDER BY position`,
      [sheetId],
    );
    await client.query("COMMIT");

    if (rows.rows.length > ROW_WARNING) {
      console.warn(`Sheet ${sheetId} snapshot has ${rows.rows.length} rows`);
    }

    return {
      sheet: {
        id: locked.id,
        name: locked.name,
        direction: locked.direction,
        version: Number(locked.version),
      },
      groups: groups.rows,
      columns: columns.rows,
      rows: rows.rows.map((row) => ({
        id: row.id,
        position: row.position,
        data: row.data ?? {},
        groupId: row.group_id,
        itemNumber: row.item_number ?? 0,
        createdBy: row.created_by,
        createdAt: row.created_at.toISOString(),
        updatedBy: row.updated_by,
        updatedAt: row.updated_at.toISOString(),
      })),
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Keep the original error if the connection is already closed.
    }
    throw error;
  } finally {
    client.release();
  }
}
