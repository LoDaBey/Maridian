"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/rbac";
import {
  createWidget,
  deleteWidget,
  moveWidget,
  updateWidget,
  widgetConfigSchema,
  type WidgetConfig,
} from "@/lib/dashboards/repo";
import { getWorkspace, isWorkspaceManager } from "@/lib/workspaces/repo";

const titleSchema = z.string().trim().min(1, "Give the widget a title.").max(100, "Use 100 characters or fewer.");
const idSchema = z.uuid("Not found.");

/** Workspace owners/admins and Project Managers and up arrange the shared dashboard. */
async function requireEditor(workspaceId: string) {
  const user = await requireUser();
  const workspace = await getWorkspace(user, workspaceId);
  if (!workspace) {
    return { error: "Workspace not found." } as const;
  }
  if (!isWorkspaceManager(workspace.role) && !can(user.role, "workspace.create")) {
    return { error: "Only workspace admins and project managers can change the dashboard." } as const;
  }
  return { user } as const;
}

function done(workspaceId: string): { error: string } {
  revalidatePath(`/w/${workspaceId}/dashboard`);
  return { error: "" };
}

export async function saveWidgetAction(input: {
  workspaceId: string;
  widgetId?: string;
  title: string;
  config: WidgetConfig;
}): Promise<{ error: string }> {
  const workspaceId = idSchema.safeParse(input.workspaceId);
  const title = titleSchema.safeParse(input.title);
  const config = widgetConfigSchema.safeParse(input.config);
  if (!workspaceId.success || !title.success || !config.success) {
    const issue = [workspaceId, title, config].find((result) => !result.success);
    return { error: issue && !issue.success ? (issue.error.issues[0]?.message ?? "Check the widget.") : "Check the widget." };
  }
  const access = await requireEditor(workspaceId.data);
  if ("error" in access) {
    return { error: access.error ?? "" };
  }
  if (input.widgetId) {
    const widgetId = idSchema.safeParse(input.widgetId);
    if (!widgetId.success) {
      return { error: "Widget not found." };
    }
    const ok = await updateWidget({
      workspaceId: workspaceId.data,
      widgetId: widgetId.data,
      title: title.data,
      config: config.data,
    });
    if (!ok) {
      return { error: "Widget not found." };
    }
  } else {
    await createWidget({
      workspaceId: workspaceId.data,
      actorId: access.user.id,
      title: title.data,
      config: config.data,
    });
  }
  return done(workspaceId.data);
}

export async function deleteWidgetAction(input: { workspaceId: string; widgetId: string }): Promise<{ error: string }> {
  const workspaceId = idSchema.safeParse(input.workspaceId);
  const widgetId = idSchema.safeParse(input.widgetId);
  if (!workspaceId.success || !widgetId.success) {
    return { error: "Widget not found." };
  }
  const access = await requireEditor(workspaceId.data);
  if ("error" in access) {
    return { error: access.error ?? "" };
  }
  await deleteWidget(workspaceId.data, widgetId.data);
  return done(workspaceId.data);
}

export async function moveWidgetAction(input: {
  workspaceId: string;
  widgetId: string;
  direction: -1 | 1;
}): Promise<{ error: string }> {
  const workspaceId = idSchema.safeParse(input.workspaceId);
  const widgetId = idSchema.safeParse(input.widgetId);
  if (!workspaceId.success || !widgetId.success) {
    return { error: "Widget not found." };
  }
  const access = await requireEditor(workspaceId.data);
  if ("error" in access) {
    return { error: access.error ?? "" };
  }
  await moveWidget(workspaceId.data, widgetId.data, input.direction === -1 ? -1 : 1);
  return done(workspaceId.data);
}
