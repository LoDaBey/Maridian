import Papa from "papaparse";
import { PRESENCE_COLORS } from "@/lib/colors";
import type { ColumnType, SpreadsheetTable } from "@/lib/db-types";
import type { JsonValue } from "@/lib/sheets/ops";
import { defaultColumnSettings } from "@/lib/sheets/column-meta";
import { displayValue, normalizeValue, type ValueColumn } from "@/lib/sheets/values";

export const CSV_MAX_BYTES = 5 * 1024 * 1024;
export const CSV_MAX_ROWS = 10_000;
export const IMPORT_CHUNK_SIZE = 200;
export const PREVIEW_ROW_COUNT = 20;

export const DATE_FORMATS = [
  { id: "iso", label: "YYYY-MM-DD" },
  { id: "dmy", label: "D/M/YYYY" },
  { id: "mdy", label: "M/D/YYYY" },
  { id: "month", label: "Month D, YYYY" },
] as const;

export type DateFormatId = (typeof DATE_FORMATS)[number]["id"];

export interface SheetColumnRef {
  id: string;
  name: string;
  type: ColumnType;
  settings?: unknown;
}

export interface ImportPerson {
  id: string;
  fullName: string;
  email: string;
}

export interface ColumnChoice {
  header: string;
  kind: "skip" | "existing" | "new";
  columnId: string;
  type: ColumnType;
}

export interface PlannedColumn {
  columnId: string;
  name: string;
  type: ColumnType;
  settings: Record<string, JsonValue>;
  source: "existing" | "new";
}

export interface PreviewCell {
  text: string;
  invalid: boolean;
}

export interface StatusUpdate {
  columnId: string;
  settings: { options: StatusOption[] };
}

export interface ImportRowsResult {
  ok: boolean;
  error: string;
  sheetId: string | null;
  inserted: number;
  skippedCells: number;
  unmatchedPeople: string[];
  tabs?: Array<{ sheetId: string; name: string }>;
}

export interface ImportPlan {
  columns: PlannedColumn[];
  statusUpdates: StatusUpdate[];
  rows: Array<Record<string, JsonValue>>;
  preview: PreviewCell[][];
  totalRows: number;
  emptyCells: number;
  invalidDates: number;
  unknownPeople: number;
  unmatchedPeople: string[];
  summary: string;
}

export interface StatusOption {
  id: string;
  label: string;
  color: string;
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const FORMULA_START = /^[=+\-@]/;

export function parseCsv(text: string): SpreadsheetTable | { error: string } {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const result = Papa.parse<string[]>(source, {
    header: false,
    skipEmptyLines: "greedy",
  });
  if (result.data.length === 0 && result.errors.length > 0) {
    return { error: result.errors[0]?.message || "The CSV could not be read." };
  }
  return tableFromRows(result.data.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : [])));
}

export function tableFromRows(matrix: readonly (readonly string[])[]): SpreadsheetTable | { error: string } {
  const rows = matrix.map((row) => [...row]);
  const start = rows.findIndex((row) => row.some((cell) => cell.trim().length > 0));
  if (start < 0) {
    return { error: "The spreadsheet is empty." };
  }
  const headerIndex = findHeaderRowIndex(rows, start);
  const headerRow = rows[headerIndex] ?? [];
  let width = 0;
  for (const row of rows) {
    width = Math.max(width, row.length);
  }
  let last = Math.max(width, headerRow.length) - 1;
  while (last >= 0 && !(headerRow[last] ?? "").trim()) {
    last -= 1;
  }
  if (last < 0) {
    return { error: "The spreadsheet needs a header row." };
  }
  const used = new Map<string, number>();
  const headers: string[] = [];
  for (let index = 0; index <= last; index += 1) {
    const raw = (headerRow[index] ?? "").trim() || `Column ${index + 1}`;
    const count = (used.get(raw) ?? 0) + 1;
    used.set(raw, count);
    headers.push(count === 1 ? raw : `${raw} ${count}`);
  }
  const headerKey = headerFingerprint(headers);
  const body = rows
    .slice(headerIndex + 1)
    .map((row) => headers.map((_, index) => row[index] ?? ""))
    .filter((row) => row.some((cell) => cell.trim().length > 0))
    .filter((row) => headerFingerprint(row) !== headerKey);
  if (body.length > CSV_MAX_ROWS) {
    return { error: "A spreadsheet can have 10 000 rows." };
  }
  return { headers, rows: body };
}

