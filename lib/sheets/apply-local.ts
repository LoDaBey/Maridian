import type { ColumnType } from "@/lib/db-types";
import type { JsonValue, SheetOp } from "@/lib/sheets/ops";
import { carryColumnSettings, defaultColumnSettings } from "@/lib/sheets/column-meta";
import {
  appearanceFromSettings,
  convertValue,
  isAppearanceOnlySettingsChange,
  mergeColumnSettings,
  normalizeSettings,
} from "@/lib/sheets/values";

export interface LocalColumn {
  id: string;
  name: string;
  type: ColumnType;
  position: string;
  width: number;
  settings: Record<string, JsonValue>;
  deleted?: boolean;
}

export interface LocalRow {
  id: string;
  position: string;
  data: Record<string, JsonValue>;
  groupId: string | null;
  itemNumber: number;
  createdBy: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
  deleted?: boolean;
}

export interface LocalGroup {
  id: string;
  name: string;
  color: string;
  position: string;
  deleted?: boolean;
}

export interface LocalSheetState {
  columns: Record<string, LocalColumn>;
  columnOrder: string[];
  rows: Record<string, LocalRow>;
  rowOrder: string[];
  groups: Record<string, LocalGroup>;
  groupOrder: string[];
}

export interface CellSnapshot {
  rowId: string;
  columnId: string;
  value: JsonValue | null;
}

export type ClientOp = SheetOp & {
  purge?: boolean;
  restoreCells?: CellSnapshot[];
};

export interface ApplyLocalResult {
  state: LocalSheetState;
  inverse: ClientOp;
}

const DEFAULT_WIDTH = 180;

export function applyOpToState(state: LocalSheetState, op: ClientOp, userId?: string | null): ApplyLocalResult {
  switch (op.type) {
    case "cell.set":
      return applyCell(state, op, op.payload.rowId, op.payload.columnId, op.payload.value);
    case "cells.setMany":
      return applyCells(state, op);
    case "row.insert":
      return insertRows(state, op, [op.payload], userId ?? null);
    case "rows.insertMany":
      return insertRows(state, op, op.payload.rows, userId ?? null);
    case "row.delete":
      return deleteRows(state, op, op.payload.rowIds, op.purge === true);
    case "row.restore":
      return restoreRows(state, op, op.payload.rowIds);
    case "row.move":
      return moveRow(state, op);
    case "column.insert":
      return insertColumn(state, op);
    case "column.update":
      return updateColumn(state, op);
    case "column.resize":
      return resizeColumn(state, op);
    case "column.delete":
      return deleteColumn(state, op, op.purge === true);
    case "column.restore":
      return restoreColumn(state, op);
    case "column.move":
      return moveColumn(state, op);
    case "group.insert":
      return insertGroup(state, op);
    case "group.update":
      return updateGroup(state, op);
    case "group.move":
      return moveGroup(state, op);
    case "group.delete":
      return deleteGroup(state, op);
    case "group.restore":
      return restoreGroup(state, op);
    case "group.duplicate":
      return duplicateGroup(state, op, userId ?? null);
    default:
      return unchanged(state, op);
  }
}

function applyCell(
  state: LocalSheetState,
  op: ClientOp,
  rowId: string,
  columnId: string,
  raw: unknown,
): ApplyLocalResult {
  const row = state.rows[rowId];
  if (!row || row.deleted || !state.columns[columnId] || state.columns[columnId]?.deleted) {
    return unchanged(state, op);
  }
  const value = asStored(raw);
  if (sameValue(row.data[columnId], value)) {
    return unchanged(state, op);
  }
  const previous = row.data[columnId] === undefined ? null : row.data[columnId];
  return {
    state: {
      ...state,
      rows: { ...state.rows, [rowId]: writeCell(row, columnId, value) },
    },
    inverse: {
      clientOpId: op.clientOpId,
      sheetId: op.sheetId,
      type: "cell.set",
      payload: { rowId, columnId, value: previous },
    },
  };
}

