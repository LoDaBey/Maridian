import { z } from "zod";
import { query } from "@/lib/db";
import {
  aggregate,
  CHART_KINDS,
  DATE_BUCKETS,
  DATE_RANGES,
  type ChartResult,
  type ChartSpec,
  type ChartTable,
  type ColumnRef,
} from "@/lib/charts/aggregate";
import { COLUMN_TYPES } from "@/lib/sheets/ops";
import { visibleTabSql, visibleWorkbooksSql } from "@/lib/sheets/workbook-access";
import type { Role } from "@/lib/rbac";
import type { ColumnType } from "@/lib/db-types";

type Viewer = { id: string; role: Role };

const columnRefSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(COLUMN_TYPES),
});

export const chartSpecSchema = z.object({
  kind: z.enum(CHART_KINDS),
  groupBy: columnRefSchema.nullable(),
  metric: z.union([
    z.object({ op: z.literal("count") }),
    z.object({ op: z.enum(["sum", "avg"]), column: columnRefSchema }),
  ]),
  dateColumn: columnRefSchema.nullable(),
  range: z.enum(DATE_RANGES),
  bucket: z.enum(DATE_BUCKETS),
});

export const widgetConfigSchema = z.object({
  workbookIds: z.array(z.uuid()).min(1, "Choose at least one sheet.").max(20),
  spec: chartSpecSchema,
});

export type WidgetConfig = z.infer<typeof widgetConfigSchema>;

export interface DashboardWidget {
  id: string;
  title: string;
  config: WidgetConfig;
  position: number;
}

export interface WidgetView extends DashboardWidget {
  result: ChartResult;
  /** Sheets the widget reads that this viewer can open (others are left out of the numbers). */
  sheetNames: string[];
  hiddenSheets: number;
}

export interface DashboardSource {
  id: string;
  name: string;
  tabCount: number;
  columns: ColumnRef[];
}

export async function listWidgets(workspaceId: string): Promise<DashboardWidget[]> {
  const rows = await query<{ id: string; title: string; config: unknown; position: number }>(
    `SELECT id, title, config, position
     FROM monitor_dashboard_widgets
     WHERE workspace_id = $1
     ORDER BY position, created_at`,
    [workspaceId],
  );
  return rows.flatMap((row) => {
    const parsed = widgetConfigSchema.safeParse(row.config);
    return parsed.success ? [{ id: row.id, title: row.title, config: parsed.data, position: row.position }] : [];
  });
}

/** Sheets in the workspace the viewer can open, with the columns found across all their tabs. */
export async function listDashboardSources(viewer: Viewer, workspaceId: string): Promise<DashboardSource[]> {
  const rows = await query<{
    workbook_id: string;
    workbook_name: string;
    tab_count: string | number;
    name: string | null;
    type: ColumnType | null;
  }>(
    `SELECT w.id AS workbook_id, w.name AS workbook_name,
            (SELECT count(*) FROM monitor_sheets s WHERE s.workbook_id = w.id AND s.archived_at IS NULL
               AND ${visibleTabSql(viewer)}) AS tab_count,
            c.name, c.type
     FROM monitor_workbooks w
     LEFT JOIN monitor_sheets s ON s.workbook_id = w.id AND s.archived_at IS NULL AND ${visibleTabSql(viewer)}
     LEFT JOIN monitor_columns c ON c.sheet_id = s.id AND c.deleted_at IS NULL
     WHERE w.workspace_id = $2 AND w.archived_at IS NULL AND w.deleted_at IS NULL
       AND ${visibleWorkbooksSql(viewer)}
     ORDER BY w.position, s.position, c.position`,
    [viewer.id, workspaceId],
  );
  const byId = new Map<string, DashboardSource & { seen: Set<string> }>();
  for (const row of rows) {
    const source = byId.get(row.workbook_id) ?? {
      id: row.workbook_id,
      name: row.workbook_name,
      tabCount: Number(row.tab_count),
      columns: [],
      seen: new Set<string>(),
    };
    if (row.name && row.type) {
      const key = `${row.type}::${row.name.trim().toLowerCase()}`;
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
    tabCount: source.tabCount,
    columns: source.columns,
  }));
}

