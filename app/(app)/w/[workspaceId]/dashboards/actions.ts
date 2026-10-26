"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/rbac";
import {
  DATE_TYPES,
  type ColumnRef,
  type DateBucket,
  type Filter,
} from "@/lib/analytics/types";
import type { DashboardFilters, WidgetConfig } from "@/lib/analytics/widgets";
import {
  columnValues,
  computeWidget,
  createDashboard,
  dashboardFiltersSchema,
  deleteDashboard,
  deleteWidget,
  duplicateWidget,
  getWidget,
  listDashboardSources,
  reorderWidgets,
  resizeWidget,
  saveWidget,
  updateDashboard,
  widgetConfigSchema,
  type WidgetData,
} from "@/lib/dashboards/repo";
import { buildTemplate, DASHBOARD_TEMPLATES, TEMPLATE_INFO } from "@/lib/dashboards/templates";
import { teamIdsFor } from "@/lib/teams/repo";
import { getWorkspace, isWorkspaceManager } from "@/lib/workspaces/repo";

const idSchema = z.uuid();

async function member(workspaceId: string) {
  const user = await requireUser();
  const parsed = idSchema.safeParse(workspaceId);
  if (!parsed.success) {
    return null;
  }
  const workspace = await getWorkspace(user, parsed.data);
  return workspace ? { user, workspace } : null;
}

/** Workspace owners/admins and Project Managers and up arrange shared dashboards. */
async function editor(workspaceId: string) {
  const context = await member(workspaceId);
  if (!context) {
    return { error: "Workspace not found." } as const;
  }
  if (!isWorkspaceManager(context.workspace.role) && !can(context.user.role, "dashboard.manage")) {
    return { error: "Only workspace admins and project managers can change dashboards." } as const;
  }
  return context;
}

function parseFilters(raw: unknown): DashboardFilters {
  return (dashboardFiltersSchema.safeParse(raw ?? {}).data ?? {}) as DashboardFilters;
}

// ---------- data ----------

/** One widget's data for the current viewer and dashboard filters. */
export async function loadWidgetData(input: {
  workspaceId: string;
  dashboardId: string;
  widgetId: string;
  filters: DashboardFilters;
}): Promise<WidgetData> {
  const context = await member(input.workspaceId);
  if (!context) {
    return { type: "empty", message: "Workspace not found." };
  }
  const widget = await getWidget(input.dashboardId, input.widgetId);
  if (!widget) {
    return { type: "empty", message: "Widget not found." };
  }
  const [sources, teamIds] = await Promise.all([
    listDashboardSources(context.user, context.workspace.id),
    teamIdsFor(context.user.id),
  ]);
  return computeWidget({ viewer: context.user, widget, sources, global: parseFilters(input.filters), teamIds });
}

/** Live preview while editing (the config isn't saved yet). */
export async function previewWidget(input: {
  workspaceId: string;
  config: WidgetConfig;
  filters: DashboardFilters;
}): Promise<WidgetData> {
  const context = await member(input.workspaceId);
  if (!context) {
    return { type: "empty", message: "Workspace not found." };
  }
  const parsed = widgetConfigSchema.safeParse(input.config);
  if (!parsed.success) {
    return { type: "empty", message: parsed.error.issues[0]?.message ?? "Finish the settings to see a preview." };
  }
  const [sources, teamIds] = await Promise.all([
    listDashboardSources(context.user, context.workspace.id),
    teamIdsFor(context.user.id),
  ]);
  return computeWidget({
    viewer: context.user,
    widget: { config: parsed.data as WidgetConfig },
    sources,
    global: parseFilters(input.filters),
    teamIds,
  });
}

function bucketEnd(start: string, bucket: DateBucket): string {
  const [y, m, d] = start.split("-").map(Number);
  const date = new Date(y!, (m ?? 1) - 1, d ?? 1);
  const end =
    bucket === "day"
      ? date
      : bucket === "week"
        ? new Date(date.getFullYear(), date.getMonth(), date.getDate() + 6)
        : bucket === "month"
          ? new Date(date.getFullYear(), date.getMonth() + 1, 0)
          : bucket === "quarter"
            ? new Date(date.getFullYear(), date.getMonth() + 3, 0)
            : new Date(date.getFullYear(), 11, 31);
  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
}

