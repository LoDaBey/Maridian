import type { PoolClient } from "pg";
import type { SessionUser } from "@/lib/auth/session";
import { tx } from "@/lib/db";
import { isAutomaticColumnType, type ColumnType } from "@/lib/db-types";
import { can, canDeleteRow, roleRank, type Action } from "@/lib/rbac";
import { insertNotifications, type CreatedNotification, type PendingNotification } from "@/lib/notifications/repo";
import {
  sheetOpSchema,
  type JsonValue,
  type NormalizedOp,
  type OpType,
  type SheetOp,
} from "@/lib/sheets/ops";
import { carryColumnSettings } from "@/lib/sheets/column-meta";
import {
  appearanceFromSettings,
  convertValue,
  isAppearanceOnlyColumnUpdate,
  isAppearanceOnlySettingsChange,
  mergeColumnSettings,
  normalizeSettings,
  normalizeValue,
} from "@/lib/sheets/values";
import { assignedBlock, protectionBlock } from "@/lib/sheets/protection-check";
import { teamIdsFor } from "@/lib/teams/repo";
import { ensureMembersForSheet, getSheetAccess, loadProtections, locksFor } from "@/lib/sheets/workbook-access";

const CACHE_LIMIT = 10_000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const DETAIL_CAP = 2_000;

export type OpCode = "not_found" | "read_only" | "forbidden" | "invalid";

export type ApplyResult =
  | { ok: true; version: number; op: NormalizedOp; clearedCount?: number; notifications?: CreatedNotification[] }
  | { ok: false; code: OpCode; message: string };

interface CacheEntry {
  at: number;
  result: ApplyResult;
}

interface ColumnRecord {
  id: string;
  name: string;
  type: ColumnType;
  settings: unknown;
  deleted_at: Date | null;
  position: string;
  width: number;
}

interface RowRecord {
  id: string;
  sheet_id: string;
  position: string;
  data: Record<string, JsonValue>;
  group_id: string | null;
  item_number: number | null;
  created_by: string | null;
  deleted_at: Date | null;
}

interface GroupRecord {
  id: string;
  sheet_id: string;
  name: string;
  color: string;
  position: string;
  deleted_at: Date | null;
}

interface LogEntry {
  rowId: string | null;
  columnId: string | null;
  oldValue: JsonValue | null;
  newValue: JsonValue | null;
}

const globalForOps = globalThis as typeof globalThis & {
  __opCache?: Map<string, CacheEntry>;
  __opInflight?: Map<string, Promise<ApplyResult>>;
};

function cache(): Map<string, CacheEntry> {
  globalForOps.__opCache ??= new Map();
  return globalForOps.__opCache;
}

function inflight(): Map<string, Promise<ApplyResult>> {
  globalForOps.__opInflight ??= new Map();
  return globalForOps.__opInflight;
}

export function resetOpCache(): void {
  cache().clear();
  inflight().clear();
}

export async function applyOp(user: SessionUser, raw: unknown): Promise<ApplyResult> {
  const parsed = sheetOpSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      code: "invalid",
      message: parsed.error.issues[0]?.message ?? "Invalid operation.",
    };
  }

  const clientOpId = parsed.data.clientOpId;
  const hit = readCache(clientOpId);
  if (hit) {
    return hit;
  }
  const pending = inflight().get(clientOpId);
  if (pending) {
    return pending;
  }

  const promise = execute(user, parsed.data)
    .then((result) => {
      remember(clientOpId, result);
      return result;
    })
    .finally(() => {
      inflight().delete(clientOpId);
    });
  inflight().set(clientOpId, promise);
  return promise;
}

async function execute(user: SessionUser, op: SheetOp): Promise<ApplyResult> {
  return tx((client) => applyInside(client, user, op));
}

