import type { ColumnType, SheetDirection, SheetPreview, SheetPreviewCell } from "@/lib/db-types";
import { query } from "@/lib/db";
import { asStringList, PRIORITY_OPTIONS } from "@/lib/sheets/column-meta";
import { countryByCode, countryName, findCountry } from "@/lib/sheets/countries";
import type { JsonValue } from "@/lib/sheets/ops";

const MAX_GROUPS = 3;
const MAX_ROWS = 3;
const FETCH_ROWS = 12;
const PILL_TYPES = new Set<ColumnType>(["status", "priority", "dropdown"]);
const EXTRA_TYPES = new Set<ColumnType>(["date", "due_date", "country", "number", "tags", "link", "long_text"]);

interface SheetHead {
  workbook_id: string;
  sheet_id: string;
  direction: SheetDirection;
}

interface GroupHead {
  sheet_id: string;
  id: string;
  name: string;
  color: string;
  position: string;
}

interface ColumnHead {
  sheet_id: string;
  id: string;
  name: string;
  type: ColumnType;
  position: string;
  settings: Record<string, JsonValue>;
}

interface RowHead {
  sheet_id: string;
  group_id: string | null;
  data: Record<string, JsonValue>;
  position: string;
}

function comparePosition(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function linkHost(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url.replace(/^https?:\/\//, "");
  }
}

function formatShortDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) {
    return value;
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

function readOptions(settings: unknown): Array<{ id: string; label: string; color: string }> {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return [];
  }
  const options = (settings as { options?: unknown }).options;
  if (!Array.isArray(options)) {
    return [];
  }
  const parsed: Array<{ id: string; label: string; color: string }> = [];
  for (const option of options) {
    if (!option || typeof option !== "object" || Array.isArray(option)) {
      continue;
    }
    if (typeof option.id === "string" && typeof option.label === "string" && typeof option.color === "string") {
      parsed.push({ id: option.id, label: option.label, color: option.color });
    }
  }
  return parsed;
}

function optionChip(column: ColumnHead, id: string): SheetPreviewCell {
  const stored = readOptions(column.settings);
  const options = stored.length > 0 ? stored : column.type === "priority" ? PRIORITY_OPTIONS : [];
  const option = options.find((item) => item.id === id);
  if (!option) {
    return { text: "", color: null, pill: true };
  }
  return { text: option.label, color: option.color, pill: true };
}

function previewCell(column: ColumnHead, value: JsonValue | undefined): SheetPreviewCell {
  if (column.type === "status" || column.type === "priority") {
    return typeof value === "string" ? optionChip(column, value) : { text: "", color: null, pill: true };
  }
  if (column.type === "dropdown") {
    const ids = typeof value === "string" ? [value] : asStringList(value);
    return ids[0] ? optionChip(column, ids[0]) : { text: "", color: null, pill: true };
  }
  if (column.type === "country" && typeof value === "string") {
    const country = countryByCode(value) ?? findCountry(value);
    return { text: country ? countryName(country, true) : value, color: null, pill: false };
  }
  if ((column.type === "date" || column.type === "due_date") && typeof value === "string") {
    return { text: formatShortDate(value), color: null, pill: false };
  }
  if (column.type === "number" && (typeof value === "number" || typeof value === "string")) {
    return { text: String(value), color: null, pill: false };
  }
  if (column.type === "tags") {
    return { text: asStringList(value).slice(0, 2).join(", "), color: null, pill: false };
  }
  if (column.type === "link" && value && typeof value === "object" && !Array.isArray(value)) {
    const url = "url" in value && typeof value.url === "string" ? value.url : "";
    const label = "label" in value && typeof value.label === "string" ? value.label.trim() : "";
    return { text: label || linkHost(url), color: null, pill: false };
  }
  if (typeof value === "string") {
    return { text: value.trim(), color: null, pill: false };
  }
  return { text: "", color: null, pill: false };
}

function cellHasText(cell: SheetPreviewCell): boolean {
  return cell.text.trim().length > 0;
}

