/**
 * Server-side analytics: aggregates sheet rows inside Postgres so dashboards stay fast
 * at hundreds of thousands of items. Every user value is a bound parameter; only
 * whitelisted keywords (date buckets) are written into the SQL text.
 */
import { query, tx } from "@/lib/db";
import { countryByCode, countryLabel } from "@/lib/sheets/countries";
import {
  DATE_TYPES,
  EMPTY_COLOR,
  EMPTY_KEY,
  EMPTY_LABEL,
  OTHER_KEY,
  normName,
  resolveRange,
  type AnalyticsCell,
  type AnalyticsQuery,
  type AnalyticsResult,
  type Bucket,
  type ColumnRef,
  type DateBucket,
  type Dimension,
  type Filter,
} from "./types";

const BUCKET_SQL: Record<DateBucket, string> = {
  day: "day",
  week: "week",
  month: "month",
  quarter: "quarter",
  year: "year",
};

/** A query only reads rows of these sheets; callers pass sheets the viewer may see. */
class Params {
  readonly values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

interface Context {
  params: Params;
  sheets: string;
  /** Column-map CTEs, one per distinct column reference. */
  maps: Map<string, string>;
  ctes: string[];
  viewerId: string;
  teamIds: string[];
  today: Date;
}

/** CTE mapping each sheet to the id/settings of the column matching `ref`. */
function columnMap(context: Context, ref: ColumnRef): string {
  const key = `${ref.type}|${normName(ref.name)}`;
  const existing = context.maps.get(key);
  if (existing) {
    return existing;
  }
  const alias = `m${context.maps.size + 1}`;
  const type = context.params.add(ref.type);
  const name = context.params.add(normName(ref.name));
  context.ctes.push(`${alias} AS (
    SELECT DISTINCT ON (c.sheet_id) c.sheet_id, c.id::text AS col, c.settings
    FROM monitor_columns c
    WHERE c.sheet_id = ANY(${context.sheets}) AND c.deleted_at IS NULL
      AND c.type = ${type} AND lower(regexp_replace(trim(c.name), '\\s+', ' ', 'g')) = ${name}
    ORDER BY c.sheet_id, c.position
  )`);
  context.maps.set(key, alias);
  return alias;
}

const ISO_DAY = `'^\\d{4}-\\d{2}-\\d{2}'`;

/** SQL for the calendar day a row has in a date-like column (alias m = column map). */
function dayExpr(ref: ColumnRef, m: string): string {
  switch (ref.type) {
    case "created_at":
      return "(r.created_at)::date";
    case "updated_at":
      return "(r.updated_at)::date";
    case "timeline":
      return `(CASE WHEN (r.data->${m}.col->>'start') ~ ${ISO_DAY} THEN left(r.data->${m}.col->>'start', 10)::date END)`;
    default:
      return `(CASE WHEN (r.data->>${m}.col) ~ ${ISO_DAY} THEN left(r.data->>${m}.col, 10)::date END)`;
  }
}

/** A JSON array value, or an empty array when the cell isn't one. */
function arrayOf(m: string): string {
  return `(CASE WHEN jsonb_typeof(r.data->${m}.col) = 'array' THEN r.data->${m}.col ELSE '[]'::jsonb END)`;
}

/**
 * A subquery yielding (key, label, color, ord) for the values one row has in a column.
 * Multi-value cells (people, tags, dropdowns) yield several rows.
 */
function keySql(dimension: Dimension, m: string): string {
  const { ref } = dimension;
  if (DATE_TYPES.has(ref.type)) {
    const bucket = BUCKET_SQL[dimension.bucket ?? "week"];
    return `SELECT to_char(date_trunc('${bucket}', ${dayExpr(ref, m)}), 'YYYY-MM-DD') AS key,
              NULL::text AS label, NULL::text AS color, NULL::int AS ord
            WHERE ${dayExpr(ref, m)} IS NOT NULL`;
  }
  switch (ref.type) {
    case "status":
    case "priority":
      return `SELECT lower(o->>'label') AS key, o->>'label' AS label, o->>'color' AS color, ord::int AS ord
              FROM jsonb_array_elements(COALESCE(${m}.settings->'options', '[]'::jsonb)) WITH ORDINALITY AS t(o, ord)
              WHERE o->>'id' = r.data->>${m}.col`;
    case "dropdown":
      return `SELECT lower(o->>'label') AS key, o->>'label' AS label, o->>'color' AS color, ord::int AS ord
              FROM jsonb_array_elements(COALESCE(${m}.settings->'options', '[]'::jsonb)) WITH ORDINALITY AS t(o, ord)
              WHERE o->>'id' IN (SELECT jsonb_array_elements_text(${arrayOf(m)}))`;
    case "person":
      return `SELECT v AS key, NULL::text AS label, NULL::text AS color, NULL::int AS ord
              FROM jsonb_array_elements_text(${arrayOf(m)}) AS v`;
    case "tags":
      return `SELECT lower(trim(v)) AS key, trim(v) AS label, NULL::text AS color, NULL::int AS ord
              FROM jsonb_array_elements_text(${arrayOf(m)}) AS v WHERE trim(v) <> ''`;
    case "created_by":
      return `SELECT r.created_by::text AS key, NULL::text AS label, NULL::text AS color, NULL::int AS ord
              WHERE r.created_by IS NOT NULL`;
    case "checkbox":
      return `SELECT CASE WHEN r.data->${m}.col = 'true'::jsonb THEN 'yes' ELSE 'no' END AS key,
                     CASE WHEN r.data->${m}.col = 'true'::jsonb THEN 'Checked' ELSE 'Not checked' END AS label,
                     NULL::text AS color,
                     CASE WHEN r.data->${m}.col = 'true'::jsonb THEN 0 ELSE 1 END AS ord`;
    case "rating":
    case "number":
      return `SELECT r.data->>${m}.col AS key, NULL::text AS label, NULL::text AS color, NULL::int AS ord
              WHERE jsonb_typeof(r.data->${m}.col) = 'number'`;
    default:
      return `SELECT lower(trim(r.data->>${m}.col)) AS key, left(trim(r.data->>${m}.col), 60) AS label,
                     NULL::text AS color, NULL::int AS ord
              WHERE jsonb_typeof(r.data->${m}.col) = 'string' AND trim(r.data->>${m}.col) <> ''`;
  }
}

/** SQL condition for one filter (true when the row passes). */
function filterSql(context: Context, filter: Filter): string {
  const m = columnMap(context, filter.ref);
  const { params } = context;
  const hasColumn = `${m}.col IS NOT NULL`;
  const keys = `(${keySql({ ref: filter.ref, bucket: "day" }, m)})`;
  const anyKey = (list: string) => `EXISTS (SELECT 1 FROM ${keys} f WHERE f.key = ANY(${list}))`;
  const hasValue = `EXISTS (SELECT 1 FROM ${keys} f)`;
  switch (filter.op) {
    case "any_of":
      return `(${hasColumn} AND ${anyKey(params.add((filter.values ?? []).map((value) => value.toLowerCase())))})`;
    case "none_of":
      return `(${m}.col IS NULL OR NOT ${anyKey(params.add((filter.values ?? []).map((value) => value.toLowerCase())))})`;
    case "empty":
      return `(${m}.col IS NULL OR NOT ${hasValue})`;
    case "not_empty":
      return `(${hasColumn} AND ${hasValue})`;
    case "contains":
      return `(${hasColumn} AND (r.data->>${m}.col) ILIKE ${params.add(`%${String(filter.value ?? "")}%`)})`;
    case "not_contains":
      return `(${m}.col IS NULL OR coalesce(r.data->>${m}.col, '') NOT ILIKE ${params.add(`%${String(filter.value ?? "")}%`)})`;
    case "eq":
    case "gt":
    case "lt": {
      const operator = filter.op === "eq" ? "=" : filter.op === "gt" ? ">" : "<";
      return `(${hasColumn} AND jsonb_typeof(r.data->${m}.col) = 'number'
               AND (r.data->>${m}.col)::numeric ${operator} ${params.add(Number(filter.value ?? 0))})`;
    }
    case "between":
      return `(${hasColumn} AND jsonb_typeof(r.data->${m}.col) = 'number'
               AND (r.data->>${m}.col)::numeric BETWEEN ${params.add(Number(filter.min ?? 0))} AND ${params.add(Number(filter.max ?? 0))})`;
    case "date_range": {
      const { from, to } = resolveRange(filter.range ?? "all", context.today, filter);
      if (!from && !to) {
        return "TRUE";
      }
      const day = dayExpr(filter.ref, m);
      const parts = [`${day} IS NOT NULL`];
      if (from) {
        parts.push(`${day} >= ${params.add(from)}::date`);
      }
      if (to) {
        parts.push(`${day} <= ${params.add(to)}::date`);
      }
      return `(${filter.ref.type === "created_at" || filter.ref.type === "updated_at" ? "TRUE" : hasColumn} AND ${parts.join(" AND ")})`;
    }
    case "me":
      return `(${anyKey(params.add([context.viewerId]))})`;
    case "my_team":
      return `(${anyKey(params.add(context.teamIds.length > 0 ? context.teamIds : [context.viewerId]))})`;
    case "checked":
      return `(${hasColumn} AND r.data->${m}.col = 'true'::jsonb)`;
    case "unchecked":
      return `(${m}.col IS NULL OR r.data->${m}.col IS DISTINCT FROM 'true'::jsonb)`;
    default:
      return "TRUE";
  }
}

/** Types whose cells can hold several values: one row can land in several buckets. */
const MULTI_VALUE = new Set(["person", "tags", "dropdown"]);

function measureSql(context: Context, query: AnalyticsQuery): { expr: string; joins: string[] } {
  const { measure } = query;
  if (measure.op === "count") {
    // Plain count(*) is much cheaper; it's exact unless a dimension fans a row out.
    const fansOut = query.dims.some((dimension) => MULTI_VALUE.has(dimension.ref.type));
    return { expr: fansOut ? "count(DISTINCT r.id)" : "count(*)", joins: [] };
  }
  const m = columnMap(context, measure.column);
  if (measure.op === "distinct") {
    return {
      expr: "count(DISTINCT mv.key)",
      joins: [`LEFT JOIN LATERAL (${keySql({ ref: measure.column, bucket: "day" }, m)}) mv ON TRUE`],
    };
  }
  const number = `(CASE WHEN jsonb_typeof(r.data->${m}.col) = 'number' THEN (r.data->>${m}.col)::numeric END)`;
  const fn = measure.op === "avg" ? "avg" : measure.op;
  return { expr: `coalesce(${fn}(${number}), 0)`, joins: [] };
}

export interface RunOptions {
  viewerId: string;
  /** User ids for the "my team" filter (the viewer's team, including them). */
  teamIds?: string[];
  today?: Date;
  /** Abort long scans (ms). */
  timeoutMs?: number;
}

/** Runs one aggregation over the given sheets. */
export async function runAnalytics(input: AnalyticsQuery, options: RunOptions): Promise<AnalyticsResult> {
  if (input.sheetIds.length === 0) {
    return { buckets: [], series: [], cells: [], total: 0, rowCount: 0 };
  }
  const params = new Params();
  const context: Context = {
    params,
    sheets: "",
    maps: new Map(),
    ctes: [],
    viewerId: options.viewerId,
    teamIds: options.teamIds ?? [],
    today: options.today ?? new Date(),
  };
  context.sheets = `${params.add(input.sheetIds)}::uuid[]`;

  const dims = input.dims.slice(0, 2);
  const dimMaps = dims.map((dimension) => columnMap(context, dimension.ref));
  const measure = measureSql(context, input);
  const where = input.filters.map((filter) => filterSql(context, filter));

  const joins: string[] = [];
  for (const alias of context.maps.values()) {
    joins.push(`LEFT JOIN ${alias} ON ${alias}.sheet_id = r.sheet_id`);
  }
  // Rows of tabs that don't have a grouping column aren't part of that chart.
  const groupGuards = dims
    .map((dimension, index) =>
      dimension.ref.type === "created_by" || dimension.ref.type === "created_at" || dimension.ref.type === "updated_at"
        ? null
        : `${dimMaps[index]}.col IS NOT NULL`,
    )
    .filter((guard): guard is string => guard !== null);

  const dimJoins = dims.map(
    (dimension, index) => `LEFT JOIN LATERAL (${keySql(dimension, dimMaps[index]!)}) d${index + 1} ON TRUE`,
  );
  const selectDims = dims
    .map(
      (_, index) =>
        `coalesce(d${index + 1}.key, '') AS k${index + 1}, max(d${index + 1}.label) AS l${index + 1},
         max(d${index + 1}.color) AS c${index + 1}, min(d${index + 1}.ord) AS o${index + 1}`,
    )
    .join(",\n");
  const groupBy = dims.map((_, index) => `coalesce(d${index + 1}.key, '')`).join(", ");

  const base = `
    FROM monitor_rows r
    ${joins.join("\n")}
    ${measure.joins.join("\n")}
    WHERE r.sheet_id = ANY(${context.sheets}) AND r.deleted_at IS NULL
      ${groupGuards.length > 0 ? `AND ${groupGuards.join(" AND ")}` : ""}
      ${where.length > 0 ? `AND ${where.join(" AND ")}` : ""}`;

  const cte = context.ctes.length > 0 ? `WITH ${context.ctes.join(",\n")}` : "";
  const totalMeasure = input.measure.op === "count" ? "count(*)" : measure.expr;
  const totalSql = `${cte} SELECT ${totalMeasure} AS value, count(*) AS rows ${base}`;
  const groupedSql =
    dims.length > 0
      ? `${cte} SELECT ${selectDims}, ${measure.expr} AS value,
           ${dims.some((dimension) => MULTI_VALUE.has(dimension.ref.type)) ? "count(DISTINCT r.id)" : "count(*)"} AS rows
         ${base.replace("WHERE r.sheet_id", `${dimJoins.join("\n")}\n    WHERE r.sheet_id`)}
         GROUP BY ${groupBy}`
      : null;

  const timeout = Math.max(1000, Math.min(options.timeoutMs ?? 15_000, 60_000));
  // A runaway query gives up after `timeout` instead of tying up a connection.
  const run = <T>(sql: string): Promise<T[] | null> =>
    tx(async (client) => {
      await client.query(`SET LOCAL statement_timeout = ${timeout}`);
      const result = await client.query(`/* analytics */ ${sql}`, params.values);
      return result.rows as T[];
    }).catch((error: unknown) => {
      if (error instanceof Error && /statement timeout/i.test(error.message)) {
        return null;
      }
      throw error;
    });

  const [totals, grouped] = await Promise.all([
    run<{ value: string | number | null; rows: string | number }>(totalSql),
    groupedSql
      ? run<{
          k1: string;
          l1: string | null;
          c1: string | null;
          o1: number | null;
          k2?: string;
          l2?: string | null;
          c2?: string | null;
          o2?: number | null;
          value: string | number | null;
          rows: string | number;
        }>(groupedSql)
      : Promise.resolve([]),
  ]);

  const total = Number(totals?.[0]?.value ?? 0);
  const rowCount = Number(totals?.[0]?.rows ?? 0);
  const list = grouped ?? [];

  const bucketMap = new Map<string, Bucket & { value: number }>();
  const seriesMap = new Map<string, Bucket & { value: number }>();
  const cells: AnalyticsCell[] = [];
  for (const row of list) {
    const value = Number(row.value ?? 0);
    const k1 = row.k1 ?? EMPTY_KEY;
    const k2 = dims.length > 1 ? (row.k2 ?? EMPTY_KEY) : "";
    const b = bucketMap.get(k1) ?? { key: k1, label: row.l1 ?? k1, color: row.c1 ?? undefined, order: row.o1 ?? undefined, value: 0 };
    b.value += value;
    bucketMap.set(k1, b);
    if (dims.length > 1) {
      const s = seriesMap.get(k2) ?? { key: k2, label: row.l2 ?? k2, color: row.c2 ?? undefined, order: row.o2 ?? undefined, value: 0 };
      s.value += value;
      seriesMap.set(k2, s);
    }
    cells.push({ k1, k2, value, rows: Number(row.rows) });
  }

  const names = await labelLookup([dims[0], dims[1]], [...bucketMap.values(), ...seriesMap.values()]);
  const finish = (bucket: Bucket & { value: number }, dimension: Dimension | undefined): Bucket & { value: number } => {
    if (bucket.key === EMPTY_KEY) {
      return { ...bucket, label: EMPTY_LABEL, color: EMPTY_COLOR, order: 1e9 };
    }
    return { ...bucket, label: labelFor(bucket, dimension, names) };
  };

  let buckets = [...bucketMap.values()].map((bucket) => finish(bucket, dims[0]));
  let series = [...seriesMap.values()].map((bucket) => finish(bucket, dims[1]));
  buckets = sortBuckets(buckets, dims[0]);
  series = sortBuckets(series, dims[1]);

  if (input.limit && buckets.length > input.limit && !(dims[0] && DATE_TYPES.has(dims[0].ref.type))) {
    const keep = new Set(
      [...buckets]
        .filter((bucket) => bucket.key !== EMPTY_KEY)
        .sort((a, b) => b.value - a.value)
        .slice(0, input.limit - 1)
        .map((bucket) => bucket.key),
    );
    const folded = buckets.filter((bucket) => !keep.has(bucket.key));
    buckets = buckets.filter((bucket) => keep.has(bucket.key));
    if (folded.length > 0) {
      const foldedKeys = new Set(folded.map((bucket) => bucket.key));
      const merged = new Map<string, AnalyticsCell>();
      for (const cell of cells) {
        if (!foldedKeys.has(cell.k1)) {
          continue;
        }
        const existing = merged.get(cell.k2) ?? { k1: OTHER_KEY, k2: cell.k2, value: 0, rows: 0 };
        existing.value += cell.value;
        existing.rows += cell.rows;
        merged.set(cell.k2, existing);
      }
      const remaining = cells.filter((cell) => !foldedKeys.has(cell.k1));
      cells.length = 0;
      cells.push(...remaining, ...merged.values());
      buckets.push({ key: OTHER_KEY, label: `Other (${folded.length})`, value: folded.reduce((sum, item) => sum + item.value, 0) });
    }
  }

  return {
    buckets: buckets.map(({ key, label, color, order }) => ({ key, label, color, order })),
    series: series.map(({ key, label, color, order }) => ({ key, label, color, order })),
    cells,
    total,
    rowCount,
    truncated: totals === null || grouped === null,
  };
}

function sortBuckets<T extends Bucket & { value: number }>(list: T[], dimension: Dimension | undefined): T[] {
  if (!dimension) {
    return list;
  }
  if (DATE_TYPES.has(dimension.ref.type)) {
    return [...list].sort((a, b) => (a.key === EMPTY_KEY ? 1 : b.key === EMPTY_KEY ? -1 : a.key.localeCompare(b.key)));
  }
  if (dimension.ref.type === "rating" || dimension.ref.type === "number") {
    return [...list].sort((a, b) => Number(b.key) - Number(a.key));
  }
  return [...list].sort((a, b) => {
    if (a.key === EMPTY_KEY || b.key === EMPTY_KEY) {
      return a.key === EMPTY_KEY ? 1 : -1;
    }
    if (a.order !== undefined && b.order !== undefined && a.order !== b.order) {
      return a.order - b.order;
    }
    return b.value - a.value || a.label.localeCompare(b.label);
  });
}

async function labelLookup(dims: Array<Dimension | undefined>, buckets: Bucket[]): Promise<Map<string, string>> {
  const needsUsers = dims.some((dimension) => dimension && (dimension.ref.type === "person" || dimension.ref.type === "created_by"));
  if (!needsUsers) {
    return new Map();
  }
  const ids = buckets.map((bucket) => bucket.key).filter((key) => /^[0-9a-f-]{36}$/i.test(key));
  if (ids.length === 0) {
    return new Map();
  }
  const rows = await query<{ id: string; full_name: string }>(
    `SELECT id::text, full_name FROM monitor_users WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  return new Map(rows.map((row) => [row.id, row.full_name]));
}

function labelFor(bucket: Bucket, dimension: Dimension | undefined, names: Map<string, string>): string {
  if (!dimension) {
    return bucket.label;
  }
  const { type } = dimension.ref;
  if (type === "person" || type === "created_by") {
    return names.get(bucket.key) ?? "Former user";
  }
  if (type === "country") {
    const country = countryByCode(bucket.key.toUpperCase()) ?? countryByCode(bucket.key);
    return country ? countryLabel(country, true) : bucket.key.toUpperCase();
  }
  if (type === "rating") {
    return `${bucket.key} ★`;
  }
  if (DATE_TYPES.has(type)) {
    return dateLabel(bucket.key, dimension.bucket ?? "week");
  }
  return bucket.label || bucket.key;
}

export function dateLabel(key: string, bucket: DateBucket): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) {
    return key;
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  switch (bucket) {
    case "year":
      return String(date.getFullYear());
    case "quarter":
      return `Q${Math.floor(date.getMonth() / 3) + 1} ${date.getFullYear()}`;
    case "month":
      return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    case "week":
      return `Wk of ${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    default:
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
}

/** Raw number pairs for scatter charts (sampled). */
export async function runScatter(input: {
  sheetIds: string[];
  x: ColumnRef;
  y: ColumnRef;
  filters: Filter[];
  limit?: number;
  options: RunOptions;
}): Promise<{ points: Array<{ x: number; y: number }>; rowCount: number }> {
  if (input.sheetIds.length === 0) {
    return { points: [], rowCount: 0 };
  }
  const params = new Params();
  const context: Context = {
    params,
    sheets: "",
    maps: new Map(),
    ctes: [],
    viewerId: input.options.viewerId,
    teamIds: input.options.teamIds ?? [],
    today: input.options.today ?? new Date(),
  };
  context.sheets = `${params.add(input.sheetIds)}::uuid[]`;
  const mx = columnMap(context, input.x);
  const my = columnMap(context, input.y);
  const where = input.filters.map((filter) => filterSql(context, filter));
  const joins = [...context.maps.values()].map((alias) => `LEFT JOIN ${alias} ON ${alias}.sheet_id = r.sheet_id`);
  const limit = params.add(Math.min(input.limit ?? 2000, 5000));
  const rows = await query<{ x: string; y: string }>(
    `WITH ${context.ctes.join(",\n")}
     SELECT (r.data->>${mx}.col) AS x, (r.data->>${my}.col) AS y
     FROM monitor_rows r ${joins.join("\n")}
     WHERE r.sheet_id = ANY(${context.sheets}) AND r.deleted_at IS NULL
       AND jsonb_typeof(r.data->${mx}.col) = 'number' AND jsonb_typeof(r.data->${my}.col) = 'number'
       ${where.length > 0 ? `AND ${where.join(" AND ")}` : ""}
     ORDER BY random()
     LIMIT ${limit}`,
    params.values,
  );
  return { points: rows.map((row) => ({ x: Number(row.x), y: Number(row.y) })), rowCount: rows.length };
}

export interface ListedItem {
  rowId: string;
  sheetId: string;
  tabName: string;
  workbookName: string;
  values: Record<string, string>;
  updatedAt: string;
}

/** Matching items for list widgets, newest first. Values are raw; callers format them. */
export async function runItemList(input: {
  sheetIds: string[];
  filters: Filter[];
  limit?: number;
  options: RunOptions;
}): Promise<{ items: Array<{ rowId: string; sheetId: string; data: Record<string, unknown>; updatedAt: string; createdBy: string | null }>; rowCount: number }> {
  if (input.sheetIds.length === 0) {
    return { items: [], rowCount: 0 };
  }
  const params = new Params();
  const context: Context = {
    params,
    sheets: "",
    maps: new Map(),
    ctes: [],
    viewerId: input.options.viewerId,
    teamIds: input.options.teamIds ?? [],
    today: input.options.today ?? new Date(),
  };
  context.sheets = `${params.add(input.sheetIds)}::uuid[]`;
  const where = input.filters.map((filter) => filterSql(context, filter));
  const joins = [...context.maps.values()].map((alias) => `LEFT JOIN ${alias} ON ${alias}.sheet_id = r.sheet_id`);
  const cte = context.ctes.length > 0 ? `WITH ${context.ctes.join(",\n")}` : "";
  const limit = params.add(Math.min(input.limit ?? 50, 200));
  const rows = await query<{ id: string; sheet_id: string; data: Record<string, unknown>; updated_at: Date; created_by: string | null; total: string }>(
    `${cte}
     SELECT r.id, r.sheet_id, r.data, r.updated_at, r.created_by, count(*) OVER () AS total
     FROM monitor_rows r ${joins.join("\n")}
     WHERE r.sheet_id = ANY(${context.sheets}) AND r.deleted_at IS NULL
       ${where.length > 0 ? `AND ${where.join(" AND ")}` : ""}
     ORDER BY r.updated_at DESC
     LIMIT ${limit}`,
    params.values,
  );
  return {
    items: rows.map((row) => ({
      rowId: row.id,
      sheetId: row.sheet_id,
      data: row.data,
      updatedAt: row.updated_at.toISOString(),
      createdBy: row.created_by,
    })),
    rowCount: Number(rows[0]?.total ?? 0),
  };
}