async function applyInside(
  client: PoolClient,
  user: SessionUser,
  op: SheetOp,
): Promise<ApplyResult> {
  const sheet = await client.query<{
    version: string | number;
    archived_at: Date | null;
    deleted_at: Date | null;
  }>(
    `SELECT s.version, s.archived_at, w.deleted_at
     FROM monitor_sheets s
     JOIN monitor_workbooks w ON w.id = s.workbook_id
     WHERE s.id = $1
     FOR UPDATE OF s`,
    [op.sheetId],
  );
  const locked = sheet.rows[0];
  if (!locked || locked.deleted_at) {
    return { ok: false, code: "not_found", message: "Sheet not found." };
  }
  if (locked.archived_at) {
    return { ok: false, code: "read_only", message: "This sheet is archived." };
  }
  const access = await getSheetAccess(user, op.sheetId, client);
  if (!access) {
    return { ok: false, code: "forbidden", message: "You don't have access to this sheet." };
  }
  if (access.role === "viewer") {
    return { ok: false, code: "read_only", message: "You can view this sheet but not edit it." };
  }
  if (access.role === "assigned") {
    // Team leaders also manage their team's items.
    const people = roleRank(user.role) >= roleRank("team_leader") ? await teamIdsFor(user.id) : [user.id];
    const notMine = await assignedBlock(client, op, people);
    if (notMine) {
      return { ok: false, code: "forbidden", message: notMine };
    }
  }
  const blocked = await protectionBlock(
    client,
    op,
    locksFor(access, user.id, await loadProtections(op.sheetId, client)),
  );
  if (blocked) {
    return { ok: false, code: "forbidden", message: blocked };
  }

  const permission = permissionFor(op);
  if (permission && !can(user.role, permission)) {
    if (op.type !== "column.insert" || !can(user.role, "sheet.create")) {
      return { ok: false, code: "forbidden", message: "You don't have permission to do that." };
    }
  }

  const currentVersion = Number(locked.version);
  switch (op.type) {
    case "cell.set":
      return writeCells(client, user, op, [{ ...op.payload, value: op.payload.value }]);
    case "cells.setMany":
      return writeCells(client, user, op, op.payload.cells);
    case "row.insert":
      return insertRows(client, user, op, [op.payload], currentVersion);
    case "rows.insertMany":
      return insertRows(client, user, op, op.payload.rows, currentVersion);
    case "row.delete":
      return setRowsDeleted(client, user, op, op.payload.rowIds, true);
    case "row.restore":
      return setRowsDeleted(client, user, op, op.payload.rowIds, false);
    case "row.move":
      return moveRow(client, user, op, currentVersion);
    case "column.insert":
      return insertColumn(client, user, op);
    case "column.update":
      return updateColumn(client, user, op);
    case "column.resize":
      return resizeColumn(client, user, op, currentVersion);
    case "column.delete":
      return setColumnDeleted(client, user, op, true);
    case "column.restore":
      return setColumnDeleted(client, user, op, false);
    case "column.move":
      return moveColumn(client, user, op, currentVersion);
    case "group.insert":
      return insertGroup(client, user, op);
    case "group.update":
      return updateGroup(client, user, op, currentVersion);
    case "group.move":
      return moveGroup(client, user, op, currentVersion);
    case "group.delete":
      return setGroupDeleted(client, user, op, true);
    case "group.restore":
      return setGroupDeleted(client, user, op, false);
    case "group.duplicate":
      return duplicateGroup(client, user, op);
    default:
      return { ok: false, code: "invalid", message: "Invalid operation." };
  }
}

function permissionFor(op: SheetOp): Action | null {
  if (op.type === "column.update" && isAppearanceOnlyColumnUpdate(op.payload.patch)) {
    return "cell.edit";
  }
  switch (op.type) {
    case "cell.set":
    case "cells.setMany":
      return "cell.edit";
    case "row.insert":
    case "rows.insertMany":
    case "group.insert":
    case "group.update":
    case "group.move":
    case "group.delete":
    case "group.restore":
    case "group.duplicate":
      return "row.insert";
    case "row.move":
      return "row.move";
    case "column.resize":
      return "column.resize";
    case "column.insert":
    case "column.update":
    case "column.move":
      return "column.manage";
    case "column.delete":
    case "column.restore":
      return "column.delete";
    default:
      return null;
  }
}

async function writeCells(
  client: PoolClient,
  user: SessionUser,
  op: SheetOp,
  cells: Array<{ rowId: string; columnId: string; value: unknown }>,
): Promise<ApplyResult> {
  const columns = await loadColumns(client, op.sheetId);
  const rowIds = [...new Set(cells.map((cell) => cell.rowId))];
  const rows = await loadRows(client, op.sheetId, rowIds);
  const normalized: Array<{ rowId: string; columnId: string; value: JsonValue | null }> = [];
  const seen = new Set<string>();

  for (const cell of cells) {
    const key = `${cell.rowId}:${cell.columnId}`;
    if (seen.has(key)) {
      normalized.splice(
        normalized.findIndex((item) => item.rowId === cell.rowId && item.columnId === cell.columnId),
        1,
      );
    }
    seen.add(key);
    const column = columns.get(cell.columnId);
    const row = rows.get(cell.rowId);
    if (!column || column.deleted_at) {
      return { ok: false, code: "invalid", message: "Column not found." };
    }
    if (isAutomaticColumnType(column.type)) {
      return { ok: false, code: "invalid", message: "This column is automatic." };
    }
    if (!row || row.deleted_at) {
      return { ok: false, code: "invalid", message: "Row not found." };
    }
    const parsed = normalizeValue(column, cell.value);
    if (!parsed.ok) {
      return { ok: false, code: "invalid", message: parsed.error };
    }
    normalized.push({
      rowId: cell.rowId,
      columnId: cell.columnId,
      value: parsed.value === undefined ? null : parsed.value,
    });
  }

  const logs: LogEntry[] = [];
  const byRow = new Map<string, Array<{ columnId: string; value: JsonValue | null }>>();
  for (const cell of normalized) {
    const group = byRow.get(cell.rowId) ?? [];
    group.push({ columnId: cell.columnId, value: cell.value });
    byRow.set(cell.rowId, group);
    const row = rows.get(cell.rowId);
    logs.push({
      rowId: cell.rowId,
      columnId: cell.columnId,
      oldValue: row ? (row.data[cell.columnId] ?? null) : null,
      newValue: cell.value,
    });
  }

  for (const [rowId, group] of byRow) {
    await updateRowCells(client, op.sheetId, rowId, user.id, group);
  }

  const assignedIds = newlyAssignedPersonIds(columns, rows, normalized);
  if (assignedIds.length > 0) {
    await ensureMembersForSheet(client, {
      sheetId: op.sheetId,
      userIds: assignedIds,
      addedBy: user.id,
    });
  }

  const version = await bumpVersion(client, op.sheetId);
  await writeActivity(client, op.sheetId, user.id, op.type, version, logs);
  const notifications = await insertNotifications(
    client,
    collectCellNotifications(user.id, op.sheetId, columns, rows, normalized),
  );
  const normalizedOp = normalizeCellOp(op, normalized);
  return { ok: true, version, op: normalizedOp, notifications };
}