function applyCells(state: LocalSheetState, op: Extract<ClientOp, { type: "cells.setMany" }>): ApplyLocalResult {
  const previous: CellSnapshot[] = [];
  let next = state;
  const seen = new Set<string>();
  for (const cell of op.payload.cells) {
    const key = `${cell.rowId}:${cell.columnId}`;
    const row = next.rows[cell.rowId];
    if (!seen.has(key) && row && !row.deleted) {
      previous.push({
        rowId: cell.rowId,
        columnId: cell.columnId,
        value: row.data[cell.columnId] === undefined ? null : row.data[cell.columnId],
      });
      seen.add(key);
    }
    const applied = applyCell(next, op, cell.rowId, cell.columnId, cell.value);
    next = applied.state;
  }
  if (next === state) {
    return unchanged(state, op);
  }
  return {
    state: next,
    inverse: {
      clientOpId: op.clientOpId,
      sheetId: op.sheetId,
      type: "cells.setMany",
      payload: { cells: previous },
    },
  };
}

function insertRows(
  state: LocalSheetState,
  op: ClientOp,
  rows: Array<{
    rowId: string;
    position: string;
    groupId?: string;
    itemNumber?: number;
    data?: Record<string, unknown>;
  }>,
  userId: string | null,
): ApplyLocalResult {
  let next = state;
  const inserted: string[] = [];
  const now = new Date().toISOString();
  let nextNumber = nextItemNumber(state);
  for (const row of rows) {
    if (!row.rowId || next.rows[row.rowId]) {
      continue;
    }
    const itemNumber = row.itemNumber ?? nextNumber;
    if (itemNumber >= nextNumber) {
      nextNumber = itemNumber + 1;
    }
    const created: LocalRow = {
      id: row.rowId,
      position: row.position,
      data: copyData(row.data),
      groupId: row.groupId ?? fallbackGroupId(state),
      itemNumber,
      createdBy: userId,
      createdAt: now,
      updatedBy: userId,
      updatedAt: now,
    };
    const record = next === state ? { ...next.rows } : next.rows;
    record[row.rowId] = created;
    next = {
      ...next,
      rows: record,
      rowOrder: reorder(next.rowOrder, row.rowId, row.position, (id) => record[id]?.position ?? ""),
    };
    inserted.push(row.rowId);
  }
  if (!inserted.length) {
    return unchanged(state, op);
  }
  return {
    state: next,
    inverse: {
      clientOpId: op.clientOpId,
      sheetId: op.sheetId,
      type: "row.delete",
      payload: { rowIds: inserted },
      purge: true,
    },
  };
}

function deleteRows(state: LocalSheetState, op: ClientOp, rowIds: string[], purge: boolean): ApplyLocalResult {
  let rows = state.rows;
  let rowOrder = state.rowOrder;
  const removed: string[] = [];
  for (const rowId of rowIds) {
    const row = rows[rowId];
    if (!row || (row.deleted && !purge)) {
      continue;
    }
    if (rows === state.rows) {
      rows = { ...rows };
    }
    if (purge) {
      delete rows[rowId];
    } else {
      rows[rowId] = { ...row, deleted: true };
    }
    rowOrder = rowOrder.filter((id) => id !== rowId);
    removed.push(rowId);
  }
  if (!removed.length) {
    return unchanged(state, op);
  }
  return {
    state: { ...state, rows, rowOrder },
    inverse: purge
      ? op
      : {
          clientOpId: op.clientOpId,
          sheetId: op.sheetId,
          type: "row.restore",
          payload: { rowIds: removed },
        },
  };
}

function restoreRows(state: LocalSheetState, op: ClientOp, rowIds: string[]): ApplyLocalResult {
  let rows = state.rows;
  let rowOrder = state.rowOrder;
  const restored: string[] = [];
  for (const rowId of rowIds) {
    const row = rows[rowId];
    if (!row?.deleted) {
      continue;
    }
    if (rows === state.rows) {
      rows = { ...rows };
    }
    rows[rowId] = withoutDeleted(row);
    rowOrder = reorder(rowOrder, rowId, row.position, (id) => rows[id]?.position ?? "");
    restored.push(rowId);
  }
  if (!restored.length) {
    return unchanged(state, op);
  }
  return {
    state: { ...state, rows, rowOrder },
    inverse: {
      clientOpId: op.clientOpId,
      sheetId: op.sheetId,
      type: "row.delete",
      payload: { rowIds: restored },
    },
  };
}

