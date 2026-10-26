import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/rbac";
import { listDashboardSources, listDashboards } from "@/lib/dashboards/repo";
import { getWorkspace, isWorkspaceManager, listWorkspaceMembers } from "@/lib/workspaces/repo";

/** What every dashboard page needs: the workspace, its dashboards, sheets and people. */
export async function loadDashboardContext(workspaceId: string) {
  const user = await requireUser();
  const workspace = await getWorkspace(user, workspaceId);
  if (!workspace) {
    notFound();
  }
  const [dashboards, sources, members] = await Promise.all([
    listDashboards(workspace.id),
    listDashboardSources(user, workspace.id),
    listWorkspaceMembers(workspace.id),
  ]);
  return {
    user,
    workspace,
    dashboards,
    sources,
    people: members.map((member) => ({ id: member.userId, fullName: member.fullName, avatarColor: member.avatarColor })),
    canEdit: isWorkspaceManager(workspace.role) || can(user.role, "dashboard.manage"),
  };
}