function newlyAssignedPersonIds(
  columns: Map<string, ColumnRecord>,
  rows: Map<string, RowRecord>,
  cells: Array<{ rowId: string; columnId: string; value: JsonValue | null }>,
): string[] {
  const ids = new Set<string>();
  for (const cell of cells) {
    const column = columns.get(cell.columnId);
    const row = rows.get(cell.rowId);
    if (!column || !row || column.type !== "person") {
      continue;
    }
    const previous = personIds(row.data[cell.columnId]);
    for (const userId of personIds(cell.value)) {
      if (!previous.includes(userId)) {
        ids.add(userId);
      }
    }
  }
  return [...ids];
}

function normalizeCellOp(
  op: SheetOp,
  cells: Array<{ rowId: string; columnId: string; value: JsonValue | null }>,
): NormalizedOp {
  if (op.type === "cell.set") {
    const cell = cells[0];
    return {
      ...op,
      payload: {
        rowId: cell?.rowId ?? op.payload.rowId,
        columnId: cell?.columnId ?? op.payload.columnId,
        value: cell?.value ?? null,
      },
    };
  }
  if (op.type === "cells.setMany") {
    return { ...op, payload: { cells } };
  }
  return op;
}

async function insertRows(
  client: PoolClient,
  user: SessionUser,
  op: SheetOp,
  rows: Array<{ rowId: string; position: string; groupId?: string; data?: Record<string, unknown> }>,
  currentVersion: number,
): Promise<ApplyResult> {
  if (new Set(rows.map((row) => row.rowId)).size !== rows.length) {
    return { ok: false, code: "invalid", message: "Row ids must be unique." };
  }
  const columns = await loadColumns(client, op.sheetId);
  const fallbackGroup = await defaultGroupId(client, op.sheetId, user.id);
  const prepared: Array<{
    rowId: string;
    position: string;
    groupId: string;
    itemNumber: number;
    data: Record<string, JsonValue>;
  }> = [];
  for (const row of rows) {
    const data = normalizeRowData(row.data, columns);
    if (!data.ok) {
      return data;
    }
    const groupId = row.groupId ?? fallbackGroup;
    const group = await loadGroup(client, op.sheetId, groupId);
    if (!group || group.deleted_at) {
      return { ok: false, code: "invalid", message: "Group not found." };
    }
    prepared.push({
      rowId: row.rowId,
      position: row.position,
      groupId,
      itemNumber: 0,
      data: data.data,
    });
  }

  const existing = await client.query<RowRecord>(
    `SELECT id, sheet_id, position, data, group_id, item_number, created_by, deleted_at
     FROM monitor_rows
     WHERE id = ANY($1::uuid[])
     FOR UPDATE`,
    [prepared.map((row) => row.rowId)],
  );
  const existingById = new Map(existing.rows.map((row) => [row.id, row]));
  const toInsert = [];
  for (const row of prepared) {
    const found = existingById.get(row.rowId);
    if (!found) {
      toInsert.push(row);
      continue;
    }
    if (
      found.sheet_id === op.sheetId &&
      !found.deleted_at &&
      found.position === row.position &&
      found.group_id === row.groupId &&
      jsonEqual(found.data, row.data)
    ) {
      row.itemNumber = found.item_number ?? 0;
      continue;
    }
    return { ok: false, code: "invalid", message: "Row already exists." };
  }

  if (toInsert.length === 0) {
    return { ok: true, version: currentVersion, op: normalizeInserted(op, prepared) };
  }

  let nextNumber = await nextItemNumber(client, op.sheetId);
  for (const row of toInsert) {
    row.itemNumber = nextNumber;
    nextNumber += 1;
    await client.query(
      `INSERT INTO monitor_rows (id, sheet_id, group_id, item_number, position, data, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $7)`,
      [row.rowId, op.sheetId, row.groupId, row.itemNumber, row.position, JSON.stringify(row.data), user.id],
    );
  }

  const version = await bumpVersion(client, op.sheetId);
  await writeActivity(
    client,
    op.sheetId,
    user.id,
    op.type,
    version,
    toInsert.map((row) => ({
      rowId: row.rowId,
      columnId: null,
      oldValue: null,
      newValue: row.data,
    })),
  );
  return { ok: true, version, op: normalizeInserted(op, prepared) };
}

function normalizeInserted(
  op: SheetOp,
  rows: Array<{
    rowId: string;
    position: string;
    groupId: string;
    itemNumber: number;
    data: Record<string, JsonValue>;
  }>,
): NormalizedOp {
  if (op.type === "row.insert") {
    const row = rows[0];
    return {
      ...op,
      payload: {
        rowId: row?.rowId ?? op.payload.rowId,
        position: row?.position ?? op.payload.position,
        groupId: row?.groupId,
        itemNumber: row?.itemNumber,
        data: row?.data ?? {},
      },
    };
  }
  if (op.type === "rows.insertMany") {
    return { ...op, payload: { rows } };
  }
  return op;
}