function filledCount(column: ColumnHead, rows: RowHead[]): number {
  return rows.filter((row) => cellHasText(previewCell(column, row.data[column.id]))).length;
}

function pickColumns(columns: ColumnHead[], rows: RowHead[]): ColumnHead[] {
  const ordered = [...columns].sort((left, right) => comparePosition(left.position, right.position));
  const name =
    ordered.find((column) => (column.type === "text" || column.type === "long_text") && filledCount(column, rows) > 0) ??
    ordered.find((column) => (column.type === "link" || column.type === "country") && filledCount(column, rows) > 0) ??
    ordered.find((column) => column.type === "text" || column.type === "long_text") ??
    ordered.find((column) => filledCount(column, rows) > 0) ??
    ordered[0];
  if (!name) {
    return [];
  }
  const extras = ordered.filter(
    (column) => column.id !== name.id && (PILL_TYPES.has(column.type) || EXTRA_TYPES.has(column.type)) && filledCount(column, rows) > 0,
  );
  const pills = extras.filter((column) => PILL_TYPES.has(column.type));
  const others = extras.filter((column) => !PILL_TYPES.has(column.type));
  const extraIds = new Set([...pills, ...others].slice(0, 2).map((column) => column.id));
  return [name, ...ordered.filter((column) => extraIds.has(column.id))];
}

function rowIsFilled(row: RowHead, columns: ColumnHead[]): boolean {
  return columns.some((column) => cellHasText(previewCell(column, row.data[column.id])));
}

function pickRows(
  groups: GroupHead[],
  rows: RowHead[],
  columns: ColumnHead[],
): Array<{ color: string; data: Record<string, JsonValue> }> {
  const orderedGroups = [...groups].sort((left, right) => comparePosition(left.position, right.position)).slice(0, MAX_GROUPS);
  const buckets = new Map<string, RowHead[]>();
  for (const row of rows) {
    if (!row.group_id) {
      continue;
    }
    const bucket = buckets.get(row.group_id) ?? [];
    bucket.push(row);
    buckets.set(row.group_id, bucket);
  }
  for (const bucket of buckets.values()) {
    bucket.sort((left, right) => comparePosition(left.position, right.position));
    if (columns.length > 0) {
      const filled = bucket.filter((row) => rowIsFilled(row, columns));
      bucket.splice(0, bucket.length, ...(filled.length > 0 ? filled : bucket));
    }
  }

  const perGroup = orderedGroups.length <= 1 ? MAX_ROWS : orderedGroups.length === 2 ? 2 : 1;
  const picked: Array<{ color: string; data: Record<string, JsonValue> }> = [];
  const cursors = orderedGroups.map(() => 0);

  for (let index = 0; index < orderedGroups.length && picked.length < MAX_ROWS; index += 1) {
    const group = orderedGroups[index];
    if (!group) {
      continue;
    }
    const bucket = buckets.get(group.id) ?? [];
    const take = Math.min(perGroup, MAX_ROWS - picked.length, bucket.length);
    for (let offset = 0; offset < take; offset += 1) {
      const row = bucket[offset];
      if (row) {
        picked.push({ color: group.color, data: row.data });
      }
    }
    cursors[index] = take;
  }

  for (let index = 0; index < orderedGroups.length && picked.length < MAX_ROWS; index += 1) {
    const group = orderedGroups[index];
    if (!group) {
      continue;
    }
    const bucket = buckets.get(group.id) ?? [];
    let cursor = cursors[index] ?? 0;
    while (cursor < bucket.length && picked.length < MAX_ROWS) {
      const row = bucket[cursor];
      if (row) {
        picked.push({ color: group.color, data: row.data });
      }
      cursor += 1;
    }
  }

  if (picked.length === 0) {
    return orderedGroups.slice(0, MAX_ROWS).map((group) => ({ color: group.color, data: {} }));
  }
  return picked;
}