function findHeaderRowIndex(rows: readonly (readonly string[])[], start: number): number {
  let best = start;
  let bestScore = Number.NEGATIVE_INFINITY;
  const limit = Math.min(rows.length, start + 15);
  for (let index = start; index < limit; index += 1) {
    const score = headerRowScore(rows[index] ?? []);
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  }
  return bestScore < 4 ? start : best;
}

function headerRowScore(row: readonly string[]): number {
  const filled = row.map((cell) => cell.trim()).filter(Boolean);
  if (filled.length === 0) {
    return Number.NEGATIVE_INFINITY;
  }
  let score = filled.length;
  for (const cell of filled) {
    if (/@/.test(cell) || /^https?:\/\//i.test(cell) || /^-?\d{6,}$/.test(cell) || cell.length > 40) {
      score -= 3;
    } else {
      score += 2;
    }
  }
  return score;
}

function headerFingerprint(row: readonly string[]): string {
  return row.map((cell) => cell.trim().replace(/\s+/g, " ").toLowerCase()).join("\u001f");
}

export function exportCsv(
  columns: Array<{ id: string; name: string; type: ColumnType; settings?: unknown }>,
  rows: Array<{ data: Record<string, JsonValue | undefined> }>,
  usersById: ReadonlyMap<string, string>,
): string {
  const header = columns.map((column) => escapeCsvField(column.name)).join(",");
  const lines = rows.map((row) =>
    columns.map((column) => escapeCsvField(exportCell(column, row.data[column.id], usersById))).join(","),
  );
  return `\uFEFF${[header, ...lines].join("\r\n")}\r\n`;
}

