import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/rbac";
import { listActiveSheets, listArchivedSheets } from "@/lib/sheets/sheets-repo";
import { listManagedWorkbookIds, listMyInvitations, listMyWorkspaces, listWorkspaceBoards } from "@/lib/workspaces/repo";
import { ConnectionBanner } from "./_components/ConnectionBanner";
import { RealtimeProvider } from "./_components/RealtimeProvider";
import { SheetTabs } from "./_components/SheetTabs";
import { TopBar } from "./_components/TopBar";
import { WorkspaceSidebar } from "./_components/workspace/WorkspaceSidebar";

export const instant = false;

export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireUser();
  const [sheets, archived, workspaces, boards, invitations, managed] = await Promise.all([
    listActiveSheets(user),
    can(user.role, "sheet.restore") ? listArchivedSheets(user) : Promise.resolve([]),
    listMyWorkspaces(user),
    listWorkspaceBoards(user),
    listMyInvitations(user.id),
    listManagedWorkbookIds(user),
  ]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg">
      <ConnectionBanner />
      <RealtimeProvider />
      <TopBar
        fullName={user.fullName}
        role={user.role}
        avatarColor={user.avatarColor}
        sheets={sheets}
      />
      <div className="flex min-h-0 flex-1">
        <WorkspaceSidebar
          workspaces={workspaces}
          boards={boards}
          sheets={sheets.map((sheet) => ({ id: sheet.id, workbookId: sheet.workbookId }))}
          invitationCount={invitations.length}
          canCreateWorkspace={can(user.role, "workspace.create")}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-auto">{children}</div>
          <SheetTabs role={user.role} sheets={sheets} archived={archived} managedWorkbookIds={managed} />
        </div>
      </div>
    </div>
  );
}