async function setRowsDeleted(
  client: PoolClient,
  user: SessionUser,
  op: SheetOp,
  rowIds: string[],
  deleting: boolean,
): Promise<ApplyResult> {
  if (new Set(rowIds).size !== rowIds.length) {
    return { ok: false, code: "invalid", message: "Row ids must be unique." };
  }
  const rows = await loadRows(client, op.sheetId, rowIds);
  for (const rowId of rowIds) {
    const row = rows.get(rowId);
    if (!row || Boolean(row.deleted_at) === deleting) {
      return { ok: false, code: "invalid", message: "Row not found." };
    }
    if (!canDeleteRow(user, { created_by: row.created_by })) {
      return { ok: false, code: "forbidden", message: "You don't have permission to do that." };
    }
  }

  await client.query(
    `UPDATE monitor_rows
     SET deleted_at = CASE WHEN $3 THEN now() ELSE NULL END, updated_by = $4
     WHERE sheet_id = $1 AND id = ANY($2::uuid[])`,
    [op.sheetId, rowIds, deleting, user.id],
  );
  const version = await bumpVersion(client, op.sheetId);
  await writeActivity(
    client,
    op.sheetId,
    user.id,
    op.type,
    version,
    rowIds.map((rowId) => ({
      rowId,
      columnId: null,
      oldValue: deleting ? (rows.get(rowId)?.data ?? null) : null,
      newValue: deleting ? null : (rows.get(rowId)?.data ?? null),
    })),
  );
  return { ok: true, version, op };
}

async function moveRow(
  client: PoolClient,
  user: SessionUser,
  op: Extract<SheetOp, { type: "row.move" }>,
  currentVersion: number,
): Promise<ApplyResult> {
  const rows = await loadRows(client, op.sheetId, [op.payload.rowId]);
  const row = rows.get(op.payload.rowId);
  if (!row || row.deleted_at) {
    return { ok: false, code: "invalid", message: "Row not found." };
  }
  const nextGroupId = op.payload.groupId ?? row.group_id;
  if (nextGroupId) {
    const group = await loadGroup(client, op.sheetId, nextGroupId);
    if (!group || group.deleted_at) {
      return { ok: false, code: "invalid", message: "Group not found." };
    }
  }
  if (row.position === op.payload.position && row.group_id === nextGroupId) {
    return { ok: true, version: currentVersion, op };
  }
  await client.query(
    `UPDATE monitor_rows SET position = $3, group_id = $5, updated_by = $4
     WHERE id = $1 AND sheet_id = $2`,
    [op.payload.rowId, op.sheetId, op.payload.position, user.id, nextGroupId],
  );
  const version = await bumpVersion(client, op.sheetId);
  await writeActivity(client, op.sheetId, user.id, op.type, version, [
    {
      rowId: op.payload.rowId,
      columnId: null,
      oldValue: row.position,
      newValue: op.payload.position,
    },
  ]);
  return { ok: true, version, op: { ...op, payload: { ...op.payload, groupId: nextGroupId ?? undefined } } };
}

