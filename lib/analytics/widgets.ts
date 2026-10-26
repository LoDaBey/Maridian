/**
 * The dashboard widget catalogue (client-safe). Each kind declares what it needs so
 * the editor only offers valid settings and the server knows how to query it.
 */
import type { ColumnRef, DateBucket, DateRange, Dimension, Filter, Measure } from "./types";

export const WIDGET_KINDS = [
  "kpi",
  "gauge",
  "bar",
  "column",
  "stacked_column",
  "stacked_100",
  "line",
  "multi_line",
  "area",
  "cumulative",
  "waterfall",
  "battery",
  "donut",
  "treemap",
  "funnel",
  "leaderboard",
  "calendar_heatmap",
  "matrix_heatmap",
  "histogram",
  "scatter",
  "workload",
  "country_map",
  "pivot",
  "item_list",
] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

export type WidgetGroup = "Headline" | "Compare" | "Trend" | "Share" | "Pattern" | "Team" | "Table";

export interface WidgetSpec {
  kind: WidgetKind;
  label: string;
  description: string;
  group: WidgetGroup;
  /** Dimensions: "none", "one", "two" (second is the series). */
  dims: "none" | "one" | "two";
  /** First dimension must be a date column. */
  dateFirst?: boolean;
  /** Second dimension must be a date column (workload: person × week). */
  dateSecond?: boolean;
  /** Needs two number columns (x, y). */
  xy?: boolean;
  /** First dimension must be a number column (histogram). */
  numberFirst?: boolean;
  /** First dimension must be a country column. */
  countryFirst?: boolean;
  width: number;
  height: number;
}

export const WIDGETS: Record<WidgetKind, WidgetSpec> = {
  kpi: { kind: "kpi", label: "Number", description: "One headline figure, with change vs the previous period", group: "Headline", dims: "none", width: 3, height: 1 },
  gauge: { kind: "gauge", label: "Goal gauge", description: "Progress toward a target you set", group: "Headline", dims: "none", width: 3, height: 1 },
  bar: { kind: "bar", label: "Bar", description: "Compare categories, longest first", group: "Compare", dims: "one", width: 6, height: 2 },
  column: { kind: "column", label: "Column", description: "Vertical bars for categories or periods", group: "Compare", dims: "one", width: 6, height: 2 },
  stacked_column: { kind: "stacked_column", label: "Stacked column", description: "Each column split by a second field", group: "Compare", dims: "two", width: 6, height: 2 },
  stacked_100: { kind: "stacked_100", label: "100% stacked", description: "The mix inside each column, as shares", group: "Share", dims: "two", width: 6, height: 2 },
  line: { kind: "line", label: "Line", description: "A trend over time", group: "Trend", dims: "one", dateFirst: true, width: 6, height: 2 },
  multi_line: { kind: "multi_line", label: "Multi-line", description: "Compare several trends (e.g. per team or type)", group: "Trend", dims: "two", dateFirst: true, width: 8, height: 2 },
  area: { kind: "area", label: "Area", description: "A trend with the volume underneath", group: "Trend", dims: "one", dateFirst: true, width: 6, height: 2 },
  cumulative: { kind: "cumulative", label: "Cumulative", description: "Running total over time (burn-up)", group: "Trend", dims: "one", dateFirst: true, width: 6, height: 2 },
  waterfall: { kind: "waterfall", label: "Period change", description: "How much each period went up or down", group: "Trend", dims: "one", dateFirst: true, width: 6, height: 2 },
  battery: { kind: "battery", label: "Battery", description: "Monday-style split of a whole by status", group: "Share", dims: "one", width: 6, height: 1 },
  donut: { kind: "donut", label: "Donut", description: "Share of a whole (up to 6 parts)", group: "Share", dims: "one", width: 4, height: 2 },
  treemap: { kind: "treemap", label: "Treemap", description: "Share of a whole with many parts", group: "Share", dims: "one", width: 6, height: 2 },
  funnel: { kind: "funnel", label: "Funnel", description: "Items at each stage, in status order", group: "Share", dims: "one", width: 4, height: 2 },
  leaderboard: { kind: "leaderboard", label: "Leaderboard", description: "Ranked list with each one's recent trend", group: "Team", dims: "one", width: 4, height: 2 },
  calendar_heatmap: { kind: "calendar_heatmap", label: "Calendar heatmap", description: "Output for every day, darker = more", group: "Pattern", dims: "one", dateFirst: true, width: 8, height: 2 },
  matrix_heatmap: { kind: "matrix_heatmap", label: "Matrix heatmap", description: "Two fields crossed, darker = more", group: "Pattern", dims: "two", width: 8, height: 2 },
  histogram: { kind: "histogram", label: "Histogram", description: "How a number is spread out", group: "Pattern", dims: "one", numberFirst: true, width: 6, height: 2 },
  scatter: { kind: "scatter", label: "Scatter", description: "Two numbers per item, to spot relationships", group: "Pattern", dims: "none", xy: true, width: 6, height: 2 },
  workload: { kind: "workload", label: "Workload", description: "Items per person per week, against capacity", group: "Team", dims: "two", dateSecond: true, width: 8, height: 2 },
  country_map: { kind: "country_map", label: "Country map", description: "Items per country on a world map", group: "Compare", dims: "one", countryFirst: true, width: 6, height: 2 },
  pivot: { kind: "pivot", label: "Pivot table", description: "Rows × columns × a measure, with totals", group: "Table", dims: "two", width: 8, height: 2 },
  item_list: { kind: "item_list", label: "Items list", description: "The matching items, newest first", group: "Table", dims: "none", width: 6, height: 2 },
};

export const WIDGET_GROUPS: WidgetGroup[] = ["Headline", "Compare", "Trend", "Share", "Pattern", "Team", "Table"];

export interface WidgetOptions {
  /** Keep the top N first-dimension buckets; the rest become "Other". */
  topN?: number;
  /** Show the value on each mark. */
  labels?: boolean;
  /** Show "vs previous period" (needs a date range). */
  compare?: boolean;
  /** Goal for gauges, or a goal line on bar/column/line. */
  goal?: number;
  /** Weekly capacity per person (workload). */
  capacity?: number;
  /** Number columns for scatter. */
  x?: ColumnRef;
  y?: ColumnRef;
  /** Columns shown by the items list. */
  listColumns?: ColumnRef[];
  /** Histogram bins. */
  bins?: number;
  /** Date column the dashboard's date filter applies to (defaults to the first date column). */
  dateRef?: ColumnRef;
  /** Person column the dashboard's people filter applies to (defaults to the first person column). */
  personRef?: ColumnRef;
}

export interface WidgetConfig {
  v: 2;
  kind: WidgetKind;
  source: { workbookIds: string[]; tabIds?: string[] };
  dims: Dimension[];
  measure: Measure;
  filters: Filter[];
  options: WidgetOptions;
}

/** Dashboard-wide filters, applied to every widget whose sheets have the column. */
export interface DashboardFilters {
  range?: DateRange;
  from?: string;
  to?: string;
  /** User ids; matched against each widget's person column. */
  people?: string[];
  /** Extra "is any of" filters on any column. */
  columns?: Array<{ ref: ColumnRef; values: string[] }>;
}

export function defaultBucket(kind: WidgetKind): DateBucket {
  return kind === "calendar_heatmap" ? "day" : kind === "cumulative" || kind === "waterfall" ? "month" : "week";
}
