"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/current-user";
import { setFavorite } from "@/lib/favorites";
import { listDashboards } from "@/lib/dashboards/repo";
import { getWorkbookAccess } from "@/lib/sheets/workbook-access";
import { listMyWorkspaces } from "@/lib/workspaces/repo";

export async function toggleFavoriteAction(input: { workbookId: string; on: boolean }): Promise<{ error: string }> {
  const user = await requireUser();
  const id = z.uuid().safeParse(input.workbookId);
  if (!id.success || !(await getWorkbookAccess(user, id.data))) {
    return { error: "Sheet not found." };
  }
  await setFavorite(user.id, id.data, input.on === true);
  revalidatePath("/", "layout");
  return { error: "" };
}

/** Dashboards in every workspace the viewer belongs to, for the command palette. */
export async function listPaletteDashboards(): Promise<Array<{ id: string; name: string; workspaceId: string; workspaceName: string }>> {
  const user = await requireUser();
  const workspaces = await listMyWorkspaces(user);
  const lists = await Promise.all(
    workspaces.map(async (workspace) =>
      (await listDashboards(workspace.id)).map((dashboard) => ({
        id: dashboard.id,
        name: dashboard.name,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
      })),
    ),
  );
  return lists.flat();
}