async function insertColumn(
  client: PoolClient,
  user: SessionUser,
  op: Extract<SheetOp, { type: "column.insert" }>,
): Promise<ApplyResult> {
  const settings = normalizeSettings(op.payload.type, op.payload.settings);
  if (!settings.ok) {
    return { ok: false, code: "invalid", message: settings.error };
  }
  const existing = await client.query<{ sheet_id: string; deleted_at: Date | null }>(
    "SELECT sheet_id, deleted_at FROM monitor_columns WHERE id = $1",
    [op.payload.columnId],
  );
  if (existing.rows[0]) {
    return { ok: false, code: "invalid", message: "Column already exists." };
  }
  const width = op.payload.width ?? 180;
  await client.query(
    `INSERT INTO monitor_columns
       (id, sheet_id, name, type, position, width, settings, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
    [
      op.payload.columnId,
      op.sheetId,
      op.payload.name,
      op.payload.type,
      op.payload.position,
      width,
      JSON.stringify(settings.settings),
      user.id,
    ],
  );
  const version = await bumpVersion(client, op.sheetId);
  await writeActivity(client, op.sheetId, user.id, op.type, version, [
    {
      rowId: null,
      columnId: op.payload.columnId,
      oldValue: null,
      newValue: {
        name: op.payload.name,
        type: op.payload.type,
        position: op.payload.position,
        width,
        settings: settings.settings,
      },
    },
  ]);
  return {
    ok: true,
    version,
    op: {
      ...op,
      payload: { ...op.payload, name: op.payload.name, width, settings: settings.settings },
    },
  };
}

async function updateColumn(
  client: PoolClient,
  user: SessionUser,
  op: Extract<SheetOp, { type: "column.update" }>,
): Promise<ApplyResult> {
  const columns = await loadColumns(client, op.sheetId);
  const column = columns.get(op.payload.columnId);
  if (!column || column.deleted_at) {
    return { ok: false, code: "invalid", message: "Column not found." };
  }
  const nextType = op.payload.patch.type ?? column.type;
  const nextName = op.payload.patch.name ?? column.name;
  const typeChanged = Boolean(op.payload.patch.type && op.payload.patch.type !== column.type);
  const settings =
    op.payload.patch.settings === undefined
      ? typeChanged
        ? normalizeSettings(nextType, {
            ...carryColumnSettings(column.type, nextType, column.settings),
            ...appearanceFromSettings(column.settings),
          })
        : { ok: true as const, settings: asSettingsRecord(column.settings) }
      : typeChanged
        ? normalizeSettings(nextType, {
            ...carryColumnSettings(column.type, nextType, column.settings),
            ...appearanceFromSettings(column.settings),
            ...asSettingsRecord(op.payload.patch.settings),
          })
        : mergeColumnSettings(nextType, column.settings, op.payload.patch.settings);
  if (!settings.ok) {
    return { ok: false, code: "invalid", message: settings.error };
  }

  const convertCells = typeChanged || !isAppearanceOnlySettingsChange(column.settings, settings.settings);
  const rows = convertCells
    ? await client.query<{ id: string; data: Record<string, JsonValue> }>(
        `SELECT id, data
         FROM monitor_rows
         WHERE sheet_id = $1 AND deleted_at IS NULL AND data ? $2
         FOR UPDATE`,
        [op.sheetId, column.id],
      )
    : { rows: [] as Array<{ id: string; data: Record<string, JsonValue> }> };
  let clearedCount = 0;
  const logs: LogEntry[] = [];
  for (const row of rows.rows) {
    const current = row.data[column.id];
    if (current === undefined) {
      continue;
    }
    const converted = convertValue(current, column.type, nextType, settings.settings);
    if (jsonEqual(current, converted.value ?? null) && converted.value !== undefined) {
      continue;
    }
    if (converted.cleared) {
      clearedCount += 1;
    }
    await updateRowCells(client, op.sheetId, row.id, user.id, [
      { columnId: column.id, value: converted.value === undefined ? null : converted.value },
    ]);
    logs.push({
      rowId: row.id,
      columnId: column.id,
      oldValue: current,
      newValue: converted.value === undefined ? null : converted.value,
    });
  }

  await client.query(
    `UPDATE monitor_columns
     SET name = $3, type = $4, settings = $5::jsonb
     WHERE id = $1 AND sheet_id = $2`,
    [column.id, op.sheetId, nextName, nextType, JSON.stringify(settings.settings)],
  );
  const version = await bumpVersion(client, op.sheetId);
  logs.unshift({
    rowId: null,
    columnId: column.id,
    oldValue: { name: column.name, type: column.type, settings: asJson(column.settings) },
    newValue: { name: nextName, type: nextType, settings: settings.settings },
  });
  await writeActivity(client, op.sheetId, user.id, op.type, version, logs);
  return {
    ok: true,
    version,
    clearedCount,
    op: {
      ...op,
      payload: {
        columnId: column.id,
        patch: { name: nextName, type: nextType, settings: settings.settings },
      },
    },
  };
}

async function resizeColumn(
  client: PoolClient,
  user: SessionUser,
  op: Extract<SheetOp, { type: "column.resize" }>,
  currentVersion: number,
): Promise<ApplyResult> {
  const columns = await loadColumns(client, op.sheetId);
  const column = columns.get(op.payload.columnId);
  if (!column || column.deleted_at) {
    return { ok: false, code: "invalid", message: "Column not found." };
  }
  if (column.width === op.payload.width) {
    return { ok: true, version: currentVersion, op };
  }
  await client.query(
    "UPDATE monitor_columns SET width = $3 WHERE id = $1 AND sheet_id = $2",
    [column.id, op.sheetId, op.payload.width],
  );
  const version = await bumpVersion(client, op.sheetId);
  await writeActivity(client, op.sheetId, user.id, op.type, version, [
    {
      rowId: null,
      columnId: column.id,
      oldValue: column.width,
      newValue: op.payload.width,
    },
  ]);
  return { ok: true, version, op };
}

async function setColumnDeleted(
  client: PoolClient,
  user: SessionUser,
  op: Extract<SheetOp, { type: "column.delete" | "column.restore" }>,
  deleting: boolean,
): Promise<ApplyResult> {
  const columns = await loadColumns(client, op.sheetId);
  const column = columns.get(op.payload.columnId);
  if (!column || Boolean(column.deleted_at) === deleting) {
    return { ok: false, code: "invalid", message: "Column not found." };
  }
  await client.query(
    `UPDATE monitor_columns
     SET deleted_at = CASE WHEN $3 THEN now() ELSE NULL END
     WHERE id = $1 AND sheet_id = $2`,
    [column.id, op.sheetId, deleting],
  );
  const version = await bumpVersion(client, op.sheetId);
  await writeActivity(client, op.sheetId, user.id, op.type, version, [
    {
      rowId: null,
      columnId: column.id,
      oldValue: { deleted: !deleting },
      newValue: { deleted: deleting },
    },
  ]);
  return { ok: true, version, op };
}

async function moveColumn(
  client: PoolClient,
  user: SessionUser,
  op: Extract<SheetOp, { type: "column.move" }>,
  currentVersion: number,
): Promise<ApplyResult> {
  const columns = await loadColumns(client, op.sheetId);
  const column = columns.get(op.payload.columnId);
  if (!column || column.deleted_at) {
    return { ok: false, code: "invalid", message: "Column not found." };
  }
  if (column.position === op.payload.position) {
    return { ok: true, version: currentVersion, op };
  }
  await client.query(
    "UPDATE monitor_columns SET position = $3 WHERE id = $1 AND sheet_id = $2",
    [column.id, op.sheetId, op.payload.position],
  );
  const version = await bumpVersion(client, op.sheetId);
  await writeActivity(client, op.sheetId, user.id, op.type, version, [
    {
      rowId: null,
      columnId: column.id,
      oldValue: column.position,
      newValue: op.payload.position,
    },
  ]);
  return { ok: true, version, op };
}

async function insertGroup(
  client: PoolClient,
  user: SessionUser,
  op: Extract<SheetOp, { type: "group.insert" }>,
): Promise<ApplyResult> {
  const existing = await client.query<{ sheet_id: string; deleted_at: Date | null }>(
    "SELECT sheet_id, deleted_at FROM monitor_groups WHERE id = $1",
    [op.payload.groupId],
  );
  if (existing.rows[0]) {
    return { ok: false, code: "invalid", message: "Group already exists." };
  }
  const color = op.payload.color ?? "#579bfc";
  await client.query(
    `INSERT INTO monitor_groups (id, sheet_id, name, color, position, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [op.payload.groupId, op.sheetId, op.payload.name, color, op.payload.position, user.id],
  );
  const version = await bumpVersion(client, op.sheetId);
  await writeActivity(client, op.sheetId, user.id, op.type, version, [
    {
      rowId: null,
      columnId: null,
      oldValue: null,
      newValue: { name: op.payload.name, color, position: op.payload.position },
    },
  ]);
  return { ok: true, version, op: { ...op, payload: { ...op.payload, color } } };
}

async function updateGroup(
  client: PoolClient,
  user: SessionUser,
  op: Extract<SheetOp, { type: "group.update" }>,
  currentVersion: number,
): Promise<ApplyResult> {
  const group = await loadGroup(client, op.sheetId, op.payload.groupId);
  if (!group || group.deleted_at) {
    return { ok: false, code: "invalid", message: "Group not found." };
  }
  const nextName = op.payload.patch.name ?? group.name;
  const nextColor = op.payload.patch.color ?? group.color;
  if (nextName === group.name && nextColor === group.color) {
    return { ok: true, version: currentVersion, op };
  }
  await client.query(
    `UPDATE monitor_groups SET name = $3, color = $4 WHERE id = $1 AND sheet_id = $2`,
    [group.id, op.sheetId, nextName, nextColor],
  );
  const version = await bumpVersion(client, op.sheetId);
  await writeActivity(client, op.sheetId, user.id, op.type, version, [
    {
      rowId: null,
      columnId: null,
      oldValue: { name: group.name, color: group.color },
      newValue: { name: nextName, color: nextColor },
    },
  ]);
  return {
    ok: true,
    version,
    op: { ...op, payload: { groupId: group.id, patch: { name: nextName, color: nextColor } } },
  };
}

async function moveGroup(
  client: PoolClient,
  user: SessionUser,
  op: Extract<SheetOp, { type: "group.move" }>,
  currentVersion: number,
): Promise<ApplyResult> {
  const group = await loadGroup(client, op.sheetId, op.payload.groupId);
  if (!group || group.deleted_at) {
    return { ok: false, code: "invalid", message: "Group not found." };
  }
  if (group.position === op.payload.position) {
    return { ok: true, version: currentVersion, op };
  }
  await client.query("UPDATE monitor_groups SET position = $3 WHERE id = $1 AND sheet_id = $2", [
    group.id,
    op.sheetId,
    op.payload.position,
  ]);
  const version = await bumpVersion(client, op.sheetId);
  await writeActivity(client, op.sheetId, user.id, op.type, version, [
    {
      rowId: null,
      columnId: null,
      oldValue: group.position,
      newValue: op.payload.position,
    },
  ]);
  return { ok: true, version, op };
}

async function setGroupDeleted(
  client: PoolClient,
  user: SessionUser,
  op: Extract<SheetOp, { type: "group.delete" | "group.restore" }>,
  deleting: boolean,
): Promise<ApplyResult> {
  const group = await loadGroup(client, op.sheetId, op.payload.groupId);
  if (!group || Boolean(group.deleted_at) === deleting) {
    return { ok: false, code: "invalid", message: "Group not found." };
  }
  if (deleting) {
    const remaining = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM monitor_groups
       WHERE sheet_id = $1 AND deleted_at IS NULL AND id <> $2`,
      [op.sheetId, group.id],
    );
    if (Number(remaining.rows[0]?.count ?? 0) < 1) {
      return { ok: false, code: "invalid", message: "Keep at least one group." };
    }
    await client.query(
      `WITH stamp AS (SELECT now() AS t)
       UPDATE monitor_groups
       SET deleted_at = (SELECT t FROM stamp)
       WHERE id = $1 AND sheet_id = $2`,
      [group.id, op.sheetId],
    );
    await client.query(
      `UPDATE monitor_rows
       SET deleted_at = (SELECT deleted_at FROM monitor_groups WHERE id = $1), updated_by = $3
       WHERE sheet_id = $2 AND group_id = $1 AND deleted_at IS NULL`,
      [group.id, op.sheetId, user.id],
    );
  } else {
    const stamp = group.deleted_at;
    await client.query(
      `UPDATE monitor_rows
       SET deleted_at = NULL, updated_by = $3
       WHERE sheet_id = $2 AND group_id = $1 AND deleted_at IS NOT DISTINCT FROM $4`,
      [group.id, op.sheetId, user.id, stamp],
    );
    await client.query(
      `UPDATE monitor_groups SET deleted_at = NULL WHERE id = $1 AND sheet_id = $2`,
      [group.id, op.sheetId],
    );
  }
  const version = await bumpVersion(client, op.sheetId);
  await writeActivity(client, op.sheetId, user.id, op.type, version, [
    {
      rowId: null,
      columnId: null,
      oldValue: { deleted: !deleting },
      newValue: { deleted: deleting },
    },
  ]);
  return { ok: true, version, op };
}

async function duplicateGroup(
  client: PoolClient,
  user: SessionUser,
  op: Extract<SheetOp, { type: "group.duplicate" }>,
): Promise<ApplyResult> {
  const source = await loadGroup(client, op.sheetId, op.payload.sourceGroupId);
  if (!source || source.deleted_at) {
    return { ok: false, code: "invalid", message: "Group not found." };
  }
  const existing = await client.query<{ id: string }>("SELECT id FROM monitor_groups WHERE id = $1", [
    op.payload.groupId,
  ]);
  if (existing.rows[0]) {
    return { ok: false, code: "invalid", message: "Group already exists." };
  }
  const color = op.payload.color ?? source.color;
  await client.query(
    `INSERT INTO monitor_groups (id, sheet_id, name, color, position, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [op.payload.groupId, op.sheetId, op.payload.name, color, op.payload.position, user.id],
  );
  const columns = await loadColumns(client, op.sheetId);
  const copied: Array<{
    rowId: string;
    position: string;
    groupId: string;
    itemNumber: number;
    data: Record<string, JsonValue>;
  }> = [];
  let nextNumber = await nextItemNumber(client, op.sheetId);
  for (const row of op.payload.rows) {
    const data = normalizeRowData(row.data, columns);
    if (!data.ok) {
      return data;
    }
    const itemNumber = nextNumber;
    nextNumber += 1;
    await client.query(
      `INSERT INTO monitor_rows (id, sheet_id, group_id, item_number, position, data, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $7)`,
      [row.rowId, op.sheetId, op.payload.groupId, itemNumber, row.position, JSON.stringify(data.data), user.id],
    );
    copied.push({
      rowId: row.rowId,
      position: row.position,
      groupId: op.payload.groupId,
      itemNumber,
      data: data.data,
    });
  }
  const version = await bumpVersion(client, op.sheetId);
  await writeActivity(client, op.sheetId, user.id, op.type, version, [
    {
      rowId: null,
      columnId: null,
      oldValue: { groupId: source.id },
      newValue: { groupId: op.payload.groupId, name: op.payload.name },
    },
  ]);
  return { ok: true, version, op: { ...op, payload: { ...op.payload, color, rows: copied } } };
}

function normalizeRowData(
  data: Record<string, unknown> | undefined,
  columns: Map<string, ColumnRecord>,
): { ok: true; data: Record<string, JsonValue> } | { ok: false; code: "invalid"; message: string } {
  const next: Record<string, JsonValue> = {};
  for (const [columnId, raw] of Object.entries(data ?? {})) {
    const column = columns.get(columnId);
    if (!column || column.deleted_at) {
      return { ok: false, code: "invalid", message: "Column not found." };
    }
    const parsed = normalizeValue(column, raw);
    if (!parsed.ok) {
      return { ok: false, code: "invalid", message: parsed.error };
    }
    if (parsed.value !== undefined) {
      next[columnId] = parsed.value;
    }
  }
  return { ok: true, data: next };
}

async function loadColumns(client: PoolClient, sheetId: string): Promise<Map<string, ColumnRecord>> {
  const result = await client.query<ColumnRecord>(
    `SELECT id, name, type, settings, deleted_at, position, width
     FROM monitor_columns
     WHERE sheet_id = $1`,
    [sheetId],
  );
  return new Map(result.rows.map((column) => [column.id, column]));
}

async function loadRows(
  client: PoolClient,
  sheetId: string,
  rowIds: string[],
): Promise<Map<string, RowRecord>> {
  const result = await client.query<RowRecord>(
    `SELECT id, sheet_id, position, data, group_id, item_number, created_by, deleted_at
     FROM monitor_rows
     WHERE sheet_id = $1 AND id = ANY($2::uuid[])
     FOR UPDATE`,
    [sheetId, rowIds],
  );
  return new Map(result.rows.map((row) => [row.id, row]));
}

async function updateRowCells(
  client: PoolClient,
  sheetId: string,
  rowId: string,
  userId: string,
  cells: Array<{ columnId: string; value: JsonValue | null }>,
): Promise<void> {
  let expression = "data";
  const params: unknown[] = [rowId, sheetId, userId];
  for (const cell of cells) {
    const columnIndex = params.length + 1;
    if (cell.value === null) {
      expression = `(${expression} - $${columnIndex}::text)`;
      params.push(cell.columnId);
    } else {
      expression = `jsonb_set(${expression}, ARRAY[$${columnIndex}::text], $${columnIndex + 1}::jsonb, true)`;
      params.push(cell.columnId, JSON.stringify(cell.value));
    }
  }
  await client.query(
    `UPDATE monitor_rows
     SET data = ${expression}, updated_by = $3
     WHERE id = $1 AND sheet_id = $2`,
    params,
  );
}

async function bumpVersion(client: PoolClient, sheetId: string): Promise<number> {
  const result = await client.query<{ version: string | number }>(
    "UPDATE monitor_sheets SET version = version + 1 WHERE id = $1 RETURNING version",
    [sheetId],
  );
  return Number(result.rows[0]?.version ?? 0);
}

async function writeActivity(
  client: PoolClient,
  sheetId: string,
  userId: string,
  action: string,
  version: number,
  entries: LogEntry[],
): Promise<void> {
  if (entries.length === 0) {
    return;
  }
  const detail = entries.slice(0, DETAIL_CAP);
  const omitted = entries.length - detail.length;
  await client.query(
    `INSERT INTO monitor_activity_log
       (sheet_id, user_id, action, row_id, column_id, old_value, new_value, sheet_version)
     SELECT $1::uuid, $2::uuid, $3,
            NULLIF(entry.row_id, '')::uuid,
            NULLIF(entry.column_id, '')::uuid,
            CASE WHEN entry.old_value = '' THEN NULL ELSE entry.old_value::jsonb END,
            CASE WHEN entry.new_value = '' THEN NULL ELSE entry.new_value::jsonb END,
            $4::bigint
     FROM unnest($5::text[], $6::text[], $7::text[], $8::text[])
       AS entry(row_id, column_id, old_value, new_value)`,
    [
      sheetId,
      userId,
      action,
      version,
      detail.map((entry) => entry.rowId ?? ""),
      detail.map((entry) => entry.columnId ?? ""),
      detail.map((entry) => encodeJson(entry.oldValue)),
      detail.map((entry) => encodeJson(entry.newValue)),
    ],
  );
  if (omitted > 0) {
    await client.query(
      `INSERT INTO monitor_activity_log (sheet_id, user_id, action, new_value, sheet_version)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [sheetId, userId, action, JSON.stringify({ summary: true, omitted }), version],
    );
  }
}

async function loadGroup(client: PoolClient, sheetId: string, groupId: string): Promise<GroupRecord | null> {
  const result = await client.query<GroupRecord>(
    `SELECT id, sheet_id, name, color, position, deleted_at
     FROM monitor_groups
     WHERE sheet_id = $1 AND id = $2
     FOR UPDATE`,
    [sheetId, groupId],
  );
  return result.rows[0] ?? null;
}

async function defaultGroupId(client: PoolClient, sheetId: string, actorId: string): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM monitor_groups
     WHERE sheet_id = $1 AND deleted_at IS NULL
     ORDER BY position DESC
     LIMIT 1`,
    [sheetId],
  );
  if (existing.rows[0]) {
    return existing.rows[0].id;
  }
  const id = crypto.randomUUID();
  await client.query(
    `INSERT INTO monitor_groups (id, sheet_id, name, color, position, created_by)
     VALUES ($1, $2, 'Items', '#579bfc', 'a0', $3)`,
    [id, sheetId, actorId],
  );
  return id;
}

async function nextItemNumber(client: PoolClient, sheetId: string): Promise<number> {
  const result = await client.query<{ next: string }>(
    `SELECT COALESCE(MAX(item_number), 0) + 1 AS next FROM monitor_rows WHERE sheet_id = $1`,
    [sheetId],
  );
  return Number(result.rows[0]?.next ?? 1);
}

function collectCellNotifications(
  actorId: string,
  sheetId: string,
  columns: Map<string, ColumnRecord>,
  rows: Map<string, RowRecord>,
  cells: Array<{ rowId: string; columnId: string; value: JsonValue | null }>,
): PendingNotification[] {
  const pending: PendingNotification[] = [];
  const assignedOnRow = new Map<string, Set<string>>();
  for (const cell of cells) {
    const column = columns.get(cell.columnId);
    const row = rows.get(cell.rowId);
    if (!column || !row) {
      continue;
    }
    if (column.type === "person") {
      const previous = personIds(row.data[cell.columnId]);
      const next = personIds(cell.value);
      for (const userId of next) {
        if (!previous.includes(userId)) {
          pending.push({
            userId,
            type: "assign",
            sheetId,
            rowId: cell.rowId,
            actorId,
            payload: { columnId: cell.columnId, excerpt: "assigned you" },
          });
        }
      }
    }
    if (column.type === "status") {
      const previous = row.data[cell.columnId] ?? null;
      if (!jsonEqual(previous, cell.value)) {
        const ids = assignedOnRow.get(cell.rowId) ?? peopleOnRow(row, columns, cells, cell.rowId);
        assignedOnRow.set(cell.rowId, ids);
        for (const userId of ids) {
          pending.push({
            userId,
            type: "status",
            sheetId,
            rowId: cell.rowId,
            actorId,
            payload: { columnId: cell.columnId, excerpt: "changed a status" },
          });
        }
      }
    }
  }
  return pending;
}

function peopleOnRow(
  row: RowRecord,
  columns: Map<string, ColumnRecord>,
  cells: Array<{ rowId: string; columnId: string; value: JsonValue | null }>,
  rowId: string,
): Set<string> {
  const ids = new Set<string>();
  for (const column of columns.values()) {
    if (column.type !== "person" || column.deleted_at) {
      continue;
    }
    const override = cells.find((cell) => cell.rowId === rowId && cell.columnId === column.id);
    for (const userId of personIds(override ? override.value : row.data[column.id])) {
      ids.add(userId);
    }
  }
  return ids;
}

function personIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function encodeJson(value: JsonValue | null): string {
  if (value === null) {
    return "";
  }
  return JSON.stringify(value);
}

function asJson(value: unknown): JsonValue {
  if (value === null || value === undefined) {
    return {};
  }
  return value as JsonValue;
}

function asSettingsRecord(value: unknown): Record<string, JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, JsonValue>;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(sortJson(left)) === JSON.stringify(sortJson(right));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJson(item)]),
    );
  }
  return value;
}

function readCache(clientOpId: string): ApplyResult | null {
  const entry = cache().get(clientOpId);
  if (!entry) {
    return null;
  }
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache().delete(clientOpId);
    return null;
  }
  cache().delete(clientOpId);
  cache().set(clientOpId, entry);
  return entry.result;
}

function remember(clientOpId: string, result: ApplyResult): void {
  const store = cache();
  store.set(clientOpId, { at: Date.now(), result });
  while (store.size > CACHE_LIMIT) {
    const oldest = store.keys().next().value;
    if (!oldest) {
      break;
    }
    store.delete(oldest);
  }
}