/** A filter that keeps only rows in one bucket of a dimension. */
function bucketFilter(ref: ColumnRef, key: string, bucket: DateBucket | undefined): Filter {
  if (key === "") {
    return { ref, op: "empty" };
  }
  if (DATE_TYPES.has(ref.type)) {
    return { ref, op: "date_range", range: "custom", from: key, to: bucketEnd(key, bucket ?? "week") };
  }
  return { ref, op: "any_of", values: [key] };
}

/** The items behind a clicked bar / slice / cell. */
export async function drillWidget(input: {
  workspaceId: string;
  dashboardId: string;
  widgetId?: string;
  config?: WidgetConfig;
  filters: DashboardFilters;
  k1: string;
  k2?: string;
}): Promise<WidgetData> {
  const context = await member(input.workspaceId);
  if (!context) {
    return { type: "empty", message: "Workspace not found." };
  }
  const widget = input.widgetId ? await getWidget(input.dashboardId, input.widgetId) : null;
  const config = widget?.config ?? (input.config ? (widgetConfigSchema.safeParse(input.config).data as WidgetConfig | undefined) : undefined);
  if (!config) {
    return { type: "empty", message: "Widget not found." };
  }
  const extra: Filter[] = [];
  if (config.dims[0] && input.k1 !== "__other") {
    extra.push(bucketFilter(config.dims[0].ref, input.k1, config.dims[0].bucket));
  }
  if (config.dims[1] && input.k2 !== undefined) {
    extra.push(bucketFilter(config.dims[1].ref, input.k2, config.dims[1].bucket));
  }
  const [sources, teamIds] = await Promise.all([
    listDashboardSources(context.user, context.workspace.id),
    teamIdsFor(context.user.id),
  ]);
  return computeWidget({
    viewer: context.user,
    widget: { config: { ...config, kind: "item_list", dims: [], options: { ...config.options, listColumns: undefined } } },
    sources,
    global: parseFilters(input.filters),
    teamIds,
    extra,
  });
}

export async function getColumnValues(input: {
  workspaceId: string;
  workbookIds: string[];
  ref: ColumnRef;
}): Promise<Array<{ key: string; label: string; color?: string }>> {
  const context = await member(input.workspaceId);
  if (!context) {
    return [];
  }
  const ids = z.array(z.uuid()).max(30).safeParse(input.workbookIds);
  if (!ids.success) {
    return [];
  }
  return columnValues({ viewer: context.user, workbookIds: ids.data, ref: input.ref });
}

// ---------- editing ----------

function done(workspaceId: string): { error: string } {
  revalidatePath(`/w/${workspaceId}/dashboards`, "layout");
  return { error: "" };
}

export async function saveWidgetAction(input: {
  workspaceId: string;
  dashboardId: string;
  widgetId?: string;
  title: string;
  config: WidgetConfig;
  width?: number;
  height?: number;
}): Promise<{ error: string; id?: string }> {
  const context = await editor(input.workspaceId);
  if ("error" in context) {
    return { error: context.error ?? "" };
  }
  const title = z.string().trim().min(1, "Give the widget a title.").max(100).safeParse(input.title);
  const config = widgetConfigSchema.safeParse(input.config);
  if (!title.success) {
    return { error: title.error.issues[0]?.message ?? "Check the title." };
  }
  if (!config.success) {
    return { error: config.error.issues[0]?.message ?? "Check the widget settings." };
  }
  const id = await saveWidget({
    workspaceId: context.workspace.id,
    dashboardId: input.dashboardId,
    widgetId: input.widgetId,
    actorId: context.user.id,
    title: title.data,
    config: config.data as WidgetConfig,
    width: input.width,
    height: input.height,
  });
  if (!id) {
    return { error: "Widget not found." };
  }
  done(context.workspace.id);
  return { error: "", id };
}

