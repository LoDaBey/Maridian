"use client";

import { labeledOptions } from "@/lib/sheets/values";
import {
  DATE_TYPES,
  GROUPABLE_TYPES,
  type ChartKind,
  type ChartSpec,
  type ColumnRef,
  type DateBucket,
  type DateRange,
  type Metric,
} from "@/lib/charts/aggregate";

export const KIND_LABEL: Record<ChartKind, string> = {
  bar: "Bar chart",
  battery: "Battery (share of total)",
  time: "Over time",
  number: "Number",
};

const RANGE_LABEL: Record<DateRange, string> = {
  all: "All time",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  this_month: "This month",
  this_year: "This year",
};

const BUCKET_LABEL: Record<DateBucket, string> = { day: "Day", week: "Week", month: "Month" };

export function refKey(ref: ColumnRef): string {
  return `${ref.type}::${ref.name}`;
}

function fromKey(key: string): ColumnRef | null {
  const index = key.indexOf("::");
  if (index < 0) {
    return null;
  }
  return { type: key.slice(0, index) as ColumnRef["type"], name: key.slice(index + 2) };
}

/** Unique (name, type) columns, in first-seen order. */
export function uniqueRefs(columns: Array<{ name: string; type: ColumnRef["type"] }>): ColumnRef[] {
  const seen = new Set<string>();
  const out: ColumnRef[] = [];
  for (const column of columns) {
    const ref = { name: column.name, type: column.type };
    const key = refKey({ name: ref.name.trim().toLowerCase(), type: ref.type });
    if (!seen.has(key)) {
      seen.add(key);
      out.push(ref);
    }
  }
  return out;
}

/**
 * The status / priority column best suited to a first chart: one with a handful of
 * labels (2-8). Imported sheets sometimes hold dates or notes as status labels.
 */
export function preferredGroup(
  columns: Array<{ name: string; type: ColumnRef["type"]; settings: unknown }>,
): ColumnRef | null {
  const fit = columns.find((column) => {
    if (column.type !== "status" && column.type !== "priority") {
      return false;
    }
    const count = labeledOptions(column.settings).length;
    return count >= 2 && count <= 8;
  });
  return fit ? { name: fit.name, type: fit.type } : null;
}

/** A sensible first chart: a short status split as a battery, else the first groupable column. */
export function defaultSpec(columns: ColumnRef[], preferred: ColumnRef | null = null): ChartSpec {
  const status = preferred;
  const group = status ?? columns.find((column) => GROUPABLE_TYPES.has(column.type) && !DATE_TYPES.has(column.type));
  const date = columns.find((column) => DATE_TYPES.has(column.type)) ?? null;
  return {
    kind: status ? "battery" : group ? "bar" : date ? "time" : "number",
    groupBy: group ?? date,
    metric: { op: "count" },
    dateColumn: date,
    range: "all",
    bucket: "week",
  };
}

/** Keeps a saved spec valid when columns are renamed or removed. */
export function reconcileSpec(spec: ChartSpec, columns: ColumnRef[]): ChartSpec {
  const has = (ref: ColumnRef | null) =>
    ref !== null && columns.some((column) => column.type === ref.type && column.name === ref.name);
  const fallback = defaultSpec(columns);
  const groupBy = has(spec.groupBy) ? spec.groupBy : fallback.groupBy;
  const metric: Metric = spec.metric.op === "count" || has(spec.metric.column) ? spec.metric : { op: "count" };
  return {
    ...spec,
    groupBy,
    metric,
    dateColumn: has(spec.dateColumn) ? spec.dateColumn : spec.range === "all" ? spec.dateColumn : fallback.dateColumn,
  };
}

const field = "w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary";

/** The same chart as another kind, with a group-by column that suits that kind. */
export function withKind(spec: ChartSpec, kind: ChartKind, columns: ColumnRef[]): ChartSpec {
  const groupable = columns.filter((column) =>
    spec.kind === "time" ? DATE_TYPES.has(column.type) : GROUPABLE_TYPES.has(column.type),
  );
  const dates = columns.filter((column) => DATE_TYPES.has(column.type));
  if (kind === "time") {
    const groupBy = spec.groupBy && DATE_TYPES.has(spec.groupBy.type) ? spec.groupBy : (dates[0] ?? null);
    return { ...spec, kind, groupBy };
  }
  if (kind !== "number" && spec.groupBy && DATE_TYPES.has(spec.groupBy.type) && kind !== "bar") {
    const groupBy = columns.find((column) => GROUPABLE_TYPES.has(column.type) && !DATE_TYPES.has(column.type));
    return { ...spec, kind, groupBy: groupBy ?? spec.groupBy };
  }
  return { ...spec, kind, groupBy: spec.groupBy ?? groupable[0] ?? null };
}

