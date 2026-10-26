import { z } from "zod";
import { query, tx } from "@/lib/db";
import { cachedAnalytics, cachedItemList, cachedScatter } from "@/lib/analytics/cache";
import {
  DATE_BUCKETS,
  DATE_RANGES,
  DATE_TYPES,
  FILTER_OPS,
  PERSON_TYPES,
  normName,
  previousRange,
  resolveRange,
  type AnalyticsResult,
  type ColumnRef,
  type Filter,
} from "@/lib/analytics/types";
import {
  WIDGET_KINDS,
  WIDGETS,
  defaultBucket,
  type DashboardFilters,
  type WidgetConfig,
  type WidgetKind,
} from "@/lib/analytics/widgets";
import { COLUMN_TYPES } from "@/lib/sheets/ops";
import { displayValue } from "@/lib/sheets/values";
import { visibleTabSql, visibleWorkbooksSql } from "@/lib/sheets/workbook-access";
import type { Role } from "@/lib/rbac";
import type { ColumnType } from "@/lib/db-types";

type Viewer = { id: string; role: Role };

// ---------- validation ----------

const refSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(COLUMN_TYPES),
});

const filterSchema = z.object({
  ref: refSchema,
  op: z.enum(FILTER_OPS),
  values: z.array(z.string().max(200)).max(200).optional(),
  value: z.union([z.string().max(200), z.number()]).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  range: z.enum(DATE_RANGES).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const measureSchema = z.union([
  z.object({ op: z.literal("count") }),
  z.object({ op: z.enum(["sum", "avg", "min", "max"]), column: refSchema }),
  z.object({ op: z.literal("distinct"), column: refSchema }),
]);

export const widgetConfigSchema = z.object({
  v: z.literal(2),
  kind: z.enum(WIDGET_KINDS),
  source: z.object({
    workbookIds: z.array(z.uuid()).min(1, "Choose at least one sheet.").max(30),
    tabIds: z.array(z.uuid()).max(200).optional(),
  }),
  dims: z.array(z.object({ ref: refSchema, bucket: z.enum(DATE_BUCKETS).optional() })).max(2),
  measure: measureSchema,
  filters: z.array(filterSchema).max(20),
  options: z
    .object({
      topN: z.number().int().min(2).max(50).optional(),
      labels: z.boolean().optional(),
      compare: z.boolean().optional(),
      goal: z.number().nonnegative().max(1e12).optional(),
      capacity: z.number().positive().max(1e6).optional(),
      x: refSchema.optional(),
      y: refSchema.optional(),
      listColumns: z.array(refSchema).max(8).optional(),
      bins: z.number().int().min(3).max(40).optional(),
      dateRef: refSchema.optional(),
      personRef: refSchema.optional(),
    })
    .default({}),
});

export const dashboardFiltersSchema = z.object({
  range: z.enum(DATE_RANGES).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  people: z.array(z.uuid()).max(200).optional(),
  columns: z.array(z.object({ ref: refSchema, values: z.array(z.string().max(200)).max(200) })).max(5).optional(),
});

/** Widgets saved before v2 stored { workbookIds, spec }. */
function upgradeConfig(raw: unknown): WidgetConfig | null {
  const parsed = widgetConfigSchema.safeParse(raw);
  if (parsed.success) {
    return parsed.data as WidgetConfig;
  }
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const old = raw as {
    workbookIds?: string[];
    spec?: {
      kind?: string;
      groupBy?: ColumnRef | null;
      metric?: WidgetConfig["measure"];
      dateColumn?: ColumnRef | null;
      range?: string;
      bucket?: string;
    };
  };
  if (!old.workbookIds || !old.spec) {
    return null;
  }
  const kind: WidgetKind =
    old.spec.kind === "battery" ? "battery" : old.spec.kind === "time" ? "column" : old.spec.kind === "number" ? "kpi" : "bar";
  const filters: Filter[] =
    old.spec.dateColumn && old.spec.range && old.spec.range !== "all"
      ? [{ ref: old.spec.dateColumn, op: "date_range", range: old.spec.range as Filter["range"] }]
      : [];
  const candidate = {
    v: 2,
    kind,
    source: { workbookIds: old.workbookIds },
    dims: old.spec.groupBy && kind !== "kpi" ? [{ ref: old.spec.groupBy, bucket: old.spec.bucket ?? "week" }] : [],
    measure: old.spec.metric ?? { op: "count" },
    filters,
    options: {},
  };
  const upgraded = widgetConfigSchema.safeParse(candidate);
  return upgraded.success ? (upgraded.data as WidgetConfig) : null;
}

// ---------- dashboards ----------

export interface DashboardSummary {
  id: string;
  name: string;
  description: string;
  filters: DashboardFilters;
  widgetCount: number;
}

export async function listDashboards(workspaceId: string): Promise<DashboardSummary[]> {
  const rows = await query<{ id: string; name: string; description: string; filters: unknown; widget_count: string }>(
    `SELECT d.id, d.name, d.description, d.filters,
            (SELECT count(*) FROM monitor_dashboard_widgets w WHERE w.dashboard_id = d.id)::text AS widget_count
     FROM monitor_dashboards d
     WHERE d.workspace_id = $1
     ORDER BY d.position, d.created_at`,
    [workspaceId],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    filters: (dashboardFiltersSchema.safeParse(row.filters).data ?? {}) as DashboardFilters,
    widgetCount: Number(row.widget_count),
  }));
}

