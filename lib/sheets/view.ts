import type { ColumnType } from "@/lib/db-types";
import type { JsonValue } from "@/lib/sheets/ops";
import { displayValue } from "@/lib/sheets/values";

export const VIEW_STORAGE_PREFIX = "monitor:view:";

export type FilterOperator =
  | "contains"
  | "does_not_contain"
  | "is_empty"
  | "is_not_empty"
  | "is_any_of"
  | "is_none_of"
  | "includes_any"
  | "is_today"
  | "is_yesterday"
  | "is_this_week"
  | "is_last_7_days"
  | "is_this_month"
  | "between"
  | "eq"
  | "neq"
  | "gt"
  | "lt"
  | "is_checked"
  | "is_unchecked"
  | "in_values";

export interface FilterRule {
  id: string;
  columnId: string;
  operator: FilterOperator;
  value?: string;
  values?: string[];
  from?: string;
  to?: string;
}

export interface SortRule {
  columnId: string;
  direction: "asc" | "desc";
}

export interface SheetView {
  search: string;
  filters: FilterRule[];
  sort: SortRule | null;
  mine: boolean;
  today: boolean;
  filterActive: boolean;
}

export interface ViewColumn {
  id: string;
  type: ColumnType;
  settings?: unknown;
}

export interface ViewRow {
  id: string;
  createdBy: string | null;
  data: Record<string, JsonValue | undefined>;
  deleted?: boolean;
}

export const EMPTY_VIEW: SheetView = {
  search: "",
  filters: [],
  sort: null,
  mine: false,
  today: false,
  filterActive: false,
};

export const FILTER_BLANK = "__blank__";

const TEXT_OPERATORS: FilterOperator[] = ["contains", "does_not_contain", "is_empty", "is_not_empty"];
const STATUS_OPERATORS: FilterOperator[] = ["is_any_of", "is_none_of", "is_empty"];
const PERSON_OPERATORS: FilterOperator[] = ["includes_any", "is_empty"];
const DATE_OPERATORS: FilterOperator[] = [
  "is_today",
  "is_yesterday",
  "is_this_week",
  "is_last_7_days",
  "is_this_month",
  "between",
  "is_empty",
];
const NUMBER_OPERATORS: FilterOperator[] = ["eq", "neq", "gt", "lt", "between", "is_empty"];
const CHECK_OPERATORS: FilterOperator[] = ["is_checked", "is_unchecked"];

export const OPERATOR_LABEL: Record<FilterOperator, string> = {
  contains: "contains",
  does_not_contain: "does not contain",
  is_empty: "is empty",
  is_not_empty: "is not empty",
  is_any_of: "is any of",
  is_none_of: "is none of",
  includes_any: "includes any of",
  is_today: "is today",
  is_yesterday: "is yesterday",
  is_this_week: "is this week",
  is_last_7_days: "is last 7 days",
  is_this_month: "is this month",
  between: "between",
  eq: "=",
  neq: "≠",
  gt: ">",
  lt: "<",
  is_checked: "is checked",
  is_unchecked: "is unchecked",
  in_values: "is any of",
};

export function operatorsFor(type: ColumnType): FilterOperator[] {
  switch (type) {
    case "text":
    case "long_text":
    case "link":
      return TEXT_OPERATORS;
    case "status":
    case "priority":
    case "country":
      return STATUS_OPERATORS;
    case "person":
    case "tags":
    case "dropdown":
      return PERSON_OPERATORS;
    case "date":
    case "due_date":
    case "timeline":
      return DATE_OPERATORS;
    case "number":
    case "rating":
      return NUMBER_OPERATORS;
    case "files":
      return ["contains", "is_empty", "is_not_empty"];
    case "checkbox":
      return CHECK_OPERATORS;
    default:
      return TEXT_OPERATORS;
  }
}

export function isTransformedView(view: SheetView): boolean {
  return Boolean(view.search.trim() || view.filters.length || view.sort || view.mine || view.today);
}

export function formatRowCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value).replace(/,/g, " ");
}

export function normalizeSearchText(value: string): string {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 127) {
      return normalizeSearchTextSlow(value);
    }
  }
  return value.toLowerCase();
}

