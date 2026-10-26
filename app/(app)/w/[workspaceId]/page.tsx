import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/rbac";
import { listArchivedWorkbooks, listSheetTemplates, listWorkbooks } from "@/lib/sheets/sheets-repo";
import { getWorkspace, isWorkspaceManager, listWorkspaceMembers } from "@/lib/workspaces/repo";
import { SheetHome } from "../../_components/SheetHome";
import { WorkspaceHeader } from "../../_components/workspace/WorkspaceHeader";
import { WorkspaceKpis, WorkspaceKpisSkeleton } from "../../_components/workspace/WorkspaceKpis";

export const instant = false;

export default async function WorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const [{ workspaceId }, { new: openNew }] = await Promise.all([params, searchParams]);
  const user = await requireUser();
  const workspace = await getWorkspace(user, workspaceId);
  if (!workspace) {
    notFound();
  }
  const canRestore = can(user.role, "sheet.restore");
  const [workbooks, archived, savedTemplates, members] = await Promise.all([
    listWorkbooks(user, workspace.id),
    canRestore ? listArchivedWorkbooks(user, workspace.id) : Promise.resolve([]),
    listSheetTemplates(),
    listWorkspaceMembers(workspace.id),
  ]);

  return (
    <>
      <WorkspaceHeader
        workspace={workspace}
        members={members.slice(0, 6)}
        canManage={isWorkspaceManager(workspace.role)}
      />
      <Suspense fallback={<WorkspaceKpisSkeleton />}>
        <WorkspaceKpis viewer={{ id: user.id, role: user.role }} workspaceId={workspace.id} />
      </Suspense>
      <SheetHome
        key={openNew ? "new" : "home"}
        workspaceId={workspace.id}
        openNew={openNew === "1"}
        workbooks={workbooks}
        archived={archived}
        savedTemplates={savedTemplates}
        canCreate={can(user.role, "sheet.create")}
        canRestore={canRestore}
        currentUserId={user.id}
        role={user.role}
      />
    </>
  );
}