function moveRow(state: LocalSheetState, op: Extract<ClientOp, { type: "row.move" }>): ApplyLocalResult {
  const row = state.rows[op.payload.rowId];
  const nextGroupId = op.payload.groupId ?? row?.groupId ?? null;
  if (!row || row.deleted || (row.position === op.payload.position && row.groupId === nextGroupId)) {
    return unchanged(state, op);
  }
  const previous = row.position;
  const previousGroup = row.groupId;
  const rows = { ...state.rows, [row.id]: { ...row, position: op.payload.position, groupId: nextGroupId } };
  return {
    state: {
      ...state,
      rows,
      rowOrder: reorder(state.rowOrder, row.id, op.payload.position, (id) => rows[id]?.position ?? ""),
    },
    inverse: {
      clientOpId: op.clientOpId,
      sheetId: op.sheetId,
      type: "row.move",
      payload: { rowId: row.id, position: previous, groupId: previousGroup ?? undefined },
    },
  };
}

function insertGroup(state: LocalSheetState, op: Extract<ClientOp, { type: "group.insert" }>): ApplyLocalResult {
  if (state.groups[op.payload.groupId]) {
    return unchanged(state, op);
  }
  const group: LocalGroup = {
    id: op.payload.groupId,
    name: op.payload.name,
    color: op.payload.color ?? "#579bfc",
    position: op.payload.position,
  };
  const groups = { ...state.groups, [group.id]: group };
  return {
    state: {
      ...state,
      groups,
      groupOrder: reorder(state.groupOrder, group.id, group.position, (id) => groups[id]?.position ?? ""),
    },
    inverse: {
      clientOpId: op.clientOpId,
      sheetId: op.sheetId,
      type: "group.delete",
      payload: { groupId: group.id },
      purge: true,
    },
  };
}

function updateGroup(state: LocalSheetState, op: Extract<ClientOp, { type: "group.update" }>): ApplyLocalResult {
  const group = state.groups[op.payload.groupId];
  if (!group || group.deleted) {
    return unchanged(state, op);
  }
  const nextName = op.payload.patch.name ?? group.name;
  const nextColor = op.payload.patch.color ?? group.color;
  if (group.name === nextName && group.color === nextColor) {
    return unchanged(state, op);
  }
  return {
    state: {
      ...state,
      groups: { ...state.groups, [group.id]: { ...group, name: nextName, color: nextColor } },
    },
    inverse: {
      clientOpId: op.clientOpId,
      sheetId: op.sheetId,
      type: "group.update",
      payload: { groupId: group.id, patch: { name: group.name, color: group.color } },
    },
  };
}

function moveGroup(state: LocalSheetState, op: Extract<ClientOp, { type: "group.move" }>): ApplyLocalResult {
  const group = state.groups[op.payload.groupId];
  if (!group || group.deleted || group.position === op.payload.position) {
    return unchanged(state, op);
  }
  const previous = group.position;
  const groups = { ...state.groups, [group.id]: { ...group, position: op.payload.position } };
  return {
    state: {
      ...state,
      groups,
      groupOrder: reorder(state.groupOrder, group.id, op.payload.position, (id) => groups[id]?.position ?? ""),
    },
    inverse: {
      clientOpId: op.clientOpId,
      sheetId: op.sheetId,
      type: "group.move",
      payload: { groupId: group.id, position: previous },
    },
  };
}

function deleteGroup(state: LocalSheetState, op: Extract<ClientOp, { type: "group.delete" }>): ApplyLocalResult {
  const group = state.groups[op.payload.groupId];
  const purge = op.purge === true;
  if (!group || (group.deleted && !purge)) {
    return unchanged(state, op);
  }
  const groups = { ...state.groups };
  if (purge) {
    delete groups[group.id];
  } else {
    groups[group.id] = { ...group, deleted: true };
  }
  let rows = state.rows;
  let rowOrder = state.rowOrder;
  for (const row of Object.values(state.rows)) {
    if (row.groupId !== group.id || row.deleted) {
      continue;
    }
    if (rows === state.rows) {
      rows = { ...rows };
      rowOrder = rowOrder.filter((id) => state.rows[id]?.groupId !== group.id);
    }
    if (purge) {
      delete rows[row.id];
    } else {
      rows[row.id] = { ...row, deleted: true };
    }
  }
  return {
    state: {
      ...state,
      groups,
      groupOrder: state.groupOrder.filter((id) => id !== group.id),
      rows,
      rowOrder,
    },
    inverse: purge
      ? op
      : {
          clientOpId: op.clientOpId,
          sheetId: op.sheetId,
          type: "group.restore",
          payload: { groupId: group.id },
        },
  };
}