function normalizeSearchTextSlow(value: string): string {
  let out = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 128) {
      out += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : value[index];
      continue;
    }
    if ((code >= 0x064b && code <= 0x065f) || code === 0x0670 || code === 0x0640) {
      continue;
    }
    if (code === 0x0623 || code === 0x0625 || code === 0x0622) {
      out += "ا";
      continue;
    }
    if (code === 0x0629) {
      out += "ه";
      continue;
    }
    if (code === 0x0649) {
      out += "ي";
      continue;
    }
    if (code >= 0x0600 && code <= 0x06ff) {
      out += value[index];
      continue;
    }
    const folded = (value[index] ?? "").normalize("NFD").replace(/\p{M}/gu, "");
    for (let offset = 0; offset < folded.length; offset += 1) {
      const foldedCode = folded.charCodeAt(offset);
      out += foldedCode >= 65 && foldedCode <= 90 ? String.fromCharCode(foldedCode + 32) : folded[offset];
    }
  }
  return out;
}

export function highlightSpans(text: string, query: string): Array<[number, number]> {
  const needle = normalizeSearchText(query);
  if (!needle) {
    return [];
  }
  let normalized = "";
  const map: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const piece = normalizeSearchText(text[index] ?? "");
    for (let offset = 0; offset < piece.length; offset += 1) {
      map.push(index);
    }
    normalized += piece;
  }
  const spans: Array<[number, number]> = [];
  let from = 0;
  while (from <= normalized.length - needle.length) {
    const found = normalized.indexOf(needle, from);
    if (found < 0) {
      break;
    }
    const start = map[found];
    const endIndex = map[found + needle.length - 1];
    if (start === undefined || endIndex === undefined) {
      break;
    }
    spans.push([start, endIndex + 1]);
    from = found + needle.length;
  }
  return spans;
}

export function calendarDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function deriveRowOrder(
  rows: Record<string, ViewRow>,
  rowOrder: readonly string[],
  columns: readonly ViewColumn[],
  view: Pick<SheetView, "search" | "filters" | "sort" | "mine" | "today">,
  me: { id: string | null },
  usersById: ReadonlyMap<string, string>,
): string[] {
  const query = normalizeSearchText(view.search);
  const personColumn = columns.find((column) => column.type === "person");
  const dateColumns = columns.filter((column) => column.type === "date" || column.type === "due_date");
  const today = calendarDate(new Date());
  let ids = rowOrder.filter((id) => {
    const row = rows[id];
    return Boolean(row && !row.deleted);
  });

  if (query) {
    ids = ids.filter((id) => rowMatchesSearch(rows[id], columns, query, usersById));
  }
  for (const rule of view.filters) {
    const column = columns.find((item) => item.id === rule.columnId);
    if (!column) {
      continue;
    }
    if (rule.operator === "in_values") {
      ids = ids.filter((id) => inValuesMatches(rows[id], column, rule.values ?? [], usersById));
      continue;
    }
    if (!operatorsFor(column.type).includes(rule.operator) || !ruleReady(rule)) {
      continue;
    }
    ids = ids.filter((id) => ruleMatches(rows[id], column, rule, me, usersById, today));
  }
  if (view.mine) {
    ids = ids.filter((id) => mineMatches(rows[id], personColumn, me));
  }
  if (view.today) {
    ids = ids.filter((id) =>
      dateColumns.some((column) => cellDate(rows[id], column) === today) ||
      columns.some((column) => column.type === "timeline" && timelineIncludes(rows[id]?.data[column.id], today)),
    );
  }
  if (!view.sort) {
    return ids;
  }
  const sortColumn = columns.find((column) => column.id === view.sort?.columnId);
  if (!sortColumn) {
    return ids;
  }
  const direction = view.sort.direction;
  const indexed = ids.map((id, index) => ({ id, index }));
  indexed.sort((left, right) => {
    const compared = compareCells(rows[left.id], rows[right.id], sortColumn, direction, usersById);
    return compared === 0 ? left.index - right.index : compared;
  });
  return indexed.map((item) => item.id);
}

export function mergePinnedRows(
  rowOrder: readonly string[],
  derived: readonly string[],
  pinned: readonly string[],
  compare: ((left: string, right: string) => number) | null,
): { ids: string[]; unmatched: string[] } {
  const derivedSet = new Set(derived);
  const present = new Set(rowOrder);
  const unmatched = pinned.filter((id) => present.has(id) && !derivedSet.has(id));
  if (!unmatched.length) {
    return { ids: [...derived], unmatched: [] };
  }
  if (!compare) {
    const extras = new Set(unmatched);
    return { ids: rowOrder.filter((id) => derivedSet.has(id) || extras.has(id)), unmatched };
  }
  const ids = [...derived];
  for (const id of unmatched) {
    let low = 0;
    let high = ids.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const current = ids[mid];
      if (!current || compare(id, current) > 0) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    ids.splice(low, 0, id);
  }
  return { ids, unmatched };
}

