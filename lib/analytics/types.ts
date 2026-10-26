/**
 * Shared, client-safe types for the analytics engine (dashboards and chart views).
 * Columns are referenced by name + type so one query can span many tabs.
 */
import type { ColumnType } from "@/lib/db-types";

export interface ColumnRef {
  name: string;
  type: ColumnType;
}

export const DATE_BUCKETS = ["day", "week", "month", "quarter", "year"] as const;
export type DateBucket = (typeof DATE_BUCKETS)[number];

export const DATE_RANGES = [
  "all",
  "today",
  "yesterday",
  "7d",
  "30d",
  "90d",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "this_quarter",
  "this_year",
  "last_year",
  "custom",
] as const;
export type DateRange = (typeof DATE_RANGES)[number];

export const DATE_RANGE_LABEL: Record<DateRange, string> = {
  all: "All time",
  today: "Today",
  yesterday: "Yesterday",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  this_week: "This week",
  last_week: "Last week",
  this_month: "This month",
  last_month: "Last month",
  this_quarter: "This quarter",
  this_year: "This year",
  last_year: "Last year",
  custom: "Custom range",
};

export interface Dimension {
  ref: ColumnRef;
  /** For date-like columns. */
  bucket?: DateBucket;
}

export const MEASURE_OPS = ["count", "sum", "avg", "min", "max", "distinct"] as const;
export type MeasureOp = (typeof MEASURE_OPS)[number];

export type Measure =
  | { op: "count" }
  | { op: "sum" | "avg" | "min" | "max"; column: ColumnRef }
  /** Number of different values in a column (e.g. distinct editors). */
  | { op: "distinct"; column: ColumnRef };

export const FILTER_OPS = [
  "any_of",
  "none_of",
  "empty",
  "not_empty",
  "contains",
  "not_contains",
  "eq",
  "gt",
  "lt",
  "between",
  "date_range",
  "me",
  "my_team",
  "checked",
  "unchecked",
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export interface Filter {
  ref: ColumnRef;
  op: FilterOp;
  /** Keys for any_of / none_of (status labels, user ids, tags, country codes). */
  values?: string[];
  /** Text for contains, number for eq/gt/lt. */
  value?: string | number;
  /** Numbers for between. */
  min?: number;
  max?: number;
  /** Dates for date_range (range "custom" uses from/to). */
  range?: DateRange;
  from?: string;
  to?: string;
}

export interface AnalyticsQuery {
  sheetIds: string[];
  /** 0 = totals only, 1 = buckets, 2 = buckets × series. */
  dims: Dimension[];
  measure: Measure;
  filters: Filter[];
  /** Keep the top N first-dimension buckets (by value); the rest fold into "Other". */
  limit?: number;
}

export interface Bucket {
  key: string;
  label: string;
  color?: string;
  order?: number;
}

export interface AnalyticsCell {
  /** First-dimension key ("" = empty). */
  k1: string;
  /** Second-dimension key, or "" when there's one dimension. */
  k2: string;
  value: number;
  rows: number;
}

export interface AnalyticsResult {
  /** First-dimension buckets in display order. */
  buckets: Bucket[];
  /** Second-dimension series in display order (empty with one dimension). */
  series: Bucket[];
  cells: AnalyticsCell[];
  /** Measure over every matching row (not per bucket). */
  total: number;
  rowCount: number;
  /** True when the query hit the time budget and was cut short. */
  truncated?: boolean;
}

export const EMPTY_KEY = "";
export const EMPTY_LABEL = "(Empty)";
export const EMPTY_COLOR = "#c5c7d0";
export const OTHER_KEY = "__other";

export const DATE_TYPES: ReadonlySet<ColumnType> = new Set([
  "date",
  "due_date",
  "created_at",
  "updated_at",
  "timeline",
]);

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
  "email",
  "date",
  "due_date",
  "created_at",
  "updated_at",
  "timeline",
]);

export const PERSON_TYPES: ReadonlySet<ColumnType> = new Set(["person", "created_by"]);

export function refKey(ref: ColumnRef): string {
  return `${ref.type}::${ref.name}`;
}

export function parseRefKey(key: string): ColumnRef | null {
  const index = key.indexOf("::");
  if (index < 0) {
    return null;
  }
  return { type: key.slice(0, index) as ColumnType, name: key.slice(index + 2) };
}

export function normName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function measureLabel(measure: Measure): string {
  switch (measure.op) {
    case "count":
      return "Items";
    case "distinct":
      return `Distinct ${measure.column.name}`;
    case "sum":
      return `Sum of ${measure.column.name}`;
    case "avg":
      return `Average ${measure.column.name}`;
    case "min":
      return `Lowest ${measure.column.name}`;
    case "max":
      return `Highest ${measure.column.name}`;
  }
}

export function formatValue(value: number, measure?: Measure): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  if (measure?.op === "avg") {
    return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
  }
  if (Math.abs(value) >= 10_000) {
    return value.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
  }
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Resolves a relative range to inclusive [from, to] calendar days (YYYY-MM-DD). */
export function resolveRange(
  range: DateRange,
  today: Date,
  custom?: { from?: string; to?: string },
): { from: string | null; to: string | null } {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const iso = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const shift = (days: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate() + days);
  const monday = shift(-((day.getDay() + 6) % 7));
  switch (range) {
    case "today":
      return { from: iso(day), to: iso(day) };
    case "yesterday":
      return { from: iso(shift(-1)), to: iso(shift(-1)) };
    case "7d":
      return { from: iso(shift(-6)), to: iso(day) };
    case "30d":
      return { from: iso(shift(-29)), to: iso(day) };
    case "90d":
      return { from: iso(shift(-89)), to: iso(day) };
    case "this_week":
      return { from: iso(monday), to: iso(day) };
    case "last_week": {
      const start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7);
      const end = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 1);
      return { from: iso(start), to: iso(end) };
    }
    case "this_month":
      return { from: iso(new Date(day.getFullYear(), day.getMonth(), 1)), to: iso(day) };
    case "last_month":
      return {
        from: iso(new Date(day.getFullYear(), day.getMonth() - 1, 1)),
        to: iso(new Date(day.getFullYear(), day.getMonth(), 0)),
      };
    case "this_quarter":
      return { from: iso(new Date(day.getFullYear(), Math.floor(day.getMonth() / 3) * 3, 1)), to: iso(day) };
    case "this_year":
      return { from: iso(new Date(day.getFullYear(), 0, 1)), to: iso(day) };
    case "last_year":
      return { from: iso(new Date(day.getFullYear() - 1, 0, 1)), to: iso(new Date(day.getFullYear() - 1, 11, 31)) };
    case "custom":
      return { from: custom?.from ?? null, to: custom?.to ?? null };
    default:
      return { from: null, to: null };
  }
}

/** The period just before a range, of the same length (for "vs previous period"). */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const parse = (value: string) => {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y!, (m ?? 1) - 1, d ?? 1);
  };
  const start = parse(from);
  const end = parse(to);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const prevEnd = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1);
  const prevStart = new Date(prevEnd.getFullYear(), prevEnd.getMonth(), prevEnd.getDate() - (days - 1));
  const iso = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { from: iso(prevStart), to: iso(prevEnd) };
}