function previewFor(sheet: SheetHead, groups: GroupHead[], columns: ColumnHead[], rows: RowHead[]): SheetPreview {
  const chosen = pickColumns(columns, rows);
  const picked = pickRows(groups, rows, chosen)
    .map((row) => ({
      color: row.color,
      cells: chosen.map((column) => previewCell(column, row.data[column.id])),
    }))
    .filter((row) => row.cells.some((cell) => cellHasText(cell)))
    .slice(0, MAX_ROWS);
  const visible = picked.length > 0 ? picked : pickRows(groups, rows, []).slice(0, MAX_ROWS).map((row) => ({
    color: row.color,
    cells: chosen.map((column) => previewCell(column, row.data[column.id])),
  }));
  return {
    direction: sheet.direction,
    columns: chosen.map((column) => column.name),
    rows: visible,
  };
}

export async function loadWorkbookPreviews(workbookIds: string[]): Promise<Map<string, SheetPreview>> {
  const previews = new Map<string, SheetPreview>();
  if (workbookIds.length === 0) {
    return previews;
  }

  const sheets = await query<SheetHead>(
    `SELECT DISTINCT ON (s.workbook_id)
            s.workbook_id, s.id AS sheet_id, s.direction
     FROM monitor_sheets s
     WHERE s.workbook_id = ANY($1::uuid[]) AND s.archived_at IS NULL
     ORDER BY s.workbook_id, s.position`,
    [workbookIds],
  );
  const sheetIds = sheets.map((sheet) => sheet.sheet_id);
  if (sheetIds.length === 0) {
    return previews;
  }

  const [groups, columns, rows] = await Promise.all([
    query<GroupHead>(
      `SELECT sheet_id, id, name, color, position
       FROM (
         SELECT g.sheet_id, g.id, g.name, g.color, g.position,
                row_number() OVER (PARTITION BY g.sheet_id ORDER BY g.position) AS rn
         FROM monitor_groups g
         WHERE g.sheet_id = ANY($1::uuid[]) AND g.deleted_at IS NULL
       ) ranked
       WHERE rn <= $2`,
      [sheetIds, MAX_GROUPS],
    ),
    query<ColumnHead>(
      `SELECT id, sheet_id, name, type, position, settings
       FROM monitor_columns
       WHERE sheet_id = ANY($1::uuid[]) AND deleted_at IS NULL
       ORDER BY position`,
      [sheetIds],
    ),
    query<RowHead>(
      `SELECT sheet_id, group_id, data, position
       FROM (
         SELECT r.sheet_id, r.group_id, r.data, r.position,
                row_number() OVER (PARTITION BY r.sheet_id, r.group_id ORDER BY r.position) AS rn
         FROM monitor_rows r
         WHERE r.sheet_id = ANY($1::uuid[]) AND r.deleted_at IS NULL
       ) ranked
       WHERE rn <= $2`,
      [sheetIds, FETCH_ROWS],
    ),
  ]);

  const groupsBySheet = new Map<string, GroupHead[]>();
  for (const group of groups) {
    const list = groupsBySheet.get(group.sheet_id) ?? [];
    list.push(group);
    groupsBySheet.set(group.sheet_id, list);
  }
  const columnsBySheet = new Map<string, ColumnHead[]>();
  for (const column of columns) {
    const list = columnsBySheet.get(column.sheet_id) ?? [];
    list.push(column);
    columnsBySheet.set(column.sheet_id, list);
  }
  const rowsBySheet = new Map<string, RowHead[]>();
  for (const row of rows) {
    const list = rowsBySheet.get(row.sheet_id) ?? [];
    list.push(row);
    rowsBySheet.set(row.sheet_id, list);
  }

  for (const sheet of sheets) {
    previews.set(
      sheet.workbook_id,
      previewFor(
        sheet,
        groupsBySheet.get(sheet.sheet_id) ?? [],
        columnsBySheet.get(sheet.sheet_id) ?? [],
        rowsBySheet.get(sheet.sheet_id) ?? [],
      ),
    );
  }
  return previews;
}