export function collectColumnFilterValues(
  rows: Record<string, ViewRow>,
  rowOrder: readonly string[],
  column: ViewColumn,
  usersById: ReadonlyMap<string, string>,
): Array<{ key: string; label: string }> {
  const seen = new Map<string, string>();
  let hasBlank = false;
  for (const id of rowOrder) {
    const row = rows[id];
    if (!row || row.deleted) {
      continue;
    }
    const value = row.data[column.id];
    if (column.type === "checkbox") {
      const key = value === true ? "true" : "false";
      seen.set(key, key === "true" ? "Checked" : "Unchecked");
      continue;
    }
    const keys = filterKeys(column, value, usersById);
    if (keys.length === 0) {
      hasBlank = true;
      continue;
    }
    for (const item of keys) {
      if (!seen.has(item.key)) {
        seen.set(item.key, item.label);
      }
    }
  }
  const options = [...seen.entries()]
    .sort((left, right) => left[1].localeCompare(right[1], undefined, { sensitivity: "base" }))
    .map(([key, label]) => ({ key, label }));
  if (hasBlank) {
    options.unshift({ key: FILTER_BLANK, label: "(Blanks)" });
  }
  return options;
}

export function upsertValueFilter(
  filters: FilterRule[],
  columnId: string,
  selected: string[],
  allKeys: string[],
): FilterRule[] {
  const rest = filters.filter((rule) => !(rule.columnId === columnId && rule.operator === "in_values"));
  const selectedSet = new Set(selected);
  const allSelected = allKeys.length > 0 && allKeys.every((key) => selectedSet.has(key));
  if (allSelected) {
    return rest;
  }
  return [
    ...rest,
    {
      id: crypto.randomUUID(),
      columnId,
      operator: "in_values",
      values: selected,
    },
  ];
}

export function compareSortedIds(
  rows: Record<string, ViewRow>,
  columns: readonly ViewColumn[],
  sort: SortRule,
  usersById: ReadonlyMap<string, string>,
): (left: string, right: string) => number {
  const column = columns.find((item) => item.id === sort.columnId);
  return (left, right) => {
    if (!column) {
      return 0;
    }
    return compareCells(rows[left], rows[right], column, sort.direction, usersById);
  };
}

function rowMatchesSearch(
  row: ViewRow | undefined,
  columns: readonly ViewColumn[],
  query: string,
  usersById: ReadonlyMap<string, string>,
): boolean {
  if (!row) {
    return false;
  }
  for (const column of columns) {
    const text = normalizeSearchText(displayValue(column, row.data[column.id], usersById));
    if (text.includes(query)) {
      return true;
    }
  }
  return false;
}

function ruleReady(rule: FilterRule): boolean {
  if (rule.operator === "contains" || rule.operator === "does_not_contain" || rule.operator === "eq" || rule.operator === "neq" || rule.operator === "gt" || rule.operator === "lt") {
    return Boolean(rule.value && rule.value.trim());
  }
  if (rule.operator === "is_any_of" || rule.operator === "is_none_of" || rule.operator === "includes_any") {
    return Boolean(rule.values && rule.values.length > 0);
  }
  if (rule.operator === "between") {
    return Boolean(rule.from && rule.from.trim() && rule.to && rule.to.trim());
  }
  return true;
}