/** Loads every tab of the given sheets as chart tables. */
async function loadTables(viewer: Viewer, workbookIds: string[]): Promise<Map<string, ChartTable[]>> {
  const tables = new Map<string, ChartTable[]>();
  if (workbookIds.length === 0) {
    return tables;
  }
  const sheets = await query<{ id: string; workbook_id: string }>(
    `SELECT s.id, s.workbook_id FROM monitor_sheets s
     WHERE s.workbook_id = ANY($1::uuid[]) AND s.archived_at IS NULL AND ${visibleTabSql(viewer, "$2")}`,
    [workbookIds, viewer.id],
  );
  const sheetIds = sheets.map((sheet) => sheet.id);
  const [columns, rows] = await Promise.all([
    query<{ id: string; sheet_id: string; name: string; type: ColumnType; settings: unknown }>(
      `SELECT id, sheet_id, name, type, settings FROM monitor_columns
       WHERE sheet_id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [sheetIds],
    ),
    query<{ sheet_id: string; data: Record<string, unknown>; created_by: string | null; created_at: Date; updated_at: Date }>(
      `SELECT sheet_id, data, created_by, created_at, updated_at FROM monitor_rows
       WHERE sheet_id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [sheetIds],
    ),
  ]);
  const bySheet = new Map<string, ChartTable>(
    sheets.map((sheet) => [sheet.id, { columns: [], rows: [] }]),
  );
  for (const column of columns) {
    bySheet.get(column.sheet_id)?.columns.push({
      id: column.id,
      name: column.name,
      type: column.type,
      settings: column.settings,
    });
  }
  for (const row of rows) {
    bySheet.get(row.sheet_id)?.rows.push({
      data: row.data,
      createdBy: row.created_by,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    });
  }
  for (const sheet of sheets) {
    const list = tables.get(sheet.workbook_id) ?? [];
    list.push(bySheet.get(sheet.id)!);
    tables.set(sheet.workbook_id, list);
  }
  return tables;
}

/** Computes every widget for this viewer. Sheets they can't open never count. */
export async function computeWidgets(
  viewer: Viewer,
  widgets: DashboardWidget[],
  sources: DashboardSource[],
): Promise<WidgetView[]> {
  const visible = new Map(sources.map((source) => [source.id, source.name]));
  const needed = [...new Set(widgets.flatMap((widget) => widget.config.workbookIds))].filter((id) =>
    visible.has(id),
  );
  const [tables, users] = await Promise.all([
    loadTables(viewer, needed),
    query<{ id: string; full_name: string }>(`SELECT id, full_name FROM monitor_users`),
  ]);
  const names = new Map(users.map((user) => [user.id, user.full_name]));
  return widgets.map((widget) => {
    const readable = widget.config.workbookIds.filter((id) => visible.has(id));
    const result = aggregate(
      readable.flatMap((id) => tables.get(id) ?? []),
      widget.config.spec as ChartSpec,
      names,
    );
    return {
      ...widget,
      result,
      sheetNames: readable.map((id) => visible.get(id) ?? ""),
      hiddenSheets: widget.config.workbookIds.length - readable.length,
    };
  });
}

export async function createWidget(input: {
  workspaceId: string;
  actorId: string;
  title: string;
  config: WidgetConfig;
}): Promise<string> {
  const rows = await query<{ id: string }>(
    `INSERT INTO monitor_dashboard_widgets (workspace_id, title, config, position, created_by)
     VALUES ($1, $2, $3::jsonb,
             COALESCE((SELECT max(position) + 1 FROM monitor_dashboard_widgets WHERE workspace_id = $1), 0),
             $4)
     RETURNING id`,
    [input.workspaceId, input.title, JSON.stringify(input.config), input.actorId],
  );
  return rows[0]!.id;
}

export async function updateWidget(input: {
  workspaceId: string;
  widgetId: string;
  title: string;
  config: WidgetConfig;
}): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE monitor_dashboard_widgets SET title = $3, config = $4::jsonb
     WHERE id = $2 AND workspace_id = $1
     RETURNING id`,
    [input.workspaceId, input.widgetId, input.title, JSON.stringify(input.config)],
  );
  return rows.length > 0;
}

export async function deleteWidget(workspaceId: string, widgetId: string): Promise<void> {
  await query(`DELETE FROM monitor_dashboard_widgets WHERE id = $2 AND workspace_id = $1`, [workspaceId, widgetId]);
}

/** Moves a widget one place earlier or later. */
export async function moveWidget(workspaceId: string, widgetId: string, direction: -1 | 1): Promise<void> {
  const widgets = await listWidgets(workspaceId);
  const index = widgets.findIndex((widget) => widget.id === widgetId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= widgets.length) {
    return;
  }
  const order = widgets.map((widget) => widget.id);
  [order[index], order[target]] = [order[target]!, order[index]!];
  await query(
    `UPDATE monitor_dashboard_widgets w
     SET position = o.position
     FROM unnest($2::uuid[]) WITH ORDINALITY AS o(id, position)
     WHERE w.id = o.id AND w.workspace_id = $1`,
    [workspaceId, order],
  );
}