function restoreGroup(state: LocalSheetState, op: Extract<ClientOp, { type: "group.restore" }>): ApplyLocalResult {
  const group = state.groups[op.payload.groupId];
  if (!group?.deleted) {
    return unchanged(state, op);
  }
  const restored = withoutDeleted(group);
  const groups = { ...state.groups, [group.id]: restored };
  let rows = state.rows;
  let rowOrder = state.rowOrder;
  for (const row of Object.values(state.rows)) {
    if (row.groupId !== group.id || !row.deleted) {
      continue;
    }
    if (rows === state.rows) {
      rows = { ...rows };
    }
    rows[row.id] = withoutDeleted(row);
    rowOrder = reorder(rowOrder, row.id, row.position, (id) => rows[id]?.position ?? "");
  }
  return {
    state: {
      ...state,
      groups,
      groupOrder: reorder(state.groupOrder, group.id, group.position, (id) => groups[id]?.position ?? ""),
      rows,
      rowOrder,
    },
    inverse: {
      clientOpId: op.clientOpId,
      sheetId: op.sheetId,
      type: "group.delete",
      payload: { groupId: group.id },
    },
  };
}

function duplicateGroup(
  state: LocalSheetState,
  op: Extract<ClientOp, { type: "group.duplicate" }>,
  userId: string | null,
): ApplyLocalResult {
  const inserted = insertGroup(state, {
    clientOpId: op.clientOpId,
    sheetId: op.sheetId,
    type: "group.insert",
    payload: {
      groupId: op.payload.groupId,
      name: op.payload.name,
      color: op.payload.color,
      position: op.payload.position,
    },
  });
  if (op.payload.rows.length === 0) {
    return {
      state: inserted.state,
      inverse: {
        clientOpId: op.clientOpId,
        sheetId: op.sheetId,
        type: "group.delete",
        payload: { groupId: op.payload.groupId },
        purge: true,
      },
    };
  }
  const withRows = insertRows(
    inserted.state,
    op,
    op.payload.rows.map((row) => ({ ...row, groupId: op.payload.groupId })),
    userId,
  );
  return {
    state: withRows.state,
    inverse: {
      clientOpId: op.clientOpId,
      sheetId: op.sheetId,
      type: "group.delete",
      payload: { groupId: op.payload.groupId },
      purge: true,
    },
  };
}

function fallbackGroupId(state: LocalSheetState): string | null {
  return state.groupOrder[state.groupOrder.length - 1] ?? null;
}

function nextItemNumber(state: LocalSheetState): number {
  let max = 0;
  for (const row of Object.values(state.rows)) {
    if (row.itemNumber > max) {
      max = row.itemNumber;
    }
  }
  return max + 1;
}

function insertColumn(state: LocalSheetState, op: Extract<ClientOp, { type: "column.insert" }>): ApplyLocalResult {
  if (state.columns[op.payload.columnId]) {
    return unchanged(state, op);
  }
  const settings = settingsFor(op.payload.type, op.payload.settings);
  const column: LocalColumn = {
    id: op.payload.columnId,
    name: op.payload.name,
    type: op.payload.type,
    position: op.payload.position,
    width: op.payload.width ?? DEFAULT_WIDTH,
    settings,
  };
  const columns = { ...state.columns, [column.id]: column };
  return {
    state: {
      ...state,
      columns,
      columnOrder: reorder(state.columnOrder, column.id, column.position, (id) => columns[id]?.position ?? ""),
    },
    inverse: {
      clientOpId: op.clientOpId,
      sheetId: op.sheetId,
      type: "column.delete",
      payload: { columnId: column.id },
      purge: true,
    },
  };
}

