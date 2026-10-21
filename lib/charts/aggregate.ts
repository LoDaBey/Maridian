/**
 * Turns sheet rows into chart buckets. Pure, so it runs in the browser (a sheet's
 * Chart view) and on the server (workspace dashboards that span many tabs).
 *
 * Columns are referenced by name + type, not id, so one widget can read the same
 * column across many tabs (e.g. a "Status" column in every monthly tab).
 */
import { asStringList, asTimeline } from "@/lib/sheets/column-meta";
import { countryByCode, countryLabel } from "@/lib/sheets/countries";
import { labeledOptions } from "@/lib/sheets/values";
import type { ColumnType } from "@/lib/db-types";

export const CHART_KINDS = ["bar", "battery", "time", "number"] as const;
export type ChartKind = (typeof CHART_KINDS)[number];

export const DATE_RANGES = ["all", "7d", "30d", "90d", "this_month", "this_year"] as const;
export type DateRange = (typeof DATE_RANGES)[number];

export const DATE_BUCKETS = ["day", "week", "month"] as const;
export type DateBucket = (typeof DATE_BUCKETS)[number];

export interface ColumnRef {
  name: string;
  type: ColumnType;
}

export type Metric = { op: "count" } | { op: "sum" | "avg"; column: ColumnRef };

export interface ChartSpec {
  kind: ChartKind;
  /** Column to split by. Required for bar / battery / time. */
  groupBy: ColumnRef | null;
  metric: Metric;
  /** Optional date column used to limit rows to `range`. */
  dateColumn: ColumnRef | null;
  range: DateRange;
  bucket: DateBucket;
}

export interface ChartColumn {
  id: string;
  name: string;
  type: ColumnType;
  settings: unknown;
}

