import type { ColumnType } from "@/lib/db-types";
import { query, queryOne } from "@/lib/db";
import type { Role } from "@/lib/rbac";
import type { JsonValue } from "@/lib/sheets/ops";
import { displayValue } from "@/lib/sheets/values";
import { userCanAccessSheet } from "@/lib/sheets/workbook-access";

export interface ActivityEntry {
  id: string;
  userId: string | null;
  userName: string;
  avatarColor: string;
  action: string;
  rowId: string | null;
  columnId: string | null;
  columnName: string | null;
  columnDeleted: boolean;
  rowNumber: number | null;
  rowDeleted: boolean;
  oldText: string;
  newText: string;
  createdAt: string;
}

export interface ActivityPage {
  entries: ActivityEntry[];
  nextBefore: string | null;
}

export interface CellHistoryEntry {
  id: string;
  userName: string;
  avatarColor: string;
  oldText: string;
  newText: string;
  oldValue: JsonValue | null;
  createdAt: string;
}

interface ActivityRow {
  id: string;
  user_id: string | null;
  full_name: string | null;
  avatar_color: string | null;
  action: string;
  row_id: string | null;
  column_id: string | null;
  column_name: string | null;
  column_type: ColumnType | null;
  column_settings: unknown;
  column_deleted: boolean | null;
  row_number: string | number | null;
  old_value: unknown;
  new_value: unknown;
  created_at: Date;
}

const PAGE_CAP = 50;

export async function sheetExists(
  sheetId: string,
  viewer?: { id: string; role: Role },
): Promise<boolean> {
  if (viewer) {
    return userCanAccessSheet(viewer, sheetId);
  }
  const row = await queryOne<{ id: string }>("SELECT id FROM monitor_sheets WHERE id = $1", [sheetId]);
  return row !== null;
}

export async function listSheetActivity(input: {
  sheetId: string;
  before: string | null;
  userId: string | null;
  rowId: string | null;
  limit: number;
}): Promise<ActivityPage> {
  const limit = Math.min(PAGE_CAP, Math.max(1, input.limit));
  const users = await userNames();
  const rows = await query<ActivityRow>(
    `WITH page AS (
       SELECT a.id, a.user_id, a.action, a.row_id, a.column_id, a.old_value, a.new_value, a.created_at
       FROM monitor_activity_log a
       WHERE a.sheet_id = $1::uuid
         AND a.sheet_id IS NOT NULL
         AND a.action NOT LIKE 'user.%'
         AND (CAST($2 AS bigint) IS NULL OR a.id < CAST($2 AS bigint))
         AND (CAST($3 AS uuid) IS NULL OR a.user_id = CAST($3 AS uuid))
         AND (CAST($5 AS uuid) IS NULL OR a.row_id = CAST($5 AS uuid))
       ORDER BY a.id DESC
       LIMIT $4
     )
     SELECT page.id::text AS id,
            page.user_id,
            u.full_name,
            u.avatar_color,
            page.action,
            page.row_id,
            page.column_id,
            c.name AS column_name,
            c.type AS column_type,
            c.settings AS column_settings,
            (c.deleted_at IS NOT NULL) AS column_deleted,
            nums.n AS row_number,
            page.old_value,
            page.new_value,
            page.created_at
     FROM page
     LEFT JOIN monitor_users u ON u.id = page.user_id
     LEFT JOIN monitor_columns c ON c.id = page.column_id
     LEFT JOIN (
       SELECT id, row_number() OVER (ORDER BY position) AS n
       FROM monitor_rows
       WHERE sheet_id = $1::uuid AND deleted_at IS NULL
     ) nums ON nums.id = page.row_id
     ORDER BY page.id DESC`,
    [input.sheetId, input.before, input.userId, limit, input.rowId],
  );
  const entries = rows.map((row) => toEntry(row, users));
  const last = entries[entries.length - 1];
  return {
    entries,
    nextBefore: entries.length === limit && last ? last.id : null,
  };
}

export async function listCellHistory(sheetId: string, rowId: string, columnId: string): Promise<CellHistoryEntry[]> {
  const users = await userNames();
  const rows = await query<ActivityRow>(
    `SELECT a.id::text AS id,
            a.user_id,
            u.full_name,
            u.avatar_color,
            a.action,
            a.row_id,
            a.column_id,
            c.name AS column_name,
            c.type AS column_type,
            c.settings AS column_settings,
            (c.deleted_at IS NOT NULL) AS column_deleted,
            NULL::bigint AS row_number,
            a.old_value,
            a.new_value,
            a.created_at
     FROM monitor_activity_log a
     LEFT JOIN monitor_users u ON u.id = a.user_id
     LEFT JOIN monitor_columns c ON c.id = a.column_id
     WHERE a.sheet_id = $1::uuid
       AND a.sheet_id IS NOT NULL
       AND a.action NOT LIKE 'user.%'
       AND a.row_id = $2::uuid
       AND a.column_id = $3::uuid
     ORDER BY a.id DESC
     LIMIT 50`,
    [sheetId, rowId, columnId],
  );
  return rows.map((row) => ({
    id: row.id,
    userName: row.full_name ?? "Someone",
    avatarColor: row.avatar_color ?? "#0073ea",
    oldText: renderStored(row, row.old_value, users),
    newText: renderStored(row, row.new_value, users),
    oldValue: asJson(row.old_value),
    createdAt: row.created_at.toISOString(),
  }));
}

async function userNames(): Promise<Map<string, string>> {
  const rows = await query<{ id: string; full_name: string }>("SELECT id, full_name FROM monitor_users");
  return new Map(rows.map((row) => [row.id, row.full_name]));
}

function toEntry(row: ActivityRow, users: Map<string, string>): ActivityEntry {
  const rowNumber = row.row_number === null || row.row_number === undefined ? null : Number(row.row_number);
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.full_name ?? "Someone",
    avatarColor: row.avatar_color ?? "#0073ea",
    action: row.action,
    rowId: row.row_id,
    columnId: row.column_id,
    columnName: row.column_name,
    columnDeleted: row.column_deleted === true,
    rowNumber: Number.isFinite(rowNumber) ? rowNumber : null,
    rowDeleted: Boolean(row.row_id) && rowNumber === null,
    oldText: renderStored(row, row.old_value, users),
    newText: renderStored(row, row.new_value, users),
    createdAt: row.created_at.toISOString(),
  };
}

function renderStored(row: ActivityRow, value: unknown, users: Map<string, string>): string {
  if (!row.column_type || !isCellValue(row.action, value)) {
    return "";
  }
  const stored = asJson(value);
  if (stored === null) {
    return "";
  }
  return displayValue({ type: row.column_type, settings: row.column_settings ?? undefined }, stored, users);
}

function isCellValue(action: string, value: unknown): boolean {
  if (action === "cell.set" || action === "cells.setMany" || action === "column.update") {
    return value === null || value === undefined || typeof value !== "object" || Array.isArray(value) || isLink(value) || isPersonList(value);
  }
  return false;
}

function isLink(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && "url" in value);
}

function isPersonList(value: unknown): boolean {
  return Array.isArray(value);
}

function asJson(value: unknown): JsonValue | null {
  if (value === null || value === undefined) {
    return null;
  }
  return value as JsonValue;
}