export async function createDashboard(input: {
  workspaceId: string;
  actorId: string;
  name: string;
  description: string;
}): Promise<string> {
  const rows = await query<{ id: string }>(
    `INSERT INTO monitor_dashboards (workspace_id, name, description, position, created_by)
     VALUES ($1, $2, $3, COALESCE((SELECT max(position) + 1 FROM monitor_dashboards WHERE workspace_id = $1), 0), $4)
     RETURNING id`,
    [input.workspaceId, input.name, input.description, input.actorId],
  );
  return rows[0]!.id;
}

export async function updateDashboard(input: {
  workspaceId: string;
  dashboardId: string;
  name?: string;
  description?: string;
  filters?: DashboardFilters;
}): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE monitor_dashboards
     SET name = COALESCE($3, name), description = COALESCE($4, description), filters = COALESCE($5::jsonb, filters)
     WHERE id = $2 AND workspace_id = $1
     RETURNING id`,
    [
      input.workspaceId,
      input.dashboardId,
      input.name ?? null,
      input.description ?? null,
      input.filters ? JSON.stringify(input.filters) : null,
    ],
  );
  return rows.length > 0;
}

export async function deleteDashboard(workspaceId: string, dashboardId: string): Promise<void> {
  await query(`DELETE FROM monitor_dashboards WHERE id = $2 AND workspace_id = $1`, [workspaceId, dashboardId]);
}

// ---------- widgets ----------

export interface DashboardWidget {
  id: string;
  title: string;
  config: WidgetConfig;
  position: number;
  width: number;
  height: number;
}

export async function listWidgets(dashboardId: string): Promise<DashboardWidget[]> {
  const rows = await query<{ id: string; title: string; config: unknown; position: number; width: number; height: number }>(
    `SELECT id, title, config, position, width, height
     FROM monitor_dashboard_widgets
     WHERE dashboard_id = $1
     ORDER BY position, created_at`,
    [dashboardId],
  );
  return rows.flatMap((row) => {
    const config = upgradeConfig(row.config);
    return config ? [{ id: row.id, title: row.title, config, position: row.position, width: row.width, height: row.height }] : [];
  });
}

export async function getWidget(dashboardId: string, widgetId: string): Promise<DashboardWidget | null> {
  const widgets = await listWidgets(dashboardId);
  return widgets.find((widget) => widget.id === widgetId) ?? null;
}

export async function saveWidget(input: {
  workspaceId: string;
  dashboardId: string;
  widgetId?: string;
  actorId: string;
  title: string;
  config: WidgetConfig;
  width?: number;
  height?: number;
}): Promise<string | null> {
  const spec = WIDGETS[input.config.kind];
  const width = Math.min(12, Math.max(3, input.width ?? spec.width));
  const height = Math.min(3, Math.max(1, input.height ?? spec.height));
  if (input.widgetId) {
    const rows = await query<{ id: string }>(
      `UPDATE monitor_dashboard_widgets SET title = $4, config = $5::jsonb, width = $6, height = $7
       WHERE id = $3 AND dashboard_id = $2 AND workspace_id = $1
       RETURNING id`,
      [input.workspaceId, input.dashboardId, input.widgetId, input.title, JSON.stringify(input.config), width, height],
    );
    return rows[0]?.id ?? null;
  }
  const rows = await query<{ id: string }>(
    `INSERT INTO monitor_dashboard_widgets (workspace_id, dashboard_id, title, config, position, width, height, created_by)
     VALUES ($1, $2, $3, $4::jsonb,
             COALESCE((SELECT max(position) + 1 FROM monitor_dashboard_widgets WHERE dashboard_id = $2), 0),
             $5, $6, $7)
     RETURNING id`,
    [input.workspaceId, input.dashboardId, input.title, JSON.stringify(input.config), width, height, input.actorId],
  );
  return rows[0]?.id ?? null;
}

export async function resizeWidget(input: {
  dashboardId: string;
  widgetId: string;
  width: number;
  height: number;
}): Promise<void> {
  await query(
    `UPDATE monitor_dashboard_widgets SET width = $3, height = $4 WHERE id = $2 AND dashboard_id = $1`,
    [input.dashboardId, input.widgetId, Math.min(12, Math.max(3, input.width)), Math.min(3, Math.max(1, input.height))],
  );
}

export async function deleteWidget(dashboardId: string, widgetId: string): Promise<void> {
  await query(`DELETE FROM monitor_dashboard_widgets WHERE id = $2 AND dashboard_id = $1`, [dashboardId, widgetId]);
}

/** Saves a new order of widget ids. */
export async function reorderWidgets(dashboardId: string, order: string[]): Promise<void> {
  await query(
    `UPDATE monitor_dashboard_widgets w
     SET position = o.position
     FROM unnest($2::uuid[]) WITH ORDINALITY AS o(id, position)
     WHERE w.id = o.id AND w.dashboard_id = $1`,
    [dashboardId, order],
  );
}

export async function duplicateWidget(dashboardId: string, widgetId: string, actorId: string): Promise<void> {
  await tx(async (client) => {
    await client.query(
      `UPDATE monitor_dashboard_widgets SET position = position + 1
       WHERE dashboard_id = $1 AND position > (SELECT position FROM monitor_dashboard_widgets WHERE id = $2)`,
      [dashboardId, widgetId],
    );
    await client.query(
      `INSERT INTO monitor_dashboard_widgets (workspace_id, dashboard_id, title, config, position, width, height, created_by)
       SELECT workspace_id, dashboard_id, title || ' (copy)', config, position + 1, width, height, $3
       FROM monitor_dashboard_widgets WHERE id = $2 AND dashboard_id = $1`,
      [dashboardId, widgetId, actorId],
    );
  });
}

// ---------- sources ----------

export interface DashboardSource {
  id: string;
  name: string;
  tabs: Array<{ id: string; name: string }>;
  columns: ColumnRef[];
}

/** Sheets (and their visible tabs) the viewer can use in this workspace, with every column name found. */
export async function listDashboardSources(viewer: Viewer, workspaceId: string): Promise<DashboardSource[]> {
  const rows = await query<{
    workbook_id: string;
    workbook_name: string;
    sheet_id: string | null;
    sheet_name: string | null;
    name: string | null;
    type: ColumnType | null;
  }>(
    `SELECT w.id AS workbook_id, w.name AS workbook_name, s.id AS sheet_id, s.name AS sheet_name, c.name, c.type
     FROM monitor_workbooks w
     LEFT JOIN monitor_sheets s ON s.workbook_id = w.id AND s.archived_at IS NULL AND ${visibleTabSql(viewer)}
     LEFT JOIN monitor_columns c ON c.sheet_id = s.id AND c.deleted_at IS NULL
     WHERE w.workspace_id = $2 AND w.archived_at IS NULL AND w.deleted_at IS NULL
       AND ${visibleWorkbooksSql(viewer)}
     ORDER BY w.position, s.position, c.position`,
    [viewer.id, workspaceId],
  );
  const byId = new Map<string, DashboardSource & { seen: Set<string>; tabSeen: Set<string> }>();
  for (const row of rows) {
    const source = byId.get(row.workbook_id) ?? {
      id: row.workbook_id,
      name: row.workbook_name,
      tabs: [],
      columns: [],
      seen: new Set<string>(),
      tabSeen: new Set<string>(),
    };
    if (row.sheet_id && row.sheet_name && !source.tabSeen.has(row.sheet_id)) {
      source.tabSeen.add(row.sheet_id);
      source.tabs.push({ id: row.sheet_id, name: row.sheet_name });
    }
    if (row.name && row.type) {
      const key = `${row.type}::${normName(row.name)}`;
      if (!source.seen.has(key)) {
        source.seen.add(key);
        source.columns.push({ name: row.name, type: row.type });
      }
    }
    byId.set(row.workbook_id, source);
  }
  return [...byId.values()].map((source) => ({
    id: source.id,
    name: source.name,
    tabs: source.tabs,
    columns: source.columns,
  }));
}

/** Tabs of the chosen sheets that this viewer may read. */
async function visibleSheetIds(viewer: Viewer, source: WidgetConfig["source"]): Promise<string[]> {
  const rows = await query<{ id: string }>(
    `SELECT s.id
     FROM monitor_sheets s
     JOIN monitor_workbooks w ON w.id = s.workbook_id
     WHERE s.workbook_id = ANY($2::uuid[]) AND s.archived_at IS NULL AND w.deleted_at IS NULL
       AND ($3::uuid[] IS NULL OR s.id = ANY($3::uuid[]))
       AND ${visibleWorkbooksSql(viewer)} AND ${visibleTabSql(viewer)}`,
    [viewer.id, source.workbookIds, source.tabIds && source.tabIds.length > 0 ? source.tabIds : null],
  );
  return rows.map((row) => row.id);
}

// ---------- computing ----------

export type WidgetData =
  | {
      type: "agg";
      result: AnalyticsResult;
      /** Total for the previous period of the same length (KPI comparison). */
      previous?: number;
      /** Leaderboard: per-bucket weekly values for sparklines. */
      trend?: AnalyticsResult;
    }
  | { type: "scatter"; points: Array<{ x: number; y: number }>; rowCount: number }
  | {
      type: "list";
      columns: string[];
      items: Array<{ rowId: string; sheetId: string; tab: string; cells: string[]; updatedAt: string }>;
      rowCount: number;
    }
  | { type: "empty"; message: string };

function firstOfType(columns: ColumnRef[], types: ReadonlySet<ColumnType>): ColumnRef | undefined {
  return columns.find((column) => types.has(column.type));
}

function sourceColumns(config: WidgetConfig, sources: DashboardSource[]): ColumnRef[] {
  return sources.filter((source) => config.source.workbookIds.includes(source.id)).flatMap((source) => source.columns);
}

/** Dashboard-wide filters, translated onto this widget's columns. */
function globalFilters(config: WidgetConfig, sources: DashboardSource[], global: DashboardFilters): Filter[] {
  const columns = sourceColumns(config, sources);
  const filters: Filter[] = [];
  if (global.range && global.range !== "all") {
    const dateRef = config.options.dateRef ?? firstOfType(columns, DATE_TYPES) ?? { name: "Created at", type: "created_at" };
    filters.push({ ref: dateRef, op: "date_range", range: global.range, from: global.from, to: global.to });
  }
  if (global.people && global.people.length > 0) {
    const personRef = config.options.personRef ?? firstOfType(columns, PERSON_TYPES) ?? { name: "Created by", type: "created_by" };
    filters.push({ ref: personRef, op: "any_of", values: global.people });
  }
  for (const column of global.columns ?? []) {
    const exists = columns.some((item) => item.type === column.ref.type && normName(item.name) === normName(column.ref.name));
    if (exists && column.values.length > 0) {
      filters.push({ ref: column.ref, op: "any_of", values: column.values });
    }
  }
  return filters;
}

export async function computeWidget(input: {
  viewer: Viewer;
  widget: Pick<DashboardWidget, "config">;
  sources: DashboardSource[];
  global: DashboardFilters;
  teamIds?: string[];
  /** Extra filters (drill-down on a bucket). */
  extra?: Filter[];
}): Promise<WidgetData> {
  const { viewer, widget, sources, global } = input;
  const config = widget.config;
  const spec = WIDGETS[config.kind];
  const sheetIds = await visibleSheetIds(viewer, config.source);
  if (sheetIds.length === 0) {
    return { type: "empty", message: "None of this widget's sheets are visible to you." };
  }
  const options = { viewerId: viewer.id, teamIds: input.teamIds };
  const filters = [...config.filters, ...globalFilters(config, sources, global), ...(input.extra ?? [])];

  if (spec.xy) {
    if (!config.options.x || !config.options.y) {
      return { type: "empty", message: "Choose two number columns." };
    }
    const scatter = await cachedScatter({ sheetIds, x: config.options.x, y: config.options.y, filters, options });
    return { type: "scatter", ...scatter };
  }

  if (config.kind === "item_list") {
    return listItems(sheetIds, filters, config.options.listColumns ?? [], options);
  }

  const dims = config.dims.slice(0, spec.dims === "none" ? 0 : spec.dims === "one" ? 1 : 2).map((dimension, index) => ({
    ...dimension,
    bucket:
      DATE_TYPES.has(dimension.ref.type) && !dimension.bucket
        ? index === 1 && config.kind === "workload"
          ? ("week" as const)
          : defaultBucket(config.kind)
        : dimension.bucket,
  }));
  if (spec.dims !== "none" && dims.length === 0) {
    return { type: "empty", message: "Choose a column to group by." };
  }
  if (spec.dims === "two" && dims.length < 2) {
    return { type: "empty", message: "Choose a second column to split by." };
  }
  const topN =
    config.options.topN ??
    (config.kind === "donut"
      ? 6
      : config.kind === "bar" || config.kind === "column" || config.kind === "leaderboard" || config.kind === "treemap"
        ? 12
        : config.kind === "battery"
          ? 8
          : undefined);
  const result = await cachedAnalytics({ sheetIds, dims, measure: config.measure, filters, limit: topN }, options);

  let previous: number | undefined;
  if ((config.kind === "kpi" || config.kind === "gauge") && config.options.compare) {
    const rangeFilter = filters.find((filter) => filter.op === "date_range" && filter.range && filter.range !== "all");
    if (rangeFilter) {
      const { from, to } = resolveRange(rangeFilter.range!, new Date(), rangeFilter);
      if (from && to) {
        const prev = previousRange(from, to);
        const shifted = filters.map((filter) =>
          filter === rangeFilter ? { ...filter, range: "custom" as const, from: prev.from, to: prev.to } : filter,
        );
        previous = (await cachedAnalytics({ sheetIds, dims: [], measure: config.measure, filters: shifted }, options)).total;
      }
    }
  }

  let trend: AnalyticsResult | undefined;
  if (config.kind === "leaderboard" && dims[0]) {
    const dateRef = config.options.dateRef ?? firstOfType(sourceColumns(config, sources), DATE_TYPES);
    if (dateRef) {
      trend = await cachedAnalytics(
        {
          sheetIds,
          dims: [dims[0], { ref: dateRef, bucket: "week" }],
          measure: config.measure,
          filters: [...filters, { ref: dateRef, op: "date_range", range: "90d" }],
        },
        options,
      );
    }
  }

  return { type: "agg", result, previous, trend };
}

async function listItems(
  sheetIds: string[],
  filters: Filter[],
  columns: ColumnRef[],
  options: { viewerId: string; teamIds?: string[] },
): Promise<WidgetData> {
  const listed = await cachedItemList({ sheetIds, filters, limit: 50, options });
  const tabIds = [...new Set(listed.items.map((item) => item.sheetId))];
  const [tabColumns, tabs, users] = await Promise.all([
    tabIds.length > 0
      ? query<{ id: string; sheet_id: string; name: string; type: ColumnType; settings: unknown; position: string }>(
          `SELECT id, sheet_id, name, type, settings, position FROM monitor_columns
           WHERE sheet_id = ANY($1::uuid[]) AND deleted_at IS NULL ORDER BY position`,
          [tabIds],
        )
      : Promise.resolve([]),
    tabIds.length > 0
      ? query<{ id: string; name: string }>(`SELECT id, name FROM monitor_sheets WHERE id = ANY($1::uuid[])`, [tabIds])
      : Promise.resolve([]),
    query<{ id: string; full_name: string }>(`SELECT id, full_name FROM monitor_users`),
  ]);
  const names = new Map(users.map((user) => [user.id, user.full_name]));
  const tabName = new Map(tabs.map((tab) => [tab.id, tab.name]));
  // Default columns: the first four columns of the first tab.
  const shown =
    columns.length > 0
      ? columns
      : tabColumns
          .filter((column) => column.sheet_id === tabIds[0])
          .slice(0, 4)
          .map((column) => ({ name: column.name, type: column.type }));
  return {
    type: "list",
    columns: shown.map((column) => column.name),
    rowCount: listed.rowCount,
    items: listed.items.map((item) => {
      const own = tabColumns.filter((column) => column.sheet_id === item.sheetId);
      return {
        rowId: item.rowId,
        sheetId: item.sheetId,
        tab: tabName.get(item.sheetId) ?? "",
        updatedAt: item.updatedAt,
        cells: shown.map((ref) => {
          const column = own.find((candidate) => candidate.type === ref.type && normName(candidate.name) === normName(ref.name));
          if (!column) {
            return "";
          }
          return displayValue(
            { type: column.type, settings: column.settings },
            item.data[column.id] as Parameters<typeof displayValue>[1],
            names,
          );
        }),
      };
    }),
  };
}

/** Distinct values of a column across sheets, for filter pickers. */
export async function columnValues(input: {
  viewer: Viewer;
  workbookIds: string[];
  ref: ColumnRef;
}): Promise<Array<{ key: string; label: string; color?: string }>> {
  const sheetIds = await visibleSheetIds(input.viewer, { workbookIds: input.workbookIds });
  const result = await cachedAnalytics(
    { sheetIds, dims: [{ ref: input.ref, bucket: "day" }], measure: { op: "count" }, filters: [], limit: 200 },
    { viewerId: input.viewer.id },
  );
  return result.buckets
    .filter((bucket) => bucket.key !== "" && bucket.key !== "__other")
    .map((bucket) => ({ key: bucket.key, label: bucket.label, color: bucket.color }));
}