export interface ChartRow {
  data: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChartTable {
  columns: ChartColumn[];
  rows: ChartRow[];
}

export interface Bucket {
  key: string;
  label: string;
  /** Only set when the data defines it (status / priority labels). */
  color?: string;
  value: number;
  rows: number;
}

export interface ChartResult {
  buckets: Bucket[];
  total: number;
  rowCount: number;
}

export const EMPTY_LABEL = "(Empty)";
const EMPTY_COLOR = "#c5c7d0";
const MAX_BARS = 12;
/** A battery past 8 parts stops reading as parts; the smallest fold into "Other". */
const MAX_SEGMENTS = 8;

export const DATE_TYPES: ReadonlySet<ColumnType> = new Set(["date", "due_date", "created_at", "updated_at", "timeline"]);
export const GROUPABLE_TYPES: ReadonlySet<ColumnType> = new Set([
  "status",
  "priority",
  "dropdown",
  "person",
  "tags",
  "country",
  "checkbox",
  "created_by",
  "text",
  "rating",
  "date",
  "due_date",
  "created_at",
  "updated_at",
  "timeline",
]);
const LABEL_TYPES: ReadonlySet<ColumnType> = new Set(["status", "priority"]);

function norm(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Finds the column a reference points at in one table (same name, same type). */
export function resolveColumn(table: ChartTable, ref: ColumnRef | null): ChartColumn | null {
  if (!ref) {
    return null;
  }
  const name = norm(ref.name);
  return table.columns.find((column) => column.type === ref.type && norm(column.name) === name) ?? null;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function iso(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) {
    return null;
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The calendar day a row has for a date-like column, or null. */
function rowDay(row: ChartRow, column: ChartColumn): Date | null {
  if (column.type === "created_at") {
    return parseLocal(row.createdAt);
  }
  if (column.type === "updated_at") {
    return parseLocal(row.updatedAt);
  }
  const value = row.data[column.id];
  if (column.type === "timeline") {
    const range = asTimeline(value);
    return range ? parseDay(range.start) : null;
  }
  return typeof value === "string" ? parseDay(value) : null;
}

function parseLocal(timestamp: string): Date | null {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function bucketStart(day: Date, bucket: DateBucket): Date {
  if (bucket === "month") {
    return new Date(day.getFullYear(), day.getMonth(), 1);
  }
  if (bucket === "week") {
    // Weeks start on Saturday-independent Monday so they read the same everywhere.
    const offset = (day.getDay() + 6) % 7;
    return new Date(day.getFullYear(), day.getMonth(), day.getDate() - offset);
  }
  return day;
}

function nextBucket(day: Date, bucket: DateBucket): Date {
  if (bucket === "month") {
    return new Date(day.getFullYear(), day.getMonth() + 1, 1);
  }
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + (bucket === "week" ? 7 : 1));
}

export function bucketLabel(key: string, bucket: DateBucket): string {
  const day = parseDay(key);
  if (!day) {
    return key;
  }
  if (bucket === "month") {
    return day.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }
  const label = day.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return bucket === "week" ? `Week of ${label}` : label;
}

function rangeStart(range: DateRange, today: Date): Date | null {
  switch (range) {
    case "7d":
      return new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
    case "30d":
      return new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29);
    case "90d":
      return new Date(today.getFullYear(), today.getMonth(), today.getDate() - 89);
    case "this_month":
      return new Date(today.getFullYear(), today.getMonth(), 1);
    case "this_year":
      return new Date(today.getFullYear(), 0, 1);
    default:
      return null;
  }
}

interface Key {
  key: string;
  label: string;
  color?: string;
  order?: number;
}

/** The bucket keys one row falls into for the group-by column (multi-value cells give several). */
function keysFor(
  row: ChartRow,
  column: ChartColumn,
  spec: ChartSpec,
  names: ReadonlyMap<string, string>,
): Key[] {
  if (DATE_TYPES.has(column.type)) {
    const day = rowDay(row, column);
    if (!day) {
      return [];
    }
    const start = iso(bucketStart(day, spec.bucket));
    return [{ key: start, label: bucketLabel(start, spec.bucket) }];
  }
  const value = row.data[column.id];
  switch (column.type) {
    case "status":
    case "priority":
    case "dropdown": {
      const options = labeledOptions(column.settings);
      const ids = column.type === "dropdown" ? asStringList(value) : typeof value === "string" ? [value] : [];
      return ids.flatMap((id) => {
        const index = options.findIndex((option) => option.id === id);
        const option = options[index];
        return option
          ? [{ key: norm(option.label), label: option.label, color: option.color, order: index }]
          : [];
      });
    }
    case "person":
      return asStringList(value).map((id) => ({ key: id, label: names.get(id) ?? "Former user" }));
    case "created_by":
      return row.createdBy ? [{ key: row.createdBy, label: names.get(row.createdBy) ?? "Former user" }] : [];
    case "tags":
      return asStringList(value).map((tag) => ({ key: norm(tag), label: tag }));
    case "country": {
      if (typeof value !== "string" || !value) {
        return [];
      }
      const country = countryByCode(value);
      return [{ key: value, label: country ? countryLabel(country, true) : value }];
    }
    case "checkbox":
      return [value === true ? { key: "yes", label: "Checked", order: 0 } : { key: "no", label: "Not checked", order: 1 }];
    case "rating":
      return typeof value === "number" ? [{ key: String(value), label: `${value} ★`, order: 5 - value }] : [];
    default: {
      const text = typeof value === "string" ? value.trim() : "";
      if (!text) {
        return [];
      }
      return [{ key: norm(text), label: text.length > 40 ? `${text.slice(0, 39)}…` : text }];
    }
  }
}

function metricValue(row: ChartRow, column: ChartColumn | null): number | null {
  if (!column) {
    return null;
  }
  const value = row.data[column.id];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Aggregates any number of tables (tabs) into one set of buckets.
 * `names` maps user ids to display names for person / creator columns.
 */
export function aggregate(
  tables: ChartTable[],
  spec: ChartSpec,
  names: ReadonlyMap<string, string>,
  today: Date = new Date(),
): ChartResult {
  const start = rangeStart(spec.range, new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  const buckets = new Map<string, Bucket & { order?: number; sum: number; counted: number }>();
  let rowCount = 0;
  let total = 0;
  let totalCounted = 0;
  const grouped = spec.kind !== "number" && spec.groupBy !== null;

  for (const table of tables) {
    const groupColumn = grouped ? resolveColumn(table, spec.groupBy) : null;
    if (grouped && !groupColumn) {
      continue;
    }
    const dateColumn = start ? resolveColumn(table, spec.dateColumn) : null;
    const metricColumn = spec.metric.op === "count" ? null : resolveColumn(table, spec.metric.column);
    if (spec.metric.op !== "count" && !metricColumn) {
      continue;
    }
    for (const row of table.rows) {
      if (start) {
        if (!dateColumn) {
          continue;
        }
        const day = rowDay(row, dateColumn);
        if (!day || day < start) {
          continue;
        }
      }
      const amount = spec.metric.op === "count" ? 1 : metricValue(row, metricColumn);
      rowCount += 1;
      if (amount !== null) {
        total += amount;
        totalCounted += 1;
      }
      if (!groupColumn) {
        continue;
      }
      const keys = keysFor(row, groupColumn, spec, names);
      const targets: Key[] = keys.length > 0 ? keys : [{ key: "", label: EMPTY_LABEL, color: EMPTY_COLOR, order: 1e6 }];
      for (const target of targets) {
        const bucket = buckets.get(target.key) ?? {
          key: target.key,
          label: target.label,
          color: LABEL_TYPES.has(groupColumn.type) || target.key === "" ? target.color : undefined,
          order: target.order,
          value: 0,
          rows: 0,
          sum: 0,
          counted: 0,
        };
        bucket.rows += 1;
        if (amount !== null) {
          bucket.sum += amount;
          bucket.counted += 1;
        }
        buckets.set(target.key, bucket);
      }
    }
  }

  const finalValue = (sum: number, counted: number) =>
    spec.metric.op === "avg" ? (counted > 0 ? sum / counted : 0) : sum;

  let list = [...buckets.values()].map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    color: bucket.color,
    order: bucket.order,
    value: finalValue(bucket.sum, bucket.counted),
    rows: bucket.rows,
  }));

  const dateGroup = spec.groupBy !== null && DATE_TYPES.has(spec.groupBy.type);
  if (dateGroup) {
    list = fillDateGaps(list, spec.bucket);
  } else {
    list.sort((a, b) => {
      if (a.key === "" || b.key === "") {
        return a.key === "" ? 1 : -1;
      }
      if (a.order !== undefined && b.order !== undefined && a.order !== b.order) {
        return a.order - b.order;
      }
      return b.value - a.value || a.label.localeCompare(b.label);
    });
    const limit = spec.kind === "bar" ? MAX_BARS : spec.kind === "battery" ? MAX_SEGMENTS : Infinity;
    if (list.length > limit) {
      if (spec.kind === "battery") {
        // Keep the largest parts; the order of labels doesn't matter once some are folded.
        list.sort((a, b) => (a.key === "" ? 1 : b.key === "" ? -1 : b.value - a.value));
      }
      const kept = list.slice(0, limit - 1);
      const rest = list.slice(limit - 1);
      kept.push({
        key: "__other",
        label: `Other (${rest.length})`,
        color: undefined,
        order: undefined,
        value: spec.metric.op === "avg" ? rest.reduce((sum, item) => sum + item.value, 0) / rest.length : rest.reduce((sum, item) => sum + item.value, 0),
        rows: rest.reduce((sum, item) => sum + item.rows, 0),
      });
      list = kept;
    }
  }

  return {
    buckets: list.map(({ key, label, color, value, rows }) => ({ key, label, color, value, rows })),
    total: finalValue(total, totalCounted),
    rowCount,
  };
}

/** Date buckets in order, with empty periods between the first and last filled in as 0. */
function fillDateGaps<T extends { key: string; label: string; value: number; rows: number }>(
  list: T[],
  bucket: DateBucket,
): Array<T | { key: string; label: string; value: number; rows: number; color: undefined; order: undefined }> {
  const dated = list.filter((item) => parseDay(item.key)).sort((a, b) => a.key.localeCompare(b.key));
  if (dated.length === 0) {
    return [];
  }
  const byKey = new Map(dated.map((item) => [item.key, item]));
  const out: Array<T | { key: string; label: string; value: number; rows: number; color: undefined; order: undefined }> = [];
  let cursor = parseDay(dated[0]!.key)!;
  const last = parseDay(dated[dated.length - 1]!.key)!;
  // Guard against a typo'd far-away date producing thousands of empty buckets.
  for (let steps = 0; cursor <= last && steps < 400; steps += 1) {
    const key = iso(cursor);
    out.push(byKey.get(key) ?? { key, label: bucketLabel(key, bucket), value: 0, rows: 0, color: undefined, order: undefined });
    cursor = nextBucket(cursor, bucket);
  }
  return out;
}

export function formatMetric(value: number, metric: Metric): string {
  if (metric.op === "avg") {
    return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
  }
  if (Math.abs(value) >= 10_000) {
    return value.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
  }
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function metricLabel(metric: Metric): string {
  if (metric.op === "count") {
    return "Items";
  }
  return `${metric.op === "sum" ? "Sum" : "Average"} of ${metric.column.name}`;
}