export async function deleteWidgetAction(input: { workspaceId: string; dashboardId: string; widgetId: string }) {
  const context = await editor(input.workspaceId);
  if ("error" in context) {
    return { error: context.error ?? "" };
  }
  await deleteWidget(input.dashboardId, input.widgetId);
  return done(context.workspace.id);
}

export async function duplicateWidgetAction(input: { workspaceId: string; dashboardId: string; widgetId: string }) {
  const context = await editor(input.workspaceId);
  if ("error" in context) {
    return { error: context.error ?? "" };
  }
  await duplicateWidget(input.dashboardId, input.widgetId, context.user.id);
  return done(context.workspace.id);
}

export async function layoutWidgetsAction(input: {
  workspaceId: string;
  dashboardId: string;
  order?: string[];
  resize?: { widgetId: string; width: number; height: number };
}) {
  const context = await editor(input.workspaceId);
  if ("error" in context) {
    return { error: context.error ?? "" };
  }
  if (input.order) {
    const order = z.array(z.uuid()).max(200).safeParse(input.order);
    if (order.success) {
      await reorderWidgets(input.dashboardId, order.data);
    }
  }
  if (input.resize) {
    await resizeWidget({ dashboardId: input.dashboardId, ...input.resize });
  }
  return done(context.workspace.id);
}

export async function createDashboardAction(input: {
  workspaceId: string;
  name: string;
  template: (typeof DASHBOARD_TEMPLATES)[number];
  workbookIds: string[];
}): Promise<{ error: string; id?: string }> {
  const context = await editor(input.workspaceId);
  if ("error" in context) {
    return { error: context.error ?? "" };
  }
  const template = z.enum(DASHBOARD_TEMPLATES).safeParse(input.template);
  const name = z.string().trim().min(1).max(80).safeParse(input.name || (template.success ? TEMPLATE_INFO[template.data].name : ""));
  const workbookIds = z.array(z.uuid()).max(30).safeParse(input.workbookIds);
  if (!template.success || !name.success || !workbookIds.success) {
    return { error: "Check the dashboard name and template." };
  }
  if (template.data !== "blank" && workbookIds.data.length === 0) {
    return { error: "Choose at least one sheet for the template." };
  }
  const id = await createDashboard({
    workspaceId: context.workspace.id,
    actorId: context.user.id,
    name: name.data,
    description: TEMPLATE_INFO[template.data].description,
  });
  const sources = await listDashboardSources(context.user, context.workspace.id);
  const widgets = await buildTemplate({ template: template.data, viewer: context.user, sources, workbookIds: workbookIds.data });
  for (const widget of widgets) {
    await saveWidget({
      workspaceId: context.workspace.id,
      dashboardId: id,
      actorId: context.user.id,
      title: widget.title,
      config: widget.config,
      width: widget.width,
      height: widget.height,
    });
  }
  done(context.workspace.id);
  return { error: "", id };
}

export async function updateDashboardAction(input: {
  workspaceId: string;
  dashboardId: string;
  name?: string;
  description?: string;
  filters?: DashboardFilters;
}) {
  const context = await editor(input.workspaceId);
  if ("error" in context) {
    return { error: context.error ?? "" };
  }
  const name = input.name !== undefined ? z.string().trim().min(1, "Enter a name.").max(80).safeParse(input.name) : null;
  if (name && !name.success) {
    return { error: name.error.issues[0]?.message ?? "Check the name." };
  }
  await updateDashboard({
    workspaceId: context.workspace.id,
    dashboardId: input.dashboardId,
    name: name?.data,
    description: input.description?.slice(0, 300),
    filters: input.filters ? parseFilters(input.filters) : undefined,
  });
  return done(context.workspace.id);
}

export async function deleteDashboardAction(input: { workspaceId: string; dashboardId: string }) {
  const context = await editor(input.workspaceId);
  if ("error" in context) {
    return { error: context.error ?? "" };
  }
  await deleteDashboard(context.workspace.id, input.dashboardId);
  return done(context.workspace.id);
}