function ruleMatches(
  row: ViewRow | undefined,
  column: ViewColumn,
  rule: FilterRule,
  me: { id: string | null },
  usersById: ReadonlyMap<string, string>,
  today: string,
): boolean {
  if (!row) {
    return false;
  }
  const value = row.data[column.id];
  const empty = isEmptyValue(column, value);
  switch (rule.operator) {
    case "is_empty":
      return empty;
    case "is_not_empty":
      return !empty;
    case "contains":
      return !empty && normalizeSearchText(displayValue(column, value, usersById)).includes(normalizeSearchText(rule.value ?? ""));
    case "does_not_contain":
      return empty || !normalizeSearchText(displayValue(column, value, usersById)).includes(normalizeSearchText(rule.value ?? ""));
    case "is_any_of":
      return typeof value === "string" && (rule.values ?? []).includes(value);
    case "is_none_of":
      return empty || (typeof value === "string" && !(rule.values ?? []).includes(value));
    case "includes_any":
      if (column.type === "tags" || column.type === "dropdown") {
        return listIncludes(value, rule.values ?? []);
      }
      return personIncludes(value, rule.values ?? [], me);
    case "is_today":
    case "is_yesterday":
    case "is_this_week":
    case "is_last_7_days":
    case "is_this_month":
      if (column.type === "timeline") {
        return timelineDateMatches(value, rule.operator, today);
      }
      return typeof value === "string" && dateMatches(value, rule.operator, today);
    case "between":
      return betweenValue(column, value, rule.from ?? "", rule.to ?? "");
    case "eq":
    case "neq":
    case "gt":
    case "lt":
      return numberCompare(value, rule.operator, rule.value ?? "");
    case "is_checked":
      return value === true;
    case "is_unchecked":
      return value !== true;
    default:
      return true;
  }
}

function mineMatches(row: ViewRow | undefined, personColumn: ViewColumn | undefined, me: { id: string | null }): boolean {
  if (!row || !me.id) {
    return false;
  }
  if (!personColumn) {
    return row.createdBy === me.id;
  }
  return personIncludes(row.data[personColumn.id], ["me"], me);
}

function inValuesMatches(
  row: ViewRow | undefined,
  column: ViewColumn,
  values: string[],
  usersById: ReadonlyMap<string, string>,
): boolean {
  if (!row) {
    return false;
  }
  const allowed = new Set(values);
  const value = row.data[column.id];
  if (column.type === "checkbox") {
    return allowed.has(value === true ? "true" : "false");
  }
  const keys = filterKeys(column, value, usersById);
  if (keys.length === 0) {
    return allowed.has(FILTER_BLANK);
  }
  return keys.some((item) => allowed.has(item.key));
}

function filterKeys(
  column: ViewColumn,
  value: JsonValue | undefined,
  usersById: ReadonlyMap<string, string>,
): Array<{ key: string; label: string }> {
  if (isEmptyValue(column, value)) {
    return [];
  }
  if (column.type === "tags" && Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((tag) => ({ key: tag, label: tag }));
  }
  if (column.type === "dropdown" && Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((id) => ({ key: id, label: displayValue({ ...column, type: "status" }, id, usersById) || id }));
  }
  if (column.type === "files" && Array.isArray(value)) {
    return value.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.name !== "string") {
        return [];
      }
      return [{ key: item.name, label: item.name }];
    });
  }
  const label = displayValue(column, value, usersById);
  if (!label) {
    return [];
  }
  const key = typeof value === "string" || typeof value === "number" ? String(value) : label;
  return [{ key, label }];
}

function timelineIncludes(value: JsonValue | undefined, today: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const start = typeof value.start === "string" ? value.start : "";
  const end = typeof value.end === "string" ? value.end : "";
  return Boolean(start && end && start <= today && today <= end);
}

function personIncludes(value: JsonValue | undefined, selected: string[], me: { id: string | null }): boolean {
  if (!Array.isArray(value)) {
    return false;
  }
  const ids = new Set(value.filter((item): item is string => typeof item === "string"));
  return selected.some((item) => {
    const resolved = item === "me" ? me.id : item;
    return Boolean(resolved && ids.has(resolved));
  });
}

function cellDate(row: ViewRow | undefined, column: ViewColumn): string {
  const value = row?.data[column.id];
  return typeof value === "string" ? value : "";
}

function dateMatches(value: string, operator: FilterOperator, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  if (operator === "is_today") {
    return value === today;
  }
  const current = parseCalendar(today);
  if (!current) {
    return false;
  }
  if (operator === "is_yesterday") {
    return value === shiftDate(current, -1);
  }
  if (operator === "is_last_7_days") {
    return value >= shiftDate(current, -6) && value <= today;
  }
  if (operator === "is_this_month") {
    return value.slice(0, 7) === today.slice(0, 7);
  }
  if (operator === "is_this_week") {
    const start = startOfWeek(current);
    return value >= calendarDate(start) && value <= shiftDate(start, 6);
  }
  return false;
}