function updateColumn(state: LocalSheetState, op: Extract<ClientOp, { type: "column.update" }>): ApplyLocalResult {
  const column = state.columns[op.payload.columnId];
  if (!column || column.deleted) {
    return unchanged(state, op);
  }
  const patch = op.payload.patch;
  const nextType = patch.type ?? column.type;
  const nextName = patch.name ?? column.name;
  const nextSettings = resolveSettings(column, nextType, patch.settings, op.restoreCells !== undefined);
  if (
    op.restoreCells === undefined &&
    column.name === nextName &&
    column.type === nextType &&
    jsonEqual(column.settings, nextSettings)
  ) {
    return unchanged(state, op);
  }

  const columns = {
    ...state.columns,
    [column.id]: { ...column, name: nextName, type: nextType, settings: nextSettings },
  };

  if (op.restoreCells) {
    let rows = state.rows;
    for (const cell of op.restoreCells) {
      const row = rows[cell.rowId];
      if (!row) {
        continue;
      }
      if (rows === state.rows) {
        rows = { ...rows };
      }
      rows[cell.rowId] = writeCell(row, cell.columnId, cell.value);
    }
    return {
      state: { ...state, columns, rows },
      inverse: {
        clientOpId: op.clientOpId,
        sheetId: op.sheetId,
        type: "column.update",
        payload: {
          columnId: column.id,
          patch: { name: column.name, type: column.type, settings: column.settings },
        },
      },
    };
  }

  const restoreCells: CellSnapshot[] = [];
  let rows = state.rows;
  const settingsChanged = !jsonEqual(column.settings, nextSettings);
  const typeChanged = column.type !== nextType;
  const convertCells = typeChanged || (settingsChanged && !isAppearanceOnlySettingsChange(column.settings, nextSettings));
  if (convertCells) {
    for (const row of Object.values(state.rows)) {
      if (row.deleted || !(column.id in row.data)) {
        continue;
      }
      const current = row.data[column.id];
      restoreCells.push({ rowId: row.id, columnId: column.id, value: current ?? null });
      const converted = convertValue(current, column.type, nextType, nextSettings);
      const written = writeCell(row, column.id, converted.value === undefined ? null : converted.value);
      if (rows === state.rows) {
        rows = { ...rows };
      }
      rows[row.id] = written;
    }
  }

  return {
    state: { ...state, columns, rows },
    inverse: {
      clientOpId: op.clientOpId,
      sheetId: op.sheetId,
      type: "column.update",
      payload: {
        columnId: column.id,
        patch: { name: column.name, type: column.type, settings: column.settings },
      },
      restoreCells: restoreCells.length ? restoreCells : undefined,
    },
  };
}

function resizeColumn(state: LocalSheetState, op: Extract<ClientOp, { type: "column.resize" }>): ApplyLocalResult {
  const column = state.columns[op.payload.columnId];
  if (!column || column.deleted || column.width === op.payload.width) {
    return unchanged(state, op);
  }
  return {
    state: {
      ...state,
      columns: { ...state.columns, [column.id]: { ...column, width: op.payload.width } },
    },
    inverse: {
      clientOpId: op.clientOpId,
      sheetId: op.sheetId,
      type: "column.resize",
      payload: { columnId: column.id, width: column.width },
    },
  };
}

function deleteColumn(state: LocalSheetState, op: Extract<ClientOp, { type: "column.delete" }>, purge: boolean): ApplyLocalResult {
  const column = state.columns[op.payload.columnId];
  if (!column || (column.deleted && !purge)) {
    return unchanged(state, op);
  }
  const columns = { ...state.columns };
  if (purge) {
    delete columns[column.id];
  } else {
    columns[column.id] = { ...column, deleted: true };
  }
  return {
    state: {
      ...state,
      columns,
      columnOrder: state.columnOrder.filter((id) => id !== column.id),
    },
    inverse: purge
      ? op
      : {
          clientOpId: op.clientOpId,
          sheetId: op.sheetId,
          type: "column.restore",
          payload: { columnId: column.id },
        },
  };
}

