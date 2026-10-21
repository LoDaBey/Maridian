import type { PoolClient } from "pg";
import type { SheetOp } from "@/lib/sheets/ops";
import type { LockView } from "@/lib/sheets/workbook-access";

export const TAB_LOCKED = "This tab is protected. Ask the sheet owner for edit access.";
const GROUP_LOCKED = "This group is protected. Ask the sheet owner for edit access.";
const COLUMN_LOCKED = "This column is protected. Ask the sheet owner for edit access.";

/**
 * Returns why `op` is blocked by protection for this person, or null when it's allowed.
 * Rows without a group belong to the sheet's first group, matching the grid.
 */
export async function protectionBlock(
  client: Pick<PoolClient, "query">,
  op: SheetOp,
  locks: LockView,
): Promise<string | null> {
  if (locks.tab) {
    return TAB_LOCKED;
  }
  if (locks.columns.length === 0 && locks.groups.length === 0) {
    return null;
  }
  const columns = new Set(locks.columns);
  const groups = new Set(locks.groups);

  const firstGroup = async (): Promise<string | null> => {
    const result = await client.query<{ id: string }>(
      `SELECT id FROM monitor_groups WHERE sheet_id = $1 AND deleted_at IS NULL ORDER BY position LIMIT 1`,
      [op.sheetId],
    );
    return result.rows[0]?.id ?? null;
  };
  const groupOf = async (groupId: string | undefined): Promise<string | null> => groupId ?? (await firstGroup());
  const rowsTouchLockedGroup = async (rowIds: string[]): Promise<boolean> => {
    if (groups.size === 0 || rowIds.length === 0) {
      return false;
    }
    const result = await client.query<{ group_id: string | null }>(
      `SELECT group_id FROM monitor_rows WHERE sheet_id = $1 AND id = ANY($2::uuid[])`,
      [op.sheetId, rowIds],
    );
    const fallback = result.rows.some((row) => row.group_id === null) ? await firstGroup() : null;
    return result.rows.some((row) => {
      const id = row.group_id ?? fallback;
      return id !== null && groups.has(id);
    });
  };

  switch (op.type) {
    case "cell.set":
      if (columns.has(op.payload.columnId)) {
        return COLUMN_LOCKED;
      }
      return (await rowsTouchLockedGroup([op.payload.rowId])) ? GROUP_LOCKED : null;
    case "cells.setMany":
      if (op.payload.cells.some((cell) => columns.has(cell.columnId))) {
        return COLUMN_LOCKED;
      }
      return (await rowsTouchLockedGroup([...new Set(op.payload.cells.map((cell) => cell.rowId))])) ? GROUP_LOCKED : null;
    case "row.insert": {
      const group = await groupOf(op.payload.groupId);
      if (group && groups.has(group)) {
        return GROUP_LOCKED;
      }
      // New rows may carry values; a locked column stays empty for them.
      return Object.keys(op.payload.data ?? {}).some((id) => columns.has(id)) ? COLUMN_LOCKED : null;
    }
    case "rows.insertMany": {
      for (const row of op.payload.rows) {
        const group = await groupOf(row.groupId);
        if (group && groups.has(group)) {
          return GROUP_LOCKED;
        }
        if (Object.keys(row.data ?? {}).some((id) => columns.has(id))) {
          return COLUMN_LOCKED;
        }
      }
      return null;
    }
    case "row.delete":
    case "row.restore":
      return (await rowsTouchLockedGroup(op.payload.rowIds)) ? GROUP_LOCKED : null;
    case "row.move": {
      if (await rowsTouchLockedGroup([op.payload.rowId])) {
        return GROUP_LOCKED;
      }
      return op.payload.groupId && groups.has(op.payload.groupId) ? GROUP_LOCKED : null;
    }
    case "group.update":
    case "group.move":
    case "group.delete":
    case "group.restore":
      return groups.has(op.payload.groupId) ? GROUP_LOCKED : null;
    case "column.update":
    case "column.resize":
    case "column.delete":
    case "column.restore":
    case "column.move":
      return columns.has(op.payload.columnId) ? COLUMN_LOCKED : null;
    default:
      return null;
  }
}