function betweenValue(column: ViewColumn, value: JsonValue | undefined, from: string, to: string): boolean {
  if (column.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return false;
    }
    const start = Number(from);
    const end = Number(to);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return false;
    }
    const low = Math.min(start, end);
    const high = Math.max(start, end);
    return value >= low && value <= high;
  }
  if (typeof value !== "string") {
    return false;
  }
  const low = from <= to ? from : to;
  const high = from <= to ? to : from;
  return value >= low && value <= high;
}

function numberCompare(value: JsonValue | undefined, operator: FilterOperator, raw: string): boolean {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return false;
  }
  const target = Number(raw);
  if (!Number.isFinite(target)) {
    return false;
  }
  if (operator === "eq") {
    return value === target;
  }
  if (operator === "neq") {
    return value !== target;
  }
  if (operator === "gt") {
    return value > target;
  }
  return value < target;
}

function compareCells(
  left: ViewRow | undefined,
  right: ViewRow | undefined,
  column: ViewColumn,
  direction: "asc" | "desc",
  usersById: ReadonlyMap<string, string>,
): number {
  const leftEmpty = !left || isEmptyValue(column, left.data[column.id]);
  const rightEmpty = !right || isEmptyValue(column, right.data[column.id]);
  if (leftEmpty && rightEmpty) {
    return 0;
  }
  if (leftEmpty) {
    return 1;
  }
  if (rightEmpty) {
    return -1;
  }
  const compared = compareFilled(left.data[column.id], right.data[column.id], column, usersById);
  return direction === "asc" ? compared : -compared;
}

function compareFilled(
  left: JsonValue | undefined,
  right: JsonValue | undefined,
  column: ViewColumn,
  usersById: ReadonlyMap<string, string>,
): number {
  if (column.type === "number" && typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  if (column.type === "checkbox") {
    return Number(left === true) - Number(right === true);
  }
  if (column.type === "status" || column.type === "priority") {
    return statusIndex(column, left) - statusIndex(column, right);
  }
  if ((column.type === "date" || column.type === "due_date") && typeof left === "string" && typeof right === "string") {
    return left < right ? -1 : left > right ? 1 : 0;
  }
  if (column.type === "rating" && typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  if (column.type === "timeline") {
    const leftStart = typeof left === "object" && left && !Array.isArray(left) && typeof left.start === "string" ? left.start : "";
    const rightStart = typeof right === "object" && right && !Array.isArray(right) && typeof right.start === "string" ? right.start : "";
    return leftStart < rightStart ? -1 : leftStart > rightStart ? 1 : 0;
  }
  const leftText = normalizeSearchText(displayValue(column, left, usersById));
  const rightText = normalizeSearchText(displayValue(column, right, usersById));
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
}

function statusIndex(column: ViewColumn, value: JsonValue | undefined): number {
  const options = statusOptionIds(column.settings);
  const index = typeof value === "string" ? options.indexOf(value) : -1;
  return index < 0 ? options.length : index;
}

function statusOptionIds(settings: unknown): string[] {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return [];
  }
  const options = (settings as { options?: unknown }).options;
  if (!Array.isArray(options)) {
    return [];
  }
  return options.flatMap((option) => {
    if (!option || typeof option !== "object" || Array.isArray(option)) {
      return [];
    }
    return typeof option.id === "string" ? [option.id] : [];
  });
}

function isEmptyValue(column: ViewColumn, value: JsonValue | undefined): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (column.type === "checkbox") {
    return false;
  }
  if (typeof value === "string") {
    return value.trim() === "";
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (column.type === "link" && typeof value === "object") {
    return typeof value.url !== "string" || value.url.trim() === "";
  }
  if (column.type === "timeline" && typeof value === "object") {
    return typeof value.start !== "string" || typeof value.end !== "string";
  }
  return false;
}

function listIncludes(value: JsonValue | undefined, selected: string[]): boolean {
  if (!Array.isArray(value)) {
    return false;
  }
  const items = new Set(value.filter((item): item is string => typeof item === "string"));
  return selected.some((item) => items.has(item));
}

function timelineDateMatches(value: JsonValue | undefined, operator: FilterOperator, today: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.start !== "string") {
    return false;
  }
  return dateMatches(value.start, operator, today) || (typeof value.end === "string" && dateMatches(value.end, operator, today)) || timelineIncludes(value, today);
}

function parseCalendar(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function shiftDate(date: Date, days: number): string {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return calendarDate(next);
}

function startOfWeek(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = start.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + delta);
  return start;
}