function restoreColumn(state: LocalSheetState, op: Extract<ClientOp, { type: "column.restore" }>): ApplyLocalResult {
  const column = state.columns[op.payload.columnId];
  if (!column?.deleted) {
    return unchanged(state, op);
  }
  const restored = withoutDeleted(column);
  const columns = { ...state.columns, [column.id]: restored };
  return {
    state: {
      ...state,
      columns,
      columnOrder: reorder(state.columnOrder, column.id, column.position, (id) => columns[id]?.position ?? ""),
    },
    inverse: {
      clientOpId: op.clientOpId,
      sheetId: op.sheetId,
      type: "column.delete",
      payload: { columnId: column.id },
    },
  };
}

function moveColumn(state: LocalSheetState, op: Extract<ClientOp, { type: "column.move" }>): ApplyLocalResult {
  const column = state.columns[op.payload.columnId];
  if (!column || column.deleted || column.position === op.payload.position) {
    return unchanged(state, op);
  }
  const previous = column.position;
  const columns = { ...state.columns, [column.id]: { ...column, position: op.payload.position } };
  return {
    state: {
      ...state,
      columns,
      columnOrder: reorder(state.columnOrder, column.id, op.payload.position, (id) => columns[id]?.position ?? ""),
    },
    inverse: {
      clientOpId: op.clientOpId,
      sheetId: op.sheetId,
      type: "column.move",
      payload: { columnId: column.id, position: previous },
    },
  };
}

function resolveSettings(
  column: LocalColumn,
  nextType: ColumnType,
  patchSettings: unknown,
  restoring: boolean,
): Record<string, JsonValue> {
  if (restoring) {
    return patchSettings === undefined ? column.settings : asSettings(patchSettings);
  }
  if (nextType !== column.type && patchSettings === undefined) {
    return { ...carryColumnSettings(column.type, nextType, column.settings), ...appearanceFromSettings(column.settings) };
  }
  if (patchSettings === undefined) {
    return column.settings;
  }
  const merged =
    nextType === column.type
      ? mergeColumnSettings(nextType, column.settings, patchSettings)
      : normalizeSettings(nextType, { ...carryColumnSettings(column.type, nextType, column.settings), ...appearanceFromSettings(column.settings), ...asSettings(patchSettings) });
  return merged.ok ? merged.settings : defaultSettings(nextType);
}

function settingsFor(type: ColumnType, settings: unknown): Record<string, JsonValue> {
  if (settings === undefined) {
    return defaultSettings(type);
  }
  const normalized = normalizeSettings(type, settings);
  return normalized.ok ? normalized.settings : defaultSettings(type);
}

function defaultSettings(type: ColumnType): Record<string, JsonValue> {
  return defaultColumnSettings(type);
}

function asSettings(value: unknown): Record<string, JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, JsonValue>) };
}

function copyData(data: Record<string, unknown> | undefined): Record<string, JsonValue> {
  const next: Record<string, JsonValue> = {};
  if (!data) {
    return next;
  }
  for (const [key, value] of Object.entries(data)) {
    const stored = asStored(value);
    if (stored !== null) {
      next[key] = stored;
    }
  }
  return next;
}

function asStored(value: unknown): JsonValue | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return value.trim() ? value : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value) || isPlainObject(value)) {
    return value as JsonValue;
  }
  return String(value);
}

function writeCell(row: LocalRow, columnId: string, value: JsonValue | null): LocalRow {
  const data = { ...row.data };
  if (value === null) {
    delete data[columnId];
  } else {
    data[columnId] = value;
  }
  return { ...row, data, updatedAt: new Date().toISOString() };
}

function sameValue(current: JsonValue | undefined, next: JsonValue | null): boolean {
  if (next === null) {
    return current === undefined;
  }
  if (current === next) {
    return true;
  }
  if (typeof current === "object" && current !== null && typeof next === "object") {
    return JSON.stringify(current) === JSON.stringify(next);
  }
  return false;
}

function reorder(order: string[], id: string, position: string, positionOf: (id: string) => string): string[] {
  const next = order.filter((item) => item !== id);
  let low = 0;
  let high = next.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const current = positionOf(next[mid] ?? "");
    if (current <= position) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  next.splice(low, 0, id);
  return next;
}

function withoutDeleted<T extends { deleted?: boolean }>(entity: T): T {
  const copy = { ...entity };
  delete copy.deleted;
  return copy;
}

function unchanged(state: LocalSheetState, op: ClientOp): ApplyLocalResult {
  return { state, inverse: op };
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