export function ChartSettings({
  spec,
  columns,
  onChange,
}: {
  spec: ChartSpec;
  columns: ColumnRef[];
  onChange: (spec: ChartSpec) => void;
}) {
  const groupable = columns.filter((column) =>
    spec.kind === "time" ? DATE_TYPES.has(column.type) : GROUPABLE_TYPES.has(column.type),
  );
  const numbers = columns.filter((column) => column.type === "number");
  const dates = columns.filter((column) => DATE_TYPES.has(column.type));
  const metricKey = spec.metric.op === "count" ? "count" : `${spec.metric.op}|${refKey(spec.metric.column)}`;

  function setKind(kind: ChartKind) {
    onChange(withKind(spec, kind, columns));
  }

  return (
    <div className="space-y-3 text-sm">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted">Chart</span>
        <select aria-label="Chart type" value={spec.kind} className={field} onChange={(event) => setKind(event.target.value as ChartKind)}>
          {(Object.keys(KIND_LABEL) as ChartKind[]).map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABEL[kind]}
            </option>
          ))}
        </select>
      </label>

      {spec.kind !== "number" ? (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">{spec.kind === "time" ? "Date column" : "Group by"}</span>
          <select
            aria-label="Group by column"
            value={spec.groupBy ? refKey(spec.groupBy) : ""}
            className={field}
            onChange={(event) => onChange({ ...spec, groupBy: fromKey(event.target.value) })}
          >
            {groupable.length === 0 ? <option value="">No suitable column</option> : null}
            {groupable.map((column) => (
              <option key={refKey(column)} value={refKey(column)}>
                {column.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {spec.kind === "time" || (spec.groupBy && DATE_TYPES.has(spec.groupBy.type)) ? (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Show by</span>
          <select
            aria-label="Date bucket"
            value={spec.bucket}
            className={field}
            onChange={(event) => onChange({ ...spec, bucket: event.target.value as DateBucket })}
          >
            {(Object.keys(BUCKET_LABEL) as DateBucket[]).map((bucket) => (
              <option key={bucket} value={bucket}>
                {BUCKET_LABEL[bucket]}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted">Measure</span>
        <select
          aria-label="Measure"
          value={metricKey}
          className={field}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "count") {
              onChange({ ...spec, metric: { op: "count" } });
              return;
            }
            const [op, key] = value.split("|") as ["sum" | "avg", string];
            const column = fromKey(key);
            if (column) {
              onChange({ ...spec, metric: { op, column } });
            }
          }}
        >
          <option value="count">Count items</option>
          {numbers.flatMap((column) => [
            <option key={`sum|${refKey(column)}`} value={`sum|${refKey(column)}`}>
              Sum of {column.name}
            </option>,
            <option key={`avg|${refKey(column)}`} value={`avg|${refKey(column)}`}>
              Average of {column.name}
            </option>,
          ])}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Date range</span>
          <select
            aria-label="Date range"
            value={spec.range}
            disabled={dates.length === 0}
            className={field}
            onChange={(event) => {
              const range = event.target.value as DateRange;
              onChange({ ...spec, range, dateColumn: spec.dateColumn ?? dates[0] ?? null });
            }}
          >
            {(Object.keys(RANGE_LABEL) as DateRange[]).map((range) => (
              <option key={range} value={range}>
                {RANGE_LABEL[range]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Using</span>
          <select
            aria-label="Date column for the range"
            value={spec.dateColumn ? refKey(spec.dateColumn) : ""}
            disabled={spec.range === "all" || dates.length === 0}
            className={field}
            onChange={(event) => onChange({ ...spec, dateColumn: fromKey(event.target.value) })}
          >
            {dates.length === 0 ? <option value="">No date column</option> : null}
            {dates.map((column) => (
              <option key={refKey(column)} value={refKey(column)}>
                {column.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

export function rangeCaption(spec: ChartSpec, rowCount: number): string {
  const items = `${rowCount.toLocaleString("en-US")} item${rowCount === 1 ? "" : "s"}`;
  return spec.range === "all" ? items : `${items} · ${RANGE_LABEL[spec.range].toLowerCase()}`;
}
