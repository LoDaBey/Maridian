import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/rbac";
import { computeWidgets, listDashboardSources, listWidgets } from "@/lib/dashboards/repo";
import { getWorkspace, isWorkspaceManager } from "@/lib/workspaces/repo";
import { Dashboard } from "../../../_components/dashboard/Dashboard";

export const instant = false;

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const user = await requireUser();
  const workspace = await getWorkspace(user, workspaceId);
  if (!workspace) {
    notFound();
  }
  const [widgets, sources] = await Promise.all([
    listWidgets(workspace.id),
    listDashboardSources(user, workspace.id),
  ]);
  const views = await computeWidgets(user, widgets, sources);

  return (
    <Dashboard
      workspace={{ id: workspace.id, name: workspace.name }}
      widgets={views}
      sources={sources}
      canEdit={isWorkspaceManager(workspace.role) || can(user.role, "workspace.create")}
    />
  );
}