export function escapeCsvField(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function contentDisposition(sheetName: string, date: string): string {
  const cleaned = sheetName.replace(/[\r\n]/g, " ").trim() || "sheet";
  const filename = `${cleaned}-${date}.csv`;
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function calendarDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function guessDateFormat(rows: readonly (readonly string[])[]): DateFormatId {
  const scores: Record<DateFormatId, number> = { iso: 0, dmy: 0, mdy: 0, month: 0 };
  for (const row of rows.slice(0, 50)) {
    for (const cell of row) {
      const text = cell.trim();
      if (!text) {
        continue;
      }
      if (parseDate(text, "month")) {
        scores.month += 1;
        continue;
      }
      if (parseDate(text, "iso")) {
        scores.iso += 1;
        continue;
      }
      const dmy = parseDate(text, "dmy");
      const mdy = parseDate(text, "mdy");
      if (dmy && !mdy) {
        scores.dmy += 1;
      } else if (mdy && !dmy) {
        scores.mdy += 1;
      }
    }
  }
  let best: DateFormatId = "iso";
  let bestScore = 0;
  for (const format of ["month", "iso", "dmy", "mdy"] as const) {
    if (scores[format] > bestScore) {
      best = format;
      bestScore = scores[format];
    }
  }
  return best;
}

export function autoMapColumns(
  headers: readonly string[],
  columns: readonly SheetColumnRef[],
  rows: readonly (readonly string[])[],
  dateFormat: DateFormatId,
  people: readonly ImportPerson[],
  createId: () => string,
): ColumnChoice[] {
  const used = new Set<string>();
  return headers.map((header, index) => {
    const exact = columns.find((column) => !used.has(column.id) && column.name.trim() === header.trim());
    const matched = exact ?? columns.find((column) => !used.has(column.id) && normalizeName(column.name) === normalizeName(header));
    if (matched) {
      used.add(matched.id);
      return { header, kind: "existing", columnId: matched.id, type: matched.type };
    }
    const values = rows.map((row) => row[index] ?? "");
    const fromValues = guessType(values, dateFormat, people);
    const type = fromValues !== "text" ? fromValues : (guessTypeFromHeader(header) ?? "text");
    return { header, kind: "new", columnId: createId(), type };
  });
}

export function buildImport(input: {
  headers: readonly string[];
  rows: readonly (readonly string[])[];
  choices: readonly ColumnChoice[];
  dateFormat: DateFormatId;
  columns: readonly SheetColumnRef[];
  people: readonly ImportPerson[];
  createId?: () => string;
}): ImportPlan | { error: string } {
  const createId = input.createId ?? (() => crypto.randomUUID());
  const selected = input.choices.filter((choice) => choice.kind !== "skip");
  const existingIds = selected.filter((choice) => choice.kind === "existing").map((choice) => choice.columnId);
  if (new Set(existingIds).size !== existingIds.length) {
    return { error: "Each column can only be mapped once." };
  }

  const peopleByKey = indexPeople(input.people);
  const planned: PlannedColumn[] = [];
  const statusUpdates: StatusUpdate[] = [];
  const columnIndexes: number[] = [];

  input.choices.forEach((choice, index) => {
    if (choice.kind === "skip") {
      return;
    }
    const header = input.headers[index] ?? choice.header;
    if (choice.kind === "existing") {
      const column = input.columns.find((item) => item.id === choice.columnId);
      if (!column) {
        return;
      }
      const settings = readSettings(column);
      planned.push({
        columnId: column.id,
        name: column.name,
        type: column.type,
        settings,
        source: "existing",
      });
      columnIndexes.push(index);
      return;
    }
    const name = header.trim().slice(0, 100) || `Column ${planned.length + 1}`;
    planned.push({
      columnId: choice.columnId,
      name,
      type: choice.type,
      settings: defaultColumnSettings(choice.type),
      source: "new",
    });
    columnIndexes.push(index);
  });

  const rows: Array<Record<string, JsonValue>> = [];
  const preview: PreviewCell[][] = [];
  let emptyCells = 0;
  let invalidDates = 0;
  let unknownPeople = 0;
  const unmatched: string[] = [];
  const seenUnmatched = new Set<string>();

  input.rows.forEach((row, rowIndex) => {
    const data: Record<string, JsonValue> = {};
    const previewRow: PreviewCell[] = [];
    planned.forEach((column, plannedIndex) => {
      const sourceIndex = columnIndexes[plannedIndex] ?? 0;
      const raw = (row[sourceIndex] ?? "").trim();
      const mapped = mapCell(column, raw, input.dateFormat, peopleByKey, input.people, createId);
      if (mapped.unmatched.length > 0) {
        for (const name of mapped.unmatched) {
          const key = normalizeName(name);
          if (!seenUnmatched.has(key)) {
            seenUnmatched.add(key);
            unmatched.push(name);
          }
        }
      }
      if (mapped.invalid) {
        emptyCells += 1;
        if (mapped.invalid === "date") {
          invalidDates += 1;
        } else if (mapped.invalid === "person") {
          unknownPeople += 1;
        }
      }
      if (mapped.value !== undefined) {
        data[column.columnId] = mapped.value;
      }
      if (rowIndex < PREVIEW_ROW_COUNT) {
        previewRow.push({
          text: mapped.invalid ? raw : displayValue(column, mapped.value, peopleMap(input.people)),
          invalid: mapped.invalid !== null,
        });
      }
    });
    rows.push(data);
    if (rowIndex < PREVIEW_ROW_COUNT) {
      preview.push(previewRow);
    }
  });

  for (const column of planned) {
    if (column.type !== "status") {
      continue;
    }
    const options = readOptions(column.settings);
    if (column.source === "existing" && options.length > readOptions(input.columns.find((item) => item.id === column.columnId)?.settings).length) {
      statusUpdates.push({ columnId: column.columnId, settings: { options } });
    }
  }

  const otherInvalid = emptyCells - invalidDates - unknownPeople;
  const parts: string[] = [];
  if (invalidDates > 0) {
    parts.push(`invalid dates: ${formatCount(invalidDates)}`);
  }
  if (unknownPeople > 0) {
    parts.push(`unknown people: ${formatCount(unknownPeople)}`);
  }
  if (otherInvalid > 0) {
    parts.push(`other invalid: ${formatCount(otherInvalid)}`);
  }
  const detail = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  const rowWord = input.rows.length === 1 ? "row" : "rows";
  const cellWord = emptyCells === 1 ? "cell" : "cells";
  return {
    columns: planned,
    statusUpdates,
    rows,
    preview,
    totalRows: input.rows.length,
    emptyCells,
    invalidDates,
    unknownPeople,
    unmatchedPeople: unmatched,
    summary: `${formatCount(input.rows.length)} ${rowWord}, ${formatCount(emptyCells)} ${cellWord} will be empty${detail}`,
  };
}

export function parseDate(value: string, format: DateFormatId): string | undefined {
  const text = value.trim();
  if (!text) {
    return undefined;
  }
  if (format === "iso") {
    return parseIsoLikeDate(text);
  }
  if (format === "dmy" || format === "mdy") {
    const match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
    if (!match) {
      return undefined;
    }
    const first = Number(match[1]);
    const second = Number(match[2]);
    const year = Number(match[3]);
    const day = format === "dmy" ? first : second;
    const month = format === "dmy" ? second : first;
    return isoFromParts(year, month, day);
  }
  const match = new RegExp(`^(${MONTHS.join("|")})\\s+(\\d{1,2}),\\s*(\\d{4})$`, "i").exec(text);
  if (!match) {
    return undefined;
  }
  const month = MONTHS.indexOf(match[1]?.toLowerCase() ?? "") + 1;
  return isoFromParts(Number(match[3]), month, Number(match[2]));
}

function exportCell(
  column: { type: ColumnType; settings?: unknown },
  value: JsonValue | undefined,
  usersById: ReadonlyMap<string, string>,
): string {
  if (column.type === "link") {
    if (value && typeof value === "object" && !Array.isArray(value) && typeof value.url === "string") {
      return value.url;
    }
    return "";
  }
  return displayValue(column, value, usersById);
}

function mapCell(
  column: PlannedColumn,
  raw: string,
  dateFormat: DateFormatId,
  peopleByKey: Map<string, ImportPerson[]>,
  people: readonly ImportPerson[],
  createId: () => string,
): { value: JsonValue | undefined; invalid: "date" | "person" | "other" | null; unmatched: string[] } {
  if (!raw) {
    return { value: undefined, invalid: null, unmatched: [] };
  }
  if (column.type === "date" || column.type === "due_date") {
    const iso = parseDate(raw, dateFormat);
    if (!iso) {
      return { value: undefined, invalid: "date", unmatched: [] };
    }
    return finish(column, iso);
  }
  if (column.type === "person") {
    return mapPerson(column, raw, peopleByKey);
  }
  if (column.type === "status") {
    return mapStatus(column, raw, createId);
  }
  if (column.type === "link") {
    const normalized = normalizeValue({ type: "link" }, raw);
    if (!normalized.ok || normalized.value === undefined) {
      return { value: undefined, invalid: "other", unmatched: [] };
    }
    if (typeof normalized.value === "object" && normalized.value && !Array.isArray(normalized.value) && typeof normalized.value.url === "string") {
      return { value: { url: normalized.value.url }, invalid: null, unmatched: [] };
    }
    return { value: undefined, invalid: "other", unmatched: [] };
  }
  return finish(column, raw);
}

function finish(
  column: ValueColumn,
  raw: unknown,
): { value: JsonValue | undefined; invalid: "date" | "person" | "other" | null; unmatched: string[] } {
  const normalized = normalizeValue(column, raw);
  if (!normalized.ok) {
    return { value: undefined, invalid: "other", unmatched: [] };
  }
  return { value: normalized.value, invalid: null, unmatched: [] };
}

export function mapPerson(
  column: PlannedColumn,
  raw: string,
  peopleByKey: Map<string, ImportPerson[]>,
): { value: JsonValue | undefined; invalid: "date" | "person" | "other" | null; unmatched: string[] } {
  const tokens = raw.split(/[,،\n\r]+/).map((part) => part.trim()).filter(Boolean);
  const ids: string[] = [];
  const unmatched: string[] = [];
  for (const token of tokens) {
    const matches = peopleByKey.get(normalizeName(token)) ?? [];
    const person = matches.length === 1 ? matches[0] : undefined;
    if (!person) {
      unmatched.push(token);
      continue;
    }
    if (!ids.includes(person.id)) {
      ids.push(person.id);
    }
  }
  let multiple = readMultiple(column.settings);
  if (column.source === "new" && ids.length > 1) {
    multiple = true;
    column.settings = { multiple: true };
  }
  const stored = multiple ? ids : ids.slice(0, 1);
  if (stored.length === 0) {
    return { value: undefined, invalid: "person", unmatched };
  }
  return { value: stored, invalid: null, unmatched };
}

function mapStatus(
  column: PlannedColumn,
  raw: string,
  createId: () => string,
): { value: JsonValue | undefined; invalid: "date" | "person" | "other" | null; unmatched: string[] } {
  const label = raw.trim();
  if (!label || label.length > 50) {
    return { value: undefined, invalid: "other", unmatched: [] };
  }
  const options = readOptions(column.settings);
  const existing = options.find((option) => normalizeName(option.label) === normalizeName(label));
  if (existing) {
    return { value: existing.id, invalid: null, unmatched: [] };
  }
  if (options.length >= 50) {
    return { value: undefined, invalid: "other", unmatched: [] };
  }
  const created: StatusOption = {
    id: createId(),
    label,
    color: PRESENCE_COLORS[options.length % PRESENCE_COLORS.length] ?? PRESENCE_COLORS[0],
  };
  options.push(created);
  column.settings = statusSettings(options);
  return { value: created.id, invalid: null, unmatched: [] };
}

function guessType(values: readonly string[], dateFormat: DateFormatId, people: readonly ImportPerson[]): ColumnType {
  const sample = values.map((value) => value.trim()).filter(Boolean).slice(0, 200);
  if (sample.length === 0) {
    return "text";
  }
  const share = (count: number) => count / sample.length;
  if (share(sample.filter((value) => isNumber(value)).length) >= 0.8) {
    return "number";
  }
  if (share(sample.filter((value) => isCheckbox(value)).length) >= 0.8) {
    return "checkbox";
  }
  if (share(sample.filter((value) => parseDate(value, dateFormat) !== undefined).length) >= 0.8) {
    return "date";
  }
  if (share(sample.filter((value) => looksLikeUrl(value)).length) >= 0.8) {
    return "link";
  }
  const peopleByKey = indexPeople(people);
  const personCells = sample.filter((value) => cellLooksLikePeople(value, peopleByKey)).length;
  if (personCells / sample.length >= 0.5) {
    return "person";
  }
  const unique = new Set(sample.map((value) => normalizeName(value)));
  if (
    sample.length >= 2 &&
    unique.size < sample.length &&
    unique.size <= 20 &&
    sample.every((value) => value.length <= 50)
  ) {
    return "status";
  }
  const average = sample.reduce((sum, value) => sum + value.length, 0) / sample.length;
  if (average > 80) {
    return "long_text";
  }
  return "text";
}

function guessTypeFromHeader(header: string): ColumnType | undefined {
  const name = normalizeName(header);
  if (!name) {
    return undefined;
  }
  if (
    name === "date" ||
    name === "due date" ||
    name === "due" ||
    name === "تاريخ" ||
    name.endsWith(" date") ||
    name.startsWith("date ")
  ) {
    return "date";
  }
  if (
    name.includes("link") ||
    name.includes("url") ||
    name.includes("رابط") ||
    name.endsWith(" uri")
  ) {
    return "link";
  }
  if (name === "status" || name === "حالة" || name === "state") {
    return "status";
  }
  if (
    name === "person" ||
    name === "people" ||
    name === "owner" ||
    name === "assignee" ||
    name === "designer" ||
    name === "مصمم" ||
    name.includes("assignee") ||
    name.includes("owner")
  ) {
    return "person";
  }
  return undefined;
}

function looksLikeUrl(value: string): boolean {
  const text = value.trim();
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(text) || !text.includes(".") || text.includes("@")) {
    return false;
  }
  if (!/^https?:\/\//i.test(text) && !text.startsWith("www.")) {
    return false;
  }
  const normalized = normalizeValue({ type: "link" }, text);
  return normalized.ok && normalized.value !== undefined;
}

function cellLooksLikePeople(value: string, peopleByKey: Map<string, ImportPerson[]>): boolean {
  const tokens = value.split(/[,،\n\r]+/).map((part) => part.trim()).filter(Boolean);
  if (tokens.length === 0) {
    return false;
  }
  const known = tokens.filter((token) => (peopleByKey.get(normalizeName(token)) ?? []).length === 1).length;
  return known > 0 && known >= tokens.length / 2;
}

function isNumber(value: string): boolean {
  const normalized = normalizeValue({ type: "number" }, value);
  return normalized.ok && normalized.value !== undefined;
}

function isCheckbox(value: string): boolean {
  const normalized = normalizeValue({ type: "checkbox" }, value);
  return normalized.ok && normalized.value !== undefined;
}

export function indexPeople(people: readonly ImportPerson[]): Map<string, ImportPerson[]> {
  const map = new Map<string, ImportPerson[]>();
  for (const person of people) {
    for (const key of [normalizeName(person.fullName), normalizeName(person.email)]) {
      if (!key) {
        continue;
      }
      const list = map.get(key) ?? [];
      list.push(person);
      map.set(key, list);
    }
  }
  return map;
}

function peopleMap(people: readonly ImportPerson[]): Map<string, string> {
  return new Map(people.map((person) => [person.id, person.fullName]));
}

export function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function readSettings(column: { type: ColumnType; settings?: unknown }): Record<string, JsonValue> {
  if (column.type === "status") {
    return statusSettings(readOptions(column.settings));
  }
  if (column.type === "person") {
    return { multiple: readMultiple(column.settings) };
  }
  return {};
}

function statusSettings(options: StatusOption[]): Record<string, JsonValue> {
  const stored: JsonValue[] = options.map((option) => ({
    id: option.id,
    label: option.label,
    color: option.color,
  }));
  return { options: stored };
}

export function readOptions(settings: unknown): StatusOption[] {
  if (!settings || typeof settings !== "object" || !("options" in settings)) {
    return [];
  }
  const options = (settings as { options?: unknown }).options;
  if (!Array.isArray(options)) {
    return [];
  }
  const parsed: StatusOption[] = [];
  for (const option of options) {
    if (!option || typeof option !== "object") {
      continue;
    }
    const record = option as { id?: unknown; label?: unknown; color?: unknown };
    if (typeof record.id === "string" && typeof record.label === "string" && typeof record.color === "string") {
      parsed.push({ id: record.id, label: record.label, color: record.color });
    }
  }
  return parsed;
}

function readMultiple(settings: unknown): boolean {
  return Boolean(settings && typeof settings === "object" && "multiple" in settings && (settings as { multiple?: unknown }).multiple === true);
}

function parseIsoLikeDate(value: string): string | undefined {
  const match = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/.exec(value.trim());
  if (!match) {
    return undefined;
  }
  return isoFromParts(Number(match[1]), Number(match[2]), Number(match[3]));
}

function isoFromParts(year: number, month: number, day: number): string | undefined {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return undefined;
  }
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) {
    return undefined;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return undefined;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value).replace(/,/g, " ");
}
